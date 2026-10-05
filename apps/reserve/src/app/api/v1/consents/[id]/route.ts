import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getConsentView } from "@/lib/server/store";

/** 印刷用：同意書（発行時のひな形・署名・患者・院の情報） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json(getConsentView(idParam.parse((await ctx.params).id)));
  } catch (err) {
    return errorResponse(err);
  }
}
