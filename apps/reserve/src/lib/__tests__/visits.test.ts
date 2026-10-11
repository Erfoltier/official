import { describe, expect, it } from "vitest";
import { addDays, nowInClinic } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const h = withPhp({ demo: true });
const admin = () => h.srv.as("staff-admin");

describe("施術歴・日付ごとの記録", () => {
  it("過去の来院が新しい順に並び、今後の予約は別に近い順で並ぶ", async () => {
    const c = await admin();
    const today = nowInClinic().date;
    // デモの過去データがある患者を探す
    let d: { visits: { date: string }[]; upcoming: { startAt: string }[] } | undefined;
    for (let i = 1; i <= 120 && !d; i++) {
      const x = await c.get(`/patients/p-${String(i).padStart(4, "0")}`);
      if (x.visits.length > 2 && x.upcoming.length > 1) d = x;
    }
    const dates = d!.visits.map((v) => v.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates.every((x) => x <= today)).toBe(true);
    const up = d!.upcoming.map((r) => r.startAt);
    expect([...up].sort()).toEqual(up);
    expect(up.every((x) => x.slice(0, 10) > today)).toBe(true);
  });

  it("予約のない日にもメモとスキンケアを記録でき、版で上書きを防ぐ", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "山田 Anna" });
    const date = addDays(nowInClinic().date, -3);
    const save = (body: object) => c.put(`/patients/${p.id}/visits/${date}`, body);
    const d1 = await save({ note: "電話相談のみ\n次回HIFU希望", skincare: ["ゼオスキン ミラミン", " 日焼け止め  SPF50+ "], version: 0 });
    const row = d1.visits.find((v: { date: string }) => v.date === date);
    expect(row.noteVersion).toBe(1);
    expect(row.skincare).toEqual(["ゼオスキン ミラミン", "日焼け止め SPF50+"]);
    expect(row.reservations).toHaveLength(0);
    expect(row.note).toContain("次回HIFU希望");
    await expect(save({ note: "x", skincare: [], version: 0 })).rejects.toThrow(/他の端末/);
    // 両方空にすると記録を消す
    const d2 = await save({ note: "", skincare: [], version: 1 });
    expect(d2.visits.find((v: { date: string }) => v.date === date)).toBeUndefined();
    expect(d2.history.map((x: { fields: string[] }) => x.fields.join()).join()).toContain("施術メモ・スキンケア");
  });

  it("未来の日付には記録できない", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "A" });
    await expect(c.put(`/patients/${p.id}/visits/${addDays(nowInClinic().date, 1)}`, { note: "x", skincare: [], version: 0 })).rejects.toThrow(/今日まで/);
  });

  it("スキンケア候補は、その患者が使ったもの → 院の定番の順", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "B" });
    const d = await c.put(`/patients/${p.id}/visits/${nowInClinic().date}`, { note: "", skincare: ["自宅用 CICAクリーム"], version: 0 });
    expect(d.skincareSuggestions[0]).toBe("自宅用 CICAクリーム");
  });

  it("共用サーバー向けに POST + X-HTTP-Method-Override でも保存できる", async () => {
    const c = await admin();
    const p = await c.post("/patients", { name: "C" });
    const today = nowInClinic().date;
    const d = await c.call("POST", `/api/v1/patients/${p.id}/visits/${today}`, { note: "上書き指定", skincare: [], version: 0 }, { "X-HTTP-Method-Override": "PUT" });
    expect(d.visits.find((v: { date: string }) => v.date === today).note).toBe("上書き指定");
  });
});
