import { describe, expect, it } from "vitest";
import { withPhp, type Client } from "./php/server";

const h = withPhp({ each: true });

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, n, 0xff, 0xd9]);

/** 院のパソコンの取り込み係と同じ送り方（鍵は設定 → 外部機器の連携 で発行） */
async function device(c: Client) {
  const { token } = await c.post("/device-links", { source: "neovoir" });
  const send = async (f: { patientName: string; fileName: string; ref: string; bytes: Uint8Array }) => {
    const q = new URLSearchParams({ name: f.patientName, file: f.fileName, ref: f.ref });
    const r = await h.srv.client().raw("POST", `/api/v1/integration/photos?${q}`, f.bytes, { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" });
    expect(r.status).toBe(200);
    return r.data as { status: string; id: string };
  };
  return send;
}

const filesOf = async (c: Client, patientId: string) => (await c.get(`/patients/${patientId}/files`)).items.map((f: { id: string }) => f.id);

describe("機器の写真を患者へ振り分ける", () => {
  it("同姓同名でも、顧客番号がカルテ番号（またはM3番号）と合う人が1人ならその人へ", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/patients", { name: "写真 はなこ", chartNo: "00123" });
    const b = await c.post("/patients", { name: "写真 はなこ", chartNo: "456", m3ChartNo: "789" });
    const send = await device(c);
    const r1 = await send({ patientName: "写真 はなこ", fileName: "123_1_F_NL_写真 はなこ.jpg", ref: "123", bytes: jpeg(1) });
    expect(r1.status).toBe("saved");
    expect(await filesOf(c, a.id)).toEqual([r1.id]);
    const r2 = await send({ patientName: "写真 はなこ", fileName: "789_1_F_NL_写真 はなこ.jpg", ref: "789", bytes: jpeg(2) });
    expect(await filesOf(c, b.id)).toEqual([r2.id]);
  });

  it("旧字体・異体字で登録された氏名でも、1人に決まればその人へ（川瀨／川瀬、冨沢／富沢）", async () => {
    const c = await h.srv.as("staff-admin");
    const a = await c.post("/patients", { name: "川瀨 花子" });
    const b = await c.post("/patients", { name: "冨沢 太郎" });
    await c.post("/patients", { name: "髙橋 一郎" });
    const t = await c.post("/patients", { name: "高橋 一郎" });
    const send = await device(c);
    const r1 = await send({ patientName: "川瀬 花子", fileName: "1_1_F_NL_川瀬 花子.jpg", ref: "", bytes: jpeg(3) });
    expect(await filesOf(c, a.id)).toEqual([r1.id]);
    const r2 = await send({ patientName: "富沢 太郎", fileName: "2_1_F_NL_富沢 太郎.jpg", ref: "", bytes: jpeg(4) });
    expect(await filesOf(c, b.id)).toEqual([r2.id]);
    // 同じ字の人がいればその人（髙橋と高橋が両方いても、字が同じ方へ）
    const r3 = await send({ patientName: "高橋 一郎", fileName: "3_1_F_NL_高橋 一郎.jpg", ref: "", bytes: jpeg(5) });
    expect(r3.status).toBe("saved");
    expect(await filesOf(c, t.id)).toEqual([r3.id]);
  });

  it("名前だけ合って番号が合わないときは照合待ちのまま", async () => {
    const c = await h.srv.as("staff-admin");
    await c.post("/patients", { name: "写真 はなこ", chartNo: "1" });
    await c.post("/patients", { name: "写真 はなこ", chartNo: "2" });
    const send = await device(c);
    const r = await send({ patientName: "写真 はなこ", fileName: "x.jpg", ref: "999", bytes: jpeg(3) });
    expect(r.status).toBe("inbox");
    expect((await c.get("/photo-inbox")).items.map((x: { id: string }) => x.id)).toContain(r.id);
  });

  it("鍵がなければ受け付けない", async () => {
    const r = await h.srv.client().raw("POST", "/api/v1/integration/photos?name=x&file=x.jpg", jpeg(1), { Authorization: "Bearer nv_wrong" });
    expect(r.status).toBe(401);
  });
});
