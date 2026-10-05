import { json } from "@/lib/server/http";
import { getSettings } from "@/lib/server/store";

/** 設定画面用：すべてのレーン・メニュー（非表示を含む） */
export async function GET() {
  return json(getSettings());
}
