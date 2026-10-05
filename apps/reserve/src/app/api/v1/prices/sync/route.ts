import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { syncPrices } from "@/lib/server/priceSync";

/** 今すぐホームページから取り込む（院長・管理者と受付） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json(await syncPrices(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
