import { deviceOptionsSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { setDeviceOptions } from "@/lib/server/store";

/** 取り込み方（光源・縮小）を変える（院長・管理者） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const id = idParam.parse((await ctx.params).id);
    return json(setDeviceOptions(id, deviceOptionsSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
