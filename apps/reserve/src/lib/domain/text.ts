/**
 * 氏名などの文字列の扱い。
 *
 * Airリザーブでは漢字の氏名欄にローマ字やひらがなを入れられなかったため、
 * ここでは氏名に使える文字種を制限しない（漢字・ひらがな・カタカナ・ローマ字・数字・記号の混在可）。
 * 禁止するのは、画面表示を壊す制御文字だけ。
 */

// 制御文字（改行・タブ含む）と、表示を入れ替える双方向制御文字
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** 入力された氏名をそろえる：前後の空白を除き、連続する空白（全角含む）を1つの半角空白に */
export function cleanName(s: string): string {
  return s.normalize("NFC").replace(/[\s　]+/g, " ").trim();
}

export function hasForbiddenChars(s: string): boolean {
  return FORBIDDEN.test(s);
}

/** ひらがな → カタカナ */
function hiraToKata(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * 検索用の正規化。次の違いを無視して一致させる：
 * 全角／半角（Ａ→A、ｶ→カ）、大文字／小文字、ひらがな／カタカナ、空白・中黒・ハイフン類
 */
export function searchKey(s: string): string {
  // 長音「ー」は意味があるので残す。NFKCで全角ハイフン等は「-」になる
  return hiraToKata(s.normalize("NFKC").toLowerCase()).replace(/[\s・･\-‐_.]/g, "");
}
