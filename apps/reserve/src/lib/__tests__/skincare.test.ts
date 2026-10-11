import { describe, expect, it } from "vitest";
import { recentSkincare, searchSkincare, skincareOptions } from "../domain/skincare";
import type { PriceItem, Product } from "../domain/types";

const price = (source: PriceItem["source"], category: string, name: string, priceYen: number | null = 1000): PriceItem => ({
  id: `${source}-${name}`,
  source,
  category,
  name,
  priceYen,
  priceText: "",
  order: 0,
  updatedAt: "2026-10-01T00:00:00Z",
});
const product = (id: string, name: string): Product => ({ id, name, category: "skincare", priceYen: null, order: 0, active: true });

describe("skincareOptions", () => {
  it("料金表のゼオ・内服外用・ホームページの外用剤を候補にし、特殊メニューは出さない", () => {
    const opts = skincareOptions(
      [
        price("homepage", "シミ取り", "Qスイッチ"),
        price("homepage", "外用剤", "トレチノインクリーム"),
        price("sheet", "特殊メニュー", "ピコ 5回"),
        price("sheet", "内服・外用など", "トラネキサム酸"),
        price("sheet", "ゼオスキンヘルス", "ミラミン", 12000),
      ],
      [product("prod-xyz", "院の美容液")],
    );
    expect(opts.map((o) => o.name)).toEqual(["ゼオスキン ミラミン", "トラネキサム酸", "トレチノインクリーム", "院の美容液"]);
    expect(opts[0].priceYen).toBe(12000);
  });

  it("検索はひらがな・カタカナを区別しない", () => {
    const opts = skincareOptions([price("homepage", "外用剤", "トレチノインクリーム")], []);
    expect(searchSkincare(opts, "とれち").length).toBe(1);
    expect(searchSkincare(opts, "ぴる").length).toBe(0);
  });

  it("最近使ったものは前回分を先に、重複なく", () => {
    expect(recentSkincare(["A", "B"], ["B", "C", "D"], 3)).toEqual(["A", "B", "C"]);
  });
});
