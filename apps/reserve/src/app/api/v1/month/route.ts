import type { NextRequest } from "next/server";
import { monthParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getMonthCounts } from "@/lib/server/store";

/** 日付ジャンプ用：月の日ごとの予約数 GET ?month=2026-10 */
export async function GET(request: NextRequest) {
  try {
    requireStaff(request);
    const month = monthParam.parse(request.nextUrl.searchParams.get("month"));
    return json({ month, days: getMonthCounts(month) });
  } catch (err) {
    return errorResponse(err);
  }
}
