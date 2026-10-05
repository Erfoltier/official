import type { NextRequest } from "next/server";
import { createPatientSchema } from "@/lib/domain/schemas";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { createPatient, searchPatients } from "@/lib/server/store";

/** 患者検索（氏名・フリガナ・別表記・診察券番号・電話番号の部分一致） */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 50);
  return json({ items: searchPatients(q) });
}

/** 新しい患者の登録。氏名は漢字・かな・ローマ字の混在可 */
export async function POST(request: Request) {
  try {
    return json(createPatient(createPatientSchema.parse(await readJson(request))), 201);
  } catch (err) {
    return errorResponse(err);
  }
}
