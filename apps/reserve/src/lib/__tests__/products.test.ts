import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

const h = withPhp();

describe("スキンケア・内服のプリセット", () => {
  it("見本の商品は片付けてあり、価格付きで追加・変更・並べ替え・非表示にできる", async () => {
    const c = await h.srv.as("staff-admin");
    const products = async () => (await c.get("/settings")).products as { id: string }[];
    // 候補の本体は料金表。見本の12品（値段なし）は最初に片付ける
    expect(await products()).toEqual([]);
    await c.post("/products", { name: "院の美容液", category: "skincare", priceYen: 3300 });

    const p = await c.post("/products", { name: "ハイドロキノン 5%", category: "skincare", priceYen: 4400 });
    expect(p).toMatchObject({ priceYen: 4400, active: true });
    await expect(c.post("/products", { name: "ハイドロキノン　５％" })).rejects.toThrow(/同じ名前/);
    await expect(c.post("/products", { name: "x", priceYen: -1 })).rejects.toThrow(/価格/);

    const u = await c.patch(`/products/${p.id}`, { priceYen: null, category: "oral" });
    expect(u).toMatchObject({ priceYen: null, category: "oral" });
    await c.patch(`/products/${p.id}`, { active: false });
    const pid = (await c.post("/patients", { name: "テスト" })).id;
    expect((await c.get(`/patients/${pid}`)).products.find((x: { id: string }) => x.id === p.id)).toBeUndefined();

    const ids = (await products()).map((x) => x.id).reverse();
    expect((await c.post("/products/reorder", { ids })).items.map((x: { id: string }) => x.id)).toEqual(ids);
  });
});
