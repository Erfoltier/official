import { idParam, laneSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { deleteLane, updateLane } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    return json(updateLane(id, laneSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** レーンの削除（予約の記録がないレーンだけ） */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    deleteLane(idParam.parse((await ctx.params).id), actorOf(staff));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
