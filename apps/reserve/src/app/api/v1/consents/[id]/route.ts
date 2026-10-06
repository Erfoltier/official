import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { noteAccess } from "@/lib/server/staff";
import { getConsentView } from "@/lib/server/store";

/** 印刷用：同意書（発行時のひな形・署名・患者・院の情報） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    const view = getConsentView(id);
    noteAccess(staff, "同意書を表示", `consent:${id}`);
    return json(view);
  } catch (err) {
    return errorResponse(err);
  }
}
