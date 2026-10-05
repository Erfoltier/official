import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { consentTemplatesReceivedAt, listConsentTemplates } from "@/lib/server/store";

/** 同意書のひな形の一覧（本文は含めない） */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    return json({ items: listConsentTemplates(), receivedAt: consentTemplatesReceivedAt() });
  } catch (err) {
    return errorResponse(err);
  }
}
