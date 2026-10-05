import { integrationPricesSchema } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { receiveSheetPrices } from "@/lib/server/store";

/**
 * 外部連携：スプレッドシート（Apps Script）から料金表を送る。そのシートの分をまるごと入れ替える。
 *   POST /api/v1/integration/prices  {"sheet":"自費商品、メニュー外値段表","items":[{"category":"ゼオスキンヘルス","name":"ミラミン","priceYen":13900}]}
 */
export async function POST(request: Request) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const body = integrationPricesSchema.parse(await readJson(request, 262_144));
    return json(receiveSheetPrices(body.sheet, body.items));
  } catch (err) {
    return errorResponse(err);
  }
}
