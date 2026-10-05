import { idParam, laneSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteLane, updateLane } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/lanes/[id]">) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    return json(updateLane(id, laneSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** レーンの削除（予約の記録がないレーンだけ） */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/lanes/[id]">) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    deleteLane(idParam.parse((await ctx.params).id), actorOf(staff));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
