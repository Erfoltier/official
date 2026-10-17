import { describe, expect, it } from "vitest";
import { birthKey, guessColumns, matchM3, parseCsv } from "@/lib/domain/m3match";
import { withPhp } from "./php/server";

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

describe("照合できた患者へ漢字の氏名を入れる（サーバー）", () => {
  const h = withPhp();

  it("カタカナだけの氏名だけを書き換え、空の欄だけ埋め、もとのカナはフリガナへ", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/patients", { name: "ショウゴウ ハナコ", phone: "080-0000-0000" });
    const b = await c.post("/patients", { name: "漢字 既存" });
    const ids = (await c.get("/admin/m3-fill")).items.map((x: { id: string }) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    const r = await c.post("/admin/m3-fill", {
      confirm: "APPLY",
      items: [
        { id: a.id, name: "照合 花子", birthDate: "1990-01-02", phone: "090-1111-2222", m3ChartNo: "00123" },
        { id: b.id, name: "上書き 不可" },
        { id: a.id, name: "カナのまま" },
      ],
    });
    expect(r).toMatchObject({ updated: 1, skipped: 2 });
    // 書き換える前に控えを取る
    expect(r.backup).toMatch(/^backups\/docs-.*\.db$/);
    const u = (await c.get(`/patients/${a.id}`)).patient;
    expect(u.name).toBe("照合 花子");
    expect(u.kana).toBe("ショウゴウ ハナコ");
    expect(u.birthDate).toBe("1990-01-02");
    expect(u.phone).toBe("080-0000-0000");
    expect(u.m3ChartNo).toBe("00123");
    expect((await c.get(`/patients/${b.id}`)).patient.name).toBe("漢字 既存");
    // 確認の言葉がなければ書き換えない
    await expect(c.post("/admin/m3-fill", { items: [] })).rejects.toThrow(/APPLY/);
  });
});
