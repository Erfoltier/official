import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { deleteConsentTemplate } from "@/lib/server/store";

/** ファイルから取り込んだ同意書のひな形を消す */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    deleteConsentTemplate(id, actorOf(staff));
    return json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
