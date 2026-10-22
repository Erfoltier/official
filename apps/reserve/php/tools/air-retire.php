<?php
declare(strict_types=1);

/**
 * Airリザーブの利用を終える（設定 → リマインド →「Airリザーブの利用を終了」と同じ）。コマンドラインだけで使う。実行前に DB の控えを取ること。
 *   RESERVE_CONFIG=…/config.php php php/tools/air-retire.php [--force]
 * 出すのは件数と日時だけ（患者の中身は出さない）
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';

$r = AirSync::retire(['id' => 'system', 'name' => 'Air 終了（サーバー）'], in_array('--force', $argv, true));
unset($r['by']);
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
