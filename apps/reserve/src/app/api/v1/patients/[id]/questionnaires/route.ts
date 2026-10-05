import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { listQuestionnaires } from "@/lib/server/store";

/** 患者の問診票の回答（新しい順） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json({ items: listQuestionnaires(idParam.parse((await ctx.params).id)) });
  } catch (err) {
    return errorResponse(err);
  }
}
