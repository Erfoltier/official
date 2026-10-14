<?php
/** 予約申請フォームが最初に読む設定（LIFF ID と特別診療日）。秘密の値は返さない */
declare(strict_types=1);

require __DIR__ . '/intake-common.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    $c = intake_common_config();
    echo json_encode(['ok' => true, 'liffId' => $c['liff_id'], 'specialDates' => $c['special_dates']], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    http_response_code(503);
    echo '{"ok":false}';
}
