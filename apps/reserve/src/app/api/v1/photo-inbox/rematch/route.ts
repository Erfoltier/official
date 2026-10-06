import { errorResponse, json } from "@/lib/server/http";
import { actorOf, requireManager } from "@/lib/server/session";
import { rematchPhotoInbox } from "@/lib/server/store";

/** 照合待ちの写真を、今の患者でもう一度名前照合する */
export async function POST(request: Request) {
  try {
    const staff = requireManager(request);
    return json(rematchPhotoInbox(actorOf(staff)));
  } catch (err) {
    return errorResponse(err);
  }
}
