import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

// 患者が入力する問診票（/monshin/）。ログインなしで送れ、Googleフォームの取り込みと同じく患者に結びつく
const h = withPhp({ each: true });

async function openPage() {
  const res = await fetch(`${h.srv.base}/monshin/`);
  const html = await res.text();
  const stamp = /name="stamp" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const ids = Object.fromEntries([...html.matchAll(/<label class="q" for="q_([^"]+)">([^<]+)/g)].map((m) => [m[2], m[1]]));
  return { res, html, stamp, ids };
}

async function send(fields: Record<string, string>) {
  const res = await fetch(`${h.srv.base}/monshin/`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: h.srv.base },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, html: await res.text(), location: res.headers.get("location") };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("患者が入力する問診票", () => {
  it("送信すると患者に結びつき、空欄だけ埋まる。回答はページからは見えない", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "問診 たろう", birthDate: "1985-03-04" });
    const { res, stamp, ids } = await openPage();
    expect(res.status).toBe(200);
    // 開いてすぐの送信はボットとみなして断る
    const quick = await send({ stamp, [`q_${ids["お名前"]}`]: "問診 たろう" });
    expect(quick.status).toBe(400);
    await wait(3100);
    // 必須の欄が空なら保存しない
    const missing = await send({ stamp, [`q_${ids["お名前"]}`]: "問診 たろう" });
    expect(missing.status).toBe(400);
    expect(missing.html, /class="alert"[^>]*>([^<]*)/.exec(missing.html)?.[1]).toContain("入力してください");
    // スマホは送信後も下のほうが表示されたままなので、送信ボタンのすぐ上にも直す所を出す
    // iPhone の Safari は送り元を null で送ることがある。ブラウザが同じページからと示していれば受け付ける
    const nullOrigin = await fetch(`${h.srv.base}/monshin/`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "null", "Sec-Fetch-Site": "same-origin" },
      body: new URLSearchParams({ stamp }).toString(),
    }).then((r) => r.text());
    expect(nullOrigin).not.toContain("このページから送信してください");
    const crossNull = await fetch(`${h.srv.base}/monshin/`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "null", "Sec-Fetch-Site": "cross-site" },
      body: new URLSearchParams({ stamp }).toString(),
    }).then((r) => r.text());
    expect(crossNull).toContain("このページから送信してください");
    const bottom = missing.html.slice(missing.html.lastIndexOf("まだ送信されていません"));
    expect(bottom).toMatch(/<li>「[^」]+」：入力してください<\/li>[\s\S]*type="submit"/);
    const ok = await send({
      stamp,
      [`q_${ids["お名前"]}`]: "問診 たろう",
      [`q_${ids["フリガナ"]}`]: "モンシン タロウ",
      [`q_${ids["生年月日"]}`]: "1985-03-04",
      [`q_${ids["電話番号"]}`]: "090-3333-4444",
      [`q_${ids["メールアドレス"]}`]: "taro@example.com",
      [`q_${ids["アレルギー"]}`]: "アルコール",
      [`q_${ids["その他のご相談事項"]}`]: "くすみ",
    });
    expect(ok.status).toBe(303);
    expect(ok.location).toBe("?done=1");
    const u = (await c.get(`/patients/${p.id}`)).patient;
    expect(u.phone).toBe("090-3333-4444");
    expect(u.email).toBe("taro@example.com");
    expect(u.cautionNote).toBe("アレルギー：アルコール");
    expect(u.questionnaireOther).toContain("その他のご相談事項：くすみ");
    const qs = (await c.get(`/patients/${p.id}/questionnaires`)).items;
    expect(qs).toHaveLength(1);
    const done = await fetch(`${h.srv.base}/monshin/?done=1`).then((r) => r.text());
    expect(done).toContain("送信しました");
    expect(done).not.toContain("くすみ");

    // CSV の書き出し：院長・管理者だけ。操作の記録に残る
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const csv = await c.raw("GET", `/api/v1/questionnaires/export?from=${today}&to=${today}`);
    expect(csv.status).toBe(200);
    const text = new TextDecoder().decode(csv.bytes);
    expect(text).toContain('"その他のご相談事項"');
    expect(text).toContain('"くすみ"');
    const ns = await c.post("/staff", { name: "看護師（テスト）", role: "nurse", pin: "246810" });
    const staff = await h.srv.as(ns.id, "246810");
    expect((await staff.raw("GET", `/api/v1/questionnaires/export?from=${today}&to=${today}`)).status).toBe(403);
  });

  it("隠し欄が埋まった送信は保存せず、同じ送り元からの送りすぎは断る", async () => {
    const c = await h.srv.as("staff-admin");
    const { stamp, ids } = await openPage();
    await wait(3100);
    const bot = await send({ stamp, website: "http://spam.example", [`q_${ids["お名前"]}`]: "ボット" });
    expect(bot.status).toBe(303);
    expect((await c.get("/questionnaires/unmatched")).items).toHaveLength(0);
    const one = {
      stamp,
      [`q_${ids["お名前"]}`]: "連投 さん",
      [`q_${ids["フリガナ"]}`]: "レントウ サン",
      [`q_${ids["生年月日"]}`]: "2000-01-01",
      [`q_${ids["電話番号"]}`]: "09000000000",
    };
    for (let i = 0; i < 5; i++) expect((await send(one)).status).toBe(303);
    expect((await send(one)).status).toBe(429);
    expect((await c.get("/questionnaires/unmatched")).items).toHaveLength(5);
  });

  it("質問は院長・管理者が変えられ、お名前（必須）は外せない", async () => {
    const c = await h.srv.as("staff-admin");
    const { form } = await c.get("/monshin/form");
    const without = form.questions.filter((q: { label: string }) => q.label !== "お名前");
    await expect(c.post("/monshin/form", { ...form, questions: without })).rejects.toThrow(/お名前/);
    const next = await c.post("/monshin/form", { ...form, questions: [...form.questions, { label: "来院のきっかけ", type: "choice", required: false, options: ["ホームページ", "紹介"] }] });
    expect(next.questions.at(-1).label).toBe("来院のきっかけ");
    const { html } = await openPage();
    expect(html).toContain("来院のきっかけ");
    expect(html).toContain('value="紹介"');
  });
});

describe("問診票のメールアドレス", () => {
  it("docomo・au の古いアドレス（.. や @ の直前の .）も受け付け、形の崩れたものは断る", async () => {
    const check = (v: string) =>
      h.srv.php(`return array_keys(Monshin::validate([['id' => 'm', 'label' => 'メールアドレス', 'type' => 'email', 'required' => true, 'options' => []]], ['q_m' => ${JSON.stringify(v)}])[0]);`);
    for (const ok of ["a..b@docomo.ne.jp", "abc.@ezweb.ne.jp", "x@gmail.com", "ｘ＠ｇｍａｉｌ．ｃｏｍ"]) expect(await check(ok), ok).toEqual([]);
    for (const bad of ["bad", "a@b", "a@.com", "a b@x.jp"]) expect(await check(bad), bad).toEqual(["m"]);
  });
});
