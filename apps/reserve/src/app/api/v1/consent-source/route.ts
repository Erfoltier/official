import { consentSourceSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { consentSourceInfo, setConsentSource } from "@/lib/server/store";

/** 同意書の読み込み元（キーは返さない）。院長・管理者のみ */
export async function GET(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    return json(consentSourceInfo());
  } catch (err) {
    return errorResponse(err);
  }
}

/** 同意書の読み込み元を変える（url を空にすると止める）。院長・管理者のみ */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(setConsentSource(consentSourceSchema.parse(await readJson(request)), actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
