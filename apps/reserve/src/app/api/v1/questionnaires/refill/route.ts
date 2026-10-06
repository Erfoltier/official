import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { refillFromQuestionnaires } from "@/lib/server/store";

/** 結びついている問診票を、患者の空いている欄へ写し直す（院長・管理者。何度実行しても重ならない） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    return json(refillFromQuestionnaires(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
