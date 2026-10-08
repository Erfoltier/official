<?php
declare(strict_types=1);

/**
 * リマインド（前日・当日朝のお知らせ）。設計は docs/saas-plan.md の第7章。
 * - 来院ごとに1通（同じ患者・同じ日の予約、または同じ visitId の予約を1回の来院とみなす）
 * - 送り先は患者の「連絡先の希望」（auto＝LINE がつながっていれば LINE、なければメール）
 * - LINE は送る前に今月の残り通数を確かめ、残しておく通数を下回るならメールに回す
 * - 同じ来院・同じ回・同じ時刻には二度送らない（reminderLog）。本文は残さない
 * - 院の設定で「有効」にするまで、自動では送らない
 */
final class Reminder
{
    private const LINE_API = 'https://api.line.me/v2/bot';
    private const DEFAULT_TEMPLATE = "{患者名} 様\n\n{院名}です。{いつ}のご予約のお知らせです。\n\n日時：{日付} {時刻}\n\n表示の時刻はご来院の目安です。ご変更・キャンセルは、ご予約いただいた方法（LINE・お電話など）でご連絡ください。";

    /** 試験用：送信を差し替える（null なら本当に送る） */
    public static $transport = null;

    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'prevTime' => '18:00',
            'dayTime' => '08:00',
            'useLine' => true,
            'useEmail' => true,
            'fromEmail' => '',
            'fromName' => '',
            'replyTo' => '',
            'lineReserve' => 20,
            'template' => self::DEFAULT_TEMPLATE,
        ];
    }

    public static function settings(): array
    {
        $s = Db::i()->meta('reminderSettings');
        return [...self::defaults(), ...(is_array($s) ? $s : [])];
    }

    private static function lineToken(): string
    {
        $s = Db::i()->meta('reminderSecrets');
        return is_array($s) ? (string) ($s['lineToken'] ?? '') : '';
    }

    /** 画面に出す設定（鍵そのものは出さない） */
    public static function publicSettings(): array
    {
        $s = self::settings();
        $last = Db::i()->meta('reminderLastRun');
        return [
            ...$s,
            'lineConfigured' => self::lineToken() !== '',
            'defaultTemplate' => self::DEFAULT_TEMPLATE,
            'lastRun' => is_array($last) ? $last : null,
            'lineRemaining' => self::lineToken() !== '' ? self::lineRemaining() : null,
        ];
    }

    public static function updateSettings(array $in, array $by): array
    {
        $next = self::settings();
        $time = function (mixed $v, string $label): ?string {
            if ($v === null || $v === '') {
                return null;
            }
            if (!is_string($v) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
                throw new StoreError('invalid', "{$label}は 18:00 のように入れてください");
            }
            return $v;
        };
        if (array_key_exists('enabled', $in)) {
            $next['enabled'] = (bool) $in['enabled'];
        }
        if (array_key_exists('prevTime', $in)) {
            $next['prevTime'] = $time($in['prevTime'], '前日に送る時刻');
        }
        if (array_key_exists('dayTime', $in)) {
            $next['dayTime'] = $time($in['dayTime'], '当日に送る時刻');
        }
        foreach (['useLine', 'useEmail'] as $k) {
            if (array_key_exists($k, $in)) {
                $next[$k] = (bool) $in[$k];
            }
        }
        foreach (['fromEmail' => '送信元のメール', 'replyTo' => '返信先のメール'] as $k => $label) {
            if (array_key_exists($k, $in)) {
                $v = trim((string) $in[$k]);
                if ($v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
                    throw new StoreError('invalid', "{$label}の形が正しくありません");
                }
                $next[$k] = $v;
            }
        }
        if (array_key_exists('fromName', $in)) {
            $next['fromName'] = mb_substr(preg_replace('/[\r\n<>"]/u', '', (string) $in['fromName']) ?? '', 0, 40);
        }
        if (array_key_exists('lineReserve', $in)) {
            $next['lineReserve'] = max(0, min(10000, (int) $in['lineReserve']));
        }
        if (array_key_exists('template', $in)) {
            $t = trim(str_replace("\r\n", "\n", (string) $in['template']));
            if ($t === '') {
                $t = self::DEFAULT_TEMPLATE;
            }
            if (mb_strlen($t) > 2000) {
                throw new StoreError('invalid', '文面は2000文字以内にしてください');
            }
            $next['template'] = $t;
        }
        Db::i()->setMeta('reminderSettings', $next);
        // LINE の鍵：文字が来たら入れ替え、空文字なら消す、来なければそのまま
        if (array_key_exists('lineToken', $in)) {
            $tok = trim((string) $in['lineToken']);
            if ($tok !== '' && !preg_match('/^[A-Za-z0-9+\/=._-]{20,1000}$/', $tok)) {
                throw new StoreError('invalid', 'LINE のチャネルアクセストークンの形が正しくありません');
            }
            Db::i()->setMeta('reminderSecrets', ['lineToken' => $tok]);
            Auth::audit($by, $tok === '' ? 'リマインドの LINE の鍵を消した' : 'リマインドの LINE の鍵を入れた');
        }
        Auth::audit($by, 'リマインドの設定を変更');
        return self::publicSettings();
    }

    // ---- 来院のまとまり ----

    /** その日の来院（確定済み・キャンセルでない予約を、visitId か 患者ごとにまとめる） */
    public static function visitsOn(string $date): array
    {
        $day = Store::getDayBundle($date);
        $patients = array_column($day['patients'], null, 'id');
        $menus = array_column($day['menus'], null, 'id');
        $visits = [];
        foreach ($day['reservations'] as $r) {
            if (in_array($r['status'], Store::INACTIVE, true) || ($r['confirmation'] ?? 'confirmed') === 'pending') {
                continue;
            }
            $p = $patients[$r['patientId']] ?? null;
            if (!$p || !empty($p['deleted'])) {
                continue;
            }
            $key = $date . '|' . ($r['visitId'] ?? $r['patientId']);
            $v = $visits[$key] ?? ['key' => $key, 'date' => $date, 'patient' => $p, 'reservations' => [], 'menuNames' => [], 'arrivalAt' => null, 'createdAt' => null];
            $v['reservations'][] = $r;
            $arrival = $r['arrivalAt'] ?? $r['startAt'];
            if ($v['arrivalAt'] === null || strcmp($arrival, $v['arrivalAt']) < 0) {
                $v['arrivalAt'] = $arrival;
            }
            if ($v['createdAt'] === null || strcmp($r['createdAt'], $v['createdAt']) < 0) {
                $v['createdAt'] = $r['createdAt'];
            }
            foreach ($r['menuIds'] as $mid) {
                $n = $menus[$mid]['publicName'] ?? $menus[$mid]['name'] ?? '';
                if ($n !== '' && !in_array($n, $v['menuNames'], true)) {
                    $v['menuNames'][] = $n;
                }
            }
            $visits[$key] = $v;
        }
        return array_values($visits);
    }

    // ---- 自動実行（通信のついで・cron） ----

    /**
     * 決まった時刻を過ぎていたら送る。何度呼んでも、同じ来院・同じ回には二度送らない。
     * 通信のついでに呼ばれるので、5分に1回しか中身を見ない（$force で即時）
     */
    public static function tick(bool $force = false): array
    {
        $s = self::settings();
        if (!$s['enabled']) {
            return ['ran' => false, 'reason' => 'disabled'];
        }
        $db = Db::i();
        $nowTs = time();
        $lock = $db->meta('reminderLock');
        if (!$force && is_array($lock) && $nowTs - (int) ($lock['ts'] ?? 0) < 300) {
            return ['ran' => false, 'reason' => 'throttled'];
        }
        $db->setMeta('reminderLock', ['ts' => $nowTs]);
        @set_time_limit(120);
        $now = now_in_clinic();
        $min = fn(?string $hm) => $hm === null ? null : ((int) substr($hm, 0, 2)) * 60 + (int) substr($hm, 3, 2);
        $result = ['ran' => true, 'prev' => null, 'day' => null];
        $quota = ['remaining' => null, 'checked' => false];
        // 前日：決めた時刻〜21時のあいだに、明日の来院へ
        $prev = $min($s['prevTime']);
        if ($prev !== null && $now['minutes'] >= $prev && $now['minutes'] < 21 * 60) {
            $tomorrow = (new DateTimeImmutable($now['date'], jst()))->modify('+1 day')->format('Y-m-d');
            $result['prev'] = self::runRound('prev', $tomorrow, $quota);
        }
        // 当日：決めた時刻〜20時のあいだに、今日のまだ先の来院へ（今日とった予約には送らない）
        $day = $min($s['dayTime']);
        if ($day !== null && $now['minutes'] >= $day && $now['minutes'] < 20 * 60) {
            $result['day'] = self::runRound('day', $now['date'], $quota, $now['minutes'] + 30);
        }
        $db->setMeta('reminderLastRun', ['at' => now_iso(), 'prev' => $result['prev'], 'day' => $result['day']]);
        return $result;
    }

    /** @param int|null $afterMinute 当日の回：この時刻（分）より後に来院する人だけ */
    private static function runRound(string $round, string $date, array &$quota, ?int $afterMinute = null): array
    {
        $count = ['sent' => 0, 'skipped' => 0, 'failed' => 0];
        foreach (self::visitsOn($date) as $v) {
            if ($afterMinute !== null && minutes_of_day($v['arrivalAt']) <= $afterMinute) {
                continue;
            }
            if ($round === 'day' && clinic_date_of((string) $v['createdAt']) === $date) {
                continue;
            }
            $logId = hash('sha256', $v['key'] . '|' . $round . '|' . $v['arrivalAt']);
            if (Db::i()->get('reminderLog', $logId) !== null) {
                continue;
            }
            $r = self::deliver($v, $round, $quota, false);
            Db::i()->put('reminderLog', $logId, ['at' => now_iso(), 'date' => $date, 'round' => $round, 'channel' => $r['channel'], 'result' => $r['status'], 'reason' => $r['reason'] ?? null]);
            $count[$r['status']]++;
        }
        return $count;
    }

    /** スタッフが「今すぐ送る」：その予約の来院へ。不要の印があっても送る（スタッフの判断） */
    public static function sendNow(string $reservationId, array $by): array
    {
        $r = Db::i()->get('reservation', $reservationId);
        if (!$r) {
            throw new StoreError('not_found', '予約が見つかりません');
        }
        $date = clinic_date_of($r['startAt']);
        $key = $date . '|' . ($r['visitId'] ?? $r['patientId']);
        $visit = null;
        foreach (self::visitsOn($date) as $v) {
            if ($v['key'] === $key) {
                $visit = $v;
            }
        }
        if ($visit === null) {
            throw new StoreError('invalid', 'キャンセル・承認待ちの予約には送れません');
        }
        $quota = ['remaining' => null, 'checked' => false];
        $round = $date === now_in_clinic()['date'] ? 'day' : 'prev';
        $res = self::deliver($visit, $round, $quota, true);
        Auth::audit($by, 'リマインドを手動で送信（' . ($res['channel'] ?? 'なし') . '・' . $res['status'] . '）', $r['patientId']);
        if ($res['status'] !== 'sent') {
            throw new StoreError('invalid', self::reasonText($res['reason'] ?? ''));
        }
        return $res;
    }

    public static function reasonText(string $reason): string
    {
        return match ($reason) {
            'optout' => 'この患者は「リマインド不要」です',
            'no_contact' => '送り先がありません（LINE のつながり・メールアドレス・送信の設定を確かめてください）',
            'line_quota' => 'LINE の今月の残り通数が少ないため送りませんでした',
            default => '送れませんでした' . ($reason !== '' ? "（{$reason}）" : ''),
        };
    }

    /** 1つの来院へ送る。送り先を順に試し、予約の reminder を書き換える */
    private static function deliver(array $v, string $round, array &$quota, bool $manual): array
    {
        $s = self::settings();
        $p = $v['patient'];
        $pref = $p['contactPref'] ?? 'auto';
        if (!$manual && (!empty($p['reminderOptOut']) || $pref === 'none')) {
            return self::mark($v, ['status' => 'skipped', 'channel' => null, 'reason' => 'optout'], $round);
        }
        $order = $pref === 'email' ? ['email', 'line'] : ['line', 'email'];
        $lastError = 'no_contact';
        foreach ($order as $ch) {
            if ($ch === 'line') {
                if (!$s['useLine'] || self::lineToken() === '' || empty($p['lineUserId'])) {
                    continue;
                }
                if (!$quota['checked']) {
                    $quota['remaining'] = self::lineRemaining();
                    $quota['checked'] = true;
                }
                if ($quota['remaining'] !== null && $quota['remaining'] <= (int) $s['lineReserve']) {
                    $lastError = 'line_quota';
                    continue;
                }
                [$ok, $err] = self::pushLine((string) $p['lineUserId'], self::compose($v, $round, 'line')['text']);
                if ($ok) {
                    if ($quota['remaining'] !== null) {
                        $quota['remaining']--;
                    }
                    return self::mark($v, ['status' => 'sent', 'channel' => 'line'], $round);
                }
                $lastError = $err;
            } else {
                if (!$s['useEmail'] || $s['fromEmail'] === '' || empty($p['email']) || !filter_var($p['email'], FILTER_VALIDATE_EMAIL)) {
                    continue;
                }
                $m = self::compose($v, $round, 'email');
                [$ok, $err] = self::sendMail((string) $p['email'], $m['subject'], $m['text']);
                if ($ok) {
                    return self::mark($v, ['status' => 'sent', 'channel' => 'email'], $round);
                }
                $lastError = $err;
            }
        }
        $status = in_array($lastError, ['no_contact', 'line_quota'], true) ? 'skipped' : 'failed';
        return self::mark($v, ['status' => $status, 'channel' => null, 'reason' => $lastError], $round);
    }

    /** 同じ来院の予約すべてに、リマインドの状態を書く（予約の版は上げない＝画面の編集とぶつからない） */
    private static function mark(array $v, array $res, string $round): array
    {
        $now = now_iso();
        foreach ($v['reservations'] as $r) {
            $cur = Db::i()->get('reservation', $r['id']);
            if (!$cur) {
                continue;
            }
            $cur['reminder'] = array_filter(['status' => $res['status'], 'updatedAt' => $now, 'channel' => $res['channel'], 'round' => $round, 'reason' => $res['reason'] ?? null], fn($x) => $x !== null);
            Db::i()->put('reservation', $r['id'], $cur);
        }
        return $res;
    }

    // ---- 文面 ----

    public static function compose(array $v, string $round, string $channel): array
    {
        $s = self::settings();
        $clinic = Store::clinic();
        $d = (new DateTimeImmutable($v['arrivalAt']))->setTimezone(jst());
        $week = ['日', '月', '火', '水', '木', '金', '土'][(int) $d->format('w')];
        $vars = [
            '{患者名}' => (string) $v['patient']['name'],
            '{院名}' => (string) ($clinic['docName'] ?? '') ?: (string) $clinic['name'],
            '{院の電話}' => (string) ($clinic['phone'] ?? ''),
            '{いつ}' => $round === 'day' ? '本日' : '明日',
            '{日付}' => $d->format('n') . '月' . $d->format('j') . "日（{$week}）",
            '{時刻}' => $d->format('G:i'),
            '{メニュー}' => implode('・', $v['menuNames']),
        ];
        $text = strtr((string) $s['template'], $vars);
        return ['subject' => '【' . $vars['{院名}'] . '】' . $vars['{いつ}'] . 'のご予約のお知らせ', 'text' => $text];
    }

    // ---- 送信 ----

    private static function http(string $method, string $url, array $headers, ?string $body): array
    {
        if (self::$transport !== null) {
            return (self::$transport)($method, $url, $headers, $body);
        }
        $ctx = stream_context_create(['http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body ?? '',
            'timeout' => 10,
            'ignore_errors' => true,
        ]]);
        $raw = @file_get_contents($url, false, $ctx);
        $line = is_array($http_response_header ?? null) ? (string) ($http_response_header[0] ?? '') : '';
        $code = preg_match('/\s(\d{3})\s/', $line, $m) ? (int) $m[1] : 0;
        return [$code, is_string($raw) ? $raw : ''];
    }

    private static function pushLine(string $to, string $text): array
    {
        $body = json_encode(['to' => $to, 'messages' => [['type' => 'text', 'text' => mb_substr($text, 0, 4900)]]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        // 再送しても二重に届かないよう、1通ごとに UUID（v4）を付ける
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $retryKey = vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
        [$code, $raw] = self::http('POST', self::LINE_API . '/message/push', [
            'Content-Type: application/json',
            'Authorization: Bearer ' . self::lineToken(),
            'X-Line-Retry-Key: ' . $retryKey,
        ], $body);
        if ($code === 200) {
            return [true, null];
        }
        // 患者情報を含まない理由だけを残す
        return [false, $code === 429 ? 'line_limit' : ($code === 401 ? 'line_token' : 'line_' . $code)];
    }

    /** 今月あと何通 LINE で送れるか（わからなければ null） */
    private static function lineRemaining(): ?int
    {
        $h = ['Authorization: Bearer ' . self::lineToken()];
        [$c1, $q] = self::http('GET', self::LINE_API . '/message/quota', $h, null);
        [$c2, $u] = self::http('GET', self::LINE_API . '/message/quota/consumption', $h, null);
        if ($c1 !== 200 || $c2 !== 200) {
            return null;
        }
        $q = json_decode($q, true);
        $u = json_decode($u, true);
        if (!is_array($q) || !is_array($u) || ($q['type'] ?? '') !== 'limited') {
            return null;
        }
        return max(0, (int) ($q['value'] ?? 0) - (int) ($u['totalUsage'] ?? 0));
    }

    private static function sendMail(string $to, string $subject, string $text): array
    {
        $s = self::settings();
        $from = $s['fromEmail'];
        $name = $s['fromName'] !== '' ? $s['fromName'] : (string) Store::clinic()['name'];
        $headers = ['From: ' . mb_encode_mimeheader($name, 'UTF-8') . " <{$from}>"];
        if ($s['replyTo'] !== '') {
            $headers[] = 'Reply-To: ' . $s['replyTo'];
        }
        if (self::$transport !== null) {
            [$code] = (self::$transport)('MAIL', $to, $headers, $subject . "\n\n" . $text);
            return $code === 200 ? [true, null] : [false, 'mail_failed'];
        }
        mb_language('uni');
        $ok = @mb_send_mail($to, $subject, $text, implode("\r\n", $headers), '-f' . $from);
        return $ok ? [true, null] : [false, 'mail_failed'];
    }
}
