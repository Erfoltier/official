import path from "node:path";
import { backupTo } from "@/lib/server/db";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { actorOf, requireStaff } from "@/lib/server/session";
import { noteAccess } from "@/lib/server/staff";
import { applyM3Fill, m3FillCandidates, type M3FillItem } from "@/lib/server/store";

/** M3 の患者一覧との照合：氏名に漢字がない患者の、照合に使う欄（院長・管理者） */
export async function GET(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const items = m3FillCandidates();
    noteAccess(staff, "M3照合のため氏名がカタカナの患者を表示", `patients:${items.length}`);
    return json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 照合できた患者へ漢字の氏名などを入れる（院長・管理者。{"confirm":"APPLY","items":[…]}） */
export async function POST(request: Request) {
  try {
    const staff = requireStaff(request, ["admin"]);
    const body = (await readJson(request)) as { confirm?: unknown; items?: unknown } | null;
    if (!body || body.confirm !== "APPLY" || !Array.isArray(body.items) || body.items.length > 100000) {
      return json({ error: "invalid", message: '確認のため {"confirm":"APPLY","items":[…]} を送ってください' }, 400);
    }
    const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);
    const items: M3FillItem[] = [];
    for (const x of body.items as Record<string, unknown>[]) {
      const id = str(x?.id, 64);
      const name = str(x?.name, 60);
      if (!id || !name) continue;
      items.push({ id, name, kana: str(x.kana, 60), birthDate: str(x.birthDate, 10), phone: str(x.phone, 20), m3ChartNo: str(x.m3ChartNo, 20) });
    }
    // 書き換える前に、必ず控えを取る
    const name = `reserve-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-m3.db`;
    backupTo(path.join(process.env.RESERVE_DATA_DIR ?? path.join(process.cwd(), ".data"), "backups", name));
    return json({ ...applyM3Fill(items, actorOf(staff)), backup: `backups/${name}` });
  } catch (err) {
    return errorResponse(err);
  }
}
