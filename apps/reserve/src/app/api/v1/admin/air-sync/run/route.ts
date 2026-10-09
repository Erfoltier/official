import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

/** Airリザーブの取り込みは本番（PHP 版）だけで動く。Node.js 版（開発用）では受け付けない */
export async function POST(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json({ error: "invalid", message: "Airリザーブの取り込みはこの版では使えません" }, 400);
  } catch (err) {
    return errorResponse(err);
  }
}
