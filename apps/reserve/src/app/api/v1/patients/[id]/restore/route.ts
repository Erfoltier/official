import { idParam, versionOnlySchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { getPatientDetail, restorePatient } from "@/lib/server/store";

/** 削除した患者の復元。院長・管理者と受付のみ */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    restorePatient(id, versionOnlySchema.parse(await readJson(request)).version, actorOf(staff));
    return json(getPatientDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
