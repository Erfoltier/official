import { describe, expect, it } from "vitest";
import { discountName, discountYen, parseRate, priceCat, relatedPrices } from "../domain/estimateDiscount";
import type { PriceItem } from "../domain/types";

const price = (source: PriceItem["source"], category: string, name: string): PriceItem => ({
  id: name,
  source,
  category,
  name,
  priceYen: 1000,
  priceText: "",
  order: 0,
  updatedAt: "2026-10-01T00:00:00Z",
});

describe("見積の割引（掛け率）", () => {
  it("×0.9・90%・10%引きなどを掛け率に直す", () => {
    expect(parseRate("0.9")).toBe(0.9);
    expect(parseRate("×0.9")).toBe(0.9);
    expect(parseRate("x0.85")).toBe(0.85);
    expect(parseRate("90%")).toBe(0.9);
    expect(parseRate("１０％引き")).toBe(0.9);
    expect(parseRate("15%off")).toBe(0.85);
    expect(parseRate("1.2")).toBeNull();
    expect(parseRate("0")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });

  it("割引後の円未満は切り捨て、割引額はマイナス", () => {
    expect(discountYen(55000, 0.9)).toBe(-5500);
    expect(discountYen(12345, 0.9)).toBe(-1235); // 11110.5 → 11110
    expect(discountYen(0, 0.9)).toBe(0);
    expect(discountName("学割", "treatment", 0.9)).toBe("学割（施術のみ 10%引き）");
    expect(discountName("", "checked", 0.85)).toBe("割引（対象項目 15%引き）");
  });

  it("料金表の項目を施術と商品に分ける", () => {
    expect(priceCat(price("sheet", "ゼオスキンヘルス", "ミラミン"))).toBe("product");
    expect(priceCat(price("sheet", "特殊メニュー", "ピコ"))).toBe("treatment");
    expect(priceCat(price("homepage", "外用剤", "トレチノイン"))).toBe("product");
    expect(priceCat(price("homepage", "シミ取り", "Qスイッチ"))).toBe("treatment");
  });

  it("予約メニューの細かい名前ではなく、料金表の合う項目を出す", () => {
    const list = [price("homepage", "シミ取り", "顔まとめ取り"), price("homepage", "シミ取り", "〜10mm"), price("homepage", "ほくろ除去", "1個")];
    expect(relatedPrices(["シミ4個まで/男性/75歳以上/説明済照射のみ/ゼオ不要"], list).map((p) => p.name)).toEqual(["顔まとめ取り", "〜10mm"]);
    expect(relatedPrices(["予約（メモに自由記載）"], list)).toEqual([]);
    // 「ゼオ不要」ではゼオの料金を出さない
    expect(relatedPrices(["シミ4個まで/ゼオ不要"], [...list, price("sheet", "内服・外用など", "Tcrゼオ美白やっている人")]).map((p) => p.name)).toEqual(["顔まとめ取り", "〜10mm"]);
  });
});

describe("予約メニューの名前の書き足しを外す", () => {
  it("区別のための書き足しを外す", async () => {
    const { plainMenuName } = await import("../domain/estimateDiscount");
    expect(plainMenuName("シミ4個まで/男性/75歳以上/説明済照射のみ/ゼオ不要")).toBe("シミ4個まで");
    expect(plainMenuName("ボトックス初診標準20分")).toBe("ボトックス初診");
    expect(plainMenuName("フィルロード時間自由設定")).toBe("フィルロード");
    expect(plainMenuName("色素レーザー5/5使用しない11/3")).toBe("色素レーザー");
    expect(plainMenuName("スネコス【再診】使用しない9/30")).toBe("スネコス【再診】");
    expect(plainMenuName("ハイフ")).toBe("ハイフ");
  });
});
