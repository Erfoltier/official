import { beforeEach, describe, expect, it } from "vitest";
import { nowInClinic, toIso, addDays } from "@/lib/domain/time";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

describe("予約申請ID", () => {
  beforeEach(() => {
    resetStores();
  });

  it("予約に付けられ、患者画面・検索・外部連携の一覧に出る。空で削除できる", async () => {
    const s = await store();
    const { buildReminderFeed } = await import("@/lib/server/reminders");
    const p = s.createPatient({ name: "試験 太郎", kana: "シケン タロウ" });
    const day = addDays(nowInClinic().date, 3);
    const r = s.createReservation({
      patientId: p.id,
      laneId: "lane-main",
      menuIds: ["menu-s00009A18E"],
      startAt: toIso(day, 600),
      endAt: toIso(day, 610),
      requestId: "R2026100506574020A34A8B",
    });
    expect(r.requestId).toBe("R2026100506574020A34A8B");
    expect(s.getPatientDetail(p.id).upcoming[0].requestId).toBe("R2026100506574020A34A8B");
    // 小文字・全角で探しても見つかる
    expect(s.searchPatients("r2026100506574020a34a8b").map((x) => x.id)).toEqual([p.id]);
    expect(buildReminderFeed(day).items.find((i) => i.reservationId === r.id)?.requestId).toBe("R2026100506574020A34A8B");

    const cleared = s.updateReservation(r.id, { version: r.version, requestId: "" });
    expect(cleared.requestId).toBeUndefined();
  });

  it("外部連携から予約申請IDとM3カルテ番号を書き込める（記録上は「外部連携」）", async () => {
    const s = await store();
    const p = s.createPatient({ name: "連携 花子" });
    const day = addDays(nowInClinic().date, 2);
    const r = s.createReservation({ patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610) });
    const r2 = s.setReservationRequestId(r.id, "R20261005ABC");
    expect(r2.requestId).toBe("R20261005ABC");
    expect(r2.updatedBy).toEqual({ id: "integration", name: "外部連携" });
    const p2 = s.setPatientM3ChartNo(p.id, "７７８８");
    expect(p2.m3ChartNo).toBe("7788");
    expect(s.getPatientDetail(p.id).history[0]).toMatchObject({ fields: ["M3カルテ番号"], by: { name: "外部連携" } });
    expect(() => s.setReservationRequestId("r-none", "R1")).toThrow(/見つかりません/);
  });
});
