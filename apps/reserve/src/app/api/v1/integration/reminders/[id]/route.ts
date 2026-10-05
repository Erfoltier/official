import { reminderResultSchema, reservationIdParam } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { setReminderStatus } from "@/lib/server/store";

/**
 * 外部連携：リマインドの送信結果を書き戻す。
 *   POST /api/v1/integration/reminders/{reservationId}  {"status":"sent"}
 */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/integration/reminders/[id]">) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const id = reservationIdParam.parse((await ctx.params).id);
    const { status } = reminderResultSchema.parse(await readJson(request));
    const r = setReminderStatus(id, status);
    return json({ reservationId: r.id, reminder: r.reminder });
  } catch (err) {
    return errorResponse(err);
  }
}
