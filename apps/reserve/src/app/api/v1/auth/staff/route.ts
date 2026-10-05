import { json } from "@/lib/server/http";
import { listStaff } from "@/lib/server/staff";

/** ログイン画面用：利用中のスタッフの名前と役割だけ（院の入口のBasic認証の内側） */
export async function GET() {
  return json({ items: listStaff().map(({ id, name, role }) => ({ id, name, role })) });
}
