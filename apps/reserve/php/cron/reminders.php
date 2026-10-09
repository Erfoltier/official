<?php
declare(strict_types=1);

/**
 * リマインドを送る（ロリポップの cron から呼ぶ。院のパソコンが止まっていても送れるように）。
 * ロリポップの cron は CGI 版の PHP で動くため、「ウェブからの通信でないこと」で見分ける。
 * このフォルダはウェブから開けない（.htaccess）。
 */
if (isset($_SERVER['REQUEST_METHOD']) || isset($_SERVER['HTTP_HOST'])) {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';
Store::clinic();
echo json_encode(Reminder::tick(true), JSON_UNESCAPED_UNICODE), "\n";
