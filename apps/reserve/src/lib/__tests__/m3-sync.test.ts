/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは API の応答（JSON）の中身をそのまま調べる */
import { describe, expect, it } from "vitest";
import { addDays, nowInClinic, toIso } from "@/lib/domain/time";
import { withPhp } from "./php/server";

// デジカル（M3）の受付画面への予約の写し（docs/M3-SYNC.md、院長 11/21）
const h = withPhp({ each: true });
const MENU = "menu-s00009A18E";
const integration = (method: string, p: string, body?: unknown) =>
  h.srv.client().raw(method, `/api/v1/integration/m3-sync${p}`, body, { Authorization: `Bearer ${h.srv.integrationToken}` });
const queue = async () => (await integration("GET", "")).data as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const c = await h.srv.as("staff-admin");
  const day = addDays(nowInClinic().date, 3);
  const book = async (patientId: string, min: number, memo?: string) =>
    c.post("/reservations", { patientId, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, min), endAt: toIso(day, min + 30), ...(memo && { memo }) });
  return { c, day, book };
}

describe("デジカルへの予約の写し", () => {
  it("連携トークンがなければ読めない。始める前は何も写さない。始めた時刻は変わらない", async () => {
    expect((await h.srv.client().raw("GET", "/api/v1/integration/m3-sync")).status).toBe(401);
    expect(await queue()).toEqual({ startAt: null, items: [], review: [] });
    const s1 = (await integration("POST", "/start")).data as any;
    await sleep(5);
    const s2 = (await integration("POST", "/start")).data as any;
    expect(s2.startAt).toBe(s1.startAt);
  });

  it("写し始めた後に作られた予約だけを写す（今ある予約には触らない）。中身・カルテ番号を渡す", async () => {
    const { c, day, book } = await setup();
    const old = await c.post("/patients", { name: "前から 花子", kana: "マエカラ ハナコ" });
    await book(old.id, 600);
    await sleep(5);
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "新規 太郎", kana: "シンキ タロウ", sex: "male", birthDate: "1990-04-01", m3ChartNo: "76758" });
    const r = await book(p.id, 630, "同伴で受診します");
    const q = await queue();
    expect(q.items).toHaveLength(1);
    const it0 = q.items[0];
    expect(it0.action).toBe("create");
    expect(it0.reservation).toMatchObject({ id: r.id, date: day, time: "1030", minutes: 30, memo: "同伴で受診します", preexisting: false, status: "booked" });
    expect(it0.reservation.menus[0].id).toBe(MENU);
    expect(it0.reservation.lane.id).toBe("lane-main");
    expect(it0.patient).toMatchObject({ id: p.id, m3ChartNo: "76758", kana: "シンキ タロウ", sex: "male", birthDate: "1990-04-01" });
    expect(it0.previous).toBeNull();
  });

  it("写した結果を記録すると一覧から消え、中身が変わったら写し直す。中身に関係ない更新では写し直さない", async () => {
    const { c, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "写し 一郎", m3ChartNo: "1234" });
    const r = await book(p.id, 600);
    const it0 = (await queue()).items[0];
    // 写している間に変わっていたら断る
    const bad = await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: "0".repeat(20) });
    expect(bad.status).toBe(409);
    const ok = await integration("POST", `/reservations/${r.id}`, {
      result: "synced",
      fingerprint: it0.reservation.fingerprint,
      digikar: { patientNo: "1234", date: it0.reservation.date, time: "1000", memoLine: "1000シミ初診" },
    });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ state: "synced", written: "synced", digikar: { patientNo: "1234", time: "1000" } });
    expect((await queue()).items).toEqual([]);
    // 予約申請IDだけを付けても写し直さない
    const r2 = await c.patch(`/reservations/${r.id}`, { version: r.version, requestId: "R20261005ABC" });
    expect((await queue()).items).toEqual([]);
    // メモが変われば写し直す（前に写した内容も渡す）
    const r3 = await c.patch(`/reservations/${r.id}`, { version: r2.version, memo: "局麻で" });
    const up = (await queue()).items;
    expect(up.map((x: any) => x.action)).toEqual(["update"]);
    expect(up[0].previous.digikar.memoLine).toBe("1000シミ初診");
    await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: up[0].reservation.fingerprint });
    expect((await queue()).items).toEqual([]);
    // 取り消したら取消を写す → 予約に戻したら戻す
    const r4 = await c.patch(`/reservations/${r.id}`, { version: r3.version, status: "cancelled" });
    const cx = (await queue()).items;
    expect(cx.map((x: any) => x.action)).toEqual(["cancel"]);
    // 取消でない結果は受け付けない
    expect((await integration("POST", `/reservations/${r.id}`, { result: "synced", fingerprint: cx[0].reservation.fingerprint })).status).toBe(400);
    expect((await integration("POST", `/reservations/${r.id}`, { result: "cancelled", fingerprint: cx[0].reservation.fingerprint })).status).toBe(200);
    expect((await queue()).items).toEqual([]);
    await c.patch(`/reservations/${r.id}`, { version: r4.version, status: "booked" });
    expect((await queue()).items.map((x: any) => x.action)).toEqual(["restore"]);
  });

  it("写し始める前からある予約も、始めた後に取り消されたら取消を写す（院長 11/21）。始める前の取消は写さない", async () => {
    const { c, book } = await setup();
    const p = await c.post("/patients", { name: "手入力 さん", m3ChartNo: "555" });
    const a = await book(p.id, 600);
    const b = await book(p.id, 700);
    await c.patch(`/reservations/${b.id}`, { version: b.version, status: "cancelled" });
    await sleep(5);
    await integration("POST", "/start");
    await sleep(5);
    expect((await queue()).items).toEqual([]);
    await c.patch(`/reservations/${a.id}`, { version: a.version, status: "cancelled" });
    const items = (await queue()).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "cancel", reservation: { id: a.id, preexisting: true, time: "1000" }, patient: { m3ChartNo: "555" } });
  });

  it("要確認にすると一覧から外れて要確認に並ぶ。理由は必須。予約が直されたら写し直す", async () => {
    const { c, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const p = await c.post("/patients", { name: "番号 なし" });
    const r = await book(p.id, 600);
    const fp = (await queue()).items[0].reservation.fingerprint;
    expect((await integration("POST", `/reservations/${r.id}`, { result: "review", fingerprint: fp })).status).toBe(400);
    expect((await integration("POST", `/reservations/${r.id}`, { result: "review", fingerprint: fp, reason: "カルテ番号がなく、同じ名前の候補が2人" })).status).toBe(200);
    const q = await queue();
    expect(q.items).toEqual([]);
    expect(q.review).toHaveLength(1);
    expect(q.review[0]).toMatchObject({ action: "review", previous: { reason: "カルテ番号がなく、同じ名前の候補が2人" } });
    await c.patch(`/reservations/${r.id}`, { version: r.version, memo: "直した" });
    const q2 = await queue();
    expect(q2.items.map((x: any) => x.action)).toEqual(["create"]);
    expect(q2.review).toEqual([]);
  });

  it("予約不可の枠は写さない。from より前の日は出さない", async () => {
    const { c, day, book } = await setup();
    await integration("POST", "/start");
    await sleep(5);
    const blk = await c.post("/patients", { name: "予約不可" });
    await book(blk.id, 600);
    const p = await c.post("/patients", { name: "ふつう さん" });
    await book(p.id, 700);
    expect((await queue()).items).toHaveLength(1);
    expect(((await integration("GET", `?from=${addDays(day, 1)}`)).data as any).items).toEqual([]);
  });
});

// ---- Chrome 拡張機能がスタッフのログインで使う口（院長 11/21：拡張機能にする、要約は LANE RESERVE のサーバーで Claude に） ----

/** Claude の API の代わり（受け取った中身を覚え、決めた1行を返す） */
async function fakeClaude(reply: () => string, usage: () => { input_tokens: number; output_tokens: number } = () => ({ input_tokens: 10, output_tokens: 5 })) {
  const { createServer } = await import("node:http");
  const bodies: any[] = [];
  const srv = createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      bodies.push({ url: req.url, body: JSON.parse(b || "{}"), headers: req.headers });
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_test" });
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: reply() }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: usage(),
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  // 設定ファイルの最後に Claude の行き先を足す（リクエストごとに読み直される）
  const { readFileSync, writeFileSync } = await import("node:fs");
  const conf = readFileSync(h.srv.config, "utf8");
  writeFileSync(h.srv.config, conf.replace(/\]\;\s*$/, `, 'm3_claude_base_url' => 'http://127.0.0.1:${port}'];\n`));
  return { bodies, close: () => new Promise((r) => srv.close(r)) };
}

const KEY = "sk-ant-test-" + "a".repeat(40);

describe("デジカルへの写し：拡張機能の口", () => {
  it("写す札は1台だけが持てる。持ち主は延長でき、返すか期限が切れたら別のパソコンが取れる", async () => {
    const c = await h.srv.as("staff-admin");
    expect(await c.post("/m3-sync/lock", { clientId: "pc-aaaaaaaa", label: "受付PC" })).toMatchObject({ ok: true, holder: "受付PC" });
    expect(await c.post("/m3-sync/lock", { clientId: "pc-bbbbbbbb", label: "診察室PC" })).toMatchObject({ ok: false, holder: "受付PC" });
    expect(await c.post("/m3-sync/lock", { clientId: "pc-aaaaaaaa", label: "受付PC" })).toMatchObject({ ok: true });
    expect((await c.get("/m3-sync/status")).lock).toMatchObject({ holder: "受付PC" });
    await c.post("/m3-sync/unlock", { clientId: "pc-aaaaaaaa" });
    expect(await c.post("/m3-sync/lock", { clientId: "pc-bbbbbbbb", label: "診察室PC" })).toMatchObject({ ok: true, holder: "診察室PC" });
    // ログインしていなければ使えない
    expect([401, 403]).toContain((await h.srv.client().raw("POST", "/api/v1/m3-sync/lock", { clientId: "pc-cccccccc" })).status);
  });

  it("Claude の利用キーは院長だけが入れられ、画面には「設定済み」しか返さない", async () => {
    const c = await h.srv.as("staff-admin");
    expect((await c.get("/m3-sync/settings")).hasKey).toBe(false);
    await expect(c.put("/m3-sync/settings", { apiKey: "abc" })).rejects.toThrow(/sk-ant-/);
    const s = await c.put("/m3-sync/settings", { apiKey: KEY });
    expect(s).toMatchObject({ hasKey: true, model: "claude-opus-5-5" });
    expect(JSON.stringify(s)).not.toContain(KEY);
    expect(JSON.stringify(await c.get("/m3-sync/status"))).not.toContain(KEY);
    // 保存したデータにもそのままは残らない（暗号化）
    expect(h.srv.rawData().includes(Buffer.from(KEY))).toBe(false);
  });

  it("受付メモの1行を Claude に作らせる。氏名・電話は送らず、同じ中身なら作り直さない。先頭が時刻でなければ断る", async () => {
    const c = await h.srv.as("staff-admin");
    let reply = "1030トラネピンク3/5　局麻で　山田さん同伴";
    const fake = await fakeClaude(() => reply);
    try {
      await c.post("/m3-sync/start", {});
      await sleep(5);
      const day = addDays(nowInClinic().date, 3);
      const p = await c.post("/patients", { name: "要約 花子", kana: "ヨウヤク ハナコ", phone: "09011112222", m3ChartNo: "4321" });
      const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 630), endAt: toIso(day, 660), memo: "トラネピンク5回コースの3回目。注射の麻酔希望。山田さんと一緒に来ます" });
      // キーがなければ作れない
      await expect(c.post(`/m3-sync/reservations/${r.id}/memo`, {})).rejects.toThrow(/利用キー/);
      await c.put("/m3-sync/settings", { apiKey: KEY });
      const m = await c.post(`/m3-sync/reservations/${r.id}/memo`, {});
      expect(m).toMatchObject({ memoLine: "1030トラネピンク3/5　局麻で　山田さん同伴", cached: false });
      expect(fake.bodies).toHaveLength(1);
      const sent = JSON.stringify(fake.bodies[0].body);
      expect(sent).toContain("時刻：1030");
      expect(sent).toContain("注射の麻酔希望");
      expect(sent).not.toContain("要約 花子");
      expect(sent).not.toContain("09011112222");
      expect(fake.bodies[0].body.model).toBe("claude-opus-5-5");
      expect(String(fake.bodies[0].headers.authorization ?? fake.bodies[0].headers["x-api-key"])).toContain(KEY);
      expect(String(fake.bodies[0].headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
      expect(fake.bodies[0].body.fallbacks).toBe("default");
      // 同じ中身なら Claude を呼ばない
      expect((await c.post(`/m3-sync/reservations/${r.id}/memo`, {})).cached).toBe(true);
      expect(fake.bodies).toHaveLength(1);
      // 中身が変わり、Claude の答えの先頭が時刻でなければ断る（要確認にする）
      await c.patch(`/reservations/${r.id}`, { version: r.version, memo: "変更" });
      reply = "トラネピンク再診";
      await expect(c.post(`/m3-sync/reservations/${r.id}/memo`, {})).rejects.toThrow(/時刻/);
    } finally {
      await fake.close();
    }
  });

  it("スタッフのログインで一覧を読み、結果を記録できる（記録上は「（デジカル写し）」）", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const day = addDays(nowInClinic().date, 3);
    const p = await c.post("/patients", { name: "拡張 一郎", m3ChartNo: "777" });
    const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    const q = await c.get("/m3-sync");
    expect(q.items.map((x: any) => x.reservation.id)).toEqual([r.id]);
    const rec = await c.post(`/m3-sync/reservations/${r.id}`, { result: "synced", fingerprint: q.items[0].reservation.fingerprint, digikar: { patientNo: "777", date: day, time: "1000", memoLine: "1000シミ初診" } });
    expect(rec.state).toBe("synced");
    expect((await c.get("/m3-sync")).items).toEqual([]);
  });
});

describe("デジカルへの写し：試運転", () => {
  it("試運転の間は決めた患者番号の予約だけを写す。試運転を終えると、写し始めがその時刻になり、試運転中の予約は写さない", async () => {
    const c = await h.srv.as("staff-admin");
    const day = addDays(nowInClinic().date, 3);
    const book = (patientId: string, min: number) => c.post("/reservations", { patientId, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, min), endAt: toIso(day, min + 30) });
    await expect(c.put("/m3-sync/settings", { trialChartNos: "2,abc" })).rejects.toThrow(/数字/);
    expect((await c.put("/m3-sync/settings", { trialChartNos: "2" })).trialChartNos).toEqual(["2"]);
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const practice = await c.post("/patients", { name: "レンシュウ ハナコ", m3ChartNo: "2" });
    const real = await c.post("/patients", { name: "本物 さん", m3ChartNo: "5000" });
    const a = await book(practice.id, 600);
    await book(real.id, 630);
    const q = await c.get("/m3-sync");
    expect(q.trial).toEqual(["2"]);
    expect(q.items.map((x: any) => x.reservation.id)).toEqual([a.id]);
    // 本番にする（試運転の患者を空に）→ 写し始めが今になり、試運転中に入った本物の予約は写さない
    const before = (await c.get("/m3-sync/status")).startAt;
    await sleep(5);
    expect((await c.put("/m3-sync/settings", { trialChartNos: "" })).trialChartNos).toEqual([]);
    const after = (await c.get("/m3-sync/status")).startAt;
    expect(after > before).toBe(true);
    expect((await c.get("/m3-sync")).items).toEqual([]);
    await sleep(5);
    const b = await book(real.id, 700);
    expect((await c.get("/m3-sync")).items.map((x: any) => x.reservation.id)).toEqual([b.id]);
  });
});

describe("デジカルへの写し：試運転（カルテ番号のない患者）", () => {
  it("試運転に LANE RESERVE の患者ID（p-）を入れると、カルテ番号のない完全初診の患者の予約も写す一覧に出る（患者の情報つき）", async () => {
    const c = await h.srv.as("staff-admin");
    const day = addDays(nowInClinic().date, 3);
    const p = await c.post("/patients", { name: "初診 花子", kana: "ショシン ハナコ", sex: "female", birthDate: "1990-04-01", phone: "090-1111-2222" });
    const other = await c.post("/patients", { name: "別の 人", kana: "ベツノ ヒト" });
    expect((await c.put("/m3-sync/settings", { trialChartNos: `2,${p.id}` })).trialChartNos).toEqual(["2", p.id]);
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const r = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    await c.post("/reservations", { patientId: other.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 700), endAt: toIso(day, 730) });
    const q = await c.get("/m3-sync");
    expect(q.items.map((x: any) => x.reservation.id)).toEqual([r.id]);
    expect(q.items[0].patient).toMatchObject({ id: p.id, name: "初診 花子", kana: "ショシン ハナコ", sex: "female", birthDate: "1990-04-01" });
    expect(q.items[0].patient.m3ChartNo).toBeUndefined();
    // 番号を書き戻す（拡張機能がスタッフとして PATCH する）
    const cur = (await c.get(`/patients/${p.id}`)).patient;
    const u = (await c.patch(`/patients/${p.id}`, { version: cur.version, m3ChartNo: "76760" })).patient;
    expect(u.m3ChartNo).toBe("76760");
  });
});

describe("デジカルへの写し：Claude の使いすぎの歯止め（院長 11/21）", () => {
  async function prepared(c: any) {
    await c.post("/m3-sync/start", {});
    await sleep(5);
    await c.put("/m3-sync/settings", { apiKey: KEY });
    const day = addDays(nowInClinic().date, 3);
    const p = await c.post("/patients", { name: "歯止め 花子", m3ChartNo: "9001" });
    return c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 630), memo: "1" });
  }

  it("月の上限に達していたら Claude を呼ばずに止める", async () => {
    const c = await h.srv.as("staff-admin");
    const fake = await fakeClaude(() => "1000シミ初診");
    try {
      const r = await prepared(c);
      expect((await c.put("/m3-sync/settings", { capYen: 0 })).capYen).toBe(0);
      await expect(c.post(`/m3-sync/reservations/${r.id}/memo`, {})).rejects.toThrow(/上限/);
      expect(fake.bodies).toHaveLength(0);
      expect((await c.get("/m3-sync/status")).claude.usage.paused).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it("使ったトークンから円を見積もって足し、1,000円をまたいだら警告を残す。上限を超えたら次から止める", async () => {
    const c = await h.srv.as("staff-admin");
    // 出力 40万トークン＝ 0.4 × 20ドル × 155円 ＝ 1,240円（作りの値）
    const fake = await fakeClaude(() => "1000シミ初診", () => ({ input_tokens: 1000, output_tokens: 400000 }));
    try {
      const r = await prepared(c);
      await c.put("/m3-sync/settings", { capYen: 1200 });
      const m = await c.post(`/m3-sync/reservations/${r.id}/memo`, {});
      expect(m.usage.calls).toBe(1);
      expect(m.usage.yen).toBeGreaterThan(1200);
      expect(m.usage.warnings.map((w: any) => w.yen)).toEqual([1000]);
      expect(m.usage.paused).toBe(true);
      // 次の予約の中身では呼ばない
      const cur = (await c.get(`/day?date=${r.startAt.slice(0, 10)}`)).reservations.find((x: any) => x.id === r.id);
      await c.patch(`/reservations/${r.id}`, { version: cur.version, memo: "2" });
      await expect(c.post(`/m3-sync/reservations/${r.id}/memo`, {})).rejects.toThrow(/上限/);
      expect(fake.bodies).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it("同じ予約で1日に5回呼んだら6回目は止める（くり返しの歯止め）", async () => {
    const c = await h.srv.as("staff-admin");
    const fake = await fakeClaude(() => "1000シミ初診");
    try {
      let r = await prepared(c);
      for (let i = 1; i <= 6; i++) {
        if (i > 1) r = await c.patch(`/reservations/${r.id}`, { version: r.version, memo: `memo${i}` });
        const call = c.post(`/m3-sync/reservations/${r.id}/memo`, {});
        if (i <= 5) await call;
        else await expect(call).rejects.toThrow(/くり返し/);
      }
      expect(fake.bodies).toHaveLength(5);
    } finally {
      await fake.close();
    }
  });
});

describe("デジカルへの写し：もう一度写す", () => {
  it("要確認の予約を、要確認になる前の状態から写し直す（まだ写していない→新しく入れる、写した→写し直す）。要確認でない予約は断る", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const day = addDays(nowInClinic().date, 3);
    const p = await c.post("/patients", { name: "再試 花子", m3ChartNo: "9100" });
    const a = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    const b = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 700), endAt: toIso(day, 730) });
    const fp = async (id: string) => (await c.get("/m3-sync")).items.find((x: any) => x.reservation.id === id).reservation.fingerprint;
    // a：まだ写していないうちに要確認
    await c.post(`/m3-sync/reservations/${a.id}`, { result: "review", fingerprint: await fp(a.id), reason: "テスト" });
    // b：写したあと、変更を写すときに要確認
    await c.post(`/m3-sync/reservations/${b.id}`, { result: "synced", fingerprint: await fp(b.id), digikar: { patientNo: "9100", date: day, time: "1100" } });
    await c.patch(`/reservations/${b.id}`, { version: b.version, memo: "変更" });
    await c.post(`/m3-sync/reservations/${b.id}`, { result: "review", fingerprint: await fp(b.id), reason: "テスト" });
    let q = await c.get("/m3-sync");
    expect(q.items).toEqual([]);
    expect(q.review).toHaveLength(2);
    await expect(c.post(`/m3-sync/reservations/${a.id}/retry`, {})).resolves.toMatchObject({ ok: true });
    await c.post(`/m3-sync/reservations/${b.id}/retry`, {});
    q = await c.get("/m3-sync");
    expect(q.review).toEqual([]);
    expect(Object.fromEntries(q.items.map((x: any) => [x.reservation.id, x.action]))).toEqual({ [a.id]: "create", [b.id]: "update" });
    // 要確認でない予約は断る
    await expect(c.post(`/m3-sync/reservations/${a.id}/retry`, {})).rejects.toThrow(/要確認ではありません/);
  });
});

describe("デジカルへの写し：対応済み", () => {
  it("要確認の予約を一覧から外し、写し直さない。その後に予約が変われば写す。取り消された予約は取消済みとして扱う", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const day = addDays(nowInClinic().date, 4);
    const p = await c.post("/patients", { name: "対応 太郎", m3ChartNo: "9200" });
    const a = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    const fp = async (id: string) => (await c.get("/m3-sync")).items.find((x: any) => x.reservation.id === id).reservation.fingerprint;
    await c.post(`/m3-sync/reservations/${a.id}`, { result: "review", fingerprint: await fp(a.id), reason: "テスト" });
    expect((await c.get("/m3-sync")).review).toHaveLength(1);
    await expect(c.post(`/m3-sync/reservations/${a.id}/resolve`, {})).resolves.toMatchObject({ ok: true });
    let q = await c.get("/m3-sync");
    expect(q.review).toEqual([]);
    expect(q.items.filter((x: any) => x.reservation.id === a.id)).toEqual([]);
    await expect(c.post(`/m3-sync/reservations/${a.id}/resolve`, {})).rejects.toThrow(/要確認ではありません/);
    // その後に変われば写す
    const a2 = await c.patch(`/reservations/${a.id}`, { version: a.version, memo: "変更" });
    q = await c.get("/m3-sync");
    expect(q.items.find((x: any) => x.reservation.id === a.id)?.action).toBe("update");
    // 取り消された予約の要確認を対応済みにすると、取消済みとして扱う
    await c.patch(`/reservations/${a.id}`, { version: a2.version, status: "cancelled" });
    await c.post(`/m3-sync/reservations/${a.id}`, { result: "review", fingerprint: await fp(a.id), reason: "テスト" });
    await c.post(`/m3-sync/reservations/${a.id}/resolve`, {});
    q = await c.get("/m3-sync");
    expect(q.review).toEqual([]);
    expect(q.items.filter((x: any) => x.reservation.id === a.id)).toEqual([]);
  });
});

describe("デジカルへの写し：同じ日の予約は1件にまとめる", () => {
  it("同じ患者・同じ日の有効な予約の時刻（sameDay）と、その日の最初か（firstOfDay）を渡す。まとめた記録（merged）を受け取る", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/m3-sync/start", {});
    await sleep(5);
    const day = addDays(nowInClinic().date, 5);
    const p = await c.post("/patients", { name: "同日 次郎", m3ChartNo: "9300" });
    const a = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 600), endAt: toIso(day, 610) });
    const b = await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: [MENU], startAt: toIso(day, 660), endAt: toIso(day, 675) });
    let q = await c.get("/m3-sync");
    const ia = q.items.find((x: any) => x.reservation.id === a.id).reservation;
    const ib = q.items.find((x: any) => x.reservation.id === b.id).reservation;
    expect([ia.firstOfDay, ia.sameDay]).toEqual([true, ["1100"]]);
    expect([ib.firstOfDay, ib.sameDay]).toEqual([false, ["1000"]]);
    await c.post(`/m3-sync/reservations/${a.id}`, { result: "synced", fingerprint: ia.fingerprint, digikar: { patientNo: "9300", date: day, time: "1000" } });
    await c.post(`/m3-sync/reservations/${b.id}`, { result: "synced", fingerprint: ib.fingerprint, digikar: { patientNo: "9300", date: day, time: "1000", merged: true } });
    // 最初の予約を取り消すと、残る予約が sameDay に出る（デジカルの1件はそのままにできる）
    await c.patch(`/reservations/${a.id}`, { version: a.version, status: "cancelled" });
    q = await c.get("/m3-sync");
    const ca = q.items.find((x: any) => x.reservation.id === a.id);
    expect([ca.action, ca.reservation.sameDay]).toEqual(["cancel", ["1100"]]);
    expect(q.items.find((x: any) => x.reservation.id === b.id)).toBeUndefined();
  });
});
