import { beforeEach, describe, expect, it } from "vitest";
import { addDays, nowInClinic } from "@/lib/domain/time";

async function store() {
  (globalThis as { __reserveStore?: unknown }).__reserveStore = undefined;
  return import("@/lib/server/store");
}

describe("施術歴・日付ごとの記録", () => {
  beforeEach(() => {
    (globalThis as { __reserveStore?: unknown }).__reserveStore = undefined;
  });

  it("過去の来院が新しい順に並び、今後の予約は別に近い順で並ぶ", async () => {
    const s = await store();
    const today = nowInClinic().date;
    // デモの過去データがある患者を探す
    const p = s.searchPatients("").find((x) => s.getPatientDetail(x.id).visits.length > 2)
      ?? Array.from({ length: 120 }, (_, i) => s.getPatient(`p-${String(i + 1).padStart(4, "0")}`)!).find((x) => s.getPatientDetail(x.id).visits.length > 2)!;
    const d = s.getPatientDetail(p.id);
    const dates = d.visits.map((v) => v.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates.every((x) => x <= today)).toBe(true);
    const up = d.upcoming.map((r) => r.startAt);
    expect([...up].sort()).toEqual(up);
    expect(up.every((x) => x.slice(0, 10) > today)).toBe(true);
  });

  it("予約のない日にもメモとスキンケアを記録でき、版で上書きを防ぐ", async () => {
    const s = await store();
    const p = s.createPatient({ name: "山田 Anna" });
    const date = addDays(nowInClinic().date, -3);
    const n = s.saveVisitNote(p.id, date, { note: "電話相談のみ\n次回HIFU希望", skincare: ["ゼオスキン ミラミン", " 日焼け止め  SPF50+ "], version: 0 })!;
    expect(n.version).toBe(1);
    expect(n.skincare).toEqual(["ゼオスキン ミラミン", "日焼け止め SPF50+"]);
    const row = s.getPatientDetail(p.id).visits.find((v) => v.date === date)!;
    expect(row.reservations).toHaveLength(0);
    expect(row.note).toContain("次回HIFU希望");
    expect(() => s.saveVisitNote(p.id, date, { note: "x", skincare: [], version: 0 })).toThrow(/他の端末/);
    // 両方空にすると記録を消す
    expect(s.saveVisitNote(p.id, date, { note: "", skincare: [], version: 1 })).toBeNull();
    expect(s.getPatientDetail(p.id).visits.find((v) => v.date === date)).toBeUndefined();
    expect(s.getPatientDetail(p.id).history.map((h) => h.fields.join()).join()).toContain("施術メモ・スキンケア");
  });

  it("未来の日付には記録できない", async () => {
    const s = await store();
    const p = s.createPatient({ name: "A" });
    expect(() => s.saveVisitNote(p.id, addDays(nowInClinic().date, 1), { note: "x", skincare: [], version: 0 })).toThrow(/今日まで/);
  });

  it("スキンケア候補は、その患者が使ったもの → 院の定番の順", async () => {
    const s = await store();
    const p = s.createPatient({ name: "B" });
    s.saveVisitNote(p.id, nowInClinic().date, { note: "", skincare: ["自宅用 CICAクリーム"], version: 0 });
    expect(s.getPatientDetail(p.id).skincareSuggestions[0]).toBe("自宅用 CICAクリーム");
  });
});
