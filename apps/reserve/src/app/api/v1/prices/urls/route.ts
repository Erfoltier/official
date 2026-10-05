import { priceUrlsSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { syncPrices } from "@/lib/server/priceSync";
import { setPriceUrls } from "@/lib/server/store";

/** 取り込むホームページを変えて、すぐ取り込む（院長・管理者のみ） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    setPriceUrls(priceUrlsSchema.parse(await readJson(request)).urls, actorOf(staff));
    return json(await syncPrices(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
