<?php
declare(strict_types=1);

/**
 * リマインドの送信と、診療日の予約表 PDF の送信。
 * サーバーの systemd タイマー（reserve-reminders.timer）から呼ぶ。院のパソコンが止まっていても送れるように。
 * 「ウェブからの通信でないこと」で見分ける。
 * このフォルダはウェブから開けない（.htaccess）。
 */
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['HTTP_HOST'])) {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';
Store::clinic();
// cron が動いたことを残す（リマインドを止めていても、設定画面で cron の動きを確かめられるように）
Db::i()->setMeta('reminderCronSeen', now_iso());
// 診療日（水曜・祝日）の朝、その日の予約表をパスワード付き PDF で院長に送る（障害時の印刷用）
try {
    $pdf = DayPdfSender::tick();
} catch (Throwable $e) {
    $pdf = ['sent' => false, 'reason' => get_class($e)];
}
echo json_encode(['dayPdf' => $pdf, 'reminders' => Reminder::tick(true)], JSON_UNESCAPED_UNICODE), "\n";
