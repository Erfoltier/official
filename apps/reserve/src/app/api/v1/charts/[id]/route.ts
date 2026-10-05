import { idParam, updateChartSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateChart } from "@/lib/server/store";

/** カルテを直す（スタッフ全員。誰が直したかは残る） */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    return json(updateChart(id, updateChartSchema.parse(await readJson(request, 65_536)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
