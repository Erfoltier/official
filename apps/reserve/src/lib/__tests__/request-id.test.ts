import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const h = withPhp();
const integration = (method: string, p: string, body?: unknown) =>
  h.srv.client().raw(method, `/api/v1/integration${p}`, body, { Authorization: `Bearer ${h.srv.integrationToken}` });

describe("予約申請ID", () => {
  it("予約に付けられ、患者画面・検索・外部連携の一覧に出る。空で削除できる", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "試験 太郎", kana: "シケン タロウ" });
    const day = addDays(nowInClinic().date, 3);
    const r = await c.post("/reservations", {
      patientId: p.id,
      laneId: "lane-main",
      menuIds: ["menu-s00009A18E"],
      startAt: toIso(day, 600),
      endAt: toIso(day, 610),
      requestId: "R2026100506574020A34A8B",
    });
    expect(r.requestId).toBe("R2026100506574020A34A8B");
    expect((await c.get(`/patients/${p.id}`)).upcoming[0].requestId).toBe("R2026100506574020A34A8B");
    // 小文字・全角で探しても見つかる
    expect((await c.get("/patients?q=r2026100506574020a34a8b")).items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await c.get(`/patients?q=${encodeURIComponent("Ｒ２０２６１００５０６５７４０２０Ａ３４Ａ８Ｂ")}`)).items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const feed = (await integration("GET", `/reminders?date=${day}`)).data as { items: { reservationId: string; requestId?: string }[] };
    expect(feed.items.find((i) => i.reservationId === r.id)?.requestId).toBe("R2026100506574020A34A8B");

    const cleared = await c.patch(`/reservations/${r.id}`, { version: r.version, requestId: "" });
    expect(cleared.requestId).toBeUndefined();
  });

  it("外部連携から予約申請IDとM3カルテ番号を書き込める（記録上は「外部連携」）", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "連携 花子" });
    const day = addDays(nowInClinic().date, 2);
    const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610) });
    const r2 = await integration("POST", `/reservations/${r.id}/request-id`, { requestId: "R20261005ABC" });
    expect(r2.data).toMatchObject({ reservationId: r.id, requestId: "R20261005ABC" });
    const after = (await c.get(`/day?date=${day}`)).reservations.find((x: { id: string }) => x.id === r.id);
    expect(after.updatedBy).toEqual({ id: "integration", name: "外部連携" });
    const p2 = await integration("POST", `/patients/${p.id}/m3-chart-no`, { m3ChartNo: "７７８８" });
    expect(p2.data).toMatchObject({ patientId: p.id, m3ChartNo: "7788" });
    expect((await c.get(`/patients/${p.id}`)).history[0]).toMatchObject({ fields: ["M3カルテ番号"], by: { name: "外部連携" } });
    const none = await integration("POST", "/reservations/r-none/request-id", { requestId: "R1" });
    expect(none.status).toBe(404);
    expect(JSON.stringify(none.data)).toMatch(/見つかりません/);
    // トークンが違えば断る
    const bad = await h.srv.client().raw("POST", `/api/v1/integration/reservations/${r.id}/request-id`, { requestId: "R2" }, { Authorization: "Bearer wrong" });
    expect(bad.status).toBe(401);
  });
});
