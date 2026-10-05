<?php
declare(strict_types=1);

/** 日付・時刻（日本時間、夏時間なし）。Node.js 版 time.ts と同じ */
function jst(): DateTimeZone
{
    static $tz = null;
    return $tz ??= new DateTimeZone('+09:00');
}

function is_date_string(mixed $s): bool
{
    if (!is_string($s) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
        return false;
    }
    [$y, $m, $d] = array_map('intval', explode('-', $s));
    return checkdate($m, $d, $y);
}

function is_iso_datetime(mixed $s): bool
{
    return is_string($s)
        && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/', $s) === 1
        && strtotime($s) !== false;
}

function parse_ms(string $iso): int
{
    $d = new DateTimeImmutable($iso);
    return (int) $d->format('U') * 1000 + intdiv((int) $d->format('u'), 1000);
}

function clinic_date_of(string $iso): string
{
    return (new DateTimeImmutable($iso))->setTimezone(jst())->format('Y-m-d');
}

function minutes_of_day(string $iso): int
{
    $d = (new DateTimeImmutable($iso))->setTimezone(jst());
    return (int) $d->format('G') * 60 + (int) $d->format('i');
}

function to_iso(string $date, int $minutes): string
{
    $d = (new DateTimeImmutable($date . 'T00:00:00+09:00'))->modify(($minutes >= 0 ? '+' : '') . $minutes . ' minutes');
    return $d->setTimezone(jst())->format('Y-m-d\TH:i:s') . '+09:00';
}

/** どんな形のISO文字列でも日本時間の "YYYY-MM-DDTHH:mm:ss+09:00"（秒は切り捨て）にそろえる */
function normalize_iso(string $iso): string
{
    return to_iso(clinic_date_of($iso), minutes_of_day($iso));
}

/** @return array{date: string, minutes: int} */
function now_in_clinic(): array
{
    $d = new DateTimeImmutable('now', jst());
    return ['date' => $d->format('Y-m-d'), 'minutes' => (int) $d->format('G') * 60 + (int) $d->format('i')];
}

function now_iso(): string
{
    // JavaScript の toISOString() と同じ形（UTC・ミリ秒3桁）
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

function format_date_ja(string $date): string
{
    $d = new DateTimeImmutable($date . 'T00:00:00+09:00');
    $w = ['日', '月', '火', '水', '木', '金', '土'][(int) $d->format('w')];
    return (int) $d->format('n') . '/' . (int) $d->format('j') . "({$w})";
}

/** "YYYY-MM-DD" に日数を足す */
function add_days(string $date, int $days): string
{
    return (new DateTimeImmutable($date . 'T00:00:00Z'))->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
}
