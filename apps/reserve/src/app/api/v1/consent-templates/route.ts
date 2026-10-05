import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { refreshConsentList } from "@/lib/server/consentSource";
import { consentSourceInfo, consentTemplatesReceivedAt, listConsentTemplates } from "@/lib/server/store";

/** 同意書のひな形の一覧（本文は含めない）。読み込み元があれば、その場でドライブとそろえる */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    const live = await refreshConsentList();
    return json({ items: listConsentTemplates(), receivedAt: consentTemplatesReceivedAt(), live, source: consentSourceInfo().url !== "" });
  } catch (err) {
    return errorResponse(err);
  }
}
