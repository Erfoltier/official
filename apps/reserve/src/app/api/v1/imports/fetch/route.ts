import { importFetchSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { fetchGoogleExport } from "@/lib/server/googleFetch";
import { requireManager } from "@/lib/server/session";

/** 共有リンクのGoogleスプレッドシート・ドキュメントを読む（取り込みの下ごしらえ。管理操作のできるスタッフ） */
export async function POST(request: Request) {
  try {
    requireManager(request);
    const { url } = importFetchSchema.parse(await readJson(request));
    return json(await fetchGoogleExport(url));
  } catch (err) {
    return errorResponse(err);
  }
}
