import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteFile } from "@/lib/server/store";

/** ファイルを削除扱いにする（院長・管理者と受付） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const f = deleteFile(idParam.parse((await ctx.params).id), actorOf(staff));
    return json({ id: f.id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
