import type { NextRequest } from "next/server";
import { dateParam } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json } from "@/lib/server/http";
import { buildReminderFeed } from "@/lib/server/reminders";

/**
 * 外部連携：指定日の予約一覧（前日リマインド用）。
 *   GET /api/v1/integration/reminders?date=2026-10-07
 *   Authorization: Bearer <INTEGRATION_API_TOKEN>
 */
export async function GET(request: NextRequest) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const date = dateParam.parse(request.nextUrl.searchParams.get("date"));
    return json(buildReminderFeed(date));
  } catch (err) {
    return errorResponse(err);
  }
}
