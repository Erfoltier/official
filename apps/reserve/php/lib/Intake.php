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

    /** 最近 $days 日の申請（新しい順） */
    public static function list(int $days = 30): array
    {
        $days = max(1, min(90, $days));
        $since = gmdate('YmdHis', time() - $days * 86400);
        $files = glob(self::dir() . '/R*.json') ?: [];
        $handled = self::handled();
        $booked = self::bookedRequestIds($days + 60);
        $items = [];
        foreach ($files as $file) {
            $rid = basename($file, '.json');
            if (!preg_match(self::ID_RE, $rid) || substr($rid, 1, 14) < $since) {
                continue;
            }
            $rec = json_decode((string) @file_get_contents($file), true);
            if (!is_array($rec) || ($rec['requestId'] ?? '') !== $rid || ($rec['type'] ?? '') !== 'reservation_intake') {
                continue;
            }
            $f = is_array($rec['intake'] ?? null) ? $rec['intake'] : [];
            $s = fn(string $k) => js_slice(trim((string) ($f[$k] ?? '')), 500);
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
        usort($items, fn($a, $b) => strcmp($b['requestId'], $a['requestId']));
        return ['items' => $items, 'days' => $days, 'available' => is_dir(self::dir())];
    }

    /** スタッフの印：done＝済み（Airなどで対応した）、skip＝見送り、null＝印を外す */
    public static function mark(string $rid, ?string $action, array $by): array
    {
        if (!preg_match(self::ID_RE, $rid)) {
            throw new StoreError('invalid', '予約申請IDの形が正しくありません');
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
