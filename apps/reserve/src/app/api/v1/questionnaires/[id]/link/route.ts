import { idParam, linkQuestionnaireSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { linkQuestionnaire } from "@/lib/server/store";

/** 問診票の回答を、診察券番号の患者に結びつける */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const body = linkQuestionnaireSchema.parse(await readJson(request));
    return json(linkQuestionnaire(idParam.parse((await ctx.params).id), body.chartNo, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
