<?php
/**
 * タトゥー・アートメイク除去（日曜の不定期診療）の Web 予約。オンラインカウンセリング（OnlineCs）と同じ作り。
 * 院が開けた受付日時（設定 → 院の情報、1行に1つ「2026-12-06 10:00-13:00」）の中で、
 * 照射面積から決まる時間の枠を、予約の前後に隙間ができる時刻だけ出す（受付時間帯の空きの「最初」と「最後」だけ）。
 * 初診は照射の前に説明10分を取る。説明は隣のレーン（看護師）で照射の直前に取り、空いていなければ照射のレーンに続けて取る。
 * 患者向けの画面・文言に「詰める」などの仕組みは出さない。選べる時刻だけを見せる。
 */
declare(strict_types=1);

final class TattooBooking
{
    /** 初診の説明の時間（分） */
    public const EXPLAIN_MINUTES = 10;
    public const ACTOR = ['id' => 'web-tattoo', 'name' => 'Web予約（タトゥー除去・日曜）'];
    /** 1辺の上限（cm）と、1か所の面積の上限（cm²） */
    private const MAX_SIDE = 100.0;

    public static function settings(): array
    {
        $c = Store::clinic();
        return [
            'enabled' => (bool) ($c['tattooEnabled'] ?? false),
            'laneId' => (string) ($c['tattooLaneId'] ?? ''),
            'menuId' => (string) ($c['tattooMenuId'] ?? ''),
            'explainLaneId' => (string) ($c['tattooExplainLaneId'] ?? ''),
            'explainMenuId' => (string) ($c['tattooExplainMenuId'] ?? ''),
            'slots' => array_values(array_filter((array) ($c['tattooSlots'] ?? []), 'is_string')),
        ];
    }

    /** 受け付けられる設定か（受け付けがオンで、照射のレーンとメニューがある） */
    public static function ready(?array $s = null): bool
    {
        $s ??= self::settings();
        return $s['enabled'] && $s['laneId'] !== '' && $s['menuId'] !== '';
    }

    /** 公開ページのアドレス（問診票のアドレスと同じサイトの /tattoo/） */
    public static function pageUrl(): string
    {
        $u = parse_url((string) (config()['monshin_url'] ?? ''));
        return isset($u['scheme'], $u['host']) ? "{$u['scheme']}://{$u['host']}/tattoo/" : '';
    }

    /** 照射の時間（分）：〜10cm² 5分、〜30 10分、〜50 15分、〜150 20分、〜300 30分、それ以上は 10cm² ごとに1分足す */
    public static function treatMinutes(float $area): int
    {
        $a = round($area, 2);
        return match (true) {
            $a <= 10 => 5,
            $a <= 30 => 10,
            $a <= 50 => 15,
            $a <= 150 => 20,
            $a <= 300 => 30,
            default => 30 + (int) ceil(($a - 300) / 10 - 1e-9),
        };
    }

    /** 1回の料金（税込・麻酔代別）。〜5 29,700、〜10 38,500、〜30 49,500、〜50 59,400、超えた分は 10cm² ごとに 11,000 */
    public static function price(float $area): int
    {
        $a = round($area, 2);
        return match (true) {
            $a <= 5 => 29_700,
            $a <= 10 => 38_500,
            $a <= 30 => 49_500,
            $a <= 50 => 59_400,
            default => 59_400 + 11_000 * (int) ceil(($a - 50) / 10 - 1e-9),
        };
    }

    /** 長方形の一覧 [[長辺, 短辺], ...] の面積の合計（cm²、小数1桁で切り上げ）。形が違えば null */
    public static function areaOf(mixed $rects): ?float
    {
        if (!is_array($rects) || !array_is_list($rects) || count($rects) < 1 || count($rects) > 2) {
            return null;
        }
        $sum = 0.0;
        foreach ($rects as $r) {
            if (!is_array($r) || count($r) !== 2) {
                return null;
            }
            [$a, $b] = array_map(fn($v) => is_numeric($v) ? (float) $v : -1.0, array_values($r));
            if ($a <= 0 || $b <= 0 || $a > self::MAX_SIDE || $b > self::MAX_SIDE) {
                return null;
            }
            $sum += $a * $b;
        }
        return ceil($sum * 10 - 1e-9) / 10;
    }

    /** 「2026-12-06 10:00-13:00」の行の読み方・そろえ方はオンラインカウンセリングと同じ */
    public static function normalizeWindows(array $lines): array
    {
        $out = [];
        foreach ($lines as $line) {
            $line = (string) $line;
            if (trim($line) === '') {
                continue;
            }
            $w = OnlineCs::parseWindow($line);
            if (!$w) {
                throw new StoreError('invalid', "タトゥー除去の受付日時の形が正しくありません：{$line}（例：2026-12-06 10:00-13:00）");
            }
            $out[] = sprintf('%s %s-%s', $w['date'], self::hm($w['start']), self::hm($w['end']));
        }
        $out = array_values(array_unique($out));
        sort($out);
        return $out;
    }

    private static function hm(int $m): string
    {
        return sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    }

    /** 区間の一覧から、[s, e) と重なるものがあるか */
    private static function overlaps(array $busy, int $s, int $e): bool
    {
        foreach ($busy as [$bs, $be]) {
            if ($s < $be && $bs < $e) {
                return true;
            }
        }
        return false;
    }

    /**
     * その日の受付時間帯の中で、照射のレーンの空いている区間（[開始分, 終了分]、受付時間帯ごと）
     * @return list<array{0:int,1:int,2:int}> [空きの開始, 空きの終了, 受付時間帯の開始]
     */
    private static function gaps(array $windows, array $busy): array
    {
        $out = [];
        foreach ($windows as [$ws, $we]) {
            $cur = $ws;
            $inside = array_filter($busy, fn($b) => $b[0] < $we && $b[1] > $ws);
            usort($inside, fn($x, $y) => $x[0] <=> $y[0]);
            foreach ($inside as [$bs, $be]) {
                if ($bs > $cur) {
                    $out[] = [$cur, min($bs, $we), $ws];
                }
                $cur = max($cur, $be);
            }
            if ($cur < $we) {
                $out[] = [$cur, $we, $ws];
            }
        }
        return $out;
    }

    /**
     * 選べる枠。日付 => [[来院の時刻 "HH:MM", 照射の開始分, 説明のレーンを使うか], ...]（時刻順）。
     * 空きの区間ごとに「最初から」と「最後から」の2つだけを出す（予約が前後に隙間なく並ぶ）。
     * 初診は、説明10分を説明のレーンで照射の直前に取れればそこで、取れなければ照射のレーンで照射の前に続けて取る。
     * @return array<string, list<array{0:string,1:int,2:bool}>>
     */
    public static function plan(int $treat, bool $firstVisit, ?array $s = null): array
    {
        $s ??= self::settings();
        if (!self::ready($s) || $treat < 1) {
            return [];
        }
        $now = now_in_clinic();
        $byDate = [];
        foreach ($s['slots'] as $line) {
            $w = OnlineCs::parseWindow($line);
            if ($w && $w['date'] >= $now['date']) {
                $byDate[$w['date']][] = [$w['start'], $w['end']];
            }
        }
        $out = [];
        foreach ($byDate as $date => $windows) {
            $busy = Store::busyMinutes($date, $s['laneId']);
            $nurseBusy = $s['explainLaneId'] !== '' ? Store::busyMinutes($date, $s['explainLaneId']) : null;
            $found = [];
            foreach (self::gaps($windows, $busy) as [$gs, $ge, $ws]) {
                foreach (['front', 'back'] as $side) {
                    $c = self::fit($side, $gs, $ge, $ws, $treat, $firstVisit, $nurseBusy, $windows);
                    if ($c === null) {
                        continue;
                    }
                    [$arrive] = $c;
                    if ($date === $now['date'] && $arrive <= $now['minutes']) {
                        continue;
                    }
                    $found[$arrive] = [self::hm($arrive), $c[1], $c[2]];
                }
            }
            if ($found) {
                ksort($found);
                $out[$date] = array_values($found);
            }
        }
        ksort($out);
        return $out;
    }

    /**
     * 空き [gs, ge) の最初（front）か最後（back）に入れる場合の [来院の分, 照射の開始分, 説明のレーンを使うか]。入らなければ null
     */
    private static function fit(string $side, int $gs, int $ge, int $ws, int $treat, bool $first, ?array $nurseBusy, array $windows): ?array
    {
        $x = self::EXPLAIN_MINUTES;
        // 初診で説明のレーンを使う：照射は空きの端にそろえ、説明はその直前の10分（受付時間帯の中で、説明のレーンが空いていれば）
        if ($first && $nurseBusy !== null) {
            $start = $side === 'front' ? $gs : $ge - $treat;
            if ($start >= $gs && $start + $treat <= $ge && $start - $x >= $ws && !self::overlaps($nurseBusy, $start - $x, $start)) {
                return [$start - $x, $start, true];
            }
        }
        // 再診、または説明も照射のレーンで取る初診
        $len = $treat + ($first ? $x : 0);
        if ($ge - $gs < $len) {
            return null;
        }
        $start = $side === 'front' ? $gs : $ge - $len;
        return [$start, $start + ($first ? $x : 0), false];
    }

    /** 公開ページ用：日付 => ["10:00", ...]（来院の時刻） */
    public static function openTimes(int $treat, bool $firstVisit): array
    {
        return array_map(fn($list) => array_map(fn($c) => $c[0], $list), self::plan($treat, $firstVisit));
    }

    /**
     * 予約を受け付ける。うまくいけば ['ok'=>true, 'date', 'time', 'end', 'mailed']。
     * 入力の誤りは ['ok'=>false, 'error'=>'invalid', 'fields'=>[...]]、枠が埋まっていれば 'slot_taken'
     */
    public static function book(array $in, string $ip, ?int $nowMs = null): array
    {
        $nowMs ??= (int) floor(microtime(true) * 1000);
        $s = self::settings();
        if (!self::ready($s)) {
            return ['ok' => false, 'error' => 'closed'];
        }
        if (trim((string) ($in['website'] ?? '')) !== '') {
            return ['ok' => true, 'date' => (string) ($in['date'] ?? ''), 'time' => (string) ($in['time'] ?? ''), 'end' => '', 'mailed' => false];
        }
        $str = fn(string $k, int $max) => mb_substr(js_trim(normalize_width((string) ($in[$k] ?? ''))), 0, $max);
        $f = [
            'name' => $str('name', 60),
            'kana' => $str('kana', 60),
            'birthDate' => $str('birthDate', 10),
            'phone' => $str('phone', 20),
            'email' => $str('email', 200),
            'lineName' => $str('lineName', 60),
            'part' => $str('part', 60),
            'notes' => $str('notes', 400),
            'date' => $str('date', 10),
            'time' => $str('time', 5),
        ];
        $kind = in_array($in['kind'] ?? '', ['tattoo', 'artmake'], true) ? $in['kind'] : '';
        $visit = in_array($in['visit'] ?? '', ['first', 'repeat'], true) ? $in['visit'] : '';
        $color = in_array($in['color'] ?? '', ['black', 'color'], true) ? $in['color'] : '';
        $anesthesia = ($in['anesthesia'] ?? '') === 'yes';
        $area = self::areaOf($in['rects'] ?? null);
        $bad = [];
        if ($kind === '') $bad[] = 'kind';
        if ($visit === '') $bad[] = 'visit';
        if ($area === null) $bad[] = 'area';
        if ($f['name'] === '') $bad[] = 'name';
        if ($f['kana'] === '') $bad[] = 'kana';
        if (!is_date_string($f['birthDate']) || $f['birthDate'] >= now_in_clinic()['date'] || $f['birthDate'] < '1900-01-01') $bad[] = 'birthDate';
        if (!preg_match('/^0\d{9,10}$/', digits_only($f['phone']))) $bad[] = 'phone';
        if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) $bad[] = 'email';
        if (!is_date_string($f['date']) || !preg_match('/^\d{2}:\d{2}$/', $f['time'])) $bad[] = 'slot';
        if ($bad) {
            return ['ok' => false, 'error' => 'invalid', 'fields' => $bad];
        }
        $ok = rate_take([
            ['tattooRate', hash('sha256', 'ip:' . $ip), [[3_600_000, 5], [86_400_000, 20]]],
            ['tattooRate', hash('sha256', 'tel:' . digits_only($f['phone'])), [[86_400_000, 3]]],
            ['tattooRate', '*', [[3_600_000, 60]]],
        ], $nowMs);
        if (!$ok) {
            return ['ok' => false, 'error' => 'rate_limited'];
        }
        $treat = self::treatMinutes($area);
        $first = $visit === 'first';
        $result = Db::i()->transaction(function () use ($f, $s, $kind, $first, $color, $anesthesia, $area, $treat) {
            // 送る直前にもう一度、その時刻が選べるか確かめる（書き込みの鍵を持ったまま）
            $pick = null;
            foreach (self::plan($treat, $first, $s)[$f['date']] ?? [] as $c) {
                if ($c[0] === $f['time']) {
                    $pick = $c;
                }
            }
            if (!$pick) {
                return ['ok' => false, 'error' => 'slot_taken'];
            }
            [, $start, $nurse] = $pick;
            try {
                $pat = Store::bookingEnsurePatient(['name' => $f['name'], 'kana' => $f['kana'], 'birthDate' => $f['birthDate'], 'phone' => $f['phone'], 'email' => $f['email']], self::ACTOR);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'contact_us'];
            }
            $x = self::EXPLAIN_MINUTES;
            $memo = implode("\n", array_filter([
                ($kind === 'artmake' ? 'アートメイク除去' : 'タトゥー除去') . '（Web予約・日曜）' . ($first ? '初診' : '再診'),
                ($f['part'] !== '' ? '部位：' . $f['part'] . '／' : '') . '面積：' . self::num($area) . 'cm²（照射' . $treat . '分）',
                $kind === 'tattoo' && $color !== '' ? '色：' . ($color === 'black' ? '黒のみ' : 'カラーあり') : null,
                '料金の目安：' . number_format(self::price($area)) . '円（税込・麻酔代別）',
                '局所麻酔注射：' . ($anesthesia ? '希望あり' : '希望なし'),
                $first ? ($nurse ? "初診説明：{$x}分（説明のレーン）" : "初診説明：{$x}分（この予約の最初）") : null,
                'メール：' . $f['email'],
                $f['lineName'] !== '' ? 'LINEの表示名：' . $f['lineName'] : null,
                $f['notes'] !== '' ? 'ご相談：' . $f['notes'] : null,
            ]));
            $patientId = $pat['patient']['id'];
            $mainStart = $nurse ? $start : $start - ($first ? $x : 0);
            $r = Store::bookingCreate([
                'patientId' => $patientId,
                'laneId' => $s['laneId'],
                'menuIds' => [$s['menuId']],
                'startAt' => to_iso($f['date'], $mainStart),
                'endAt' => to_iso($f['date'], $start + $treat),
                'memo' => $memo,
            ], self::ACTOR);
            if ($nurse) {
                Store::bookingCreate([
                    'patientId' => $patientId,
                    'laneId' => $s['explainLaneId'],
                    'menuIds' => $s['explainMenuId'] !== '' ? [$s['explainMenuId']] : [$s['menuId']],
                    'startAt' => to_iso($f['date'], $start - $x),
                    'endAt' => to_iso($f['date'], $start),
                    'memo' => "タトゥー除去の初診説明（Web予約・日曜）\n照射はこのあと" . self::hm($start) . 'から（' . $treat . '分）',
                ], self::ACTOR);
            }
            return ['ok' => true, 'end' => self::hm($start + $treat), 'id' => $r['id']];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => $kind, 'visit' => $visit, 'area' => $area, 'anesthesia' => $anesthesia, 'end' => $result['end']];
        [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject($kind), self::mailBody($f)) : [false];
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'mailed' => (bool) $sent];
    }

    private static function num(float $a): string
    {
        return rtrim(rtrim(number_format($a, 1, '.', ''), '0'), '.');
    }

    private static function mailSubject(string $kind): string
    {
        return '【' . Store::publicInfo()['publicName'] . '】' . ($kind === 'artmake' ? 'アートメイク除去' : 'タトゥー除去') . 'のご予約を承りました';
    }

    public static function mailBody(array $f): string
    {
        $p = Store::publicInfo();
        $c = Store::clinic();
        $phone = (string) ($c['phone'] ?? '');
        $what = $f['kind'] === 'artmake' ? 'アートメイク除去' : 'タトゥー除去';
        return implode("\n", array_filter([
            "{$f['name']} 様",
            '',
            "{$what}のご予約を承りました。",
            '',
            '日時：' . format_date_ja($f['date']) . " {$f['time']}〜{$f['end']}（ご来院は {$f['time']} までにお願いします）",
            '区分：' . ($f['visit'] === 'first' ? '初診（照射の前にご説明があります）' : '再診'),
            '希望照射面積：' . self::num((float) $f['area']) . 'cm²',
            '料金の目安：1回 ' . number_format(self::price((float) $f['area'])) . '円（税込）' . ($f['anesthesia'] ? '＋局所麻酔注射 1ccあたり5,500円（税込）' : ''),
            '面積は当日に測り、照射の前に料金をお伝えします。',
            $p['address'] !== '' ? '場所：' . $p['address'] : null,
            '',
            'タトゥー・アートメイク除去は日曜日の診療です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なりますのでご注意ください。',
            'ご予約の変更・キャンセルは、当院の LINE' . ($phone !== '' ? "、またはお電話（{$phone}）" : '') . 'でご連絡ください。',
            '',
            $p['publicName'],
        ], fn($l) => $l !== null));
    }
}
