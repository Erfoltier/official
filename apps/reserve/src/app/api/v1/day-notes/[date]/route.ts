import { dateParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getDayNotes } from "@/lib/server/store";

/** その日の Todaysメモ（レーンID → 本文） */
export async function GET(request: Request, ctx: { params: Promise<{ date: string }> }) {
  try {
    requireStaff(request);
    return json(getDayNotes(dateParam.parse((await ctx.params).date)));
  } catch (err) {
    return errorResponse(err);
  }
}
