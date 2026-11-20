import type { MenuDuration } from "@/lib/domain/types";

/** 「20分」「5〜60分」 */
export function durationLabel(d: MenuDuration): string {
  return d.kind === "fixed" ? `${d.minutes}分` : `${d.min}〜${d.max}分`;
}

export function priceLabel(yen: number | null): string {
  return yen === null ? "設定しない" : `${yen.toLocaleString("ja-JP")}円`;
}

/** 1件の予約の長さの上限（分。サーバーも12時間まで） */
export const MAX_RESERVATION_MINUTES = 720;

/**
 * 予約の時間の選択肢（分）。ふつうは base 分まで。選んだメニューの最大（予約不可は360分など）や今の時間がそれより長ければ、そこまで（12時間まで）
 */
export function durationChoices(step: number, base: number, current: number, menus: { duration: MenuDuration }[]): number[] {
  const longest = Math.max(base, current, ...menus.map((m) => (m.duration.kind === "range" ? m.duration.max : m.duration.minutes)));
  const top = Math.min(MAX_RESERVATION_MINUTES, longest);
  const out: number[] = [];
  for (let m = step; m <= top; m += step) out.push(m);
  if (!out.includes(current)) out.push(current);
  return out.sort((a, b) => a - b);
}

/** 時間の選択肢の表示：60分以上は「90分（1時間30分）」 */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${m}分（${h}時間${r ? `${r}分` : ""}）`;
}
