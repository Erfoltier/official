import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("スキンケア・内服のプリセット", () => {
  beforeEach(() => {
    resetStores();
  });

  it("見本の商品は片付けてあり、価格付きで追加・変更・並べ替え・非表示にできる", async () => {
    const s = await store();
    // 候補の本体は料金表。見本の12品（値段なし）は最初に片付ける
    expect(s.getSettings().products).toEqual([]);
    s.createProduct({ name: "院の美容液", category: "skincare", priceYen: 3300 });

    const p = s.createProduct({ name: "ハイドロキノン 5%", category: "skincare", priceYen: 4400 });
    expect(p).toMatchObject({ priceYen: 4400, active: true });
    expect(() => s.createProduct({ name: "ハイドロキノン　５％" })).toThrow(/同じ名前/);
    expect(() => s.createProduct({ name: "x", priceYen: -1 })).toThrow(/価格/);

    const u = s.updateProduct(p.id, { priceYen: null, category: "oral" });
    expect(u).toMatchObject({ priceYen: null, category: "oral" });
    s.updateProduct(p.id, { active: false });
    const pid = (await import("@/lib/server/store")).createPatient({ name: "テスト" }).id;
    expect(s.getPatientDetail(pid).products.find((x) => x.id === p.id)).toBeUndefined();

    const ids = s.getSettings().products.map((x) => x.id).reverse();
    expect(s.reorderProducts(ids).map((x) => x.id)).toEqual(ids);
  });
});
