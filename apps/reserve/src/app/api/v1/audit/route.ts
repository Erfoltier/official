import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { listAudit } from "@/lib/server/staff";

/** 操作ログ（院長・管理者のみ） */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json({ items: listAudit(300) });
  } catch (err) {
    return errorResponse(err);
  }
}
