/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ADMIN_PIN, withPhp } from "./php/server";

// 二要素認証（認証アプリの6桁・TOTP）
const h = withPhp({ each: true });

function base32Decode(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret: string, offset = 0): string {
  const step = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = mac[19] & 0x0f;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

async function pinLogin(staffId: string, pin: string) {
  const c = h.srv.client();
  const r = await c.raw("POST", "/api/v1/auth/login", { staffId, pin });
  return { c, r: r.data as any, cookie: c.cookie };
}

describe("二要素認証", () => {
  it("必須にすると、PIN のあとに登録→6桁でログイン。同じ数字は使い回せず、院長・管理者が登録を消せる", async () => {
    const admin = await h.srv.as("staff-admin");
    const ns = await admin.post("/staff", { name: "看護（二要素）", role: "nurse", pin: "246810" });
    // 必須にする前は、PIN だけでログインできる
    expect((await pinLogin(ns.id, "246810")).r.id).toBe(ns.id);
    expect(await admin.post("/security", { require2fa: true })).toMatchObject({ require2fa: true, requireDevice: false });

    const first = await pinLogin(ns.id, "246810");
    expect(first.r.need).toBe("enroll");
    expect(first.cookie).toBe("");
    expect(first.r.otpauth).toContain("otpauth://totp/");
    // 違う数字は断る
    const bad = await first.c.raw("POST", "/api/v1/auth/login/2fa", { ticket: first.r.ticket, code: "000000" });
    expect(bad.status).toBe(403);
    const ok = await first.c.raw("POST", "/api/v1/auth/login/2fa", { ticket: first.r.ticket, code: totp(first.r.secret) });
    expect(ok.status).toBe(200);
    expect(first.c.cookie).not.toBe("");
    // 使い終わった確認券は使えない
    expect((await first.c.raw("POST", "/api/v1/auth/login/2fa", { ticket: first.r.ticket, code: totp(first.r.secret, 1) })).status).toBe(429);

    // 次からは数字だけ（登録画面は出ない）。同じ数字の使い回しは断る
    const again = await pinLogin(ns.id, "246810");
    expect(again.r.need).toBe("totp");
    expect(again.r.secret).toBeUndefined();
    expect((await again.c.raw("POST", "/api/v1/auth/login/2fa", { ticket: again.r.ticket, code: totp(first.r.secret) })).status).toBe(403);
    expect((await again.c.raw("POST", "/api/v1/auth/login/2fa", { ticket: again.r.ticket, code: totp(first.r.secret, 1) })).status).toBe(200);

    const list = await admin.get("/staff");
    expect(list.items.find((s: any) => s.id === ns.id).twoFactor).toBe(true);
    await admin.post(`/staff/${ns.id}/reset-2fa`);
    expect((await pinLogin(ns.id, "246810")).r.need).toBe("enroll");
    // 院長自身も、次のログインで登録が要る
    expect((await pinLogin("staff-admin", ADMIN_PIN)).r.need).toBe("enroll");
  });
});
