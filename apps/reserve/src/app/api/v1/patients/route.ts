import type { NextRequest } from "next/server";
import { json } from "@/lib/server/http";
import { searchPatients } from "@/lib/server/store";

/** 予約登録時の患者検索（氏名・カナ・診察券番号の部分一致） */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 50);
  return json({ items: searchPatients(q) });
}
