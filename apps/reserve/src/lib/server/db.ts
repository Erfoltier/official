import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * データの保存先（SQLite ファイル）。サーバーを再起動しても予約・患者・記録が残る。
 *
 * - 1件ずつ JSON にして AES-256-GCM で暗号化して保存する（ファイルを持ち出されても中身は読めない）
 * - 保存先：環境変数 RESERVE_DB（既定は ./.data/reserve.db）
 * - 暗号鍵：環境変数 DATA_ENCRYPTION_KEY（64桁の16進数）。本番では必須。
 *   開発時に未設定なら ./.data/dev.key を自動で作る（Gitには含めない）
 *
 * 将来 PostgreSQL に移すときも、この形（種類・ID・暗号化したJSON）のまま移せる。
 */

export type Kind =
  | "lane"
  | "menu"
  | "product"
  | "stage"
  | "settingsSnapshot"
  | "file"
  | "estimate"
  | "chart"
  | "questionnaire"
  | "price"
  | "consentTemplate"
  | "consent"
  | "patient"
  | "patientHistory"
  | "reservation"
  | "visitNote"
  | "staff"
  | "revokedSession"
  | "accessLog"
  | "deviceLink"
  | "photoInbox"
  | "deviceRef"
  | "seededDate"
  | "meta";

interface DbState {
  db: DatabaseSync;
  key: Buffer;
  /** トランザクションの入れ子の深さ */
  txDepth: number;
}

const g = globalThis as unknown as { __reserveDb?: DbState };

function dataDir(): string {
  return process.env.RESERVE_DATA_DIR ?? path.join(process.cwd(), ".data");
}

function loadKey(): Buffer {
  const hex = process.env.DATA_ENCRYPTION_KEY;
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("DATA_ENCRYPTION_KEY は64桁の16進数にしてください");
    return Buffer.from(hex, "hex");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATA_ENCRYPTION_KEY（64桁の16進数）が設定されていません");
  }
  // 開発時のみ：鍵ファイルを作って使う
  const file = path.join(dataDir(), "dev.key");
  if (!existsSync(file)) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
}

function open(): DbState {
  const file = process.env.RESERVE_DB ?? path.join(dataDir(), "reserve.db");
  if (file !== ":memory:") {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // 保存先のフォルダもサーバー本人だけが読めるようにする
    chmodSync(path.dirname(file), 0o700);
  }
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS docs (
      kind TEXT NOT NULL,
      id   TEXT NOT NULL,
      data BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      k1   TEXT,
      k2   TEXT,
      PRIMARY KEY (kind, id)
    );
    CREATE TABLE IF NOT EXISTS audit (
      seq  INTEGER PRIMARY KEY AUTOINCREMENT,
      at   TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blobs (
      id   TEXT PRIMARY KEY,
      data BLOB NOT NULL
    );
  `);
  if (file !== ":memory:") {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  }
  const state: DbState = { db, key: loadKey(), txDepth: 0 };
  migrateIndexColumns(state);
  return state;
}

/**
 * 検索用の索引列（暗号化しない）。PHP版は1日分・1患者分だけを読むため、これで絞り込む。
 * 中身は日付と患者IDだけで、氏名などの個人情報は入れない。
 * - reservation / visitNote：k1 = 日付（YYYY-MM-DD）、k2 = 患者ID
 * - patientHistory：k2 = 患者ID
 */
export function indexKeys(kind: Kind, id: string, value: unknown): [string | null, string | null] {
  const v = value as { startAt?: string; date?: string; patientId?: string };
  if (kind === "reservation") return [v.startAt?.slice(0, 10) ?? null, v.patientId ?? null];
  if (kind === "visitNote") return [v.date ?? null, v.patientId ?? null];
  if (kind === "patientHistory") return [null, id];
  if (kind === "file" || kind === "estimate" || kind === "consent" || kind === "chart") return [v.date ?? null, v.patientId ?? null];
  // 問診票：k2 = 患者ID（結びついていない回答は空文字）
  if (kind === "questionnaire") return [null, v.patientId ?? ""];
  return [null, null];
}

/** 索引列のない古いデータベースに列を足し、既存の行に値を入れる */
function migrateIndexColumns(s: DbState): void {
  const cols = (s.db.prepare("PRAGMA table_info(docs)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("k1")) s.db.exec("ALTER TABLE docs ADD COLUMN k1 TEXT");
  if (!cols.includes("k2")) s.db.exec("ALTER TABLE docs ADD COLUMN k2 TEXT");
  s.db.exec(`
    CREATE INDEX IF NOT EXISTS docs_k1 ON docs (kind, k1);
    CREATE INDEX IF NOT EXISTS docs_k2 ON docs (kind, k2);
  `);
  const rows = s.db
    .prepare("SELECT kind, id, data FROM docs WHERE kind IN ('reservation','visitNote','patientHistory') AND k2 IS NULL")
    .all() as { kind: Kind; id: string; data: Uint8Array }[];
  if (rows.length === 0) return;
  const upd = s.db.prepare("UPDATE docs SET k1 = ?, k2 = ? WHERE kind = ? AND id = ?");
  s.db.exec("BEGIN");
  for (const r of rows) {
    const [k1, k2] = indexKeys(r.kind, r.id, decryptWith(s.key, r.data));
    upd.run(k1, k2, r.kind, r.id);
  }
  s.db.exec("COMMIT");
}

function st(): DbState {
  g.__reserveDb ??= open();
  return g.__reserveDb;
}

// ---- 暗号化（1件ごとに別の乱数IVを使う） ----

function encrypt(value: unknown): Buffer {
  const { key } = st();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

/** ファイル本体（写真・PDFなど）を暗号化する。形式は JSON と同じ（IV12＋タグ16＋本文） */
function encryptBytes(bytes: Uint8Array): Buffer {
  const { key } = st();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(bytes), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function decryptBytes(blob: Uint8Array): Buffer {
  const buf = Buffer.from(blob);
  const d = createDecipheriv("aes-256-gcm", st().key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

export function putBlob(id: string, bytes: Uint8Array): void {
  st().db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data").run(id, encryptBytes(bytes));
}

export function deleteBlob(id: string): void {
  st().db.prepare("DELETE FROM blobs WHERE id = ?").run(id);
}

export function getBlob(id: string): Buffer | undefined {
  const row = st().db.prepare("SELECT data FROM blobs WHERE id = ?").get(id) as { data: Uint8Array } | undefined;
  return row ? decryptBytes(row.data) : undefined;
}

function decrypt<T>(blob: Uint8Array): T {
  return decryptWith<T>(st().key, blob);
}

function decryptWith<T>(key: Buffer, blob: Uint8Array): T {
  const buf = Buffer.from(blob);
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")) as T;
}

// ---- 読み書き ----

export function loadAll<T>(kind: Kind): Map<string, T> {
  const rows = st().db.prepare("SELECT id, data FROM docs WHERE kind = ?").all(kind) as { id: string; data: Uint8Array }[];
  return new Map(rows.map((r) => [r.id, decrypt<T>(r.data)]));
}

export function put(kind: Kind, id: string, value: unknown): void {
  const [k1, k2] = indexKeys(kind, id, value);
  st()
    .db.prepare(
      "INSERT INTO docs (kind, id, data, updated_at, k1, k2) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, k1 = excluded.k1, k2 = excluded.k2",
    )
    .run(kind, id, encrypt(value), new Date().toISOString(), k1, k2);
}

export function remove(kind: Kind, id: string): void {
  st().db.prepare("DELETE FROM docs WHERE kind = ? AND id = ?").run(kind, id);
}

export function count(kind: Kind): number {
  const row = st().db.prepare("SELECT COUNT(*) AS n FROM docs WHERE kind = ?").get(kind) as { n: number };
  return Number(row.n);
}

export function getMeta<T>(id: string): T | undefined {
  const row = st().db.prepare("SELECT data FROM docs WHERE kind = 'meta' AND id = ?").get(id) as { data: Uint8Array } | undefined;
  return row ? decrypt<T>(row.data) : undefined;
}

export function setMeta(id: string, value: unknown): void {
  put("meta", id, value);
}

export function appendAudit(entry: { at: string } & Record<string, unknown>): void {
  st().db.prepare("INSERT INTO audit (at, data) VALUES (?, ?)").run(entry.at, encrypt(entry));
}

export function loadAudit<T>(limit: number): T[] {
  const rows = st().db.prepare("SELECT data FROM audit ORDER BY seq DESC LIMIT ?").all(limit) as { data: Uint8Array }[];
  return rows.map((r) => decrypt<T>(r.data));
}

/** まとめて書き込む（途中で失敗したら全部取り消す）。入れ子にしてもよい */
export function transaction<T>(fn: () => T): T {
  const s = st();
  if (s.txDepth > 0) return fn();
  s.db.exec("BEGIN");
  s.txDepth++;
  try {
    const out = fn();
    s.db.exec("COMMIT");
    return out;
  } catch (err) {
    s.db.exec("ROLLBACK");
    throw err;
  } finally {
    s.txDepth--;
  }
}

/** バックアップ：その時点の内容を別ファイルに書き出す（中身は暗号化されたまま） */
export function backupTo(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  st().db.prepare("VACUUM INTO ?").run(file);
  chmodSync(file, 0o600);
}

/**
 * 書き込みと同時にデータベースへ保存する Map。
 * 読み込みはメモリ上で行い、set / delete のたびにその1件だけを保存する。
 */
export class PersistentMap<V> extends Map<string, V> {
  private ready = false;

  constructor(private readonly kind: Kind) {
    super();
    for (const [k, v] of loadAll<V>(kind)) super.set(k, v);
    this.ready = true;
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    if (this.ready) put(this.kind, key, value);
    return this;
  }

  override delete(key: string): boolean {
    const had = super.delete(key);
    if (had) remove(this.kind, key);
    return had;
  }

  override clear(): void {
    for (const k of [...this.keys()]) this.delete(k);
  }
}

/** 同じく保存される Set（文字列のみ） */
export class PersistentSet extends Set<string> {
  private ready = false;

  constructor(private readonly kind: Kind) {
    super();
    for (const k of loadAll<true>(kind).keys()) super.add(k);
    this.ready = true;
  }

  override add(value: string): this {
    if (!super.has(value)) {
      super.add(value);
      if (this.ready) put(this.kind, value, true);
    }
    return this;
  }
}
