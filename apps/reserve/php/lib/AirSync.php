<?php
declare(strict_types=1);

/**
 * Airリザーブの予約の取り込み。毎朝（既定 7:00 以降の最初の cron）に翌日の予約を取り込み、
 * 前日18時のリマインドに間に合わせる。PC の電源が切れていても、サーバーの cron だけで動く。
 *
 * - ログイン ID・パスワードは暗号化して保存し、画面には二度と出さない
 * - Air の画面が使っている通信（予約カレンダーの JSON）を、ブラウザなしで読む。Air の作りが変わると止まるので、
 *   結果（最後に取り込んだ日時・失敗の理由）を設定画面に出す
 * - 患者情報はログに残さない（件数だけ）
 */
final class AirSync
{
    private const BASE = 'https://airreserve.net';
    /** テスト用：HTTP を差し替える（method, url, headers, body）→ [code, body, finalUrl] */
    public static $transport = null;
    private static $curl = null;

    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'time' => '07:00',
            // Air の予約カレンダー（リソースのまとまり）の番号。いしだ皮フ科「美容皮膚科」
            'groupId' => 'I00009C273',
        ];
    }

    public static function settings(): array
    {
        $s = Db::i()->meta('airSyncSettings');
        return [...self::defaults(), ...(is_array($s) ? $s : [])];
    }

    private static function secrets(): array
    {
        $s = Db::i()->meta('airSyncSecrets');
        return is_array($s) ? $s : [];
    }

    public static function publicSettings(): array
    {
        $sec = self::secrets();
        $last = Db::i()->meta('airSyncLast');
        return [
            ...self::settings(),
            'loginConfigured' => ($sec['id'] ?? '') !== '' && ($sec['password'] ?? '') !== '',
            'loginId' => ($sec['id'] ?? '') !== '' ? mb_substr($sec['id'], 0, 2) . '…' : '',
            'lastRun' => is_array($last) ? $last : null,
            'review' => Store::reviewPatients(),
        ];
    }

    public static function updateSettings(array $in, array $by): array
    {
        $s = self::settings();
        if (array_key_exists('enabled', $in)) {
            $s['enabled'] = (bool) $in['enabled'];
        }
        if (array_key_exists('time', $in)) {
            if (!is_string($in['time']) || !preg_match('/^(0[5-9]|1[0-6]):[0-5]\d$/', $in['time'])) {
                throw new StoreError('invalid', '取り込む時刻は 5:00〜16:59 で入れてください（18時のリマインドより前）');
            }
            $s['time'] = $in['time'];
        }
        if (array_key_exists('groupId', $in)) {
            if (!is_string($in['groupId']) || !preg_match('/^[A-Za-z0-9]{1,20}$/', $in['groupId'])) {
                throw new StoreError('invalid', 'カレンダー番号の形が正しくありません');
            }
            $s['groupId'] = $in['groupId'];
        }
        Db::i()->setMeta('airSyncSettings', $s);
        if (array_key_exists('loginId', $in) || array_key_exists('password', $in)) {
            $id = trim((string) ($in['loginId'] ?? ''));
            $pw = (string) ($in['password'] ?? '');
            if ($id === '' && $pw === '') {
                Db::i()->setMeta('airSyncSecrets', []);
                Auth::audit($by, 'Airリザーブのログイン情報を消去');
            } else {
                if ($id === '' || $pw === '' || mb_strlen($id) > 100 || strlen($pw) > 200) {
                    throw new StoreError('invalid', 'ログイン ID とパスワードを両方入れてください');
                }
                Db::i()->setMeta('airSyncSecrets', ['id' => $id, 'password' => $pw]);
                Auth::audit($by, 'Airリザーブのログイン情報を保存');
            }
        }
        Auth::audit($by, 'Airリザーブの取り込み設定を変更');
        return self::publicSettings();
    }

    // ---- 自動実行（cron から） ----

    /** 決めた時刻を過ぎていて、今日まだ取り込んでいなければ、翌日の分を取り込む */
    public static function tick(): ?array
    {
        $s = self::settings();
        if (!$s['enabled']) {
            return null;
        }
        $now = now_in_clinic();
        // リマインドを送る20分前にも、その回の対象日をもう一度取り込む（朝の取り込みのあとに Air で取り消された予約へ送らないため）
        $pre = self::preReminderRun($now);
        if ($pre !== null) {
            return $pre;
        }
        $last = Db::i()->meta('airSyncLast');
        if (is_array($last) && ($last['auto'] ?? '') === $now['date']) {
            return null;
        }
        [$hh, $mm] = array_map('intval', explode(':', $s['time']));
        if ($now['minutes'] < $hh * 60 + $mm) {
            return null;
        }
        $tomorrow = (new DateTimeImmutable($now['date'], jst()))->modify('+1 day')->format('Y-m-d');
        // 失敗しても同じ日に何度も試しすぎないよう、先に「今日は試した」を記録する（失敗時は30分あけて再試行）
        if (is_array($last) && ($last['failedAt'] ?? null) && time() - strtotime($last['failedAt']) < 1800) {
            return null;
        }
        return self::run($tomorrow, true);
    }

    private static function preReminderRun(array $now): ?array
    {
        $rs = Reminder::settings();
        if (!$rs['enabled']) {
            return null;
        }
        $done = Db::i()->meta('airSyncPre');
        $done = is_array($done) ? $done : [];
        foreach ($rs['rounds'] as $r) {
            [$hh, $mm] = array_map('intval', explode(':', (string) $r['time']));
            $send = $hh * 60 + $mm;
            if ($now['minutes'] < $send - 20 || $now['minutes'] >= $send + 180) {
                continue;
            }
            $key = $now['date'] . '|' . $r['time'] . '|' . (int) $r['daysBefore'];
            if (in_array($key, $done, true)) {
                continue;
            }
            $done[] = $key;
            Db::i()->setMeta('airSyncPre', array_slice($done, -20));
            $target = (new DateTimeImmutable($now['date'], jst()))->modify('+' . (int) $r['daysBefore'] . ' day')->format('Y-m-d');
            try {
                return self::run($target);
            } catch (Throwable) {
                // 失敗は airSyncLast に残る。リマインドはそのまま（朝の取り込みの内容で）送る
                return ['ok' => false, 'date' => $target];
            }
        }
        return null;
    }

    /** 指定した日の Air の予約を取り込む */
    public static function run(string $date, bool $auto = false): array
    {
        $last = Db::i()->meta('airSyncLast');
        $last = is_array($last) ? $last : [];
        try {
            $rows = self::fetchDay($date);
            $res = Store::airApply($date, $rows);
            $out = ['at' => now_iso(), 'date' => $date, 'ok' => true, 'count' => count($rows), ...$res];
            if ($auto) {
                $out['auto'] = now_in_clinic()['date'];
            } elseif (isset($last['auto'])) {
                $out['auto'] = $last['auto'];
            }
            Db::i()->setMeta('airSyncLast', $out);
            return $out;
        } catch (Throwable $e) {
            $msg = $e instanceof StoreError ? $e->getMessage() : '取り込めませんでした（' . get_class($e) . '）';
            $out = ['at' => now_iso(), 'date' => $date, 'ok' => false, 'error' => $msg, 'failedAt' => now_iso()];
            if (isset($last['auto'])) {
                $out['auto'] = $last['auto'];
            }
            Db::i()->setMeta('airSyncLast', $out);
            if (!$auto) {
                throw $e instanceof StoreError ? $e : new StoreError('invalid', $msg);
            }
            return $out;
        }
    }

    // ---- Air との通信 ----

    /** 1日分の予約を、カレンダーに入れる形にして返す */
    public static function fetchDay(string $date): array
    {
        $sec = self::secrets();
        if (($sec['id'] ?? '') === '' || ($sec['password'] ?? '') === '') {
            throw new StoreError('invalid', 'Airリザーブのログイン情報が入っていません');
        }
        self::$curl = null;
        self::login($sec['id'], $sec['password']);
        $csrf = self::jsonp(self::req('GET', self::BASE . '/stateful/usestate/list', ['X-Requested-With: XMLHttpRequest'])[1])['authCsrfDto']['token'] ?? '';
        if ($csrf === '') {
            throw new StoreError('invalid', 'Airリザーブにログインできませんでした（ID・パスワードを確かめてください）');
        }
        $d = str_replace('-', '', $date);
        $body = json_encode(['bookingFromDt' => $d . '000000', 'bookingToDt' => $d . '240000', 'resrcSchdlGrpId' => self::settings()['groupId']]);
        [$code, $raw] = self::req('POST', self::BASE . '/stateful/booking/staff/search/calendar', [
            'Content-Type: application/json; charset=UTF-8',
            'X-Requested-With: XMLHttpRequest',
            'X-CSRF-TOKEN: ' . $csrf,
            'Referer: ' . self::BASE . '/reserve/calendar/',
        ], $body);
        $j = self::jsonp($raw);
        if ($code !== 200 || !($j['success'] ?? false) || !is_array($j['dto'] ?? null)) {
            throw new StoreError('invalid', 'Airリザーブから予約を読めませんでした（Air の画面の作りが変わった可能性があります）');
        }
        $rows = [];
        foreach ((array) ($j['dto']['staffRentalBookingRstMap'] ?? []) as $byStaff) {
            foreach ((array) $byStaff as $list) {
                foreach ((array) $list as $b) {
                    if (!is_array($b) || empty($b['bookingNo']) || !preg_match('/^\d{14}$/', (string) ($b['bookingFromDt'] ?? '')) || !preg_match('/^\d{14}$/', (string) ($b['bookingToDt'] ?? ''))) {
                        continue;
                    }
                    $rows[(string) $b['bookingNo']] = [
                        'no' => (string) $b['bookingNo'],
                        'from' => self::iso((string) $b['bookingFromDt']),
                        'to' => self::iso((string) $b['bookingToDt']),
                        'cancelled' => !empty($b['bookingCancelOpeDt']) || str_contains((string) ($b['bookingStatusCd'] ?? ''), 'CANCEL'),
                        'memo' => (string) ($b['bookingMemo'] ?? ''),
                        'menuName' => (string) ($b['menuNm'] ?? ''),
                        'laneName' => (string) ($b['resrcSchdlNm'] ?? ''),
                        'kana' => trim(($b['lastNmKn'] ?? '') . ' ' . ($b['firstNmKn'] ?? '')),
                        'kanji' => trim(($b['lastNm'] ?? '') . ' ' . ($b['firstNm'] ?? '')),
                        'email' => (string) ($b['mailAddress1'] ?? ''),
                    ];
                }
            }
        }
        return array_values($rows);
    }

    /** 20261014101500 → 2026-10-14T10:15:00+09:00（24:00 は翌日 0:00） */
    private static function iso(string $t): string
    {
        $dt = new DateTimeImmutable(substr($t, 0, 8), jst());
        return $dt->modify(sprintf('+%d hours +%d minutes', (int) substr($t, 8, 2), (int) substr($t, 10, 2)))->format('Y-m-d\TH:i:sP');
    }

    private static function login(string $id, string $pw): void
    {
        [, $html, $url] = self::req('GET', self::BASE . '/reserve/calendar/', []);
        if (str_starts_with($url, self::BASE . '/reserve/calendar')) {
            return;
        }
        $doc = new DOMDocument();
        @$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
        $form = null;
        foreach ($doc->getElementsByTagName('form') as $f) {
            foreach ($f->getElementsByTagName('input') as $i) {
                if ($i->getAttribute('type') === 'password') {
                    $form = $f;
                    break 2;
                }
            }
        }
        if (!$form) {
            throw new StoreError('invalid', 'Airリザーブのログイン画面を読めませんでした');
        }
        $fields = [];
        foreach ($form->getElementsByTagName('input') as $i) {
            if ($i->getAttribute('name') !== '') {
                $fields[$i->getAttribute('name')] = $i->getAttribute('value');
            }
        }
        if (($fields['captchaRequired'] ?? '0') !== '0' && ($fields['captchaRequired'] ?? '') !== '') {
            throw new StoreError('invalid', 'Airリザーブが画像認証を求めています。いったんブラウザでログインしてから、もう一度試してください');
        }
        $fields['username'] = $id;
        $fields['password'] = $pw;
        $action = $form->getAttribute('action');
        $target = preg_match('#^https://#', $action) ? $action : (str_starts_with($action, '/') ? preg_replace('#^(https://[^/]+).*$#', '$1', $url) . $action : $url);
        [$code, , $after] = self::req('POST', $target, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($fields));
        if (!str_starts_with($after, self::BASE . '/')) {
            throw new StoreError('invalid', 'Airリザーブにログインできませんでした（ID・パスワードを確かめてください）');
        }
    }

    /** Air の JSON は「/**\/callback(...)」で包まれていることがある */
    private static function jsonp(string $raw): array
    {
        if (preg_match('/^[^({\[]*\(([\s\S]*)\)[;\s]*$/', $raw, $m)) {
            $raw = $m[1];
        }
        $j = json_decode($raw, true);
        return is_array($j) ? $j : [];
    }

    private static function req(string $method, string $url, array $headers, ?string $body = null): array
    {
        if (self::$transport !== null) {
            return (self::$transport)($method, $url, $headers, $body);
        }
        if (self::$curl === null) {
            self::$curl = curl_init();
        }
        $ch = self::$curl;
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_HTTPHEADER => [...$headers, 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept: text/html,application/json,*/*', 'Accept-Language: ja'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_COOKIEFILE => '',
            CURLOPT_TIMEOUT => 30,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        if ($method === 'GET') {
            curl_setopt($ch, CURLOPT_HTTPGET, true);
        } else {
            // CUSTOMREQUEST は使わない（使うと転送先にも POST し続け、ログインの転送が 403 になる）
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, (string) $body);
        }
        $out = curl_exec($ch);
        if ($out === false) {
            throw new StoreError('invalid', 'Airリザーブにつながりませんでした');
        }
        return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), (string) $out, (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL)];
    }
}
