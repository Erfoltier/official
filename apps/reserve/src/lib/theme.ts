/**
 * 画面の配色プリセットを当てる（院の設定 clinic.theme）。
 * 次に開いたときに一瞬元の色が見えないよう、端末にも覚えておき、ページの読み込み直後に当てる（layout.tsx）。
 */
import { THEME_IDS, type ThemeId } from "@/lib/domain/types";

export const THEME_KEY = "rsv-theme";

/** layout.tsx の <head> で最初に動かす（React より先に色を決める） */
export const THEME_BOOT = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}");if(t&&t!=="default"&&/^[a-z]+$/.test(t))d.dataset.theme=t;var z=localStorage.getItem("reserve:pref:uiSize");if(z==='"l"'||z==='"xl"')d.dataset.size=JSON.parse(z)}catch(e){}`;

export function applyTheme(theme: ThemeId | undefined): void {
  if (typeof document === "undefined") return;
  const t = theme && (THEME_IDS as readonly string[]).includes(theme) ? theme : "default";
  if (t === "default") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // 端末に覚えられなくても、色は当たっている
  }
}
