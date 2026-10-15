import { describe, expect, it } from "vitest";
import { matchQuestionnairesM3, type M3Columns } from "@/lib/domain/m3match";
import { withPhp } from "./php/server";

const col: M3Columns = { chart: 0, name: 1, kana: 2, birth: 3, phone: [4] };
const rows = [
  ["1001", "山田 花子", "ヤマダ ハナコ", "1990/01/02", "090-1111-0001"],
  ["1002", "鈴木 一郎", "スズキ イチロウ", "1980/05/06", "090-1111-0002"],
  ["1003", "佐藤 三郎", "サトウ サブロウ", "1970/07/08", ""],
  ["1004", "田中 同名", "タナカ ドウメイ", "2000/01/01", ""],
  ["1005", "田中 同名", "タナカ ドウメイ", "2000/01/01", ""],
  ["1006", "高橋 予約", "タカハシ ヨヤク", "1985/03/03", ""],
  ["1007", "伊藤 同姓", "イトウ ドウセイ", "1960/01/01", ""],
  ["1008", "伊藤 同姓", "イトウ ドウセイ", "1961/02/02", ""],
];

describe("M3 の患者一覧で未確認の問診票を照合", () => {
  it("M3 で1人に決まった人を、いる患者（重複なら M3 番号の患者）か新規登録に振り分ける", () => {
    const patients = [
      // 予約カレンダーではカタカナだけ（問診票は漢字）→ M3 のフリガナでつながる
      { id: "p-a", name: "ヤマダ ハナコ", kana: "", birthDate: "1990-01-02", chartNo: "50" },
      // 重複：M3 番号を持つ方を選ぶ
      { id: "p-b1", name: "スズキ イチロウ", kana: "", chartNo: "10" },
      { id: "p-b2", name: "鈴木 一郎", kana: "スズキ イチロウ", chartNo: "20", m3ChartNo: "1002" },
      // Airリザーブから来た患者（カタカナだけ・生年月日も電話もない）。M3 に同姓同名がいなければ氏名だけで決める
      { id: "p-c", name: "タカハシ ヨヤク", kana: "", chartNo: "" },
      // M3 に同姓同名が2人いるので、氏名だけでは決めない
      { id: "p-d", name: "イトウ ドウセイ", kana: "", chartNo: "" },
    ];
    const qs = [
      { id: "q1", name: "山田花子", birthDate: "1990-01-02" },
      { id: "q2", name: "鈴木 一郎", phone: "09011110002" },
      { id: "q3", name: "佐藤 三郎", birthDate: "1970-07-08" },
      { id: "q4", name: "田中 同名", birthDate: "2000-01-01" },
      { id: "q5", name: "来院 なし", birthDate: "1999-09-09" },
      { id: "q6", name: "高橋 予約", birthDate: "1985-03-03" },
      { id: "q7", name: "伊藤 同姓", birthDate: "1960-01-01" },
    ];
    const r = matchQuestionnairesM3(qs, patients, rows, col);
    expect(r.links).toEqual([
      { questionnaireId: "q1", label: "山田花子", m3ChartNo: "1001", patientId: "p-a", via: "nameBirth" },
      { questionnaireId: "q2", label: "鈴木 一郎", m3ChartNo: "1002", patientId: "p-b2", via: "number" },
      { questionnaireId: "q6", label: "高橋 予約", m3ChartNo: "1006", patientId: "p-c", via: "nameOnly" },
    ]);
    expect(r.creates).toEqual([
      { questionnaireId: "q3", label: "佐藤 三郎", m3ChartNo: "1003", create: { name: "佐藤 三郎", kana: "サトウ サブロウ", birthDate: "1970-07-08" } },
    ]);
    expect(r.ambiguous).toBe(2);
    expect(r.notFound).toBe(1);
  });
});

const h = withPhp({ each: true });

describe("M3 照合の反映（サーバー）", () => {
  it("いる患者に結びつけて M3 番号を補い、いない方は登録して結びつける", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "ヤマダ ハナコ" });
    const res = await h.srv.client().raw(
      "POST",
      "/api/v1/integration/questionnaires",
      { responses: [
        { key: "m1", submittedAt: "2026/10/01 10:00:00", name: "山田花子", birthDate: "1990-01-02", answers: [{ q: "既往歴", a: "なし" }] },
        { key: "m2", submittedAt: "2026/10/02 10:00:00", name: "佐藤 三郎", birthDate: "1970-07-08", answers: [{ q: "既往歴", a: "なし" }] },
      ] },
      { Authorization: `Bearer ${h.srv.integrationToken}` },
    );
    expect(res.status).toBe(200);
    const cand = await c.get("/admin/m3-questionnaires");
    expect(cand.questionnaires).toHaveLength(2);
    const q1 = cand.questionnaires.find((q: { name: string }) => q.name === "山田花子").id;
    const q2 = cand.questionnaires.find((q: { name: string }) => q.name === "佐藤 三郎").id;
    const r = await c.post("/admin/m3-questionnaires", {
      confirm: "APPLY",
      backup: false,
      items: [
        { questionnaireId: q1, patientId: p.id, m3ChartNo: "1001" },
        { questionnaireId: q2, m3ChartNo: "1003", create: { name: "佐藤 三郎", kana: "サトウ サブロウ", birthDate: "1970-07-08" } },
      ],
    });
    expect(r).toMatchObject({ linked: 2, created: 1, skipped: 0 });
    expect((await c.get(`/patients/${p.id}`)).patient?.m3ChartNo ?? (await c.get(`/patients/${p.id}`)).m3ChartNo).toBe("1001");
    expect((await c.get("/questionnaires/unmatched")).items).toHaveLength(0);
    // 二度目は対象外
    expect(await c.post("/admin/m3-questionnaires", { confirm: "APPLY", backup: false, items: [{ questionnaireId: q1, patientId: p.id, m3ChartNo: "1001" }] })).toMatchObject({ linked: 0, skipped: 1 });
  });
});
