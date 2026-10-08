import { beforeEach, describe, expect, it } from "vitest";

async function store() {
  resetStores();
  return import("@/lib/server/store");
}

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, n, 0xff, 0xd9]);

describe("機器の写真を患者へ振り分ける", () => {
  beforeEach(() => {
    resetStores();
  });

  it("同姓同名でも、顧客番号がカルテ番号（またはM3番号）と合う人が1人ならその人へ", async () => {
    const s = await store();
    const a = s.createPatient({ name: "写真 はなこ", chartNo: "00123" });
    const b = s.createPatient({ name: "写真 はなこ", chartNo: "456", m3ChartNo: "789" });
    const { link } = s.createDeviceLink({ source: "neovoir" }, { id: "t", name: "テスト" });
    const r1 = s.receiveDevicePhoto(link, { patientName: "写真 はなこ", fileName: "123_1_F_NL_写真 はなこ.jpg", ref: "123", bytes: jpeg(1) });
    expect(r1.status).toBe("saved");
    expect(s.getFile(r1.id).meta.patientId).toBe(a.id);
    const r2 = s.receiveDevicePhoto(link, { patientName: "写真 はなこ", fileName: "789_1_F_NL_写真 はなこ.jpg", ref: "789", bytes: jpeg(2) });
    expect(s.getFile(r2.id).meta.patientId).toBe(b.id);
  });

  it("旧字体・異体字で登録された氏名でも、1人に決まればその人へ（川瀨／川瀬、冨沢／富沢）", async () => {
    const s = await store();
    const a = s.createPatient({ name: "川瀨 花子" });
    const b = s.createPatient({ name: "冨沢 太郎" });
    s.createPatient({ name: "髙橋 一郎" });
    s.createPatient({ name: "高橋 一郎" });
    const { link } = s.createDeviceLink({ source: "neovoir" }, { id: "t", name: "テスト" });
    const r1 = s.receiveDevicePhoto(link, { patientName: "川瀬 花子", fileName: "1_1_F_NL_川瀬 花子.jpg", ref: "", bytes: jpeg(3) });
    expect(s.getFile(r1.id).meta.patientId).toBe(a.id);
    const r2 = s.receiveDevicePhoto(link, { patientName: "富沢 太郎", fileName: "2_1_F_NL_富沢 太郎.jpg", ref: "", bytes: jpeg(4) });
    expect(s.getFile(r2.id).meta.patientId).toBe(b.id);
    // 同じ字の人がいればその人（髙橋と高橋が両方いても、字が同じ方へ）
    const r3 = s.receiveDevicePhoto(link, { patientName: "高橋 一郎", fileName: "3_1_F_NL_高橋 一郎.jpg", ref: "", bytes: jpeg(5) });
    expect(r3.status).toBe("saved");
  });

  it("名前だけ合って番号が合わないときは照合待ちのまま", async () => {
    const s = await store();
    s.createPatient({ name: "写真 はなこ", chartNo: "1" });
    s.createPatient({ name: "写真 はなこ", chartNo: "2" });
    const { link } = s.createDeviceLink({ source: "neovoir" }, { id: "t", name: "テスト" });
    const r = s.receiveDevicePhoto(link, { patientName: "写真 はなこ", fileName: "x.jpg", ref: "999", bytes: jpeg(3) });
    expect(r.status).toBe("inbox");
  });
});
