import { requireDevice } from "@/lib/server/deviceAuth";
import { json } from "@/lib/server/http";
import { deviceOptionsOf } from "@/lib/server/store";

/** 取り込み係の接続確認（鍵が正しいか） */
export async function GET(request: Request) {
  const link = requireDevice(request);
  if (link instanceof Response) return link;
  // 取り込み方（光源・縮小）も返す。取り込み係は毎回これに従う
  return json({ ok: true, name: link.name, source: link.source, options: deviceOptionsOf(link) });
}
