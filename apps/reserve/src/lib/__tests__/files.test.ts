import { describe, expect, it } from "vitest";
import { nowInClinic } from "@/lib/domain/time";
import { withPhp } from "./php/server";

const h = withPhp();

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

describe("患者のファイル", () => {
  it("写真・PDFを日付ごとに保存し、施術歴の行に出る。中身は暗号化して保存し、そのまま読み出せる", async () => {
    const c = await h.srv.as("staff-admin");
    const today = nowInClinic().date;
    const p = await c.post("/patients", { name: "ファイル テスト" });
    const by = { id: "staff-admin", name: "院長" };
    const img = await c.upload(p.id, { date: today, name: "同意書.jpg", bytes: JPEG });
    expect(img).toMatchObject({ kind: "image", type: "image/jpeg", name: "同意書.jpg", size: JPEG.length, createdBy: by });
    const pdf = await c.upload(p.id, { date: today, name: "../../etc/passwd.pdf", bytes: PDF });
    expect(pdf.kind).toBe("pdf");
    expect(pdf.name).not.toContain("/");

    const row = (await c.get(`/patients/${p.id}`)).visits.find((v: { date: string }) => v.date === today);
    expect(row.files.map((f: { id: string }) => f.id)).toEqual([img.id, pdf.id]);
    const got = await c.raw("GET", `/api/v1/files/${img.id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(got.bytes)).toEqual(Buffer.from(JPEG));
    expect((await c.get(`/patients/${p.id}/files?date=${today}`)).items).toHaveLength(2);
    // 保存した中身は暗号化されている（JPEG・PDF の目印がそのまま入っていない）
    const raw = h.srv.rawData();
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.includes(Buffer.from(JPEG))).toBe(false);
    expect(raw.includes(Buffer.from("%PDF-1.4"))).toBe(false);

    await c.post(`/files/${img.id}/delete`);
    expect((await c.get(`/patients/${p.id}/files`)).items).toHaveLength(1);
    await expect(c.get(`/files/${img.id}`)).rejects.toThrow(/見つかりません/);
  });

  it("中身が写真・PDF・Wordでないもの、空、大きすぎるものは断る（拡張子だけでは信じない）", async () => {
    const c = await h.srv.as("staff-admin");
    const p = await c.post("/patients", { name: "ファイル テスト2" });
    const date = nowInClinic().date;
    await expect(c.upload(p.id, { date, name: "a.jpg", bytes: new TextEncoder().encode("<script>alert(1)</script>") })).rejects.toThrow(/追加できるのは/);
    await expect(c.upload(p.id, { date, name: "a.jpg", bytes: new Uint8Array() })).rejects.toThrow(/空/);
    const max = await h.srv.php<number>("return Store::MAX_FILE_BYTES;");
    const big = new Uint8Array(max + 1);
    big.set(JPEG);
    await expect(c.upload(p.id, { date, name: "a.jpg", bytes: big })).rejects.toThrow(/大きすぎ/);
    // 日付の形が正しくなければ断る
    await expect(c.upload(p.id, { date: "2026-13-40", name: "a.jpg", bytes: JPEG })).rejects.toThrow(/400 invalid/);
  });
});
