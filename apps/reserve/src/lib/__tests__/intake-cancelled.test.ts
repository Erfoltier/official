/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// 受付箱：申請から入れた予約を取り消したら、未対応に戻さず「取消済み」にする（キャンセルの連絡に応じたもの）
const h = withPhp({ each: true });
const RID = "R20261125090000ABCDEF12";

describe("受付箱の取消済み", () => {
  it("予約中は予約済み、取り消すと取消済み（未対応の数に入らない）", async () => {
    const c = await h.srv.as("staff-admin");
    const day = addDays(nowInClinic().date, 3);
    await h.srv.php(`
      Intake::store(['requestId' => '${RID}', 'type' => 'reservation_intake', 'receivedAt' => gmdate('c'), 'source' => ['type' => 'user', 'userId' => 'U' . str_repeat('a', 32)],
        'message' => ['type' => 'text', 'text' => 'x'], 'intake' => ['visitType' => 'returning', 'preferredDate' => '${day}', 'name' => '取消 花子', 'kana' => 'トリケシ ハナコ', 'birthDate' => '1990-01-01']]);
      return true;
    `);
    const state = async () => (await c.get("/intake")).items.find((i: any) => i.requestId === RID)?.state;
    expect(await state()).toBe("new");
    const p = await c.post("/patients", { name: "取消 花子", kana: "トリケシ ハナコ", birthDate: "1990-01-01" });
    const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610), requestId: RID });
    expect(await state()).toBe("booked");
    await c.patch(`/reservations/${r.id}`, { version: r.version, status: "cancelled" });
    expect(await state()).toBe("cancelled");
  });
});
