/**
 * アプリを置く場所（パス）の扱い。
 * - 通常（Node.js で動かす）：サイトの直下（/）
 * - ロリポップ用の書き出し：/reserve など（NEXT_PUBLIC_BASE_PATH）
 *
 * next/link の href は自動で前置されるので、ここを通すのは <a> と location だけ。
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** <a href> や location に使う、置き場所込みのパス */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** APIのURL（置き場所込み） */
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** 患者画面のパス（next/link 用。静的書き出しでも動くよう、IDはクエリで渡す） */
export function patientPath(id: string): string {
  return `/patients/view/?id=${encodeURIComponent(id)}`;
}

/** カレンダーの指定日（next/link 用） */
export function calendarPath(date?: string): string {
  return date ? `/?date=${date}` : "/";
}

/**
 * 共用サーバー（ロリポップ等）では PUT / PATCH / DELETE が通らないことがあるため、
 * 書き出し版では POST に変え、本来のメソッドをヘッダーで伝える
 */
export const METHOD_OVERRIDE = process.env.NEXT_PUBLIC_METHOD_OVERRIDE === "1";
