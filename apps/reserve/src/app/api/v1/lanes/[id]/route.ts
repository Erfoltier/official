import { laneSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { updateLane } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/lanes/[id]">) {
  try {
    const id = idParam.parse((await ctx.params).id);
    return json(updateLane(id, laneSchema.parse(await readJson(request))));
  } catch (err) {
    return errorResponse(err);
  }
}
