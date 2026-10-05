import { idParam, versionOnlySchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { deleteEstimate } from "@/lib/server/store";

/** 見積書を削除扱いにする（院長・管理者と受付） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const e = deleteEstimate(idParam.parse((await ctx.params).id), versionOnlySchema.parse(await readJson(request)), actorOf(staff));
    return json({ id: e.id, deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
