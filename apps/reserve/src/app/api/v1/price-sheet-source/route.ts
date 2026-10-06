import { consentSourceSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { priceSheetSourceInfo, setPriceSheetSource } from "@/lib/server/store";

/** 料金表（スプレッドシート）の読み込み元（キーは返さない）。院長・管理者のみ */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json(priceSheetSourceInfo());
  } catch (err) {
    return errorResponse(err);
  }
}

/** 料金表（スプレッドシート）の読み込み元を変える（url を空にすると止める）。院長・管理者のみ */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(setPriceSheetSource(consentSourceSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
