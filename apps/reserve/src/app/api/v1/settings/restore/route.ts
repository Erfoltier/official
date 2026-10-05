import { z } from "zod";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { listRestorePoints, restoreSettings } from "@/lib/server/store";

/** 設定を戻せる時点の一覧（院長・管理者のみ） */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json(listRestorePoints());
  } catch (err) {
    return errorResponse(err);
  }
}

/** 設定を指定した時点の状態に戻す  {"key":"1w"}（院長・管理者のみ） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const { key } = z.object({ key: z.enum(["1d", "1w", "1m", "3m", "6m", "1y"]) }).strict().parse(await readJson(request));
    restoreSettings(key, actorOf(staff));
    return json(listRestorePoints());
  } catch (err) {
    return errorResponse(err);
  }
}
