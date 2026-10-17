<?php
declare(strict_types=1);

/**
 * Airリザーブの予約の取り込み。毎朝（既定 7:00 以降の最初の cron）に翌日の予約を取り込み、
 * 前日18時のリマインドに間に合わせる。あわせて日中は15分ごと（設定で変更可）に、今日から120日先までの診療日（水曜・祝日・特別診療日など、設定で変更可）をまとめて取り込む。
 * PC の電源が切れていても、サーバーの cron だけで動く。
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
            // こまめな取り込み：この分ごとに、今日から rangeDays 日先までを取り込む（0 で止める）。7:00〜21:00 のあいだだけ
            'interval' => 15,
            'rangeDays' => 120,
            // こまめな取り込みで取り込む日（診療日）。曜日（0=日〜6=土）・祝日・ホームページの「特別診療日」。
            // 曜日が空で祝日も URL もないときは毎日。いしだ皮フ科の美容皮膚科は水曜・祝日・特別診療日
            'clinicWeekdays' => [3],
            'clinicHolidays' => true,
            'specialDaysUrl' => 'https://ishidahihuka.jp/',
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
            'frequentLast' => is_array($f = Db::i()->meta('airSyncFrequent')) ? $f : null,
            'specialDays' => is_array($sp = Db::i()->meta('airSpecialDays')) ? $sp : null,
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
                throw new StoreError('invalid', '取り込み時刻は 5:00〜16:59 の間で設定してください（リマインドの送信時刻より前）');
            }
            $s['time'] = $in['time'];
        }
        if (array_key_exists('interval', $in)) {
            if (!in_array($in['interval'], [0, 10, 15, 30, 60, 120], true)) {
                throw new StoreError('invalid', 'こまめな取り込みの間隔は、しない・10・15・30・60・120分から選んでください');
            }
            $s['interval'] = $in['interval'];
        }
        if (array_key_exists('rangeDays', $in)) {
            if (!is_int($in['rangeDays']) || $in['rangeDays'] < 1 || $in['rangeDays'] > 120) {
                throw new StoreError('invalid', 'こまめな取り込みの期間は1〜120日で選んでください');
            }
            $s['rangeDays'] = $in['rangeDays'];
        }
        if (array_key_exists('clinicWeekdays', $in)) {
            $w = $in['clinicWeekdays'];
            if (!is_array($w) || array_filter($w, fn($d) => !is_int($d) || $d < 0 || $d > 6)) {
                throw new StoreError('invalid', '診療日の曜日の形式が正しくありません');
            }
            $w = array_values(array_unique($w));
            sort($w);
            $s['clinicWeekdays'] = $w;
        }
        if (array_key_exists('clinicHolidays', $in)) {
            $s['clinicHolidays'] = (bool) $in['clinicHolidays'];
        }
        if (array_key_exists('specialDaysUrl', $in)) {
            $u = trim((string) $in['specialDaysUrl']);
            if ($u !== '' && (!preg_match('#^https://[^\s/]+(/\S*)?$#', $u) || strlen($u) > 300)) {
                throw new StoreError('invalid', '特別診療日のページは https:// で始まるアドレスを入れてください');
            }
            $s['specialDaysUrl'] = $u;
        }
        if (array_key_exists('groupId', $in)) {
            if (!is_string($in['groupId']) || !preg_match('/^[A-Za-z0-9]{1,20}$/', $in['groupId'])) {
                throw new StoreError('invalid', 'カレンダー番号の形式が正しくありません');
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
                    throw new StoreError('invalid', 'ログイン ID とパスワードを両方入力してください');
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
        $daily = self::dailyRun($now, $s);
        if ($daily !== null) {
            return $daily;
        }
        return self::frequentRun($now, $s);
    }

    /** 毎朝1回、翌日の分を取り込む（決めた時刻を過ぎていて、今日まだなら） */
    private static function dailyRun(array $now, array $s): ?array
    {
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

    /**
     * こまめな取り込み：interval 分ごとに、今日から rangeDays 日先までの Air の予約をまとめて読み、日ごとに取り込む。
     * Air で入れた予約がすぐカレンダーに入り、LINE の問診票（予約申請ID つきの予約）も早く書けるようにする。
     * Air への負担を抑えるため、ログインと読み込みは1回だけ・7:00〜21:00 のあいだだけ。失敗しても次の回まで待つ
     */
    private static function frequentRun(array $now, array $s): ?array
    {
        $iv = (int) ($s['interval'] ?? 0);
        if ($iv <= 0 || $now['minutes'] < 7 * 60 || $now['minutes'] >= 21 * 60) {
            return null;
        }
        $prev = Db::i()->meta('airSyncFrequent');
        $prev = is_array($prev) ? $prev : [];
        if (isset($prev['at']) && time() - strtotime((string) $prev['at']) < $iv * 60 - 60) {
            return null;
        }
        $from = $now['date'];
        $to = (new DateTimeImmutable($from, jst()))->modify('+' . max(1, min(120, (int) ($s['rangeDays'] ?? 14))) . ' day')->format('Y-m-d');
        $isClinicDay = self::clinicDayFilter($s);
        // 先に「試した」を残す（Air が遅くて重なって動いても、二重に読みに行かない）
        Db::i()->setMeta('airSyncFrequent', [...$prev, 'at' => now_iso()]);
        try {
            $byDate = [];
            foreach (self::fetchRange($from, $to) as $row) {
                $byDate[clinic_date_of($row['from'])][] = $row;
            }
            $sum = ['created' => 0, 'updated' => 0, 'cancelled' => 0, 'unchanged' => 0, 'newPatients' => 0];
            $count = 0;
            $days = 0;
            for ($d = $from; $d <= $to; $d = (new DateTimeImmutable($d, jst()))->modify('+1 day')->format('Y-m-d')) {
                // 診療日でない日は取り込まない（カレンダーのその日の予約にもさわらない）
                if ($isClinicDay !== null && !$isClinicDay($d)) {
                    continue;
                }
                $days++;
                $rows = $byDate[$d] ?? [];
                $count += count($rows);
                // 1件もない日は Store::airApply が何も取り消さない（読み込みの失敗と見分けがつかないため）
                foreach (Store::airApply($d, $rows) as $k => $v) {
                    if (isset($sum[$k])) {
                        $sum[$k] += $v;
                    }
                }
            }
            $out = ['at' => now_iso(), 'ok' => true, 'date' => "{$from}〜{$to}", 'days' => $days, 'count' => $count, ...$sum];
        } catch (Throwable $e) {
            $out = ['at' => now_iso(), 'ok' => false, 'date' => "{$from}〜{$to}", 'error' => $e instanceof StoreError ? $e->getMessage() : '取り込めませんでした（' . get_class($e) . '）'];
        }
        Db::i()->setMeta('airSyncFrequent', $out);
        return $out;
    }

    /** 診療日だけに絞る判定。曜日も祝日も特別診療日もないときは null（毎日） */
    public static function clinicDayFilter(array $s): ?Closure
    {
        $weekdays = array_map('intval', (array) ($s['clinicWeekdays'] ?? []));
        $holidays = !empty($s['clinicHolidays']);
        $url = (string) ($s['specialDaysUrl'] ?? '');
        if (!$weekdays && !$holidays && $url === '') {
            return null;
        }
        $special = $url !== '' ? array_flip(self::specialDays($url)) : [];
        return fn(string $d): bool => isset($special[$d])
            || in_array((int) (new DateTimeImmutable($d, jst()))->format('w'), $weekdays, true)
            || ($holidays && Holidays::is($d));
    }

    /**
     * ホームページの「特別診療日」（例「11月3日（火）・23日（月）」）を読む。6時間ごとに読み直し、
     * 読めなかったときは前回の日付を使う
     * @return string[] YYYY-MM-DD
     */
    public static function specialDays(string $url): array
    {
        $prev = Db::i()->meta('airSpecialDays');
        $prev = is_array($prev) && ($prev['url'] ?? '') === $url ? $prev : null;
        if ($prev && time() - strtotime((string) ($prev['checkedAt'] ?? $prev['at'] ?? '')) < 6 * 3600) {
            return (array) ($prev['dates'] ?? []);
        }
        try {
            [$code, $html] = self::$transport !== null ? (self::$transport)('GET', $url, [], null) : self::fetchPage($url);
            if ($code !== 200) {
                throw new StoreError('invalid', "特別診療日のページを読めませんでした（{$code}）");
            }
            $dates = self::parseSpecialDays((string) $html, (new DateTimeImmutable('now', jst()))->format('Y-m-d'));
            Db::i()->setMeta('airSpecialDays', ['url' => $url, 'at' => now_iso(), 'checkedAt' => now_iso(), 'dates' => $dates]);
            return $dates;
        } catch (Throwable $e) {
            $msg = $e instanceof StoreError ? $e->getMessage() : '特別診療日のページを読めませんでした';
            Db::i()->setMeta('airSpecialDays', [...($prev ?? ['url' => $url, 'dates' => []]), 'checkedAt' => now_iso(), 'error' => $msg]);
            return (array) ($prev['dates'] ?? []);
        }
    }

    /** 「特別診療日」の見出しのあとの「M月D日」を拾う。年は今日に近いほう（過ぎた月は来年） */
    public static function parseSpecialDays(string $html, string $today): array
    {
        $html = preg_replace('#<(script|style)\b[\s\S]*?</\1>#i', '', $html) ?? '';
        $pos = mb_strpos($html, '特別診療日');
        while ($pos !== false) {
            // 見出し・お知らせのうち、後ろに日付が並ぶところ
            $chunk = mb_substr($html, $pos, 3000);
            $end = mb_stripos($chunk, '</section>');
            $chunk = $end !== false ? mb_substr($chunk, 0, $end) : $chunk;
            $text = html_entity_decode(strip_tags($chunk), ENT_QUOTES, 'UTF-8');
            $text = mb_convert_kana($text, 'n');
            if (preg_match_all('/(?:(\d{1,2})月)?\s*(\d{1,2})日/u', $text, $m, PREG_SET_ORDER)) {
                $ty = (int) substr($today, 0, 4);
                $tm = (int) substr($today, 5, 2);
                $month = 0;
                $out = [];
                foreach ($m as $x) {
                    if ($x[1] !== '') {
                        $month = (int) $x[1];
                    }
                    $day = (int) $x[2];
                    if ($month < 1 || $month > 12 || $day < 1 || $day > 31) {
                        continue;
                    }
                    $y = $month < $tm - 1 ? $ty + 1 : $ty;
                    if (checkdate($month, $day, $y)) {
                        $out[] = sprintf('%04d-%02d-%02d', $y, $month, $day);
                    }
                }
                if ($out) {
                    $out = array_values(array_unique($out));
                    sort($out);
                    return $out;
                }
            }
            $pos = mb_strpos($html, '特別診療日', $pos + 5);
        }
        return [];
    }

    private static function fetchPage(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'reserve-air-sync',
        ]);
        $html = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($html) || strlen($html) > 3 * 1024 * 1024) {
            throw new StoreError('invalid', '特別診療日のページを読めませんでした');
        }
        return [$code, $html];
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
        // 照合は今日以降の予約だけで行うため、過去の日は取り込まない（取り込むと二重になる）
        $today = now_in_clinic()['date'];
        $max = (new DateTimeImmutable($today, jst()))->modify('+60 day')->format('Y-m-d');
        if ($date < $today || $date > $max) {
            throw new StoreError('invalid', '取り込めるのは今日から60日後までです');
        }
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
        return self::fetchRange($date, $date);
    }

    /** 期間の予約を読む（読むだけ。過去の日も可） */
    public static function fetchRange(string $from, string $to): array
    {
        $sec = self::secrets();
        if (($sec['id'] ?? '') === '' || ($sec['password'] ?? '') === '') {
            throw new StoreError('invalid', 'Airリザーブのログイン情報が設定されていません');
        }
        self::$curl = null;
        self::login($sec['id'], $sec['password']);
        $csrf = self::jsonp(self::req('GET', self::BASE . '/stateful/usestate/list', ['X-Requested-With: XMLHttpRequest'])[1])['authCsrfDto']['token'] ?? '';
        if ($csrf === '') {
            throw new StoreError('invalid', 'Airリザーブにログインできませんでした（ID・パスワードを確認してください）');
        }
        // 長い期間は31日ずつ読む（1回の読み込みを Air の画面の月表示と同じくらいに抑える）
        $rows = [];
        for ($a = $from; $a <= $to; $a = $next) {
            $b = min($to, (new DateTimeImmutable($a, jst()))->modify('+30 day')->format('Y-m-d'));
            $next = (new DateTimeImmutable($b, jst()))->modify('+1 day')->format('Y-m-d');
            $rows += self::searchCalendar($a, $b, $csrf);
        }
        return array_values($rows);
    }

    private static function searchCalendar(string $from, string $to, string $csrf): array
    {
        $body = json_encode(['bookingFromDt' => str_replace('-', '', $from) . '000000', 'bookingToDt' => str_replace('-', '', $to) . '240000', 'resrcSchdlGrpId' => self::settings()['groupId']]);
        [$code, $raw] = self::req('POST', self::BASE . '/stateful/booking/staff/search/calendar', [
            'Content-Type: application/json; charset=UTF-8',
            'X-Requested-With: XMLHttpRequest',
            'X-CSRF-TOKEN: ' . $csrf,
            'Referer: ' . self::BASE . '/reserve/calendar/',
        ], $body);
        $j = self::jsonp($raw);
        if ($code !== 200 || !($j['success'] ?? false) || !is_array($j['dto'] ?? null)) {
            throw new StoreError('invalid', 'Airリザーブから予約を読み込めませんでした（Air の画面構成が変わった可能性があります）');
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
        return $rows;
    }

    /**
     * 期間の Air の予約と、カレンダーの「Air予約番号」付きの予約を見比べる（読むだけ・何も書き換えない）。
     * 違う人・時刻やレーンのずれ・片方にしかない予約を返す
     */
    public static function compare(string $from, string $to): array
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $from > $to) {
            throw new StoreError('invalid', '期間を正しく入力してください');
        }
        if ((new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days > 62) {
            throw new StoreError('invalid', '一度に照合できるのは62日までです');
        }
        return Store::airCompare(self::fetchRange($from, $to), $from, $to);
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
            throw new StoreError('invalid', 'Airリザーブのログイン画面を読み込めませんでした');
        }
        $fields = [];
        foreach ($form->getElementsByTagName('input') as $i) {
            if ($i->getAttribute('name') !== '') {
                $fields[$i->getAttribute('name')] = $i->getAttribute('value');
            }
        }
        if (($fields['captchaRequired'] ?? '0') !== '0' && ($fields['captchaRequired'] ?? '') !== '') {
            throw new StoreError('invalid', 'Airリザーブで画像認証が求められています。一度ブラウザでログインしてから、もう一度お試しください');
        }
        $fields['username'] = $id;
        $fields['password'] = $pw;
        $action = $form->getAttribute('action');
        $target = preg_match('#^https://#', $action) ? $action : (str_starts_with($action, '/') ? preg_replace('#^(https://[^/]+).*$#', '$1', $url) . $action : $url);
        [$code, , $after] = self::req('POST', $target, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($fields));
        if (!str_starts_with($after, self::BASE . '/')) {
            throw new StoreError('invalid', 'Airリザーブにログインできませんでした（ID・パスワードを確認してください）');
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
            throw new StoreError('invalid', 'Airリザーブに接続できませんでした');
        }
        return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), (string) $out, (string) curl_getinfo($ch, CURLINFO_EFFECTIVE_URL)];
    }
}
