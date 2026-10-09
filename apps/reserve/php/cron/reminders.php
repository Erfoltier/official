<?php
declare(strict_types=1);

/**
 * Airリザーブの取り込みとリマインドの送信（ロリポップの cron から呼ぶ。院のパソコンが止まっていても送れるように）。
 * ロリポップの cron は CGI 版の PHP で動くため、「ウェブからの通信でないこと」で見分ける。
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
echo json_encode(['air' => $air === null ? null : array_intersect_key($air, array_flip(['ok', 'date', 'count', 'created', 'updated', 'cancelled'])), 'reminders' => Reminder::tick(true)], JSON_UNESCAPED_UNICODE), "\n";
