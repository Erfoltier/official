import { idParam, versionOnlySchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { getPatientDetail, restorePatient } from "@/lib/server/store";

/** 削除した患者の復元。院長・管理者と受付のみ */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/patients/[id]/restore">) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    restorePatient(id, versionOnlySchema.parse(await readJson(request)).version, actorOf(staff));
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
