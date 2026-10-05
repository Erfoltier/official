import { deletePatientSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deletePatient, getPatientDetail } from "@/lib/server/store";

/** 患者の削除（論理削除。記録は残し、検索・一覧から外す）。院長・管理者と受付のみ */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    deletePatient(id, deletePatientSchema.parse(await readJson(request)), actorOf(staff));
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
