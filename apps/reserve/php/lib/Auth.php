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
    private const MAX_LOCK_MS = 24 * 60 * 60_000;
    private const IP_MAX_FAILS = 20;
    private const IP_WINDOW_MS = 15 * 60_000;
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
        if (!preg_match('/^\d{6,8}$/', $pin)) {
            throw new AuthError('invalid', 'PINは6〜8桁の数字にしてください');
        }
    }

    public static function toPublic(array $s): array
    {
        return ['id' => $s['id'], 'name' => $s['name'], 'role' => $s['role'], 'active' => $s['active'], 'canManage' => self::canManage($s)];
    }

    /** 設定の変更・削除などの管理操作：院長・管理者は常に、ほかは院長の上書き（なければ受付だけ） */
    public static function canManage(array $s): bool
    {
        if ($s['role'] === 'admin') {
            return true;
        }
        return isset($s['manage']) ? (bool) $s['manage'] : $s['role'] === 'reception';
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

    /** 失敗の回数 → ロックする長さ（ミリ秒）。5回目からロックし、間違えるたびに倍に（最長1日）。0 はロックしない */
    public static function lockMsFor(int $fails): int
    {
        return $fails < self::MAX_FAILS ? 0 : (int) min(self::LOCK_MS * 2 ** ($fails - self::MAX_FAILS), self::MAX_LOCK_MS);
    }

    /**
     * PINを確かめる。成功すればセッションに入れる sessionVersion を返す。
     * 同時にたくさん送られても回数の数え漏れが出ないよう、書き込みの鍵を取ってから最新の記録で数える
     * @return array{staff: array, sessionVersion: int}
     */
    public static function verifyPin(string $staffId, string $pin, ?int $now = null): array
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $db = Db::i();
        $out = $db->transaction(function () use ($db, $staffId, $pin, $now) {
            self::bootstrap();
            $s = $db->get('staff', $staffId);
            // 存在しない・停止中のスタッフも、同じ文言で断る
            if (!$s || !$s['active']) {
                return ['error' => new AuthError('invalid_pin', 'スタッフまたはPINが違います')];
            }
            if ($s['lockedUntil'] > $now) {
                $min = (int) ceil(($s['lockedUntil'] - $now) / 60_000);
                return ['error' => new AuthError('locked', "PINを続けて間違えたため、{$min}分ほどログインできません")];
            }
            if (!self::pinMatches($s, $pin)) {
                // 失敗の回数はログインに成功するまで戻さない
                $fails = $s['failedCount'] + 1;
                $lockMs = self::lockMsFor($fails);
                if ($lockMs > 0) {
                    self::save([...$s, 'failedCount' => $fails, 'lockedUntil' => $now + $lockMs]);
                    self::audit(['id' => $s['id'], 'name' => $s['name']], 'PIN入力の失敗が続いたためロック');
                    $min = (int) round($lockMs / 60_000);
                    return ['error' => new AuthError('locked', "PINを続けて間違えたため、{$min}分間ログインできません")];
                }
                self::save([...$s, 'failedCount' => $fails]);
                return ['error' => new AuthError('invalid_pin', 'スタッフまたはPINが違います')];
            }
            if ($s['failedCount'] !== 0 || $s['lockedUntil'] !== 0) {
                self::save([...$s, 'failedCount' => 0, 'lockedUntil' => 0]);
            }
            return ['ok' => ['staff' => self::toPublic($s), 'sessionVersion' => $s['sessionVersion']]];
        });
        // 失敗の記録を確定させてから断る（中で投げると取り消されてしまう）
        if (isset($out['error'])) {
            throw $out['error'];
        }
        return $out['ok'];
    }

    /**
     * 同じ接続元からのPINの失敗が多すぎないか（15分で20回まで）。スタッフを変えての総当たりや、全員をロックさせる妨害を抑える。
     * 接続元はハッシュにして保存する
     */
    public static function checkLoginRate(string $ip, ?int $now = null): void
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $rec = Db::i()->get('loginIp', hash('sha256', $ip)) ?? ['fails' => []];
        $recent = array_values(array_filter($rec['fails'], fn($t) => $t > $now - self::IP_WINDOW_MS));
        if (count($recent) >= self::IP_MAX_FAILS) {
            throw new AuthError('locked', 'この端末・回線からのPINの失敗が多いため、しばらくログインできません');
        }
    }

    public static function noteLoginFailure(string $ip, ?int $now = null): void
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $id = hash('sha256', $ip);
        Db::i()->transaction(function () use ($id, $now) {
            $rec = Db::i()->get('loginIp', $id) ?? ['fails' => []];
            $recent = array_values(array_filter($rec['fails'], fn($t) => $t > $now - self::IP_WINDOW_MS));
            $recent[] = $now;
            Db::i()->put('loginIp', $id, ['fails' => array_slice($recent, -self::IP_MAX_FAILS)]);
        });
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
        if (array_key_exists('canManage', $input)) {
            $next['manage'] = $input['canManage'];
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
            array_key_exists('canManage', $input) ? ($input['canManage'] ? '管理操作を許可' : '管理操作を不可') : null,
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
        if (Db::i()->get('revokedSession', hash('sha256', $mac)) !== null) {
            return null;
        }
        $s = self::all()[(string) ($data['sid'] ?? '')] ?? null;
        if (!$s || !$s['active'] || $s['sessionVersion'] !== ($data['v'] ?? null)) {
            return null;
        }
        return self::toPublic($s);
    }

    /**
     * 閲覧の記録（誰がどの患者・ファイル・同意書を見たか）。画面の変更履歴とは分けて残し、
     * 同じスタッフ・同じ対象は1時間に1件にまとめる（最後に見た時刻）。患者の中身は残さない
     */
    public static function noteAccess(array $s, string $action, string $target): void
    {
        $at = now_iso();
        $id = hash('sha256', $s['id'] . '|' . $target . '|' . substr($at, 0, 13));
        Db::i()->put('accessLog', $id, ['at' => $at, 'staffId' => $s['id'], 'staffName' => $s['name'], 'action' => $action, 'target' => $target]);
    }

    /** ログアウト：この Cookie を期限まで使えなくする（盗まれた・端末に残った Cookie 対策） */
    public static function revokeSessionToken(?string $token, ?int $now = null): void
    {
        $now ??= (int) floor(microtime(true) * 1000);
        if (!$token || !self::readSessionToken($token, $now)) {
            return;
        }
        [$payload, $mac] = explode('.', $token);
        $exp = (int) (json_decode((string) b64url_decode($payload), true)['exp'] ?? 0);
        $db = Db::i();
        $db->transaction(function () use ($db, $mac, $exp, $now) {
            foreach ($db->all('revokedSession') as $id => $r) {
                if (($r['exp'] ?? 0) < $now) {
                    $db->delete('revokedSession', (string) $id);
                }
            }
            $db->put('revokedSession', hash('sha256', $mac), ['exp' => $exp]);
        });
    }

    /** Cookie の中のトークン */
    public static function sessionToken(): ?string
    {
        return isset($_COOKIE[self::COOKIE]) ? (string) $_COOKIE[self::COOKIE] : null;
    }

    private static function cookieAttrs(): string
    {
        $path = rtrim((string) (config()['base_path'] ?? ''), '/') . '/';
        // 本番は常に Secure（https の判定に失敗しても平文で流さない）。手元の http での試験だけ外す
        $local = preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', (string) ($_SERVER['HTTP_HOST'] ?? ''));
        return "Path={$path}; HttpOnly; SameSite=Strict" . (is_https() || !$local ? '; Secure' : '');
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

    /** 設定の変更・削除などの管理操作（院長・管理者と受付、または院長が許可したスタッフ） */
    public static function requireManager(): array
    {
        $s = self::requireStaff();
        if (!$s['canManage']) {
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
