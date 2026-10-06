import { requireDevice } from "@/lib/server/deviceAuth";
import { json } from "@/lib/server/http";

/** 取り込み係の接続確認（鍵が正しいか） */
export async function GET(request: Request) {
  const link = requireDevice(request);
  if (link instanceof Response) return link;
  return json({ ok: true, name: link.name, source: link.source });
}
