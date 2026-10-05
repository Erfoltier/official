import { integrationConsentTemplatesSchema } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { receiveConsentTemplates } from "@/lib/server/store";

/**
 * 外部連携：同意書フォルダ（Apps Script）から同意書のひな形を送る。フォルダの分をまるごと入れ替える。
 *   POST /api/v1/integration/consent-templates  {"templates":[{"driveId":"...","title":"ボトックス同意書","modifiedTime":"...","html":"<html>..."}]}
 */
export async function POST(request: Request) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const body = integrationConsentTemplatesSchema.parse(await readJson(request, 20_000_000));
    return json(receiveConsentTemplates(body.templates));
  } catch (err) {
    return errorResponse(err);
  }
}
