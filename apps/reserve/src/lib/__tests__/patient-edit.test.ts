import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

const h = withPhp({ demo: true });
const admin = () => h.srv.as("staff-admin");

describe("患者情報の編集", () => {
  it("氏名をローマ字混じりに直せて、版が上がり、変更履歴に項目名だけ残る", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "山田 あんな" });
    const d = await c.patch(`/patients/${p.id}`, { version: p.version, name: "山田 Anna", nameAlt: "Yamada Anna", memo: "敏感肌\n強めの照射NG" });
    expect(d.patient.name).toBe("山田 Anna");
    expect(d.patient.memo).toBe("敏感肌\n強めの照射NG");
    expect(d.patient.version).toBe(p.version + 1);
    expect(d.history[0].fields).toEqual(["氏名", "別の表記", "メモ"]);
    // 履歴に値そのもの（個人情報）は残さない
    expect(JSON.stringify(d.history)).not.toContain("Anna");
  });

  it("古い版での更新は拒否する（同時編集の上書き防止）", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "佐藤 ゆい" });
    await c.patch(`/patients/${p.id}`, { version: p.version, phone: "090-1234-5678" });
    await expect(c.patch(`/patients/${p.id}`, { version: p.version, phone: "080-0000-0000" })).rejects.toThrow(/他の端末/);
  });

  it("空欄にすると項目を消し、変更がなければ版は上がらない", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "LEE Min-ji", phone: "090-1111-2222" });
    const u = (await c.patch(`/patients/${p.id}`, { version: p.version, phone: "" })).patient;
    expect(u.phone).toBeUndefined();
    const same = (await c.patch(`/patients/${p.id}`, { version: u.version, name: "LEE Min-ji" })).patient;
    expect(same.version).toBe(u.version);
  });

  it("入力を検査する", async () => {
    const c = await admin();
    const a = await c.post("/patients", { name: "A" });
    const b = await c.post("/patients", { name: "B", chartNo: "8001" });
    const upd = (x: object) => c.patch(`/patients/${a.id}`, { version: a.version, ...x });
    await expect(upd({ name: "" })).rejects.toThrow(/氏名/);
    await expect(upd({ chartNo: b.chartNo })).rejects.toThrow(/既に使われて/);
    await expect(upd({ birthDate: "2099-01-01" })).rejects.toThrow(/生年月日/);
    await expect(upd({ email: "x@" })).rejects.toThrow(/メール/);
    // 全角数字の電話番号は半角にそろえる
    expect((await upd({ phone: "０９０－１２３４－５６７８" })).patient.phone).toBe("090-1234-5678");
  });

  it("LINEの紐付けを解除できる", async () => {
    const c = await admin();
    let linked: { id: string; version: number; lineUserId?: string } | undefined;
    for (let i = 1; i <= 120 && !linked; i++) {
      const p = (await c.get(`/patients/p-${String(i).padStart(4, "0")}`)).patient;
      if (p.lineUserId) linked = p;
    }
    const d = await c.post(`/patients/${linked!.id}/unlink-line`, { version: linked!.version });
    expect(d.patient.lineUserId).toBeUndefined();
    expect(d.history[0].fields).toEqual(["LINE紐付けの解除"]);
  });
});
