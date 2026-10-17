<?php
declare(strict_types=1);

/**
 * LINE 予約フォームの申請の受付箱。
 * line-webhook が保存した申請（intake-records/申請ID.json）を読むだけで、line-webhook のファイルは書き換えない。
 * 申請者の LINE の ID は画面に出さない（リマインドの送り先選びでだけ使う）。
 * 「予約済み」はカレンダーの予約（申請IDの欄・メモ）から見分け、「済み・見送り」はスタッフが付けた印（meta intakeHandled）
 */
final class Intake
{
    public const ID_RE = '/^R\d{14}[0-9A-F]{8}$/';

    private static function dir(): string
    {
        return rtrim((string) (config()['line_intake_dir'] ?? RESERVE_ROOT . '/../line-webhook/private-queue/intake-records'), '/');
    }

    /**
     * 申請の記録。新しい申請は DB（暗号化）の 'intake' に入る（monshin/intake-submit-v1.php）。
     * 移行前の申請は、line-webhook が保存したファイル（intake-records/申請ID.json）から読む
     */
    public static function record(string $rid): ?array
    {
        $rid = strtoupper(trim($rid));
        if (!preg_match(self::ID_RE, $rid)) {
            return null;
        }
        $rec = Db::i()->get('intake', $rid);
        if (!is_array($rec)) {
            $file = self::dir() . '/' . $rid . '.json';
            $rec = is_file($file) ? json_decode((string) @file_get_contents($file), true) : null;
        }
        return is_array($rec) && ($rec['requestId'] ?? '') === $rid && ($rec['type'] ?? '') === 'reservation_intake' ? $rec : null;
    }

    /** 申請を DB に保存する（受け口から） */
    public static function store(array $rec): void
    {
        $rid = (string) ($rec['requestId'] ?? '');
        if (!preg_match(self::ID_RE, $rid) || ($rec['type'] ?? '') !== 'reservation_intake') {
            throw new StoreError('invalid', '予約申請の形が正しくありません');
        }
        Db::i()->put('intake', $rid, $rec);
    }

    /** 申請の文面が、申請した本人の LINE から届いた印を付ける（DB の申請だけ。移行前のファイルは line.php が直接付ける） */
    public static function markLineReceived(string $rid, string $userId, string $eventId): bool
    {
        return (bool) Db::i()->transaction(function () use ($rid, $userId, $eventId) {
            $rec = Db::i()->get('intake', $rid);
            if (!is_array($rec) || $userId === '' || !hash_equals((string) ($rec['source']['userId'] ?? ''), $userId)) {
                return false;
            }
            if (empty($rec['lineMessageReceivedAt'])) {
                $rec['lineMessageReceivedAt'] = gmdate('c');
                $rec['lineMessageEventId'] = $eventId;
                if (($rec['status'] ?? '') === 'submitted') {
                    $rec['status'] = 'line_message_received';
                }
                Db::i()->put('intake', $rid, $rec);
            }
            return true;
        });
    }

    /** 最近 $days 日の申請（DB と移行前のファイルを合わせて） */
    private static function recent(int $days): array
    {
        $since = gmdate('YmdHis', time() - $days * 86400);
        $out = [];
        foreach (glob(self::dir() . '/R*.json') ?: [] as $file) {
            $rid = basename($file, '.json');
            if (preg_match(self::ID_RE, $rid) && substr($rid, 1, 14) >= $since) {
                $out[$rid] = null;
            }
        }
        foreach (array_keys(Db::i()->all('intake')) as $rid) {
            $rid = (string) $rid;
            if (preg_match(self::ID_RE, $rid) && substr($rid, 1, 14) >= $since) {
                $out[$rid] = null;
            }
        }
        foreach (array_keys($out) as $rid) {
            $out[$rid] = self::record((string) $rid);
        }
        return array_filter($out);
    }

    /** 最近 $days 日の申請（新しい順） */
    public static function list(int $days = 30): array
    {
        $days = max(1, min(90, $days));
        $handled = self::handled();
        $booked = self::bookedRequestIds($days + 60);
        $items = [];
        $today = now_in_clinic()['date'];
        foreach (self::recent($days) as $rid => $rec) {
            $rid = (string) $rid;
            $f = is_array($rec['intake'] ?? null) ? $rec['intake'] : [];
            $s = fn(string $k) => js_slice(trim((string) ($f[$k] ?? '')), 500);
            // 希望日が過ぎた申請は、いまさら対応しないので出さない（line-webhook の保存ファイルは消さない）
            $pref = (string) ($f['preferredDate'] ?? '');
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $pref) && $pref < $today) {
                continue;
            }
            $initial = ($f['visitType'] ?? '') === 'initial';
            $state = isset($booked[$rid]) ? 'booked' : ($handled[$rid]['action'] ?? 'new');
            $items[] = [
                'requestId' => $rid,
                'receivedAt' => (string) ($rec['receivedAt'] ?? ''),
                'visitType' => $initial ? 'initial' : 'returning',
                'preferredDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $s('preferredDate')) ? $s('preferredDate') : '',
                'timePreference' => $s('timePreference'),
                'timeNote' => $s('timeNote'),
                'name' => $s('name'),
                'kana' => $s('kana'),
                'birthDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $s('birthDate')) ? $s('birthDate') : '',
                'gender' => $s('gender'),
                'phone' => $s('phone'),
                'wish' => $initial ? $s('initialTreatment') : $s('returningTreatment'),
                'area' => $initial ? $s('initialBodyArea') : $s('returningBodyArea'),
                'notes' => $initial ? $s('initialNotes') : $s('returningNotes'),
                // 予約登録の画面に流し込む文面（LINE に届く文面と同じ形）。申請IDを足しておく
                'message' => js_slice(trim((string) ($rec['message']['text'] ?? '')), 5000) . "\n予約申請ID：{$rid}",
                'state' => $state,
                'reservation' => $booked[$rid] ?? null,
                'handledBy' => $state === 'done' || $state === 'skip' ? ($handled[$rid]['by']['name'] ?? null) : null,
            ];
        }
        self::guessBooked($items);
        usort($items, fn($a, $b) => strcmp($b['requestId'], $a['requestId']));
        return ['items' => $items, 'days' => $days, 'available' => true];
    }

    /**
     * 申請IDのメモがない予約（Air で入れた予約など）を見分ける。申請の受付日以降の予約で、患者が
     * 「カナ（または氏名）」と「電話（または生年月日）」の両方で合うものがあれば「予約済み（推定）」にする。
     * 画面の表示だけに使い、LINE の送り先には使わない（送り先は申請IDの照合だけ）
     */
    private static function guessBooked(array &$items): void
    {
        $open = array_filter(array_keys($items), fn($i) => $items[$i]['state'] === 'new');
        if (!$open) {
            return;
        }
        $from = min(array_map(fn($i) => substr($items[$i]['requestId'], 1, 4) . '-' . substr($items[$i]['requestId'], 5, 2) . '-' . substr($items[$i]['requestId'], 7, 2), $open));
        $db = Db::i();
        $byPatient = [];
        foreach ($db->between('reservation', 'k1', $from, '9999-12-31') as $r) {
            if (empty($r['patientId']) || in_array($r['status'] ?? '', Store::INACTIVE, true)) {
                continue;
            }
            $byPatient[$r['patientId']][] = $r;
        }
        if (!$byPatient) {
            return;
        }
        $people = [];
        foreach (array_keys($byPatient) as $pid) {
            $p = $db->get('patient', (string) $pid);
            if (!$p || !empty($p['deleted'])) {
                continue;
            }
            $people[] = [
                'id' => (string) $pid,
                'kana' => search_key($p['kana'] ?? ''),
                'name' => fold_name_variants(search_key($p['name'] ?? '')),
                'phone' => digits_only($p['phone'] ?? ''),
                'birth' => (string) ($p['birthDate'] ?? ''),
            ];
        }
        foreach ($open as $i) {
            $it = $items[$i];
            $kana = search_key($it['kana']);
            $name = fold_name_variants(search_key($it['name']));
            $phone = digits_only($it['phone']);
            $since = substr($it['requestId'], 1, 4) . '-' . substr($it['requestId'], 5, 2) . '-' . substr($it['requestId'], 7, 2);
            $hit = null;
            foreach ($people as $pp) {
                $who = ($kana !== '' && $kana === $pp['kana']) || ($name !== '' && $name === $pp['name']);
                $sure = (strlen($phone) >= 10 && $phone === $pp['phone']) || ($it['birthDate'] !== '' && $it['birthDate'] === $pp['birth']);
                if (!$who || !$sure) {
                    continue;
                }
                foreach ($byPatient[$pp['id']] as $r) {
                    if (clinic_date_of((string) $r['startAt']) >= $since && ($hit === null || $r['startAt'] < $hit['startAt'])) {
                        $hit = ['id' => $r['id'], 'startAt' => $r['startAt']];
                    }
                }
            }
            if ($hit) {
                $items[$i]['state'] = 'booked';
                $items[$i]['reservation'] = $hit;
                $items[$i]['guessed'] = true;
            }
        }
    }

    /** スタッフの印：done＝済み（Airなどで対応した）、skip＝見送り、null＝印を外す */
    public static function mark(string $rid, ?string $action, array $by): array
    {
        if (!preg_match(self::ID_RE, $rid)) {
            throw new StoreError('invalid', '予約申請IDの形式が正しくありません');
        }
        $h = self::handled();
        if ($action === null) {
            unset($h[$rid]);
        } else {
            $h[$rid] = ['action' => $action, 'at' => now_iso(), 'by' => ['id' => $by['id'], 'name' => $by['name']]];
        }
        // 古い印は90日で消す（申請IDの先頭が受付日時）
        $limit = gmdate('YmdHis', time() - 90 * 86400);
        $h = array_filter($h, fn($v, $k) => substr((string) $k, 1, 14) >= $limit, ARRAY_FILTER_USE_BOTH);
        Db::i()->setMeta('intakeHandled', $h);
        Auth::audit($by, '予約申請の受付箱：' . ($action === 'done' ? '済み' : ($action === 'skip' ? '見送り' : '印を外す')) . "（{$rid}）");
        return ['requestId' => $rid, 'state' => $action ?? 'new'];
    }

    private static function handled(): array
    {
        $h = Db::i()->meta('intakeHandled');
        return is_array($h) ? $h : [];
    }

    /** カレンダーの予約（取り消し以外）に入っている申請ID → その予約の日時 */
    private static function bookedRequestIds(int $days): array
    {
        $from = (new DateTimeImmutable('now', jst()))->modify("-{$days} day")->format('Y-m-d');
        $out = [];
        foreach (Db::i()->between('reservation', 'k1', $from, '9999-12-31') as $r) {
            if (in_array($r['status'] ?? '', Store::INACTIVE, true)) {
                continue;
            }
            $ids = [];
            if (!empty($r['requestId'])) {
                $ids[] = strtoupper((string) $r['requestId']);
            }
            if (!empty($r['memo']) && preg_match_all('/R\d{14}[0-9A-F]{8}/i', strip_tags((string) $r['memo']), $m)) {
                foreach ($m[0] as $id) {
                    $ids[] = strtoupper($id);
                }
            }
            foreach ($ids as $id) {
                $out[$id] ??= ['id' => $r['id'], 'startAt' => $r['startAt']];
            }
        }
        return $out;
    }
}
