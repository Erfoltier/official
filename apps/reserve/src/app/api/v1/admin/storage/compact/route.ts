import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

/** PHP 版だけの機能（Node.js 版は写真を DB の表に入れたまま） */
export async function POST(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json({ error: "invalid", message: "この版では使えません（PHP 版だけ）" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
