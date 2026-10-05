/**
 * スキンケア＆内服の候補：料金表（スプレッドシートのゼオ・内服外用・その他、ホームページの外用剤・内服）と、
 * 設定で院が足した商品をまとめる。名前の重複は先のものを使う。
 */
import type { PriceItem, Product } from "./types";
import { searchKey } from "./text";
import { PRODUCT_CATEGORY, isImportedPrice } from "./estimateDiscount";

export interface SkincareOption {
  name: string;
  /** 全リストでの見出し */
  group: string;
  priceYen: number | null;
}

/** ホームページの料金表のうち、スキンケア＆内服として選ぶ分類 */
const HP_CATEGORY = /外用|内服|スキンケア|サプリ/;

const rank = (p: PriceItem): number => {
  if (p.source === "sheet") return p.category.startsWith("ゼオ") ? 0 : p.category === "その他" ? 3 : 1;
  return 2;
};

export function skincareOptions(prices: PriceItem[], products: Product[]): SkincareOption[] {
  const out: SkincareOption[] = [];
  const seen = new Set<string>();
  const push = (o: SkincareOption) => {
    const k = searchKey(o.name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(o);
  };
  const picked = prices
    .filter((p) => !p.removed)
    .filter((p) =>
      p.kind
        ? p.kind === "product"
        : p.source === "sheet" && !isImportedPrice(p)
        ? p.category !== "特殊メニュー"
        : p.source === "homepage"
          ? HP_CATEGORY.test(p.category)
          : PRODUCT_CATEGORY.test(p.category),
    )
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i);
  for (const { p } of picked) {
    const zeo = p.category.startsWith("ゼオ");
    const name = zeo && !/ゼオ|zo/i.test(p.name) ? `ゼオスキン ${p.name}` : p.name;
    push({ name, group: p.category, priceYen: p.priceYen });
  }
  for (const p of [...products].sort((a, b) => a.order - b.order)) {
    if (!p.active || p.deleted) continue;
    push({ name: p.name, group: "院で追加した商品", priceYen: p.priceYen });
  }
  return out;
}

export function searchSkincare(options: SkincareOption[], q: string): SkincareOption[] {
  const key = searchKey(q);
  if (!key) return options;
  return options.filter((o) => searchKey(`${o.group} ${o.name}`).includes(key));
}

/** 最近使ったもの：この患者の前回分 → この端末で最近選んだもの、の順に重複なく */
export function recentSkincare(previous: string[], deviceRecent: string[], limit = 8): string[] {
  return [...new Set([...previous, ...deviceRecent])].slice(0, limit);
}
