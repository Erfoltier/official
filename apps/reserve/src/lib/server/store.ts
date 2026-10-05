import "server-only";

import type {
  DayBundle,
  Lane,
  Menu,
  Patient,
  Reservation,
  ReservationStatus,
  ReminderStatus,
} from "@/lib/domain/types";
import { INACTIVE_STATUSES } from "@/lib/domain/types";
import { clinicDateOf, minutesOfDay, nowInClinic, toIso } from "@/lib/domain/time";
import { cleanName, hasForbiddenChars, searchKey } from "@/lib/domain/text";
import { DEMO_CLINIC, buildDemoPatients, buildDemoReservations } from "@/lib/demo/seed";
import { AIR_LANES, AIR_MENUS } from "@/lib/seed/airreserve-import";

/**
 * 試作用のメモリ上の予約ストア。サーバーを再起動すると変更は消える。
 * 本番ではPostgreSQL（院ごとの行分離あり）に置き換える。関数の形はそのまま使える想定。
 */

interface StoreState {
  lanes: Map<string, Lane>;
  menus: Map<string, Menu>;
  patients: Map<string, Patient>;
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
    [...st.patients.values()],
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
  if (!q) return [];
  const digits = query.replace(/\D/g, "");
  const out: Patient[] = [];
  for (const p of state().patients.values()) {
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

export function createReservation(input: CreateReservationInput): Reservation {
  const st = state();
  if (!st.patients.has(input.patientId)) throw new StoreError("invalid", "患者が見つかりません");
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
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  st.reservations.set(r.id, r);
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

export function updateReservation(id: string, input: UpdateReservationInput): Reservation {
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
    version: cur.version + 1,
    updatedAt: new Date().toISOString(),
  };
  st.reservations.set(id, next);
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

// ---- 患者の登録 ----

export interface CreatePatientInput {
  name: string;
  kana?: string;
  nameAlt?: string;
  phone?: string;
  email?: string;
  chartNo?: string;
}

function checkText(label: string, value: string, max: number, required: boolean): string {
  const v = cleanName(value);
  if (required && !v) throw new StoreError("invalid", `${label}を入力してください`);
  if (v.length > max) throw new StoreError("invalid", `${label}は${max}文字以内にしてください`);
  if (hasForbiddenChars(v)) throw new StoreError("invalid", `${label}に使えない文字が含まれています`);
  return v;
}

export function createPatient(input: CreatePatientInput): Patient {
  const st = state();
  const name = checkText("氏名", input.name, 60, true);
  const kana = checkText("フリガナ", input.kana ?? "", 60, false);
  const nameAlt = checkText("別表記", input.nameAlt ?? "", 60, false);
  const phone = (input.phone ?? "").trim();
  if (phone && !/^[0-9+\-() ]{6,20}$/.test(phone)) throw new StoreError("invalid", "電話番号の形式が正しくありません");
  const email = (input.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new StoreError("invalid", "メールアドレスの形式が正しくありません");
  }
  let chartNo = (input.chartNo ?? "").trim();
  const used = new Set([...st.patients.values()].map((p) => p.chartNo));
  if (chartNo) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(chartNo)) throw new StoreError("invalid", "診察券番号は英数字で入力してください");
    if (used.has(chartNo)) throw new StoreError("invalid", "この診察券番号は既に使われています");
  } else {
    const max = Math.max(10000, ...[...used].map(Number).filter(Number.isFinite));
    chartNo = String(max + 1);
  }
  const p: Patient = {
    id: `p-new-${Date.now().toString(36)}-${++st.seq}`,
    chartNo,
    name,
    kana,
    ...(nameAlt && { nameAlt }),
    ...(phone && { phone }),
    ...(email && { email }),
  };
  st.patients.set(p.id, p);
  return p;
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

export function createLane(input: LaneInput): Lane {
  const st = state();
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
  return lane;
}

export function updateLane(id: string, input: LaneInput): Lane {
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
    if ([...st.lanes.values()].filter((l) => l.active).length <= 1) {
      throw new StoreError("invalid", "表示するレーンは1つ以上必要です");
    }
  }
  if (input.active !== undefined) next.active = input.active;
  st.lanes.set(id, next);
  return next;
}

/** 並び順をまとめて変更（ids の順に並べる） */
export function reorderLanes(ids: string[]): Lane[] {
  const st = state();
  if (ids.length !== st.lanes.size || !ids.every((id) => st.lanes.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.lanes.set(id, { ...st.lanes.get(id)!, order: i }));
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

export function createMenu(input: MenuInput): Menu {
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
  return menu;
}

export function updateMenu(id: string, input: MenuInput): Menu {
  const st = state();
  const cur = st.menus.get(id);
  if (!cur) throw new StoreError("not_found", "メニューが見つかりません");
  const next = validateMenu({ ...cur, ...input, id: cur.id, order: cur.order });
  st.menus.set(id, next);
  return next;
}

export function reorderMenus(ids: string[]): Menu[] {
  const st = state();
  if (ids.length !== st.menus.size || !ids.every((id) => st.menus.has(id))) {
    throw new StoreError("invalid", "並び順の指定が正しくありません");
  }
  ids.forEach((id, i) => st.menus.set(id, { ...st.menus.get(id)!, order: i }));
  return sortedMenus();
}
