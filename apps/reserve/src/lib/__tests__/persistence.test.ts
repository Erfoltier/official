import { execFile } from "node:child_process";
import { statSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const run = promisify(execFile);

describe("再起動しても消えない", () => {
  const h = withPhp({ demo: true, each: true });

  it("患者・予約・施術メモ・レーン・スタッフ・操作ログが再起動後も残る", async () => {
    const rc = await h.srv.as("staff-rc1");
    const admin = await h.srv.as("staff-admin");
    const today = nowInClinic().date;

    const p = await rc.post("/patients", { name: "山田 Anna", kana: "ヤマダ アンナ", phone: "090-9876-5432" });
    const r = await rc.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(today, 600), endAt: toIso(today, 610) });
    await rc.put(`/patients/${p.id}/visits/${today}`, { note: "HIFU 300ショット", skincare: ["ゼオスキン ミラミン"], version: 0 });
    const lane = await rc.post("/lanes", { name: "5番レーン" });
    await admin.patch("/staff/staff-ns1", { name: "看護師 佐藤" });
    const n = (await rc.get(`/day?date=${today}`)).reservations.length;

    await h.srv.restart();

    // ログイン状態（Cookie）も再起動の前のまま使える
    const d = await rc.get(`/patients/${p.id}`);
    expect(d.patient.name).toBe("山田 Anna");
    expect(d.visits.find((v: { date: string }) => v.date === today)?.note).toBe("HIFU 300ショット");
    expect(d.history[0].by?.name).toBe("受付A（デモ）");
    const day = await rc.get(`/day?date=${today}`);
    expect(day.reservations.find((x: { id: string }) => x.id === r.id)?.createdBy?.name).toBe("受付A（デモ）");
    expect((await rc.get("/settings")).lanes.map((l: { id: string }) => l.id)).toContain(lane.id);
    expect((await admin.get("/staff")).items.find((x: { id: string }) => x.id === "staff-ns1")?.name).toBe("看護師 佐藤");
    expect((await admin.get("/audit")).items.some((a: { action: string }) => a.action === "予約を登録")).toBe(true);
    // デモデータは、患者・予約がある DB には二度と入らない
    const seed = run("php", [path.resolve("php/tools/demo-seed.php")], { env: { ...process.env, RESERVE_CONFIG: h.srv.config } });
    await expect(seed).rejects.toThrow(/すでにある/);
    expect((await rc.get(`/day?date=${today}`)).reservations.length).toBe(n);
  });

  it("ファイルには暗号化して保存し、氏名や電話番号はそのまま読めない", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/patients", { name: "山田 Anna", phone: "090-9876-5432", memo: "金属アレルギー" });
    const raw = h.srv.rawData();
    expect(raw.includes(Buffer.from("SQLite format 3"))).toBe(true);
    for (const secret of ["Anna", "9876", "山田", "金属アレルギー"]) {
      expect(raw.includes(Buffer.from(secret))).toBe(false);
    }
    // ファイルは本人（サーバー）しか読めない権限
    expect(statSync(path.join(h.srv.dir, "reserve.db")).mode & 0o077).toBe(0);
  });

  it("鍵が違うと読めない", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/patients", { name: "鍵テスト" });
    const conf = readFileSync(h.srv.config, "utf8");
    writeFileSync(h.srv.config, conf.replace(/'encryption_key' => '[0-9a-f]{64}'/, `'encryption_key' => '${"cd".repeat(32)}'`));
    await h.srv.restart(); // 設定を読み直す
    const r = await c.raw("GET", `/api/v1/patients?q=${encodeURIComponent("鍵テスト")}`);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.data)).not.toContain("鍵テスト");
  });
});
