<?php
declare(strict_types=1);

/**
 * リマインドの送信（Airリザーブの取り込みは 2026-10-22 に終了。終了後は何もしない）。
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
// 先に Airリザーブの翌日分を取り込む（毎朝1回。前日18時のリマインドに間に合わせる）。件数だけを出す
try {
    $air = AirSync::tick();
} catch (Throwable $e) {
    $air = ['ok' => false];
}
// 診療日（水曜・祝日）の朝、その日の予約表をパスワード付き PDF で院長に送る（止まったときの紙の控え）
try {
    $pdf = DayPdfSender::tick();
} catch (Throwable $e) {
    $pdf = ['sent' => false, 'reason' => get_class($e)];
}
echo json_encode(['dayPdf' => $pdf, 'air' => $air === null ? null : array_intersect_key($air, array_flip(['ok', 'date', 'count', 'created', 'updated', 'cancelled'])), 'reminders' => Reminder::tick(true)], JSON_UNESCAPED_UNICODE), "\n";
