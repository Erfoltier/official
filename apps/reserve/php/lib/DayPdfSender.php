<?php
/**
 * 診療日（院長の指示：水曜と祝日だけ）の朝、その日の予約表を印刷用 PDF にして、パスワードを掛けてメールで院長に届ける。
 * サーバーや院のネットが止まったときの紙の控え。メールは リマインドと同じ SMTP（院のメールサーバー）で送る。
 * 設定は 設定 → バックアップ →「診療日の予約表 PDF」（院長・管理者）。パスワードは保存データの中で暗号化して置く。
 * 送るのは 7:00〜9:59 のあいだに、その日まだ送っていなければ1回（cron/reminders.php が10分ごとに呼ぶ）。
 */
declare(strict_types=1);

final class DayPdfSender
{
    public static function defaults(): array
    {
        return ['enabled' => false, 'to' => '', 'password' => '', 'weekdays' => [3], 'holidays' => true];
    }

    public static function settings(): array
    {
        return [...self::defaults(), ...((array) (Db::i()->meta('dayPdf') ?? []))];
    }

    /** 画面に返す形（パスワードは出さない） */
    public static function view(): array
    {
        $s = self::settings();
        unset($s['password']);
        return [...$s, 'passwordSet' => self::settings()['password'] !== '', 'lastSent' => Db::i()->meta('dayPdfSent'), 'qpdf' => self::qpdf() !== null];
    }

    public static function update(array $in, array $actor): array
    {
        $s = self::settings();
        if (array_key_exists('enabled', $in)) {
            $s['enabled'] = (bool) $in['enabled'];
        }
        if (array_key_exists('to', $in)) {
            $to = trim((string) $in['to']);
            if ($to !== '' && !filter_var($to, FILTER_VALIDATE_EMAIL)) {
                throw new StoreError('invalid', '送り先のメールアドレスの形が正しくありません');
            }
            $s['to'] = $to;
        }
        if (isset($in['password']) && (string) $in['password'] !== '') {
            if (mb_strlen((string) $in['password']) < 8) {
                throw new StoreError('invalid', 'PDF のパスワードは8文字以上にしてください');
            }
            $s['password'] = (string) $in['password'];
        }
        if (isset($in['weekdays']) && is_array($in['weekdays'])) {
            $s['weekdays'] = array_values(array_unique(array_filter(array_map('intval', $in['weekdays']), fn($d) => $d >= 0 && $d <= 6)));
        }
        if (array_key_exists('holidays', $in)) {
            $s['holidays'] = (bool) $in['holidays'];
        }
        if ($s['enabled'] && ($s['to'] === '' || $s['password'] === '')) {
            throw new StoreError('invalid', '送り先とパスワードを入れてから有効にしてください');
        }
        Db::i()->setMeta('dayPdf', $s);
        Auth::audit($actor, '診療日の予約表 PDF の設定を変更');
        return self::view();
    }

    /** その日が送る日か（指定の曜日・祝日、または予約申請フォームの特別診療日） */
    public static function isTarget(string $date, ?array $s = null): bool
    {
        $s ??= self::settings();
        $dow = (int) (new DateTimeImmutable($date . 'T00:00:00+09:00'))->format('w');
        return in_array($dow, $s['weekdays'], true)
            || ($s['holidays'] && Holidays::is($date))
            || in_array($date, Store::publicInfo()['intakeSpecialDates'], true);
    }

    private static function qpdf(): ?string
    {
        foreach (['/usr/bin/qpdf', '/usr/local/bin/qpdf'] as $p) {
            if (is_executable($p)) {
                return $p;
            }
        }
        return null;
    }

    /** PDF にパスワード（AES-256）を掛ける。開くとき・印刷するときに要る */
    public static function encrypt(string $pdf, string $password): string
    {
        $q = self::qpdf();
        if ($q === null) {
            throw new RuntimeException('qpdf がありません（sudo dnf install qpdf）');
        }
        $in = tempnam(sys_get_temp_dir(), 'dp');
        $out = $in . '.enc';
        file_put_contents($in, $pdf);
        try {
            $owner = bin2hex(random_bytes(16));
            $cmd = [$q, '--encrypt', $password, $owner, '256', '--', $in, $out];
            $p = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            stream_get_contents($pipes[1]);
            stream_get_contents($pipes[2]);
            $code = proc_close($p);
            if (!in_array($code, [0, 3], true) || !is_file($out)) {
                throw new RuntimeException('PDF にパスワードを掛けられませんでした');
            }
            return (string) file_get_contents($out);
        } finally {
            @unlink($in);
            @unlink($out);
        }
    }

    /** 作って送る（$force はテスト送信：曜日・時刻を見ない）。戻り値は結果 */
    public static function send(string $date, bool $force = false): array
    {
        $s = self::settings();
        if (!$force && (!$s['enabled'] || !self::isTarget($date, $s))) {
            return ['sent' => false, 'reason' => 'not_target'];
        }
        if ($s['to'] === '' || $s['password'] === '') {
            return ['sent' => false, 'reason' => 'not_configured'];
        }
        $day = Store::getDayBundle($date);
        $pub = Store::publicInfo();
        $dow = ['日', '月', '火', '水', '木', '金', '土'][(int) (new DateTimeImmutable($date . 'T00:00:00+09:00'))->format('w')];
        $title = sprintf('%s　%s（%s）の予約表', $pub['publicName'], str_replace('-', '/', $date), $dow);
        $pdf = self::encrypt(DayPdf::build($day, $title), $s['password']);
        $count = count(array_filter($day['reservations'], fn($r) => ($r['status'] ?? '') !== 'cancelled'));
        [$ok, $err] = Reminder::sendAttachment(
            $s['to'],
            "【LANE RESERVE】{$date} の予約表（障害時の印刷用）",
            "{$date} の予約表（{$count}件）を、パスワード付きの PDF でお送りします。\n"
            . "サーバーまたは院内ネットワークの障害時に、印刷してご利用ください。パスワードは院長が設定したものです。\n"
            . "このメールと添付は院外に転送しないでください。\n\nLANE RESERVE",
            "yoyaku-{$date}.pdf",
            $pdf,
            'application/pdf',
        );
        if ($ok) {
            Db::i()->setMeta('dayPdfSent', ['date' => $date, 'at' => now_iso(), 'count' => $count]);
        }
        return ['sent' => (bool) $ok, 'reason' => $err, 'count' => $count];
    }

    /** cron から：7:00〜9:59 のあいだに、送る日なら1回だけ送る */
    public static function tick(?DateTimeImmutable $now = null): ?array
    {
        $now ??= new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
        $h = (int) $now->format('G');
        if ($h < 7 || $h >= 10) {
            return null;
        }
        $date = $now->format('Y-m-d');
        if ((Db::i()->meta('dayPdfSent')['date'] ?? '') === $date) {
            return null;
        }
        return self::send($date);
    }
}
