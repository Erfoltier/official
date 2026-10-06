import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { revokeDeviceLink } from "@/lib/server/store";

/** 連携を止める（鍵が使えなくなる） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(revokeDeviceLink(idParam.parse((await ctx.params).id), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
