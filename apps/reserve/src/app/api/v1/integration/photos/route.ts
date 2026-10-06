import type { NextRequest } from "next/server";
import { requireDevice } from "@/lib/server/deviceAuth";
import { errorResponse, json, readBytes } from "@/lib/server/http";
import { MAX_FILE_BYTES, receiveDevicePhoto } from "@/lib/server/store";

/**
 * 機器の連携：院のパソコンの取り込み係（ネオボワールの写真フォルダを見張る）から写真を受け取る。
 *   POST /api/v1/integration/photos?name=（患者名）&ref=（機器の顧客番号）&file=（ファイル名）&takenAt=（撮影日時 ISO）  本文は写真そのもの
 *   Authorization: Bearer （設定 → 外部機器の連携 で発行した鍵）
 */
export async function POST(request: NextRequest) {
  const link = requireDevice(request);
  if (link instanceof Response) return link;
  try {
    const q = request.nextUrl.searchParams;
    const takenAt = q.get("takenAt");
    const ref = q.get("ref");
    const bytes = await readBytes(request, MAX_FILE_BYTES);
    return json(receiveDevicePhoto(link, { patientName: q.get("name") ?? "", fileName: q.get("file") ?? "", ...(takenAt !== null && { takenAt }), ...(ref !== null && { ref }), bytes }));
  } catch (err) {
    return errorResponse(err);
  }
}
