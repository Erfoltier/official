<?php
/**
 * オンラインカウンセリング（ゼオスキン）の Web 予約。
 * 院が開けた受付日時（設定 → 院の情報、1行に1つ「2026-11-20 14:00-16:00」）のうち、
 * オンラインカウンセリングのレーンが空いている15分枠だけを公開ページ（monshin/cs/）に出し、
 * お客様が選ぶとその場でレーンに予約を入れて、確定のメールを送る。
 * お客様向けの文言では「医師」「診察」「患者」を使わない。
 */
declare(strict_types=1);

final class OnlineCs
{
    public const MINUTES = 15;
    /** 共同利用の同意文の版（文面を変えたら日付を進める） */
    public const CONSENT_VERSION = '2026-11-17-draft';
    /** 公開ページを埋め込んでよいサイト（frame-ancestors） */
    public const FRAME_ANCESTORS = ['https://simiclair.myshopify.com'];
    public const ACTOR = ['id' => 'web-online-cs', 'name' => 'Web予約（オンラインカウンセリング）'];

    public static function settings(): array
    {
        $c = Store::clinic();
        return [
            'enabled' => (bool) ($c['onlineCsEnabled'] ?? false),
            'laneId' => (string) ($c['onlineCsLaneId'] ?? ''),
            'slots' => array_values(array_filter((array) ($c['onlineCsSlots'] ?? []), 'is_string')),
        ];
    }

    /** 公開ページのアドレス（問診票のアドレスと同じサイトの /cs/） */
    public static function pageUrl(): string
    {
        $u = parse_url((string) (config()['monshin_url'] ?? ''));
        return isset($u['scheme'], $u['host']) ? "{$u['scheme']}://{$u['host']}/cs/" : '';
    }

    public static function mailReady(): bool
    {
        return Reminder::mailReady();
    }

    /** 「2026-11-20 14:00-16:00」→ ['date'=>..., 'start'=>840, 'end'=>960]（分）。形が違えば null */
    public static function parseWindow(string $line): ?array
    {
        $line = trim(str_replace(['/', '〜', '～', '－', '−', 'ー'], '-', mb_convert_kana($line, 'as')));
        if (!preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/', $line, $m)) {
            return null;
        }
        $date = sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]);
        if (!is_date_string($date) || (int) $m[5] >= 60 || (int) $m[7] >= 60) {
            return null;
        }
        $s = (int) $m[4] * 60 + (int) $m[5];
        $e = (int) $m[6] * 60 + (int) $m[7];
        if ($e > 24 * 60 || $e - $s < self::MINUTES) {
            return null;
        }
        return ['date' => $date, 'start' => $s, 'end' => $e];
    }

    /** 設定に保存する形にそろえる（形が違う行があれば断る） */
    public static function normalizeWindows(array $lines): array
    {
        $out = [];
        foreach ($lines as $line) {
            $line = (string) $line;
            if (trim($line) === '') {
                continue;
            }
            $w = self::parseWindow($line);
            if (!$w) {
                throw new StoreError('invalid', "オンラインカウンセリングの受付日時の形が正しくありません：{$line}（例：2026-11-20 14:00-16:00）");
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

    /**
     * 選べる枠：日付 => ["14:00", "14:15", ...]。受付日時の中の15分ごとの枠から、
     * レーンの予約（取り消し・来院なしを除く）と重なる時間と、もう過ぎた時間を除く
     * @return array<string, list<string>>
     */
    public static function openSlots(): array
    {
        $s = self::settings();
        if (!$s['enabled'] || $s['laneId'] === '') {
            return [];
        }
        $now = now_in_clinic();
        $out = [];
        foreach ($s['slots'] as $line) {
            $w = self::parseWindow($line);
            if (!$w || $w['date'] < $now['date']) {
                continue;
            }
            $busy = Store::busyMinutes($w['date'], $s['laneId']);
            for ($t = $w['start']; $t + self::MINUTES <= $w['end']; $t += self::MINUTES) {
                if ($w['date'] === $now['date'] && $t <= $now['minutes']) {
                    continue;
                }
                foreach ($busy as [$bs, $be]) {
                    if ($t < $be && $bs < $t + self::MINUTES) {
                        continue 2;
                    }
                }
                $out[$w['date']][] = self::hm($t);
            }
        }
        foreach ($out as &$times) {
            $times = array_values(array_unique($times));
            sort($times);
        }
        unset($times);
        ksort($out);
        return $out;
    }

    /** このレーンで使うメニュー（このレーンだけに付いた有効なメニューを優先） */
    private static function menuId(string $laneId): string
    {
        $menus = array_values(array_filter(Store::getSettings()['menus'], fn($m) => !empty($m['active']) && in_array($laneId, $m['laneIds'] ?? [], true)));
        usort($menus, fn($a, $b) => count($a['laneIds']) <=> count($b['laneIds']));
        if (!$menus) {
            throw new StoreError('invalid', 'オンラインカウンセリングのメニューがありません');
        }
        return $menus[0]['id'];
    }

    /**
     * 予約を受け付ける。うまくいけば ['ok'=>true, 'date'=>..., 'time'=>..., 'mailed'=>bool]。
     * 入力の誤りは ['ok'=>false, 'error'=>'invalid', 'fields'=>[...]]、枠が埋まっていれば 'slot_taken'
     */
    public static function book(array $in, string $ip, ?int $nowMs = null): array
    {
        $nowMs ??= (int) floor(microtime(true) * 1000);
        $s = self::settings();
        if (!$s['enabled'] || $s['laneId'] === '') {
            return ['ok' => false, 'error' => 'closed'];
        }
        // ボットよけの隠し欄が埋まっていたら、保存せずに成功したように見せる
        if (trim((string) ($in['website'] ?? '')) !== '') {
            return ['ok' => true, 'date' => (string) ($in['date'] ?? ''), 'time' => (string) ($in['time'] ?? ''), 'mailed' => false];
        }
        $str = fn(string $k, int $max) => mb_substr(js_trim(normalize_width((string) ($in[$k] ?? ''))), 0, $max);
        $f = [
            'name' => $str('name', 60),
            'kana' => $str('kana', 60),
            'birthDate' => $str('birthDate', 10),
            'phone' => $str('phone', 20),
            'email' => $str('email', 200),
            'lineName' => $str('lineName', 60),
            'orderNo' => $str('orderNo', 40),
            'date' => $str('date', 10),
            'time' => $str('time', 5),
        ];
        $bad = [];
        if ($f['name'] === '') $bad[] = 'name';
        if ($f['kana'] === '') $bad[] = 'kana';
        if (!is_date_string($f['birthDate']) || $f['birthDate'] >= now_in_clinic()['date'] || $f['birthDate'] < '1900-01-01') $bad[] = 'birthDate';
        if (!preg_match('/^0\d{9,10}$/', digits_only($f['phone']))) $bad[] = 'phone';
        if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) $bad[] = 'email';
        if (($in['jointUseConsent'] ?? '') !== 'agreed') $bad[] = 'jointUseConsent';
        if (!is_date_string($f['date']) || !preg_match('/^\d{2}:\d{2}$/', $f['time'])) $bad[] = 'slot';
        if ($bad) {
            return ['ok' => false, 'error' => 'invalid', 'fields' => $bad];
        }
        $ok = rate_take([
            ['onlineCsRate', hash('sha256', 'ip:' . $ip), [[3_600_000, 5], [86_400_000, 20]]],
            ['onlineCsRate', hash('sha256', 'tel:' . digits_only($f['phone'])), [[86_400_000, 3]]],
            ['onlineCsRate', '*', [[3_600_000, 60]]],
        ], $nowMs);
        if (!$ok) {
            return ['ok' => false, 'error' => 'rate_limited'];
        }
        $result = Db::i()->transaction(function () use ($f, $s) {
            // 送る直前にもう一度、空いているか確かめる（書き込みの鍵を持ったまま）
            if (!in_array($f['time'], self::openSlots()[$f['date']] ?? [], true)) {
                return ['ok' => false, 'error' => 'slot_taken'];
            }
            try {
                $pat = Store::bookingEnsurePatient(['name' => $f['name'], 'kana' => $f['kana'], 'birthDate' => $f['birthDate'], 'phone' => $f['phone'], 'email' => $f['email']], self::ACTOR);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'contact_us'];
            }
            [$h, $m] = array_map('intval', explode(':', $f['time']));
            $start = $h * 60 + $m;
            $memo = implode("\n", array_filter([
                'オンラインカウンセリング（Web予約）',
                'メール：' . $f['email'],
                $f['lineName'] !== '' ? 'LINEの表示名：' . $f['lineName'] : null,
                '注文番号：' . ($f['orderNo'] !== '' ? $f['orderNo'] : 'なし'),
                '共同利用の同意：あり（' . self::CONSENT_VERSION . '）',
            ]));
            $r = Store::bookingCreate([
                'patientId' => $pat['patient']['id'],
                'laneId' => $s['laneId'],
                'menuIds' => [self::menuId($s['laneId'])],
                'startAt' => to_iso($f['date'], $start),
                'endAt' => to_iso($f['date'], $start + self::MINUTES),
                'memo' => $memo,
            ], self::ACTOR);
            // 同意の記録（いつ・どの版に同意したか）
            Db::i()->put('onlineCsConsent', (string) $r['id'], ['version' => self::CONSENT_VERSION, 'agreedAt' => now_iso(), 'method' => 'required_checkbox_on_booking_page']);
            return ['ok' => true];
        });
        if (!$result['ok']) {
            return $result;
        }
        [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject(), self::mailBody($f)) : [false];
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'mailed' => (bool) $sent];
    }

    private static function mailSubject(): string
    {
        return '【' . Store::publicInfo()['publicName'] . '】オンラインカウンセリングのご予約を承りました';
    }

    public static function mailBody(array $f): string
    {
        $p = Store::publicInfo();
        $phone = (string) (Store::clinic()['phone'] ?? '');
        [$h, $m] = array_map('intval', explode(':', $f['time']));
        $end = self::hm($h * 60 + $m + self::MINUTES);
        return implode("\n", [
            "{$f['name']} 様",
            '',
            'オンラインカウンセリング（ゼオスキン）のご予約を承りました。',
            '',
            '日時：' . format_date_ja($f['date']) . " {$f['time']}〜{$end}",
            '注文番号：' . ($f['orderNo'] !== '' ? $f['orderNo'] : 'なし'),
            '',
            '当日の進め方は、あらためてご連絡いたします。',
            'ご予約の変更・キャンセルは、シミクレールの LINE' . ($phone !== '' ? "、またはお電話（{$phone}）" : '') . 'でご連絡ください。',
            '',
            $p['publicName'],
        ]);
    }
}
