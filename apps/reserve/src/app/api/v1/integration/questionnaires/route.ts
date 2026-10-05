import { integrationQuestionnairesSchema } from "@/lib/domain/schemas";
import { checkIntegrationAuth, errorResponse, json, readJson } from "@/lib/server/http";
import { receiveQuestionnaires } from "@/lib/server/store";

/**
 * 外部連携：Googleフォームの問診票（回答のスプレッドシートの Apps Script）から回答を送る。
 * 氏名＋生年月日か電話番号で患者に結びつける。同じ key の回答は二重に取り込まない。
 *   POST /api/v1/integration/questionnaires  {"responses":[{"key":"…","submittedAt":"…","name":"…","answers":[{"q":"…","a":"…"}]}]}
 */
export async function POST(request: Request) {
  const denied = checkIntegrationAuth(request);
  if (denied) return denied;
  try {
    const body = integrationQuestionnairesSchema.parse(await readJson(request, 2_000_000));
    return json(receiveQuestionnaires(body.responses));
  } catch (err) {
    return errorResponse(err);
  }
}
