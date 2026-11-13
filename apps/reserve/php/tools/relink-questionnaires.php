<?php
declare(strict_types=1);

/**
 * 未確認の問診票を、今の患者の情報でまとめて照合し直す（設定 → 問診票 の「未確認の問診票をまとめて照合」と同じ）。
 * コマンドラインだけで使う。実行前に DB の控えを取ること。
 *   RESERVE_CONFIG=…/config.php php php/tools/relink-questionnaires.php
 * 出すのは件数だけ（患者の中身は出さない）
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';

$r = Store::relinkUnmatchedQuestionnaires(null, ['id' => 'system', 'name' => '一括照合（サーバー）']);
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
