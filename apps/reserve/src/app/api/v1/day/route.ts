import type { NextRequest } from "next/server";
import { dateParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getDayBundle } from "@/lib/server/store";

/** カレンダー画面用：1日分の予約・レーン・メニュー・患者 */
export async function GET(request: NextRequest) {
  try {
    requireStaff(request);
    const date = dateParam.parse(request.nextUrl.searchParams.get("date"));
    return json(getDayBundle(date));
  } catch (err) {
    return errorResponse(err);
  }
}
