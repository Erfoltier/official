import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowInClinic, toIso } from "@/lib/domain/time";

type G = { __reserveStore?: unknown; __reserveStaff?: unknown; __reserveDb?: { db: { close(): void } } };

/** サーバーの再起動と同じ：メモリ上の状態を捨て、データベースを開き直す */
function restart() {
  const g = globalThis as G;
  g.__reserveDb?.db.close();
  g.__reserveDb = undefined;
  g.__reserveStore = undefined;
  g.__reserveStaff = undefined;
}

describe("再起動しても消えない", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "reserve-"));
    process.env.RESERVE_DB = path.join(dir, "reserve.db");
    restart();
  });
  afterEach(() => {
    restart();
    process.env.RESERVE_DB = ":memory:";
    process.env.DATA_ENCRYPTION_KEY = "ab".repeat(32);
    rmSync(dir, { recursive: true, force: true });
  });

  it("患者・予約・施術メモ・レーン・スタッフ・操作ログが再起動後も残る", async () => {
    const s = await import("@/lib/server/store");
    const staff = await import("@/lib/server/staff");
    const by = { id: "staff-rc1", name: "受付A（デモ）" };
    const today = nowInClinic().date;

    const p = s.createPatient({ name: "山田 Anna", kana: "ヤマダ アンナ", phone: "090-9876-5432" }, by);
    const r = s.createReservation(
      { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(today, 600), endAt: toIso(today, 610) },
      by,
    );
    s.saveVisitNote(p.id, today, { note: "HIFU 300ショット", skincare: ["ゼオスキン ミラミン"], version: 0 }, by);
    const lane = s.createLane({ name: "5番レーン" }, by);
    staff.updateStaff({ id: "staff-admin", name: "院長（デモ）" }, "staff-ns1", { name: "看護師 佐藤" });

    restart();

    const s2 = await import("@/lib/server/store");
    const staff2 = await import("@/lib/server/staff");
    const d = s2.getPatientDetail(p.id);
    expect(d.patient.name).toBe("山田 Anna");
    expect(d.visits.find((v) => v.date === today)?.note).toBe("HIFU 300ショット");
    expect(d.history[0].by?.name).toBe("受付A（デモ）");
    expect(s2.getDayBundle(today).reservations.find((x) => x.id === r.id)?.createdBy?.name).toBe("受付A（デモ）");
    expect(s2.getSettings().lanes.map((l) => l.id)).toContain(lane.id);
    expect(staff2.listStaff().find((x) => x.id === "staff-ns1")?.name).toBe("看護師 佐藤");
    expect(staff2.listAudit().some((a) => a.action === "予約を登録")).toBe(true);
    // デモの予約は同じ日に二重に作られない
    const n = s2.getDayBundle(today).reservations.length;
    restart();
    expect((await import("@/lib/server/store")).getDayBundle(today).reservations.length).toBe(n);
  });

  it("ファイルには暗号化して保存し、氏名や電話番号はそのまま読めない", async () => {
    const s = await import("@/lib/server/store");
    s.createPatient({ name: "山田 Anna", phone: "090-9876-5432", memo: "金属アレルギー" });
    restart();
    const raw = readdirSync(dir)
      .filter((f) => f.startsWith("reserve.db"))
      .map((f) => readFileSync(path.join(dir, f)).toString("latin1"))
      .join("");
    expect(raw.length).toBeGreaterThan(0);
    for (const secret of ["Anna", "9876", "山田", "金属アレルギー"]) {
      expect(raw).not.toContain(secret);
      expect(raw).not.toContain(Buffer.from(secret).toString("latin1"));
    }
    // ファイルは本人（サーバー）しか読めない権限
    expect(statSync(path.join(dir, "reserve.db")).mode & 0o077).toBe(0);
  });

  it("鍵が違うと読めない", async () => {
    const s = await import("@/lib/server/store");
    s.createPatient({ name: "鍵テスト" });
    restart();
    process.env.DATA_ENCRYPTION_KEY = "cd".repeat(32);
    const s2 = await import("@/lib/server/store");
    expect(() => s2.searchPatients("鍵テスト")).toThrow();
  });
});
