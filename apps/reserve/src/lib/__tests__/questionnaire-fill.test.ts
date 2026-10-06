import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

const answers = [
  { q: "お名前", a: "問診 はなこ" },
  { q: "生年月日", a: "1990-01-02" },
  { q: "ご住所", a: "〒９００-０００１ 沖縄県那覇市港町1-1" },
  { q: "電話番号", a: "090-1111-2222" },
  { q: "アレルギー", a: "ラテックス" },
  { q: "既往歴", a: "なし" },
  { q: "その他のご相談事項", a: "シミが気になる" },
  { q: "来院のきっかけ", a: "特になし" },
];

describe("問診票の回答を患者の基本情報へ写す", () => {
  beforeEach(() => {
    resetStores();
  });

  it("空の欄だけに写し、アレルギーは注意事項、ほかの回答はその他の問診票情報へ", async () => {
    const s = await store();
    const p = s.createPatient({ name: "問診 はなこ", birthDate: "1990-01-02", history: "高血圧" });
    const r = s.receiveQuestionnaires([
      { key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", phone: "090-1111-2222", history: "なし", allergies: "ラテックス", answers },
    ]);
    expect(r.matched).toBe(1);
    const u = s.getPatientDetail(p.id).patient;
    expect(u.phone).toBe("090-1111-2222");
    expect(u.postalCode).toBe("900-0001");
    expect(u.address).toBe("沖縄県那覇市港町1-1");
    expect(u.caution).toBe(true);
    expect(u.cautionNote).toBe("アレルギー：ラテックス");
    expect(u.history).toBe("高血圧");
    expect(u.questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる");
  });

  it("入っている値は変えず、その他は2回目の問診票で足される", async () => {
    const s = await store();
    const p = s.createPatient({ name: "問診 はなこ", birthDate: "1990-01-02", phone: "080-0000-0000", cautionNote: "アルコール綿禁止" });
    s.receiveQuestionnaires([{ key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", phone: "090-1111-2222", allergies: "ラテックス", answers }]);
    s.receiveQuestionnaires([
      { key: "k2", submittedAt: "2026/11/01 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", answers: [{ q: "その他のご相談事項", a: "肝斑も" }] },
    ]);
    const u = s.getPatientDetail(p.id).patient;
    expect(u.phone).toBe("080-0000-0000");
    expect(u.cautionNote).toBe("アルコール綿禁止");
    expect(u.questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる\n\n【問診票 2026/11/01】\nその他のご相談事項：肝斑も");
  });
});

describe("問診票の写し直し", () => {
  it("何度実行しても、その他の問診票情報が重ならない", async () => {
    resetStores();
    const s = await import("@/lib/server/store");
    const p = s.createPatient({ name: "問診 はなこ", birthDate: "1990-01-02" });
    s.receiveQuestionnaires([{ key: "k1", submittedAt: "2026/10/06 10:00:00", name: "問診 はなこ", birthDate: "1990-01-02", answers }]);
    const by = { id: "staff-admin", name: "院長" };
    s.refillFromQuestionnaires(by);
    expect(s.refillFromQuestionnaires(by)).toEqual({ questionnaires: 1, patients: 0 });
    expect(s.getPatientDetail(p.id).patient.questionnaireOther).toBe("【問診票 2026/10/06】\nその他のご相談事項：シミが気になる");
  });
});
