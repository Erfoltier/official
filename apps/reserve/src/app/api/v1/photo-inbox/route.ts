import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { listPhotoInbox } from "@/lib/server/store";

/** 照合待ちの写真 */
export async function GET(request: Request) {
  try {
    requireStaff(request);
    return json({ items: listPhotoInbox() });
  } catch (err) {
    return errorResponse(err);
  }
}
