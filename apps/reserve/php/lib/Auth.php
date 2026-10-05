<?php
declare(strict_types=1);

/**
 * スタッフとPINログイン・ログイン状態（Node.js 版 staff.ts / session.ts と同じ）。
 * - PINは PBKDF2-SHA256（210,000回）。5回続けて間違えると5分間ロック
 * - ログイン状態は署名付きCookie（中身はスタッフID・版・期限だけ。HMAC-SHA256で改ざん検出）
 */
final class Auth
{
    public const ROLES = ['admin', 'doctor', 'nurse', 'reception'];
    private const MAX_FAILS = 5;
    private const LOCK_MS = 5 * 60_000;
    public const PIN_ITERATIONS = 210_000;
    private const COOKIE = 'rsv_staff';
    private const SESSION_HOURS = 12;

    private static ?array $staff = null;

    /** @return array<string, array> id => スタッフの記録 */
    private static function all(): array
    {
        if (self::$staff === null) {
            self::bootstrap();
            self::$staff = Db::i()->all('staff');
        }
        return self::$staff;
    }

    public static function reset(): void
    {
        self::$staff = null;
    }

    private static function save(array $rec): void
    {
        Db::i()->put('staff', $rec['id'], $rec);
        if (self::$staff !== null) {
            self::$staff[$rec['id']] = $rec;
        }
    }

    /** スタッフが1人もいないときだけ、設定の initial_admin_pin で「院長」を作る */
    private static function bootstrap(): void
    {
        if (Db::i()->count('staff') > 0) {
            return;
        }
        $pin = (string) (config()['initial_admin_pin'] ?? '');
        if (preg_match('/^\d{4,8}$/', $pin)) {
            Db::i()->put('staff', 'staff-admin', [
                'id' => 'staff-admin', 'name' => '院長', 'role' => 'admin', 'active' => true,
                ...self::hashPin($pin),
                'sessionVersion' => 1, 'failedCount' => 0, 'lockedUntil' => 0,
            ]);
        }
    }

    private static function hashPin(string $pin): array
    {
        $salt = bin2hex(random_bytes(16));
        return [
            'pinAlg' => 'pbkdf2-sha256',
            'pinIter' => self::PIN_ITERATIONS,
            'pinSalt' => $salt,
            'pinHash' => hash_pbkdf2('sha256', $pin, $salt, self::PIN_ITERATIONS, 64, false),
        ];
    }

    private static function pinMatches(array $rec, string $pin): bool
    {
        if (($rec['pinAlg'] ?? '') !== 'pbkdf2-sha256') {
            // 古い形式（scrypt）はPHPでは確かめられない。Node版でPINを設定し直すか、管理者がPINを変更する
            return false;
        }
        $given = hash_pbkdf2('sha256', $pin, (string) $rec['pinSalt'], (int) ($rec['pinIter'] ?? self::PIN_ITERATIONS), 64, false);
        return hash_equals((string) $rec['pinHash'], $given);
    }

    private static function checkPinFormat(string $pin): void
    {
        if (!preg_match('/^\d{4,8}$/', $pin)) {
            throw new AuthError('invalid', 'PINは4〜8桁の数字にしてください');
        }
    }

    public static function toPublic(array $s): array
    {
        return ['id' => $s['id'], 'name' => $s['name'], 'role' => $s['role'], 'active' => $s['active']];
    }

    public static function listStaff(bool $includeInactive = false): array
    {
        $out = [];
        foreach (self::all() as $s) {
            if ($includeInactive || $s['active']) {
                $out[] = self::toPublic($s);
            }
        }
        return $out;
    }

    /** @return array{staff: array, sessionVersion: int} */
    public static function verifyPin(string $staffId, string $pin, ?int $now = null): array
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $s = self::all()[$staffId] ?? null;
        if (!$s || !$s['active']) {
            throw new AuthError('invalid_pin', 'スタッフまたはPINが違います');
        }
        if ($s['lockedUntil'] > $now) {
            $min = (int) ceil(($s['lockedUntil'] - $now) / 60_000);
            throw new AuthError('locked', "PINを続けて間違えたため、{$min}分ほどログインできません");
        }
        if (!self::pinMatches($s, $pin)) {
            $fails = $s['failedCount'] + 1;
            if ($fails >= self::MAX_FAILS) {
                self::save([...$s, 'failedCount' => 0, 'lockedUntil' => $now + self::LOCK_MS]);
                self::audit(['id' => $s['id'], 'name' => $s['name']], 'PIN入力の失敗が続いたためロック');
                throw new AuthError('locked', 'PINを続けて間違えたため、5分間ログインできません');
            }
            self::save([...$s, 'failedCount' => $fails]);
            throw new AuthError('invalid_pin', 'スタッフまたはPINが違います');
        }
        if ($s['failedCount'] !== 0 || $s['lockedUntil'] !== 0) {
            self::save([...$s, 'failedCount' => 0, 'lockedUntil' => 0]);
        }
        return ['staff' => self::toPublic($s), 'sessionVersion' => $s['sessionVersion']];
    }

    private static function checkName(string $name): string
    {
        $v = clean_name($name);
        if ($v === '' || js_length($v) > 30 || has_forbidden_chars($v)) {
            throw new AuthError('invalid', '名前は1〜30文字で入力してください');
        }
        return $v;
    }

    public static function createStaff(array $by, array $input): array
    {
        self::checkPinFormat($input['pin']);
        $rec = [
            'id' => new_id('staff'),
            'name' => self::checkName($input['name']),
            'role' => $input['role'],
            'active' => true,
            ...self::hashPin($input['pin']),
            'sessionVersion' => 1,
            'failedCount' => 0,
            'lockedUntil' => 0,
        ];
        self::save($rec);
        self::audit($by, 'スタッフを追加', $rec['id']);
        return self::toPublic($rec);
    }

    public static function updateStaff(array $by, string $id, array $input): array
    {
        $all = self::all();
        $cur = $all[$id] ?? null;
        if (!$cur) {
            throw new AuthError('invalid', 'スタッフが見つかりません');
        }
        $next = $cur;
        if (array_key_exists('name', $input)) {
            $next['name'] = self::checkName($input['name']);
        }
        if (array_key_exists('role', $input)) {
            $next['role'] = $input['role'];
        }
        if (array_key_exists('active', $input)) {
            $next['active'] = $input['active'];
        }
        // 管理者がいなくなる変更は止める
        $admins = 0;
        foreach ($all as $x) {
            $x = $x['id'] === $id ? $next : $x;
            if ($x['active'] && $x['role'] === 'admin') {
                $admins++;
            }
        }
        if ($admins === 0) {
            throw new AuthError('invalid', '院長・管理者が1人以上必要です');
        }
        if (array_key_exists('pin', $input)) {
            self::checkPinFormat($input['pin']);
            $next = [...$next, ...self::hashPin($input['pin']), 'failedCount' => 0, 'lockedUntil' => 0];
        }
        if (array_key_exists('pin', $input) || ($input['active'] ?? null) === false || array_key_exists('role', $input)) {
            $next['sessionVersion']++;
        }
        self::save($next);
        $what = array_filter([
            array_key_exists('name', $input) ? '名前' : null,
            array_key_exists('role', $input) ? '役割' : null,
            array_key_exists('active', $input) ? ($input['active'] ? '利用再開' : '利用停止') : null,
            array_key_exists('pin', $input) ? 'PIN' : null,
        ]);
        self::audit($by, 'スタッフ情報を変更（' . implode('・', $what) . '）', $id);
        return self::toPublic($next);
    }

    // ---- 操作ログ ----

    public static function audit(array $actor, string $action, ?string $target = null): void
    {
        $e = ['at' => now_iso(), 'actor' => $actor, 'action' => $action];
        if ($target !== null && $target !== '') {
            $e['target'] = $target;
        }
        Db::i()->appendAudit($e);
    }

    public static function listAudit(int $limit = 200): array
    {
        return Db::i()->audit($limit);
    }

    // ---- ログイン状態（Cookie） ----

    private static function secret(): string
    {
        $s = (string) (config()['session_secret'] ?? '');
        if (strlen($s) < 32) {
            throw new RuntimeException('session_secret（32文字以上）が設定されていません');
        }
        return $s;
    }

    private static function sign(string $data): string
    {
        return b64url(hash_hmac('sha256', $data, self::secret(), true));
    }

    public static function createSessionToken(string $staffId, int $sessionVersion, ?int $now = null): string
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $payload = b64url(json_out(['sid' => $staffId, 'v' => $sessionVersion, 'exp' => $now + self::SESSION_HOURS * 3_600_000]));
        return $payload . '.' . self::sign($payload);
    }

    public static function readSessionToken(?string $token, ?int $now = null): ?array
    {
        $now ??= (int) floor(microtime(true) * 1000);
        if (!$token) {
            return null;
        }
        $parts = explode('.', $token);
        if (count($parts) < 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }
        [$payload, $mac] = $parts;
        if (!hash_equals(self::sign($payload), $mac)) {
            return null;
        }
        $data = json_decode((string) b64url_decode($payload), true);
        if (!is_array($data) || !is_int($data['exp'] ?? null) || $data['exp'] < $now) {
            return null;
        }
        $s = self::all()[(string) ($data['sid'] ?? '')] ?? null;
        if (!$s || !$s['active'] || $s['sessionVersion'] !== ($data['v'] ?? null)) {
            return null;
        }
        return self::toPublic($s);
    }

    private static function cookieAttrs(): string
    {
        $path = rtrim((string) (config()['base_path'] ?? ''), '/') . '/';
        return "Path={$path}; HttpOnly; SameSite=Strict" . (is_https() ? '; Secure' : '');
    }

    public static function sessionCookie(string $token): string
    {
        return self::COOKIE . "={$token}; " . self::cookieAttrs() . '; Max-Age=' . (self::SESSION_HOURS * 3600);
    }

    public static function clearSessionCookie(): string
    {
        return self::COOKIE . '=; ' . self::cookieAttrs() . '; Max-Age=0';
    }

    public static function currentStaff(): ?array
    {
        $token = $_COOKIE[self::COOKIE] ?? null;
        return self::readSessionToken(is_string($token) ? $token : null);
    }

    /** ログイン中のスタッフを必須にする。$roles を指定するとその役割だけ許可 */
    public static function requireStaff(?array $roles = null): array
    {
        $s = self::currentStaff();
        if (!$s) {
            throw new AuthError('login_required', 'ログインしてください');
        }
        if ($roles !== null && !in_array($s['role'], $roles, true)) {
            throw new AuthError('forbidden', 'この操作の権限がありません');
        }
        return $s;
    }

    public static function actorOf(array $s): array
    {
        return ['id' => $s['id'], 'name' => $s['name']];
    }
}

function b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function b64url_decode(string $s): string|false
{
    return base64_decode(strtr($s, '-_', '+/'), true);
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
        || ($_SERVER['SERVER_PORT'] ?? '') === '443';
}

/** Node.js 版と同じ形のID（"接頭辞-時刻36進-乱数"） */
function new_id(string $prefix): string
{
    return $prefix . '-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(3));
}
