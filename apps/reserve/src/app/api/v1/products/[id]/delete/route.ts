import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { deleteProduct } from "@/lib/server/store";

/** スキンケア・内服のプリセットの削除（院長・管理者と受付） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    deleteProduct(id, actorOf(staff));
    return json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
