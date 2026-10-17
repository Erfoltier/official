/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  it("Webhook：署名が正しいときだけ受け、「問診票」にだけ返信する（予約申請には返さない）", async () => {
    await setup();
    expect((await webhook([text("問診票")], "f".repeat(32))).status).toBe(401);
    expect((await webhook([])).status).toBe(200);
    expect((await webhook([text(`【予約申請】\n予約申請ID：${RID}\n受診区分：初診\nお名前：テスト`)])).data.replied).toBe(0);
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
    const after = (await liff({ action: "context" })).data.items[0];
    expect(after.done).toBe(true);
    // 送信した内容が下書きに入り、来院日までは直せる（前の回答は置き換えとして外れ、患者画面には最新の1件）
    expect(after.answers[`q_${allergy.id}`]).toBe("金属");
    expect((await liff({ action: "submit", reservationId: r.id, answers: { [`q_${allergy.id}`]: "金属・アルコール" } })).data.ok).toBe(true);
    const qs2 = (await c.get(`/patients/${p.id}/questionnaires`)).items;
    expect(qs2).toHaveLength(1);
    expect(qs2[0].answers).toEqual(expect.arrayContaining([{ q: "アレルギー", a: "金属・アルコール" }]));
    // ID トークンが確かめられなければ断る
    const bad = await fetch(`${h.srv.base}/monshin/liff/api.php`, { method: "POST", headers: { "Content-Type": "application/json", Origin: h.srv.base }, body: JSON.stringify({ idToken: "forged", action: "context" }) });
    expect(bad.status).toBe(403);
  });
});

describe("予約申請フォーム（monshin/intake/）", () => {
  it("申請の文面が LINE に届くと記録に印が付き、フォームの確認（intake-status）で届いたとわかる", async () => {
    await setup();
    const q = path.join(h.srv.dir, "intakeq");
    mkdirSync(path.join(q, "intake-records"), { recursive: true });
    const rec = path.join(q, "intake-records", `${RID}.json`);
    writeFileSync(rec, JSON.stringify({ requestId: RID, type: "reservation_intake", status: "submitted", source: { type: "user", userId: USER }, intake: { visitType: "initial" } }));
    // フォームが受け取る確認用の印（intake-submit-v1.php と同じ作り）
    const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const body = b64(JSON.stringify({ r: RID, u: USER, iat: 1, exp: Math.floor(Date.now() / 1000) + 600 }));
    const token = `${body}.${b64(createHmac("sha256", "s".repeat(40)).update(body).digest())}`;
    const status = async () => (await (await fetch(`${h.srv.base}/monshin/intake-status-v1.php`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).json()) as any;
    expect((await status()).lineMessageReceived).toBe(false);
    // 別の人の LINE から同じ番号が送られても印は付けない
    const other = { ...text(`受診区分：①初診\n\n予約申請ID：${RID}`), source: { type: "user", userId: OTHER } };
    await webhook([other]);
    expect(JSON.parse(readFileSync(rec, "utf8")).lineMessageReceivedAt).toBeUndefined();
    expect((await webhook([text(`【美容皮膚科・初診予約申請】\n受診区分：①初診\n\n予約申請ID：${RID}`)])).data.replied).toBe(0);
    expect(JSON.parse(readFileSync(rec, "utf8")).status).toBe("line_message_received");
    expect((await status()).lineMessageReceived).toBe(true);
    // 設定（LIFF ID・特別診療日）だけを返し、秘密の値は返さない
    const conf = await (await fetch(`${h.srv.base}/monshin/intake-config.php`)).json();
    expect(conf).toMatchObject({ ok: true, liffId: "1234567890-AbCdEfGh" });
    expect(JSON.stringify(conf)).not.toContain("s".repeat(40));
    expect((await fetch(`${h.srv.base}/monshin/intake/`)).status).toBe(200);
  });
});

describe("予約申請を DB に保存する（monshin/intake-submit-v1.php）", () => {
  it("申請はファイルではなく DB に入り、受付箱・LINE の問診票・届いた印がそこから動く", async () => {
    const c = await setup();
    const day = addDays(nowInClinic().date, 3);
    const res = await fetch(`${h.srv.base}/monshin/intake-submit-v1.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: `test:${USER}`,
        message: "【美容皮膚科・初診予約申請】\n受診区分：①初診\nお名前：申請 花子",
        form: { visitType: "initial", privacyConsent: "agreed", name: "申請 花子", kana: "シンセイ ハナコ", birthDate: "1992-03-04", phone: "09011112222", preferredDate: day },
      }),
    });
    expect(res.status).toBe(201);
    const { requestId } = (await res.json()) as { requestId: string };
    // ファイルは作らない
    expect(() => readFileSync(path.join(h.srv.dir, "intakeq", "intake-records", `${requestId}.json`))).toThrow();
    const box = await c.get("/intake");
    expect(box.items.find((i: any) => i.requestId === requestId)).toMatchObject({ name: "申請 花子", visitType: "initial", state: "new" });

    const p = await c.post("/patients", { name: "申請 花子", kana: "シンセイ ハナコ", birthDate: "1992-03-04" });
    await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 610), requestId });
    expect((await liff({ action: "context" })).data.items).toHaveLength(1);

    mkdirSync(path.join(h.srv.dir, "intakeq"), { recursive: true });
    expect((await webhook([text(`受診区分：①初診\n\n予約申請ID：${requestId}`)])).data.replied).toBe(0);
  });
});
