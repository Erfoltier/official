import { productSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { createProduct } from "@/lib/server/store";

/** スキンケア・内服のプリセットを追加（院長・管理者と受付） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin", "reception"]);
    return json(createProduct(productSchema.parse(await readJson(request)), actorOf(staff)), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
