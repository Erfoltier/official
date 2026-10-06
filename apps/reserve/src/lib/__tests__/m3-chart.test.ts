import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("M3カルテ番号", () => {
  beforeEach(() => {
    resetStores();
  });

  it("登録・変更でき、全角で入れても半角にそろう。変更履歴には項目名だけ残る", async () => {
    const s = await store();
    const p = s.createPatient({ name: "高橋 Mio", m3ChartNo: "００１２３４" });
    expect(p.m3ChartNo).toBe("001234");
    const u = s.updatePatient(p.id, { version: p.version, m3ChartNo: "A-778" });
    expect(u.m3ChartNo).toBe("A-778");
    const d = s.getPatientDetail(p.id);
    expect(d.history[0].fields).toEqual(["M3カルテ番号"]);
    expect(JSON.stringify(d.history)).not.toContain("A-778");
    // 空にすると消える
    const cleared = s.updatePatient(p.id, { version: u.version, m3ChartNo: "" });
    expect(cleared.m3ChartNo).toBeUndefined();
  });

  it("同じM3カルテ番号は別の患者に付けられない（どの患者かを示す）", async () => {
    const s = await store();
    s.createPatient({ name: "中村 ゆう", m3ChartNo: "5501" });
    expect(() => s.createPatient({ name: "別の人", m3ChartNo: "5501" })).toThrow(/M3カルテ番号は 中村 ゆう さん/);
    // 診察券番号があれば番号も示す
    s.createPatient({ name: "番号 あり", chartNo: "7001", m3ChartNo: "5502" });
    expect(() => s.createPatient({ name: "別の人", m3ChartNo: "5502" })).toThrow(/M3カルテ番号は 診察券7001（番号 あり）/);
    expect(() => s.createPatient({ name: "記号", m3ChartNo: "55#01" })).toThrow(/英数字/);
  });

  it("M3カルテ番号で検索でき、重複の候補にも出る", async () => {
    const s = await store();
    const a = s.createPatient({ name: "小林 まい", m3ChartNo: "880012" });
    expect(s.searchPatients("880012").map((p) => p.id)).toContain(a.id);
    // 削除した患者の番号は使える（統合・誤登録の後始末）
    s.deletePatient(a.id, { version: a.version, reason: "誤登録" });
    const b = s.createPatient({ name: "小林 舞", m3ChartNo: "880012" });
    expect(b.m3ChartNo).toBe("880012");
  });

  it("統合すると、統合先の空欄に統合元のM3カルテ番号が入る", async () => {
    const s = await store();
    const keep = s.createPatient({ name: "森 りな", kana: "モリ リナ", birthDate: "1988-08-08" });
    const dup = s.createPatient({ name: "森 りな", kana: "モリ リナ", birthDate: "1988-08-08", m3ChartNo: "9090" });
    const merged = s.mergePatients({ keepId: keep.id, dupId: dup.id, keepVersion: keep.version, dupVersion: dup.version });
    expect(merged.m3ChartNo).toBe("9090");
  });
});
