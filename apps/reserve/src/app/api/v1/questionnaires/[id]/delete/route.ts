import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { deleteQuestionnaire } from "@/lib/server/store";

/** 問診票の回答を削除扱いにする（管理操作のできるスタッフ） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    deleteQuestionnaire(id, actorOf(staff));
    return json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
