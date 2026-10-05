import { errorResponse, json } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { syncPrices } from "@/lib/server/priceSync";

/** 今すぐホームページから取り込む（院長・管理者と受付） */
export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    return json(await syncPrices(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
