import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withPhp } from "./php/server";

// 院のパソコンに保存する控え：データは合言葉で暗号化した1つのファイル、写真は鍵で暗号化されたままの tar
const h = withPhp({ each: true, demo: true });
const TOOL = path.join(__dirname, "../../../php/tools/restore-local-backup.php");

describe("パソコンに保存する控え", () => {
  it("合言葉で暗号化したデータの控えを作り、復元ツールで戻せる。合言葉が違えば戻せない", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/patients", { name: "控え 太郎", kana: "ヒカエ タロウ" });
    expect((await c.raw("POST", "/api/v1/admin/local-backup/data", { passphrase: "short" })).status).toBe(400);
    const r = await c.raw("POST", "/api/v1/admin/local-backup/data", { passphrase: "院の合言葉テスト1234" });
    expect(r.status).toBe(200);
    expect(new TextDecoder().decode(r.bytes.slice(0, 21))).toBe("LANE-RESERVE-BACKUP 1");
    // 中身は暗号化されている（患者の名前がそのまま入っていない）
    expect(Buffer.from(r.bytes).includes(Buffer.from("控え 太郎"))).toBe(false);
    const dir = mkdtempSync(path.join(tmpdir(), "lrbk-"));
    const file = path.join(dir, "b.lrbk");
    writeFileSync(file, r.bytes);
    const bad = mkdtempSync(path.join(tmpdir(), "lrbk-bad-"));
    expect(() => execFileSync("php", [TOOL, file, bad], { env: { ...process.env, LRBK_PASS: "まちがい合言葉12345" }, stdio: "pipe" })).toThrow();
    const out = mkdtempSync(path.join(tmpdir(), "lrbk-out-"));
    const msg = execFileSync("php", [TOOL, file, out], { env: { ...process.env, LRBK_PASS: "院の合言葉テスト1234" } }).toString();
    expect(msg).toContain("整合性 ok");
    expect(existsSync(path.join(out, "reserve.db"))).toBe(true);
    const key = /'encryption_key' => '([0-9a-f]+)'/.exec(msg)?.[1];
    expect(key).toBe(await h.srv.php("return config()['encryption_key'];"));
    // 保存した日時が残り、操作ログにも残る
    expect((await c.get("/admin/local-backup")).dataAt).toBeTruthy();
    expect(JSON.stringify(await c.get("/audit"))).toContain("パソコンに保存");
  });

  it("写真などは tar で保存でき、2回目は前回からの追加分だけ。院長・管理者以外はできない", async () => {
    const c = await h.srv.as("staff-admin");
    const st = await c.get("/admin/local-backup");
    expect(st.photos).toBeTruthy();
    const all = await c.raw("GET", "/api/v1/admin/local-backup/photos");
    expect(all.status).toBe(200);
    expect(all.bytes.length % 512).toBe(0);
    const add = await c.raw("GET", "/api/v1/admin/local-backup/photos?new=1");
    expect(add.status).toBe(200);
    const nurse = await h.srv.as("staff-ns1");
    expect((await nurse.raw("GET", "/api/v1/admin/local-backup")).status).toBe(403);
    expect((await nurse.raw("POST", "/api/v1/admin/local-backup/data", { passphrase: "院の合言葉テスト1234" })).status).toBe(403);
  });
});
