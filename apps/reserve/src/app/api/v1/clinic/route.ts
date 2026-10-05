import { clinicSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { updateClinic } from "@/lib/server/store";

/** 院の設定（院名・診療時間・刻み）の変更。院長・管理者と受付のみ */
export async function PATCH(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json(updateClinic(clinicSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
