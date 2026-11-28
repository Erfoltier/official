<?php
/**
 * AWS Backup の毎日の控え（東京 ishida-vault・大阪 ishida-vault-osaka）の状況を、設定 → バックアップ に出すために読む。
 * サーバー（EC2）の役割の一時的な鍵で、読むだけ（backup:ListRecoveryPointsByBackupVault）。SDK を使わず SigV4 で署名する。
 * 結果は1時間とっておく。AWS の外（開発・テスト）や読めないときは null。
 */
declare(strict_types=1);

final class AwsBackupStatus
{
    public const VAULTS = [
        ['region' => 'ap-northeast-1', 'vault' => 'ishida-vault', 'label' => '東京'],
        ['region' => 'ap-northeast-3', 'vault' => 'ishida-vault-osaka', 'label' => '大阪'],
    ];

    /** [['label' => '東京', 'count' => 30, 'latest' => ISO, 'latestStatus' => 'COMPLETED', 'oldest' => ISO], …]、読めなければ null */
    public static function get(bool $refresh = false): ?array
    {
        $cached = Db::i()->meta('awsBackupStatus');
        if (!$refresh && is_array($cached) && (time() - (int) ($cached['at'] ?? 0)) < 3600) {
            return $cached['vaults'];
        }
        $creds = self::credentials();
        if ($creds === null) {
            return null;
        }
        $out = [];
        foreach (self::VAULTS as $v) {
            $points = [];
            $token = null;
            do {
                $q = 'maxResults=100' . ($token ? '&nextToken=' . rawurlencode($token) : '');
                $r = self::call($creds, $v['region'], '/backup-vaults/' . $v['vault'] . '/recovery-points/', $q);
                if ($r === null) {
                    $points = null;
                    break;
                }
                array_push($points, ...($r['RecoveryPoints'] ?? []));
                $token = $r['NextToken'] ?? null;
            } while ($token);
            if ($points === null) {
                $out[] = ['label' => $v['label'], 'error' => true];
                continue;
            }
            $ec2 = array_values(array_filter($points, fn($p) => ($p['ResourceType'] ?? '') === 'EC2'));
            usort($ec2, fn($a, $b) => ($a['CreationDate'] ?? 0) <=> ($b['CreationDate'] ?? 0));
            $done = array_values(array_filter($ec2, fn($p) => ($p['Status'] ?? '') === 'COMPLETED'));
            $iso = fn($t) => $t ? date('c', (int) $t) : null;
            $last = end($ec2) ?: null;
            $out[] = [
                'label' => $v['label'],
                'count' => count($done),
                'latest' => $iso($last['CreationDate'] ?? null),
                'latestStatus' => $last['Status'] ?? null,
                'oldest' => $iso($done[0]['CreationDate'] ?? null),
            ];
        }
        Db::i()->setMeta('awsBackupStatus', ['at' => time(), 'vaults' => $out]);
        return $out;
    }

    /** EC2 の役割の一時的な鍵（IMDSv2） */
    private static function credentials(): ?array
    {
        $ctx = fn(string $method, array $h) => stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $h), 'timeout' => 2, 'ignore_errors' => true]]);
        $tok = @file_get_contents('http://169.254.169.254/latest/api/token', false, $ctx('PUT', ['X-aws-ec2-metadata-token-ttl-seconds: 300']));
        if (!$tok) {
            return null;
        }
        $h = ["X-aws-ec2-metadata-token: {$tok}"];
        $role = trim((string) @file_get_contents('http://169.254.169.254/latest/meta-data/iam/security-credentials/', false, $ctx('GET', $h)));
        if ($role === '' || !preg_match('/^[\w+=,.@-]+$/', $role)) {
            return null;
        }
        $c = json_decode((string) @file_get_contents("http://169.254.169.254/latest/meta-data/iam/security-credentials/{$role}", false, $ctx('GET', $h)), true);
        return is_array($c) && !empty($c['AccessKeyId']) ? $c : null;
    }

    /** SigV4 で署名して GET（AWS Backup の REST API） */
    private static function call(array $c, string $region, string $path, string $query): ?array
    {
        $host = "backup.{$region}.amazonaws.com";
        $now = gmdate('Ymd\THis\Z');
        $day = substr($now, 0, 8);
        parse_str($query, $qs);
        ksort($qs);
        $cq = implode('&', array_map(fn($k, $v) => rawurlencode((string) $k) . '=' . rawurlencode((string) $v), array_keys($qs), $qs));
        $cpath = implode('/', array_map('rawurlencode', explode('/', $path)));
        $headers = ['host' => $host, 'x-amz-date' => $now, 'x-amz-security-token' => $c['Token']];
        ksort($headers);
        $ch = implode('', array_map(fn($k, $v) => "{$k}:{$v}\n", array_keys($headers), $headers));
        $sh = implode(';', array_keys($headers));
        $creq = "GET\n{$cpath}\n{$cq}\n{$ch}\n{$sh}\n" . hash('sha256', '');
        $scope = "{$day}/{$region}/backup/aws4_request";
        $sts = "AWS4-HMAC-SHA256\n{$now}\n{$scope}\n" . hash('sha256', $creq);
        $k = hash_hmac('sha256', 'aws4_request', hash_hmac('sha256', 'backup', hash_hmac('sha256', $region, hash_hmac('sha256', $day, 'AWS4' . $c['SecretAccessKey'], true), true), true), true);
        $sig = hash_hmac('sha256', $sts, $k);
        $auth = "AWS4-HMAC-SHA256 Credential={$c['AccessKeyId']}/{$scope}, SignedHeaders={$sh}, Signature={$sig}";
        $ctx = stream_context_create(['http' => [
            'method' => 'GET',
            'header' => "Authorization: {$auth}\r\nx-amz-date: {$now}\r\nx-amz-security-token: {$c['Token']}\r\n",
            'timeout' => 10,
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents("https://{$host}{$cpath}?{$cq}", false, $ctx);
        $status = (int) (preg_match('#^HTTP/\S+ (\d+)#', $http_response_header[0] ?? '', $m) ? $m[1] : 0);
        return $status === 200 ? json_decode((string) $body, true) : null;
    }
}
