import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { listUnmatchedQuestionnaires } from "@/lib/server/store";

/** 患者が見つからなかった問診票の回答 */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    return json({ items: listUnmatchedQuestionnaires() });
  } catch (err) {
    return errorResponse(err);
  }
}
