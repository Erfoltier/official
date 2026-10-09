import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

/** 受付箱は本番（PHP 版）だけで動く（line-webhook の保存ファイルを読むため）。Node.js 版（開発用）では空 */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    return json({ items: [], days: 30, available: false });
  } catch (err) {
    return errorResponse(err);
  }
}
