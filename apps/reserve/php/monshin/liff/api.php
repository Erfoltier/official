<?php
/**
 * LINE の中で開く問診票の API。毎回、LIFF の ID トークンを LINE に確かめてもらい、その人の予約だけを扱う。
 *   POST {idToken, action: "context"}                         → 問診票を書く予約と質問
 *   POST {idToken, action: "submit", reservationId, answers}  → 送信
 */
declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$out = function (int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
};
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || Http::crossSiteWrite()) {
    $out(405, ['ok' => false]);
}
$in = json_decode((string) file_get_contents('php://input', false, null, 0, 200_000), true);
if (!is_array($in)) {
    $out(400, ['ok' => false, 'message' => '送信内容が正しくありません']);
}
try {
    Store::init();
    $sub = LineLink::verifyIdToken((string) ($in['idToken'] ?? ''));
    $action = (string) ($in['action'] ?? '');
    if ($action === 'context') {
        $out(200, ['ok' => true, ...LineLink::context($sub)]);
    }
    if ($action === 'submit') {
        $answers = is_array($in['answers'] ?? null) ? $in['answers'] : [];
        $errors = LineLink::submit($sub, (string) ($in['reservationId'] ?? ''), $answers);
        $out($errors ? 400 : 200, ['ok' => !$errors, 'errors' => (object) $errors]);
    }
    $out(400, ['ok' => false]);
} catch (StoreError $e) {
    $out(match ($e->codeName) { 'forbidden' => 403, 'not_found' => 404, 'locked' => 429, default => 400 }, ['ok' => false, 'message' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('liff api: ' . get_class($e));
    $out(500, ['ok' => false, 'message' => '送信できませんでした。時間をおいてもう一度お試しください']);
}
