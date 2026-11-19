<?php
/** 日曜の Web 予約（タトゥー・アートメイク除去と、院が許可した日曜メニュー）の受け口。GET：選べる時刻（area・visit、または item・visit）、POST：予約 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header_remove('X-Powered-By');

$out = function (int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
};
try {
    Store::init();
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'GET') {
        $area = is_numeric($_GET['area'] ?? null) ? (float) $_GET['area'] : 0.0;
        $first = ($_GET['visit'] ?? '') === 'first';
        // 日曜メニュー（タトゥー以外）：item で選んだメニューの空き
        $itemId = (string) ($_GET['item'] ?? '');
        if ($itemId !== '') {
            $it = TattooBooking::item($itemId);
            // 部位ごと：group（何番目の区分）・parts（何番目の部位をカンマ区切り）、本数：count
            $pick = ['group' => $_GET['group'] ?? null, 'parts' => array_filter(explode(',', (string) ($_GET['parts'] ?? '')), 'is_numeric'), 'count' => $_GET['count'] ?? null];
            $plan = $it ? TattooBooking::planItem($it, $first, null, $pick) : [];
            $out(200, ['ok' => true, 'open' => TattooBooking::open(), 'slots' => (object) array_map(fn($l) => array_map(fn($c) => $c[0], $l), $plan), 'duration' => $it && TattooBooking::accepts($it, $first) ? TattooBooking::itemDurationText($it, $first, $pick) : '', 'today' => now_in_clinic()['date']]);
        }
        $open = TattooBooking::ready();
        if ($area <= 0 || $area > 20_000) {
            $out(200, ['ok' => true, 'open' => $open, 'slots' => (object) [], 'today' => now_in_clinic()['date']]);
        }
        $out(200, ['ok' => true, 'open' => $open, 'slots' => (object) TattooBooking::openTimes(TattooBooking::treatMinutes($area), $first), 'price' => TattooBooking::price($area), 'duration' => TattooBooking::durationText(TattooBooking::treatMinutes($area), $first), 'today' => now_in_clinic()['date']]);
    }
    if ($method !== 'POST') {
        $out(405, ['ok' => false, 'error' => 'method_not_allowed']);
    }
    // ほかのサイトのページから勝手に送らせない（埋め込みは iframe の中のこのページから送るので同じサイトになる）
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $self = 'https://' . ($_SERVER['HTTP_HOST'] ?? '');
    if ($origin !== '' && $origin !== $self && !LineLink::testMode()) {
        $out(403, ['ok' => false, 'error' => 'forbidden']);
    }
    $raw = (string) file_get_contents('php://input', false, null, 0, 20_000);
    $in = json_decode($raw, true, 8);
    if (!is_array($in)) {
        $out(400, ['ok' => false, 'error' => 'invalid_json']);
    }
    $r = TattooBooking::book($in, (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    $status = $r['ok'] ? 201 : match ($r['error']) {
        'invalid' => 422, 'slot_taken' => 409, 'rate_limited' => 429, 'closed' => 403, 'line_auth' => 401, default => 409,
    };
    $out($status, $r);
} catch (Throwable $e) {
    error_log('tattoo-booking: ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
    $out(500, ['ok' => false, 'error' => 'server_error']);
}
