import { describe, expect, it, beforeEach } from "vitest";

async function freshStore() {
  (globalThis as { __reserveStore?: unknown }).__reserveStore = undefined;
  return import("@/lib/server/store");
}

describe("store", () => {
  beforeEach(() => {
    (globalThis as { __reserveStore?: unknown }).__reserveStore = undefined;
  });

  it("同じ日付は同じダミー予約を返す", async () => {
    const s = await freshStore();
    const a = s.getDayBundle("2026-10-07").reservations.map((r) => r.id);
    expect(a.length).toBeGreaterThan(20);
    expect(s.getDayBundle("2026-10-07").reservations.map((r) => r.id)).toEqual(a);
  });

  it("予約の移動で版が上がり、古い版での更新は拒否する", async () => {
    const s = await freshStore();
    const r = s.getDayBundle("2026-10-07").reservations[0];
    const moved = s.updateReservation(r.id, {
      version: r.version,
      startAt: "2026-10-07T18:00:00+09:00",
      endAt: "2026-10-07T18:10:00+09:00",
    });
    expect(moved.version).toBe(r.version + 1);
    expect(moved.reminder.status).toBe("pending");
    expect(() => s.updateReservation(r.id, { version: r.version, status: "arrived" })).toThrow(/他の端末/);
  });

  it("不正な時間を拒否する", async () => {
    const s = await freshStore();
    const r = s.getDayBundle("2026-10-07").reservations[0];
    expect(() =>
      s.updateReservation(r.id, {
        version: r.version,
        startAt: "2026-10-07T18:00:00+09:00",
        endAt: "2026-10-07T17:00:00+09:00",
      }),
    ).toThrow();
    expect(() =>
      s.updateReservation(r.id, {
        version: r.version,
        startAt: "2026-10-07T23:00:00+09:00",
        endAt: "2026-10-08T01:00:00+09:00",
      }),
    ).toThrow(/日をまたぐ/);
  });

  it("時刻を変えた予約はリマインドを未送信に戻す", async () => {
    const s = await freshStore();
    const r = s.getDayBundle("2026-10-07").reservations[0];
    const sent = s.setReminderStatus(r.id, "sent");
    expect(sent.reminder.status).toBe("sent");
    const memoOnly = s.updateReservation(r.id, { version: sent.version, memo: "x" });
    expect(memoOnly.reminder.status).toBe("sent");
    const moved = s.updateReservation(r.id, {
      version: memoOnly.version,
      startAt: "2026-10-07T18:30:00+09:00",
      endAt: "2026-10-07T18:40:00+09:00",
    });
    expect(moved.reminder.status).toBe("pending");
  });
});

describe("reminder feed", () => {
  it("キャンセルを除き、送信に必要な項目だけを返す", async () => {
    (globalThis as { __reserveStore?: unknown }).__reserveStore = undefined;
    const { buildReminderFeed } = await import("@/lib/server/reminders");
    const feed = buildReminderFeed("2026-10-07");
    expect(feed.schemaVersion).toBe(1);
    expect(feed.items.length).toBeGreaterThan(0);
    const item = feed.items[0];
    expect(Object.keys(item).sort()).toEqual(
      ["endAt", "laneName", "patient", "reminderStatus", "reservationId", "startAt", "treatmentNames", "version"].sort(),
    );
    expect(Object.keys(item.patient).sort()).toEqual(["email", "id", "lineUserId", "name", "phone"]);
    expect(item.startAt).toMatch(/^2026-10-07T\d{2}:\d{2}:00\+09:00$/);
  });
});
