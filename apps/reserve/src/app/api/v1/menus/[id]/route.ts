import { menuSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { updateMenu } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/menus/[id]">) {
  try {
    const id = idParam.parse((await ctx.params).id);
    return json(updateMenu(id, menuSchema.parse(await readJson(request))));
  } catch (err) {
    return errorResponse(err);
  }
}
