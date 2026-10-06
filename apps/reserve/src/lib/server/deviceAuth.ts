import "server-only";

import type { DeviceLink } from "@/lib/domain/types";
import { deviceLinkByToken } from "@/lib/server/store";

/** 機器の連携の鍵（設定で発行したもの）。止めたもの・違うものは 401 の応答を返す */
export function requireDevice(request: Request): DeviceLink | Response {
  const auth = request.headers.get("authorization") ?? "";
  const given = request.headers.get("x-device-token") ?? (auth.startsWith("Bearer ") ? auth.slice(7) : "");
  const link = deviceLinkByToken(given);
  return link && link.source === "neovoir" ? link : Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
