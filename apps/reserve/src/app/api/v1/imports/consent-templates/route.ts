import { importConsentTemplatesSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { importConsentTemplates } from "@/lib/server/store";

/** ファイル（Word・Googleドキュメント）から同意書のひな形を取り込む */
export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    const body = importConsentTemplatesSchema.parse(await readJson(request, 13_000_000));
    return json(importConsentTemplates(body.templates, actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
