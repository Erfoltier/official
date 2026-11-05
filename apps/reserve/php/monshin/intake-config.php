<?php
/** 予約申請フォームが最初に読む設定（LIFF ID・院の表示・受け付ける曜日と特別診療日）。秘密の値は返さない */
declare(strict_types=1);

require __DIR__ . '/intake-common.php';
require __DIR__ . '/../lib/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
try {
    $c = intake_common_config();
    $p = Store::publicInfo();
    echo json_encode([
        'ok' => true,
        'liffId' => $c['liff_id'],
        // 特別診療日は設定画面のものと、設定ファイル（以前の置き場所）のものを合わせる
        'specialDates' => array_values(array_unique([...$p['intakeSpecialDates'], ...$c['special_dates']])),
        'weekdays' => $p['intakeWeekdays'],
        'clinic' => ['name' => $p['name'], 'publicName' => $p['publicName'], 'publicNameEn' => $p['publicNameEn'], 'department' => $p['department'], 'privacyUrl' => $p['privacyUrl'], 'intakeHours' => $p['intakeHours']],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(503);
    echo '{"ok":false}';
}
