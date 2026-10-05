import { reorderSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { reorderMenus } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json({ items: reorderMenus(reorderSchema.parse(await readJson(request)).ids, actorOf(staff)) });
  } catch (err) {
    return errorResponse(err);
  }
}
