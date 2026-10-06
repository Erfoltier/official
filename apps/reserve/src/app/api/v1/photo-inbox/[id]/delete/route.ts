import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { deletePhotoInbox } from "@/lib/server/store";

/** 照合待ちの写真を削除する（ほかの人の写真・撮り直しなど） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    deletePhotoInbox(id, actorOf(staff));
    return json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
