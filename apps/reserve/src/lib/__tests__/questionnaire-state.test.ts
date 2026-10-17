import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// 予約に出す問診票の状況：初めての来院で届いていなければ missing、届けば done、再診で問診票がなければ出さない
const h = withPhp({ each: true });

describe("問診票の状況", () => {
  it("初診は未記入→記入済、再診は表示しない", async () => {
    const c = await h.srv.as("staff-admin");
    const day = addDays(nowInClinic().date, 2);
    const mk = (patientId: string, d: string) => c.post("/reservations", { patientId, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(d, 600), endAt: toIso(d, 610) });
    const first = await c.post("/patients", { name: "初診 さん", birthDate: "1990-01-01" });
    const repeat = await c.post("/patients", { name: "再診 さん" });
    const r1 = await mk(first.id, day);
    await mk(repeat.id, addDays(nowInClinic().date, -10));
    const r2 = await mk(repeat.id, day);
    const state = async (id: string) => (await c.get(`/day?date=${day}`)).reservations.find((x: { id: string }) => x.id === id)?.questionnaire;
    expect(await state(r1.id)).toBe("missing");
    expect(await state(r2.id)).toBeUndefined();
    const res = await h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses: [{ key: "k-state", submittedAt: "2026/10/14 10:00:00", name: "初診 さん", birthDate: "1990-01-01", answers: [{ q: "お名前", a: "初診 さん" }] }] }, { Authorization: `Bearer ${h.srv.integrationToken}` });
    expect(res.status).toBe(200);
    expect(await state(r1.id)).toBe("done");
  });
});
