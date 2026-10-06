import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { countPatientReservations } from "@/lib/server/store";

/** 指定した患者の予約の件数（過去・未来とも。院長・管理者） */
export async function GET(request: Request, ctx: { params: Promise<{ patientId: string }> }) {
  try {
    requireStaff(request, ["admin"]);
    return json(countPatientReservations(idParam.parse((await ctx.params).patientId)));
  } catch (err) {
    return errorResponse(err);
  }
}
