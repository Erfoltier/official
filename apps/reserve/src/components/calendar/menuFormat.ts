import type { MenuDuration } from "@/lib/domain/types";

/** 「20分」「5〜60分」 */
export function durationLabel(d: MenuDuration): string {
  return d.kind === "fixed" ? `${d.minutes}分` : `${d.min}〜${d.max}分`;
}

export function priceLabel(yen: number | null): string {
  return yen === null ? "設定しない" : `${yen.toLocaleString("ja-JP")}円`;
}
