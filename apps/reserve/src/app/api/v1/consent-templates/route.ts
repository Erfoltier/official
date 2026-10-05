import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { refreshConsentList } from "@/lib/server/consentSource";
import { consentSourceInfo, consentTemplatesReceivedAt, listConsentTemplates } from "@/lib/server/store";

/**
 * 同意書のひな形の一覧（本文は含めない）。読み込み元があれば、その場でドライブとそろえる。
 * ?cached=1 なら、ドライブを見に行かずに前回の内容をすぐ返す（画面はこれを先に出して、あとで最新を取りに行く）
 */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    const cached = new URL(request.url).searchParams.get("cached") === "1";
    const live = cached ? false : await refreshConsentList();
    return json({ items: listConsentTemplates(), receivedAt: consentTemplatesReceivedAt(), live, source: consentSourceInfo().url !== "" });
  } catch (err) {
    return errorResponse(err);
  }
}
