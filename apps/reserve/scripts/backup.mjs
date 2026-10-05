// 保存データのバックアップ（中身は暗号化されたまま）。
//   npm run backup              → .data/backups/reserve-YYYYMMDD-HHMMSS.db（直近30個を残す）
//   BACKUP_DIR=/mnt/backup npm run backup   保存先を変える（別のディスク・別の場所を推奨）
// 復元するときは、サーバーを止めて reserve.db をバックアップのファイルで置き換える。
// 暗号鍵（DATA_ENCRYPTION_KEY、開発時は .data/dev.key）が無いと読めないので、鍵は別の安全な場所にも控えておく。
import { chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.env.RESERVE_DATA_DIR ?? path.join(process.cwd(), ".data");
const dbFile = process.env.RESERVE_DB ?? path.join(dataDir, "reserve.db");
const outDir = process.env.BACKUP_DIR ?? path.join(dataDir, "backups");
const keep = Number(process.env.BACKUP_KEEP ?? 30);

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const out = path.join(outDir, `reserve-${stamp}.db`);
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(dbFile, { readOnly: true });
db.prepare("VACUUM INTO ?").run(out);
db.close();
chmodSync(out, 0o600);

const old = readdirSync(outDir).filter((f) => /^reserve-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(path.join(outDir, f));
console.log(`バックアップしました: ${out}${old.length ? `（古いもの${old.length}個を削除）` : ""}`);
