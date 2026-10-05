import { beforeEach, describe, expect, it } from "vitest";
import { nowInClinic } from "@/lib/domain/time";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");

describe("患者のファイル", () => {
  beforeEach(() => {
    resetStores();
  });

  it("写真・PDFを日付ごとに保存し、施術歴の行に出る。中身は暗号化して保存し、そのまま読み出せる", async () => {
    const s = await store();
    const today = nowInClinic().date;
    const p = s.createPatient({ name: "ファイル テスト" });
    const by = { id: "staff-admin", name: "院長" };
    const img = s.saveFile(p.id, { date: today, name: "同意書.jpg", bytes: JPEG }, by);
    expect(img).toMatchObject({ kind: "image", type: "image/jpeg", name: "同意書.jpg", size: JPEG.length, createdBy: by });
    const pdf = s.saveFile(p.id, { date: today, name: "../../etc/passwd.pdf", bytes: PDF });
    expect(pdf.kind).toBe("pdf");
    expect(pdf.name).not.toContain("/");

    const row = s.getPatientDetail(p.id).visits.find((v) => v.date === today)!;
    expect(row.files.map((f) => f.id)).toEqual([img.id, pdf.id]);
    expect(Buffer.from(s.getFile(img.id).bytes)).toEqual(Buffer.from(JPEG));
    expect(s.listFiles(p.id, today)).toHaveLength(2);

    s.deleteFile(img.id, by);
    expect(s.listFiles(p.id)).toHaveLength(1);
    expect(() => s.getFile(img.id)).toThrow(/見つかりません/);
  });

  it("中身が写真・PDF・Wordでないもの、空、大きすぎるものは断る（拡張子だけでは信じない）", async () => {
    const s = await store();
    const p = s.createPatient({ name: "ファイル テスト2" });
    const d = nowInClinic().date;
    expect(() => s.saveFile(p.id, { date: d, name: "a.jpg", bytes: new TextEncoder().encode("<script>alert(1)</script>") })).toThrow(/追加できるのは/);
    expect(() => s.saveFile(p.id, { date: d, name: "a.jpg", bytes: new Uint8Array() })).toThrow(/空/);
    const big = new Uint8Array(s.MAX_FILE_BYTES + 1);
    big.set(JPEG);
    expect(() => s.saveFile(p.id, { date: d, name: "a.jpg", bytes: big })).toThrow(/大きすぎ/);
    expect(() => s.saveFile(p.id, { date: "2026-13-40", name: "a.jpg", bytes: JPEG })).toThrow(/日付/);
  });
});
