import { importPricesSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { audit } from "@/lib/server/staff";
import { receiveSheetPrices } from "@/lib/server/store";

/** ファイル・スプレッドシートから料金表を取り込む。同じ取り込み元の分はまるごと入れ替える */
export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    const body = importPricesSchema.parse(await readJson(request, 524_288));
    const r = receiveSheetPrices(body.sheet, body.items);
    audit(actorOf(staff), `料金表を取り込み（${body.sheet}・${body.items.length}件）`);
    return json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
