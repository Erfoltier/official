<?php
/**
 * 登録した端末だけで使う（院長・管理者がオンにしたとき）。
 * - 端末ごとに長く残る Cookie（rsv_device。中身はランダムな値。サーバーには要約だけを残す）を渡し、端末を見分ける
 * - 未登録の端末で PIN が合うと「承認待ち」として一覧に出し、院長・管理者が承認するまでログインさせない
 * - オンにした人の端末は、その場で承認する（自分を締め出さないため）
 * 外部連携（Google の連携・ネオボの取り込み・問診票）は合言葉で守っているので、ここの対象外
 */
declare(strict_types=1);

final class Devices
{
    private const COOKIE = 'rsv_device';

    public static function required(): bool
    {
        $s = Db::i()->meta('security');
        return is_array($s) && !empty($s['requireDevice']);
    }

    /** いまの端末の Cookie（なければ null） */
    private static function token(): ?string
    {
        $t = $_COOKIE[self::COOKIE] ?? null;
        return is_string($t) && preg_match('/^[0-9a-f]{64}$/', $t) ? $t : null;
    }

    private static function idOf(string $token): string
    {
        return hash('sha256', 'device:' . $token);
    }

    /** Cookie がなければ作って、送る Set-Cookie を返す（ログインの返事に付ける） */
    public static function ensureCookie(): array
    {
        if (self::token() !== null) {
            return [];
        }
        $t = bin2hex(random_bytes(32));
        $_COOKIE[self::COOKIE] = $t;
        return ['Set-Cookie: ' . self::COOKIE . "={$t}; " . Auth::cookieAttrs() . '; Max-Age=' . (10 * 365 * 86400)];
    }

    private static function label(): string
    {
        $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $os = match (true) {
            str_contains($ua, 'iPad') => 'iPad',
            str_contains($ua, 'iPhone') => 'iPhone',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS') => 'Mac',
            default => 'その他',
        };
        $br = match (true) {
            str_contains($ua, 'Edg/') => 'Edge',
            str_contains($ua, 'Chrome/') => 'Chrome',
            str_contains($ua, 'Safari/') => 'Safari',
            str_contains($ua, 'Firefox/') => 'Firefox',
            default => 'ブラウザ',
        };
        return "{$os}・{$br}";
    }

    /** いまの端末が使ってよいか（必須でなければ常に可） */
    public static function allowed(): bool
    {
        if (!self::required()) {
            return true;
        }
        $t = self::token();
        $d = $t ? Db::i()->get('device', self::idOf($t)) : null;
        return is_array($d) && ($d['status'] ?? '') === 'approved';
    }

    /** PIN が合ったスタッフの端末を確かめる。未登録なら承認待ちに入れて断る */
    public static function checkAtLogin(array $staff): void
    {
        $t = self::token();
        if ($t === null) {
            return;
        }
        $id = self::idOf($t);
        $d = Db::i()->get('device', $id);
        $now = now_iso();
        if (!is_array($d)) {
            $d = ['id' => $id, 'label' => self::label(), 'status' => 'pending', 'firstSeen' => $now];
        }
        $d['lastSeen'] = $now;
        $d['lastStaff'] = ['id' => $staff['id'], 'name' => $staff['name']];
        Db::i()->put('device', $id, $d);
        if (self::required() && $d['status'] !== 'approved') {
            throw new AuthError('device_pending', $d['status'] === 'blocked'
                ? 'この端末は使えないように設定されています。院長・管理者に確認してください'
                : 'この端末はまだ登録されていません。院長・管理者が「設定 → スタッフ → 登録した端末」で承認すると使えるようになります');
        }
    }

    public static function list(): array
    {
        $cur = self::token() ? self::idOf((string) self::token()) : null;
        $items = array_map(fn($d) => [...$d, 'current' => $d['id'] === $cur], array_values(Db::i()->all('device')));
        usort($items, fn($a, $b) => strcmp((string) ($b['lastSeen'] ?? ''), (string) ($a['lastSeen'] ?? '')));
        return $items;
    }

    public static function setStatus(string $id, string $status, array $actor, ?string $label = null): array
    {
        $d = Db::i()->get('device', $id);
        if (!is_array($d)) {
            throw new StoreError('not_found', '端末が見つかりません');
        }
        if ($status === 'delete') {
            Db::i()->delete('device', $id);
            Auth::audit($actor, '登録した端末を削除', (string) $d['label']);
            return ['id' => $id, 'deleted' => true];
        }
        if (!in_array($status, ['approved', 'blocked', 'pending'], true)) {
            throw new StoreError('invalid', '状態が正しくありません');
        }
        $d['status'] = $status;
        if ($label !== null && trim($label) !== '') {
            $d['label'] = mb_substr(trim($label), 0, 40);
        }
        if ($status === 'approved') {
            $d['approvedBy'] = $actor;
            $d['approvedAt'] = now_iso();
        }
        Db::i()->put('device', $id, $d);
        Auth::audit($actor, ['approved' => '端末を承認', 'blocked' => '端末を使用停止', 'pending' => '端末を承認待ちに戻す'][$status], (string) $d['label']);
        return $d;
    }

    /** 必須の切り替え。オンにした人の端末はその場で承認する */
    public static function setRequired(bool $on, array $actor): array
    {
        if ($on) {
            $t = self::token();
            if ($t === null) {
                throw new StoreError('invalid', 'この端末を見分けられません。いったんログインし直してから、もう一度オンにしてください');
            }
            $id = self::idOf($t);
            $d = Db::i()->get('device', $id) ?? ['id' => $id, 'label' => self::label(), 'firstSeen' => now_iso()];
            Db::i()->put('device', $id, [...$d, 'status' => 'approved', 'approvedBy' => $actor, 'approvedAt' => now_iso(), 'lastSeen' => now_iso()]);
        }
        $cur = Db::i()->meta('security');
        Db::i()->setMeta('security', [...(is_array($cur) ? $cur : []), 'requireDevice' => $on]);
        Auth::audit($actor, $on ? '登録した端末だけで使うようにした' : '登録した端末だけで使う設定をやめた');
        return ['requireDevice' => $on];
    }
}
