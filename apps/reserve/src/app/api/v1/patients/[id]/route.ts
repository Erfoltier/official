import { idParam, updatePatientSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { noteAccess } from "@/lib/server/staff";
import { getPatientDetail, updatePatient } from "@/lib/server/store";

/** 患者の詳細（基本情報・施術歴・今後の予約・変更履歴） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    const detail = getPatientDetail(id);
    noteAccess(staff, "患者を表示", `patient:${id}`);
    return json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

/** 患者情報の更新。version が古ければ 409 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    updatePatient(id, updatePatientSchema.parse(await readJson(request, 65_536)), actorOf(staff));
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
