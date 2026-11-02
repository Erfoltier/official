<?php
/**
 * その日の予約表を、印刷用の PDF にする（サーバーや院のネットが止まったときの紙の控え）。
 * 外部の部品を使わない最小限の PDF。文字は PDF 標準の日本語フォント（HeiseiKakuGo-W5、埋め込みなし）で、
 * Adobe Reader・Chrome・Edge・Mac のプレビューで日本語が出る。A4 横・時刻順・レーン・患者名・メニュー・メモ。
 * パスワードは qpdf（AES-256）で掛ける（DayPdfSender）。
 */
declare(strict_types=1);

final class DayPdf
{
    private const W = 842;   // A4 横（pt）
    private const H = 595;
    private const M = 32;
    private const ROW = 15;

    /** 文字列を PDF の文字（UTF-16BE の16進）に。BMP 外の文字は〓にする */
    private static function hex(string $s): string
    {
        $s = (string) preg_replace('/[\x{10000}-\x{10FFFF}]/u', '〓', $s);
        return strtoupper(bin2hex(mb_convert_encoding($s, 'UTF-16BE', 'UTF-8')));
    }

    /** だいたいの幅（全角 1、半角 0.5 文字）で切る */
    private static function cut(string $s, float $max): string
    {
        $s = trim((string) preg_replace('/\s+/u', ' ', $s));
        $w = 0.0;
        $out = '';
        foreach (mb_str_split($s) as $ch) {
            $cw = strlen($ch) === 1 ? 0.5 : 1.0;
            if ($w + $cw > $max) {
                return $out . '…';
            }
            $w += $cw;
            $out .= $ch;
        }
        return $out;
    }

    private static function text(float $x, float $y, float $size, string $s): string
    {
        return sprintf("BT /F1 %.1F Tf %.1F %.1F Td <%s> Tj ET\n", $size, $x, $y, self::hex($s));
    }

    /** $day は Store::getDayBundle の中身 */
    public static function build(array $day, string $title): string
    {
        $lanes = [];
        foreach ($day['lanes'] as $l) {
            $lanes[$l['id']] = (string) ($l['shortName'] ?? '') ?: (string) $l['name'];
        }
        $menus = [];
        foreach ($day['menus'] as $m) {
            $menus[$m['id']] = (string) ($m['abbr'] ?? '') ?: (string) $m['name'];
        }
        $patients = [];
        foreach ($day['patients'] as $p) {
            $patients[$p['id']] = $p;
        }
        $rows = array_values(array_filter($day['reservations'], fn($r) => ($r['status'] ?? '') !== 'cancelled'));
        usort($rows, fn($a, $b) => [$a['startAt'], $a['laneId']] <=> [$b['startAt'], $b['laneId']]);
        $hm = fn(string $iso) => (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Asia/Tokyo'))->format('H:i');

        // 列：時刻・レーン・患者（名前・カナ・診察券）・メニュー・メモ
        $cols = [[self::M, '時刻'], [self::M + 70, 'レーン'], [self::M + 150, '患者'], [self::M + 360, 'メニュー'], [self::M + 540, 'メモ']];
        $pages = [];
        $per = (int) floor((self::H - self::M * 2 - 60) / self::ROW);
        $chunks = $rows ? array_chunk($rows, $per) : [[]];
        foreach ($chunks as $i => $chunk) {
            $c = "0.6 w 0.5 G\n";
            $c .= self::text(self::M, self::H - self::M - 14, 15, $title);
            $c .= self::text(self::W - self::M - 150, self::H - self::M - 14, 9, sprintf('%d件　%d/%d ページ', count($rows), $i + 1, count($chunks)));
            $y = self::H - self::M - 40;
            foreach ($cols as [$x, $h]) {
                $c .= self::text($x, $y, 9, $h);
            }
            $c .= sprintf("%.1F %.1F m %.1F %.1F l S\n", self::M, $y - 4, self::W - self::M, $y - 4);
            foreach ($chunk as $r) {
                $y -= self::ROW;
                $p = $patients[$r['patientId']] ?? [];
                $who = (string) ($p['name'] ?? '（患者不明）');
                if (!empty($p['kana'])) {
                    $who .= '（' . $p['kana'] . '）';
                }
                if (!empty($p['m3ChartNo'])) {
                    $who .= ' ' . $p['m3ChartNo'];
                }
                $menu = implode('・', array_map(fn($id) => $menus[$id] ?? '', (array) ($r['menuIds'] ?? [])));
                $c .= self::text(self::M, $y, 9, $hm($r['startAt']) . '-' . $hm($r['endAt']));
                $c .= self::text(self::M + 70, $y, 9, self::cut($lanes[$r['laneId']] ?? '', 8));
                $c .= self::text(self::M + 150, $y, 9, self::cut($who, 22));
                $c .= self::text(self::M + 360, $y, 9, self::cut($menu, 19));
                $c .= self::text(self::M + 540, $y, 9, self::cut((string) ($r['memo'] ?? ''), 29));
                $c .= sprintf("%.1F %.1F m %.1F %.1F l S\n", self::M, $y - 4, self::W - self::M, $y - 4);
            }
            if (!$rows) {
                $c .= self::text(self::M, $y - 20, 11, 'この日の予約はありません');
            }
            $c .= self::text(self::M, self::M - 12, 7, '作成 ' . date('Y/m/d H:i') . '　LANE RESERVE　サーバーが止まったときの控え（院外に持ち出さない）');
            $pages[] = $c;
        }
        return self::assemble($pages);
    }

    private static function assemble(array $contents): string
    {
        $objs = [];
        $objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objs[3] = '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [4 0 R] >>';
        $objs[4] = '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 5 0 R /DW 1000 /W [1 95 500] >>';
        $objs[5] = '<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 737 /StemV 69 >>';
        $kids = [];
        $n = 6;
        foreach ($contents as $c) {
            $page = $n++;
            $stream = $n++;
            $kids[] = "{$page} 0 R";
            $objs[$page] = sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>', self::W, self::H, $stream);
            $z = gzcompress($c);
            $objs[$stream] = '<< /Length ' . strlen($z) . " /Filter /FlateDecode >>\nstream\n" . $z . "\nendstream";
        }
        $objs[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($kids) . ' >>';
        ksort($objs);
        $out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offs = [];
        foreach ($objs as $i => $o) {
            $offs[$i] = strlen($out);
            $out .= "{$i} 0 obj\n{$o}\nendobj\n";
        }
        $xref = strlen($out);
        $max = max(array_keys($objs));
        $out .= 'xref' . "\n0 " . ($max + 1) . "\n0000000000 65535 f \n";
        for ($i = 1; $i <= $max; $i++) {
            $out .= isset($offs[$i]) ? sprintf("%010d 00000 n \n", $offs[$i]) : "0000000000 65535 f \n";
        }
        return $out . "trailer\n<< /Size " . ($max + 1) . " /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF\n";
    }
}
