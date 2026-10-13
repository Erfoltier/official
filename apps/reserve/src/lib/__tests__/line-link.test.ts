/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// LINE の問診票：Webhook の返信（無料）と、LINE の中で開く問診票（LIFF）。LINE への問い合わせは php -S のテスト用の形で代わりにする
const h = withPhp({ each: true });
const SECRET = "0123456789abcdef0123456789abcdef";
const USER = "U" + "a".repeat(32);
const OTHER = "U" + "b".repeat(32);
const RID = "R20261013120000ABCDEF01";

async function setup() {
  const c = await h.srv.as("staff-admin");
  const s = await c.post("/line-link", { liffId: "1234567890-AbCdEfGh", channelSecret: SECRET });
  expect(s).toMatchObject({ liffId: "1234567890-AbCdEfGh", loginChannelId: "1234567890", secretConfigured: true, liffUrl: "https://liff.line.me/1234567890-AbCdEfGh" });
  expect(JSON.stringify(s)).not.toContain(SECRET);
  return c;
}

async function webhook(events: object[], secret = SECRET) {
  const body = JSON.stringify({ destination: "x", events });
  const sig = createHmac("sha256", secret).update(body).digest("base64");
  const res = await fetch(`${h.srv.base}/monshin/line.php`, { method: "POST", headers: { "Content-Type": "application/json", "X-Line-Signature": sig }, body });
  return { status: res.status, data: (await res.json()) as { replied?: number } };
}
const text = (t: string) => ({ type: "message", replyToken: "rt-" + Math.random(), source: { type: "user", userId: USER }, message: { type: "text", id: "1", text: t } });

async function liff(body: object, user = USER) {
  const res = await fetch(`${h.srv.base}/monshin/liff/api.php`, { method: "POST", headers: { "Content-Type": "application/json", Origin: h.srv.base }, body: JSON.stringify({ idToken: `test:${user}`, ...body }) });
  return { status: res.status, data: (await res.json()) as any };
}

describe("LINE の問診票", () => {
  it("Webhook：署名が正しいときだけ受け、初診の予約申請と「問診票」にだけ返信する", async () => {
    await setup();
    expect((await webhook([text("問診票")], "f".repeat(32))).status).toBe(401);
    expect((await webhook([])).status).toBe(200);
    expect((await webhook([text(`【予約申請】\n予約申請ID：${RID}\n受診区分：初診\nお名前：テスト`)])).data.replied).toBe(1);
    expect((await webhook([text(`予約申請ID：${RID}\n受診区分：再診`)])).data.replied).toBe(0);
    expect((await webhook([text("問診票")])).data.replied).toBe(1);
    expect((await webhook([text("駐車場はありますか")])).data.replied).toBe(0);
  });

  it("LIFF：本人の予約だけが出て、氏名などは書かずに送れる。二重には送れない", async () => {
    const c = await setup();
    const p = await c.post("/patients", { name: "線 花子", kana: "セン ハナコ", birthDate: "1991-02-03", phone: "090-1234-5678" });
    const day = addDays(nowInClinic().date, 2);
    const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610), requestId: RID });
    // 予約申請（line-webhook の保存形式）：申請した LINE の ID と、患者と合う氏名・生年月日
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RID}.json`), JSON.stringify({ requestId: RID, type: "reservation_intake", source: { userId: USER }, intake: { name: "線 花子", birthDate: "1991-02-03", visitType: "initial" } }));

    expect((await liff({ action: "context" }, OTHER)).data.items).toHaveLength(0);
    const ctx = (await liff({ action: "context" })).data;
    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0]).toMatchObject({ reservationId: r.id, done: false });
    expect(ctx.items[0].known.map((k: { label: string }) => k.label)).toEqual(["お名前", "フリガナ", "生年月日", "電話番号"]);

    const allergy = ctx.questions.find((q: { label: string }) => q.label === "アレルギー");
    // ほかの人は、この予約に送れない
    expect((await liff({ action: "submit", reservationId: r.id, answers: {} }, OTHER)).status).toBe(404);
    const ok = await liff({ action: "submit", reservationId: r.id, answers: { [`q_${allergy.id}`]: "金属" } });
    expect(ok.data).toMatchObject({ ok: true });
    const qs = (await c.get(`/patients/${p.id}/questionnaires`)).items;
    expect(qs).toHaveLength(1);
    expect(qs[0].answers).toEqual(expect.arrayContaining([{ q: "お名前", a: "線 花子" }, { q: "アレルギー", a: "金属" }]));
    expect((await c.get(`/patients/${p.id}`)).patient.cautionNote).toBe("アレルギー：金属");
    expect((await liff({ action: "context" })).data.items[0].done).toBe(true);
    expect((await liff({ action: "submit", reservationId: r.id, answers: {} })).status).toBe(400);
    // ID トークンが確かめられなければ断る
    const bad = await fetch(`${h.srv.base}/monshin/liff/api.php`, { method: "POST", headers: { "Content-Type": "application/json", Origin: h.srv.base }, body: JSON.stringify({ idToken: "forged", action: "context" }) });
    expect(bad.status).toBe(403);
  });
});
