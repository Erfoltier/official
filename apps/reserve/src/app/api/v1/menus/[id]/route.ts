import { idParam, menuSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateMenu } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/menus/[id]">) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    return json(updateMenu(id, menuSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
