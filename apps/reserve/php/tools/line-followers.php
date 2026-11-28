<?php
declare(strict_types=1);

/**
 * 公式アカウントの友だち全員を、手動の LINE 連携の候補（表示名で探せる）に入れる。コマンドラインだけで使う。
 *   RESERVE_CONFIG=…/config.php php php/tools/line-followers.php
 * 何度流しても同じ結果（表示名がまだない人だけ問い合わせる）。出すのは件数だけ
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';
Store::clinic();
echo json_encode(LineLink::importFollowers(), JSON_UNESCAPED_UNICODE), "\n";
