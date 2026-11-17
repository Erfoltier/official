/**
 * 見積書・会計書の割引（掛け率）と、行の種類（施術／商品）の見分け、予約メニューに合う料金の候補。
 * 割引は「×0.9」「10%引き」のような掛け率で、施術だけ・商品だけ・全部・チェックした行だけに掛けられる。
 */
import type { PriceItem } from "./types";

export type LineCat = "treatment" | "product";
export type DiscountScope = "treatment" | "product" | "all" | "checked";

export const SCOPE_LABEL: Record<DiscountScope, string> = {
  treatment: "施術のみ",
  product: "商品のみ",
  all: "すべて",
  checked: "チェックした項目のみ",
};

/** 料金表の項目が商品（スキンケア・内服・外用）か。スプレッドシートの特殊メニューは施術 */
export function priceCat(p: Pick<PriceItem, "source" | "category" | "url" | "kind">): LineCat {
  // 取り込むときに種類が決まっていればそれを使う
  if (p.kind) return p.kind;
  if (p.source === "sheet" && !isImportedPrice(p)) return p.category === "特殊メニュー" ? "treatment" : "product";
  return PRODUCT_CATEGORY.test(p.category) ? "product" : "treatment";
}

/** 商品（物販）の分類に使われる言葉。取り込むときは分類にこのどれかを入れると商品として扱う */
export const PRODUCT_CATEGORY = /外用|内服|スキンケア|サプリ|ゼオ|化粧品|商品|物販/;

/** 設定の「取り込み」でファイル・スプレッドシートから入れた料金か */
export const IMPORT_SHEET_PREFIX = "取り込み：";
export const isImportedPrice = (p: { url?: string }) => !!p.url?.startsWith(`sheet:${IMPORT_SHEET_PREFIX}`);

/**
 * "0.9" "×0.9" "x0.85" "90%" "10%引き" "10%off" → 掛け率（0より大きく1以下）。読めなければ null
 */
export function parseRate(input: string): number | null {
  const t = input.normalize("NFKC").replace(/\s/g, "").replace(/^[×x*]/i, "");
  let m = /^(\d{1,3}(?:\.\d+)?)%(引き?|off|オフ)$/i.exec(t);
  if (m) return check(1 - Number(m[1]) / 100);
  m = /^(\d{1,3}(?:\.\d+)?)%$/.exec(t);
  if (m) return check(Number(m[1]) / 100);
  m = /^(\d(?:\.\d+)?)$/.exec(t);
  if (m) return check(Number(m[1]));
  return null;
}

const check = (r: number) => (Number.isFinite(r) && r > 0 && r <= 1 ? Math.round(r * 10000) / 10000 : null);

/** 割引額（マイナスの円）。割引後の金額の円未満は切り捨て */
export function discountYen(targetTotal: number, rate: number): number {
  if (targetTotal <= 0) return 0;
  const after = Math.floor((targetTotal * Math.round(rate * 10000)) / 10000);
  return after - targetTotal;
}

/** 書類に載せる名前（例：学割（施術のみ 10%引き）） */
export function discountName(label: string, scope: DiscountScope, rate: number): string {
  const pct = Math.round((1 - rate) * 1000) / 10;
  const scopeText = scope === "checked" ? "対象項目" : SCOPE_LABEL[scope];
  return `${label.trim() || "割引"}（${scopeText} ${pct}%引き）`;
}

/** 予約メニューの名前 → 料金表で合う項目を探す言葉（予約表の区別のための細かい名前は使わない） */
const RELATED: [RegExp, RegExp][] = [
  [/シミ/, /シミ/],
  [/ほくろ/, /ほくろ/],
  [/汗/, /多汗|脇/],
  [/ボトックス|BTX/i, /ボトックス/],
  [/ヒアル|クマ/, /ヒアルロン/],
  [/スネコス|クマ/, /スネコス/],
  [/ベビーコラーゲン|クマ/, /ベビーコラーゲン/],
  [/ジュベルック/, /ジュベルック/],
  [/ジュブ|リトゥオ/, /ジュブアセル|リトゥオ/],
  [/脂肪/, /脂肪溶解|Fat X/i],
  [/ハイフ|HIFU|たるみ/i, /ハイフ|HIFU|たるみ/i],
  [/針脱毛/, /針/],
  [/脱毛/, /脱毛/],
  [/ピール|ピーリング|サリチル|ミラノ/, /ピーリング|ピール/],
  [/フラクショナル|CO2|炭酸ガス/i, /炭酸ガス|CO2|フラクショナル/i],
  [/色素/, /色素/],
  [/ヴェル/, /ヴェルヴェット/],
  [/ダーマペン/, /ダーマペン/],
  [/サブシジョン/, /サブシジョン/],
  [/TCA/, /TCA/],
  [/ニキビ|イソ/, /ニキビ|イソトレ/],
  [/頭皮|HARG|薄毛|AGA/i, /HARG|頭皮|AGA|FAGA/],
  [/ネオボ/, /Neovoir|ネオボ/i],
  [/レーザーシャワー|タイトニング/, /レーザーシャワー|タイトニング|赤ら顔/],
  [/フィル|TAピンク/, /フィル|TAピンク/],
  [/トラネ/, /トラネキサム/],
  [/ゼオ/, /ゼオ/],
];

export function relatedPrices(menuNames: string[], prices: PriceItem[], limit = 24): PriceItem[] {
  // 「ゼオ不要」「麻酔なし」のような打ち消しの書き足しでは引かない
  const names = menuNames.map((n) => n.replace(/[^/／]*(不要|なし|無し|使用しない)[^/／]*/g, ""));
  const res = RELATED.filter(([m]) => names.some((n) => m.test(n))).map(([, p]) => p);
  if (res.length === 0) return [];
  return prices.filter((p) => !p.removed && res.some((re) => re.test(`${p.category} ${p.name}`))).slice(0, limit);
}

/**
 * 予約メニューの名前から、予約表の区別のための書き足しを外す（カルテの施術名の候補などに使う）。
 * 例：「シミ4個まで/男性/75歳以上/説明済照射のみ/ゼオ不要」→「シミ4個まで」、「ボトックス初診標準20分」→「ボトックス初診」
 */
export function plainMenuName(name: string): string {
  const s = name
    .replace(/[\d/／]*使用しない.*$/, "")
    .split(/[/／]/)[0]
    .replace(/標準\d+分|時間自由設定|（メモに自由記載）/g, "")
    .trim();
  return s || name;
}
