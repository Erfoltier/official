import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteStage } from "@/lib/server/store";

/** 状態の削除（院長・管理者と受付）。過去の予約の表示のため記録は残す */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    deleteStage(id, actorOf(staff));
    return json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
