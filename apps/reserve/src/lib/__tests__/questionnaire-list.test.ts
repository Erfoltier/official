import { describe, expect, it } from "vitest";
import { nowInClinic } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const h = withPhp({ each: true });

describe("問診票の一覧", () => {
  it("期間と氏名・電話で絞り込め、開くと全文が見え、閲覧の記録に残る（スタッフ全員が見られる）", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "一覧 太郎", kana: "イチラン タロウ", birthDate: "1980-01-02", phone: "090-1111-2222", chartNo: "4321" });
    const res = await h.srv.client().raw(
      "POST",
      "/api/v1/integration/questionnaires",
      {
        responses: [
          { key: "k1", submittedAt: "2026/10/10 10:00:00", name: "一覧 太郎", kana: "イチラン タロウ", birthDate: "1980-01-02", phone: "090-1111-2222", answers: [{ q: "既往歴", a: "なし" }] },
          { key: "k2", submittedAt: "2026/09/01 10:00:00", name: "別 花子", phone: "080-3333-4444", answers: [{ q: "既往歴", a: "喘息" }] },
        ],
      },
      { Authorization: `Bearer ${h.srv.integrationToken}` },
    );
    expect(res.status).toBe(200);
    const ns = await c.post("/staff", { name: "看護（問診）", role: "nurse", pin: "246810" });
    const nurse = await h.srv.as(ns.id, "246810");
    const all = await nurse.get("/questionnaires/list?from=2026-08-01&to=2026-10-31&q=");
    expect(all.total).toBe(2);
    expect(all.items[0]).toMatchObject({ name: "一覧 太郎", patientId: p.id, chartNo: "4321", day: "2026-10-10", source: "form" });
    expect(all.items[0].answers).toBeUndefined();
    expect((await nurse.get("/questionnaires/list?from=2026-10-01&to=2026-10-31&q=")).total).toBe(1);
    expect((await nurse.get("/questionnaires/list?from=2026-08-01&to=2026-10-31&q=" + encodeURIComponent("いちらん"))).total).toBe(1);
    expect((await nurse.get("/questionnaires/list?from=2026-08-01&to=2026-10-31&q=4321")).items[0].name).toBe("一覧 太郎");
    expect((await nurse.get("/questionnaires/list?from=2026-08-01&to=2026-10-31&q=3333")).items[0].name).toBe("別 花子");
    const one = await nurse.get(`/questionnaires/${all.items[1].id}`);
    expect(one.answers[0].a).toBe("喘息");
    const today = nowInClinic().date;
    const log = (await c.get(`/access-log?from=${today}&to=${today}`)).items.map((e: { action: string }) => e.action);
    expect(log).toContain("問診票の一覧を表示");
    expect(log).toContain("問診票を表示");
  });
});

describe("未確認の問診票の結びつけ", () => {
  it("先に届いた問診票は、患者を登録したとき・まとめて照合したときに結びつく", async () => {
    const c = await h.srv.as("staff-admin");
    const send = (responses: unknown[]) =>
      h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses }, { Authorization: `Bearer ${h.srv.integrationToken}` });
    await send([
      { key: "r1", submittedAt: "2026/10/15 16:35:00", name: "初診 一子", kana: "ショシン イチコ", birthDate: "1995-05-05", answers: [{ q: "既往歴", a: "なし" }] },
      { key: "r2", submittedAt: "2026/10/15 17:40:00", name: "初診 二郎", phone: "090-5555-6666", answers: [{ q: "既往歴", a: "なし" }] },
    ]);
    expect((await c.get("/questionnaires/unmatched")).items).toHaveLength(2);
    // 登録したら自動で結びつく（電話番号も問診票から入る）
    const p = await c.post("/patients", { name: "初診 一子", kana: "ショシン イチコ", birthDate: "1995-05-05" });
    expect((await c.get(`/patients/${p.id}/questionnaires`)).items).toHaveLength(1);
    expect((await c.get("/questionnaires/unmatched")).items).toHaveLength(1);
    // 別の名前で登録した人は、名前を直したときに結びつく
    const q = await c.post("/patients", { name: "初診 次郎", phone: "090-5555-6666" });
    expect((await c.get(`/patients/${q.id}/questionnaires`)).items).toHaveLength(0);
    const fixed = (await c.patch(`/patients/${q.id}`, { name: "初診 二郎", version: q.version })).patient;
    expect((await c.get(`/patients/${q.id}/questionnaires`)).items).toHaveLength(1);
    expect(fixed.version).toBeGreaterThanOrEqual(q.version + 1);
    // まとめて照合（もう未確認はない）
    expect(await c.post("/questionnaires/relink", {})).toMatchObject({ checked: 0, linked: 0 });
  });
});

describe("初診でカルテ番号・電話がまだない患者にも、問診票を結びつける", () => {
  it("患者に電話・生年月日がなくても、予約に付いた予約申請の電話と氏名が合えば結びつく", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { addDays, toIso } = await import("@/lib/domain/time");
    const c = await h.srv.as("staff-admin");
    // Air から入ったばかりの初診の方（フリガナだけ・電話なし・カルテ番号なし）
    const p = await c.post("/patients", { name: "ショシン ハナコ", kana: "ショシン ハナコ" });
    const RID = "R20261019100000AB12CD34";
    const day = addDays(nowInClinic().date, 3);
    await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 630), memo: `予約申請ID：${RID}` });
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RID}.json`), JSON.stringify({ requestId: RID, type: "reservation_intake", source: { userId: "U" + "a".repeat(32) }, intake: { name: "初診 花子", kana: "ショシン ハナコ", phone: "090-5555-6666" } }));
    // 問診票は漢字の氏名と電話だけ（生年月日なし）
    const send = (key: string, name: string, phone: string) =>
      h.srv.client().raw("POST", "/api/v1/integration/questionnaires", { responses: [{ key, submittedAt: "2026/10/18 10:00:00", name, kana: "ショシン ハナコ", phone, answers: [{ q: "既往歴", a: "なし" }] }] }, { Authorization: `Bearer ${h.srv.integrationToken}` });
    expect((await send("s1", "初診 花子", "09055556666")).status).toBe(200);
    const qs = (await c.get(`/patients/${p.id}/questionnaires`)).items;
    expect(qs).toHaveLength(1);
    // 電話が違えば結びつけない
    await c.post("/patients", { name: "ショシン ジロウ", kana: "ショシン ジロウ" });
    expect((await send("s2", "初診 次郎", "09000000000")).status).toBe(200);
    expect((await c.get("/questionnaires/list?from=2026-10-01&to=2026-10-31&q=")).items.find((x: { name: string }) => x.name === "初診 次郎").patientId).toBeFalsy();
  });
});

describe("氏名が1人に決まり、問診票の前後14日に予約があれば結びつける（院長の決定・案A）", () => {
  it("近くに予約があれば結びつき、予約が遠い・電話が食い違うときは結びつけない", async () => {
    const { addDays, toIso } = await import("@/lib/domain/time");
    const c = await h.srv.as("staff-admin");
    const today = nowInClinic().date;
    const near = await c.post("/patients", { name: "近藤 予約子", kana: "コンドウ ヨヤクコ" });
    await c.post("/reservations", { patientId: near.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(addDays(today, 5), 600), endAt: toIso(addDays(today, 5), 630) });
    const far = await c.post("/patients", { name: "遠藤 予約子", kana: "エンドウ ヨヤクコ" });
    await c.post("/reservations", { patientId: far.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(addDays(today, 40), 600), endAt: toIso(addDays(today, 40), 630) });
    const other = await c.post("/patients", { name: "電話 違子", kana: "デンワ チガコ", phone: "090-1111-0000" });
    await c.post("/reservations", { patientId: other.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(addDays(today, 2), 600), endAt: toIso(addDays(today, 2), 630) });
    const at = today.replace(/-/g, "/") + " 10:00:00";
    const res = await h.srv.client().raw(
      "POST",
      "/api/v1/integration/questionnaires",
      {
        responses: [
          { key: "a1", submittedAt: at, name: "近藤 予約子", birthDate: "1990-01-01", phone: "090-2222-3333", answers: [] },
          { key: "a2", submittedAt: at, name: "遠藤 予約子", birthDate: "1990-01-01", phone: "090-2222-4444", answers: [] },
          { key: "a3", submittedAt: at, name: "電話 違子", birthDate: "1990-01-01", phone: "090-9999-9999", answers: [] },
        ],
      },
      { Authorization: `Bearer ${h.srv.integrationToken}` },
    );
    expect(res.status).toBe(200);
    expect((await c.get(`/patients/${near.id}/questionnaires`)).items).toHaveLength(1);
    expect((await c.get(`/patients/${far.id}/questionnaires`)).items).toHaveLength(0);
    expect((await c.get(`/patients/${other.id}/questionnaires`)).items).toHaveLength(0);
  });
});
