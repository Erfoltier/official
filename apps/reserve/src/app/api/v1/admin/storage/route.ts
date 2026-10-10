import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

/** 写真などの置き場所（PHP 版だけ。Node.js 版はこれまでどおり DB の表に入れる） */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json({ external: false, inDb: 0, inDbBytes: 0, files: 0, fileBytes: 0, dbBytes: null });
  } catch (err) {
    return errorResponse(err);
  }
}
