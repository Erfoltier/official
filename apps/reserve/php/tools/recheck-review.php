<?php
declare(strict_types=1);

/**
 * 「要確認の患者」のうち、名前・フリガナの似た患者がほかにいない人（ただの初診）の印をまとめて外す。コマンドラインだけで使う。
 *   RESERVE_CONFIG=…/config.php php php/tools/recheck-review.php [--dry-run]
 * 出すのは件数だけ（患者の中身は出さない）
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';

$r = Store::recheckReviewPatients(['id' => 'system', 'name' => '要確認の見直し（サーバー）'], in_array('--dry-run', $argv, true));
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
