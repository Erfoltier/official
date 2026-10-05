import { priceItemSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { syncPricesIfDue } from "@/lib/server/priceSync";
import { createPriceItem, getPriceList } from "@/lib/server/store";

/** 料金表。前回の取り込みから1日経っていれば、ホームページから取り込み直してから返す */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    await syncPricesIfDue();
    return json(getPriceList());
  } catch (err) {
    return errorResponse(err);
  }
}

/** 自由入力の料金を足す（院長・管理者と受付） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json(createPriceItem(priceItemSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
