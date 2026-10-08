import { errorResponse, json } from "@/lib/server/http";
import { requireManager } from "@/lib/server/session";

/** 統合の取り消しは本番（PHP 版）だけで動く。Node.js 版（開発用）では受け付けない */
export async function POST(request: Request) {
  try {
    requireManager(request);
    return json({ error: "invalid", message: "統合の取り消しはこの版では使えません" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
