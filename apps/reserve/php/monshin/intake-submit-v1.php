<?php
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';
require __DIR__ . '/intake-common.php';

const ISHIDA_INTAKE_CHANNEL_ID = '2011370154';
const ISHIDA_INTAKE_PRIVACY_POLICY_URL = 'https://ishidahihuka.jp/privacy-policy/';
const ISHIDA_INTAKE_PRIVACY_CONSENT_VERSION = '2026-10-11';

function intake_response(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function intake_config(): array
{
    // LANE RESERVE の config.php の 'intake' から読む（公開フォルダに設定ファイルを置かない）
    return intake_common_config();
}

function intake_verify_id_token(string $idToken): array
{
    if ($idToken === '') throw new RuntimeException('ID token is missing');
    // 開発用の php -S（line_test_mode）だけ：LINE に問い合わせずに試す
    if (LineLink::testMode() && preg_match('/^test:(U[0-9a-f]{32})$/', $idToken, $m)) return ['sub' => $m[1], 'aud' => 'test'];
    $channel = intake_common_config()['channel_id'] ?: ISHIDA_INTAKE_CHANNEL_ID;
    $payload = http_build_query(['id_token' => $idToken, 'client_id' => $channel], '', '&', PHP_QUERY_RFC3986);
    $context = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/x-www-form-urlencoded\r\nContent-Length: " . strlen($payload) . "\r\n",
        'content' => $payload,
        'timeout' => 8,
        'ignore_errors' => true,
    ]]);
    $raw = file_get_contents('https://api.line.me/oauth2/v2.1/verify', false, $context);
    $statusLine = is_array($http_response_header ?? null) ? (string)($http_response_header[0] ?? '') : '';
    if (!is_string($raw) || preg_match('/\s200\s/', $statusLine) !== 1) throw new RuntimeException('LINE ID token verification failed: ' . $statusLine);
    $claims = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($claims) || !hash_equals($channel, (string)($claims['aud'] ?? '')) || !is_string($claims['sub'] ?? null) || $claims['sub'] === '') {
        throw new RuntimeException('LINE ID token claims are invalid');
    }
    return $claims;
}

function intake_base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function intake_followup_token(array $config, string $requestId, string $userId): string
{
    $now = time();
    $body = intake_base64url(json_encode(['r' => $requestId, 'u' => $userId, 'iat' => $now, 'exp' => $now + 7776000], JSON_THROW_ON_ERROR));
    return $body . '.' . intake_base64url(hash_hmac('sha256', $body, (string)$config['pull_token'], true));
}

function intake_store(array $config, array $record): void
{
    // 予約カレンダーの DB（暗号化）に保存する。ファイルには残さない
    Store::init();
    Intake::store($record);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') intake_response(405, ['ok' => false, 'error' => 'method_not_allowed']);

try {
    $body = json_decode((string)file_get_contents('php://input'), true, 32, JSON_THROW_ON_ERROR);
    $message = trim((string)($body['message'] ?? ''));
    $form = is_array($body['form'] ?? null) ? $body['form'] : [];
    if ($message === '' || mb_strlen($message) > 5000 || !in_array((string)($form['visitType'] ?? ''), ['initial', 'returning'], true)) {
        intake_response(422, ['ok' => false, 'error' => 'invalid_intake']);
    }
    if ((string)($form['privacyConsent'] ?? '') !== 'agreed') {
        intake_response(422, ['ok' => false, 'error' => 'privacy_consent_required']);
    }
    $claims = intake_verify_id_token((string)($body['idToken'] ?? ''));
    $config = intake_config();
    $requestId = 'R' . gmdate('YmdHis') . strtoupper(bin2hex(random_bytes(4)));
    $record = [
        'eventId' => 'intake_' . $requestId,
        'type' => 'reservation_intake',
        'receivedAt' => gmdate('c'),
        'requestId' => $requestId,
        'source' => ['type' => 'user', 'userId' => (string)$claims['sub']],
        'message' => ['type' => 'text', 'text' => $message],
        'intake' => $form,
        'privacyConsent' => [
            'version' => ISHIDA_INTAKE_PRIVACY_CONSENT_VERSION,
            'policyUrl' => ISHIDA_INTAKE_PRIVACY_POLICY_URL,
            'agreedAt' => gmdate('c'),
            'method' => 'required_checkbox_before_form_entry',
        ],
        'status' => 'submitted',
    ];
    intake_store($config, $record);
    intake_response(201, ['ok' => true, 'requestId' => $requestId, 'followupToken' => intake_followup_token($config, $requestId, (string)$claims['sub'])]);
} catch (JsonException $error) {
    error_log('intake-submit-v1 JSON: ' . $error->getMessage());
    intake_response(400, ['ok' => false, 'error' => 'invalid_json']);
} catch (Throwable $error) {
    error_log('intake-submit-v1: ' . get_class($error) . ': ' . $error->getMessage() . ' at ' . $error->getFile() . ':' . $error->getLine());
    intake_response(500, ['ok' => false, 'error' => 'server_error']);
}
