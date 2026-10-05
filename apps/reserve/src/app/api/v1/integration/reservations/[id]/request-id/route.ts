import { idParam, integrationRequestIdSchema } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { setReservationRequestId } from "@/lib/server/store";

/**
 * 外部連携：予約に予約申請ID（LINE予約フォーム）を書き込む。
 *   POST /api/v1/integration/reservations/{reservationId}/request-id  {"requestId":"R2026..."}
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const id = idParam.parse((await ctx.params).id);
    const { requestId } = integrationRequestIdSchema.parse(await readJson(request));
    const r = setReservationRequestId(id, requestId);
    return json({ reservationId: r.id, requestId: r.requestId ?? null, version: r.version });
  } catch (err) {
    return errorResponse(err);
  }
}
