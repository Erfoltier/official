import { idParam, updateStaffSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateStaff } from "@/lib/server/staff";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/staff/[id]">) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const id = idParam.parse((await ctx.params).id);
    return json(updateStaff(actorOf(staff), id, updateStaffSchema.parse(await readJson(request))));
  } catch (err) {
    return errorResponse(err);
  }
}
