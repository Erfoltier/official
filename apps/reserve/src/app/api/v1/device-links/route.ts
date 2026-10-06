import { deviceLinkSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createDeviceLink, deviceLinks } from "@/lib/server/store";

/** 機器の連携の一覧（院長・管理者） */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json(deviceLinks());
  } catch (err) {
    return errorResponse(err);
  }
}

/** 接続用の鍵を発行する（このときだけ鍵を返す） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(createDeviceLink(deviceLinkSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
