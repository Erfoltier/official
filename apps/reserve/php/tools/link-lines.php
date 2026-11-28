<?php
declare(strict_types=1);

/**
 * 予約申請から LINE が特定できる患者に、LINE をまとめて紐付ける（リマインドの各回の前にも自動で行う）。コマンドラインだけで使う。
 *   RESERVE_CONFIG=…/config.php php php/tools/link-lines.php
 * 出すのは件数だけ（患者の中身は出さない）
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';

echo json_encode(Store::autoLinkLines(['id' => 'system', 'name' => '予約申請からLINEを紐付け（サーバー）']), JSON_UNESCAPED_UNICODE), "\n";
