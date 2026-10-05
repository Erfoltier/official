<?php
declare(strict_types=1);

/**
 * 予約・患者・記録の処理（Node.js 版 store.ts と同じ動き・同じ文言）。
 * PHPは1回の通信ごとに起動するので、必要な分だけをデータベースから読む
 * （予約・記録は索引列で「その日」「その患者」の分だけ）。
 */
final class Store
{
    public const INACTIVE = ['cancelled', 'no_show'];
    public const STATUSES = ['booked', 'arrived', 'in_treatment', 'checkout', 'done', 'cancelled', 'no_show'];
    public const STATUS_LABEL = [
        'booked' => '予約', 'arrived' => '来院', 'in_treatment' => '施術中', 'checkout' => '会計待ち',
        'done' => '完了', 'cancelled' => 'キャンセル', 'no_show' => '無断キャンセル',
    ];
    private const FIELD_LABEL = [
        'name' => '氏名', 'kana' => 'フリガナ', 'nameAlt' => '別の表記', 'phone' => '電話', 'email' => 'メール',
        'chartNo' => '診察券番号', 'm3ChartNo' => 'M3カルテ番号', 'birthDate' => '生年月日', 'caution' => '注意事項あり', 'cautionNote' => '注意事項',
        'memo' => 'メモ', 'lineUserId' => 'LINE紐付け',
    ];
    private const FILLABLE = ['kana', 'nameAlt', 'phone', 'email', 'birthDate', 'm3ChartNo'];
    public const MIN_ACTIVE_LANES = 1;
    public const MAX_ACTIVE_LANES = 30;
    private const MAX_TOTAL_LANES = 100;

    private static ?array $patients = null;
    private static ?array $lanes = null;
    private static ?array $menus = null;
    private static ?array $seed = null;

    public static function reset(): void
    {
        self::$patients = self::$lanes = self::$menus = self::$seed = null;
    }

    // ---- 初期データ・読み込み ----

    private static function seed(): array
    {
        return self::$seed ??= json_decode((string) file_get_contents(RESERVE_ROOT . '/seed/seed.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** 初回だけ、Airリザーブから移したレーン・メニューを入れる */
    private static function init(): void
    {
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;
        $db = Db::i();
        if (!$db->meta('initialized')) {
            $db->transaction(function () use ($db) {
                foreach (self::seed()['lanes'] as $l) {
                    $db->put('lane', $l['id'], $l);
                }
                foreach (self::seed()['menus'] as $m) {
                    $db->put('menu', $m['id'], $m);
                }
                $db->setMeta('initialized', true);
            });
        }
    }

    /** 院の設定（院名・診療時間・刻み）。画面から変更したものがあればそれを使う */
    public static function clinic(): array
    {
        self::init();
        return Db::i()->meta('clinic') ?? config()['clinic'] ?? self::seed()['clinic'];
    }

    public static function updateClinic(array $input, ?array $by = null): array
    {
        $next = self::clinic();
        if (isset($input['name'])) {
            $next['name'] = self::checkText('院名', $input['name'], 40, true);
        }
        foreach (['slotMin', 'dayStartMin', 'dayEndMin'] as $k) {
            if (isset($input[$k])) {
                $next[$k] = $input[$k];
            }
        }
        if ($next['dayStartMin'] % 5 !== 0 || $next['dayEndMin'] % 5 !== 0) {
            throw new StoreError('invalid', '時刻は5分単位で指定してください');
        }
        if ($next['dayEndMin'] - $next['dayStartMin'] < 60) {
            throw new StoreError('invalid', '閉院時間は開院時間の1時間以上あとにしてください');
        }
        Db::i()->setMeta('clinic', $next);
        if ($by) {
            Auth::audit($by, '院の設定（診療時間など）を変更');
        }
        return $next;
    }

    private static function &patients(): array
    {
        self::init();
        if (self::$patients === null) {
            self::$patients = Db::i()->all('patient');
        }
        return self::$patients;
    }

    private static function &lanes(): array
    {
        self::init();
        if (self::$lanes === null) {
            self::$lanes = Db::i()->all('lane');
        }
        return self::$lanes;
    }

    private static function &menus(): array
    {
        self::init();
        if (self::$menus === null) {
            self::$menus = Db::i()->all('menu');
        }
        return self::$menus;
    }

    private static function putPatient(array $p): void
    {
        Db::i()->put('patient', $p['id'], $p);
        $all = &self::patients();
        $all[$p['id']] = $p;
    }

    private static function putLane(array $l): void
    {
        Db::i()->put('lane', $l['id'], $l);
        $all = &self::lanes();
        $all[$l['id']] = $l;
    }

    private static function putMenu(array $m): void
    {
        Db::i()->put('menu', $m['id'], $m);
        $all = &self::menus();
        $all[$m['id']] = $m;
    }

    private static function putReservation(array $r): void
    {
        Db::i()->put('reservation', $r['id'], $r);
    }

    private static function byOrder(array $items): array
    {
        $items = array_values($items);
        usort($items, fn($a, $b) => $a['order'] <=> $b['order']);
        return $items;
    }

    private static function sortedLanes(): array
    {
        return self::byOrder(self::lanes());
    }

    private static function sortedMenus(): array
    {
        return self::byOrder(self::menus());
    }

    private static function byStart(array $rs): array
    {
        $rs = array_values($rs);
        usort($rs, fn($a, $b) => strcmp($a['startAt'], $b['startAt']) ?: strcmp((string) $a['id'], (string) $b['id']));
        return $rs;
    }

    private static function reservationsOn(string $date): array
    {
        return array_filter(Db::i()->where('reservation', 'k1', $date), fn($r) => clinic_date_of($r['startAt']) === $date);
    }

    private static function reservationsOf(string $patientId): array
    {
        return array_filter(Db::i()->where('reservation', 'k2', $patientId), fn($r) => $r['patientId'] === $patientId);
    }

    private static function notesOf(string $patientId): array
    {
        return array_filter(Db::i()->where('visitNote', 'k2', $patientId), fn($n) => $n['patientId'] === $patientId);
    }

    private static function inactive(array $r): bool
    {
        return in_array($r['status'], self::INACTIVE, true);
    }

    // ---- カレンダー ----

    public static function getDayBundle(string $date): array
    {
        $reservations = self::byStart(self::reservationsOn($date));
        $used = [];
        $pids = [];
        foreach ($reservations as $r) {
            if (!self::inactive($r)) {
                $used[$r['laneId']] = true;
            }
            $pids[$r['patientId']] = true;
        }
        $patients = self::patients();
        return [
            'date' => $date,
            'clinic' => self::clinic(),
            'lanes' => array_values(array_filter(self::sortedLanes(), fn($l) => $l['active'] || isset($used[$l['id']]))),
            'menus' => self::sortedMenus(),
            'reservations' => $reservations,
            'patients' => array_values(array_filter(array_map(fn($id) => $patients[$id] ?? null, array_keys($pids)))),
        ];
    }

    /** 月の日ごとの予約数（キャンセル・無断キャンセルを除く）。$month は "2026-10" */
    public static function monthCounts(string $month): array
    {
        $out = [];
        foreach (Db::i()->between('reservation', 'k1', "{$month}-01", "{$month}-31") as $r) {
            if (self::inactive($r)) {
                continue;
            }
            $d = clinic_date_of($r['startAt']);
            if (str_starts_with($d, "{$month}-")) {
                $out[$d] = ($out[$d] ?? 0) + 1;
            }
        }
        ksort($out);
        return $out;
    }

    public static function getSettings(): array
    {
        return ['clinic' => self::clinic(), 'lanes' => self::sortedLanes(), 'menus' => self::sortedMenus()];
    }

    public static function searchPatients(string $query, int $limit = 20): array
    {
        $q = search_key($query);
        $all = array_values(array_filter(self::patients(), fn($p) => empty($p['deleted'])));
        if ($q === '') {
            usort($all, fn($a, $b) => strcmp($b['updatedAt'] ?? '', $a['updatedAt'] ?? '') ?: strcmp($b['chartNo'], $a['chartNo']));
            return array_slice($all, 0, $limit);
        }
        $digits = digits_only($query);
        $out = [];
        // 予約申請ID（例：R2026100506574020A34A8B）で探す
        $rid = strtoupper(js_trim(normalize_width($query)));
        if (preg_match('/^[A-Z0-9_-]{8,40}$/', $rid) && preg_match('/\d/', $rid) && preg_match('/[A-Z]/', $rid)) {
            $patients = self::patients();
            foreach (Db::i()->all('reservation') as $r) {
                if (strtoupper($r['requestId'] ?? '') !== $rid) {
                    continue;
                }
                $p = $patients[$r['patientId']] ?? null;
                if ($p && empty($p['deleted']) && !in_array($p, $out, true)) {
                    $out[] = $p;
                }
            }
        }
        foreach ($all as $p) {
            $hay = search_key("{$p['name']}|{$p['kana']}|" . ($p['nameAlt'] ?? '') . "|{$p['chartNo']}|" . ($p['m3ChartNo'] ?? ''));
            $phoneHit = strlen($digits) >= 4 && str_contains(digits_only($p['phone'] ?? ''), $digits);
            if (str_contains($hay, $q) || $phoneHit) {
                $out[] = $p;
            }
            if (count($out) >= $limit) {
                break;
            }
        }
        return $out;
    }

    // ---- 予約 ----

    private static function assertTimes(string $startAt, string $endAt): void
    {
        $s = parse_ms($startAt);
        $e = parse_ms($endAt);
        if (!($e > $s)) {
            throw new StoreError('invalid', '終了時刻は開始時刻より後にしてください');
        }
        if ($e - $s > 12 * 60 * 60_000) {
            throw new StoreError('invalid', '予約時間が長すぎます');
        }
        $last = (new DateTimeImmutable('@' . intdiv($e - 1, 1000)))->setTimezone(jst())->format('Y-m-d');
        if (clinic_date_of($startAt) !== $last) {
            throw new StoreError('invalid', '日をまたぐ予約は登録できません');
        }
    }

    private static function checkMenus(array $ids): void
    {
        foreach ($ids as $id) {
            if (!isset(self::menus()[$id])) {
                throw new StoreError('invalid', '施術が見つかりません');
            }
        }
    }

    public static function createReservation(array $input, ?array $by = null): array
    {
        $patient = self::patients()[$input['patientId']] ?? null;
        if (!$patient || !empty($patient['deleted'])) {
            throw new StoreError('invalid', '患者が見つかりません');
        }
        if (!isset(self::lanes()[$input['laneId']])) {
            throw new StoreError('invalid', 'レーンが見つかりません');
        }
        self::checkMenus($input['menuIds']);
        self::assertTimes($input['startAt'], $input['endAt']);
        $now = now_iso();
        $r = [
            'id' => new_id('r-new'),
            'patientId' => $input['patientId'],
            'laneId' => $input['laneId'],
            'menuIds' => $input['menuIds'],
            'startAt' => normalize_iso($input['startAt']),
            'endAt' => normalize_iso($input['endAt']),
            'status' => 'booked',
        ];
        if (isset($input['memo'])) {
            $r['memo'] = $input['memo'];
        }
        if (!empty($input['requestId'])) {
            $r['requestId'] = $input['requestId'];
        }
        $r['reminder'] = ['status' => 'pending'];
        if ($by) {
            $r['createdBy'] = $by;
            $r['updatedBy'] = $by;
        }
        $r += ['version' => 1, 'createdAt' => $now, 'updatedAt' => $now];
        self::putReservation($r);
        if ($by) {
            Auth::audit($by, '予約を登録', $r['id']);
        }
        return $r;
    }

    private static function reservation(string $id): array
    {
        $cur = Db::i()->get('reservation', $id);
        if (!$cur) {
            throw new StoreError('not_found', '予約が見つかりません');
        }
        return $cur;
    }

    public static function updateReservation(string $id, array $input, ?array $by = null): array
    {
        $cur = self::reservation($id);
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を更新してください');
        }
        if (isset($input['laneId']) && !isset(self::lanes()[$input['laneId']])) {
            throw new StoreError('invalid', 'レーンが見つかりません');
        }
        if (isset($input['menuIds'])) {
            self::checkMenus($input['menuIds']);
        }
        $startAt = isset($input['startAt']) ? normalize_iso($input['startAt']) : $cur['startAt'];
        $endAt = isset($input['endAt']) ? normalize_iso($input['endAt']) : $cur['endAt'];
        self::assertTimes($startAt, $endAt);

        $timeChanged = $startAt !== $cur['startAt'];
        $next = $cur;
        foreach (['laneId', 'status', 'menuIds', 'memo'] as $k) {
            if (array_key_exists($k, $input)) {
                $next[$k] = $input[$k];
            }
        }
        $next['startAt'] = $startAt;
        $next['endAt'] = $endAt;
        // 時刻が変わったら、送信済みのリマインドは送り直しが必要
        $next['reminder'] = $timeChanged ? ['status' => 'pending'] : $cur['reminder'];
        if ($by) {
            $next['updatedBy'] = $by;
        }
        $next['version'] = $cur['version'] + 1;
        $next['updatedAt'] = now_iso();
        if (array_key_exists('requestId', $input)) {
            if ($input['requestId'] !== '') {
                $next['requestId'] = $input['requestId'];
            } else {
                unset($next['requestId']);
            }
        }
        self::putReservation($next);
        if ($by) {
            $what = array_filter([
                $timeChanged || isset($input['endAt']) ? '時間' : null,
                isset($input['laneId']) && $input['laneId'] !== $cur['laneId'] ? 'レーン' : null,
                isset($input['status']) ? '状態→' . self::STATUS_LABEL[$input['status']] : null,
                isset($input['menuIds']) ? 'メニュー' : null,
                isset($input['memo']) ? 'メモ' : null,
                isset($input['requestId']) ? '予約申請ID' : null,
            ]);
            Auth::audit($by, '予約を変更（' . implode('・', $what) . '）', $id);
        }
        return $next;
    }

    private const INTEGRATION_ACTOR = ['id' => 'integration', 'name' => '外部連携'];

    /** 外部連携：LINE予約フォームなどから予約申請IDを書き込む */
    public static function setReservationRequestId(string $id, string $requestId): array
    {
        $cur = self::reservation($id);
        return self::updateReservation($id, ['version' => $cur['version'], 'requestId' => $requestId], self::INTEGRATION_ACTOR);
    }

    /** 外部連携：電子カルテ（M3）などからカルテ番号を書き込む */
    public static function setPatientM3ChartNo(string $id, string $m3ChartNo): array
    {
        $cur = self::patient($id);
        return self::updatePatient($id, ['version' => $cur['version'], 'm3ChartNo' => $m3ChartNo], self::INTEGRATION_ACTOR);
    }

    /** 外部の送信プログラムがリマインドの結果を書き戻す */
    public static function setReminderStatus(string $id, string $status): array
    {
        $cur = self::reservation($id);
        $now = now_iso();
        $next = [...$cur, 'reminder' => ['status' => $status, 'updatedAt' => $now], 'version' => $cur['version'] + 1, 'updatedAt' => $now];
        self::putReservation($next);
        return $next;
    }

    public static function reminderFeed(string $date): array
    {
        $day = self::getDayBundle($date);
        $lanes = array_column($day['lanes'], null, 'id');
        $menus = array_column($day['menus'], null, 'id');
        $patients = array_column($day['patients'], null, 'id');
        $items = [];
        foreach ($day['reservations'] as $r) {
            if (self::inactive($r)) {
                continue;
            }
            $p = $patients[$r['patientId']];
            $items[] = [
                'reservationId' => $r['id'],
                'version' => $r['version'],
                'startAt' => $r['startAt'],
                'endAt' => $r['endAt'],
                'laneName' => $lanes[$r['laneId']]['name'] ?? '',
                'menuNames' => array_map(fn($id) => $menus[$id]['name'] ?? '', $r['menuIds']),
                'requestId' => $r['requestId'] ?? null,
                'patient' => [
                    'id' => $p['id'],
                    'name' => $p['name'],
                    'm3ChartNo' => $p['m3ChartNo'] ?? null,
                    'lineUserId' => $p['lineUserId'] ?? null,
                    'phone' => $p['phone'] ?? null,
                    'email' => $p['email'] ?? null,
                ],
                'reminderStatus' => $r['reminder']['status'],
            ];
        }
        return ['schemaVersion' => 1, 'date' => $date, 'clinicName' => $day['clinic']['name'], 'generatedAt' => now_iso(), 'items' => $items];
    }

    // ---- 入力の検査 ----

    private static function checkText(string $label, string $value, int $max, bool $required): string
    {
        $v = clean_name($value);
        if ($required && $v === '') {
            throw new StoreError('invalid', "{$label}を入力してください");
        }
        if (js_length($v) > $max) {
            throw new StoreError('invalid', "{$label}は{$max}文字以内にしてください");
        }
        if (has_forbidden_chars($v)) {
            throw new StoreError('invalid', "{$label}に使えない文字が含まれています");
        }
        return $v;
    }

    /** 改行を許す長文（メモ等）の検査 */
    private static function checkNote(string $label, string $value, int $max): string
    {
        $v = js_trim(str_replace(["\r\n", "\r"], "\n", normalize_nfc($value)));
        if (js_length($v) > $max) {
            throw new StoreError('invalid', "{$label}は{$max}文字以内にしてください");
        }
        if (has_forbidden_chars(str_replace("\n", '', $v))) {
            throw new StoreError('invalid', "{$label}に使えない文字が含まれています");
        }
        return $v;
    }

    /** 入力を検査して保存する値にそろえる。空文字は「未入力」として null（＝項目を消す） */
    private static function patientFields(array $input, ?string $selfId): array
    {
        $out = [];
        $opt = fn(string $v) => $v === '' ? null : $v;
        if (isset($input['name'])) {
            $out['name'] = self::checkText('氏名', $input['name'], 60, true);
        }
        if (isset($input['kana'])) {
            $out['kana'] = self::checkText('フリガナ', $input['kana'], 60, false);
        }
        if (isset($input['nameAlt'])) {
            $out['nameAlt'] = $opt(self::checkText('別の表記', $input['nameAlt'], 60, false));
        }
        if (isset($input['phone'])) {
            $phone = js_trim(normalize_width($input['phone']));
            if ($phone !== '' && !preg_match('/^[0-9+\-() ]{6,20}$/', $phone)) {
                throw new StoreError('invalid', '電話番号の形式が正しくありません');
            }
            $out['phone'] = $opt($phone);
        }
        if (isset($input['email'])) {
            $email = js_trim(normalize_width($input['email']));
            if ($email !== '' && !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u', $email)) {
                throw new StoreError('invalid', 'メールアドレスの形式が正しくありません');
            }
            $out['email'] = $opt($email);
        }
        if (isset($input['chartNo'])) {
            $chartNo = js_trim(normalize_width($input['chartNo']));
            if (!preg_match('/^[A-Za-z0-9-]{1,20}$/', $chartNo)) {
                throw new StoreError('invalid', '診察券番号は英数字で入力してください');
            }
            foreach (self::patients() as $p) {
                if ($p['chartNo'] === $chartNo && $p['id'] !== $selfId) {
                    throw new StoreError('invalid', 'この診察券番号は既に使われています');
                }
            }
            $out['chartNo'] = $chartNo;
        }
        if (isset($input['m3ChartNo'])) {
            $m3 = js_trim(normalize_width($input['m3ChartNo']));
            if ($m3 !== '' && !preg_match('/^[A-Za-z0-9-]{1,20}$/', $m3)) {
                throw new StoreError('invalid', 'M3カルテ番号は英数字で入力してください');
            }
            if ($m3 !== '') {
                foreach (self::patients() as $p) {
                    if (($p['m3ChartNo'] ?? null) === $m3 && $p['id'] !== $selfId && empty($p['deleted'])) {
                        throw new StoreError('invalid', "このM3カルテ番号は 診察券{$p['chartNo']}（{$p['name']}）に登録されています");
                    }
                }
            }
            $out['m3ChartNo'] = $opt($m3);
        }
        if (isset($input['birthDate'])) {
            $b = js_trim($input['birthDate']);
            if ($b !== '' && (!is_date_string($b) || $b < '1900-01-01' || $b > now_in_clinic()['date'])) {
                throw new StoreError('invalid', '生年月日が正しくありません');
            }
            $out['birthDate'] = $opt($b);
        }
        if (isset($input['caution'])) {
            $out['caution'] = $input['caution'] ?: null;
        }
        if (isset($input['cautionNote'])) {
            $out['cautionNote'] = $opt(self::checkNote('注意事項', $input['cautionNote'], 500));
        }
        if (isset($input['memo'])) {
            $out['memo'] = $opt(self::checkNote('メモ', $input['memo'], 2000));
        }
        return $out;
    }

    private static function nextChartNo(): string
    {
        $max = 10000;
        foreach (self::patients() as $p) {
            if (preg_match('/^\s*\d+\s*$/', $p['chartNo'])) {
                $max = max($max, (int) $p['chartNo']);
            }
        }
        return (string) ($max + 1);
    }

    // ---- 患者 ----

    public static function getPatient(string $id): ?array
    {
        return self::patients()[$id] ?? null;
    }

    private static function patient(string $id): array
    {
        $p = self::patients()[$id] ?? null;
        if (!$p) {
            throw new StoreError('not_found', '患者が見つかりません');
        }
        return $p;
    }

    public static function createPatient(array $input, ?array $by = null): array
    {
        $chartNoGiven = js_trim($input['chartNo'] ?? '') !== '';
        $in = ['kana' => '', ...$input];
        if (!$chartNoGiven) {
            unset($in['chartNo']);
        }
        $fields = self::patientFields($in, null);
        $now = now_iso();
        $p = drop_null([
            'id' => new_id('p-new'),
            'chartNo' => $fields['chartNo'] ?? self::nextChartNo(),
            'name' => $fields['name'],
            'kana' => $fields['kana'] ?? '',
            ...$fields,
            'version' => 1,
            'updatedAt' => $now,
        ]);
        self::putPatient($p);
        Db::i()->put('patientHistory', $p['id'], [array_filter(['at' => $now, 'fields' => ['新規登録'], 'by' => $by], fn($v) => $v !== null)]);
        if ($by) {
            Auth::audit($by, '患者を登録', $p['id']);
        }
        return $p;
    }

    public static function updatePatient(string $id, array $input, ?array $by = null): array
    {
        $cur = self::patient($id);
        if (!empty($cur['deleted'])) {
            throw new StoreError('invalid', '削除された患者は編集できません。先に復元してください');
        }
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        unset($input['version']);
        $fields = self::patientFields($input, $id);
        $changed = [];
        foreach ($fields as $k => $v) {
            if (($cur[$k] ?? '') !== ($v ?? '')) {
                $changed[] = $k;
            }
        }
        if (!$changed) {
            return $cur;
        }
        $now = now_iso();
        $next = drop_null([...$cur, ...$fields, 'version' => $cur['version'] + 1, 'updatedAt' => $now]);
        self::putPatient($next);
        self::recordChange($id, array_map(fn($k) => self::FIELD_LABEL[$k] ?? $k, $changed), $now, $by);
        return $next;
    }

    /** LINEの紐付けを解除する（誤った紐付けの訂正・本人の希望） */
    public static function unlinkPatientLine(string $id, int $version, ?array $by = null): array
    {
        $cur = self::patient($id);
        if ($cur['version'] !== $version) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        if (empty($cur['lineUserId'])) {
            return $cur;
        }
        $now = now_iso();
        $next = [...$cur, 'version' => $cur['version'] + 1, 'updatedAt' => $now];
        unset($next['lineUserId']);
        self::putPatient($next);
        self::recordChange($id, ['LINE紐付けの解除'], $now, $by);
        return $next;
    }

    /** 患者の変更履歴に残す。$auditAction を渡すと、操作ログにはその文言を使う（患者情報を残さないため） */
    private static function recordChange(string $id, array $fields, string $at, ?array $by = null, ?string $auditAction = null): void
    {
        $list = Db::i()->get('patientHistory', $id) ?? [];
        $entry = ['at' => $at, 'fields' => $fields];
        if ($by) {
            $entry['by'] = $by;
            Auth::audit($by, $auditAction ?? '患者情報を変更（' . implode('・', $fields) . '）', $id);
        }
        array_unshift($list, $entry);
        Db::i()->put('patientHistory', $id, array_slice($list, 0, 100));
    }

    private static function reservationSummary(array $r): array
    {
        $out = [
            'id' => $r['id'],
            'startAt' => $r['startAt'],
            'endAt' => $r['endAt'],
            'status' => $r['status'],
            'menuNames' => array_map(fn($mid) => self::menus()[$mid]['name'] ?? '', $r['menuIds']),
            'laneName' => self::lanes()[$r['laneId']]['name'] ?? '',
        ];
        if (!empty($r['memo'])) {
            $out['memo'] = $r['memo'];
        }
        if (!empty($r['requestId'])) {
            $out['requestId'] = $r['requestId'];
        }
        return $out;
    }

    public static function getPatientDetail(string $id): array
    {
        $patient = self::patient($id);
        $today = now_in_clinic()['date'];
        $mine = self::byStart(self::reservationsOf($id));

        $rows = [];
        foreach ($mine as $r) {
            $date = clinic_date_of($r['startAt']);
            if ($date <= $today) {
                $rows[$date] ??= ['date' => $date, 'reservations' => [], 'note' => '', 'skincare' => [], 'noteVersion' => 0];
                $rows[$date]['reservations'][] = self::reservationSummary($r);
            }
        }
        foreach (self::notesOf($id) as $n) {
            $d = $n['date'];
            $rows[$d] ??= ['date' => $d, 'reservations' => [], 'note' => '', 'skincare' => [], 'noteVersion' => 0];
            $rows[$d]['note'] = $n['note'];
            $rows[$d]['skincare'] = $n['skincare'];
            $rows[$d]['noteVersion'] = $n['version'];
            $rows[$d]['noteUpdatedAt'] = $n['updatedAt'];
            if (!empty($n['updatedBy'])) {
                $rows[$d]['noteUpdatedBy'] = $n['updatedBy'];
            }
        }
        $visits = array_values($rows);
        usort($visits, fn($a, $b) => strcmp($b['date'], $a['date']));
        $upcoming = array_values(array_map(
            fn($r) => self::reservationSummary($r),
            array_filter($mine, fn($r) => clinic_date_of($r['startAt']) > $today),
        ));

        $used = [];
        foreach ($visits as $v) {
            foreach ($v['skincare'] as $x) {
                $used[$x] = true;
            }
        }
        $suggest = array_map('strval', array_keys($used));
        foreach (self::seed()['skincareCatalog'] as $x) {
            if (!isset($used[$x])) {
                $suggest[] = $x;
            }
        }

        return [
            'patient' => $patient,
            'visits' => $visits,
            'upcoming' => $upcoming,
            'skincareSuggestions' => $suggest,
            'history' => Db::i()->get('patientHistory', $id) ?? [],
            'duplicates' => !empty($patient['deleted']) ? [] : self::findDuplicates($patient),
        ];
    }

    private static function noteKey(string $patientId, string $date): string
    {
        return "{$patientId}|{$date}";
    }

    /** 来院日ごとの記録（簡易カルテ・スキンケア）を保存する。メモもスキンケアも空なら削除 */
    public static function saveVisitNote(string $patientId, string $date, array $input, ?array $by = null): ?array
    {
        $owner = self::patient($patientId);
        if (!empty($owner['deleted'])) {
            throw new StoreError('invalid', '削除された患者には記録できません。先に復元してください');
        }
        if (!is_date_string($date) || $date > now_in_clinic()['date']) {
            throw new StoreError('invalid', '記録できるのは今日までの日付です');
        }
        $key = self::noteKey($patientId, $date);
        $cur = Db::i()->get('visitNote', $key);
        if (($cur['version'] ?? 0) !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先にこの日の記録が更新されました。画面を開き直してください');
        }
        $note = self::checkNote('メモ', $input['note'], 4000);
        $skincare = [];
        foreach ($input['skincare'] as $x) {
            $v = self::checkText('スキンケア', $x, 60, false);
            if ($v !== '' && !in_array($v, $skincare, true)) {
                $skincare[] = $v;
            }
        }
        if (count($skincare) > 20) {
            throw new StoreError('invalid', 'スキンケアは20件までです');
        }
        $at = now_iso();
        $label = '施術メモ・スキンケア（' . format_date_ja($date) . '）';
        if ($note === '' && !$skincare) {
            if ($cur) {
                Db::i()->delete('visitNote', $key);
                self::recordChange($patientId, ["{$label}の削除"], $at, $by);
            }
            return null;
        }
        $next = ['patientId' => $patientId, 'date' => $date, 'note' => $note, 'skincare' => $skincare, 'version' => ($cur['version'] ?? 0) + 1, 'updatedAt' => $at];
        if ($by) {
            $next['updatedBy'] = $by;
        }
        Db::i()->put('visitNote', $key, $next);
        self::recordChange($patientId, [$label], $at, $by);
        return $next;
    }

    // ---- レーン ----

    private static function activeLaneCount(): int
    {
        return count(array_filter(self::lanes(), fn($l) => $l['active']));
    }

    /** 今日以降の有効な予約の数（レーン・患者で絞る） */
    private static function futureActive(string $field, string $value): int
    {
        $today = now_in_clinic()['date'];
        $n = 0;
        $rows = $field === 'patientId' ? self::reservationsOf($value) : Db::i()->all('reservation');
        foreach ($rows as $r) {
            if ($r[$field] === $value && !self::inactive($r) && clinic_date_of($r['startAt']) >= $today) {
                $n++;
            }
        }
        return $n;
    }

    public static function createLane(array $input, ?array $by = null): array
    {
        if (self::activeLaneCount() >= self::MAX_ACTIVE_LANES) {
            throw new StoreError('invalid', '表示できるレーンは最大' . self::MAX_ACTIVE_LANES . 'までです。使わないレーンを非表示か削除にしてください');
        }
        if (count(self::lanes()) >= self::MAX_TOTAL_LANES) {
            throw new StoreError('invalid', '登録できるレーンの数を超えています。使わないレーンを削除してください');
        }
        $name = self::checkText('レーン名', $input['name'] ?? '', 40, true);
        $short = self::checkText('短い名前', $input['shortName'] ?? '', 12, false);
        $lane = [
            'id' => new_id('lane'),
            'name' => $name,
            'shortName' => $short !== '' ? $short : js_slice($name, 6),
            'order' => max([-1, ...array_column(self::lanes(), 'order')]) + 1,
            'active' => true,
        ];
        self::putLane($lane);
        if ($by) {
            Auth::audit($by, 'レーンを追加', $lane['id']);
        }
        return $lane;
    }

    public static function updateLane(string $id, array $input, ?array $by = null): array
    {
        $cur = self::lanes()[$id] ?? null;
        if (!$cur) {
            throw new StoreError('not_found', 'レーンが見つかりません');
        }
        $next = $cur;
        if (isset($input['name'])) {
            $next['name'] = self::checkText('レーン名', $input['name'], 40, true);
        }
        if (isset($input['shortName'])) {
            $s = self::checkText('短い名前', $input['shortName'], 12, false);
            $next['shortName'] = $s !== '' ? $s : js_slice($next['name'], 6);
        }
        if (($input['active'] ?? null) === false && $cur['active']) {
            $n = self::futureActive('laneId', $id);
            if ($n > 0) {
                throw new StoreError('invalid', "このレーンには今日以降の予約が{$n}件あります。別のレーンへ移してから非表示にしてください");
            }
            if (self::activeLaneCount() <= self::MIN_ACTIVE_LANES) {
                throw new StoreError('invalid', '表示するレーンは' . self::MIN_ACTIVE_LANES . 'つ以上必要です');
            }
        }
        if (($input['active'] ?? null) === true && !$cur['active'] && self::activeLaneCount() >= self::MAX_ACTIVE_LANES) {
            throw new StoreError('invalid', '表示できるレーンは最大' . self::MAX_ACTIVE_LANES . 'までです');
        }
        if (isset($input['active'])) {
            $next['active'] = $input['active'];
        }
        self::putLane($next);
        if ($by) {
            Auth::audit($by, 'レーンを変更', $id);
        }
        return $next;
    }

    /** レーンを完全に削除する（予約の記録が1件でもあれば削除できない）。メニューの「行えるレーン」からも外す */
    public static function deleteLane(string $id, ?array $by = null): void
    {
        Db::i()->transaction(function () use ($id, $by) {
            $cur = self::lanes()[$id] ?? null;
            if (!$cur) {
                throw new StoreError('not_found', 'レーンが見つかりません');
            }
            foreach (Db::i()->all('reservation') as $r) {
                if ($r['laneId'] === $id) {
                    throw new StoreError('invalid', 'このレーンには予約の記録があるため削除できません。使わない場合は非表示にしてください');
                }
            }
            if ($cur['active'] && self::activeLaneCount() <= self::MIN_ACTIVE_LANES) {
                throw new StoreError('invalid', '表示するレーンは' . self::MIN_ACTIVE_LANES . 'つ以上必要です');
            }
            Db::i()->delete('lane', $id);
            $lanes = &self::lanes();
            unset($lanes[$id]);
            foreach (self::menus() as $m) {
                if (in_array($id, $m['laneIds'], true)) {
                    self::putMenu([...$m, 'laneIds' => array_values(array_filter($m['laneIds'], fn($x) => $x !== $id))]);
                }
            }
            foreach (self::sortedLanes() as $i => $l) {
                self::putLane([...$l, 'order' => $i]);
            }
            if ($by) {
                Auth::audit($by, 'レーンを削除', $id);
            }
        });
    }

    public static function reorderLanes(array $ids, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($ids, $by) {
            $lanes = self::lanes();
            self::checkOrder($ids, $lanes);
            foreach ($ids as $i => $id) {
                self::putLane([...$lanes[$id], 'order' => $i]);
            }
            if ($by) {
                Auth::audit($by, 'レーンを並べ替え');
            }
            return self::sortedLanes();
        });
    }

    private static function checkOrder(array $ids, array $items): void
    {
        if (count($ids) !== count($items)) {
            throw new StoreError('invalid', '並び順の指定が正しくありません');
        }
        foreach ($ids as $id) {
            if (!isset($items[$id])) {
                throw new StoreError('invalid', '並び順の指定が正しくありません');
            }
        }
    }

    // ---- メニュー ----

    private static function validateMenu(array $m): array
    {
        $name = self::checkText('メニュー名', $m['name'], 80, true);
        $abbr = self::checkText('略称', $m['abbr'], 12, false);
        $abbr = $abbr !== '' ? $abbr : js_slice($name, 6);
        $d = $m['duration'];
        $ok = $d['kind'] === 'fixed'
            ? $d['minutes'] >= 5 && $d['minutes'] <= 720 && $d['minutes'] % 5 === 0
            : $d['min'] >= 5 && $d['max'] <= 720 && $d['min'] <= $d['max'] && $d['step'] >= 5 && $d['step'] % 5 === 0;
        if (!$ok) {
            throw new StoreError('invalid', '提供時間の設定が正しくありません（5分単位）');
        }
        $lo = $d['kind'] === 'fixed' ? $d['minutes'] : $d['min'];
        $hi = $d['kind'] === 'fixed' ? $d['minutes'] : $d['max'];
        $defaultMinutes = min($hi, max($lo, $m['defaultMinutes']));
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $m['color'])) {
            throw new StoreError('invalid', '色の指定が正しくありません');
        }
        if ($m['priceYen'] !== null && !(is_int($m['priceYen']) && $m['priceYen'] >= 0 && $m['priceYen'] <= 10_000_000)) {
            throw new StoreError('invalid', '料金の指定が正しくありません');
        }
        if ($m['capacity'] !== null && !(is_int($m['capacity']) && $m['capacity'] >= 1 && $m['capacity'] <= 99)) {
            throw new StoreError('invalid', '同時予約数の指定が正しくありません');
        }
        if (!in_array($m['startStepMin'], [5, 10, 15, 20, 30, 60], true)) {
            throw new StoreError('invalid', '開始時間の刻みが正しくありません');
        }
        $laneIds = array_values(array_unique($m['laneIds']));
        foreach ($laneIds as $lid) {
            if (!isset(self::lanes()[$lid])) {
                throw new StoreError('invalid', 'レーンが見つかりません');
            }
        }
        return [...$m, 'name' => $name, 'abbr' => $abbr, 'defaultMinutes' => $defaultMinutes, 'laneIds' => $laneIds];
    }

    public static function createMenu(array $input, ?array $by = null): array
    {
        $menu = self::validateMenu([
            'id' => new_id('menu'),
            'name' => $input['name'] ?? '',
            'abbr' => $input['abbr'] ?? '',
            'duration' => $input['duration'] ?? ['kind' => 'fixed', 'minutes' => 15],
            'defaultMinutes' => $input['defaultMinutes'] ?? 15,
            'startStepMin' => $input['startStepMin'] ?? 5,
            'priceYen' => $input['priceYen'] ?? null,
            'capacity' => $input['capacity'] ?? null,
            'laneIds' => $input['laneIds'] ?? [],
            'color' => $input['color'] ?? '#64748b',
            'order' => max([-1, ...array_column(self::menus(), 'order')]) + 1,
            'active' => $input['active'] ?? true,
        ]);
        self::putMenu($menu);
        if ($by) {
            Auth::audit($by, 'メニューを追加', $menu['id']);
        }
        return $menu;
    }

    public static function updateMenu(string $id, array $input, ?array $by = null): array
    {
        $cur = self::menus()[$id] ?? null;
        if (!$cur) {
            throw new StoreError('not_found', 'メニューが見つかりません');
        }
        $next = self::validateMenu([...$cur, ...$input, 'id' => $cur['id'], 'order' => $cur['order']]);
        self::putMenu($next);
        if ($by) {
            Auth::audit($by, 'メニューを変更', $id);
        }
        return $next;
    }

    public static function reorderMenus(array $ids, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($ids, $by) {
            $menus = self::menus();
            self::checkOrder($ids, $menus);
            foreach ($ids as $i => $id) {
                self::putMenu([...$menus[$id], 'order' => $i]);
            }
            if ($by) {
                Auth::audit($by, 'メニューを並べ替え');
            }
            return self::sortedMenus();
        });
    }

    // ---- 患者の削除（論理削除）・復元・統合 ----

    /** 重複の可能性：フリガナ・氏名・電話番号・生年月日＋フリガナの一致 */
    public static function findDuplicates(array $p): array
    {
        $out = [];
        $kana = search_key($p['kana'] ?? '');
        $name = search_key($p['name']);
        $phone = digits_only($p['phone'] ?? '');
        foreach (self::patients() as $o) {
            if ($o['id'] === $p['id'] || !empty($o['deleted'])) {
                continue;
            }
            $reasons = [];
            if ($name !== '' && search_key($o['name']) === $name) {
                $reasons[] = '氏名が同じ';
            } elseif ($kana !== '' && search_key($o['kana'] ?? '') === $kana) {
                $reasons[] = 'フリガナが同じ';
            }
            if (strlen($phone) >= 8 && digits_only($o['phone'] ?? '') === $phone) {
                $reasons[] = '電話番号が同じ';
            }
            if (!empty($p['m3ChartNo']) && ($o['m3ChartNo'] ?? null) === $p['m3ChartNo']) {
                $reasons[] = 'M3カルテ番号が同じ';
            }
            if (!empty($p['birthDate']) && ($o['birthDate'] ?? null) === $p['birthDate'] && $reasons) {
                $reasons[] = '生年月日が同じ';
            }
            if ($reasons) {
                $out[] = ['patient' => $o, 'reasons' => $reasons];
            }
            if (count($out) >= 5) {
                break;
            }
        }
        return $out;
    }

    public static function deletePatient(string $id, array $input, ?array $by = null): array
    {
        $cur = self::patient($id);
        if (!empty($cur['deleted'])) {
            throw new StoreError('invalid', 'この患者は既に削除されています');
        }
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        $reason = self::checkText('削除の理由', $input['reason'], 100, true);
        $n = self::futureActive('patientId', $id);
        if ($n > 0) {
            throw new StoreError('invalid', "今日以降の予約が{$n}件あります。予約をキャンセルするか、重複なら統合してください");
        }
        $at = now_iso();
        $deleted = ['at' => $at, 'reason' => $reason];
        if ($by) {
            $deleted['by'] = $by;
        }
        $next = [...$cur, 'deleted' => $deleted, 'version' => $cur['version'] + 1, 'updatedAt' => $at];
        self::putPatient($next);
        self::recordChange($id, ["削除（{$reason}）"], $at, $by, '患者を削除');
        return $next;
    }

    public static function restorePatient(string $id, int $version, ?array $by = null): array
    {
        $cur = self::patient($id);
        if (empty($cur['deleted'])) {
            return $cur;
        }
        if (!empty($cur['mergedInto'])) {
            throw new StoreError('invalid', '統合された患者は復元できません');
        }
        if ($cur['version'] !== $version) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        foreach (self::patients() as $p) {
            if ($p['id'] !== $id && empty($p['deleted']) && $p['chartNo'] === $cur['chartNo']) {
                throw new StoreError('invalid', '同じ診察券番号の患者がいるため復元できません');
            }
        }
        $at = now_iso();
        $next = [...$cur, 'version' => $cur['version'] + 1, 'updatedAt' => $at];
        unset($next['deleted']);
        self::putPatient($next);
        self::recordChange($id, ['削除からの復元'], $at, $by, '患者を削除から復元');
        return $next;
    }

    /** @return array{0: array, 1: array} */
    private static function mergeTargets(string $keepId, string $dupId): array
    {
        if ($keepId === $dupId) {
            throw new StoreError('invalid', '同じ患者どうしは統合できません');
        }
        $keep = self::patients()[$keepId] ?? null;
        $dup = self::patients()[$dupId] ?? null;
        if (!$keep || !$dup) {
            throw new StoreError('not_found', '患者が見つかりません');
        }
        if (!empty($keep['deleted']) || !empty($dup['deleted'])) {
            throw new StoreError('invalid', '削除された患者は統合できません');
        }
        return [$keep, $dup];
    }

    public static function previewMerge(string $keepId, string $dupId): array
    {
        [$keep, $dup] = self::mergeTargets($keepId, $dupId);
        $keepDates = array_column(self::notesOf($keepId), 'date', 'date');
        $dupNotes = self::notesOf($dupId);
        $same = array_values(array_filter(array_column($dupNotes, 'date'), fn($d) => isset($keepDates[$d])));
        sort($same);
        $filled = [];
        foreach (self::FILLABLE as $k) {
            if (empty($keep[$k]) && !empty($dup[$k])) {
                $filled[] = self::FIELD_LABEL[$k] ?? $k;
            }
        }
        return [
            'keep' => $keep,
            'dup' => $dup,
            'reservations' => count(self::reservationsOf($dupId)),
            'visitNotes' => count($dupNotes),
            'sameDayNotes' => $same,
            'filledFields' => $filled,
            'lineConflict' => !empty($keep['lineUserId']) && !empty($dup['lineUserId']) && $keep['lineUserId'] !== $dup['lineUserId'],
        ];
    }

    /**
     * 重複して登録した患者 dup を keep にまとめる（途中で失敗したら全部取り消す）。
     * 予約・日付ごとの記録を移し、空欄を補い、dup は削除扱い（mergedInto）で残す
     */
    public static function mergePatients(array $input, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($input, $by) {
            [$keep, $dup] = self::mergeTargets($input['keepId'], $input['dupId']);
            if ($keep['version'] !== $input['keepVersion'] || $dup['version'] !== $input['dupVersion']) {
                throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
            }
            $at = now_iso();
            $preview = self::previewMerge($keep['id'], $dup['id']);
            $db = Db::i();

            foreach (self::reservationsOf($dup['id']) as $r) {
                $n = [...$r, 'patientId' => $keep['id'], 'version' => $r['version'] + 1, 'updatedAt' => $at];
                if ($by) {
                    $n['updatedBy'] = $by;
                }
                self::putReservation($n);
            }
            foreach (self::notesOf($dup['id']) as $n) {
                $db->delete('visitNote', self::noteKey($dup['id'], $n['date']));
                $k = self::noteKey($keep['id'], $n['date']);
                $mine = $db->get('visitNote', $k);
                if ($mine) {
                    $merged = [
                        ...$mine,
                        'note' => implode("\n", array_filter([$mine['note'], $n['note'] !== '' ? "（統合元 診察券{$dup['chartNo']}の記録）\n{$n['note']}" : ''])),
                        'skincare' => array_values(array_unique([...$mine['skincare'], ...$n['skincare']])),
                        'version' => $mine['version'] + 1,
                        'updatedAt' => $at,
                    ];
                    if ($by) {
                        $merged['updatedBy'] = $by;
                    }
                } else {
                    $merged = [...$n, 'patientId' => $keep['id'], 'version' => $n['version'] + 1, 'updatedAt' => $at];
                }
                $db->put('visitNote', $k, $merged);
            }

            $next = $keep;
            foreach (self::FILLABLE as $f) {
                if (empty($next[$f]) && !empty($dup[$f])) {
                    $next[$f] = $dup[$f];
                }
            }
            if (empty($next['nameAlt']) && search_key($dup['name']) !== search_key($keep['name'])) {
                $next['nameAlt'] = $dup['name'];
            }
            if (empty($next['lineUserId']) && !empty($dup['lineUserId'])) {
                $next['lineUserId'] = $dup['lineUserId'];
            }
            $next['caution'] = (!empty($keep['caution']) || !empty($dup['caution'])) ? true : null;
            $next['cautionNote'] = implode("\n", array_filter([$keep['cautionNote'] ?? '', $dup['cautionNote'] ?? ''])) ?: null;
            $next['memo'] = implode("\n", array_filter([$keep['memo'] ?? '', !empty($dup['memo']) ? "（統合元 診察券{$dup['chartNo']}）{$dup['memo']}" : ''])) ?: null;
            $next['version'] = $keep['version'] + 1;
            $next['updatedAt'] = $at;
            self::putPatient(drop_null($next));

            $deleted = ['at' => $at, 'reason' => "重複のため 診察券{$keep['chartNo']}（{$keep['name']}）に統合"];
            if ($by) {
                $deleted['by'] = $by;
            }
            $d = [...$dup, 'deleted' => $deleted, 'mergedInto' => $keep['id'], 'version' => $dup['version'] + 1, 'updatedAt' => $at];
            // LINEの紐付けは統合先へ移した（または統合先のものを残した）ので外す
            unset($d['lineUserId']);
            self::putPatient($d);

            $detail = array_filter([
                "予約{$preview['reservations']}件",
                "記録{$preview['visitNotes']}日分",
                $preview['filledFields'] ? '空欄を補完（' . implode('・', $preview['filledFields']) . '）' : null,
                $preview['lineConflict'] ? 'LINEは統合先の紐付けを残した' : null,
            ]);
            self::recordChange($keep['id'], ["診察券{$dup['chartNo']}（{$dup['name']}）を統合：" . implode('、', $detail)], $at, $by, "重複患者を統合（統合元 {$dup['id']}）");
            self::recordChange($dup['id'], ["診察券{$keep['chartNo']}（{$keep['name']}）へ統合"], $at, $by, "統合先へまとめた（統合先 {$keep['id']}）");
            return self::patients()[$keep['id']];
        });
    }
}

/** 値が null の項目を除く（JavaScript の undefined の項目は JSON に出ないのと同じにする） */
function drop_null(array $a): array
{
    return array_filter($a, fn($v) => $v !== null);
}

/** JavaScript の trim() と同じ（全角空白なども除く） */
function js_trim(string $s): string
{
    return (string) preg_replace('/^[\s\x{00a0}\x{3000}\x{feff}]+|[\s\x{00a0}\x{3000}\x{feff}]+$/u', '', $s);
}

/** JavaScript の slice(0, n) と同じ（UTF-16 単位） */
function js_slice(string $s, int $n): string
{
    $u = (string) mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');
    return (string) mb_convert_encoding(substr($u, 0, $n * 2), 'UTF-8', 'UTF-16LE');
}
