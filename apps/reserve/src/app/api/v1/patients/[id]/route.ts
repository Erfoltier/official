import { idParam, updatePatientSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { getPatientDetail, updatePatient } from "@/lib/server/store";

/** 患者の詳細（基本情報・予約履歴・変更履歴） */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/patients/[id]">) {
  try {
    return json(getPatientDetail(idParam.parse((await ctx.params).id)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** 患者情報の更新。version が古ければ 409 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/patients/[id]">) {
  try {
    const id = idParam.parse((await ctx.params).id);
    updatePatient(id, updatePatientSchema.parse(await readJson(request)));
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
