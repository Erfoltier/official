import { stageSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf , requireManager} from "@/lib/server/session";
import { createStage } from "@/lib/server/store";

/** 状態を追加（院長・管理者と受付） */
export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    return json(createStage(stageSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
