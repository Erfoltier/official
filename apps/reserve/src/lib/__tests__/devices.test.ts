/* eslint-disable @typescript-eslint/no-explicit-any -- テストでは応答の JSON をそのまま調べる */
import { describe, expect, it } from "vitest";
import { ADMIN_PIN, withPhp } from "./php/server";

// 登録した端末だけで使う。端末は rsv_device の Cookie で見分ける
const h = withPhp({ each: true });

/** Cookie（スタッフ・端末）を覚えるブラウザ */
function browser() {
  const jar = new Map<string, string>();
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(h.srv.base + "/api/v1" + path, {
      method,
      headers: { Origin: h.srv.base, "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };
  return { req, jar };
}

describe("登録した端末", () => {
  it("オンにした端末は使える。ほかの端末は承認待ちになり、承認すると使える", async () => {
    const pc = browser();
    expect((await pc.req("POST", "/auth/login", { staffId: "staff-admin", pin: ADMIN_PIN })).status).toBe(200);
    expect(pc.jar.has("rsv_device")).toBe(true);
    expect((await pc.req("POST", "/security", { requireDevice: true })).data.requireDevice).toBe(true);
    expect((await pc.req("GET", "/auth/me")).status).toBe(200);

    const tablet = browser();
    const denied = await tablet.req("POST", "/auth/login", { staffId: "staff-admin", pin: ADMIN_PIN });
    expect(denied.status).toBe(403);
    expect(denied.data.error).toBe("device_pending");
    expect(tablet.jar.has("rsv_staff")).toBe(false);

    const list = (await pc.req("GET", "/devices")).data.items;
    expect(list).toHaveLength(2);
    const pending = list.find((d: any) => d.status === "pending");
    expect(list.find((d: any) => d.current).status).toBe("approved");
    await pc.req("POST", `/devices/${pending.id}/approve`, { label: "受付の iPad" });
    expect((await tablet.req("POST", "/auth/login", { staffId: "staff-admin", pin: ADMIN_PIN })).status).toBe(200);
    expect((await tablet.req("GET", "/auth/me")).status).toBe(200);

    // 使用停止にすると、ログイン中でも締め出す
    await pc.req("POST", `/devices/${pending.id}/block`, {});
    expect((await tablet.req("GET", "/auth/me")).status).toBe(403);
  });
});
