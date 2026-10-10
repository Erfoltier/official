import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// デモデータ（2週間前〜90日先は毎日予約が入っている）で確かめる
const h = withPhp({ demo: true });
const day = addDays(nowInClinic().date, 7);
const at = (min: number) => toIso(day, min);

/** その日の、キャンセルでない予約を1件（テストごとに別の予約を使う） */
let used = 0;
async function pick() {
  const c = await h.srv.as("staff-rc1");
  const list = (await c.get(`/day?date=${day}`)).reservations.filter((r: { status: string }) => r.status === "booked");
  return { c, r: list[used++] };
}

describe("store", () => {
  it("デモデータの日は予約が入っていて、何度読んでも同じ", async () => {
    const c = await h.srv.as("staff-rc1");
    const a = (await c.get(`/day?date=${day}`)).reservations.map((r: { id: string }) => r.id);
    expect(a.length).toBeGreaterThan(20);
    expect((await c.get(`/day?date=${day}`)).reservations.map((r: { id: string }) => r.id)).toEqual(a);
  });

  it("予約の移動で版が上がり、古い版での更新は拒否する", async () => {
    const { c, r } = await pick();
    const moved = await c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(18 * 60), endAt: at(18 * 60 + 10) });
    expect(moved.version).toBe(r.version + 1);
    expect(moved.reminder.status).toBe("pending");
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, status: "arrived" })).rejects.toThrow(/他の端末/);
  });

  it("不正な時間を拒否する", async () => {
    const { c, r } = await pick();
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(18 * 60), endAt: at(17 * 60) })).rejects.toThrow(/400/);
    await expect(c.patch(`/reservations/${r.id}`, { version: r.version, startAt: at(23 * 60), endAt: toIso(addDays(day, 1), 60) })).rejects.toThrow(/日をまたぐ/);
  });

  it("時刻を変えた予約はリマインドを未送信に戻す", async () => {
    const { c, r } = await pick();
    const res = await h.srv.client().raw("POST", `/api/v1/integration/reminders/${r.id}`, { status: "sent" }, { Authorization: `Bearer ${h.srv.integrationToken}` });
    expect(res.data).toMatchObject({ reservationId: r.id, reminder: { status: "sent" } });
    const sent = (await c.get(`/day?date=${day}`)).reservations.find((x: { id: string }) => x.id === r.id);
    const memoOnly = await c.patch(`/reservations/${r.id}`, { version: sent.version, memo: "x" });
    expect(memoOnly.reminder.status).toBe("sent");
    const moved = await c.patch(`/reservations/${r.id}`, { version: memoOnly.version, startAt: at(18 * 60 + 30), endAt: at(18 * 60 + 40) });
    expect(moved.reminder.status).toBe("pending");
  });
});

describe("reminder feed", () => {
  it("キャンセルを除き、送信に必要な項目だけを返す", async () => {
    const res = await h.srv.client().raw("GET", `/api/v1/integration/reminders?date=${day}`, undefined, { Authorization: `Bearer ${h.srv.integrationToken}` });
    const feed = res.data as { schemaVersion: number; items: { patient: object; startAt: string; reservationId: string }[] };
    expect(feed.schemaVersion).toBe(1);
    expect(feed.items.length).toBeGreaterThan(0);
    const item = feed.items[0];
    expect(Object.keys(item).sort()).toEqual(
      ["endAt", "laneName", "menuNames", "patient", "reminderStatus", "requestId", "reservationId", "startAt", "version"].sort(),
    );
    expect(Object.keys(item.patient).sort()).toEqual(["email", "id", "lineUserId", "m3ChartNo", "name", "phone"]);
    expect(item.startAt).toMatch(new RegExp(`^${day}T\\d{2}:\\d{2}:00\\+09:00$`));
    // キャンセルした予約は出ない
    const c = await h.srv.as("staff-rc1");
    const cancelled = (await c.get(`/day?date=${day}`)).reservations.filter((r: { status: string }) => r.status === "cancelled").map((r: { id: string }) => r.id);
    expect(feed.items.some((i) => cancelled.includes(i.reservationId))).toBe(false);
  });
});
