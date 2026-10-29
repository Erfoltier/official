/**
 * 日付・時刻の変換。日本（UTC+9、夏時間なし）専用。
 * 端末のタイムゾーン設定に左右されないよう、Dateのローカル時刻系メソッドは使わない。
 */

const JST_OFFSET_MIN = 9 * 60;
const MS_PER_MIN = 60_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** ISO日時 → 日本時間の "YYYY-MM-DD" */
export function clinicDateOf(iso: string): string {
  const ms = Date.parse(iso) + JST_OFFSET_MIN * MS_PER_MIN;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO日時 → その日の0時（日本時間）からの分 */
export function minutesOfDay(iso: string): number {
  const ms = Date.parse(iso) + JST_OFFSET_MIN * MS_PER_MIN;
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 日付と分 → "2026-10-07T10:05:00+09:00"（分は1440以上でも翌日に繰り上がる） */
export function toIso(date: string, minutes: number): string {
  const base = Date.parse(`${date}T00:00:00+09:00`);
  const ms = base + Math.round(minutes) * MS_PER_MIN + JST_OFFSET_MIN * MS_PER_MIN;
  const local = new Date(ms).toISOString().slice(0, 19);
  return `${local}+09:00`;
}

/** 現在時刻を日本時間の日付と分で */
export function nowInClinic(now: Date = new Date()): { date: string; minutes: number } {
  const iso = now.toISOString();
  return { date: clinicDateOf(iso), minutes: minutesOfDay(iso) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function durationMin(startAt: string, endAt: string): number {
  return Math.round((Date.parse(endAt) - Date.parse(startAt)) / MS_PER_MIN);
}

/** 分 → "9:05" */
export function formatHm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-10-07" → "10/7(水)" */
export function formatDateJa(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 半開区間 [aStart, aEnd) と [bStart, bEnd) が重なるか */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
