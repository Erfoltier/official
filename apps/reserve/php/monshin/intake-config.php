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
        // 特別診療日は、設定画面に手で入れた日・ホームページから読んだ日・設定ファイル（以前の置き場所）の日を合わせる（祝日は自動では足さない）
        'specialDates' => array_values(array_unique([...HomepageDays::intakeDates(), ...$c['special_dates']])),
        'weekdays' => $p['intakeWeekdays'],
        'counseling' => $p['intakeCounseling'],
        // 日曜の予約ページへの案内（設定でオンのときだけアドレス。空なら出さない）
        'sundayLink' => TattooBooking::intakeLink(),
        // ご相談の記入から出す保険診療などの案内（言葉と文）
        'guard' => InsuranceGuard::forPage(),
        'clinic' => ['name' => $p['name'], 'publicName' => $p['publicName'], 'publicNameEn' => $p['publicNameEn'], 'department' => $p['department'], 'privacyUrl' => $p['privacyUrl'], 'intakeHours' => $p['intakeHours'], 'address' => $p['address']],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(503);
    echo '{"ok":false}';
}
