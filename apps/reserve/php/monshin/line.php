<?php
/**
 * LINE の Webhook の受け口（LINE Developers の Messaging API → Webhook URL に https://monshin.…/line.php を入れる）。
 * 署名を確かめ、予約申請（初診）や「問診票」という発言に、返信（無料）で問診票の入口を返す。発言の中身は保存しない
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo '{"ok":false}';
    exit;
}
$body = (string) file_get_contents('php://input', false, null, 0, 1_000_000);
try {
    Store::init();
    if (!LineLink::verifySignature($body, (string) ($_SERVER['HTTP_X_LINE_SIGNATURE'] ?? ''))) {
        http_response_code(401);
        echo '{"ok":false}';
        exit;
    }
    $payload = json_decode($body, true);
    $n = is_array($payload) ? LineLink::handleWebhook($payload) : 0;
    echo json_encode(['ok' => true, 'replied' => $n]);
} catch (Throwable $e) {
    // LINE には 200 を返す（返さないと同じ知らせが何度も届く）。理由だけ残し、発言の中身は残さない
    error_log('line webhook: ' . get_class($e));
    echo '{"ok":true}';
}
