<?php
/**
 * 二要素認証（スマホの認証アプリの6桁の数字。TOTP：RFC 6238、30秒・SHA-1・6桁）。
 * PIN（知っていること）に、認証アプリの入ったスマホ（持っているもの）を足す。
 * - 院長・管理者が「二要素認証を必須にする」をオンにすると、まだ登録していないスタッフは次のログインで登録する
 * - ログインは2段階：PIN が合えば「確認券」（5分・5回まで）を返し、6桁の数字が合えばログイン
 * - 鍵はスタッフの記録（DB で暗号化）に入れる。同じ数字は2度使えない
 */
declare(strict_types=1);

final class TwoFactor
{
    private const TICKET_MS = 300_000;
    private const MAX_TRIES = 5;

    public static function required(): bool
    {
        $s = Db::i()->meta('security');
        return is_array($s) && !empty($s['require2fa']);
    }

    public static function setRequired(bool $on, array $actor): array
    {
        $cur = Db::i()->meta('security');
        Db::i()->setMeta('security', [...(is_array($cur) ? $cur : []), 'require2fa' => $on]);
        Auth::audit($actor, $on ? '二要素認証を必須にした' : '二要素認証の必須をやめた');
        return ['require2fa' => $on];
    }

    // ---- TOTP ----

    private const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function newSecret(): string
    {
        $bytes = random_bytes(20);
        $bits = '';
        foreach (str_split($bytes) as $c) {
            $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::B32[bindec(str_pad($chunk, 5, '0'))];
        }
        return $out;
    }

    private static function b32decode(string $s): string
    {
        $bits = '';
        foreach (str_split(strtoupper($s)) as $c) {
            $i = strpos(self::B32, $c);
            if ($i === false) {
                continue;
            }
            $bits .= str_pad(decbin($i), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }
        return $out;
    }

    public static function code(string $secret, int $step): string
    {
        $h = hash_hmac('sha1', pack('J', $step), self::b32decode($secret), true);
        $o = ord($h[19]) & 0x0f;
        $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
        return str_pad((string) ($n % 1_000_000), 6, '0', STR_PAD_LEFT);
    }

    /** 合っていれば、その数字の時間の番号を返す（前後30秒のずれまで許す）。$after 以下の番号は使用済みとして断る */
    public static function verify(string $secret, string $code, int $after = 0, ?int $now = null): ?int
    {
        $code = preg_replace('/\D/', '', $code) ?? '';
        if (strlen($code) !== 6) {
            return null;
        }
        $step = intdiv($now ?? time(), 30);
        foreach ([$step, $step - 1, $step + 1] as $s) {
            if ($s > $after && hash_equals(self::code($secret, $s), $code)) {
                return $s;
            }
        }
        return null;
    }

    public static function otpauthUrl(string $secret, string $staffName): string
    {
        $issuer = 'LANE RESERVE';
        $clinic = (string) (Store::clinic()['name'] ?? '');
        $label = rawurlencode($issuer . ':' . ($clinic !== '' ? $clinic . ' ' : '') . $staffName);
        return "otpauth://totp/{$label}?secret={$secret}&issuer=" . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30';
    }

    // ---- ログインの2段階目 ----

    private static function sign(string $body): string
    {
        return b64url(hash_hmac('sha256', 'login-2fa:' . $body, (string) config()['session_secret'], true));
    }

    /** PIN が合ったあとに渡す確認券 */
    public static function ticket(string $staffId, int $sessionVersion, ?int $now = null): string
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $body = b64url(json_encode(['s' => $staffId, 'v' => $sessionVersion, 'exp' => $now + self::TICKET_MS, 'n' => bin2hex(random_bytes(12))]));
        return $body . '.' . self::sign($body);
    }

    /** @return array{0: array, 1: string} [確認券の中身, 券の番号] */
    public static function readTicket(string $ticket, ?int $now = null): array
    {
        $now ??= (int) floor(microtime(true) * 1000);
        [$body, $sig] = array_pad(explode('.', $ticket, 2), 2, '');
        $data = $body !== '' && hash_equals(self::sign($body), $sig) ? json_decode((string) b64url_decode($body), true) : null;
        if (!is_array($data) || ($data['exp'] ?? 0) < $now) {
            throw new AuthError('invalid', '時間がたちました。もう一度PINからやり直してください');
        }
        return [$data, (string) $data['n']];
    }

    /** 確認券ごとの失敗の回数。5回で使えなくする */
    public static function noteFailure(string $nonce): void
    {
        $rec = Db::i()->get('loginTicket', $nonce) ?? ['fails' => 0];
        Db::i()->put('loginTicket', $nonce, ['fails' => $rec['fails'] + 1, 'at' => now_iso()]);
    }

    public static function checkTries(string $nonce): void
    {
        $rec = Db::i()->get('loginTicket', $nonce);
        if (is_array($rec) && $rec['fails'] >= self::MAX_TRIES) {
            throw new AuthError('locked', '確認の数字を続けて間違えました。もう一度PINからやり直してください');
        }
    }
}
