import { consentTemplateMenusSchema, idParam } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { setConsentTemplateMenus } from "@/lib/server/store";

/** 同意書を候補の先頭に出すメニューを決める（院長・管理者と受付） */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireManager(request);
    const id = idParam.parse((await ctx.params).id);
    return json(setConsentTemplateMenus(id, consentTemplateMenusSchema.parse(await readJson(request)).menuIds, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
