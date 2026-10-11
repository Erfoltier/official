import { describe, expect, it } from "vitest";
import { withPhp, type Client } from "./php/server";

// 問診票は氏名・生年月日などで患者に結びつくので、テストごとにまっさらな DB で確かめる
const h = withPhp({ each: true });

const answers = [
  { q: "お名前", a: "問診 はなこ" },
  { q: "生年月日", a: "1990-01-02" },
  { q: "ご住所", a: "〒９００-０００１ 沖縄県那覇市港町1-1" },
  { q: "電話番号", a: "090-1111-2222" },
  { q: "アレルギー", a: "金属（ニッケル）" },
  { q: "既往歴", a: "なし" },
  { q: "その他のご相談事項", a: "シミが気になる" },
  { q: "来院のきっかけ", a: "特になし" },
];

/** Google フォームの回答を送る係（外部連携のトークンで） */
async function receive(responses: object[]) {
  const r = await h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses }, { Authorization: `Bearer ${h.srv.integrationToken}` });
  expect(r.status).toBe(200);
  return r.data as { matched: number };
}
const patientOf = async (c: Client, id: string) => (await c.get(`/patients/${id}`)).patient;

describe("問診票の回答を患者の基本情報へ写す", () => {
  it("空の欄だけに写し、アレルギーは注意事項、ほかの回答はその他の問診票情報へ", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "問診 はなこ", birthDate: "1990-01-02", history: "高血圧" });
    const r = await receive([
      { key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", phone: "090-1111-2222", history: "なし", allergies: "金属（ニッケル）", answers },
    ]);
    expect(r.matched).toBe(1);
    const u = await patientOf(c, p.id);
    expect(u.phone).toBe("090-1111-2222");
    expect(u.postalCode).toBe("900-0001");
    expect(u.address).toBe("沖縄県那覇市港町1-1");
    expect(u.caution).toBe(true);
    expect(u.cautionNote).toBe("アレルギー：金属（ニッケル）");
    expect(u.history).toBe("高血圧");
    expect(u.questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる");
  });

  it("入っている値は変えず、その他は2回目の問診票で足される", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "問診 はなこ", birthDate: "1990-01-02", phone: "080-0000-0000", cautionNote: "アルコール綿禁止" });
    await receive([{ key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", phone: "090-1111-2222", allergies: "金属（ニッケル）", answers }]);
    await receive([{ key: "k2", submittedAt: "2026/11/01 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", answers: [{ q: "その他のご相談事項", a: "肝斑も" }] }]);
    const u = await patientOf(c, p.id);
    expect(u.phone).toBe("080-0000-0000");
    expect(u.cautionNote).toBe("アルコール綿禁止");
    expect(u.questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる\n\n【問診票 2026/11/01】\nその他のご相談事項：肝斑も");
  });

  it("トークンがなければ受け付けない", async () => {
    const r = await h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses: [] }, { Authorization: "Bearer wrong" });
    expect(r.status).toBe(401);
  });
});

describe("問診票の写し直し", () => {
  it("何度実行しても、その他の問診票情報が重ならない", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "問診 はなこ", birthDate: "1990-01-02" });
    await receive([{ key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", answers }]);
    await c.post("/questionnaires/refill");
    expect(await c.post("/questionnaires/refill")).toEqual({ questionnaires: 1, patients: 0 });
    expect((await patientOf(c, p.id)).questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる");
  });
});

describe("性別・生年月日", () => {
  it("問診票の性別・生年月日を空欄に写し、性別の入力は女性・男性・その他にそろえる", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "性別 はなこ", phone: "090-3333-4444" });
    await receive([{ key: "s1", submittedAt: "2026/10/06 10:00:00", name: "性別 はなこ", phone: "090-3333-4444", birthDate: "1991-02-03", answers: [{ q: "性別", a: "女" }] }]);
    const u = await patientOf(c, p.id);
    expect(u.sex).toBe("female");
    expect(u.birthDate).toBe("1991-02-03");
    expect(u.questionnaireOther).toBeUndefined();
    const m = (await c.patch(`/patients/${p.id}`, { version: u.version, sex: "男性" })).patient;
    expect(m.sex).toBe("male");
    await expect(c.patch(`/patients/${p.id}`, { version: m.version, sex: "?" })).rejects.toThrow(/性別/);
  });
});

describe("花粉症", () => {
  it("花粉症はアレルギーとして注意事項に出さず、ほかのアレルギーは残す。以前の自動の注意事項も直す", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/patients", { name: "花粉 いちこ", phone: "090-1000-0001" });
    const b = await c.post("/patients", { name: "花粉 にこ", phone: "090-1000-0002" });
    const x = await c.post("/patients", { name: "花粉 さんこ", phone: "090-1000-0003", caution: true, cautionNote: "アレルギー：無し, 動物" });
    await receive([
      { key: "h1", submittedAt: "2026/10/06", name: "花粉 いちこ", phone: "090-1000-0001", allergies: "花粉症", answers: [] },
      { key: "h2", submittedAt: "2026/10/06", name: "花粉 にこ", phone: "090-1000-0002", allergies: "無し, 動物, 花粉症, 内服薬（ペニシリン）, アルコール", answers: [] },
      { key: "h3", submittedAt: "2026/10/06", name: "花粉 さんこ", phone: "090-1000-0003", allergies: "無し, 動物", answers: [] },
    ]);
    expect((await patientOf(c, a.id)).cautionNote).toBeUndefined();
    expect((await patientOf(c, b.id)).cautionNote).toBe("アレルギー：内服薬（ペニシリン）、アルコール");
    const cc = await patientOf(c, x.id);
    expect(cc.cautionNote).toBeUndefined();
    expect(cc.caution).toBeFalsy();
  });
  it("メールアドレスの回答を、患者のメールが空のときだけ写す（全角でも拾う。入っているメールは変えない）", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/patients", { name: "問診 めーる", birthDate: "1991-02-03" });
    const b = await c.post("/patients", { name: "問診 すでに", birthDate: "1992-03-04", email: "keep@example.jp" });
    await receive([
      { key: "m1", submittedAt: "2026/10/06 10:00:00", name: "問診 めーる", birthDate: "1991-02-03", answers: [{ q: "メールアドレス", a: "ｈａｎａ．ｋｏ＠ｅｘａｍｐｌｅ．ｊｐ" }] },
      { key: "m2", submittedAt: "2026/10/06 10:05:00", name: "問診 すでに", birthDate: "1992-03-04", answers: [{ q: "Eメール", a: "new@example.jp" }] },
    ]);
    expect((await patientOf(c, a.id)).email).toBe("hana.ko@example.jp");
    expect((await patientOf(c, b.id)).email).toBe("keep@example.jp");
  });
});
