import "server-only";

import type {
  Actor,
  DayBundle,
  Lane,
  Menu,
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
import { INACTIVE_STATUSES, STATUS_LABEL } from "@/lib/domain/types";
import { addDays, clinicDateOf, formatDateJa, isDateString, minutesOfDay, nowInClinic, toIso, weekdayOf } from "@/lib/domain/time";
import { cleanName, hasForbiddenChars, searchKey } from "@/lib/domain/text";
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
import { audit } from "@/lib/server/staff";

/**
 * 試作用のメモリ上の予約ストア。サーバーを再起動すると変更は消える。
 * 本番ではPostgreSQL（院ごとの行分離あり）に置き換える。関数の形はそのまま使える想定。
 */

interface StoreState {
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
    const patients = buildDemoPatients();
    globalForStore.__reserveStore = {
      lanes: new Map(AIR_LANES.map((l) => [l.id, { ...l }])),
      menus: new Map(AIR_MENUS.map((m) => [m.id, { ...m, laneIds: [...m.laneIds] }])),
      patients: new Map(patients.map((p) => [p.id, p])),
      patientHistory: new Map(),
      visitNotes: new Map(),
      historySeeded: false,
      reservations: new Map(),
      seededDates: new Set(),
      seq: 0,
    };
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
  const st = state();
  if (st.seededDates.has(date)) return;
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

function sortedLanes(): Lane[] {
  return [...state().lanes.values()].sort((a, b) => a.order - b.order);
}

function sortedMenus(): Menu[] {
  return [...state().menus.values()].sort((a, b) => a.order - b.order);
}

export function getDayBundle(date: string): DayBundle {
  ensureSeeded(date);
  const st = state();
  const reservations = [...st.reservations.values()]
    .filter((r) => clinicDateOf(r.startAt) === date)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const patientIds = new Set(reservations.map((r) => r.patientId));
  // 非表示のレーンでも、その日に予約が残っていれば表示する（予約が見えなくならないように）
  const usedLanes = new Set(reservations.filter((r) => !INACTIVE_STATUSES.has(r.status)).map((r) => r.laneId));
  return {
    date,
    clinic: DEMO_CLINIC,
    lanes: sortedLanes().filter((l) => l.active || usedLanes.has(l.id)),
    menus: sortedMenus(),
    reservations,
    patients: [...patientIds].map((id) => st.patients.get(id)!).filter(Boolean),
  };
}

export function getSettings() {
  return { clinic: DEMO_CLINIC, lanes: sortedLanes(), menus: sortedMenus() };
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
  for (const p of state().patients.values()) {
    if (p.deleted) continue;
    const hay = searchKey(`${p.name}|${p.kana}|${p.nameAlt ?? ""}|${p.chartNo}`);
    const phoneHit = digits.length >= 4 && (p.phone ?? "").replace(/\D/g, "").includes(digits);
    if (hay.includes(q) || phoneHit) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
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
  st.reservations.set(id, next);
  if (by) {
    const what = [
      timeChanged || input.endAt !== undefined ? "時間" : null,
      input.laneId !== undefined && input.laneId !== cur.laneId ? "レーン" : null,
      input.status !== undefined ? `状態→${STATUS_LABEL[input.status]}` : null,
      input.menuIds !== undefined ? "メニュー" : null,
      input.memo !== undefined ? "メモ" : null,
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
  chartNo?: string;
  birthDate?: string;
  caution?: boolean;
  cautionNote?: string;
  memo?: string;
}

export type CreatePatientInput = PatientInput & { name: string };

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
  if (input.chartNo !== undefined) {
    const chartNo = input.chartNo.normalize("NFKC").trim();
    if (!/^[A-Za-z0-9-]{1,20}$/.test(chartNo)) throw new StoreError("invalid", "診察券番号は英数字で入力してください");
    for (const p of st.patients.values()) {
      if (p.chartNo === chartNo && p.id !== selfId) throw new StoreError("invalid", "この診察券番号は既に使われています");
    }
    out.chartNo = chartNo;
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
  if (input.memo !== undefined) out.memo = opt(checkNote("メモ", input.memo, 2000));
  return out;
}

function nextChartNo(): string {
  const used = [...state().patients.values()].map((p) => Number(p.chartNo)).filter(Number.isFinite);
  return String(Math.max(10000, ...used) + 1);
}

export function createPatient(input: CreatePatientInput, by?: Actor): Patient {
  const st = state();
  const chartNoGiven = (input.chartNo ?? "").trim() !== "";
  const fields = patientFields({ kana: "", ...input, chartNo: chartNoGiven ? input.chartNo : undefined }, null);
  const now = new Date().toISOString();
  const p = dropUndefined({
    id: `p-new-${Date.now().toString(36)}-${++st.seq}`,
    chartNo: fields.chartNo ?? nextChartNo(),
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
  chartNo: "診察券番号",
  birthDate: "生年月日",
  caution: "注意事項あり",
  cautionNote: "注意事項",
  memo: "メモ",
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
  const st = state();
  if (st.historySeeded) return;
  st.historySeeded = true;
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
    ...(r.memo && { memo: r.memo }),
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
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const rows = new Map<string, VisitRow>();
  const row = (date: string) => {
    let v = rows.get(date);
    if (!v) {
      v = { date, reservations: [], note: "", skincare: [], noteVersion: 0 };
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
  const note = checkNote("メモ", input.note, 4000);
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
  return next;
}

/**
 * レーンを完全に削除する。予約の記録が1件でもあるレーンは、過去の予約の表示のために削除できない
 * （その場合は非表示にする）。メニューの「行えるレーン」からも外す
 */
export function deleteLane(id: string, by?: Actor): void {
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
}

/** 並び順をまとめて変更（ids の順に並べる） */
export function reorderLanes(ids: string[], by?: Actor): Lane[] {
  const st = state();
  if (ids.length !== st.lanes.size || !ids.every((id) => st.lanes.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.lanes.set(id, { ...st.lanes.get(id)!, order: i }));
  if (by) audit(by, "レーンを並べ替え");
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
  return menu;
}

export function updateMenu(id: string, input: MenuInput, by?: Actor): Menu {
  const st = state();
  const cur = st.menus.get(id);
  if (!cur) throw new StoreError("not_found", "メニューが見つかりません");
  const next = validateMenu({ ...cur, ...input, id: cur.id, order: cur.order });
  st.menus.set(id, next);
  if (by) audit(by, "メニューを変更", id);
  return next;
}

export function reorderMenus(ids: string[], by?: Actor): Menu[] {
  const st = state();
  if (ids.length !== st.menus.size || !ids.every((id) => st.menus.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.menus.set(id, { ...st.menus.get(id)!, order: i }));
  if (by) audit(by, "メニューを並べ替え");
  return sortedMenus();
}

// ---- 患者の削除（論理削除）・復元・統合 ----

function digits(s?: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/** 重複の可能性：フリガナ・氏名・電話番号・生年月日＋フリガナの一致 */
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
    if (p.birthDate && o.birthDate === p.birthDate && reasons.length > 0) reasons.push("生年月日が同じ");
    if (reasons.length > 0) out.push({ patient: o, reasons });
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
    if (p.id !== id && !p.deleted && p.chartNo === cur.chartNo) {
      throw new StoreError("invalid", "同じ診察券番号の患者がいるため復元できません");
    }
  }
  const at = new Date().toISOString();
  const next = dropUndefined({ ...cur, deleted: undefined, version: cur.version + 1, updatedAt: at });
  st.patients.set(id, next);
  recordChange(id, ["削除からの復元"], at, by, "患者を削除から復元");
  return next;
}

const FILLABLE: (keyof Patient)[] = ["kana", "nameAlt", "phone", "email", "birthDate"];

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
  };
}

/**
 * 重複して登録した患者 dup を keep にまとめる。
 * - 予約と日付ごとの記録を keep へ移す（同じ日に両方の記録があればメモをつなげ、スキンケアを合わせる）
 * - keep の空欄は dup の値で埋める。注意事項とメモはつなげる
 * - dup は削除扱い（mergedInto に keep）にして残す
 */
export function mergePatients(
  input: { keepId: string; dupId: string; keepVersion: number; dupVersion: number },
  by?: Actor,
): Patient {
  ensureHistorySeeded();
  const st = state();
  const { keep, dup } = mergeTargets(input.keepId, input.dupId);
  if (keep.version !== input.keepVersion || dup.version !== input.dupVersion) {
    throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を開き直してください");
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
  // 患者情報：空欄を埋め、注意事項・メモはつなげる
  const next: Patient = { ...keep };
  for (const f of FILLABLE) if (!next[f] && dup[f]) (next as unknown as Record<string, unknown>)[f] = dup[f];
  if (!next.nameAlt && searchKey(dup.name) !== searchKey(keep.name)) next.nameAlt = dup.name;
  if (!next.lineUserId && dup.lineUserId) next.lineUserId = dup.lineUserId;
  next.caution = keep.caution || dup.caution || undefined;
  next.cautionNote = [keep.cautionNote, dup.cautionNote].filter(Boolean).join("\n") || undefined;
  next.memo = [keep.memo, dup.memo && `（統合元 診察券${dup.chartNo}）${dup.memo}`].filter(Boolean).join("\n") || undefined;
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
