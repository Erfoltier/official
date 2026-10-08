import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type {
  DayNote,
  DeviceOptions,
  DeviceLink,
  DeviceLinksStatus,
  DeviceSource,
  PhotoInboxItem,
  Actor,
  Estimate,
  EstimateLine,
  EstimateView,
  PriceItem,
  ConsentRecord,
  ConsentTemplate,
  ConsentTemplateWithHtml,
  ConsentView,
  PriceList,
  PriceSyncResult,
  ClinicSettings,
  Product,
  Stage,
  PatientFile,
  FileKind,
  DayBundle,
  Lane,
  Menu,
  ChartDrug,
  ChartEntry,
  Questionnaire,
  Patient,
  PatientChange,
  DuplicateCandidate,
  MergePreview,
  PatientDetail,
  Reservation,
  VisitNote,
  VisitRow,
  ReservationStatus,
  ReminderStatus,
} from "@/lib/domain/types";
import { DEFAULT_DEVICE_OPTIONS, DEFAULT_ESTIMATE_VALID_DAYS, INACTIVE_STATUSES, NEOVOIR_LIGHTS, STATUS_LABEL } from "@/lib/domain/types";
import { addDays, clinicDateOf, formatDateJa, isDateString, minutesOfDay, nowInClinic, toIso, weekdayOf } from "@/lib/domain/time";
import { cleanName, hasForbiddenChars, searchKey, foldNameVariants } from "@/lib/domain/text";
import {
  DEFAULT_SKINCARE_CATALOG,
  DEMO_CLINIC,
  buildDemoPatients,
  buildDemoReservations,
  demoHash,
  demoNextSkincare,
  demoRandom,
  demoVisitNote,
} from "@/lib/demo/seed";
import { AIR_LANES, AIR_MENUS } from "@/lib/seed/airreserve-import";
import { DEFAULT_PRODUCTS } from "@/lib/seed/products";
import { SLOT_MENUS } from "@/lib/seed/slot-menus";
import { DEFAULT_STAGES, STAGE_FOR_STATUS } from "@/lib/seed/stages";
import { SHEET_PRICES, SHEET_PRICES_LABEL } from "@/lib/seed/sheet-prices";
import { AuthError, audit } from "@/lib/server/staff";
import { PersistentMap, PersistentSet, count, deleteBlob, getBlob, getMeta, loadAll, put, putBlob, setMeta, transaction } from "@/lib/server/db";

/**
 * 予約・患者・記録のストア。読み込みはメモリ上で行い、変更は1件ずつデータベース（db.ts）へ保存する。
 * サーバーを再起動しても消えない。将来 PostgreSQL（院ごとの行分離）に置き換えても関数の形は変えない想定。
 */

/**
 * デモデータ（架空の患者・予約・施術歴）を入れるか。
 * 環境変数 RESERVE_DEMO=1/0。未設定なら開発時は入れ、本番（NODE_ENV=production）では入れない
 */
export function demoEnabled(): boolean {
  const v = process.env.RESERVE_DEMO;
  if (v === "1" || v === "0") return v === "1";
  return process.env.NODE_ENV !== "production";
}

interface StoreState {
  deviceLinks: Map<string, DeviceLink & { tokenHash: string }>;
  photoInbox: Map<string, PhotoInboxItem>;
  deviceRefs: Map<string, { patientId: string; at: string }>;
  dayNotes: Map<string, DayNote>;
  receptionNotes: Map<string, DayNote>;
  products: Map<string, Product>;
  stages: Map<string, Stage>;
  snapshots: Map<string, SettingsSnapshot>;
  files: Map<string, PatientFile>;
  estimates: Map<string, Estimate>;
  charts: Map<string, ChartEntry>;
  questionnaires: Map<string, Questionnaire>;
  prices: Map<string, PriceItem>;
  consentTemplates: Map<string, ConsentTemplateWithHtml>;
  consents: Map<string, ConsentRecord & { html: string }>;
  lanes: Map<string, Lane>;
  menus: Map<string, Menu>;
  patients: Map<string, Patient>;
  patientHistory: Map<string, PatientChange[]>;
  /** キー: `${patientId}|${date}` */
  visitNotes: Map<string, VisitNote>;
  historySeeded: boolean;
  reservations: Map<string, Reservation>;
  seededDates: Set<string>;
  seq: number;
}

const globalForStore = globalThis as unknown as { __reserveStore?: StoreState };

function state(): StoreState {
  if (!globalForStore.__reserveStore) {
    globalForStore.__reserveStore = transaction(() => {
      // 初回起動時だけ、Airリザーブから移したレーン・メニュー（とデモの患者）を入れる
      if (!getMeta<boolean>("initialized")) {
        for (const l of AIR_LANES) put("lane", l.id, l);
        for (const m of AIR_MENUS) put("menu", m.id, m);
        if (demoEnabled()) for (const p of buildDemoPatients()) put("patient", p.id, p);
        setMeta("initialized", true);
      }
      // スキンケア・内服のプリセット（あとから追加した機能なので、既存のデータにも1回だけ入れる）
      if (!getMeta<boolean>("productsSeeded")) {
        if (count("product") === 0) for (const p of DEFAULT_PRODUCTS) put("product", p.id, p);
        setMeta("productsSeeded", true);
      }
      // 最初に入れた見本のスキンケア・内服（値段なし）は、料金表を候補に使うようになったので片付ける（手を加えたものは残す）
      if (!getMeta<boolean>("demoProductsRetired")) {
        const demo = new Map(DEFAULT_PRODUCTS.map((p) => [p.id, p.name]));
        for (const [id, p] of loadAll<Product>("product")) {
          if (!p.deleted && demo.get(id) === p.name && p.priceYen === null) put("product", id, { ...p, active: false, deleted: true });
        }
        setMeta("demoProductsRetired", true);
      }
      // 予約枠時間一覧・ホームページから足したメニュー（既存のデータにも1回だけ。同じIDや同じ名前があれば足さない）
      if (!getMeta<boolean>("slotMenusSeeded")) {
        const have = loadAll<Menu>("menu");
        const names = new Set([...have.values()].map((m) => m.name));
        for (const m of SLOT_MENUS) if (!have.has(m.id) && !names.has(m.name)) put("menu", m.id, m);
        setMeta("slotMenusSeeded", true);
      }
      // 状態（院ごとに増減できる）も同じく1回だけ入れる
      if (!getMeta<boolean>("stagesSeeded")) {
        if (count("stage") === 0) for (const s of DEFAULT_STAGES) put("stage", s.id, s);
        setMeta("stagesSeeded", true);
      }
      return {
        snapshots: new PersistentMap<SettingsSnapshot>("settingsSnapshot"),
        deviceLinks: new PersistentMap<DeviceLink & { tokenHash: string }>("deviceLink"),
        photoInbox: new PersistentMap<PhotoInboxItem>("photoInbox"),
        deviceRefs: new PersistentMap<{ patientId: string; at: string }>("deviceRef"),
        dayNotes: new PersistentMap<DayNote>("dayNote"),
        receptionNotes: new PersistentMap<DayNote>("receptionNote"),
        stages: new PersistentMap<Stage>("stage"),
        products: new PersistentMap<Product>("product"),
        files: new PersistentMap<PatientFile>("file"),
        estimates: new PersistentMap<Estimate>("estimate"),
        charts: new PersistentMap<ChartEntry>("chart"),
        questionnaires: new PersistentMap<Questionnaire>("questionnaire"),
        prices: new PersistentMap<PriceItem>("price"),
        consentTemplates: new PersistentMap<ConsentTemplateWithHtml>("consentTemplate"),
        consents: new PersistentMap<ConsentRecord & { html: string }>("consent"),
        lanes: new PersistentMap<Lane>("lane"),
        menus: new PersistentMap<Menu>("menu"),
        patients: new PersistentMap<Patient>("patient"),
        patientHistory: new PersistentMap<PatientChange[]>("patientHistory"),
        visitNotes: new PersistentMap<VisitNote>("visitNote"),
        historySeeded: getMeta<boolean>("historySeeded") ?? false,
        reservations: new PersistentMap<Reservation>("reservation"),
        seededDates: new PersistentSet("seededDate"),
        seq: count("patient") + count("reservation"),
      };
    });
    // 自費商品の料金（スプレッドシート）：Apps Script がまだ送っていなければ、作った時点の内容を1回だけ入れる
    if (!getMeta<boolean>("sheetPricesSeeded")) {
      const url = `sheet:${SHEET_PRICES_LABEL}`;
      transaction(() => {
        if (![...globalForStore.__reserveStore!.prices.values()].some((p) => p.url === url)) receiveSheetPricesImpl(SHEET_PRICES_LABEL, SHEET_PRICES);
        setMeta("sheetPricesSeeded", true);
      });
    }
    // 設定のバックアップ：まだ記録がなければ、今の設定を「記録を始めた時点」として残す
    if (globalForStore.__reserveStore.snapshots.size === 0) {
      const id = "snap-baseline";
      globalForStore.__reserveStore.snapshots.set(id, { id, at: new Date().toISOString(), baseline: true, data: settingsData() });
    }
  }
  return globalForStore.__reserveStore;
}

/** デモ用：過去の予約は完了、今まさに進行中の予約は進行状態にする */
function demoStatus(r: Reservation, now: { date: string; minutes: number }): ReservationStatus {
  if (r.status !== "booked") return r.status;
  const date = clinicDateOf(r.startAt);
  if (date > now.date) return "booked";
  if (date < now.date) return "done";
  const s = minutesOfDay(r.startAt);
  const e = minutesOfDay(r.endAt);
  if (e <= now.minutes - 15) return "done";
  if (e <= now.minutes) return "checkout";
  if (s <= now.minutes) return "in_treatment";
  if (s <= now.minutes + 10) return "arrived";
  return "booked";
}

function ensureSeeded(date: string): void {
  if (!demoEnabled()) return;
  const st = state();
  if (st.seededDates.has(date)) return;
  transaction(() => seedDemoDay(date));
}

function seedDemoDay(date: string): void {
  const st = state();
  st.seededDates.add(date);
  const nowIso = new Date().toISOString();
  const now = nowInClinic();
  const reservations = buildDemoReservations(
    date,
    // ダミー予約はデモ用の架空患者にだけ付ける（登録した患者に架空の予約が入らないように）
    [...st.patients.values()].filter((p) => /^p-\d{4}$/.test(p.id)),
    sortedLanes(),
    sortedMenus(),
    DEMO_CLINIC,
    nowIso,
  );
  for (const r of reservations) {
    st.reservations.set(r.id, { ...r, status: demoStatus(r, now) });
  }
}

/** 開始時刻順。同じ時刻ならID順（PHP版と同じ並びにする） */
function byStart(a: Reservation, b: Reservation): number {
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 並び順。同じ順番ならID順（PHP版と同じ並びにする） */
function byOrder(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function sortedLanes(): Lane[] {
  return [...state().lanes.values()].sort(byOrder);
}

function sortedMenus(): Menu[] {
  return [...state().menus.values()].sort(byOrder);
}

export function getDayBundle(date: string): DayBundle {
  ensureSeeded(date);
  const st = state();
  const reservations = [...st.reservations.values()]
    .filter((r) => clinicDateOf(r.startAt) === date)
    .sort(byStart);
  const patientIds = new Set(reservations.map((r) => r.patientId));
  // 非表示のレーンでも、その日に予約が残っていれば表示する（予約が見えなくならないように）
  const usedLanes = new Set(reservations.filter((r) => !INACTIVE_STATUSES.has(r.status)).map((r) => r.laneId));
  return {
    date,
    clinic: getClinic(),
    lanes: sortedLanes().filter((l) => l.active || usedLanes.has(l.id)),
    menus: sortedMenus(),
    reservations,
    patients: [...patientIds].map((id) => st.patients.get(id)!).filter(Boolean),
    stages: sortedStages(),
    dayNotes: dayNotesOn(date),
    receptionNotes: receptionNotesOn(date, patientIds),
  };
}

// ---- Todaysメモ（日付×レーン。カレンダーの始業時間より上に出す自由記載） ----

const dayNoteId = (date: string, laneId: string) => `${date}|${laneId}`;

function dayNotesOn(date: string): Record<string, string> {
  const st = state();
  const out: Record<string, string> = {};
  for (const l of sortedLanes()) {
    const n = st.dayNotes.get(dayNoteId(date, l.id));
    if (n?.text) out[l.id] = n.text;
  }
  return out;
}

export function getDayNotes(date: string): { date: string; notes: Record<string, string> } {
  return { date, notes: dayNotesOn(date) };
}

/** Todaysメモを書き換える（空で消す） */
export function setDayNote(date: string, laneId: string, text: string, by?: Actor): DayNote {
  const st = state();
  const lane = st.lanes.get(laneId);
  if (!lane) throw new StoreError("not_found", "レーンが見つかりません");
  const v = checkNote("Todaysメモ", text, 1000);
  const note: DayNote = { date, laneId, text: v, updatedAt: new Date().toISOString(), ...(by && { updatedBy: by.name }) };
  const id = dayNoteId(date, laneId);
  const prev = st.dayNotes.get(id)?.text ?? "";
  if (prev === v) return note;
  if (v) st.dayNotes.set(id, note);
  else st.dayNotes.delete(id);
  if (by) audit(by, `Todaysメモ（${date} ${lane.name}）を${v ? "変更" : "削除"}`);
  return note;
}

// ---- 受付メモ（日付×患者。受付一覧に出す、その日の進行状況など。患者情報のメモとは別） ----

function receptionNotesOn(date: string, patientIds: Iterable<string>): Record<string, string> {
  const st = state();
  const out: Record<string, string> = {};
  for (const id of patientIds) {
    const n = st.receptionNotes.get(`${date}|${id}`);
    if (n?.text) out[id] = n.text;
  }
  return out;
}

/** 受付メモを書き換える（空で消す）。laneId の欄に患者IDを入れて保存する */
export function setReceptionNote(date: string, patientId: string, text: string, by?: Actor): DayNote {
  const st = state();
  if (!st.patients.has(patientId)) throw new StoreError("not_found", "患者が見つかりません");
  const v = checkNote("受付メモ", text, 4000);
  const note: DayNote = { date, laneId: patientId, text: v, updatedAt: new Date().toISOString(), ...(by && { updatedBy: by.name }) };
  const id = `${date}|${patientId}`;
  if ((st.receptionNotes.get(id)?.text ?? "") === v) return note;
  if (v) st.receptionNotes.set(id, note);
  else st.receptionNotes.delete(id);
  if (by) audit(by, `受付メモ（${date}）を${v ? "変更" : "削除"}`, patientId);
  return note;
}

/**
 * 月の日ごとの予約数（キャンセル・無断キャンセルを除く）。日付ジャンプ用のカレンダーに出す。
 * month は "2026-10"。予約のない日は含めない
 */
export function getMonthCounts(month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of state().reservations.values()) {
    if (INACTIVE_STATUSES.has(r.status)) continue;
    const date = clinicDateOf(r.startAt);
    if (date.startsWith(`${month}-`)) out[date] = (out[date] ?? 0) + 1;
  }
  return out;
}

/** 院の設定（院名・診療時間・刻み）。未設定なら標準値（9:00〜20:00・5分刻み） */
export const DEFAULT_CLINIC: ClinicSettings = { ...DEMO_CLINIC, dayStartMin: 9 * 60, dayEndMin: 20 * 60, slotMin: 5 };

export function getClinic(): ClinicSettings {
  state();
  return getMeta<ClinicSettings>("clinic") ?? DEFAULT_CLINIC;
}

export type ClinicInput = Partial<
  Pick<ClinicSettings, "name" | "dayStartMin" | "dayEndMin" | "slotMin" | "docName" | "address" | "phone" | "issuer" | "estimateNote" | "estimateValidDays" | "estimatePaper" | "theme">
>;

/** 院名・診療時間（カレンダーに出す時間帯）・刻みを変更する */
export function updateClinic(input: ClinicInput, by?: Actor): ClinicSettings {
  const cur = getClinic();
  const next: ClinicSettings = { ...cur };
  if (input.name !== undefined) next.name = checkText("院名", input.name, 40, true);
  if (input.slotMin !== undefined) next.slotMin = input.slotMin;
  if (input.dayStartMin !== undefined) next.dayStartMin = input.dayStartMin;
  if (input.dayEndMin !== undefined) next.dayEndMin = input.dayEndMin;
  // 書類に載せる院の情報（空で消す）
  for (const [k, label, max] of [
    ["docName", "書類に載せる院名", 60],
    ["address", "住所", 120],
    ["phone", "電話番号", 30],
    ["issuer", "発行者", 60],
  ] as const) {
    if (input[k] === undefined) continue;
    const v = checkText(label, input[k], max, false);
    if (v) next[k] = v;
    else delete next[k];
  }
  if (input.estimateNote !== undefined) next.estimateNote = checkNote("見積書の注意書き", input.estimateNote, 2000);
  if (input.estimateValidDays !== undefined) next.estimateValidDays = input.estimateValidDays;
  if (input.estimatePaper !== undefined) next.estimatePaper = input.estimatePaper;
  // 標準に戻すときは項目を消す
  if (input.theme !== undefined) {
    if (input.theme === "default") delete next.theme;
    else next.theme = input.theme;
  }
  if (next.dayStartMin % 5 !== 0 || next.dayEndMin % 5 !== 0) {
    throw new StoreError("invalid", "時刻は5分単位で指定してください");
  }
  if (next.dayEndMin - next.dayStartMin < 60) {
    throw new StoreError("invalid", "閉院時間は開院時間の1時間以上あとにしてください");
  }
  setMeta("clinic", next);
  if (by) audit(by, "院の設定（診療時間など）を変更");
  snapshotSettings();
  return next;
}

export function getSettings() {
  return { clinic: getClinic(), lanes: sortedLanes(), menus: sortedMenus(), products: sortedProducts(), stages: liveStages() };
}

// ---- 設定のバックアップ（自動）と復元 ----

export interface SettingsData {
  clinic: ClinicSettings;
  lanes: Lane[];
  menus: Menu[];
  stages: Stage[];
  products: Product[];
}

export interface SettingsSnapshot {
  id: string;
  at: string;
  /** 機能を入れた時点の状態（それより前の記録はない） */
  baseline?: boolean;
  data: SettingsData;
}

/** 戻せる時点 */
export const RESTORE_POINTS = [
  { key: "1d", label: "1日前", days: 1 },
  { key: "1w", label: "1週間前", days: 7 },
  { key: "1m", label: "1か月前", days: 30 },
  { key: "3m", label: "3か月前", days: 91 },
  { key: "6m", label: "6か月前", days: 182 },
  { key: "1y", label: "1年前", days: 365 },
] as const;

function settingsData(): SettingsData {
  const st = state();
  return {
    clinic: getClinic(),
    lanes: [...st.lanes.values()],
    menus: [...st.menus.values()],
    stages: [...st.stages.values()],
    products: [...st.products.values()],
  };
}

function snapshots(): SettingsSnapshot[] {
  return [...state().snapshots.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 設定を変えたあとに、その時点の設定一式を保存する。
 * 1分以内の続けての変更は1つにまとめ、8日より前は1日1つ、400日より前は消す
 */
function snapshotSettings(): void {
  const st = state();
  const now = new Date();
  const list = snapshots();
  const last = list[list.length - 1];
  if (last && !last.baseline && now.getTime() - Date.parse(last.at) < 60_000) st.snapshots.delete(last.id);
  const id = `snap-${now.getTime().toString(36)}`;
  st.snapshots.set(id, { id, at: now.toISOString(), data: settingsData() });
  // 古いものを間引く
  const keepAll = now.getTime() - 8 * 86_400_000;
  const drop = now.getTime() - 400 * 86_400_000;
  const byDay = new Map<string, SettingsSnapshot>();
  for (const s of snapshots()) {
    if (s.baseline) continue;
    const t = Date.parse(s.at);
    if (t < drop) st.snapshots.delete(s.id);
    else if (t < keepAll) {
      const day = clinicDateOf(s.at);
      const prev = byDay.get(day);
      if (prev) st.snapshots.delete(prev.id);
      byDay.set(day, s);
    }
  }
}

/** その時点に有効だった設定（その時刻より前の最後の保存。なければ一番古いもの） */
function snapshotAt(t: number): SettingsSnapshot | undefined {
  const list = snapshots();
  let found: SettingsSnapshot | undefined;
  for (const s of list) if (s.baseline || Date.parse(s.at) <= t) found = s;
  return found ?? list[0];
}

function summarize(d: SettingsData) {
  return {
    clinic: `${d.clinic.name} ${formatHmLocal(d.clinic.dayStartMin)}〜${formatHmLocal(d.clinic.dayEndMin)}`,
    lanes: d.lanes.filter((l) => l.active).length,
    menus: d.menus.filter((m) => m.active).length,
    stages: d.stages.filter((s) => !s.deleted && s.active).length,
    products: d.products.filter((p) => !p.deleted && p.active).length,
  };
}

function formatHmLocal(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** 戻せる時点の一覧（どの時点の設定に戻るか・中身の概要） */
export function listRestorePoints() {
  const now = Date.now();
  return {
    current: summarize(settingsData()),
    points: RESTORE_POINTS.map((p) => {
      const snap = snapshotAt(now - p.days * 86_400_000);
      return {
        key: p.key,
        label: p.label,
        at: snap?.baseline ? null : (snap?.at ?? null),
        available: !!snap,
        /** その時点より前の記録がなく、記録を始めた時点の設定になる */
        oldest: !!snap && (snap.baseline || Date.parse(snap.at) > now - p.days * 86_400_000),
        summary: snap ? summarize(snap.data) : null,
      };
    }),
  };
}

function restoreSettingsImpl(key: string, by?: Actor): SettingsData {
  const st = state();
  const point = RESTORE_POINTS.find((p) => p.key === key);
  if (!point) throw new StoreError("invalid", "戻す時点の指定が正しくありません");
  const snap = snapshotAt(Date.now() - point.days * 86_400_000);
  if (!snap) throw new StoreError("invalid", "戻せる設定の記録がありません");
  const d = snap.data;
  setMeta("clinic", d.clinic);
  // その時点にあったものは、その時点の内容に戻す。あとから作ったものは消さずに隠す（予約・記録が参照しているため）
  const lanes = new Set(d.lanes.map((x) => x.id));
  for (const x of d.lanes) st.lanes.set(x.id, x);
  for (const x of [...st.lanes.values()]) if (!lanes.has(x.id) && x.active) st.lanes.set(x.id, { ...x, active: false });
  const menus = new Set(d.menus.map((x) => x.id));
  for (const x of d.menus) st.menus.set(x.id, x);
  for (const x of [...st.menus.values()]) if (!menus.has(x.id) && x.active) st.menus.set(x.id, { ...x, active: false });
  const stages = new Set(d.stages.map((x) => x.id));
  for (const x of d.stages) st.stages.set(x.id, x);
  for (const x of [...st.stages.values()]) if (!stages.has(x.id) && !x.deleted) st.stages.set(x.id, { ...x, active: false, deleted: true });
  const products = new Set(d.products.map((x) => x.id));
  for (const x of d.products) st.products.set(x.id, x);
  for (const x of [...st.products.values()]) if (!products.has(x.id) && !x.deleted) st.products.set(x.id, { ...x, active: false, deleted: true });
  if (by) audit(by, `設定を${point.label}の状態に戻した`);
  snapshotSettings();
  return settingsData();
}

/** 設定（診療時間・レーン・メニュー・状態・スキンケア＆内服）を、指定した時点の状態に戻す */
export function restoreSettings(...args: Parameters<typeof restoreSettingsImpl>): ReturnType<typeof restoreSettingsImpl> {
  return transaction(() => restoreSettingsImpl(...args));
}

// ---- 状態（予約・来院済・医師待ち…。院ごとに増減できる） ----

function sortedStages(): Stage[] {
  return [...state().stages.values()].sort(byOrder);
}

/** 設定画面に出す状態（削除したものを除く） */
function liveStages(): Stage[] {
  return sortedStages().filter((s) => !s.deleted);
}

/** 予約の状態の表示名（自由入力ならその文字。キャンセルはそのまま） */
export function stageLabelOf(r: Reservation): string {
  if (INACTIVE_STATUSES.has(r.status)) return STATUS_LABEL[r.status];
  let s = r.stageId ? state().stages.get(r.stageId) : undefined;
  // 以前の版で「自由入力」を状態として選んでいた予約は、段階から決める
  if (!s || s.free) s = state().stages.get(STAGE_FOR_STATUS[r.status] ?? "");
  const label = s?.label ?? STATUS_LABEL[r.status];
  return r.stageText ? `${label}・${r.stageText}` : label;
}

export type StageInput = Partial<Pick<Stage, "label" | "color" | "phase" | "free" | "active">>;

function validateStage(s: Stage): Stage {
  const label = checkText("状態の名前", s.label, 12, true);
  for (const o of state().stages.values()) {
    if (o.id !== s.id && !o.deleted && o.label === label) throw new StoreError("invalid", "同じ名前の状態があります");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(s.color)) throw new StoreError("invalid", "色の指定が正しくありません");
  return { ...s, label };
}

export function createStage(input: StageInput, by?: Actor): Stage {
  const st = state();
  if (liveStages().length >= 60) throw new StoreError("invalid", "登録できる数を超えています");
  const s = validateStage({
    id: `stage-${Date.now().toString(36)}-${++st.seq}`,
    label: input.label ?? "",
    color: input.color ?? "#6366f1",
    phase: input.phase ?? "arrived",
    free: input.free ?? false,
    order: Math.max(-1, ...[...st.stages.values()].map((x) => x.order)) + 1,
    active: input.active ?? true,
  });
  st.stages.set(s.id, s);
  if (by) audit(by, "状態を追加", s.id);
  snapshotSettings();
  return s;
}

export function updateStage(id: string, input: StageInput, by?: Actor): Stage {
  const st = state();
  const cur = st.stages.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "状態が見つかりません");
  const next = validateStage({ ...cur, ...input, id: cur.id, order: cur.order });
  if (cur.active && !next.active && liveStages().filter((x) => x.active).length <= 1) {
    throw new StoreError("invalid", "表示する状態は1つ以上必要です");
  }
  st.stages.set(id, next);
  if (by) audit(by, "状態を変更", id);
  snapshotSettings();
  return next;
}

function reorderStagesImpl(ids: string[], by?: Actor): Stage[] {
  const st = state();
  const live = liveStages();
  if (ids.length !== live.length || !ids.every((id) => live.some((s) => s.id === id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.stages.set(id, { ...st.stages.get(id)!, order: i }));
  if (by) audit(by, "状態を並べ替え");
  snapshotSettings();
  return liveStages();
}

/**
 * 状態を削除する。過去にその状態を付けた予約の表示のため、記録は「削除済み」として残し、
 * 設定画面と予約の詳細のボタンからは消える。「予約」は基本の状態なので削除できない
 */
export function deleteStage(id: string, by?: Actor): void {
  const st = state();
  const cur = st.stages.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "状態が見つかりません");
  if (id === "stage-booked") throw new StoreError("invalid", "「予約」は基本の状態なので削除できません（使わない場合は非表示にしてください）");
  if (cur.active && liveStages().filter((x) => x.active).length <= 1) {
    throw new StoreError("invalid", "表示する状態は1つ以上必要です");
  }
  st.stages.set(id, { ...cur, active: false, deleted: true });
  if (by) audit(by, "状態を削除", id);
  snapshotSettings();
}

export function reorderStages(...args: Parameters<typeof reorderStagesImpl>): ReturnType<typeof reorderStagesImpl> {
  return transaction(() => reorderStagesImpl(...args));
}

// ---- ファイル（同意書のスキャン・写真・PDF・Word） ----

/** 1ファイルの上限（画像は画面側で縮小してから送る） */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const FILE_TYPES: Record<string, FileKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
};

/** ファイルの先頭の印で種類を確かめる（拡張子や申告だけを信じない） */
export function sniffType(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1|heis)$/.test(ascii(8, 12))) return "image/heic";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "application/msword";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

function cleanFileName(name: string, type: string): string {
  const base = cleanName(name.replace(/[\\/:*?"<>|]/g, "_")).slice(0, 100);
  if (base && !hasForbiddenChars(base)) return base;
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf", "application/msword": "doc" }[type] ?? "docx";
  return `file.${ext}`;
}

export function listFiles(patientId: string, date?: string): PatientFile[] {
  return [...state().files.values()]
    .filter((f) => f.patientId === patientId && !f.deleted && (!date || f.date === date))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveFile(
  patientId: string,
  input: { date: string; reservationId?: string; name: string; bytes: Uint8Array },
  by?: Actor,
): PatientFile {
  const st = state();
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  if (p.deleted) throw new StoreError("invalid", "削除された患者にはファイルを追加できません");
  if (!isDateString(input.date)) throw new StoreError("invalid", "日付が正しくありません");
  if (input.reservationId) {
    const r = st.reservations.get(input.reservationId);
    if (!r || r.patientId !== patientId) throw new StoreError("invalid", "予約が見つかりません");
  }
  if (input.bytes.length === 0) throw new StoreError("invalid", "ファイルが空です");
  if (input.bytes.length > MAX_FILE_BYTES) throw new StoreError("invalid", "ファイルが大きすぎます（10MBまで）");
  const type = sniffType(input.bytes);
  if (!type || !FILE_TYPES[type]) throw new StoreError("invalid", "追加できるのは 写真（JPEG・PNG・WebP・HEIC）・PDF・Word です");
  const id = `f-${Date.now().toString(36)}-${randomId()}`;
  const meta: PatientFile = {
    id,
    patientId,
    date: input.date,
    ...(input.reservationId && { reservationId: input.reservationId }),
    name: cleanFileName(input.name, type),
    type,
    kind: FILE_TYPES[type],
    size: input.bytes.length,
    createdAt: new Date().toISOString(),
    ...(by && { createdBy: by }),
  };
  transaction(() => {
    putBlob(id, input.bytes);
    st.files.set(id, meta);
  });
  if (by) audit(by, "ファイルを追加", patientId);
  return meta;
}

export function getFile(id: string): { meta: PatientFile; bytes: Buffer } {
  const meta = state().files.get(id);
  if (!meta || meta.deleted) throw new StoreError("not_found", "ファイルが見つかりません");
  const bytes = getBlob(id);
  if (!bytes) throw new StoreError("not_found", "ファイルが見つかりません");
  return { meta, bytes };
}

/** ファイルを削除扱いにする（中身は記録として残す） */
export function deleteFile(id: string, by?: Actor): PatientFile {
  const st = state();
  const cur = st.files.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "ファイルが見つかりません");
  const next: PatientFile = { ...cur, deleted: { at: new Date().toISOString(), ...(by && { by }) } };
  st.files.set(id, next);
  if (by) audit(by, "ファイルを削除", cur.patientId);
  return next;
}

function randomId(): string {
  return randomBytes(4).toString("hex");
}

// ---- Airリザーブから移した「今日以降」の予約（入れ直しのために完全に消す） ----

const AIR_MARK = "Air予約番号";

/** 今日以降の予約のうち、メモに「Air予約番号」があるもの（今日より前の予約と患者には触れない） */
function airFutureReservations(): Reservation[] {
  const today = nowInClinic().date;
  return [...state().reservations.values()].filter((r) => clinicDateOf(r.startAt) >= today && (r.memo ?? "").includes(AIR_MARK));
}

export function countAirFutureReservations(): { count: number; from: string } {
  return { count: airFutureReservations().length, from: nowInClinic().date };
}

export function deleteAirFutureReservations(by: Actor): { deleted: number; from: string } {
  const st = state();
  const deleted = transaction(() => {
    let n = 0;
    for (const r of airFutureReservations()) {
      st.reservations.delete(r.id);
      n++;
    }
    return n;
  });
  const from = nowInClinic().date;
  audit(by, `Airリザーブから移した${from}以降の予約${deleted}件を完全に削除（入れ直しのため）`);
  return { deleted, from };
}

// ---- 指定した患者の予約を過去・未来とも完全に消す（スタッフ予定などを誤って予約として移したときの片付け） ----

function reservationsOfPatient(patientId: string): Reservation[] {
  return [...state().reservations.values()].filter((r) => r.patientId === patientId);
}

export function countPatientReservations(patientId: string): { patientId: string; count: number } {
  if (!state().patients.has(patientId)) throw new StoreError("not_found", "患者が見つかりません");
  return { patientId, count: reservationsOfPatient(patientId).length };
}

export function deletePatientReservations(patientId: string, by: Actor): { patientId: string; deleted: number } {
  const st = state();
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  const deleted = transaction(() => {
    let n = 0;
    for (const r of reservationsOfPatient(patientId)) {
      st.reservations.delete(r.id);
      n++;
    }
    return n;
  });
  audit(by, `${p.name} の予約${deleted}件を完全に削除`);
  return { patientId, deleted };
}

// ---- 機器の連携（ネオボワールなど。院のパソコンに置いた取り込み係が写真を送ってくる） ----

const DEVICE_SOURCES: Record<DeviceSource, string> = { neovoir: "ネオボワール", google: "Google連携（問診票・同意書・料金表）" };
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const publicLink = (l: DeviceLink & { tokenHash: string }): DeviceLink => {
  const out: DeviceLink & { tokenHash?: string } = { ...l };
  delete out.tokenHash;
  return out;
};

/** 連携の一覧と受け取りの状況（鍵そのものは返さない） */
export function deviceLinks(): DeviceLinksStatus {
  const st = state();
  const links = [...st.deviceLinks.values()].map(publicLink).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const devices = links.filter((l) => l.source === "neovoir");
  const last = devices.reduce<string | undefined>((m, l) => (l.lastUsedAt && (!m || l.lastUsedAt > m) ? l.lastUsedAt : m), undefined);
  return { links, inbox: st.photoInbox.size, received: devices.reduce((n, l) => n + l.received, 0), ...(last && { lastReceivedAt: last }) };
}

/** 接続用の鍵を作る。鍵はこのときだけ返し、保存するのはハッシュだけ */
export function createDeviceLink(input: { source: DeviceSource; name?: string }, by: Actor): { link: DeviceLink; token: string } {
  const st = state();
  if (!DEVICE_SOURCES[input.source]) throw new StoreError("invalid", "連携できない機器です");
  const name = checkText("名前", input.name ?? "", 40, false) || DEVICE_SOURCES[input.source];
  const token = `${input.source === "neovoir" ? "nv_" : "gi_"}${randomBytes(20).toString("hex")}`;
  const id = `dl-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const link: DeviceLink = { id, source: input.source, name, createdAt: new Date().toISOString(), createdBy: by, received: 0 };
  st.deviceLinks.set(id, { ...link, tokenHash: sha256(token) });
  audit(by, `機器の連携を追加：${name}`);
  return { link, token };
}

export function revokeDeviceLink(id: string, by: Actor): DeviceLink {
  const st = state();
  const l = st.deviceLinks.get(id);
  if (!l) throw new StoreError("not_found", "連携が見つかりません");
  const next = { ...l, revoked: { at: new Date().toISOString(), by } };
  st.deviceLinks.set(id, next);
  audit(by, `機器の連携を止める：${l.name}`);
  return publicLink(next);
}

/** 取り込み方（光源・縮小）を変える。取り込み係は次に起きたときから従う */
export function setDeviceOptions(id: string, options: DeviceOptions, by: Actor): DeviceLink {
  const st = state();
  const l = st.deviceLinks.get(id);
  if (!l) throw new StoreError("not_found", "連携が見つかりません");
  const lights = NEOVOIR_LIGHTS.filter((x) => options.lights.includes(x));
  const next = { ...l, options: { lights, maxSide: options.maxSide } };
  st.deviceLinks.set(id, next);
  audit(by, `機器の取り込み方を変更：${l.name}（${lights.join("・")}、${options.maxSide ? `長い辺${options.maxSide}px に縮小` : "原寸"}）`);
  return publicLink(next);
}

export const deviceOptionsOf = (l: DeviceLink): DeviceOptions => l.options ?? DEFAULT_DEVICE_OPTIONS;

/** 鍵から連携を探す（止めたもの・違う鍵は undefined） */
/** 外部連携の受け取り口で使う「Google連携の鍵」。合えば最後に使った日時を残して true */
export function acceptIntegrationLink(token: string): boolean {
  const l = deviceLinkByToken(token);
  if (!l || l.source !== "google") return false;
  const st = state();
  const cur = st.deviceLinks.get(l.id);
  if (cur && (!cur.lastUsedAt || Date.parse(cur.lastUsedAt) < Date.now() - 60_000)) st.deviceLinks.set(l.id, { ...cur, lastUsedAt: new Date().toISOString() });
  return true;
}

export function deviceLinkByToken(token: string): DeviceLink | undefined {
  if (token.length < 20) return undefined;
  const h = sha256(token);
  const l = [...state().deviceLinks.values()].find((x) => x.tokenHash === h && !x.revoked);
  return l && publicLink(l);
}

/** 名前で患者を探す（漢字・フリガナ・ローマ字のどれかが空白を除いて同じで、ちょうど1人のときだけ） */
/** 番号の比べ方：数字だけにして先頭の0を落とす（「00123」と「123」を同じに） */
function refKey(v: string | undefined): string {
  return (v ?? "").normalize("NFKC").replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * 名前で探す。名前が1人に決まればその人。同姓同名などで決まらないときは、
 * 「氏名（またはフリガナ）」と「顧客番号＝カルテ番号／M3番号」の2つが合う人が1人だけならその人にする
 */
function matchByName(name: string, ref?: string): { id?: string; reason?: PhotoInboxItem["reason"] } {
  const key = searchKey(name);
  if (!key) return { reason: "not_found" };
  let hits = [...state().patients.values()].filter((p) => !p.deleted && [p.name, p.kana, p.nameAlt].some((x) => x && searchKey(x) === key));
  if (hits.length === 0) {
    // 同じ字で見つからなければ、旧字体・異体字をそろえて探し直す（川瀨／川瀬、冨沢／富沢 など）
    const fold = foldNameVariants(key);
    hits = [...state().patients.values()].filter((p) => !p.deleted && [p.name, p.kana, p.nameAlt].some((x) => x && foldNameVariants(searchKey(x)) === fold));
  }
  if (hits.length === 1) return { id: hits[0].id };
  const r = refKey(ref);
  if (r && hits.length > 1) {
    const both = hits.filter((p) => refKey(p.chartNo) === r || refKey(p.m3ChartNo) === r);
    if (both.length === 1) return { id: both[0].id };
  }
  return { reason: hits.length ? "ambiguous" : "not_found" };
}

/**
 * 機器の顧客番号（ネオボワールの番号など）で覚えた患者を先に使い、なければ名前で探す。
 * 一度結びついた番号は覚えておくので、次からは同姓同名でも取り違えない
 */
function matchPhoto(source: DeviceSource, ref: string | undefined, name: string): { id?: string; reason?: PhotoInboxItem["reason"] } {
  const st = state();
  if (ref) {
    const m = st.deviceRefs.get(`${source}:${ref}`);
    const p = m && st.patients.get(m.patientId);
    if (p && !p.deleted) return { id: p.id };
  }
  return matchByName(name, ref);
}

function rememberRef(source: DeviceSource, ref: string | undefined, patientId: string): void {
  if (ref) state().deviceRefs.set(`${source}:${ref}`, { patientId, at: new Date().toISOString() });
}

/**
 * 機器から写真を受け取る。同じ写真（中身が同じ）は2回目以降は受け取らない。
 * 名前で患者が1人に決まればその患者の写真（撮った日の記録）に、決まらなければ「照合待ち」に置く
 */
export function receiveDevicePhoto(
  link: DeviceLink,
  input: { patientName: string; fileName: string; takenAt?: string; ref?: string; bytes: Uint8Array },
): { status: "saved" | "inbox" | "duplicate"; id: string; matched?: boolean } {
  const st = state();
  if (input.bytes.length === 0) throw new StoreError("invalid", "ファイルが空です");
  if (input.bytes.length > MAX_FILE_BYTES) throw new StoreError("invalid", "ファイルが大きすぎます（10MBまで）");
  const type = sniffType(input.bytes);
  if (!type || FILE_TYPES[type] !== "image") throw new StoreError("invalid", "受け取れるのは写真（JPEG・PNG・WebP・HEIC）だけです");
  const id = `nv-${sha256(input.bytes).slice(0, 24)}`;
  if (st.files.has(id) || st.photoInbox.has(id)) return { status: "duplicate", id };
  const patientName = checkText("患者名", input.patientName, 60, false);
  const takenAt = input.takenAt && ISO_DATETIME.test(input.takenAt) && !Number.isNaN(Date.parse(input.takenAt)) ? normalizeIso(input.takenAt) : undefined;
  const date = clinicDateOf(takenAt ?? new Date().toISOString());
  const name = cleanFileName(input.fileName, type);
  const ref = input.ref && /^[A-Za-z0-9_-]{1,40}$/.test(input.ref) ? input.ref : undefined;
  const m = matchPhoto(link.source, ref, patientName);
  const by = { id: `device:${link.id}`, name: link.name };
  return transaction(() => {
    putBlob(id, input.bytes);
    const now = new Date().toISOString();
    if (m.id) {
      st.files.set(id, { id, patientId: m.id, date, name, type, kind: "image", size: input.bytes.length, createdAt: now, createdBy: by, source: link.source });
      rememberRef(link.source, ref, m.id);
    } else {
      st.photoInbox.set(id, {
        id,
        source: link.source,
        patientName,
        ...(ref && { ref }),
        date,
        ...(takenAt && { takenAt }),
        name,
        type,
        size: input.bytes.length,
        receivedAt: now,
        reason: m.reason ?? "not_found",
      });
    }
    const cur = st.deviceLinks.get(link.id)!;
    st.deviceLinks.set(link.id, { ...cur, lastUsedAt: now, received: cur.received + 1 });
    return m.id ? { status: "saved" as const, id, matched: true } : { status: "inbox" as const, id, matched: false };
  });
}

/** 照合待ちの写真（新しい順） */
export function listPhotoInbox(): PhotoInboxItem[] {
  return [...state().photoInbox.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id));
}

export function photoInboxContent(id: string): { item: PhotoInboxItem; bytes: Buffer } {
  const item = state().photoInbox.get(id);
  const bytes = item && getBlob(id);
  if (!item || !bytes) throw new StoreError("not_found", "写真が見つかりません");
  return { item, bytes };
}

function inboxToFile(item: PhotoInboxItem, patientId: string, by: Actor): PatientFile {
  return { id: item.id, patientId, date: item.date, name: item.name, type: item.type, kind: "image", size: item.size, createdAt: new Date().toISOString(), createdBy: by, source: item.source };
}

/** 照合待ちの写真を患者に結びつける（撮った日の記録に入る） */
export function assignPhotoInbox(id: string, patientId: string, by: Actor): PatientFile {
  const st = state();
  const item = st.photoInbox.get(id);
  if (!item) throw new StoreError("not_found", "写真が見つかりません");
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  if (p.deleted) throw new StoreError("invalid", "削除された患者には結びつけられません");
  const meta = inboxToFile(item, patientId, by);
  transaction(() => {
    st.files.set(id, meta);
    st.photoInbox.delete(id);
    rememberRef(item.source, item.ref, patientId);
  });
  audit(by, "機器の写真を患者に結びつけ", patientId);
  return meta;
}

export function deletePhotoInbox(id: string, by: Actor): void {
  const st = state();
  if (!st.photoInbox.has(id)) throw new StoreError("not_found", "写真が見つかりません");
  transaction(() => {
    st.photoInbox.delete(id);
    deleteBlob(id);
  });
  audit(by, "照合待ちの写真を削除");
}

/** 照合待ちの写真を、今の患者でもう一度名前照合する（Airリザーブからの移行のあとなど） */
export function rematchPhotoInbox(by: Actor): { matched: number; remaining: number } {
  const st = state();
  let matched = 0;
  for (const item of listPhotoInbox()) {
    const m = matchPhoto(item.source, item.ref, item.patientName);
    if (!m.id) {
      if (item.reason !== m.reason) st.photoInbox.set(item.id, { ...item, reason: m.reason ?? "not_found" });
      continue;
    }
    const meta = inboxToFile(item, m.id, { id: "system", name: "名前照合" });
    transaction(() => {
      st.files.set(item.id, meta);
      st.photoInbox.delete(item.id);
      rememberRef(item.source, item.ref, m.id!);
    });
    matched++;
  }
  if (matched > 0) audit(by, `照合待ちの写真${matched}枚を名前照合で患者に結びつけ`);
  return { matched, remaining: st.photoInbox.size };
}

// ---- スキンケア・内服のプリセット ----

function sortedProducts(): Product[] {
  return [...state().products.values()].filter((p) => !p.deleted).sort(byOrder);
}

export type ProductInput = Partial<Pick<Product, "name" | "category" | "priceYen" | "active">>;

function validateProduct(p: Product): Product {
  const name = checkText("名前", p.name, 60, true);
  for (const o of state().products.values()) {
    if (o.id !== p.id && !o.deleted && searchKey(o.name) === searchKey(name)) throw new StoreError("invalid", "同じ名前のプリセットがあります");
  }
  if (p.priceYen !== null && !(Number.isInteger(p.priceYen) && p.priceYen >= 0 && p.priceYen <= 10_000_000)) {
    throw new StoreError("invalid", "価格の指定が正しくありません");
  }
  return { ...p, name };
}

export function createProduct(input: ProductInput, by?: Actor): Product {
  const st = state();
  if (sortedProducts().length >= 500) throw new StoreError("invalid", "登録できる数を超えています");
  const p = validateProduct({
    id: `prod-${Date.now().toString(36)}-${++st.seq}`,
    name: input.name ?? "",
    category: input.category ?? "skincare",
    priceYen: input.priceYen ?? null,
    order: Math.max(-1, ...[...st.products.values()].map((x) => x.order)) + 1,
    active: input.active ?? true,
  });
  st.products.set(p.id, p);
  if (by) audit(by, "スキンケア・内服のプリセットを追加", p.id);
  snapshotSettings();
  return p;
}

export function updateProduct(id: string, input: ProductInput, by?: Actor): Product {
  const st = state();
  const cur = st.products.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "プリセットが見つかりません");
  const next = validateProduct({ ...cur, ...input, id: cur.id, order: cur.order });
  st.products.set(id, next);
  if (by) audit(by, "スキンケア・内服のプリセットを変更", id);
  snapshotSettings();
  return next;
}

function reorderProductsImpl(ids: string[], by?: Actor): Product[] {
  const st = state();
  const live = sortedProducts();
  if (ids.length !== live.length || !ids.every((id) => live.some((p) => p.id === id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.products.set(id, { ...st.products.get(id)!, order: i }));
  if (by) audit(by, "スキンケア・内服のプリセットを並べ替え");
  snapshotSettings();
  return sortedProducts();
}

/** プリセットを削除する（施術歴の記録は名前で残っているので、そのまま表示される） */
export function deleteProduct(id: string, by?: Actor): void {
  const st = state();
  const cur = st.products.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "プリセットが見つかりません");
  st.products.set(id, { ...cur, active: false, deleted: true });
  if (by) audit(by, "スキンケア・内服のプリセットを削除", id);
  snapshotSettings();
}

export function reorderProducts(...args: Parameters<typeof reorderProductsImpl>): ReturnType<typeof reorderProductsImpl> {
  return transaction(() => reorderProductsImpl(...args));
}

/**
 * 患者検索。氏名・フリガナ・別表記・診察券番号・電話番号の部分一致。
 * ひらがな／カタカナ、全角／半角、大文字／小文字、空白の違いは無視する。
 */
export function searchPatients(query: string, limit = 20): Patient[] {
  const q = searchKey(query);
  if (!q) {
    // 検索語がなければ、最近登録・更新した患者
    return [...state().patients.values()]
      .filter((p) => !p.deleted)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.chartNo.localeCompare(a.chartNo))
      .slice(0, limit);
  }
  const digits = query.replace(/\D/g, "");
  const out: Patient[] = [];
  // 予約申請ID（例：R2026100506574020A34A8B）で探す
  const rid = query.normalize("NFKC").trim().toUpperCase();
  if (looksLikeRequestId(rid)) {
    for (const r of state().reservations.values()) {
      const p = r.requestId?.toUpperCase() === rid ? state().patients.get(r.patientId) : undefined;
      if (p && !p.deleted && !out.includes(p)) out.push(p);
    }
  }
  for (const p of state().patients.values()) {
    if (p.deleted) continue;
    const hay = searchKey(`${p.name}|${p.kana}|${p.nameAlt ?? ""}|${p.chartNo}|${p.m3ChartNo ?? ""}`);
    const phoneHit = digits.length >= 4 && (p.phone ?? "").replace(/\D/g, "").includes(digits);
    if (hay.includes(q) || phoneHit) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** 予約申請IDらしい文字列か（英数字8文字以上で、数字と英字を両方含む） */
function looksLikeRequestId(s: string): boolean {
  return /^[A-Z0-9_-]{8,40}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s);
}

export function getPatient(id: string): Patient | undefined {
  return state().patients.get(id);
}

export class StoreError extends Error {
  constructor(
    public code: "not_found" | "version_conflict" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const laneExists = (id: string) => state().lanes.has(id);
const menuExists = (id: string) => state().menus.has(id);

function assertTimes(startAt: string, endAt: string): void {
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (!(e > s)) throw new StoreError("invalid", "終了時刻は開始時刻より後にしてください");
  if (e - s > 12 * 60 * 60_000) throw new StoreError("invalid", "予約時間が長すぎます");
  if (clinicDateOf(startAt) !== clinicDateOf(new Date(e - 1).toISOString())) {
    throw new StoreError("invalid", "日をまたぐ予約は登録できません");
  }
}

export interface CreateReservationInput {
  patientId: string;
  laneId: string;
  menuIds: string[];
  startAt: string;
  endAt: string;
  memo?: string;
  requestId?: string;
}

export function createReservation(input: CreateReservationInput, by?: Actor): Reservation {
  const st = state();
  const patient = st.patients.get(input.patientId);
  if (!patient || patient.deleted) throw new StoreError("invalid", "患者が見つかりません");
  if (!laneExists(input.laneId)) throw new StoreError("invalid", "レーンが見つかりません");
  if (!input.menuIds.every(menuExists)) {
    throw new StoreError("invalid", "施術が見つかりません");
  }
  assertTimes(input.startAt, input.endAt);
  ensureSeeded(clinicDateOf(input.startAt));
  const nowIso = new Date().toISOString();
  const r: Reservation = {
    id: `r-new-${Date.now().toString(36)}-${++st.seq}`,
    patientId: input.patientId,
    laneId: input.laneId,
    menuIds: input.menuIds,
    startAt: normalizeIso(input.startAt),
    endAt: normalizeIso(input.endAt),
    status: "booked",
    memo: input.memo,
    ...(input.requestId && { requestId: input.requestId }),
    reminder: { status: "pending" },
    ...(by && { createdBy: by, updatedBy: by }),
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  st.reservations.set(r.id, r);
  if (by) audit(by, "予約を登録", r.id);
  return r;
}

export interface UpdateReservationInput {
  /** 画面が持っている版。サーバー側が進んでいたら更新を拒否する */
  version: number;
  laneId?: string;
  startAt?: string;
  endAt?: string;
  status?: ReservationStatus;
  menuIds?: string[];
  memo?: string;
  /** 空文字で削除 */
  requestId?: string;
  /** 院で決めた状態。指定すると status はその段階になる */
  stageId?: string;
  /** 自由入力の状態の文字 */
  stageText?: string;
  /** 状態を変えた時刻（予約日の0時からの分）。省略すると今の時刻 */
  stageMin?: number;
}

export function updateReservation(id: string, input: UpdateReservationInput, by?: Actor): Reservation {
  const st = state();
  const cur = st.reservations.get(id);
  if (!cur) throw new StoreError("not_found", "予約が見つかりません");
  if (cur.version !== input.version) {
    throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を更新してください");
  }
  if (input.laneId !== undefined && !laneExists(input.laneId)) {
    throw new StoreError("invalid", "レーンが見つかりません");
  }
  if (input.menuIds !== undefined && !input.menuIds.every(menuExists)) {
    throw new StoreError("invalid", "施術が見つかりません");
  }
  const startAt = input.startAt !== undefined ? normalizeIso(input.startAt) : cur.startAt;
  const endAt = input.endAt !== undefined ? normalizeIso(input.endAt) : cur.endAt;
  assertTimes(startAt, endAt);

  const timeChanged = startAt !== cur.startAt;
  const next: Reservation = {
    ...cur,
    ...(input.laneId !== undefined && { laneId: input.laneId }),
    ...(input.status !== undefined && { status: input.status }),
    ...(input.menuIds !== undefined && { menuIds: input.menuIds }),
    ...(input.memo !== undefined && { memo: input.memo }),
    startAt,
    endAt,
    // 時刻が変わったら、送信済みのリマインドは送り直しが必要
    reminder: timeChanged ? { status: "pending" } : cur.reminder,
    ...(by && { updatedBy: by }),
    version: cur.version + 1,
    updatedAt: new Date().toISOString(),
  };
  if (input.requestId !== undefined) {
    if (input.requestId) next.requestId = input.requestId;
    else delete next.requestId;
  }
  if (input.stageId !== undefined) {
    const stage = st.stages.get(input.stageId);
    if (!stage || stage.deleted || (!stage.active && stage.id !== cur.stageId)) throw new StoreError("invalid", "状態が見つかりません");
    if (stage.free) throw new StoreError("invalid", "自由入力は文字（stageText）で指定してください");
    next.stageId = stage.id;
    next.status = stage.phase;
    next.stageAt = new Date().toISOString();
  }
  if (input.stageText !== undefined) {
    // 自由入力は状態とは別に持つ（空で消す）
    const text = checkText("自由入力", input.stageText, 20, false);
    if (text) next.stageText = text;
    else delete next.stageText;
  }
  if (input.stageId === undefined && input.status !== undefined && !INACTIVE_STATUSES.has(input.status)) {
    // 段階だけを直接変えたとき（古い画面・外部連携）は、院の状態の選択を外す
    delete next.stageId;
    next.stageAt = new Date().toISOString();
  }
  if (input.stageMin !== undefined) {
    // 後から入力するとき用（例：「10:05 来院済」を10:20に記録）
    next.stageAt = toIso(clinicDateOf(startAt), input.stageMin);
  }
  st.reservations.set(id, next);
  if (by) {
    const what = [
      timeChanged || input.endAt !== undefined ? "時間" : null,
      input.laneId !== undefined && input.laneId !== cur.laneId ? "レーン" : null,
      input.stageId !== undefined ? `状態→${stageLabelOf(next)}` : input.status !== undefined ? `状態→${STATUS_LABEL[input.status]}` : null,
      input.stageText !== undefined ? "自由入力" : null,
      input.stageMin !== undefined && input.stageId === undefined ? "状態の時刻" : null,
      input.menuIds !== undefined ? "メニュー" : null,
      input.memo !== undefined ? "メモ" : null,
      input.requestId !== undefined ? "予約申請ID" : null,
    ].filter(Boolean);
    audit(by, `予約を変更（${what.join("・")}）`, id);
  }
  return next;
}

/** 外部の送信プログラムがリマインドの結果を書き戻す */
export function setReminderStatus(id: string, status: ReminderStatus): Reservation {
  const st = state();
  const cur = st.reservations.get(id);
  if (!cur) throw new StoreError("not_found", "予約が見つかりません");
  const next: Reservation = {
    ...cur,
    reminder: { status, updatedAt: new Date().toISOString() },
    version: cur.version + 1,
    updatedAt: new Date().toISOString(),
  };
  st.reservations.set(id, next);
  return next;
}

/** 外部連携（自動入力）で書き込んだときの記録上の名前 */
const INTEGRATION_ACTOR: Actor = { id: "integration", name: "外部連携" };

/** 外部連携：LINE予約フォームなどから予約申請IDを書き込む */
export function setReservationRequestId(id: string, requestId: string): Reservation {
  const cur = state().reservations.get(id);
  if (!cur) throw new StoreError("not_found", "予約が見つかりません");
  return updateReservation(id, { version: cur.version, requestId }, INTEGRATION_ACTOR);
}

/** 外部連携：電子カルテ（M3）などからカルテ番号を書き込む */
export function setPatientM3ChartNo(id: string, m3ChartNo: string): Patient {
  const cur = state().patients.get(id);
  if (!cur) throw new StoreError("not_found", "患者が見つかりません");
  return updatePatient(id, { version: cur.version, m3ChartNo }, INTEGRATION_ACTOR);
}

/** どんな形のISO文字列でも日本時間の "YYYY-MM-DDTHH:mm:ss+09:00" にそろえる */
function normalizeIso(iso: string): string {
  return toIso(clinicDateOf(iso), minutesOfDay(iso));
}

// ---- 患者の登録・編集 ----

export interface PatientInput {
  name?: string;
  kana?: string;
  nameAlt?: string;
  phone?: string;
  email?: string;
  postalCode?: string;
  address?: string;
  sex?: string;
  chartNo?: string;
  m3ChartNo?: string;
  birthDate?: string;
  caution?: boolean;
  cautionNote?: string;
  memo?: string;
  history?: string;
  medications?: string;
  questionnaireOther?: string;
}

export type CreatePatientInput = PatientInput & { name: string };

/** 性別の入力・問診票の回答を女性・男性・その他にそろえる（読めなければ undefined） */
function sexOf(v: string): Patient["sex"] {
  const t = v.normalize("NFKC").trim().toLowerCase();
  if (/^(female|f|女|女性|おんな)$/.test(t)) return "female";
  if (/^(male|m|男|男性|おとこ)$/.test(t)) return "male";
  if (/^(other|その他|回答しない|答えたくない)$/.test(t)) return "other";
  return undefined;
}

function checkText(label: string, value: string, max: number, required: boolean): string {
  const v = cleanName(value);
  if (required && !v) throw new StoreError("invalid", `${label}を入力してください`);
  if (v.length > max) throw new StoreError("invalid", `${label}は${max}文字以内にしてください`);
  if (hasForbiddenChars(v)) throw new StoreError("invalid", `${label}に使えない文字が含まれています`);
  return v;
}

/** 改行を許す長文（メモ等）の検査 */
function checkNote(label: string, value: string, max: number): string {
  const v = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (v.length > max) throw new StoreError("invalid", `${label}は${max}文字以内にしてください`);
  if (hasForbiddenChars(v.replace(/\n/g, ""))) throw new StoreError("invalid", `${label}に使えない文字が含まれています`);
  return v;
}

/** 入力を検査して、保存する値にそろえる。空文字は「未入力」として undefined にする */
function patientFields(input: PatientInput, selfId: string | null): Partial<Patient> {
  const st = state();
  const out: Partial<Patient> = {};
  const opt = (v: string) => (v ? v : undefined);
  if (input.name !== undefined) out.name = checkText("氏名", input.name, 60, true);
  if (input.kana !== undefined) out.kana = checkText("フリガナ", input.kana, 60, false);
  if (input.nameAlt !== undefined) out.nameAlt = opt(checkText("別の表記", input.nameAlt, 60, false));
  if (input.phone !== undefined) {
    const phone = input.phone.normalize("NFKC").trim();
    if (phone && !/^[0-9+\-() ]{6,20}$/.test(phone)) throw new StoreError("invalid", "電話番号の形式が正しくありません");
    out.phone = opt(phone);
  }
  if (input.email !== undefined) {
    const email = input.email.normalize("NFKC").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new StoreError("invalid", "メールアドレスの形式が正しくありません");
    }
    out.email = opt(email);
  }
  if (input.postalCode !== undefined) {
    const digits = input.postalCode.normalize("NFKC").replace(/[〒\s\-‐‑–—―−ーｰ]/g, "");
    if (digits && !/^\d{7}$/.test(digits)) throw new StoreError("invalid", "郵便番号は7桁の数字で入力してください");
    out.postalCode = opt(digits && `${digits.slice(0, 3)}-${digits.slice(3)}`);
  }
  if (input.address !== undefined) out.address = opt(checkText("住所", input.address, 200, false));
  if (input.sex !== undefined) {
    const v = input.sex.normalize("NFKC").trim();
    const sex = sexOf(v);
    if (v && !sex) throw new StoreError("invalid", "性別は 女性・男性・その他 から選んでください");
    out.sex = sex;
  }
  if (input.chartNo !== undefined) {
    const chartNo = input.chartNo.normalize("NFKC").trim();
    // 空欄でもよい（まだ診察券を作っていない患者）。入れるときは英数字で、ほかの患者と重ならないこと
    if (chartNo !== "" && !/^[A-Za-z0-9-]{1,20}$/.test(chartNo)) throw new StoreError("invalid", "診察券番号は英数字で入力してください");
    if (chartNo !== "") {
      for (const p of st.patients.values()) {
        if (p.chartNo === chartNo && p.id !== selfId) throw new StoreError("invalid", "この診察券番号は既に使われています");
      }
    }
    out.chartNo = chartNo;
  }
  if (input.m3ChartNo !== undefined) {
    const m3 = input.m3ChartNo.normalize("NFKC").trim();
    if (m3 && !/^[A-Za-z0-9-]{1,20}$/.test(m3)) throw new StoreError("invalid", "M3カルテ番号は英数字で入力してください");
    if (m3) {
      for (const p of st.patients.values()) {
        if (p.m3ChartNo === m3 && p.id !== selfId && !p.deleted) {
          throw new StoreError("invalid", `このM3カルテ番号は ${p.chartNo ? `診察券${p.chartNo}（${p.name}）` : `${p.name} さん`}に登録されています`);
        }
      }
    }
    out.m3ChartNo = opt(m3);
  }
  if (input.birthDate !== undefined) {
    const b = input.birthDate.trim();
    if (b && (!isDateString(b) || b < "1900-01-01" || b > nowInClinic().date)) {
      throw new StoreError("invalid", "生年月日が正しくありません");
    }
    out.birthDate = opt(b);
  }
  if (input.caution !== undefined) out.caution = input.caution || undefined;
  if (input.cautionNote !== undefined) out.cautionNote = opt(checkNote("注意事項", input.cautionNote, 500));
  if (input.memo !== undefined) out.memo = opt(checkNote("メモ", input.memo, 12000));
  if (input.history !== undefined) out.history = opt(checkNote("既往歴", input.history, 2000));
  if (input.medications !== undefined) out.medications = opt(checkNote("内服歴", input.medications, 2000));
  if (input.questionnaireOther !== undefined) out.questionnaireOther = opt(checkNote("その他の問診票情報", input.questionnaireOther, 8000));
  return out;
}

export function createPatient(input: CreatePatientInput, by?: Actor): Patient {
  const st = state();
  // 診察券番号は自動では振らない（入れなければ空欄のまま）
  const chartNoGiven = (input.chartNo ?? "").trim() !== "";
  const fields = patientFields({ kana: "", ...input, chartNo: chartNoGiven ? input.chartNo : undefined }, null);
  const now = new Date().toISOString();
  const p = dropUndefined({
    id: `p-new-${Date.now().toString(36)}-${++st.seq}`,
    chartNo: fields.chartNo ?? "",
    name: fields.name!,
    kana: fields.kana ?? "",
    ...fields,
    version: 1,
    updatedAt: now,
  } as Patient);
  st.patients.set(p.id, p);
  st.patientHistory.set(p.id, [{ at: now, fields: ["新規登録"], ...(by && { by }) }]);
  if (by) audit(by, "患者を登録", p.id);
  return p;
}

const FIELD_LABEL: Record<string, string> = {
  name: "氏名",
  kana: "フリガナ",
  nameAlt: "別の表記",
  phone: "電話",
  email: "メール",
  postalCode: "郵便番号",
  address: "住所",
  sex: "性別",
  chartNo: "診察券番号",
  m3ChartNo: "M3カルテ番号",
  birthDate: "生年月日",
  caution: "注意事項あり",
  cautionNote: "注意事項",
  memo: "メモ",
  history: "既往歴",
  medications: "内服歴",
  questionnaireOther: "その他の問診票情報",
  lineUserId: "LINE紐付け",
};

export function updatePatient(id: string, input: PatientInput & { version: number }, by?: Actor): Patient {
  const st = state();
  const cur = st.patients.get(id);
  if (!cur) throw new StoreError("not_found", "患者が見つかりません");
  if (cur.deleted) throw new StoreError("invalid", "削除された患者は編集できません。先に復元してください");
  if (cur.version !== input.version) {
    throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  }
  const { version: _v, ...rest } = input;
  void _v;
  const fields = patientFields(rest, id);
  const changed = (Object.keys(fields) as (keyof Patient)[]).filter((k) => (cur[k] ?? "") !== (fields[k] ?? ""));
  if (changed.length === 0) return cur;
  const now = new Date().toISOString();
  const next = dropUndefined({ ...cur, ...fields, version: cur.version + 1, updatedAt: now });
  st.patients.set(id, next);
  recordChange(id, changed.map((k) => FIELD_LABEL[k] ?? k), now, by);
  return next;
}

/** LINEの紐付けを解除する（誤った紐付けの訂正・本人の希望） */
export function unlinkPatientLine(id: string, version: number, by?: Actor): Patient {
  const st = state();
  const cur = st.patients.get(id);
  if (!cur) throw new StoreError("not_found", "患者が見つかりません");
  if (cur.version !== version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  if (!cur.lineUserId) return cur;
  const now = new Date().toISOString();
  const next = dropUndefined({ ...cur, lineUserId: undefined, version: cur.version + 1, updatedAt: now });
  st.patients.set(id, next);
  recordChange(id, ["LINE紐付けの解除"], now, by);
  return next;
}

/**
 * 患者の変更履歴に残す。auditAction を渡すと、操作ログにはその文言を使う
 * （履歴の文言に氏名や自由記載が入る場合、操作ログには患者情報を残さないため）
 */
function recordChange(id: string, fields: string[], at: string, by?: Actor, auditAction?: string) {
  const st = state();
  const list = st.patientHistory.get(id) ?? [];
  list.unshift({ at, fields, ...(by && { by }) });
  if (by) audit(by, auditAction ?? `患者情報を変更（${fields.join("・")}）`, id);
  st.patientHistory.set(id, list.slice(0, 100));
}

function dropUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const noteKey = (patientId: string, date: string) => `${patientId}|${date}`;

/**
 * デモ用：施術歴が見えるよう、過去26週と今後8週の水曜日（美容の診療日）の予約を作り、
 * 過去の来院に架空のメモとスキンケアを付ける。
 */
function ensureHistorySeeded(): void {
  if (!demoEnabled()) return;
  const st = state();
  if (st.historySeeded) return;
  transaction(() => seedDemoHistory());
}

function seedDemoHistory(): void {
  const st = state();
  st.historySeeded = true;
  setMeta("historySeeded", true);
  const today = nowInClinic().date;
  const dates: string[] = [];
  for (let d = addDays(today, -182); d <= addDays(today, 56); d = addDays(d, 1)) {
    if (weekdayOf(d) === 3) dates.push(d);
  }
  dates.forEach(ensureSeeded);

  const menuName = (id: string) => st.menus.get(id)?.name ?? "";
  const skincareNow = new Map<string, string[]>();
  const byPatientDate = new Map<string, Reservation[]>();
  for (const r of st.reservations.values()) {
    const date = clinicDateOf(r.startAt);
    if (date >= today || INACTIVE_STATUSES.has(r.status)) continue;
    const k = noteKey(r.patientId, date);
    byPatientDate.set(k, [...(byPatientDate.get(k) ?? []), r]);
  }
  const at = new Date().toISOString();
  for (const k of [...byPatientDate.keys()].sort((a, b) => a.split("|")[1].localeCompare(b.split("|")[1]))) {
    const [patientId, date] = k.split("|");
    const rnd = demoRandom(demoHash(k));
    if (rnd() < 0.3) continue; // 記録のない日もある
    const prev = skincareNow.get(patientId) ?? [];
    const skincare = rnd() < 0.6 ? demoNextSkincare(prev, rnd) : prev;
    skincareNow.set(patientId, skincare);
    const menus = byPatientDate.get(k)!.flatMap((r) => r.menuIds.map(menuName));
    st.visitNotes.set(k, { patientId, date, note: demoVisitNote(menus, rnd), skincare, version: 1, updatedAt: at });
  }
}

function reservationSummary(r: Reservation): VisitRow["reservations"][number] {
  const st = state();
  return {
    id: r.id,
    startAt: r.startAt,
    endAt: r.endAt,
    status: r.status,
    menuNames: r.menuIds.map((mid) => st.menus.get(mid)?.name ?? ""),
    laneName: st.lanes.get(r.laneId)?.name ?? "",
    laneId: r.laneId,
    version: r.version,
    menuIds: r.menuIds,
    stageLabel: stageLabelOf(r),
    ...(r.memo && { memo: r.memo }),
    ...(r.requestId && { requestId: r.requestId }),
  };
}

export function getPatientDetail(id: string): PatientDetail {
  ensureHistorySeeded();
  const st = state();
  const patient = st.patients.get(id);
  if (!patient) throw new StoreError("not_found", "患者が見つかりません");
  const today = nowInClinic().date;

  const mine = [...st.reservations.values()]
    .filter((r) => r.patientId === id)
    .sort(byStart);

  const rows = new Map<string, VisitRow>();
  const row = (date: string) => {
    let v = rows.get(date);
    if (!v) {
      v = { date, reservations: [], note: "", skincare: [], files: [], noteVersion: 0 };
      rows.set(date, v);
    }
    return v;
  };
  for (const r of mine) {
    const date = clinicDateOf(r.startAt);
    if (date <= today) row(date).reservations.push(reservationSummary(r));
  }
  for (const n of st.visitNotes.values()) {
    if (n.patientId !== id) continue;
    Object.assign(row(n.date), {
      note: n.note,
      skincare: n.skincare,
      noteVersion: n.version,
      noteUpdatedAt: n.updatedAt,
      ...(n.updatedBy && { noteUpdatedBy: n.updatedBy }),
    });
  }
  for (const f of listFiles(id)) if (f.date <= today) row(f.date).files.push(f);
  const visits = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = mine.filter((r) => clinicDateOf(r.startAt) > today).map(reservationSummary);

  const used = new Set<string>();
  for (const v of visits) v.skincare.forEach((x) => used.add(x));
  const skincareSuggestions = [...used, ...DEFAULT_SKINCARE_CATALOG.filter((x) => !used.has(x))];

  return {
    patient,
    visits,
    upcoming,
    skincareSuggestions,
    products: sortedProducts().filter((p) => p.active),
    menuInfo: Object.fromEntries([...st.menus.values()].map((m) => [m.id, { name: m.name, color: m.color }])),
    history: st.patientHistory.get(id) ?? [],
    duplicates: patient.deleted ? [] : findDuplicates(patient),
  };
}

export interface VisitNoteInput {
  note: string;
  skincare: string[];
  /** 画面が持っている版。新しく書く日は 0 */
  version: number;
}

/** 来院日ごとの記録（簡易カルテ・スキンケア）を保存する */
export function saveVisitNote(patientId: string, date: string, input: VisitNoteInput, by?: Actor): VisitNote | null {
  ensureHistorySeeded();
  const st = state();
  const owner = st.patients.get(patientId);
  if (!owner) throw new StoreError("not_found", "患者が見つかりません");
  if (owner.deleted) throw new StoreError("invalid", "削除された患者には記録できません。先に復元してください");
  if (!isDateString(date) || date > nowInClinic().date) {
    throw new StoreError("invalid", "記録できるのは今日までの日付です");
  }
  const key = noteKey(patientId, date);
  const cur = st.visitNotes.get(key);
  if ((cur?.version ?? 0) !== input.version) {
    throw new StoreError("version_conflict", "他の端末で先にこの日の記録が更新されました。画面を開き直してください");
  }
  const note = checkNote("メモ", input.note, 16000);
  const skincare = [...new Set(input.skincare.map((x) => checkText("スキンケア", x, 60, false)).filter(Boolean))];
  if (skincare.length > 20) throw new StoreError("invalid", "スキンケアは20件までです");
  const at = new Date().toISOString();
  const label = `施術メモ・スキンケア（${formatDateJa(date)}）`;
  if (!note && skincare.length === 0) {
    if (cur) {
      st.visitNotes.delete(key);
      recordChange(patientId, [`${label}の削除`], at, by);
    }
    return null;
  }
  const next: VisitNote = {
    patientId,
    date,
    note,
    skincare,
    version: (cur?.version ?? 0) + 1,
    updatedAt: at,
    ...(by && { updatedBy: by }),
  };
  st.visitNotes.set(key, next);
  recordChange(patientId, [label], at, by);
  return next;
}

// ---- レーンの設定 ----

export interface LaneInput {
  name?: string;
  shortName?: string;
  active?: boolean;
}

/** 今日以降の有効な予約があるレーンは非表示にできない */
function futureReservationCount(laneId: string): number {
  const today = nowInClinic().date;
  let n = 0;
  for (const r of state().reservations.values()) {
    if (r.laneId === laneId && !INACTIVE_STATUSES.has(r.status) && clinicDateOf(r.startAt) >= today) n++;
  }
  return n;
}

/** 表示できるレーンの数（最小1・最大30） */
export const MIN_ACTIVE_LANES = 1;
export const MAX_ACTIVE_LANES = 30;
/** 非表示を含めて登録できるレーンの数 */
const MAX_TOTAL_LANES = 100;

const activeLaneCount = () => [...state().lanes.values()].filter((l) => l.active).length;

export function createLane(input: LaneInput, by?: Actor): Lane {
  const st = state();
  if (activeLaneCount() >= MAX_ACTIVE_LANES) {
    throw new StoreError("invalid", `表示できるレーンは最大${MAX_ACTIVE_LANES}までです。使わないレーンを非表示か削除にしてください`);
  }
  if (st.lanes.size >= MAX_TOTAL_LANES) throw new StoreError("invalid", "登録できるレーンの数を超えています。使わないレーンを削除してください");
  const name = checkText("レーン名", input.name ?? "", 40, true);
  const shortName = checkText("短い名前", input.shortName ?? "", 12, false) || name.slice(0, 6);
  const lane: Lane = {
    id: `lane-${Date.now().toString(36)}-${++st.seq}`,
    name,
    shortName,
    order: Math.max(-1, ...[...st.lanes.values()].map((l) => l.order)) + 1,
    active: true,
  };
  st.lanes.set(lane.id, lane);
  if (by) audit(by, "レーンを追加", lane.id);
  snapshotSettings();
  return lane;
}

export function updateLane(id: string, input: LaneInput, by?: Actor): Lane {
  const st = state();
  const cur = st.lanes.get(id);
  if (!cur) throw new StoreError("not_found", "レーンが見つかりません");
  const next: Lane = { ...cur };
  if (input.name !== undefined) next.name = checkText("レーン名", input.name, 40, true);
  if (input.shortName !== undefined) next.shortName = checkText("短い名前", input.shortName, 12, false) || next.name.slice(0, 6);
  if (input.active === false && cur.active) {
    const n = futureReservationCount(id);
    if (n > 0) {
      throw new StoreError("invalid", `このレーンには今日以降の予約が${n}件あります。別のレーンへ移してから非表示にしてください`);
    }
    if (activeLaneCount() <= MIN_ACTIVE_LANES) {
      throw new StoreError("invalid", `表示するレーンは${MIN_ACTIVE_LANES}つ以上必要です`);
    }
  }
  if (input.active === true && !cur.active && activeLaneCount() >= MAX_ACTIVE_LANES) {
    throw new StoreError("invalid", `表示できるレーンは最大${MAX_ACTIVE_LANES}までです`);
  }
  if (input.active !== undefined) next.active = input.active;
  st.lanes.set(id, next);
  if (by) audit(by, "レーンを変更", id);
  snapshotSettings();
  return next;
}

/**
 * レーンを完全に削除する。予約の記録が1件でもあるレーンは、過去の予約の表示のために削除できない
 * （その場合は非表示にする）。メニューの「行えるレーン」からも外す
 */
function deleteLaneImpl(id: string, by?: Actor): void {
  const st = state();
  const cur = st.lanes.get(id);
  if (!cur) throw new StoreError("not_found", "レーンが見つかりません");
  const used = [...st.reservations.values()].some((r) => r.laneId === id);
  if (used) throw new StoreError("invalid", "このレーンには予約の記録があるため削除できません。使わない場合は非表示にしてください");
  if (cur.active && activeLaneCount() <= MIN_ACTIVE_LANES) {
    throw new StoreError("invalid", `表示するレーンは${MIN_ACTIVE_LANES}つ以上必要です`);
  }
  st.lanes.delete(id);
  for (const m of st.menus.values()) {
    if (m.laneIds.includes(id)) st.menus.set(m.id, { ...m, laneIds: m.laneIds.filter((x) => x !== id) });
  }
  sortedLanes().forEach((l, i) => st.lanes.set(l.id, { ...l, order: i }));
  if (by) audit(by, "レーンを削除", id);
  snapshotSettings();
}

/** 並び順をまとめて変更（ids の順に並べる） */
function reorderLanesImpl(ids: string[], by?: Actor): Lane[] {
  const st = state();
  if (ids.length !== st.lanes.size || !ids.every((id) => st.lanes.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.lanes.set(id, { ...st.lanes.get(id)!, order: i }));
  if (by) audit(by, "レーンを並べ替え");
  snapshotSettings();
  return sortedLanes();
}

// ---- メニューの設定 ----

export type MenuInput = Partial<Omit<Menu, "id" | "order">>;

function validateMenu(m: Menu): Menu {
  const name = checkText("メニュー名", m.name, 80, true);
  const abbr = checkText("略称", m.abbr, 12, false) || name.slice(0, 6);
  const d = m.duration;
  const ok =
    d.kind === "fixed"
      ? d.minutes >= 5 && d.minutes <= 720 && d.minutes % 5 === 0
      : d.min >= 5 && d.max <= 720 && d.min <= d.max && d.step >= 5 && d.step % 5 === 0;
  if (!ok) throw new StoreError("invalid", "提供時間の設定が正しくありません（5分単位）");
  const lo = d.kind === "fixed" ? d.minutes : d.min;
  const hi = d.kind === "fixed" ? d.minutes : d.max;
  const defaultMinutes = Math.min(hi, Math.max(lo, m.defaultMinutes));
  if (!/^#[0-9a-fA-F]{6}$/.test(m.color)) throw new StoreError("invalid", "色の指定が正しくありません");
  if (m.priceYen !== null && !(Number.isInteger(m.priceYen) && m.priceYen >= 0 && m.priceYen <= 10_000_000)) {
    throw new StoreError("invalid", "料金の指定が正しくありません");
  }
  if (m.capacity !== null && !(Number.isInteger(m.capacity) && m.capacity >= 1 && m.capacity <= 99)) {
    throw new StoreError("invalid", "同時予約数の指定が正しくありません");
  }
  if (![5, 10, 15, 20, 30, 60].includes(m.startStepMin)) throw new StoreError("invalid", "開始時間の刻みが正しくありません");
  const laneIds = [...new Set(m.laneIds)];
  if (!laneIds.every(laneExists)) throw new StoreError("invalid", "レーンが見つかりません");
  return { ...m, name, abbr, defaultMinutes, laneIds };
}

export function createMenu(input: MenuInput, by?: Actor): Menu {
  const st = state();
  const menu = validateMenu({
    id: `menu-${Date.now().toString(36)}-${++st.seq}`,
    name: input.name ?? "",
    abbr: input.abbr ?? "",
    duration: input.duration ?? { kind: "fixed", minutes: 15 },
    defaultMinutes: input.defaultMinutes ?? 15,
    startStepMin: input.startStepMin ?? 5,
    priceYen: input.priceYen ?? null,
    capacity: input.capacity ?? null,
    laneIds: input.laneIds ?? [],
    color: input.color ?? "#64748b",
    order: Math.max(-1, ...[...st.menus.values()].map((m) => m.order)) + 1,
    active: input.active ?? true,
  });
  st.menus.set(menu.id, menu);
  if (by) audit(by, "メニューを追加", menu.id);
  snapshotSettings();
  return menu;
}

export function updateMenu(id: string, input: MenuInput, by?: Actor): Menu {
  const st = state();
  const cur = st.menus.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "メニューが見つかりません");
  const next = validateMenu({ ...cur, ...input, id: cur.id, order: cur.order });
  st.menus.set(id, next);
  if (by) audit(by, "メニューを変更", id);
  snapshotSettings();
  return next;
}

/** メニューの削除：予約の選択肢・設定の一覧から消す（過去の予約・見積の表示のため記録は残す） */
export function deleteMenu(id: string, by?: Actor): void {
  const st = state();
  const cur = st.menus.get(id);
  if (!cur || cur.deleted) throw new StoreError("not_found", "メニューが見つかりません");
  st.menus.set(id, { ...cur, active: false, deleted: true });
  if (by) audit(by, "メニューを削除", id);
  snapshotSettings();
}

function reorderMenusImpl(ids: string[], by?: Actor): Menu[] {
  const st = state();
  if (ids.length !== st.menus.size || !ids.every((id) => st.menus.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.menus.set(id, { ...st.menus.get(id)!, order: i }));
  if (by) audit(by, "メニューを並べ替え");
  snapshotSettings();
  return sortedMenus();
}

// ---- 患者の削除（論理削除）・復元・統合 ----

function digits(s?: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** 重複の可能性：フリガナ・氏名・電話番号・生年月日＋フリガナの一致 */
/**
 * 統合してよいかの確認：姓名・セイメイ（フリガナ）・生年月日がすべて一致すること。
 * ただし生年月日が両方とも未入力なら、姓名とセイメイの一致で統合してよい（院長の決定。Airリザーブには生年月日がほぼ無いため）。
 * 表記の揺れ（空白・全角半角・ひらがな／カタカナ）は同じとみなす。一致しない項目を返す
 */
export function identityMismatch(a: Patient, b: Patient): string[] {
  const out: string[] = [];
  const same = (x?: string, y?: string) => !!x && !!y && searchKey(x) === searchKey(y);
  if (!same(a.name, b.name)) out.push("姓名");
  if (!a.kana || !b.kana) out.push("セイメイ（未入力）");
  else if (!same(a.kana, b.kana)) out.push("セイメイ");
  if (!a.birthDate && !b.birthDate) return out;
  if (!a.birthDate || !b.birthDate) out.push("生年月日（片方だけ未入力）");
  else if (a.birthDate !== b.birthDate) out.push("生年月日");
  return out;
}

export function findDuplicates(p: Patient): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const kana = searchKey(p.kana ?? "");
  const name = searchKey(p.name);
  const phone = digits(p.phone);
  for (const o of state().patients.values()) {
    if (o.id === p.id || o.deleted) continue;
    const reasons: string[] = [];
    if (name && searchKey(o.name) === name) reasons.push("氏名が同じ");
    else if (kana && searchKey(o.kana ?? "") === kana) reasons.push("フリガナが同じ");
    if (phone.length >= 8 && digits(o.phone) === phone) reasons.push("電話番号が同じ");
    if (p.m3ChartNo && o.m3ChartNo === p.m3ChartNo) reasons.push("M3カルテ番号が同じ");
    if (p.birthDate && o.birthDate === p.birthDate && reasons.length > 0) reasons.push("生年月日が同じ");
    if (reasons.length > 0) {
      const mismatch = identityMismatch(p, o);
      out.push({ patient: o, reasons, identical: mismatch.length === 0, mismatch });
    }
    if (out.length >= 5) break;
  }
  return out;
}

function futureActiveReservations(patientId: string): number {
  const today = nowInClinic().date;
  let n = 0;
  for (const r of state().reservations.values()) {
    if (r.patientId === patientId && !INACTIVE_STATUSES.has(r.status) && clinicDateOf(r.startAt) >= today) n++;
  }
  return n;
}

export function deletePatient(id: string, input: { version: number; reason: string }, by?: Actor): Patient {
  const st = state();
  const cur = st.patients.get(id);
  if (!cur) throw new StoreError("not_found", "患者が見つかりません");
  if (cur.deleted) throw new StoreError("invalid", "この患者は既に削除されています");
  if (cur.version !== input.version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  const reason = checkText("削除の理由", input.reason, 100, true);
  const n = futureActiveReservations(id);
  if (n > 0) throw new StoreError("invalid", `今日以降の予約が${n}件あります。予約をキャンセルするか、重複なら統合してください`);
  const at = new Date().toISOString();
  const next: Patient = { ...cur, deleted: { at, reason, ...(by && { by }) }, version: cur.version + 1, updatedAt: at };
  st.patients.set(id, next);
  recordChange(id, [`削除（${reason}）`], at, by, "患者を削除");
  return next;
}

export function restorePatient(id: string, version: number, by?: Actor): Patient {
  const st = state();
  const cur = st.patients.get(id);
  if (!cur) throw new StoreError("not_found", "患者が見つかりません");
  if (!cur.deleted) return cur;
  if (cur.mergedInto) throw new StoreError("invalid", "統合された患者は復元できません");
  if (cur.version !== version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  for (const p of st.patients.values()) {
    if (p.id !== id && !p.deleted && cur.chartNo !== "" && p.chartNo === cur.chartNo) {
      throw new StoreError("invalid", "同じ診察券番号の患者がいるため復元できません");
    }
  }
  const at = new Date().toISOString();
  const next = dropUndefined({ ...cur, deleted: undefined, version: cur.version + 1, updatedAt: at });
  st.patients.set(id, next);
  recordChange(id, ["削除からの復元"], at, by, "患者を削除から復元");
  return next;
}

const FILLABLE: (keyof Patient)[] = ["kana", "nameAlt", "phone", "email", "postalCode", "address", "sex", "birthDate", "m3ChartNo"];

function mergeTargets(keepId: string, dupId: string): { keep: Patient; dup: Patient } {
  const st = state();
  if (keepId === dupId) throw new StoreError("invalid", "同じ患者どうしは統合できません");
  const keep = st.patients.get(keepId);
  const dup = st.patients.get(dupId);
  if (!keep || !dup) throw new StoreError("not_found", "患者が見つかりません");
  if (keep.deleted || dup.deleted) throw new StoreError("invalid", "削除された患者は統合できません");
  return { keep, dup };
}

export function previewMerge(keepId: string, dupId: string): MergePreview {
  ensureHistorySeeded();
  const st = state();
  const { keep, dup } = mergeTargets(keepId, dupId);
  const keepDates = new Set([...st.visitNotes.values()].filter((n) => n.patientId === keepId).map((n) => n.date));
  const dupNotes = [...st.visitNotes.values()].filter((n) => n.patientId === dupId);
  return {
    keep,
    dup,
    reservations: [...st.reservations.values()].filter((r) => r.patientId === dupId).length,
    visitNotes: dupNotes.length,
    sameDayNotes: dupNotes.filter((n) => keepDates.has(n.date)).map((n) => n.date).sort(),
    filledFields: FILLABLE.filter((k) => !keep[k] && dup[k]).map((k) => FIELD_LABEL[k] ?? k),
    lineConflict: !!keep.lineUserId && !!dup.lineUserId && keep.lineUserId !== dup.lineUserId,
    identical: identityMismatch(keep, dup).length === 0,
    mismatch: identityMismatch(keep, dup),
  };
}

/**
 * 重複して登録した患者 dup を keep にまとめる。
 * - 予約と日付ごとの記録を keep へ移す（同じ日に両方の記録があればメモをつなげ、スキンケアを合わせる）
 * - keep の空欄は dup の値で埋める。注意事項とメモはつなげる
 * - dup は削除扱い（mergedInto に keep）にして残す
 */
function mergePatientsImpl(
  input: { keepId: string; dupId: string; keepVersion: number; dupVersion: number },
  by?: Actor,
): Patient {
  ensureHistorySeeded();
  const st = state();
  const { keep, dup } = mergeTargets(input.keepId, input.dupId);
  if (keep.version !== input.keepVersion || dup.version !== input.dupVersion) {
    throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  }
  const mismatch = identityMismatch(keep, dup);
  if (mismatch.length > 0) {
    throw new StoreError("invalid", `姓名・セイメイ・生年月日がすべて一致する患者だけ統合できます（一致しない項目：${mismatch.join("・")}）`);
  }
  const at = new Date().toISOString();
  const preview = previewMerge(keep.id, dup.id);

  // 予約を移す
  for (const r of [...st.reservations.values()]) {
    if (r.patientId !== dup.id) continue;
    st.reservations.set(r.id, { ...r, patientId: keep.id, version: r.version + 1, updatedAt: at, ...(by && { updatedBy: by }) });
  }
  // 日付ごとの記録を移す
  for (const n of [...st.visitNotes.values()]) {
    if (n.patientId !== dup.id) continue;
    st.visitNotes.delete(noteKey(dup.id, n.date));
    const k = noteKey(keep.id, n.date);
    const mine = st.visitNotes.get(k);
    const merged: VisitNote = mine
      ? {
          ...mine,
          note: [mine.note, n.note && `（統合元 診察券${dup.chartNo}の記録）\n${n.note}`].filter(Boolean).join("\n"),
          skincare: [...new Set([...mine.skincare, ...n.skincare])],
          version: mine.version + 1,
          updatedAt: at,
          ...(by && { updatedBy: by }),
        }
      : { ...n, patientId: keep.id, version: n.version + 1, updatedAt: at };
    st.visitNotes.set(k, merged);
  }
  // 写真・同意書などのファイルと見積書を移す
  for (const f of [...st.files.values()]) {
    if (f.patientId === dup.id) st.files.set(f.id, { ...f, patientId: keep.id });
  }
  for (const c of [...st.consents.values()]) {
    if (c.patientId === dup.id) st.consents.set(c.id, { ...c, patientId: keep.id });
  }
  for (const e of [...st.estimates.values()]) {
    if (e.patientId === dup.id) st.estimates.set(e.id, { ...e, patientId: keep.id, version: e.version + 1, updatedAt: at, ...(by && { updatedBy: by }) });
  }
  for (const q of [...st.questionnaires.values()]) {
    if (q.patientId === dup.id) st.questionnaires.set(q.id, { ...q, patientId: keep.id });
  }
  for (const c of [...st.charts.values()]) {
    if (c.patientId === dup.id) st.charts.set(c.id, { ...c, patientId: keep.id, version: c.version + 1, updatedAt: at, ...(by && { updatedBy: by }) });
  }
  // 患者情報：空欄を埋め、注意事項・メモはつなげる
  const next: Patient = { ...keep };
  for (const f of FILLABLE) if (!next[f] && dup[f]) (next as unknown as Record<string, unknown>)[f] = dup[f];
  if (!next.nameAlt && searchKey(dup.name) !== searchKey(keep.name)) next.nameAlt = dup.name;
  if (!next.lineUserId && dup.lineUserId) next.lineUserId = dup.lineUserId;
  next.caution = keep.caution || dup.caution || undefined;
  next.cautionNote = [keep.cautionNote, dup.cautionNote].filter(Boolean).join("\n") || undefined;
  next.memo = [keep.memo, dup.memo && `（統合元 診察券${dup.chartNo}）${dup.memo}`].filter(Boolean).join("\n") || undefined;
  next.history = [keep.history, dup.history].filter(Boolean).join("\n") || undefined;
  next.medications = [keep.medications, dup.medications].filter(Boolean).join("\n") || undefined;
  next.questionnaireOther = [keep.questionnaireOther, dup.questionnaireOther].filter(Boolean).join("\n\n") || undefined;
  next.version = keep.version + 1;
  next.updatedAt = at;
  st.patients.set(keep.id, dropUndefined(next));

  st.patients.set(dup.id, {
    ...dup,
    // LINEの紐付けは統合先へ移した（または統合先のものを残した）ので外す
    lineUserId: undefined,
    deleted: { at, reason: `重複のため 診察券${keep.chartNo}（${keep.name}）に統合`, ...(by && { by }) },
    mergedInto: keep.id,
    version: dup.version + 1,
    updatedAt: at,
  });

  const detail = [
    `予約${preview.reservations}件`,
    `記録${preview.visitNotes}日分`,
    preview.filledFields.length ? `空欄を補完（${preview.filledFields.join("・")}）` : null,
    preview.lineConflict ? "LINEは統合先の紐付けを残した" : null,
  ].filter(Boolean);
  recordChange(keep.id, [`診察券${dup.chartNo}（${dup.name}）を統合：${detail.join("、")}`], at, by, `重複患者を統合（統合元 ${dup.id}）`);
  recordChange(dup.id, [`診察券${keep.chartNo}（${keep.name}）へ統合`], at, by, `統合先へまとめた（統合先 ${keep.id}）`);
  return st.patients.get(keep.id)!;
}

/** 複数の記録をまとめて変更するため、途中で失敗したら全部取り消す */
export function mergePatients(...args: Parameters<typeof mergePatientsImpl>): ReturnType<typeof mergePatientsImpl> {
  return transaction(() => mergePatientsImpl(...args));
}

/** 複数の記録をまとめて変更するため、途中で失敗したら全部取り消す */
export function reorderLanes(...args: Parameters<typeof reorderLanesImpl>): ReturnType<typeof reorderLanesImpl> {
  return transaction(() => reorderLanesImpl(...args));
}

/** 複数の記録をまとめて変更するため、途中で失敗したら全部取り消す */
export function reorderMenus(...args: Parameters<typeof reorderMenusImpl>): ReturnType<typeof reorderMenusImpl> {
  return transaction(() => reorderMenusImpl(...args));
}

/** 複数の記録をまとめて変更するため、途中で失敗したら全部取り消す */
export function deleteLane(...args: Parameters<typeof deleteLaneImpl>): ReturnType<typeof deleteLaneImpl> {
  return transaction(() => deleteLaneImpl(...args));
}

// ---- 見積書 ----

const MAX_ESTIMATE_YEN = 100_000_000;

/** 見積の行を確かめて整える（メニュー・スキンケアは登録にあるものだけ） */
function checkEstimateLines(lines: EstimateLine[]): EstimateLine[] {
  const st = state();
  return lines.map((l) => {
    if (l.kind === "menu" && (!l.refId || !st.menus.has(l.refId))) throw new StoreError("invalid", "メニューが見つかりません");
    if (l.kind === "product" && (!l.refId || !st.products.has(l.refId))) throw new StoreError("invalid", "スキンケア＆内服が見つかりません");
    const name = checkText("項目名", l.name, 120, true);
    return { kind: l.kind, ...(l.kind !== "custom" && { refId: l.refId }), name, unitYen: l.unitYen, qty: l.qty };
  });
}

function estimateTotal(lines: EstimateLine[]): number {
  const total = lines.reduce((sum, l) => sum + l.unitYen * l.qty, 0);
  if (total < 0) throw new StoreError("invalid", "合計がマイナスになっています（割引が大きすぎます）");
  if (total > MAX_ESTIMATE_YEN) throw new StoreError("invalid", "合計が大きすぎます");
  return total;
}

function checkEstimateDates(date: string, validUntil: string): void {
  if (validUntil < date) throw new StoreError("invalid", "有効期限は発行日より後にしてください");
}

export function listEstimates(patientId: string): Estimate[] {
  return [...state().estimates.values()]
    .filter((e) => e.patientId === patientId && !e.deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
}

function liveEstimate(id: string): Estimate {
  const e = state().estimates.get(id);
  if (!e || e.deleted) throw new StoreError("not_found", "見積書が見つかりません");
  return e;
}

/** 印刷用：見積書と、書類に載せる患者・院の情報 */
export function getEstimateView(id: string): EstimateView {
  const e = liveEstimate(id);
  const p = state().patients.get(e.patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  return {
    estimate: e,
    patient: dropUndefined({ id: p.id, name: p.name, kana: p.kana, chartNo: p.chartNo, birthDate: p.birthDate }),
    clinic: getClinic(),
  };
}

export interface EstimateInput {
  reservationId?: string;
  date?: string;
  validUntil?: string;
  lines: EstimateLine[];
  note?: string;
}

function createEstimateImpl(patientId: string, input: EstimateInput, by?: Actor): Estimate {
  const st = state();
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  if (p.deleted) throw new StoreError("invalid", "削除された患者には見積書を作れません");
  if (input.reservationId) {
    const r = st.reservations.get(input.reservationId);
    if (!r || r.patientId !== patientId) throw new StoreError("invalid", "予約が見つかりません");
  }
  const date = input.date ?? nowInClinic().date;
  const validUntil = input.validUntil ?? addDays(date, getClinic().estimateValidDays ?? DEFAULT_ESTIMATE_VALID_DAYS);
  checkEstimateDates(date, validUntil);
  const lines = checkEstimateLines(input.lines);
  const note = input.note !== undefined ? checkNote("備考", input.note, 1000) : "";
  // 見積番号は発行年ごとの通し番号
  const year = date.slice(0, 4);
  const seqs = getMeta<Record<string, number>>("estimateSeq") ?? {};
  const n = (seqs[year] ?? 0) + 1;
  setMeta("estimateSeq", { ...seqs, [year]: n });
  const e: Estimate = {
    id: `est-${Date.now().toString(36)}-${randomId()}`,
    no: `${year}-${String(n).padStart(4, "0")}`,
    patientId,
    ...(input.reservationId && { reservationId: input.reservationId }),
    date,
    validUntil,
    lines,
    totalYen: estimateTotal(lines),
    ...(note && { note }),
    createdAt: new Date().toISOString(),
    ...(by && { createdBy: by }),
    version: 1,
  };
  st.estimates.set(e.id, e);
  if (by) audit(by, `見積書を作成（No.${e.no}）`, patientId);
  return e;
}

export function createEstimate(...args: Parameters<typeof createEstimateImpl>): Estimate {
  return transaction(() => createEstimateImpl(...args));
}

export function updateEstimate(
  id: string,
  input: { version: number; date?: string; validUntil?: string; lines?: EstimateLine[]; note?: string },
  by?: Actor,
): Estimate {
  const st = state();
  const cur = liveEstimate(id);
  if (cur.version !== input.version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  const next: Estimate = { ...cur };
  if (input.date !== undefined) next.date = input.date;
  if (input.validUntil !== undefined) next.validUntil = input.validUntil;
  checkEstimateDates(next.date, next.validUntil);
  if (input.lines !== undefined) {
    next.lines = checkEstimateLines(input.lines);
    next.totalYen = estimateTotal(next.lines);
  }
  if (input.note !== undefined) {
    const note = checkNote("備考", input.note, 1000);
    if (note) next.note = note;
    else delete next.note;
  }
  next.version = cur.version + 1;
  next.updatedAt = new Date().toISOString();
  if (by) next.updatedBy = by;
  st.estimates.set(id, next);
  if (by) audit(by, `見積書を変更（No.${next.no}）`, next.patientId);
  return next;
}

export function deleteEstimate(id: string, input: { version: number }, by?: Actor): Estimate {
  const st = state();
  const cur = liveEstimate(id);
  if (cur.version !== input.version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  const next: Estimate = { ...cur, deleted: { at: new Date().toISOString(), ...(by && { by }) }, version: cur.version + 1 };
  st.estimates.set(id, next);
  if (by) audit(by, `見積書を削除（No.${cur.no}）`, cur.patientId);
  return next;
}

// ---- 問診票（Googleフォームなどから。患者の情報はこちらからは送らない） ----

const FORBIDDEN_ALL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const FORBIDDEN_EXCEPT_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export interface QuestionnaireInput {
  key: string;
  submittedAt: string;
  name: string;
  kana?: string;
  birthDate?: string;
  phone?: string;
  history?: string;
  medications?: string;
  allergies?: string;
  answers: { q: string; a: string }[];
}

/**
 * 回答を患者に結びつける：氏名（またはフリガナ）が合い、さらに生年月日か電話番号（10桁以上）が合う患者が
 * ちょうど1人のときだけ。迷うときは結びつけない（取り違え防止）
 */
function matchQuestionnaire(r: { name: string; kana?: string; birthDate?: string; phone?: string }): string | undefined {
  const keys = new Set([searchKey(r.name), searchKey(r.kana ?? "")].filter(Boolean));
  if (keys.size === 0) return undefined;
  const tel = digits(r.phone);
  const hits = [...state().patients.values()].filter((p) => {
    if (p.deleted) return false;
    const nameHit = [p.name, p.kana, p.nameAlt].some((x) => x && keys.has(searchKey(x)));
    if (!nameHit) return false;
    return (!!r.birthDate && p.birthDate === r.birthDate) || (tel.length >= 10 && digits(p.phone) === tel);
  });
  return hits.length === 1 ? hits[0].id : undefined;
}

function receiveQuestionnairesImpl(responses: QuestionnaireInput[]): { received: number; matched: number; unmatched: number; duplicates: number } {
  const st = state();
  const known = new Set([...st.questionnaires.values()].map((q) => q.key));
  const out = { received: 0, matched: 0, unmatched: 0, duplicates: 0 };
  for (const r of responses) {
    const key = r.key.trim();
    if (known.has(key)) {
      out.duplicates++;
      continue;
    }
    known.add(key);
    // 外から来た文字は、使えない文字を外して長さをそろえる（1件のせいで全部が取り込めなくならないように）
    const line = (v: string | undefined, max: number) => cleanName((v ?? "").replace(FORBIDDEN_ALL, " ")).slice(0, max).trim();
    const block = (v: string | undefined, max: number) =>
      (v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(FORBIDDEN_EXCEPT_NL, "").trim().slice(0, max).trim();
    const birthDate = r.birthDate && isDateString(r.birthDate) ? r.birthDate : undefined;
    const base = {
      name: line(r.name, 60) || "（氏名なし）",
      kana: line(r.kana, 60),
      phone: line(r.phone, 30),
      history: block(r.history, 2000),
      medications: block(r.medications, 2000),
      allergies: block(r.allergies, 2000),
    };
    const patientId = matchQuestionnaire({ ...base, birthDate });
    const q: Questionnaire = dropUndefined({
      id: `qn-${Date.now().toString(36)}-${randomId()}`,
      key,
      ...(patientId && { patientId }),
      submittedAt: line(r.submittedAt, 40),
      name: base.name,
      kana: base.kana || undefined,
      birthDate,
      phone: base.phone || undefined,
      history: base.history || undefined,
      medications: base.medications || undefined,
      allergies: base.allergies || undefined,
      answers: r.answers
        .map((x) => ({ q: line(x.q, 200), a: block(x.a, 2000) }))
        .filter((x) => x.q && x.a),
      receivedAt: new Date().toISOString(),
    });
    st.questionnaires.set(q.id, q);
    if (patientId) fillPatientFromQuestionnaire(patientId, q);
    out.received++;
    if (patientId) out.matched++;
    else out.unmatched++;
  }
  return out;
}

export function receiveQuestionnaires(...args: Parameters<typeof receiveQuestionnairesImpl>): ReturnType<typeof receiveQuestionnairesImpl> {
  return transaction(() => receiveQuestionnairesImpl(...args));
}

const byNewest = (a: Questionnaire, b: Questionnaire) => b.submittedAt.localeCompare(a.submittedAt) || b.receivedAt.localeCompare(a.receivedAt);

export function listQuestionnaires(patientId: string): Questionnaire[] {
  return [...state().questionnaires.values()].filter((q) => q.patientId === patientId && !q.deleted).sort(byNewest);
}

/** 患者が見つからなかった回答（新しい順） */
export function listUnmatchedQuestionnaires(): Questionnaire[] {
  return [...state().questionnaires.values()].filter((q) => !q.patientId && !q.deleted).sort(byNewest);
}

function liveQuestionnaire(id: string): Questionnaire {
  const q = state().questionnaires.get(id);
  if (!q || q.deleted) throw new StoreError("not_found", "問診票が見つかりません");
  return q;
}

/** 回答を、診察券番号で選んだ患者に結びつける */
export function linkQuestionnaire(id: string, chartNo: string, by?: Actor): Questionnaire {
  const st = state();
  const q = liveQuestionnaire(id);
  const no = chartNo.trim();
  const p = no === "" ? undefined : [...st.patients.values()].find((x) => !x.deleted && x.chartNo === no);
  if (!p) throw new StoreError("invalid", "その診察券番号の患者が見つかりません");
  const next: Questionnaire = { ...q, patientId: p.id, ...(by && { linkedBy: by }) };
  st.questionnaires.set(id, next);
  if (by) audit(by, "問診票を患者に結びつけ", p.id);
  fillPatientFromQuestionnaire(p.id, next);
  return next;
}

/** 結びついている問診票を、患者の空いている欄へ写し直す（写す仕組みより前に結びついた回答のため。何度実行しても重ならない） */
// ---- M3 の患者一覧との照合（漢字の氏名を補う） ----
// 7万件の CSV はブラウザの中だけで読み、ここへは「照合できた患者の番号と補う値」だけが届く

const HAS_KANJI = /\p{Script=Han}/u;
const M3_ACTOR: Actor = { id: "m3-match", name: "M3照合" };

export interface M3FillCandidate {
  id: string;
  name: string;
  kana: string;
  birthDate?: string;
  phone?: string;
  chartNo: string;
  m3ChartNo?: string;
}

/** 氏名に漢字がない患者（Airリザーブからカタカナで入った人など）の、照合に使う欄だけ */
export function m3FillCandidates(): M3FillCandidate[] {
  return [...state().patients.values()]
    .filter((p) => !p.deleted && !HAS_KANJI.test(p.name))
    .map((p) => ({ id: p.id, name: p.name, kana: p.kana, birthDate: p.birthDate, phone: p.phone, chartNo: p.chartNo, m3ChartNo: p.m3ChartNo }));
}

export interface M3FillItem {
  id: string;
  name: string;
  kana?: string;
  birthDate?: string;
  phone?: string;
  m3ChartNo?: string;
}

/**
 * 照合できた患者へ漢字の氏名を入れる。サーバーでも決まりを確かめ直す：
 * 今の氏名に漢字がなく、新しい氏名に漢字があるときだけ氏名を書き換え、ほかの欄は空のときだけ埋める。
 * もとのカタカナの氏名は、フリガナが空ならフリガナへ残す
 */
export function applyM3Fill(items: M3FillItem[], by: Actor): { updated: number; skipped: number } {
  const st = state();
  let updated = 0;
  transaction(() => {
    for (const it of items) {
      const cur = st.patients.get(it.id);
      if (!cur || cur.deleted || HAS_KANJI.test(cur.name) || !HAS_KANJI.test(it.name ?? "")) continue;
      const wanted: PatientInput = { name: it.name };
      if (!cur.kana) wanted.kana = it.kana || cur.name;
      if (!cur.birthDate && it.birthDate) wanted.birthDate = it.birthDate;
      if (!cur.phone && it.phone) wanted.phone = it.phone;
      if (!cur.m3ChartNo && it.m3ChartNo) wanted.m3ChartNo = it.m3ChartNo;
      const ok: PatientInput = {};
      for (const [k, v] of Object.entries(wanted) as [keyof PatientInput, never][]) {
        try {
          patientFields({ [k]: v }, cur.id);
          ok[k] = v;
        } catch {
          // 形の合わない値・ほかの患者と重なる番号は入れない
        }
      }
      if (!ok.name) continue;
      updatePatient(cur.id, { ...ok, version: cur.version }, M3_ACTOR);
      updated++;
    }
  });
  audit(by, `M3の患者一覧と照合して漢字の氏名を追加（${updated}名）`);
  return { updated, skipped: items.length - updated };
}

export function refillFromQuestionnaires(by: Actor): { questionnaires: number; patients: number } {
  const st = state();
  const qs = [...st.questionnaires.values()].filter((q) => q.patientId && !q.deleted).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const changed = new Set<string>();
  transaction(() => {
    for (const q of qs) {
      const before = st.patients.get(q.patientId!)?.version;
      fillPatientFromQuestionnaire(q.patientId!, q);
      if (st.patients.get(q.patientId!)?.version !== before) changed.add(q.patientId!);
    }
  });
  audit(by, `問診票を患者の基本情報へ写し直し（問診票${qs.length}件・患者${changed.size}名）`);
  return { questionnaires: qs.length, patients: changed.size };
}

// 問診票の見出しの見分け（questionnaire.gs の COLUMNS と同じ考え方）
const Q_ADDRESS = /住所/;
const Q_POSTAL = /郵便番号|〒/;
const Q_KNOWN = /性別|タイムスタンプ|timestamp|回答日時|お名前|氏名|名前|フリガナ|ふりがな|カナ|生年月日|電話|既往|病歴|治療中の病気|かかっている病気|内服|服用|飲んでいる薬|お薬|アレルギー|住所|郵便番号|〒|メール|e-?mail/i;
const Q_NONE = /^(なし|無し|ない|無い|特になし|特に無し|特にない|特にありません|ありません|いいえ|no|none|n\/a|[-ー－―]+)[。．.]?$/i;
const QUESTIONNAIRE_ACTOR: Actor = { id: "questionnaire", name: "問診票（自動取り込み）" };

/**
 * アレルギーの回答から、施術で気をつけるものだけを拾う（院長の決定）：アルコール・外用薬・内服薬（薬の名前を含む）・化粧品成分・金属。
 * 無し・動物・花粉症などは拾わない。区切りは読点・カンマ・中黒・スラッシュ・改行
 */
const ALLERGY_PICK = /アルコール|外用|内服|薬|化粧品|金属/;
function pickAllergies(v?: string): string {
  if (!v) return "";
  return v
    .split(/[、,，・\/／\n]+/)
    .map((x) => x.trim())
    .filter((x) => x && ALLERGY_PICK.test(x))
    .join("、");
}

/** 「なし」などの回答は写さない */
const answered = (v?: string) => !!v && !Q_NONE.test(v.replace(/[\s　]/g, ""));

/**
 * 結びついた問診票の回答を患者の基本情報へ写す（院長の決定：患者の欄が空のときだけ）。
 * 住所・電話 → 連絡先情報、アレルギー → 注意事項、既往歴・内服歴、どれにも当てはまらない回答 → その他の問診票情報（日付付きで足す）
 */
function fillPatientFromQuestionnaire(patientId: string, q: Questionnaire): void {
  const cur = state().patients.get(patientId);
  if (!cur || cur.deleted) return;
  const find = (re: RegExp, not?: RegExp) => q.answers.find((x) => re.test(x.q) && !(not && not.test(x.q)))?.a;
  let address = find(Q_ADDRESS, /メール|郵便/);
  let postal = find(Q_POSTAL, /メール/);
  const m = address?.match(/^〒?\s*([0-9０-９]{3}[-－ー‐]?[0-9０-９]{4})\s*/);
  if (address && m) {
    postal = postal || m[1];
    address = address.slice(m[0].length);
  }
  const wanted: PatientInput = {};
  if (!cur.phone && q.phone) wanted.phone = q.phone;
  if (!cur.birthDate && q.birthDate) wanted.birthDate = q.birthDate;
  const sexAnswer = find(/性別/);
  if (!cur.sex && sexAnswer && sexOf(sexAnswer)) wanted.sex = sexAnswer;
  if (!cur.postalCode && postal) wanted.postalCode = postal;
  if (!cur.address && answered(address)) wanted.address = address!.replace(/\s*\n\s*/g, " ");
  if (!cur.history && answered(q.history)) wanted.history = q.history;
  if (!cur.medications && answered(q.medications)) wanted.medications = q.medications;
  // アルコール・外用・内服・化粧品成分・金属だけを注意事項に出す（院長の決定）
  const allergies = pickAllergies(q.allergies);
  if (!cur.cautionNote && answered(allergies)) {
    wanted.caution = true;
    wanted.cautionNote = `アレルギー：${allergies}`.slice(0, 500);
  }
  // 以前に自動で写した「アレルギー：…」が手を加えられずに残っていれば、拾い直したものに直す
  const autoNote = `アレルギー：${q.allergies ?? ""}`.slice(0, 500);
  if (cur.cautionNote && q.allergies && cur.cautionNote === autoNote && allergies !== q.allergies) {
    if (answered(allergies)) wanted.cautionNote = `アレルギー：${allergies}`.slice(0, 500);
    else {
      wanted.cautionNote = "";
      wanted.caution = false;
    }
  }
  const other = q.answers.filter((x) => !Q_KNOWN.test(x.q) && answered(x.a)).map((x) => `${x.q}：${x.a}`);
  const block = `【問診票 ${q.submittedAt.slice(0, 10)}】\n${other.join("\n")}`;
  // 同じ回答をもう一度写しても重ならないように（写し直しの操作のため）
  if (other.length && !(cur.questionnaireOther ?? "").includes(block)) {
    wanted.questionnaireOther = (cur.questionnaireOther ? `${cur.questionnaireOther}\n\n${block}` : block).slice(0, 8000);
  }
  // 形の合わない値（電話番号の形など）は、その項目だけ写さない
  const ok: PatientInput = {};
  for (const [k, v] of Object.entries(wanted) as [keyof PatientInput, never][]) {
    try {
      patientFields({ [k]: v }, patientId);
      ok[k] = v;
    } catch {
      // 写さない
    }
  }
  if (Object.keys(ok).length === 0) return;
  updatePatient(patientId, { ...ok, version: cur.version }, QUESTIONNAIRE_ACTOR);
}

export function deleteQuestionnaire(id: string, by?: Actor): void {
  const st = state();
  const q = liveQuestionnaire(id);
  st.questionnaires.set(id, { ...q, deleted: { at: new Date().toISOString(), ...(by && { by }) } });
  if (by) audit(by, "問診票を削除", q.patientId);
}

// ---- カルテ（施術記録） ----

export interface ChartInput {
  date?: string;
  reservationId?: string;
  treatment?: string;
  area?: string;
  settings?: string;
  drugs?: ChartDrug[];
  anesthesia?: string;
  findings?: string;
  nextPlan?: string;
  operator?: string;
}

/** 入力を検査して、保存する項目にそろえる（空の項目は持たない） */
function chartFields(input: ChartInput, cur?: ChartEntry): Omit<ChartEntry, "id" | "patientId" | "date" | "createdAt" | "version"> {
  const pick = (k: "area" | "settings" | "anesthesia" | "findings" | "nextPlan" | "operator") => (input[k] !== undefined ? input[k] : cur?.[k]) ?? "";
  const out: Omit<ChartEntry, "id" | "patientId" | "date" | "createdAt" | "version"> = {
    treatment: checkText("施術名", input.treatment ?? cur?.treatment ?? "", 120, true),
    drugs: (input.drugs ?? cur?.drugs ?? []).map((d) => {
      const name = checkText("薬剤名", d.name, 80, true);
      const lot = checkText("ロット番号", d.lot ?? "", 40, false);
      const amount = checkText("使用量", d.amount ?? "", 40, false);
      return { name, ...(lot && { lot }), ...(amount && { amount }) };
    }),
  };
  const area = checkText("部位", pick("area"), 200, false);
  const settings = checkNote("条件", pick("settings"), 1000);
  const anesthesia = checkText("麻酔", pick("anesthesia"), 100, false);
  const findings = checkNote("所見・経過", pick("findings"), 8000);
  const nextPlan = checkText("次回の予定", pick("nextPlan"), 200, false);
  const operator = checkText("施術者", pick("operator"), 60, false);
  return { ...out, ...(area && { area }), ...(settings && { settings }), ...(anesthesia && { anesthesia }), ...(findings && { findings }), ...(nextPlan && { nextPlan }), ...(operator && { operator }) };
}

export function listCharts(patientId: string): ChartEntry[] {
  return [...state().charts.values()]
    .filter((c) => c.patientId === patientId && !c.deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || a.createdAt.localeCompare(b.createdAt));
}

function liveChart(id: string): ChartEntry {
  const c = state().charts.get(id);
  if (!c || c.deleted) throw new StoreError("not_found", "カルテが見つかりません");
  return c;
}

export function createChart(patientId: string, input: ChartInput & { date: string }, by?: Actor): ChartEntry {
  const st = state();
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  if (p.deleted) throw new StoreError("invalid", "削除された患者にはカルテを書けません");
  if (input.reservationId) {
    const r = st.reservations.get(input.reservationId);
    if (!r || r.patientId !== patientId) throw new StoreError("invalid", "予約が見つかりません");
  }
  const c: ChartEntry = {
    id: `chart-${Date.now().toString(36)}-${randomId()}`,
    patientId,
    date: input.date,
    ...(input.reservationId && { reservationId: input.reservationId }),
    ...chartFields(input),
    createdAt: new Date().toISOString(),
    ...(by && { createdBy: by }),
    version: 1,
  };
  st.charts.set(c.id, c);
  if (by) audit(by, `カルテを記入（${c.date} ${c.treatment}）`, patientId);
  return c;
}

export function updateChart(id: string, input: ChartInput & { version: number }, by?: Actor): ChartEntry {
  const st = state();
  const cur = liveChart(id);
  if (cur.version !== input.version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  const next: ChartEntry = {
    id: cur.id,
    patientId: cur.patientId,
    date: input.date ?? cur.date,
    ...(cur.reservationId && { reservationId: cur.reservationId }),
    ...chartFields(input, cur),
    createdAt: cur.createdAt,
    ...(cur.createdBy && { createdBy: cur.createdBy }),
    updatedAt: new Date().toISOString(),
    ...(by && { updatedBy: by }),
    version: cur.version + 1,
  };
  st.charts.set(id, next);
  if (by) audit(by, `カルテを変更（${next.date} ${next.treatment}）`, next.patientId);
  return next;
}

/** カルテの削除：書いた本人か、管理操作のできるスタッフだけ */
export function deleteChart(id: string, input: { version: number }, by: Actor & { canManage?: boolean }): ChartEntry {
  const st = state();
  const cur = liveChart(id);
  if (!by.canManage && cur.createdBy?.id !== by.id) throw new AuthError("forbidden", "書いた本人か、管理操作のできるスタッフだけが削除できます");
  if (cur.version !== input.version) throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
  const actor = { id: by.id, name: by.name };
  const next: ChartEntry = { ...cur, deleted: { at: new Date().toISOString(), by: actor }, version: cur.version + 1 };
  st.charts.set(id, next);
  audit(actor, `カルテを削除（${cur.date} ${cur.treatment}）`, cur.patientId);
  return next;
}

// ---- 料金表（ホームページが正本。自由入力の項目も足せる） ----

/** 取り込むホームページの既定（院ごとに設定で変える） */
const DEFAULT_PRICE_URLS: string[] = [];
/** 前回の取り込みからこれだけ経ったら、料金表を開いたときに取り込み直す */
const PRICE_SYNC_MS = 24 * 60 * 60 * 1000;
/** 取り込みに失敗したときは、これだけ経ってから試し直す */
const PRICE_RETRY_MS = 60 * 60 * 1000;

interface PriceSyncMeta {
  at: string;
  results: PriceSyncResult[];
}

export function priceUrls(): string[] {
  state();
  return getMeta<string[]>("priceUrls") ?? DEFAULT_PRICE_URLS;
}

function sortedPrices(): PriceItem[] {
  const rank = (p: PriceItem) => (p.source === "homepage" ? 0 : p.source === "sheet" ? 1 : 2);
  return [...state().prices.values()].filter((p) => !p.removed).sort((a, b) => rank(a) - rank(b) || byOrder(a, b));
}

export function getPriceList(): PriceList {
  const sync = getMeta<PriceSyncMeta>("priceSync");
  const sheets = Object.entries(getMeta<Record<string, { at: string; count: number }>>("priceSheets") ?? {})
    .map(([name, v]) => ({ name, at: v.at, count: v.count }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const pull = getMeta<NonNullable<PriceList["sheetPull"]>>("priceSheetPull");
  return {
    items: sortedPrices(),
    urls: priceUrls(),
    ...(sync && { syncedAt: sync.at }),
    results: sync?.results ?? [],
    sheets,
    sheetSource: priceSheetSourceInfo(),
    ...(pull && { sheetPull: pull }),
  };
}

// ---- スプレッドシートの読み込み元（Apps Script のウェブアプリ。「今すぐ取り込む」でこちらから読みに行く） ----

export function priceSheetSource(): ConsentSource | null {
  state();
  const s = getMeta<ConsentSource>("priceSheetSource");
  return s && s.url ? s : null;
}

export function priceSheetSourceInfo(): { url: string; hasKey: boolean } {
  const s = priceSheetSource();
  return { url: s?.url ?? "", hasKey: !!s?.key };
}

export function setPriceSheetSource(input: { url: string; key?: string }, by?: Actor): { url: string; hasKey: boolean } {
  const url = input.url.trim();
  if (url && !/^(https:\/\/[^\s/]+|http:\/\/127\.0\.0\.1(:\d+)?)(\/\S*)?$/.test(url)) throw new StoreError("invalid", "読み込み元のアドレスは https:// で始まるものにしてください");
  const cur = priceSheetSource();
  const key = input.key !== undefined ? input.key.trim() : (cur?.key ?? "");
  if (url && !key) throw new StoreError("invalid", "合言葉（キー）を入れてください");
  setMeta("priceSheetSource", url ? { url, key } : null);
  if (by) audit(by, "料金表（スプレッドシート）の読み込み元を変更");
  return priceSheetSourceInfo();
}

export function notePriceSheetPull(r: { ok: boolean; count: number; error?: string }): void {
  setMeta("priceSheetPull", { at: new Date().toISOString(), ...r });
}

/** 料金表を開いたときに取り込み直すか（1日1回。失敗していたら1時間後） */
export function priceSyncDue(now = Date.now()): boolean {
  if (priceUrls().length === 0) return false;
  const sync = getMeta<PriceSyncMeta>("priceSync");
  if (!sync) return true;
  const failed = sync.results.some((r) => !r.ok);
  return now - Date.parse(sync.at) >= (failed ? PRICE_RETRY_MS : PRICE_SYNC_MS);
}

export function setPriceUrls(urls: string[], by?: Actor): string[] {
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  for (const u of clean) {
    if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(u)) throw new StoreError("invalid", `ホームページのアドレスが正しくありません：${u}`);
  }
  setMeta("priceUrls", clean);
  if (by) audit(by, "料金表の取り込み元を変更");
  return clean;
}

function priceId(url: string, category: string, name: string, prefix = "hp-"): string {
  return prefix + createHash("sha1").update(`${url}\n${category}\n${name}`).digest("hex").slice(0, 12);
}

export interface FetchedPricePage {
  url: string;
  items?: { category: string; name: string; priceYen: number | null; priceText: string }[];
  error?: string;
}

/** 取り込んだ結果を料金表に反映する。読めなかったページの項目はそのまま残す */
function applyPriceSyncImpl(pages: FetchedPricePage[], by?: Actor): PriceList {
  const st = state();
  const at = new Date().toISOString();
  const results: PriceSyncResult[] = [];
  let order = 0;
  for (const page of pages) {
    if (!page.items) {
      results.push({ url: page.url, ok: false, count: 0, error: page.error ?? "読み込めませんでした" });
      for (const p of st.prices.values()) if (p.source === "homepage" && p.url === page.url && !p.removed) order = Math.max(order, p.order + 1);
      continue;
    }
    const seen = new Set<string>();
    for (const it of page.items) {
      let id = priceId(page.url, it.category, it.name);
      for (let n = 2; seen.has(id); n++) id = priceId(page.url, it.category, `${it.name}#${n}`);
      seen.add(id);
      const cur = st.prices.get(id);
      const next: PriceItem = {
        id,
        source: "homepage",
        category: it.category,
        name: it.name,
        priceYen: it.priceYen,
        priceText: it.priceText,
        url: page.url,
        order: order++,
        updatedAt: cur && cur.priceYen === it.priceYen && cur.priceText === it.priceText && !cur.removed ? cur.updatedAt : at,
      };
      if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) st.prices.set(id, next);
    }
    // ホームページから消えた項目は候補に出さない
    for (const p of [...st.prices.values()]) {
      if (p.source === "homepage" && p.url === page.url && !seen.has(p.id) && !p.removed) st.prices.set(p.id, { ...p, removed: true, updatedAt: at });
    }
    results.push({ url: page.url, ok: true, count: seen.size });
  }
  // 取り込み元から外したページの項目も候補に出さない
  const urls = new Set(pages.map((p) => p.url));
  for (const p of [...st.prices.values()]) {
    if (p.source === "homepage" && p.url && !urls.has(p.url) && !p.removed) st.prices.set(p.id, { ...p, removed: true, updatedAt: at });
  }
  setMeta("priceSync", { at, results } satisfies PriceSyncMeta);
  if (by) audit(by, "料金表をホームページから取り込み");
  return getPriceList();
}

export function applyPriceSync(...args: Parameters<typeof applyPriceSyncImpl>): PriceList {
  return transaction(() => applyPriceSyncImpl(...args));
}

export interface PriceItemInput {
  category?: string;
  name?: string;
  priceYen?: number | null;
}

function checkManualPrice(cur: PriceItem): PriceItem {
  if (!cur.name) throw new StoreError("invalid", "項目名を入力してください");
  return cur;
}

/** 自由入力の料金を足す */
export function createPriceItem(input: PriceItemInput, by?: Actor): PriceItem {
  const st = state();
  const manual = [...st.prices.values()].filter((p) => p.source === "manual");
  if (manual.length >= 500) throw new StoreError("invalid", "登録できる数を超えています");
  const priceYen = input.priceYen ?? null;
  const p = checkManualPrice({
    id: `price-${Date.now().toString(36)}-${randomId()}`,
    source: "manual",
    category: checkText("分類", input.category ?? "", 60, false) || "その他",
    name: checkText("項目名", input.name ?? "", 120, true),
    priceYen,
    priceText: priceYen === null ? "" : `${priceYen.toLocaleString("ja-JP")}円`,
    order: Math.max(-1, ...manual.map((x) => x.order)) + 1,
    updatedAt: new Date().toISOString(),
  });
  st.prices.set(p.id, p);
  if (by) audit(by, "料金表に項目を追加");
  return p;
}

function manualPrice(id: string): PriceItem {
  const cur = state().prices.get(id);
  if (!cur || cur.removed) throw new StoreError("not_found", "料金が見つかりません");
  if (cur.source !== "manual") throw new StoreError("invalid", "ホームページから取り込んだ料金は、ホームページで直してください");
  return cur;
}

export function updatePriceItem(id: string, input: PriceItemInput, by?: Actor): PriceItem {
  const cur = manualPrice(id);
  const next: PriceItem = { ...cur, updatedAt: new Date().toISOString() };
  if (input.category !== undefined) next.category = checkText("分類", input.category, 60, false) || "その他";
  if (input.name !== undefined) next.name = checkText("項目名", input.name, 120, true);
  if (input.priceYen !== undefined) {
    next.priceYen = input.priceYen;
    next.priceText = input.priceYen === null ? "" : `${input.priceYen.toLocaleString("ja-JP")}円`;
  }
  state().prices.set(id, next);
  if (by) audit(by, "料金表の項目を変更");
  return next;
}

export function deletePriceItem(id: string, by?: Actor): void {
  manualPrice(id);
  state().prices.delete(id);
  if (by) audit(by, "料金表の項目を削除");
}

export interface SheetPriceInput {
  category: string;
  name: string;
  priceYen: number | null;
  priceText?: string;
  kind?: "treatment" | "product";
}

/**
 * スプレッドシート（Apps Script）から送られてきた料金で、そのシートの分を入れ替える。
 * 送られてこなかった項目は候補に出さない
 */
function receiveSheetPricesImpl(sheet: string, items: SheetPriceInput[]): { sheet: string; count: number; at: string } {
  const st = state();
  const name0 = checkText("シート名", sheet, 60, true);
  const url = `sheet:${name0}`;
  const at = new Date().toISOString();
  const seen = new Set<string>();
  let order = 0;
  for (const it of items) {
    const name = checkText("項目名", it.name, 120, false);
    if (!name) continue;
    const category = checkText("分類", it.category, 60, false) || "その他";
    let id = priceId(url, category, name, "sh-");
    for (let n = 2; seen.has(id); n++) id = priceId(url, category, `${name}#${n}`, "sh-");
    seen.add(id);
    const priceText = (it.priceText ?? "").trim() || (it.priceYen === null ? "" : `${it.priceYen.toLocaleString("ja-JP")}円`);
    const cur = st.prices.get(id);
    const same = cur && cur.priceYen === it.priceYen && cur.priceText === priceText && cur.kind === it.kind && !cur.removed;
    const next: PriceItem = {
      id,
      source: "sheet",
      category,
      name,
      ...(it.kind && { kind: it.kind }),
      priceYen: it.priceYen,
      priceText,
      url,
      order: order++,
      updatedAt: same ? cur.updatedAt : at,
    };
    if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) st.prices.set(id, next);
  }
  for (const p of [...st.prices.values()]) {
    if (p.source === "sheet" && p.url === url && !seen.has(p.id) && !p.removed) st.prices.set(p.id, { ...p, removed: true, updatedAt: at });
  }
  const sheets = getMeta<Record<string, { at: string; count: number }>>("priceSheets") ?? {};
  setMeta("priceSheets", { ...sheets, [name0]: { at, count: seen.size } });
  return { sheet: name0, count: seen.size, at };
}

export function receiveSheetPrices(...args: Parameters<typeof receiveSheetPricesImpl>): ReturnType<typeof receiveSheetPricesImpl> {
  return transaction(() => receiveSheetPricesImpl(...args));
}

// ---- 同意書（ひな形は Google ドキュメントが正本。差し込み・署名はこのソフトの中で行う） ----

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function templateMeta(t: ConsentTemplateWithHtml): ConsentTemplate {
  const { html: _html, ...meta } = t;
  void _html;
  return meta;
}

export function listConsentTemplates(): ConsentTemplate[] {
  return [...state().consentTemplates.values()]
    .filter((t) => !t.removed)
    .map(templateMeta)
    .sort((a, b) => byText(a.title, b.title) || byText(a.id, b.id));
}

export function getConsentTemplate(id: string): ConsentTemplateWithHtml {
  const t = state().consentTemplates.get(id);
  if (!t || t.removed) throw new StoreError("not_found", "同意書のひな形が見つかりません");
  return t;
}

/** 同意書フォルダから送られてきたひな形で入れ替える。メニューとの結びつけは残す */
function receiveConsentTemplatesImpl(templates: { driveId: string; title: string; modifiedTime: string; html: string }[]) {
  const st = state();
  const at = new Date().toISOString();
  const seen = new Set<string>();
  for (const t of templates) {
    const id = `ct-${t.driveId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const cur = st.consentTemplates.get(id);
    const title = checkText("同意書の名前", t.title, 120, true);
    if (cur && !cur.removed && cur.title === title && cur.modifiedTime === t.modifiedTime && cur.html === t.html) continue;
    st.consentTemplates.set(id, { id, driveId: t.driveId, title, modifiedTime: t.modifiedTime, menuIds: cur?.menuIds ?? [], receivedAt: at, html: t.html });
  }
  let removed = 0;
  for (const t of [...st.consentTemplates.values()]) {
    // ファイルから取り込んだひな形は、ドライブのフォルダにないので消さない
    if (!seen.has(t.id) && !t.removed && !isUploadedTemplate(t)) {
      st.consentTemplates.set(t.id, { ...t, removed: true, receivedAt: at });
      removed++;
    }
  }
  setMeta("consentTemplatesAt", at);
  return { count: seen.size, removed, at };
}

export function receiveConsentTemplates(...args: Parameters<typeof receiveConsentTemplatesImpl>): ReturnType<typeof receiveConsentTemplatesImpl> {
  return transaction(() => receiveConsentTemplatesImpl(...args));
}

/** ファイル（Word・HTML・Googleドキュメントの書き出し）から取り込んだひな形か */
export const isUploadedTemplate = (t: { driveId: string }) => t.driveId.startsWith("upload-");

/** ファイルから同意書のひな形を取り込む。同じ名前のものは入れ替える（メニューとの結びつけは残す） */
export function importConsentTemplates(templates: { title: string; html: string }[], by?: Actor): { count: number } {
  return transaction(() => {
    const st = state();
    const at = new Date().toISOString();
    for (const t of templates) {
      const title = checkText("同意書の名前", t.title, 120, true);
      const driveId = `upload-${createHash("sha1").update(searchKey(title)).digest("hex").slice(0, 16)}`;
      const id = `ct-${driveId}`;
      const cur = st.consentTemplates.get(id);
      st.consentTemplates.set(id, { id, driveId, title, modifiedTime: at, menuIds: cur?.menuIds ?? [], receivedAt: at, html: t.html });
    }
    if (by) audit(by, `同意書のひな形をファイルから取り込み（${templates.length}件）`);
    return { count: templates.length };
  });
}

/** ファイルから取り込んだひな形を消す（ドライブのものはフォルダから消す） */
export function deleteConsentTemplate(id: string, by?: Actor): void {
  const st = state();
  const t = getConsentTemplate(id);
  if (!isUploadedTemplate(t)) throw new StoreError("invalid", "Googleドライブのひな形は、ドライブのフォルダから消してください");
  st.consentTemplates.set(id, { ...t, removed: true });
  if (by) audit(by, `同意書のひな形「${t.title}」を削除`);
}

export function consentTemplatesReceivedAt(): string | null {
  state();
  return getMeta<string>("consentTemplatesAt") ?? null;
}

export function setConsentTemplateMenus(id: string, menuIds: string[], by?: Actor): ConsentTemplate {
  const st = state();
  const t = getConsentTemplate(id);
  const ids = [...new Set(menuIds)];
  if (!ids.every((m) => st.menus.has(m))) throw new StoreError("invalid", "メニューが見つかりません");
  const next = { ...t, menuIds: ids };
  st.consentTemplates.set(id, next);
  if (by) audit(by, `同意書「${t.title}」のメニューを変更`);
  return templateMeta(next);
}

function consentSummary(c: ConsentRecord & { html: string }): ConsentRecord {
  const { html: _html, signature: _sig, ...rest } = c;
  void _html;
  void _sig;
  return rest;
}

export function listConsents(patientId: string): ConsentRecord[] {
  return [...state().consents.values()]
    .filter((c) => c.patientId === patientId && !c.deleted)
    .map(consentSummary)
    .sort((a, b) => byText(b.date, a.date) || byText(b.createdAt, a.createdAt));
}

export function createConsent(
  patientId: string,
  input: { templateId: string; reservationId?: string; date?: string; treatment?: string; signature?: string },
  by?: Actor,
): ConsentRecord {
  const st = state();
  const p = st.patients.get(patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  if (p.deleted) throw new StoreError("invalid", "削除された患者には同意書を作れません");
  const t = getConsentTemplate(input.templateId);
  let treatment = input.treatment !== undefined ? checkText("施術名", input.treatment, 120, false) : "";
  if (input.reservationId) {
    const r = st.reservations.get(input.reservationId);
    if (!r || r.patientId !== patientId) throw new StoreError("invalid", "予約が見つかりません");
    if (input.treatment === undefined) treatment = r.menuIds.map((m) => st.menus.get(m)?.name ?? "").filter(Boolean).join("、");
  }
  const rec: ConsentRecord & { html: string } = {
    id: `cs-${Date.now().toString(36)}-${randomId()}`,
    patientId,
    ...(input.reservationId && { reservationId: input.reservationId }),
    templateId: t.id,
    title: t.title,
    templateModifiedTime: t.modifiedTime,
    date: input.date ?? nowInClinic().date,
    ...(treatment && { treatment }),
    signed: !!input.signature,
    ...(input.signature && { signature: input.signature }),
    createdAt: new Date().toISOString(),
    ...(by && { createdBy: by }),
    html: t.html,
  };
  st.consents.set(rec.id, rec);
  if (by) audit(by, `同意書「${t.title}」を${rec.signed ? "署名して保存" : "発行（紙で署名）"}`, patientId);
  return consentSummary(rec);
}

export function getConsentView(id: string): ConsentView {
  const c = state().consents.get(id);
  if (!c || c.deleted) throw new StoreError("not_found", "同意書が見つかりません");
  const p = state().patients.get(c.patientId);
  if (!p) throw new StoreError("not_found", "患者が見つかりません");
  const { html, ...record } = c;
  return {
    record,
    html,
    patient: dropUndefined({ id: p.id, name: p.name, kana: p.kana, chartNo: p.chartNo, birthDate: p.birthDate }),
    clinic: getClinic(),
  };
}

export function deleteConsent(id: string, by?: Actor): void {
  const st = state();
  const c = st.consents.get(id);
  if (!c || c.deleted) throw new StoreError("not_found", "同意書が見つかりません");
  st.consents.set(id, { ...c, deleted: { at: new Date().toISOString(), ...(by && { by }) } });
  if (by) audit(by, `同意書「${c.title}」を削除`, c.patientId);
}

// ---- 同意書の読み込み元（その時々にドライブから最新を読む） ----

interface ConsentSource {
  url: string;
  key: string;
}

export function consentSource(): ConsentSource | null {
  state();
  const s = getMeta<ConsentSource>("consentSource");
  return s && s.url ? s : null;
}

/** 画面に出す読み込み元の情報（キーは出さない） */
export function consentSourceInfo(): { url: string; hasKey: boolean } {
  const s = consentSource();
  return { url: s?.url ?? "", hasKey: !!s?.key };
}

export function setConsentSource(input: { url: string; key?: string }, by?: Actor): { url: string; hasKey: boolean } {
  const url = input.url.trim();
  // https のみ（動作確認用に手元の 127.0.0.1 だけ http を許す）
  if (url && !/^(https:\/\/[^\s/]+|http:\/\/127\.0\.0\.1(:\d+)?)(\/\S*)?$/.test(url)) throw new StoreError("invalid", "読み込み元のアドレスは https:// で始まるものにしてください");
  const cur = consentSource();
  const key = input.key !== undefined ? input.key.trim() : (cur?.key ?? "");
  if (url && !key) throw new StoreError("invalid", "合言葉（キー）を入れてください");
  setMeta("consentSource", url ? { url, key } : null);
  if (by) audit(by, "同意書の読み込み元を変更");
  return consentSourceInfo();
}

/** ドライブの一覧で、ひな形の名前・増減をそろえる（本文は読み込んだときに入れる） */
function applyConsentListImpl(list: { driveId: string; title: string; modifiedTime: string }[]): void {
  const st = state();
  const at = new Date().toISOString();
  const seen = new Set<string>();
  for (const t of list) {
    const id = `ct-${t.driveId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = checkText("同意書の名前", t.title, 120, true);
    const cur = st.consentTemplates.get(id);
    if (cur && !cur.removed && cur.title === title) continue;
    st.consentTemplates.set(id, {
      id,
      driveId: t.driveId,
      title,
      modifiedTime: cur?.modifiedTime ?? t.modifiedTime,
      menuIds: cur?.menuIds ?? [],
      receivedAt: cur?.receivedAt ?? at,
      html: cur?.html ?? "",
    });
  }
  for (const t of [...st.consentTemplates.values()]) {
    if (!seen.has(t.id) && !t.removed && !isUploadedTemplate(t)) st.consentTemplates.set(t.id, { ...t, removed: true });
  }
  setMeta("consentTemplatesAt", at);
}

export function applyConsentList(...args: Parameters<typeof applyConsentListImpl>): void {
  transaction(() => applyConsentListImpl(...args));
}

/** ドライブから読み込んだ最新の本文を入れる */
export function applyConsentDoc(doc: { driveId: string; title: string; modifiedTime: string; html: string }): ConsentTemplateWithHtml {
  const st = state();
  const id = `ct-${doc.driveId}`;
  const cur = st.consentTemplates.get(id);
  const title = checkText("同意書の名前", doc.title, 120, true);
  const next: ConsentTemplateWithHtml = {
    id,
    driveId: doc.driveId,
    title,
    modifiedTime: doc.modifiedTime,
    menuIds: cur?.menuIds ?? [],
    receivedAt: new Date().toISOString(),
    html: doc.html,
  };
  if (!cur || cur.removed || cur.title !== title || cur.modifiedTime !== doc.modifiedTime || cur.html !== doc.html) st.consentTemplates.set(id, next);
  return st.consentTemplates.get(id)!;
}
