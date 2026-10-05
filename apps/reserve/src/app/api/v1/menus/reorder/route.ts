import { reorderSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { reorderMenus } from "@/lib/server/store";

export async function POST(request: Request) {
  try {
    return json({ items: reorderMenus(reorderSchema.parse(await readJson(request)).ids) });
  } catch (err) {
    return errorResponse(err);
  }
}
