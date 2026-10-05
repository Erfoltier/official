import { idParam, versionOnlySchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteChart } from "@/lib/server/store";

/** カルテを削除扱いにする（書いた本人か、管理操作のできるスタッフ） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const c = deleteChart(idParam.parse((await ctx.params).id), versionOnlySchema.parse(await readJson(request)), { ...actorOf(staff), canManage: staff.canManage });
    return json({ id: c.id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
