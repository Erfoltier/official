<?php
declare(strict_types=1);

/**
 * 日本の祝日（src/lib/domain/holidays.ts と同じ計算。2022〜2099年向け）。
 * 振替休日と国民の休日も含む。春分・秋分の日は近似式
 */
final class Holidays
{
    private static array $cache = [];

    /** @return array<string,string> 'YYYY-MM-DD' => 名前 */
    public static function of(int $y): array
    {
        if (isset(self::$cache[$y])) {
            return self::$cache[$y];
        }
        $dow = fn(int $m, int $d): int => (int) gmdate('w', gmmktime(0, 0, 0, $m, $d, $y));
        $nthMonday = fn(int $m, int $n): int => 1 + ((8 - $dow($m, 1)) % 7) + ($n - 1) * 7;
        $equinox = fn(float $base): int => (int) floor($base + 0.242194 * ($y - 1980) - floor(($y - 1980) / 4));
        $base = [
            [1, 1, '元日'], [1, $nthMonday(1, 2), '成人の日'], [2, 11, '建国記念の日'], [2, 23, '天皇誕生日'],
            [3, $equinox(20.8431), '春分の日'], [4, 29, '昭和の日'], [5, 3, '憲法記念日'], [5, 4, 'みどりの日'],
            [5, 5, 'こどもの日'], [7, $nthMonday(7, 3), '海の日'], [8, 11, '山の日'], [9, $nthMonday(9, 3), '敬老の日'],
            [9, $equinox(23.2488), '秋分の日'], [10, $nthMonday(10, 2), 'スポーツの日'], [11, 3, '文化の日'], [11, 23, '勤労感謝の日'],
        ];
        $out = [];
        foreach ($base as [$m, $d, $name]) {
            $out[sprintf('%04d-%02d-%02d', $y, $m, $d)] = $name;
        }
        $next = fn(string $date): string => gmdate('Y-m-d', strtotime($date . ' 00:00:00 UTC') + 86400);
        $isSun = fn(string $date): bool => gmdate('w', strtotime($date . ' 00:00:00 UTC')) === '0';
        $sorted = array_keys($out);
        sort($sorted);
        // 国民の休日：前後が祝日の平日
        foreach ($sorted as $date) {
            $mid = $next($date);
            if (!isset($out[$mid]) && isset($out[$next($mid)]) && !$isSun($mid)) {
                $out[$mid] = '国民の休日';
            }
        }
        // 振替休日：日曜の祝日のあと、最初の祝日でない日
        $sorted = array_keys($out);
        sort($sorted);
        foreach ($sorted as $date) {
            if (!$isSun($date)) {
                continue;
            }
            $d = $next($date);
            while (isset($out[$d])) {
                $d = $next($d);
            }
            if (str_starts_with($d, (string) $y)) {
                $out[$d] = '振替休日';
            }
        }
        return self::$cache[$y] = $out;
    }

    public static function is(string $date): bool
    {
        return isset(self::of((int) substr($date, 0, 4))[$date]);
    }
}
