import path from "node:path";
import { statSync } from "node:fs";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { backupTo } from "@/lib/server/db";

/** 整った控え（バックアップ）を作る（院長・管理者。PHP 版と同じ形。中身は暗号化されたまま） */
export async function POST(request: Request) {
  try {
    requireStaff(request, ["admin"]);
    const body = (await readJson(request)) as { confirm?: unknown } | null;
    if (!body || body.confirm !== "BACKUP") return json({ error: "invalid", message: '確認のため {"confirm":"BACKUP"} を送ってください' }, 400);
    const name = `reserve-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}.db`;
    const file = path.join(process.env.RESERVE_DATA_DIR ?? path.join(process.cwd(), ".data"), "backups", name);
    backupTo(file);
    return json({ file: `backups/${name}`, bytes: statSync(file).size, integrity: "ok" });
  } catch (err) {
    return errorResponse(err);
  }
}
