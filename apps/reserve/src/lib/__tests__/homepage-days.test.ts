import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

// ホームページの「特別診療日」を1日1回読み、予約申請フォームで選べる日に足す（院長の指示 2026-11-13）
const h = withPhp({ each: true });

const HTML = `<html><body><section><h2>特別診療日</h2><p>JAN. 1月5日（火）・11日（月）</p><p>FEB. 2月11日（木）・23日（月）</p></section><section><p>12月24日 お知らせ</p></section></body></html>`;

describe("ホームページの特別診療日", () => {
  it("月の省略・年の繰り越し・曜日の確かめ", async () => {
    const r = await h.srv.php(`return HomepageDays::parse(${JSON.stringify(HTML)}, '2026-11-13');`);
    // 2/11 は 2027年では木曜、2/23 は火曜 → 曜日の合わない 2/23 は取り込まない
    expect(r.dates).toEqual(["2027-01-05", "2027-01-11", "2027-02-11"]);
    expect(r.skipped).toEqual(["2月23日（月）※実際は火曜日"]);
  });

  it("読んだ日はフォームの選べる日に足し、手で入れた日は消さない。読めないときは前回の日を使う", async () => {
    const out = await h.srv.php(`
      Store::updateClinic(['homepageUrl' => 'https://example.jp/', 'intakeSpecialDates' => ['2027-03-03']]);
      HomepageDays::$transport = fn($u) => [200, ${JSON.stringify(HTML)}];
      HomepageDays::tick(true);
      $a = HomepageDays::intakeDates();
      HomepageDays::$transport = fn($u) => [500, ''];
      $s = HomepageDays::tick(true);
      return ['a' => $a, 'b' => HomepageDays::intakeDates(), 'err' => $s['error'] ?? null, 'again' => HomepageDays::tick()];
    `);
    expect(out.a).toEqual(["2027-01-05", "2027-01-11", "2027-02-11", "2027-03-03"]);
    expect(out.b).toEqual(out.a);
    expect(out.err).toContain("500");
    // 同じ日に2回目は読まない
    expect(out.again).toBeNull();
    const c = await h.srv.as("staff-admin");
    const st = await c.get("/settings");
    expect(st.homepageDays.upcoming).toContain("2027-01-05");
  });
});
