import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { countAirFutureReservations } from "@/lib/server/store";

/** Airリザーブから移した今日以降の予約（メモに「Air予約番号」）の件数（院長・管理者） */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json(countAirFutureReservations());
  } catch (err) {
    return errorResponse(err);
  }
}
