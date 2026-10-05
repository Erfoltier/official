import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getConsentTemplate } from "@/lib/server/store";

/** 同意書のひな形（本文つき） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    return json(getConsentTemplate(idParam.parse((await ctx.params).id)));
  } catch (err) {
    return errorResponse(err);
  }
}
