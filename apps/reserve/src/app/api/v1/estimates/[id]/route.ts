import { idParam, updateEstimateSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { getEstimateView, updateEstimate } from "@/lib/server/store";

/** 印刷用：見積書と、書類に載せる患者・院の情報 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json(getEstimateView(idParam.parse((await ctx.params).id)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** 見積書の変更。version が古ければ 409 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    return json(updateEstimate(id, updateEstimateSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
