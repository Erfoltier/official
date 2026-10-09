import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

/** Airリザーブの要確認の印は本番（PHP 版）だけで動く。Node.js 版（開発用）では受け付けない */
export async function POST(request: Request) {
  try {
    requireStaff(request);
    return json({ error: "invalid", message: "要確認の印はこの版では使えません" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
