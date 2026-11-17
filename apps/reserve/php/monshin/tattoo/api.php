<?php
/** タトゥー・アートメイク除去（日曜）の Web 予約の受け口。GET：選べる時刻（area・visit で枠の長さを決める）、POST：予約 */
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
        $open = TattooBooking::ready();
        if ($area <= 0 || $area > 20_000) {
            $out(200, ['ok' => true, 'open' => $open, 'slots' => (object) [], 'today' => now_in_clinic()['date']]);
        }
        $out(200, ['ok' => true, 'open' => $open, 'slots' => (object) TattooBooking::openTimes(TattooBooking::treatMinutes($area), $first), 'price' => TattooBooking::price($area), 'today' => now_in_clinic()['date']]);
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
        'invalid' => 422, 'slot_taken' => 409, 'rate_limited' => 429, 'closed' => 403, default => 409,
    };
    $out($status, $r);
} catch (Throwable $e) {
    error_log('tattoo-booking: ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
    $out(500, ['ok' => false, 'error' => 'server_error']);
}
