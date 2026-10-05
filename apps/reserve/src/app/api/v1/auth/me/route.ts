import { errorResponse, json } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";

export async function GET(request: Request) {
  try {
    return json(requireStaff(request));
  } catch (err) {
    return errorResponse(err);
  }
}
