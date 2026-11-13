import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

const h = withPhp();
const admin = () => h.srv.as("staff-admin");

describe("M3カルテ番号", () => {
  it("登録・変更でき、全角で入れても半角にそろう。変更履歴には項目名だけ残る", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "高橋 Mio", m3ChartNo: "００１２３４" });
    expect(p.m3ChartNo).toBe("001234");
    const u = (await c.patch(`/patients/${p.id}`, { version: p.version, m3ChartNo: "A-778" })).patient;
    expect(u.m3ChartNo).toBe("A-778");
    const d = await c.get(`/patients/${p.id}`);
    expect(d.history[0].fields).toEqual(["M3カルテ番号"]);
    expect(JSON.stringify(d.history)).not.toContain("A-778");
    // 空にすると消える
    const cleared = (await c.patch(`/patients/${p.id}`, { version: u.version, m3ChartNo: "" })).patient;
    expect(cleared.m3ChartNo).toBeUndefined();
  });

  it("同じM3カルテ番号は別の患者に付けられない（どの患者かを示す）", async () => {
    const c = await admin();
    await c.post("/patients", { name: "中村 ゆう", m3ChartNo: "5501" });
    await expect(c.post("/patients", { name: "別の人", m3ChartNo: "5501" })).rejects.toThrow(/M3カルテ番号は 中村 ゆう さん/);
    // 診察券番号があれば番号も示す
    await c.post("/patients", { name: "番号 あり", chartNo: "7001", m3ChartNo: "5502" });
    await expect(c.post("/patients", { name: "別の人", m3ChartNo: "5502" })).rejects.toThrow(/M3カルテ番号は 診察券7001（番号 あり）/);
    await expect(c.post("/patients", { name: "記号", m3ChartNo: "55#01" })).rejects.toThrow(/英数字/);
  });

  it("M3カルテ番号で検索でき、重複の候補にも出る", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "小林 まい", m3ChartNo: "880012" });
    expect((await c.get("/patients?q=880012")).items.map((p: { id: string }) => p.id)).toContain(a.id);
    // 削除した患者の番号は使える（統合・誤登録の後始末）
    await c.post(`/patients/${a.id}/delete`, { version: a.version, reason: "誤登録" });
    const b = await c.post("/patients", { name: "小林 舞", m3ChartNo: "880012" });
    expect(b.m3ChartNo).toBe("880012");
  });

  it("統合すると、統合先の空欄に統合元のM3カルテ番号が入る", async () => {
    const c = await admin();
    const keep = await c.post("/patients", { name: "森 りな", kana: "モリ リナ", birthDate: "1988-08-08" });
    const dup = await c.post("/patients", { name: "森 りな", kana: "モリ リナ", birthDate: "1988-08-08", m3ChartNo: "9090" });
    const merged = await c.post("/patients/merge", { keepId: keep.id, dupId: dup.id, keepVersion: keep.version, dupVersion: dup.version });
    expect(merged.patient.m3ChartNo).toBe("9090");
  });
});
