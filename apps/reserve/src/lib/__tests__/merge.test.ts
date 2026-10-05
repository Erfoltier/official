import { beforeEach, describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";

const reset = () => {
  resetStores();
};
const rc = { id: "staff-rc1", name: "受付A（デモ）" };

describe("患者の削除・復元", () => {
  beforeEach(reset);

  it("削除すると検索に出ず、記録は残り、復元できる", async () => {
    const s = await import("@/lib/server/store");
    const p = s.createPatient({ name: "誤登録 テスト", kana: "ゴトウロク" });
    const today = nowInClinic().date;
    s.saveVisitNote(p.id, today, { note: "メモ", skincare: [], version: 0 });
    const d = s.deletePatient(p.id, { version: p.version, reason: "誤って登録した" }, rc);
    expect(d.deleted?.reason).toBe("誤って登録した");
    expect(d.deleted?.by).toEqual(rc);
    expect(s.searchPatients("ゴトウロク")).toHaveLength(0);
    // 記録は残る
    expect(s.getPatientDetail(p.id).visits[0].note).toBe("メモ");
    // 削除された患者は編集・予約できない
    expect(() => s.updatePatient(p.id, { version: d.version, name: "x" })).toThrow(/復元/);
    expect(() =>
      s.createReservation({ patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(today, 600), endAt: toIso(today, 610) }),
    ).toThrow(/患者が見つかりません/);
    const r = s.restorePatient(p.id, d.version, rc);
    expect(r.deleted).toBeUndefined();
    expect(s.searchPatients("ゴトウロク")).toHaveLength(1);
  });

  it("今日以降の予約がある患者は削除できない", async () => {
    const s = await import("@/lib/server/store");
    const p = s.createPatient({ name: "予約あり" });
    const day = addDays(nowInClinic().date, 2);
    s.createReservation({ patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610) });
    expect(() => s.deletePatient(p.id, { version: p.version, reason: "誤って登録した" })).toThrow(/予約が1件/);
  });
});

describe("重複患者の統合", () => {
  beforeEach(reset);

  it("重複の候補を見つける", async () => {
    const s = await import("@/lib/server/store");
    const a = s.createPatient({ name: "山田 Anna", kana: "やまだ あんな", phone: "090-1234-5678" });
    s.createPatient({ name: "山田 アンナ", kana: "ヤマダ アンナ" });
    s.createPatient({ name: "別人", phone: "09012345678" });
    const reasons = s.getPatientDetail(a.id).duplicates.map((d) => `${d.patient.name}:${d.reasons.join("/")}`);
    expect(reasons).toContain("山田 アンナ:フリガナが同じ");
    expect(reasons).toContain("別人:電話番号が同じ");
  });

  it("予約・記録を移し、空欄を埋め、統合元は削除扱いで残る", async () => {
    const s = await import("@/lib/server/store");
    const staff = await import("@/lib/server/staff");
    const today = nowInClinic().date;
    const past = addDays(today, -7);
    const keep = s.createPatient({ name: "山田 あんな", kana: "ヤマダ アンナ", birthDate: "1990-04-01", memo: "敏感肌" });
    const dup = s.createPatient({ name: "山田　あんな", kana: "やまだあんな", phone: "090-1111-2222", email: "a@example.com", birthDate: "1990-04-01", memo: "金属アレルギー" });
    const future = addDays(today, 3);
    const r = s.createReservation({ patientId: dup.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(future, 600), endAt: toIso(future, 610) });
    s.saveVisitNote(keep.id, past, { note: "keep側の記録", skincare: ["A"], version: 0 });
    s.saveVisitNote(dup.id, past, { note: "dup側の記録", skincare: ["B"], version: 0 });
    s.saveVisitNote(dup.id, today, { note: "今日の記録", skincare: [], version: 0 });

    const k = s.getPatient(keep.id)!;
    const d = s.getPatient(dup.id)!;
    const pv = s.previewMerge(k.id, d.id);
    expect(pv).toMatchObject({ reservations: 1, visitNotes: 2, sameDayNotes: [past], filledFields: ["電話", "メール"], identical: true, mismatch: [] });

    const merged = s.mergePatients({ keepId: k.id, dupId: d.id, keepVersion: k.version, dupVersion: d.version }, rc);
    expect(merged.phone).toBe("090-1111-2222");
    expect(merged.email).toBe("a@example.com");
    expect(merged.memo).toContain("敏感肌");
    expect(merged.memo).toContain("金属アレルギー");

    const detail = s.getPatientDetail(k.id);
    expect(detail.upcoming.map((x) => x.id)).toContain(r.id);
    const pastRow = detail.visits.find((v) => v.date === past)!;
    expect(pastRow.note).toContain("keep側の記録");
    expect(pastRow.note).toContain("dup側の記録");
    expect(pastRow.skincare).toEqual(["A", "B"]);
    expect(detail.visits.find((v) => v.date === today)?.note).toBe("今日の記録");
    expect(detail.history[0].by).toEqual(rc);

    const dupAfter = s.getPatient(d.id)!;
    expect(dupAfter.mergedInto).toBe(k.id);
    expect(dupAfter.deleted).toBeTruthy();
    expect(() => s.restorePatient(d.id, dupAfter.version)).toThrow(/統合された/);
    // 操作ログに氏名は残らない
    expect(JSON.stringify(staff.listAudit())).not.toContain("山田");
  });

  it("姓名・セイメイ・生年月日のどれかが違う（未入力を含む）と統合できない", async () => {
    const s = await import("@/lib/server/store");
    const a = s.createPatient({ name: "佐藤 花", kana: "サトウ ハナ", birthDate: "1995-05-05", phone: "090-5555-0000" });
    const b = s.createPatient({ name: "佐藤 華", kana: "サトウ ハナ", birthDate: "1995-05-05", phone: "090-5555-0000" });
    const c = s.createPatient({ name: "佐藤 花", kana: "サトウ ハナ", phone: "090-5555-0000" });
    expect(s.previewMerge(a.id, b.id)).toMatchObject({ identical: false, mismatch: ["姓名"] });
    expect(s.previewMerge(a.id, c.id).mismatch).toEqual(["生年月日（未入力）"]);
    expect(() => s.mergePatients({ keepId: a.id, dupId: b.id, keepVersion: a.version, dupVersion: b.version })).toThrow(/一致しない項目：姓名/);
    // 重複の候補には出るが、統合できないことが分かる
    const cand = s.getPatientDetail(a.id).duplicates;
    expect(cand.find((d) => d.patient.id === b.id)).toMatchObject({ identical: false, mismatch: ["姓名"] });
    // 生年月日をそろえれば統合できる
    const c2 = s.updatePatient(c.id, { version: c.version, birthDate: "1995-05-05" });
    expect(s.getPatientDetail(a.id).duplicates.find((d) => d.patient.id === c.id)?.identical).toBe(true);
    expect(s.mergePatients({ keepId: a.id, dupId: c.id, keepVersion: a.version, dupVersion: c2.version }).id).toBe(a.id);
  });

  it("古い版・同じ患者どうし・削除済みは統合できない", async () => {
    const s = await import("@/lib/server/store");
    const a = s.createPatient({ name: "A", kana: "エー", birthDate: "2000-01-01" });
    const b = s.createPatient({ name: "A", kana: "エー", birthDate: "2000-01-01" });
    expect(() => s.mergePatients({ keepId: a.id, dupId: a.id, keepVersion: 1, dupVersion: 1 })).toThrow(/同じ患者/);
    s.updatePatient(b.id, { version: b.version, phone: "090-0000-0000" });
    expect(() => s.mergePatients({ keepId: a.id, dupId: b.id, keepVersion: 1, dupVersion: 1 })).toThrow(/他の端末/);
  });
});
