import { idParam, versionOnlySchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { getPatientDetail, unlinkPatientLine } from "@/lib/server/store";

/** LINEの紐付けを解除する。紐付けは本人のQR操作でしか作れないため、ここでは解除のみ */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/patients/[id]/unlink-line">) {
  try {
    const id = idParam.parse((await ctx.params).id);
    unlinkPatientLine(id, versionOnlySchema.parse(await readJson(request)).version);
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
