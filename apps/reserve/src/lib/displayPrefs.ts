/**
 * 画面の表示の好み（端末ごと。設定 → 画面の表示・配色）。
 * 端末の大きさや使う人で見やすさが違うので、院全体ではなくこの端末に覚える（usePref と同じ保存場所）。
 */

/** カレンダーの予約の枠に出す情報 */
export const BLOCK_INFO = [
  { id: "all", label: "名前・時刻・施術" },
  { id: "nameMenu", label: "名前と施術" },
  { id: "name", label: "名前だけ" },
] as const;
export type BlockInfo = (typeof BLOCK_INFO)[number]["id"];
export const isBlockInfo = (v: unknown): v is BlockInfo => BLOCK_INFO.some((b) => b.id === v);

/** 受付一覧をカレンダーを開いたときに出すか（auto は端末に合わせる：パソコンは開く・スマホ/タブレットはたたむ） */
export const RECEPTION_START = [
  { id: "auto", label: "端末に合わせる" },
  { id: "open", label: "いつも開く" },
  { id: "closed", label: "いつもたたむ" },
] as const;

/** 文字の大きさ（カレンダーの予定表の部分は、上の「＋」「−」で拡大縮小する） */
export const UI_SIZES = [
  { id: "m", label: "標準" },
  { id: "l", label: "大きめ" },
  { id: "xl", label: "特大" },
] as const;
export type UiSize = (typeof UI_SIZES)[number]["id"];
export const isUiSize = (v: unknown): v is UiSize => UI_SIZES.some((s) => s.id === v);

export const UI_SIZE_KEY = "reserve:pref:uiSize";

/** html の data-size に当てる（layout.tsx の読み込み直後と、設定で変えたとき） */
export function applyUiSize(size: UiSize): void {
  if (typeof document === "undefined") return;
  if (size === "m") delete document.documentElement.dataset.size;
  else document.documentElement.dataset.size = size;
}
