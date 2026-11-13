<?php
/**
 * ホームページのトップに載る「特別診療日」（例「1月5日（火）・11日（月）」）を1日1回読み、予約申請フォームで選べる日に足す（院長の指示 2026-11-13）。
 * - 読む先は 設定 → 院の情報 の「ホームページ」のアドレス。空なら何もしない
 * - リマインドの定期実行（cron/reminders.php）のついでに、その日まだ読んでいなければ読む。新しい仕組みは足さない
 * - 年は、今日より前の月なら翌年。書いてある曜日と合わない日は取り込まず、設定画面に出す
 * - 読めなかったときは、前回読めた日をそのまま使い、設定画面に「読めませんでした」と出す
 * - 設定画面に手で入れた日は消さない（フォームに出す日は「設定の曜日」「手で入れた日」「ここで読んだ日」。祝日は自動では足さない）
 */
declare(strict_types=1);

final class HomepageDays
{
    /** 試験用：($url) => [status, body] */
    public static $transport = null;

    public static function status(): array
    {
        $s = Db::i()->meta('homepageSpecialDays');
        return is_array($s) ? $s : ['url' => '', 'dates' => [], 'skipped' => []];
    }

    /** 今日以降の、ホームページから読んだ日 */
    public static function dates(?string $today = null): array
    {
        $today ??= now_in_clinic()['date'];
        return array_values(array_filter((array) (self::status()['dates'] ?? []), fn($d) => is_string($d) && $d >= $today));
    }

    /** 予約申請フォームで選べる特別診療日（手で入れた日＋ホームページから読んだ日） */
    public static function intakeDates(): array
    {
        $all = array_values(array_unique([...Store::publicInfo()['intakeSpecialDates'], ...self::dates()]));
        sort($all);
        return $all;
    }

    /** cron から：その日まだ読んでいなければ読む */
    public static function tick(bool $force = false): ?array
    {
        $url = trim(Store::publicInfo()['homepageUrl'] ?? '');
        if ($url === '' || !str_starts_with($url, 'https://')) {
            return null;
        }
        $prev = self::status();
        $today = now_in_clinic()['date'];
        if (!$force && ($prev['url'] ?? '') === $url && substr((string) ($prev['checkedAt'] ?? ''), 0, 10) === $today) {
            return null;
        }
        $now = now_iso();
        try {
            [$code, $html] = self::$transport !== null ? (self::$transport)($url) : self::fetch($url);
            if ($code !== 200) {
                throw new RuntimeException("ホームページを読めませんでした（{$code}）");
            }
            $r = self::parse((string) $html, $today);
            if (!$r['found']) {
                throw new RuntimeException('ホームページに「特別診療日」の欄が見つかりませんでした');
            }
            $next = ['url' => $url, 'at' => $now, 'checkedAt' => $now, 'dates' => $r['dates'], 'skipped' => $r['skipped']];
        } catch (Throwable $e) {
            $next = [...$prev, 'url' => $url, 'checkedAt' => $now, 'error' => $e instanceof RuntimeException ? $e->getMessage() : 'ホームページを読めませんでした'];
            if (($prev['url'] ?? '') !== $url) {
                $next['dates'] = [];
                $next['skipped'] = [];
            }
        }
        if (!isset($next['error'])) {
            unset($next['error']);
        }
        Db::i()->setMeta('homepageSpecialDays', $next);
        return $next;
    }

    /**
     * 「特別診療日」の見出しのあとの「M月D日（曜）」を拾う。
     * @return array{found: bool, dates: string[], skipped: string[]}
     */
    public static function parse(string $html, string $today): array
    {
        $html = preg_replace('#<(script|style)\b[\s\S]*?</\1>#i', '', $html) ?? '';
        $ty = (int) substr($today, 0, 4);
        $tm = (int) substr($today, 5, 2);
        $pos = mb_strpos($html, '特別診療日');
        $found = false;
        while ($pos !== false) {
            $chunk = mb_substr($html, $pos, 3000);
            $end = mb_stripos($chunk, '</section>');
            $chunk = $end !== false ? mb_substr($chunk, 0, $end) : $chunk;
            $text = mb_convert_kana(html_entity_decode(strip_tags($chunk), ENT_QUOTES, 'UTF-8'), 'nas');
            if (preg_match_all('/(?:(\d{1,2})\s*月)?\s*(\d{1,2})\s*日\s*(?:[（(]\s*([日月火水木金土])\s*[)）])?/u', $text, $m, PREG_SET_ORDER)) {
                $found = true;
                $month = 0;
                $dates = [];
                $skipped = [];
                foreach ($m as $x) {
                    if (($x[1] ?? '') !== '') {
                        $month = (int) $x[1];
                    }
                    $day = (int) $x[2];
                    if ($month < 1 || $month > 12 || $day < 1 || $day > 31) {
                        continue;
                    }
                    $y = $month < $tm ? $ty + 1 : $ty;
                    if (!checkdate($month, $day, $y)) {
                        $skipped[] = "{$month}月{$day}日（日付がありません）";
                        continue;
                    }
                    $iso = sprintf('%04d-%02d-%02d', $y, $month, $day);
                    $w = ($x[3] ?? '') !== '' ? $x[3] : null;
                    $real = ['日', '月', '火', '水', '木', '金', '土'][(int) (new DateTimeImmutable($iso . 'T00:00:00+09:00'))->format('w')];
                    if ($w !== null && $w !== $real) {
                        $skipped[] = "{$month}月{$day}日（{$w}）※実際は{$real}曜日";
                        continue;
                    }
                    $dates[] = $iso;
                }
                if ($dates || $skipped) {
                    $dates = array_values(array_unique($dates));
                    sort($dates);
                    return ['found' => true, 'dates' => $dates, 'skipped' => array_values(array_unique($skipped))];
                }
            }
            $pos = mb_strpos($html, '特別診療日', $pos + 5);
            $found = $found || $pos !== false;
        }
        return ['found' => mb_strpos($html, '特別診療日') !== false, 'dates' => [], 'skipped' => []];
    }

    private static function fetch(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'lane-reserve-special-days',
        ]);
        $html = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($html) || strlen($html) > 3 * 1024 * 1024) {
            throw new RuntimeException('ホームページを読めませんでした');
        }
        return [$code, $html];
    }
}
