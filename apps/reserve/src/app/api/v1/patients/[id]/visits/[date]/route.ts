import { dateParam, idParam, visitNoteSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { getPatientDetail, saveVisitNote } from "@/lib/server/store";

/** 来院日ごとの記録（簡易カルテ・スキンケア）を保存。両方空なら削除 */
export async function PUT(request: Request, ctx: RouteContext<"/api/v1/patients/[id]/visits/[date]">) {
  try {
    const staff = requireStaff(request);
    const { id, date } = await ctx.params;
    const patientId = idParam.parse(id);
    saveVisitNote(patientId, dateParam.parse(date), visitNoteSchema.parse(await readJson(request, 32_768)), actorOf(staff));
    return json(getPatientDetail(patientId));
  } catch (err) {
    return errorResponse(err);
  }
}
