<?php
declare(strict_types=1);

require __DIR__ . '/intake-common.php';

function intake_status_response(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function intake_status_decode(string $value): string
{
    $padding = (4 - strlen($value) % 4) % 4;
    $decoded = base64_decode(strtr($value . str_repeat('=', $padding), '-_', '+/'), true);
    if (!is_string($decoded)) throw new RuntimeException('token encoding is invalid');
    return $decoded;
}

function intake_status_claims(array $config, string $token): array
{
    $parts = explode('.', $token, 2);
    if (count($parts) !== 2) throw new RuntimeException('token format is invalid');
    [$body, $signature] = $parts;
    $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $body, (string)$config['pull_token'], true)), '+/', '-_'), '=');
    if (!hash_equals($expected, $signature)) throw new RuntimeException('token signature is invalid');
    $claims = json_decode(intake_status_decode($body), true, 8, JSON_THROW_ON_ERROR);
    if (!is_array($claims) || preg_match('/^R[0-9A-Z]{20,40}$/', (string)($claims['r'] ?? '')) !== 1 || !is_string($claims['u'] ?? null) || (int)($claims['exp'] ?? 0) < time()) {
        throw new RuntimeException('token claims are invalid');
    }
    return $claims;
}

function intake_status_received(array $config, string $requestId, string $userId): bool
{
    $queueDir = rtrim((string)$config['queue_dir'], '/\\');
    $expected = '予約申請ID：' . $requestId;
    $minimumTime = time() - 1800;
    foreach (glob($queueDir . DIRECTORY_SEPARATOR . '*.json') ?: [] as $path) {
        if (str_starts_with(basename($path), 'intake_')) continue;
        $modified = @filemtime($path);
        if (!is_int($modified) || $modified < $minimumTime || @filesize($path) > 262144) continue;
        $raw = @file_get_contents($path);
        if (!is_string($raw) || !str_contains($raw, $expected)) continue;
        $event = json_decode($raw, true);
        if (is_array($event) && hash_equals($userId, (string)($event['source']['userId'] ?? ''))) return true;
    }
    return false;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') intake_status_response(405, ['ok' => false, 'error' => 'method_not_allowed']);

try {
    $config = intake_common_config();
    $body = json_decode((string)file_get_contents('php://input'), true, 8, JSON_THROW_ON_ERROR);
    $claims = intake_status_claims($config, (string)($body['token'] ?? ''));
    intake_status_response(200, ['ok' => true, 'requestId' => $claims['r'], 'lineMessageReceived' => intake_status_received($config, (string)$claims['r'], (string)$claims['u'])]);
} catch (JsonException $error) {
    error_log('intake-status-v1 JSON: ' . $error->getMessage());
    intake_status_response(400, ['ok' => false, 'error' => 'invalid_json']);
} catch (Throwable $error) {
    error_log('intake-status-v1: ' . get_class($error) . ': ' . $error->getMessage() . ' at ' . $error->getFile() . ':' . $error->getLine());
    intake_status_response(500, ['ok' => false, 'error' => 'server_error']);
}
