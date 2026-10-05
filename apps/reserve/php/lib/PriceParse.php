<?php
declare(strict_types=1);

/**
 * ホームページの料金表（HTML の表）から料金を読み取る。Node.js 版（src/lib/domain/priceParse.ts）と同じ手順。
 */
final class PriceParse
{
    private static function decode(string $s): string
    {
        $s = (string) preg_replace_callback('/&#(\d+);/', fn($m) => mb_chr((int) $m[1], 'UTF-8'), $s);
        $s = (string) preg_replace_callback('/&#x([0-9a-f]+);/i', fn($m) => mb_chr((int) hexdec($m[1]), 'UTF-8'), $s);
        $map = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', '#039' => "'", 'apos' => "'", 'nbsp' => ' '];
        return (string) preg_replace_callback('/&([a-z0-9#]+);/i', fn($m) => $map[strtolower($m[1])] ?? $m[0], $s);
    }

    /** タグを除いた文字（<br> は区切り記号 \n にする） */
    private static function text(string $html): string
    {
        $s = self::decode((string) preg_replace('/<[^>]*>/', '', (string) preg_replace('/<br\s*\/?>/i', "\n", $html)));
        $lines = [];
        foreach (explode("\n", $s) as $l) {
            $l = trim((string) preg_replace('/[\s\x{3000}]+/u', ' ', $l));
            if ($l !== '') {
                $lines[] = $l;
            }
        }
        return implode("\n", $lines);
    }

    private static function oneLine(string $s): string
    {
        return str_replace("\n", ' ', $s);
    }

    /** "11,000円" → 11000。範囲・足し算・割合・ASK などは null */
    public static function parseYen(string $t): ?int
    {
        if (preg_match('/[〜～~＋+％%]/u', $t)) {
            return null;
        }
        if (!preg_match('/([0-9][0-9,，]*)\s*円/u', $t, $m)) {
            return null;
        }
        $digits = str_replace([',', '，'], '', $m[1]);
        return strlen($digits) <= 15 ? (int) $digits : null;
    }

    /** @return array<int, array{html: string, th: bool}> */
    private static function cells(string $rowHtml): array
    {
        preg_match_all('/<(t[dh])\b[^>]*>(.*?)<\/\1>/is', $rowHtml, $m, PREG_SET_ORDER);
        return array_map(fn($x) => ['html' => $x[2], 'th' => strtolower($x[1]) === 'th'], $m);
    }

    private static function headingBefore(string $before): string
    {
        $last = '';
        if (preg_match_all('/<h[2-4]\b[^>]*>(.*?)<\/h[2-4]>/is', $before, $m)) {
            $last = self::oneLine(self::text(end($m[1])));
        }
        return $last;
    }

    private static function taxExcludedBefore(string $before): bool
    {
        $plain = self::text((string) preg_replace('/<(script|style)\b.*?<\/\1>/is', '', $before));
        $ex = mb_strrpos($plain, '税抜');
        $in = mb_strrpos($plain, '税込');
        return ($ex === false ? -1 : $ex) > ($in === false ? -1 : $in);
    }

    /** @return array<int, array{category: string, name: string, priceYen: ?int, priceText: string}> */
    public static function parse(string $html): array
    {
        $out = [];
        preg_match_all('/<table\b[^>]*>(.*?)<\/table>/is', $html, $tables, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($tables as $tm) {
            $body = $tm[1][0];
            if (!str_contains($body, '円')) {
                continue;
            }
            $before = substr($html, 0, $tm[0][1]);
            $heading = self::headingBefore($before);
            $excluded = self::taxExcludedBefore($before);
            $push = function (string $category, string $name, string $priceRaw) use (&$out, $heading, $excluded) {
                $t = self::oneLine(self::text($priceRaw));
                $n = trim(self::oneLine($name));
                if ($n === '' || $t === '') {
                    return;
                }
                $yen = self::parseYen($t);
                $out[] = [
                    'category' => $category !== '' ? $category : $heading,
                    'name' => $n,
                    'priceYen' => $yen === null ? null : ($excluded ? intdiv($yen * 11, 10) : $yen),
                    'priceText' => $excluded ? "税抜 {$t}" : $t,
                ];
            };

            preg_match_all('/<tr\b[^>]*>(.*?)<\/tr>/is', $body, $rm);
            $rows = array_map([self::class, 'cells'], $rm[1]);
            if (!$rows) {
                continue;
            }
            $first = $rows[0];
            $allTh = $first !== [] && count(array_filter($first, fn($c) => $c['th'])) === count($first);
            $noYen = $first !== [] && count(array_filter($first, function ($c) {
                $t = self::text($c['html']);
                return !str_contains($t, '円') && !str_starts_with($t, '■');
            })) === count($first);
            $isHeader = count($first) >= 2 && ($allTh || $noYen);
            if ($isHeader && count($first) >= 3) {
                $heads = array_map(fn($c) => self::oneLine(self::text($c['html'])), $first);
                $pairs = count($heads) % 2 === 0;
                foreach ($heads as $i => $h) {
                    if ($h !== $heads[$i % 2]) {
                        $pairs = false;
                    }
                }
                foreach (array_slice($rows, 1) as $row) {
                    if ($pairs) {
                        for ($i = 0; $i + 1 < count($row); $i += 2) {
                            $push($heading, self::text($row[$i]['html']), $row[$i + 1]['html']);
                        }
                        continue;
                    }
                    $label = self::oneLine(self::text($row[0]['html'] ?? ''));
                    // 列をまとめた行（例：針代｜4,000円／1本）は見出しを付けない
                    if (count($row) < count($heads)) {
                        if (isset($row[1])) {
                            $push($heading, $label, $row[1]['html']);
                        }
                        continue;
                    }
                    for ($i = 1; $i < count($row); $i++) {
                        $push($heading, ($heads[$i] ?? '') !== '' ? "{$label} {$heads[$i]}" : $label, $row[$i]['html']);
                    }
                }
                continue;
            }

            // 2列の表：分類（■）・小見出し・項目
            $category = '';
            $sub = '';
            foreach ($isHeader ? array_slice($rows, 1) : $rows as $row) {
                if (!$row) {
                    continue;
                }
                $label = self::text($row[0]['html']);
                $price = isset($row[1]) ? self::oneLine(self::text($row[1]['html'])) : '';
                $lines = explode("\n", $label);
                $isCat = str_starts_with($lines[0], '■');
                if ($isCat) {
                    $category = trim((string) preg_replace('/^■+/u', '', $lines[0]));
                    $sub = self::oneLine(implode(' ', array_slice($lines, 1)));
                    if ($price === '') {
                        continue;
                    }
                }
                if ($price === '') {
                    // 値段のない短い行は小見出し。長い行は説明なので飛ばす
                    if (mb_strlen($label) <= 25) {
                        $sub = self::oneLine($label);
                    }
                    continue;
                }
                $name = $isCat ? ($sub !== '' ? $sub : $category) : ($sub !== '' ? "{$sub} " . self::oneLine($label) : self::oneLine($label));
                $push($category, $name, $row[1]['html']);
            }
        }
        return $out;
    }
}
