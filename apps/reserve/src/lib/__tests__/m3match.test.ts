import { beforeEach, describe, expect, it } from "vitest";
import { birthKey, guessColumns, matchM3, parseCsv } from "@/lib/domain/m3match";

const csv = `患者番号,患者氏名,患者カナ氏名,生年月日,電話番号
00123,照合 花子,ｼｮｳｺﾞｳ ﾊﾅｺ,平成2年1月2日,090-1111-2222
456,照合 太郎,ショウゴウ タロウ,1985/03/04,
457,同名 一,ドウメイ ハジメ,1970/01/01,
458,同名 一,ドウメイ ハジメ,1970/01/01,
`;

describe("M3 の患者一覧との照合（ブラウザの中）", () => {
  it("列を当て、2つ以上合って1人に決まる人だけを採る", () => {
    const [header, ...rows] = parseCsv(csv);
    const col = guessColumns(header);
    expect(col).toEqual({ name: 1, kana: 2, birth: 3, phone: [4], chart: 0 });
    expect(birthKey("平成2年1月2日")).toBe("1990-01-02");
    const r = matchM3(
      [
        { id: "a", name: "ショウゴウ ハナコ", kana: "", birthDate: "1990-01-02", chartNo: "" },
        { id: "b", name: "ショウゴウ タロウ", kana: "ショウゴウ タロウ", chartNo: "" },
        { id: "c", name: "ドウメイ ハジメ", kana: "", birthDate: "1970-01-01", chartNo: "" },
        { id: "d", name: "ショウゴウ タロウ", kana: "", chartNo: "456" },
      ],
      rows,
      col,
    );
    expect(r.fills.map((f) => [f.id, f.name])).toEqual([
      ["a", "照合 花子"],
      ["d", "照合 太郎"],
    ]);
    expect(r.fills[0]).toMatchObject({ kana: "ショウゴウ ハナコ", birthDate: "1990-01-02", phone: "090-1111-2222", m3ChartNo: "00123" });
    expect(r.ambiguous).toBe(1);
    expect(r.notFound).toBe(1);
  });
});

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("照合できた患者へ漢字の氏名を入れる（サーバー）", () => {
  beforeEach(() => {
    resetStores();
  });

  it("カタカナだけの氏名だけを書き換え、空の欄だけ埋め、もとのカナはフリガナへ", async () => {
    const s = await store();
    const a = s.createPatient({ name: "ショウゴウ ハナコ", phone: "080-0000-0000" });
    const b = s.createPatient({ name: "漢字 既存" });
    const ids = s.m3FillCandidates().map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    const r = s.applyM3Fill(
      [
        { id: a.id, name: "照合 花子", birthDate: "1990-01-02", phone: "090-1111-2222", m3ChartNo: "00123" },
        { id: b.id, name: "上書き 不可" },
        { id: a.id, name: "カナのまま" },
      ],
      { id: "t", name: "テスト" },
    );
    expect(r).toEqual({ updated: 1, skipped: 2 });
    const u = s.getPatientDetail(a.id).patient;
    expect(u.name).toBe("照合 花子");
    expect(u.kana).toBe("ショウゴウ ハナコ");
    expect(u.birthDate).toBe("1990-01-02");
    expect(u.phone).toBe("080-0000-0000");
    expect(u.m3ChartNo).toBe("00123");
    expect(s.getPatientDetail(b.id).patient.name).toBe("漢字 既存");
  });
});
