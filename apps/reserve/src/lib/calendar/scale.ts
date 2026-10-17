/** 時間軸の拡大率（1分あたりのピクセル数）の範囲 */
export const MIN_PX_PER_MIN = 0.6;
export const MAX_PX_PER_MIN = 8;
export const DEFAULT_PX_PER_MIN = 2;

export function clampScale(pxPerMin: number): number {
  if (!Number.isFinite(pxPerMin)) return DEFAULT_PX_PER_MIN;
  return Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, pxPerMin));
}

/**
 * 指（またはマウス位置）の下の時刻を動かさずに拡大・縮小したときの新しいスクロール位置。
 *
 * @param scrollTop  現在のスクロール位置
 * @param focusY     スクロール領域の上端から見た指の位置（px）
 * @param oldScale   変更前の px/分
 * @param newScale   変更後の px/分（clamp済み）
 */
export function anchoredScrollTop(
  scrollTop: number,
  focusY: number,
  oldScale: number,
  newScale: number,
): number {
  const minuteAtFocus = (scrollTop + focusY) / oldScale;
  return Math.max(0, minuteAtFocus * newScale - focusY);
}

/** 表示時間帯全体が高さに収まる拡大率 */
export function fitScale(viewportHeight: number, totalMinutes: number): number {
  if (totalMinutes <= 0) return DEFAULT_PX_PER_MIN;
  return clampScale(viewportHeight / totalMinutes);
}

/**
 * 予約枠の表示段階。枠の高さに応じて出す情報を減らす。
 * - full:    患者名・施術名・時刻・アイコンを複数行
 * - line:    「患者名｜施術略称」を1行
 * - micro:   小さい文字で1行（それでも名前は読める）
 * - bar:     色の帯のみ。タップ／ホバーで内容を表示
 */
export type BlockDensity = "full" | "line" | "micro" | "bar";

export function densityFor(heightPx: number): BlockDensity {
  if (heightPx >= 40) return "full";
  if (heightPx >= 16) return "line";
  if (heightPx >= 9) return "micro";
  return "bar";
}

/** 1行表示のときの文字サイズ（px）。枠に収まる最大で、12pxを上限にする */
export function lineFontSize(heightPx: number): number {
  return Math.max(8, Math.min(12, Math.floor(heightPx - 3)));
}

/** 分を刻みに丸める */
export function snapMinutes(minutes: number, slot: number): number {
  return Math.round(minutes / slot) * slot;
}

/** 時間軸の目盛り間隔（分）。拡大するほど細かくする */
export function tickStepFor(pxPerMin: number): { major: number; minor: number } {
  if (pxPerMin >= 5) return { major: 60, minor: 5 };
  if (pxPerMin >= 2.5) return { major: 60, minor: 15 };
  if (pxPerMin >= 1.2) return { major: 60, minor: 30 };
  return { major: 60, minor: 60 };
}
