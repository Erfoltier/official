import { describe, expect, it } from "vitest";
import { withPhp } from "./php/server";

// 診療日（水曜・祝日）の朝、その日の予約表をパスワード付き PDF で院長に送る（止まったときの紙の控え）
const h = withPhp({ each: true });

describe("診療日の予約表 PDF", () => {
  it("送る日は水曜・祝日（と特別診療日）だけ", async () => {
    const r = await h.srv.php(`return [DayPdfSender::isTarget('2026-11-04'), DayPdfSender::isTarget('2026-11-03'), DayPdfSender::isTarget('2026-11-05'), DayPdfSender::isTarget('2026-11-02')];`);
    expect(r).toEqual([true, true, false, false]); // 11/4 水・11/3 文化の日・11/5 木・11/2 月
  });

  it("設定：送り先とパスワードがないと有効にできない。パスワードは画面に返さない", async () => {
    const c = await h.srv.as("staff-admin");
    await expect(c.put("/admin/day-pdf", { enabled: true })).rejects.toThrow(/送り先とパスワード/);
    await expect(c.put("/admin/day-pdf", { to: "bad" })).rejects.toThrow(/メールアドレス/);
    const v = await c.put("/admin/day-pdf", { enabled: true, to: "doctor@example.jp", password: "pdfpass-1234" });
    expect(v.enabled).toBe(true);
    expect(v.passwordSet).toBe(true);
    expect(JSON.stringify(v)).not.toContain("pdfpass-1234");
  });

  it("PDF はパスワード付きで、パスワードなしでは開けない。朝7〜10時に1日1回だけ送る", async () => {
    const out = await h.srv.php(`
      Db::i()->setMeta('dayPdf', [...DayPdfSender::defaults(), 'enabled' => true, 'to' => 'doctor@example.jp', 'password' => 'pdfpass-1234']);
      $sent = [];
      Reminder::$transport = function ($m, $to) use (&$sent) { $sent[] = $to; return [200, '']; };
      $pdf = DayPdfSender::encrypt(DayPdf::build(Store::getDayBundle('2026-11-04'), 'テスト'), 'pdfpass-1234');
      $plain = DayPdf::build(Store::getDayBundle('2026-11-04'), 'テスト');
      $tz = new DateTimeZone('Asia/Tokyo');
      $early = DayPdfSender::tick(new DateTimeImmutable('2026-11-04 06:50', $tz));
      $first = DayPdfSender::tick(new DateTimeImmutable('2026-11-04 07:00', $tz));
      $again = DayPdfSender::tick(new DateTimeImmutable('2026-11-04 07:10', $tz));
      $thu = DayPdfSender::tick(new DateTimeImmutable('2026-11-05 07:00', $tz));
      return ['pdf' => str_starts_with($plain, '%PDF-'), 'encrypted' => str_contains($pdf, '/Encrypt'), 'early' => $early, 'first' => $first['sent'] ?? null, 'again' => $again, 'thu' => $thu['reason'] ?? null, 'sent' => $sent];
    `);
    expect(out).toMatchObject({ pdf: true, encrypted: true, early: null, first: true, again: null, thu: "not_target", sent: ["doctor@example.jp"] });
  });
});
