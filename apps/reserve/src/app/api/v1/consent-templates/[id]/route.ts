import { idParam } from "@/lib/domain/schemas";
import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { loadConsentTemplate } from "@/lib/server/consentSource";
import { getConsentTemplate } from "@/lib/server/store";

/** 同意書のひな形（本文つき）。読み込み元があれば、その場でドライブの最新を読む（読めなければ前回の本文と stale: true） */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireStaff(request);
    const id = idParam.parse((await ctx.params).id);
    // ?cached=1 なら前回読み込んだ本文をすぐ返す
    return json(new URL(request.url).searchParams.get("cached") === "1" ? getConsentTemplate(id) : await loadConsentTemplate(id));
  } catch (err) {
    return errorResponse(err);
  }
}
