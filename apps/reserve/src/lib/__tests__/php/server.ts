/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは API の応答（JSON）の中身をそのまま調べる */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

/**
 * テスト用に PHP 版の API（php/api）を php -S で動かす。
 * テストのファイルごとに一時フォルダ（設定・SQLite）を作り、終わったら消す。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PHP_DIR = path.join(ROOT, "php");
const run = promisify(execFile);

export const ADMIN_PIN = "123456";
export const DEMO_PIN = "1234";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

export interface Res<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
  bytes: Uint8Array;
}

/** スタッフ1人分のブラウザ（Cookie を覚える） */
export class Client {
  cookie = "";
  constructor(readonly base: string) {}

  async raw(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const isBytes = body instanceof Uint8Array;
    const res = await fetch(this.base + p, {
      method,
      headers: {
        Origin: this.base,
        ...(body !== undefined && !isBytes && { "Content-Type": "application/json" }),
        ...(this.cookie && { Cookie: this.cookie }),
        ...headers,
      },
      body: body === undefined ? undefined : isBytes ? (body as BodyInit) : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith("rsv_staff="));
    if (set) {
      const v = set.split(";")[0];
      this.cookie = v === "rsv_staff=" ? "" : v;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let data: unknown = null;
    if ((res.headers.get("content-type") ?? "").includes("json")) data = text ? JSON.parse(text) : null;
    return { status: res.status, data, headers: res.headers, bytes };
  }

  /** JSON を送り、2xx でなければ ApiError（メッセージは画面に出す文言） */
  async call<T = any>(method: string, p: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const r = await this.raw(method, p, body, headers);
    if (r.status < 200 || r.status >= 300) {
      const d = (r.data ?? {}) as { error?: string; message?: string };
      throw new ApiError(r.status, d.error ?? "error", d.message ?? "");
    }
    return r.data as T;
  }

  get<T = any>(p: string) {
    return this.call<T>("GET", `/api/v1${p}`);
  }
  post<T = any>(p: string, body: unknown = {}) {
    return this.call<T>("POST", `/api/v1${p}`, body);
  }
  patch<T = any>(p: string, body: unknown) {
    return this.call<T>("PATCH", `/api/v1${p}`, body);
  }
  put<T = any>(p: string, body: unknown) {
    return this.call<T>("PUT", `/api/v1${p}`, body);
  }

  /** 患者のファイルを追加する（画面と同じく、本体をそのまま送る） */
  upload<T = any>(patientId: string, f: { date: string; name: string; bytes: Uint8Array; reservationId?: string }) {
    const q = new URLSearchParams({ date: f.date, ...(f.reservationId && { reservationId: f.reservationId }) });
    return this.call<T>("POST", `/api/v1/patients/${patientId}/files?${q}`, f.bytes, {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(f.name),
    });
  }

  async login(staffId: string, pin: string) {
    return this.post("/auth/login", { staffId, pin });
  }
}

export interface PhpServer {
  base: string;
  dir: string;
  integrationToken: string;
  /** ログインしていないブラウザを新しく作る */
  client(): Client;
  /** ログイン済みのブラウザ */
  as(staffId: string, pin?: string): Promise<Client>;
  /** 設定ファイルの場所 */
  config: string;
  /** PHP のコードを同じ設定・同じ DB で実行し、return した値を JSON で受け取る（HTTP からは届かない処理用） */
  php<T = any>(code: string): Promise<T>;
  /** 保存されたデータ（DB・写真などの置き場所）の中身をそのまま読む（設定と実行したコードは除く） */
  rawData(): Buffer;
  /** php -S を止めて起動し直す（同じ設定・同じデータ） */
  restart(): Promise<void>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * PHP 版の API を起動する。demo: true ならデモデータ（スタッフ・患者 p-0001〜p-0120・予約。PIN 1234）を入れる。
 * デモなしのときは院長（staff-admin・PIN 123456）だけ
 */
export async function startPhp(opts: { demo?: boolean } = {}): Promise<PhpServer> {
  const dir = mkdtempSync(path.join(tmpdir(), "reserve-php-"));
  const conf = path.join(dir, "config.php");
  const integrationToken = randomBytes(24).toString("hex");
  writeFileSync(
    conf,
    `<?php return ['base_path' => '', 'db_dsn' => 'sqlite:' . __DIR__ . '/reserve.db', 'encryption_key' => '${randomBytes(32).toString("hex")}', ` +
      `'session_secret' => '${randomBytes(32).toString("hex")}', 'integration_token' => '${integrationToken}', 'initial_admin_pin' => '${ADMIN_PIN}', ` +
      `'line_intake_dir' => __DIR__ . '/intake'];\n`,
    { mode: 0o600 },
  );
  const env = { ...process.env, RESERVE_CONFIG: conf };
  if (opts.demo) await run("php", [path.join(PHP_DIR, "tools/demo-seed.php")], { env, cwd: ROOT });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let proc: ChildProcess;
  const boot = async () => {
    proc = spawn("php", ["-S", `127.0.0.1:${port}`, path.join(PHP_DIR, "tools/dev-router.php")], {
      env,
      cwd: ROOT,
      stdio: "ignore",
    });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        const r = await fetch(`${base}/api/v1/health`);
        if (r.ok) return;
      } catch {
        // 起動待ち
      }
      if (Date.now() > deadline) throw new Error("php -S が起動しませんでした");
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const stop = () =>
    new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once("exit", () => resolve());
      proc.kill();
    });
  await boot();

  let n = 0;
  return {
    base,
    dir,
    integrationToken,
    config: conf,
    client: () => new Client(base),
    async as(staffId, pin) {
      const c = new Client(base);
      await c.login(staffId, pin ?? (opts.demo ? DEMO_PIN : ADMIN_PIN));
      return c;
    },
    async php<T>(code: string): Promise<T> {
      const file = path.join(dir, `snippet-${++n}.php`);
      writeFileSync(
        file,
        `<?php\nrequire ${JSON.stringify(path.join(PHP_DIR, "lib/bootstrap.php"))};\n` +
          `try { $__r = (function () { ${code}\n })(); echo json_out(['ok' => $__r]); }\n` +
          `catch (Throwable $e) { echo json_out(['error' => get_class($e), 'message' => $e->getMessage()]); }\n`,
      );
      const { stdout } = await run("php", [file], { env, cwd: ROOT });
      const out = JSON.parse(stdout) as { ok?: T; error?: string; message?: string };
      if (out.error) throw new Error(`${out.error}: ${out.message}`);
      return out.ok as T;
    },
    rawData() {
      const files = readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && !/^(config|snippet-\d+)\.php$/.test(e.name))
        .map((e) => readFileSync(path.join(e.parentPath, e.name)));
      return Buffer.concat(files);
    },
    async restart() {
      await stop();
      await boot();
    },
    async close() {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}


/**
 * テストのファイル（each なら各テスト）ごとに PHP 版を起動し、終わったら止める。
 * 使い方：const h = withPhp(); … await h.srv.as("staff-admin")
 */
export function withPhp(opts: { demo?: boolean; each?: boolean } = {}): { srv: PhpServer } {
  const h = {} as { srv: PhpServer };
  (opts.each ? beforeEach : beforeAll)(async () => {
    h.srv = await startPhp(opts);
  }, 60_000);
  (opts.each ? afterEach : afterAll)(() => h.srv?.close());
  return h;
}
