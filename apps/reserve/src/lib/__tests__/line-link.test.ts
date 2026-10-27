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

describe("予約申請から LINE を一度特定したら、患者に紐付ける", () => {
  it("受付で取った申請IDのない次回予約にも、患者の LINE で届くようになる", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "継続 花子", kana: "ケイゾク ハナコ", birthDate: "1985-05-05" });
    const RID2 = "R20261001100000AB12CD99";
    const past = addDays(nowInClinic().date, -14);
    await c.post("/reservations", { patientId: p.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(past, 600), endAt: toIso(past, 630), memo: `初回 予約申請ID：${RID2}` });
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RID2}.json`), JSON.stringify({ requestId: RID2, type: "reservation_intake", source: { userId: "U" + "c".repeat(32) }, intake: { name: "継続 花子", birthDate: "1985-05-05" } }));
    // 別の LINE が既に紐付いた患者、申請と生年月日が違う患者には触れない
    const other = await c.post("/patients", { name: "継続 次郎", kana: "ケイゾク ジロウ", birthDate: "1980-01-01" });
    const RID3 = "R20261001100000AB12CD98";
    await c.post("/reservations", { patientId: other.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(past, 700), endAt: toIso(past, 730), requestId: RID3 });
    writeFileSync(path.join(dir, `${RID3}.json`), JSON.stringify({ requestId: RID3, type: "reservation_intake", source: { userId: "U" + "d".repeat(32) }, intake: { name: "継続 次郎", birthDate: "1999-09-09" } }));

    const r = await c.post("/admin/reminders/link-lines", {});
    expect(r.linked).toBe(1);
    expect((await c.get(`/patients/${p.id}`)).patient?.lineUserId ?? (await c.get(`/patients/${p.id}`)).lineUserId).toBe("U" + "c".repeat(32));
    const o = await c.get(`/patients/${other.id}`);
    expect(o.patient?.lineUserId ?? o.lineUserId).toBeUndefined();
    // もう一度しても増えない
    expect((await c.post("/admin/reminders/link-lines", {})).linked).toBe(0);
  });
});

describe("予約申請IDが入ったら、その場で LINE を連携する", () => {
  it("申請が先にあれば予約の保存で、予約が先なら申請が届いた時点で連携する", async () => {
    const c = await h.srv.as("staff-admin");
    const day = addDays(nowInClinic().date, 3);
    const lineOf = async (id: string) => {
      const d = await c.get(`/patients/${id}`);
      return d.patient?.lineUserId ?? d.lineUserId;
    };
    // 申請が先：予約申請IDを予約に入れた瞬間に連携
    const RA = "R20261015100000AB12CD01";
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RA}.json`), JSON.stringify({ requestId: RA, type: "reservation_intake", source: { userId: "U" + "e".repeat(32) }, intake: { name: "即時 花子", birthDate: "1990-02-02" } }));
    const a = await c.post("/patients", { name: "即時 花子", kana: "ソクジ ハナコ", birthDate: "1990-02-02" });
    const ra = await c.post("/reservations", { patientId: a.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 600), endAt: toIso(day, 630) });
    expect(await lineOf(a.id)).toBeUndefined();
    await c.patch(`/reservations/${ra.id}`, { version: ra.version, requestId: RA });
    expect(await lineOf(a.id)).toBe("U" + "e".repeat(32));

    // 予約が先：申請が届いた時点で連携
    const RB = "R20261015110000AB12CD02";
    const b = await c.post("/patients", { name: "後着 太郎", kana: "コウチャク タロウ", birthDate: "1988-08-08" });
    await c.post("/reservations", { patientId: b.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 700), endAt: toIso(day, 730), memo: `申請 ${RB}` });
    expect(await lineOf(b.id)).toBeUndefined();
    await h.srv.php(`Intake::store(['requestId' => '${RB}', 'type' => 'reservation_intake', 'source' => ['userId' => 'U${"f".repeat(32)}'], 'intake' => ['name' => '後着 太郎', 'birthDate' => '1988-08-08']]); return true;`);
    expect(await lineOf(b.id)).toBe("U" + "f".repeat(32));

    // 姓名の間の空白（半角・全角・なし）の違いでは外さない。患者の検索も同じ
    const RC = "R20261015120000AB12CD03";
    writeFileSync(path.join(dir, `${RC}.json`), JSON.stringify({ requestId: RC, type: "reservation_intake", source: { userId: "U" + "9".repeat(32) }, intake: { name: "空白　三郎", kana: "クウハク サブロウ" } }));
    const cc = await c.post("/patients", { name: "空白三郎", kana: "クウハクサブロウ" });
    await c.post("/reservations", { patientId: cc.id, laneId: "lane-main", menuIds: ["menu-s00009A18E"], startAt: toIso(day, 800), endAt: toIso(day, 830), requestId: RC });
    expect(await lineOf(cc.id)).toBe("U" + "9".repeat(32));
    for (const q of ["空白 三郎", "空白　三郎", "空白三郎", "くうはく さぶろう"]) {
      expect((await c.get(`/patients?q=${encodeURIComponent(q)}`)).items.map((x: { id: string }) => x.id), q).toContain(cc.id);
    }
  });
});

describe("未連携の患者に、手動で LINE を連携する", () => {
  it("公式アカウントとやりとりした LINE・予約申請をした LINE が候補に出て、選ぶと連携できる。送った文の言葉でも探せる", async () => {
    const c = await setup();
    // 友だち追加とメッセージ
    expect((await webhook([{ type: "follow", replyToken: "rt-f", source: { type: "user", userId: OTHER } }])).status).toBe(200);
    expect((await webhook([{ ...text("来週予約したいです"), source: { type: "user", userId: OTHER } }])).status).toBe(200);
    // 予約申請をした LINE（申請の氏名つき）
    const RID4 = "R20261002100000AB12CD97";
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RID4}.json`), JSON.stringify({ requestId: RID4, type: "reservation_intake", receivedAt: "2026-10-02T01:00:00Z", source: { userId: USER }, intake: { name: "手動 連子" } }));

    const p = await c.post("/patients", { name: "手動 連子", kana: "シュドウ レンコ" });
    const all = (await c.get(`/patients/${p.id}/line-candidates?q=`)).items;
    const uids = all.map((x: { userId: string }) => x.userId);
    expect(uids).toContain(OTHER);
    expect(uids).toContain(USER);
    expect(all.find((x: { userId: string }) => x.userId === USER).names).toEqual(["手動 連子"]);
    // 送った文は一覧には出さないが、言葉で探すと見つかり、合った文だけが出る
    expect(JSON.stringify(all)).not.toContain("来週予約したいです");
    const byText = (await c.get(`/patients/${p.id}/line-candidates?q=${encodeURIComponent("来週予約")}`)).items;
    expect(byText.map((x: { userId: string }) => x.userId)).toEqual([OTHER]);
    expect(byText[0].matchedText).toBe("来週予約したいです");
    // 申請の氏名で絞れる
    expect((await c.get(`/patients/${p.id}/line-candidates?q=${encodeURIComponent("手動")}`)).items.map((x: { userId: string }) => x.userId)).toEqual([USER]);

    await c.post(`/patients/${p.id}/link-line`, { userId: USER, version: p.version });
    const after = await c.get(`/patients/${p.id}`);
    expect(after.patient?.lineUserId ?? after.lineUserId).toBe(USER);
    // 候補には連携済みの患者が出る
    const again = (await c.get(`/patients/${p.id}/line-candidates?q=`)).items.find((x: { userId: string }) => x.userId === USER);
    expect(again.patients.map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it("公式アカウントの友だち全員を、表示名で探せる候補に入れる（何度流しても同じ）", async () => {
    const c = await setup();
    const F1 = "U" + "1".repeat(32);
    const F2 = "U" + "2".repeat(32);
    const code = `LineLink::$transport = function ($m, $url) {
      if (str_contains($url, '/followers/ids') && !str_contains($url, 'start=')) return [200, json_encode(['userIds' => ['${F1}'], 'next' => 'p2'])];
      if (str_contains($url, '/followers/ids')) return [200, json_encode(['userIds' => ['${F2}']])];
      if (str_contains($url, '/profile/${F1}')) return [200, json_encode(['displayName' => 'ゆきんこ'])];
      if (str_contains($url, '/profile/${F2}')) return [200, json_encode(['displayName' => 'Taro Y'])];
      return [404, ''];
    };
    $s = Db::i()->meta('reminderSecrets'); Db::i()->setMeta('reminderSecrets', [...(is_array($s) ? $s : []), 'lineToken' => 'x']);
    return [LineLink::importFollowers(), LineLink::importFollowers()];`;
    const [first, second] = await h.srv.php<Array<{ followers: number; named: number }>>(code);
    expect(first).toMatchObject({ followers: 2, named: 2 });
    expect(second).toMatchObject({ followers: 2, named: 0 });
    const p = await c.post("/patients", { name: "友達 雪子", kana: "トモダチ ユキコ" });
    expect((await c.get(`/patients/${p.id}/line-candidates?q=${encodeURIComponent("ゆきん")}`)).items.map((x: { userId: string }) => x.userId)).toEqual([F1]);
    // 「LINEで連絡」：対応表にない人はチャット一覧と表示名、対応表にある人はそのチャット
    await c.post(`/patients/${p.id}/link-line`, { userId: F1, version: p.version });
    expect(await c.get(`/patients/${p.id}/line-chat`)).toEqual({ displayName: "ゆきんこ", chatUrl: null, listUrl: "https://chat.line.biz/" });
    const A = "U" + "a".repeat(32);
    const C = "U" + "c".repeat(32);
    await h.srv.php(`Db::i()->setMeta('lineChatAccount', '${A}'); $c = Db::i()->get('lineContact', '${F1}'); $c['chatId'] = '${C}'; Db::i()->put('lineContact', '${F1}', $c); return true;`);
    expect((await c.get(`/patients/${p.id}/line-chat`)).chatUrl).toBe(`https://chat.line.biz/${A}/chat/${C}`);
  });
});

describe("LINE チャット連携（Chrome 拡張）", () => {
  it("開いたチャットを、予約申請ID・プロフィール画像・表示名で患者の LINE に結びつけ、「LINEで連絡」で直接開ける", async () => {
    const c = await h.srv.as("staff-admin");
    const { token } = await c.post("/device-links", { source: "linechat", name: "受付" });
    const send = (body: object, t = token) => h.srv.client().raw("POST", "/api/v1/integration/line-chats", body, { "X-Device-Token": t });
    const A = "U" + "a".repeat(32);
    const U1 = "U" + "1".repeat(32);
    const U2 = "U" + "2".repeat(32);
    const RID = "R20261027100000AB12CD05";
    // 友だち（表示名と画像）と、U1 の予約申請
    await h.srv.php(`Db::i()->put('lineContact', '${U1}', ['userId' => '${U1}', 'displayName' => 'はなこ', 'pictureHash' => 'PIC1xxxxxxxxxx']);
      Db::i()->put('lineContact', '${U2}', ['userId' => '${U2}', 'displayName' => 'Taro', 'pictureHash' => 'PIC2xxxxxxxxxx']); return true;`);
    const dir = path.join(h.srv.dir, "intake");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${RID}.json`), JSON.stringify({ requestId: RID, type: "reservation_intake", source: { userId: U1 }, intake: { name: "連携 花子" } }));
    const p = await c.post("/patients", { name: "連携 花子", kana: "レンケイ ハナコ" });
    await c.post(`/patients/${p.id}/link-line`, { userId: U1, version: p.version });

    // 鍵がない・ほかの連携の鍵では入れない
    expect((await send({ account: A, chatId: "U" + "c".repeat(32) }, "lc_" + "0".repeat(40))).status).toBe(401);
    // 申請IDで結びつく。見出しの名前（院で付けた名前）も残り、検索で使える
    const C1 = "U" + "c".repeat(32);
    expect((await send({ account: A, chatId: C1, requestIds: [RID], name: "連携花子（院で付けた名前）", iconHash: "PIC1xxxxxxxxxx" })).data).toEqual({ ok: true, how: "request" });
    expect(await c.get(`/patients/${p.id}/line-chat`)).toMatchObject({ chatUrl: `https://chat.line.biz/${A}/chat/${C1}` });
    expect((await c.get(`/patients/${p.id}/line-candidates?q=${encodeURIComponent("院で付けた")}`)).items.map((x: { userId: string }) => x.userId)).toEqual([U1]);
    // 画像だけでも結びつく。申請IDの人と画像が違えば結びつけない
    const C2 = "U" + "d".repeat(32);
    expect((await send({ account: A, chatId: C2, iconHash: "PIC2xxxxxxxxxx" })).data).toEqual({ ok: true, how: "picture" });
    expect((await send({ account: A, chatId: C2, requestIds: [RID], iconHash: "PIC2xxxxxxxxxx" })).data).toEqual({ ok: false, reason: "picture_mismatch" });
    // 手がかりがなければ結びつけない。別の公式アカウントは断る
    expect((await send({ account: A, chatId: "U" + "e".repeat(32), name: "だれでもない" })).data).toEqual({ ok: false, reason: "not_found" });
    expect((await send({ account: "U" + "b".repeat(32), chatId: C1, requestIds: [RID] })).data).toEqual({ ok: false, reason: "other_account" });

    // 手動の連携：同じ表示名が2人いて自動では決まらないチャットも、URL を貼って選べば、リマインドと「LINEで連絡」の両方が一度に通じる
    const U3 = "U" + "3".repeat(32);
    const U4 = "U" + "4".repeat(32);
    await h.srv.php(`Db::i()->put('lineContact', '${U3}', ['userId' => '${U3}', 'displayName' => '同名', 'pictureHash' => '']);
      Db::i()->put('lineContact', '${U4}', ['userId' => '${U4}', 'displayName' => '同名', 'pictureHash' => '']); return true;`);
    const C3 = "U" + "f".repeat(32);
    expect((await send({ account: A, chatId: C3, name: "同名" })).data).toEqual({ ok: false, reason: "not_found" });
    const q = await c.post("/patients", { name: "手動 同名", kana: "シュドウ ドウメイ" });
    const url = `https://chat.line.biz/${A}/chat/${C3}`;
    const cands = (await c.get(`/patients/${q.id}/line-candidates?q=${encodeURIComponent(url)}`)).items;
    expect(cands.map((x: { userId: string }) => x.userId).sort()).toEqual([U3, U4]);
    expect(cands[0].chatId).toBe(C3);
    await c.post(`/patients/${q.id}/link-line`, { userId: U4, version: q.version, chatId: C3 });
    const d = await c.get(`/patients/${q.id}`);
    expect(d.patient?.lineUserId ?? d.lineUserId).toBe(U4);
    expect((await c.get(`/patients/${q.id}/line-chat`)).chatUrl).toBe(url);
    // 次からはそのチャットの人だけが出る
    expect((await c.get(`/patients/${q.id}/line-candidates?q=${encodeURIComponent(url)}`)).items.map((x: { userId: string }) => x.userId)).toEqual([U4]);
  });
});
