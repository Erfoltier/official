import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteAirFutureReservations } from "@/lib/server/store";

/**
 * Airリザーブから移した今日以降の予約を完全に消す（入れ直しのため。院長・管理者）。
 * 今日より前の予約と患者には触れない。本文に {"confirm":"DELETE"} が要る
 */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const body = (await readJson(request)) as { confirm?: unknown } | null;
    if (!body || body.confirm !== "DELETE") {
      return json({ error: "invalid", message: '確認のため {"confirm":"DELETE"} を送ってください' }, 400);
    }
    return json(deleteAirFutureReservations(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
