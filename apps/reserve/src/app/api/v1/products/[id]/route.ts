import { idParam, productSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateProduct } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    return json(updateProduct(id, productSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
