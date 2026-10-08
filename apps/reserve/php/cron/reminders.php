<?php
declare(strict_types=1);

/**
 * リマインドを送る（ロリポップの cron などから5〜10分おきに呼ぶ）。
 * 通信のついでにも送っているが、院のパソコンが止まっている朝なども確実に送るため。ブラウザからは開けない
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';
Store::clinic();
echo json_encode(Reminder::tick(true), JSON_UNESCAPED_UNICODE), "\n";
