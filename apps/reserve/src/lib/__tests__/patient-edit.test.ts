import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("患者情報の編集", () => {
  beforeEach(() => {
    resetStores();
  });

  it("氏名をローマ字混じりに直せて、版が上がり、変更履歴に項目名だけ残る", async () => {
    const s = await store();
    const p = s.createPatient({ name: "山田 あんな" });
    const u = s.updatePatient(p.id, { version: p.version, name: "山田 Anna", nameAlt: "Yamada Anna", memo: "敏感肌\n強めの照射NG" });
    expect(u.name).toBe("山田 Anna");
    expect(u.memo).toBe("敏感肌\n強めの照射NG");
    expect(u.version).toBe(p.version + 1);
    const d = s.getPatientDetail(p.id);
    expect(d.history[0].fields).toEqual(["氏名", "別の表記", "メモ"]);
    // 履歴に値そのもの（個人情報）は残さない
    expect(JSON.stringify(d.history)).not.toContain("Anna");
  });

  it("古い版での更新は拒否する（同時編集の上書き防止）", async () => {
    const s = await store();
    const p = s.createPatient({ name: "佐藤 ゆい" });
    s.updatePatient(p.id, { version: p.version, phone: "090-1234-5678" });
    expect(() => s.updatePatient(p.id, { version: p.version, phone: "080-0000-0000" })).toThrow(/他の端末/);
  });

  it("空欄にすると項目を消し、変更がなければ版は上がらない", async () => {
    const s = await store();
    const p = s.createPatient({ name: "LEE Min-ji", phone: "090-1111-2222" });
    const u = s.updatePatient(p.id, { version: p.version, phone: "" });
    expect(u.phone).toBeUndefined();
    const same = s.updatePatient(p.id, { version: u.version, name: "LEE Min-ji" });
    expect(same.version).toBe(u.version);
  });

  it("入力を検査する", async () => {
    const s = await store();
    const a = s.createPatient({ name: "A" });
    const b = s.createPatient({ name: "B" });
    expect(() => s.updatePatient(a.id, { version: a.version, name: "" })).toThrow(/氏名/);
    expect(() => s.updatePatient(a.id, { version: a.version, chartNo: b.chartNo })).toThrow(/既に使われて/);
    expect(() => s.updatePatient(a.id, { version: a.version, birthDate: "2099-01-01" })).toThrow(/生年月日/);
    expect(() => s.updatePatient(a.id, { version: a.version, email: "x@" })).toThrow(/メール/);
    // 全角数字の電話番号は半角にそろえる
    expect(s.updatePatient(a.id, { version: a.version, phone: "０９０－１２３４－５６７８" }).phone).toBe("090-1234-5678");
  });

  it("LINEの紐付けを解除できる", async () => {
    const s = await store();
    const linked = s.searchPatients("").find((p) => p.lineUserId) ?? [...Array(120)].map((_, i) => s.getPatient(`p-${String(i + 1).padStart(4, "0")}`)).find((p) => p?.lineUserId)!;
    const u = s.unlinkPatientLine(linked.id, linked.version);
    expect(u.lineUserId).toBeUndefined();
    expect(s.getPatientDetail(linked.id).history[0].fields).toEqual(["LINE紐付けの解除"]);
  });
});
