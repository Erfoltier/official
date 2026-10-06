import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deletePatientReservations } from "@/lib/server/store";

/**
 * 指定した患者の予約を過去・未来とも完全に消す（院長・管理者）。患者そのものは消さない。
 * 本文に {"confirm":"DELETE"} が要る
 */
export async function POST(request: Request, ctx: { params: Promise<{ patientId: string }> }) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const id = idParam.parse((await ctx.params).patientId);
    const body = (await readJson(request)) as { confirm?: unknown } | null;
    if (!body || body.confirm !== "DELETE") {
      return json({ error: "invalid", message: '確認のため {"confirm":"DELETE"} を送ってください' }, 400);
    }
    return json(deletePatientReservations(id, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
