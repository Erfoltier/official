import { idParam, menuSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { deleteMenu, updateMenu } from "@/lib/server/store";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    const id = idParam.parse((await ctx.params).id);
    return json(updateMenu(id, menuSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** メニューの削除（記録は残し、予約の選択肢と設定の一覧から消す） */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    deleteMenu(idParam.parse((await ctx.params).id), actorOf(staff));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
