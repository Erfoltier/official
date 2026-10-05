import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("スキンケア・内服のプリセット", () => {
  beforeEach(() => {
    resetStores();
  });

  it("初期のプリセットが入っていて、価格付きで追加・変更・並べ替え・非表示にできる", async () => {
    const s = await store();
    const initial = s.getSettings().products;
    expect(initial.length).toBeGreaterThan(5);
    expect(initial.some((p) => p.category === "oral")).toBe(true);

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
