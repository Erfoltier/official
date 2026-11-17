import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

// 他院でも使えるよう、患者向けの表示（院名・診療科・受付日・プライバシーポリシー）は設定から読む
const h = withPhp({ each: true });

describe("患者向けの表示の設定", () => {
  it("保存した院名・診療科・受付曜日・特別診療日が、予約申請フォームの設定と問診票の見出しに出る", async () => {
    const c = await h.srv.as("staff-admin");
    const saved = await c.patch("/clinic", {
      publicName: "テスト皮フ科／美容皮膚科",
      publicNameEn: "Test Dermatology",
      department: "美容皮膚科",
      privacyUrl: "https://example.com/privacy",
      intakeHours: "水曜日\n10:00〜18:30",
      intakeWeekdays: [3, 3],
      intakeSpecialDates: ["2026-11-03"],
    });
    expect(saved.intakeWeekdays).toEqual([3]);
    const page = await fetch(`${h.srv.base}/monshin/`).then((r) => r.text());
    expect(page).toContain("テスト皮フ科／美容皮膚科");
    expect(page).toContain("Test Dermatology");
    expect(await h.srv.php(`return Store::publicInfo()['intakeSpecialDates'];`)).toEqual(["2026-11-03"]);
  });

  it("https 以外のアドレスは断る", async () => {
    const c = await h.srv.as("staff-admin");
    await expect(c.patch("/clinic", { privacyUrl: "http://example.com" })).rejects.toThrow();
  });
});
