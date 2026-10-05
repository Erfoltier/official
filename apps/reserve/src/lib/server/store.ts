import "server-only";

import type {
  DayBundle,
  Patient,
  Reservation,
  ReservationStatus,
  ReminderStatus,
} from "@/lib/domain/types";
import { clinicDateOf, minutesOfDay, nowInClinic, toIso } from "@/lib/domain/time";
import {
  DEMO_CLINIC,
  DEMO_LANES,
  DEMO_TREATMENTS,
  buildDemoPatients,
  buildDemoReservations,
} from "@/lib/demo/seed";

/**
 * 試作用のメモリ上の予約ストア。サーバーを再起動すると変更は消える。
 * 本番ではPostgreSQL（院ごとの行分離あり）に置き換える。関数の形はそのまま使える想定。
 */

interface StoreState {
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
  for (const r of buildDemoReservations(date, [...st.patients.values()], nowIso)) {
    st.reservations.set(r.id, { ...r, status: demoStatus(r, now) });
  }
}

export function getDayBundle(date: string): DayBundle {
  ensureSeeded(date);
  const st = state();
  const reservations = [...st.reservations.values()]
    .filter((r) => clinicDateOf(r.startAt) === date)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const patientIds = new Set(reservations.map((r) => r.patientId));
  return {
    date,
    clinic: DEMO_CLINIC,
    lanes: DEMO_LANES,
    treatments: DEMO_TREATMENTS,
    reservations,
    patients: [...patientIds].map((id) => st.patients.get(id)!).filter(Boolean),
  };
}

export function searchPatients(query: string, limit = 20): Patient[] {
  const q = query.trim().replace(/\s+/g, "");
  if (!q) return [];
  const out: Patient[] = [];
  for (const p of state().patients.values()) {
    const hay = `${p.name}${p.kana}${p.chartNo}`.replace(/\s+/g, "");
    if (hay.includes(q)) out.push(p);
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

const laneIds = new Set(DEMO_LANES.map((l) => l.id));
const treatmentIds = new Set(DEMO_TREATMENTS.map((t) => t.id));

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
  treatmentIds: string[];
  startAt: string;
  endAt: string;
  memo?: string;
}

export function createReservation(input: CreateReservationInput): Reservation {
  const st = state();
  if (!st.patients.has(input.patientId)) throw new StoreError("invalid", "患者が見つかりません");
  if (!laneIds.has(input.laneId)) throw new StoreError("invalid", "レーンが見つかりません");
  if (!input.treatmentIds.every((t) => treatmentIds.has(t))) {
    throw new StoreError("invalid", "施術が見つかりません");
  }
  assertTimes(input.startAt, input.endAt);
  ensureSeeded(clinicDateOf(input.startAt));
  const nowIso = new Date().toISOString();
  const r: Reservation = {
    id: `r-new-${Date.now().toString(36)}-${++st.seq}`,
    patientId: input.patientId,
    laneId: input.laneId,
    treatmentIds: input.treatmentIds,
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
  treatmentIds?: string[];
  memo?: string;
}

export function updateReservation(id: string, input: UpdateReservationInput): Reservation {
  const st = state();
  const cur = st.reservations.get(id);
  if (!cur) throw new StoreError("not_found", "予約が見つかりません");
  if (cur.version !== input.version) {
    throw new StoreError("version_conflict", "他の端末で先に更新されました。画面を更新してください");
  }
  if (input.laneId !== undefined && !laneIds.has(input.laneId)) {
    throw new StoreError("invalid", "レーンが見つかりません");
  }
  if (input.treatmentIds !== undefined && !input.treatmentIds.every((t) => treatmentIds.has(t))) {
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
    ...(input.treatmentIds !== undefined && { treatmentIds: input.treatmentIds }),
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
