import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteFile } from "@/lib/server/store";

/** ファイルを削除扱いにする（ログインしているスタッフ全員。誰が消したかは操作ログに残る） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const f = deleteFile(idParam.parse((await ctx.params).id), actorOf(staff));
    return json({ id: f.id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
