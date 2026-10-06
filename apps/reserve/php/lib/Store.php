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
        'name' => '氏名', 'kana' => 'フリガナ', 'nameAlt' => '別の表記', 'phone' => '電話', 'email' => 'メール', 'postalCode' => '郵便番号', 'address' => '住所',
        'chartNo' => '診察券番号', 'm3ChartNo' => 'M3カルテ番号', 'birthDate' => '生年月日', 'caution' => '注意事項あり', 'cautionNote' => '注意事項',
        'memo' => 'メモ', 'history' => '既往歴', 'medications' => '内服歴', 'questionnaireOther' => 'その他の問診票情報', 'lineUserId' => 'LINE紐付け',
    ];
    private const FILLABLE = ['kana', 'nameAlt', 'phone', 'email', 'postalCode', 'address', 'birthDate', 'm3ChartNo'];
    public const MIN_ACTIVE_LANES = 1;
    public const MAX_ACTIVE_LANES = 30;
    private const MAX_TOTAL_LANES = 100;

    private static ?array $patients = null;
    private static ?array $lanes = null;
    private static ?array $menus = null;
    private static ?array $products = null;
    private static ?array $stages = null;
    private static ?array $seed = null;

    public static function reset(): void
    {
        self::$patients = self::$lanes = self::$menus = self::$products = self::$stages = self::$seed = null;
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
                if ($db->meta('initialized')) {
                    return; // 同時に来た別の通信が先に入れた
                }
                foreach (self::seed()['lanes'] as $l) {
                    $db->put('lane', $l['id'], $l);
                }
                foreach (self::seed()['menus'] as $m) {
                    $db->put('menu', $m['id'], $m);
                }
                $db->setMeta('initialized', true);
            });
        }
        // 予約枠時間一覧・ホームページから足したメニュー（既存のデータにも1回だけ。同じIDや同じ名前があれば足さない）
        if (!$db->meta('slotMenusSeeded')) {
            $db->transaction(function () use ($db) {
                if ($db->meta('slotMenusSeeded')) {
                    return;
                }
                $have = $db->all('menu');
                $names = [];
                foreach ($have as $m) {
                    $names[$m['name']] = true;
                }
                foreach (self::seed()['slotMenus'] ?? [] as $m) {
                    if (!isset($have[$m['id']]) && !isset($names[$m['name']])) {
                        $db->put('menu', $m['id'], $m);
                    }
                }
                $db->setMeta('slotMenusSeeded', true);
            });
        }
        // 状態（院ごとに増減できる）も同じく1回だけ入れる
        if (!$db->meta('stagesSeeded')) {
            $db->transaction(function () use ($db) {
                if ($db->meta('stagesSeeded')) {
                    return;
                }
                if ($db->count('stage') === 0) {
                    foreach (self::seed()['stages'] ?? [] as $s) {
                        $db->put('stage', $s['id'], $s);
                    }
                }
                $db->setMeta('stagesSeeded', true);
            });
        }
        // スキンケア・内服のプリセット（あとから追加した機能なので、既存のデータにも1回だけ入れる）
        if (!$db->meta('productsSeeded')) {
            $db->transaction(function () use ($db) {
                if ($db->meta('productsSeeded')) {
                    return;
                }
                if ($db->count('product') === 0) {
                    foreach (self::seed()['products'] ?? [] as $p) {
                        $db->put('product', $p['id'], $p);
                    }
                }
                $db->setMeta('productsSeeded', true);
            });
        }
        // 最初に入れた見本のスキンケア・内服（値段なし）は、料金表を候補に使うようになったので片付ける（手を加えたものは残す）
        if (!$db->meta('demoProductsRetired')) {
            $db->transaction(function () use ($db) {
                if ($db->meta('demoProductsRetired')) {
                    return;
                }
                $demo = [];
                foreach (self::seed()['products'] ?? [] as $p) {
                    $demo[$p['id']] = $p['name'];
                }
                foreach ($db->all('product') as $id => $p) {
                    if (empty($p['deleted']) && ($demo[$id] ?? null) === $p['name'] && $p['priceYen'] === null) {
                        $db->put('product', $id, [...$p, 'active' => false, 'deleted' => true]);
                    }
                }
                $db->setMeta('demoProductsRetired', true);
            });
        }
        // 書類に載せる院名・住所（あとから追加した項目なので、既存の院の設定にも1回だけ入れる）
        if (!$db->meta('docInfoSeeded')) {
            $db->transaction(function () use ($db) {
                if ($db->meta('docInfoSeeded')) {
                    return;
                }
                $seed = self::seed()['clinic'] ?? [];
                $cur = $db->meta('clinic');
                if ($cur !== null) {
                    foreach (['docName', 'address'] as $k) {
                        if (!isset($cur[$k]) && !empty($seed[$k])) {
                            $cur[$k] = $seed[$k];
                        }
                    }
                    $db->setMeta('clinic', $cur);
                }
                $db->setMeta('docInfoSeeded', true);
            });
        }
        // 自費商品の料金（スプレッドシート）：Apps Script がまだ送っていなければ、作った時点の内容を1回だけ入れる
        if (!$db->meta('sheetPricesSeeded')) {
            $sp = self::seed()['sheetPrices'] ?? null;
            $has = false;
            foreach ($sp ? $db->all('price') : [] as $p) {
                if (($p['url'] ?? null) === "sheet:{$sp['sheet']}") {
                    $has = true;
                    break;
                }
            }
            if ($sp && !$has) {
                self::receiveSheetPrices($sp['sheet'], $sp['items']);
            }
            $db->setMeta('sheetPricesSeeded', true);
        }
        // 試作で入れたサンプル患者（カルテ番号10001〜10120・電話0120-000-…）を、削除済みかどうかにかかわらず予約・記録ごと完全に消す（1回だけ）
        // （手元の試験でサンプル患者を使うときだけ、config.php の keep_sample_patients で残す）
        if (!$db->meta('samplePatientsPurgedAll') && empty(config()['keep_sample_patients'])) {
            self::purgeSamplePatients();
        }
        // 設定のバックアップ：まだ記録がなければ、今の設定を「記録を始めた時点」として残す
        self::ensureBaseline();
    }

    /** 試作のサンプル患者か（カルテ番号10001〜10120・電話0120-000-xxx の両方がそろうものだけ） */
    public static function isSamplePatient(array $p): bool
    {
        $no = (string) ($p['chartNo'] ?? '');
        return preg_match('/^0120-000-\d{3}$/', (string) ($p['phone'] ?? ''))
            && preg_match('/^1\d{4}$/', $no) && (int) $no >= 10001 && (int) $no <= 10120;
    }

    /**
     * サンプル患者を、予約・施術メモ・ファイル（中身も）・見積・同意書・カルテ・変更履歴ごと消す。
     * 問診票の回答は Google から来た本物の回答なので消さず、結びつきだけ外す。消した人数だけを操作ログに残す
     * @return array{patients: int, records: int}
     */
    public static function purgeSamplePatients(): array
    {
        $db = Db::i();
        $out = $db->transaction(function () use ($db) {
            $patients = 0;
            $records = 0;
            foreach ($db->all('patient') as $id => $p) {
                if (!self::isSamplePatient($p)) {
                    continue;
                }
                $id = (string) $id;
                foreach (['reservation', 'visitNote', 'file', 'estimate', 'consent', 'chart'] as $kind) {
                    foreach ($db->where($kind, 'k2', $id) as $rid => $rec) {
                        if ($kind === 'file') {
                            $db->deleteBlob((string) $rid);
                        }
                        $db->delete($kind, (string) $rid);
                        $records++;
                    }
                }
                foreach ($db->where('questionnaire', 'k2', $id) as $qid => $q) {
                    unset($q['patientId']);
                    $db->put('questionnaire', (string) $qid, $q);
                }
                $db->delete('patientHistory', $id);
                $db->delete('patient', $id);
                $patients++;
            }
            $db->setMeta('samplePatientsPurgedAll', ['at' => now_iso(), 'patients' => $patients, 'records' => $records]);
            if ($patients > 0) {
                Auth::audit(['id' => 'system', 'name' => 'システム'], "サンプル患者{$patients}人を、予約・記録{$records}件ごと完全に削除");
            }
            return ['patients' => $patients, 'records' => $records];
        });
        self::$patients = null;
        return $out;
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
        // 書類に載せる院の情報（空で消す）
        foreach ([['docName', '書類に載せる院名', 60], ['address', '住所', 120], ['phone', '電話番号', 30], ['issuer', '発行者', 60]] as [$k, $label, $max]) {
            if (!isset($input[$k])) {
                continue;
            }
            $v = self::checkText($label, $input[$k], $max, false);
            if ($v !== '') {
                $next[$k] = $v;
            } else {
                unset($next[$k]);
            }
        }
        if (isset($input['estimateNote'])) {
            $next['estimateNote'] = self::checkNote('見積書の注意書き', $input['estimateNote'], 2000);
        }
        if (isset($input['estimateValidDays'])) {
            $next['estimateValidDays'] = $input['estimateValidDays'];
        }
        if (isset($input['estimatePaper'])) {
            $next['estimatePaper'] = $input['estimatePaper'];
        }
        // 標準に戻すときは項目を消す
        if (isset($input['theme'])) {
            if ($input['theme'] === 'default') {
                unset($next['theme']);
            } else {
                $next['theme'] = $input['theme'];
            }
        }
        if ($next['dayStartMin'] % 5 !== 0 || $next['dayEndMin'] % 5 !== 0) {
            throw new StoreError('invalid', '時刻は5分単位で指定してください');
        }
        if ($next['dayEndMin'] - $next['dayStartMin'] < 60) {
            throw new StoreError('invalid', '閉院時間は開院時間の1時間以上あとにしてください');
        }
        Db::i()->setMeta('clinic', $next);
        self::snapshotSettings();
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

    private static function &products(): array
    {
        self::init();
        if (self::$products === null) {
            self::$products = Db::i()->all('product');
        }
        return self::$products;
    }

    private static function putProduct(array $p): void
    {
        Db::i()->put('product', $p['id'], $p);
        $all = &self::products();
        $all[$p['id']] = $p;
    }

    private static function sortedProducts(): array
    {
        return self::byOrder(array_filter(self::products(), fn($p) => empty($p['deleted'])));
    }

    /** プリセットを削除する（施術歴の記録は名前で残っているので、そのまま表示される） */
    public static function deleteProduct(string $id, ?array $by = null): void
    {
        $cur = self::products()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', 'プリセットが見つかりません');
        }
        self::putProduct([...$cur, 'active' => false, 'deleted' => true]);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'スキンケア・内服のプリセットを削除', $id);
        }
    }

    private static function validateProduct(array $p): array
    {
        $name = self::checkText('名前', $p['name'], 60, true);
        foreach (self::products() as $o) {
            if ($o['id'] !== $p['id'] && empty($o['deleted']) && search_key($o['name']) === search_key($name)) {
                throw new StoreError('invalid', '同じ名前のプリセットがあります');
            }
        }
        if ($p['priceYen'] !== null && !(is_int($p['priceYen']) && $p['priceYen'] >= 0 && $p['priceYen'] <= 10_000_000)) {
            throw new StoreError('invalid', '価格の指定が正しくありません');
        }
        return [...$p, 'name' => $name];
    }

    public static function createProduct(array $input, ?array $by = null): array
    {
        if (count(self::sortedProducts()) >= 500) {
            throw new StoreError('invalid', '登録できる数を超えています');
        }
        $p = self::validateProduct([
            'id' => new_id('prod'),
            'name' => $input['name'] ?? '',
            'category' => $input['category'] ?? 'skincare',
            'priceYen' => array_key_exists('priceYen', $input) ? $input['priceYen'] : null,
            'order' => max([-1, ...array_column(self::products(), 'order')]) + 1,
            'active' => $input['active'] ?? true,
        ]);
        self::putProduct($p);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'スキンケア・内服のプリセットを追加', $p['id']);
        }
        return $p;
    }

    public static function updateProduct(string $id, array $input, ?array $by = null): array
    {
        $cur = self::products()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', 'プリセットが見つかりません');
        }
        $next = self::validateProduct([...$cur, ...$input, 'id' => $cur['id'], 'order' => $cur['order']]);
        self::putProduct($next);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'スキンケア・内服のプリセットを変更', $id);
        }
        return $next;
    }

    public static function reorderProducts(array $ids, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($ids, $by) {
            $items = array_column(self::sortedProducts(), null, 'id');
            self::checkOrder($ids, $items);
            foreach ($ids as $i => $id) {
                self::putProduct([...$items[$id], 'order' => $i]);
            }
            self::snapshotSettings();
            if ($by) {
                Auth::audit($by, 'スキンケア・内服のプリセットを並べ替え');
            }
            return self::sortedProducts();
        });
    }

    // ---- 設定のバックアップ（自動）と復元 ----

    public const RESTORE_POINTS = [
        ['key' => '1d', 'label' => '1日前', 'days' => 1],
        ['key' => '1w', 'label' => '1週間前', 'days' => 7],
        ['key' => '1m', 'label' => '1か月前', 'days' => 30],
        ['key' => '3m', 'label' => '3か月前', 'days' => 91],
        ['key' => '6m', 'label' => '6か月前', 'days' => 182],
        ['key' => '1y', 'label' => '1年前', 'days' => 365],
    ];

    private static function settingsData(): array
    {
        return [
            'clinic' => self::clinic(),
            'lanes' => array_values(self::lanes()),
            'menus' => array_values(self::menus()),
            'stages' => array_values(self::stages()),
            'products' => array_values(self::products()),
        ];
    }

    private static function snapshots(): array
    {
        $list = array_values(Db::i()->all('settingsSnapshot'));
        usort($list, fn($a, $b) => strcmp($a['at'], $b['at']));
        return $list;
    }

    /** 記録がなければ、今の設定を「記録を始めた時点」として残す */
    private static function ensureBaseline(): void
    {
        if (Db::i()->count('settingsSnapshot') === 0) {
            Db::i()->put('settingsSnapshot', 'snap-baseline', ['id' => 'snap-baseline', 'at' => now_iso(), 'baseline' => true, 'data' => self::settingsData()]);
        }
    }

    /** 設定を変えたあとに、その時点の設定一式を保存する（1分以内は1つにまとめ、8日より前は1日1つ、400日より前は消す） */
    private static function snapshotSettings(): void
    {
        $db = Db::i();
        $now = (int) floor(microtime(true) * 1000);
        $list = self::snapshots();
        $last = end($list) ?: null;
        if ($last && empty($last['baseline']) && $now - parse_ms($last['at']) < 60_000) {
            $db->delete('settingsSnapshot', $last['id']);
        }
        $id = 'snap-' . base_convert((string) $now, 10, 36);
        $db->put('settingsSnapshot', $id, ['id' => $id, 'at' => now_iso(), 'data' => self::settingsData()]);
        $keepAll = $now - 8 * 86_400_000;
        $drop = $now - 400 * 86_400_000;
        $byDay = [];
        foreach (self::snapshots() as $s) {
            if (!empty($s['baseline'])) {
                continue;
            }
            $t = parse_ms($s['at']);
            if ($t < $drop) {
                $db->delete('settingsSnapshot', $s['id']);
            } elseif ($t < $keepAll) {
                $day = clinic_date_of($s['at']);
                if (isset($byDay[$day])) {
                    $db->delete('settingsSnapshot', $byDay[$day]);
                }
                $byDay[$day] = $s['id'];
            }
        }
    }

    private static function snapshotAt(int $t): ?array
    {
        $found = null;
        $list = self::snapshots();
        foreach ($list as $s) {
            if (!empty($s['baseline']) || parse_ms($s['at']) <= $t) {
                $found = $s;
            }
        }
        return $found ?? ($list[0] ?? null);
    }

    private static function summarize(array $d): array
    {
        $hm = fn(int $m) => intdiv($m, 60) . ':' . str_pad((string) ($m % 60), 2, '0', STR_PAD_LEFT);
        return [
            'clinic' => "{$d['clinic']['name']} " . $hm($d['clinic']['dayStartMin']) . '〜' . $hm($d['clinic']['dayEndMin']),
            'lanes' => count(array_filter($d['lanes'], fn($x) => $x['active'])),
            'menus' => count(array_filter($d['menus'], fn($x) => $x['active'])),
            'stages' => count(array_filter($d['stages'], fn($x) => empty($x['deleted']) && $x['active'])),
            'products' => count(array_filter($d['products'], fn($x) => empty($x['deleted']) && $x['active'])),
        ];
    }

    public static function listRestorePoints(): array
    {
        self::ensureBaseline();
        $now = (int) floor(microtime(true) * 1000);
        $points = [];
        foreach (self::RESTORE_POINTS as $p) {
            $t = $now - $p['days'] * 86_400_000;
            $snap = self::snapshotAt($t);
            $points[] = [
                'key' => $p['key'],
                'label' => $p['label'],
                'at' => $snap && empty($snap['baseline']) ? $snap['at'] : null,
                'available' => (bool) $snap,
                'oldest' => $snap && (!empty($snap['baseline']) || parse_ms($snap['at']) > $t),
                'summary' => $snap ? self::summarize($snap['data']) : null,
            ];
        }
        return ['current' => self::summarize(self::settingsData()), 'points' => $points];
    }

    /** 設定（診療時間・レーン・メニュー・状態・スキンケア＆内服）を、指定した時点の状態に戻す */
    public static function restoreSettings(string $key, ?array $by = null): void
    {
        self::ensureBaseline();
        Db::i()->transaction(function () use ($key, $by) {
            $point = null;
            foreach (self::RESTORE_POINTS as $p) {
                if ($p['key'] === $key) {
                    $point = $p;
                }
            }
            if (!$point) {
                throw new StoreError('invalid', '戻す時点の指定が正しくありません');
            }
            $snap = self::snapshotAt((int) floor(microtime(true) * 1000) - $point['days'] * 86_400_000);
            if (!$snap) {
                throw new StoreError('invalid', '戻せる設定の記録がありません');
            }
            $d = $snap['data'];
            Db::i()->setMeta('clinic', $d['clinic']);
            // その時点にあったものはその内容に戻す。あとから作ったものは消さずに隠す（予約・記録が参照しているため）
            $ids = array_column($d['lanes'], 'id');
            foreach ($d['lanes'] as $x) {
                self::putLane($x);
            }
            foreach (self::lanes() as $x) {
                if (!in_array($x['id'], $ids, true) && $x['active']) {
                    self::putLane([...$x, 'active' => false]);
                }
            }
            $ids = array_column($d['menus'], 'id');
            foreach ($d['menus'] as $x) {
                self::putMenu($x);
            }
            foreach (self::menus() as $x) {
                if (!in_array($x['id'], $ids, true) && $x['active']) {
                    self::putMenu([...$x, 'active' => false]);
                }
            }
            $ids = array_column($d['stages'], 'id');
            foreach ($d['stages'] as $x) {
                self::putStage($x);
            }
            foreach (self::stages() as $x) {
                if (!in_array($x['id'], $ids, true) && empty($x['deleted'])) {
                    self::putStage([...$x, 'active' => false, 'deleted' => true]);
                }
            }
            $ids = array_column($d['products'], 'id');
            foreach ($d['products'] as $x) {
                self::putProduct($x);
            }
            foreach (self::products() as $x) {
                if (!in_array($x['id'], $ids, true) && empty($x['deleted'])) {
                    self::putProduct([...$x, 'active' => false, 'deleted' => true]);
                }
            }
            if ($by) {
                Auth::audit($by, "設定を{$point['label']}の状態に戻した");
            }
            self::snapshotSettings();
        });
    }

    // ---- 状態（予約・来院済・医師待ち…。院ごとに増減できる） ----

    private static function &stages(): array
    {
        self::init();
        if (self::$stages === null) {
            self::$stages = Db::i()->all('stage');
        }
        return self::$stages;
    }

    private static function putStage(array $s): void
    {
        Db::i()->put('stage', $s['id'], $s);
        $all = &self::stages();
        $all[$s['id']] = $s;
    }

    private static function sortedStages(): array
    {
        return self::byOrder(self::stages());
    }

    /** 設定画面に出す状態（削除したものを除く） */
    private static function liveStages(): array
    {
        return array_values(array_filter(self::sortedStages(), fn($s) => empty($s['deleted'])));
    }

    /**
     * 状態を削除する。過去にその状態を付けた予約の表示のため、記録は「削除済み」として残し、
     * 設定画面と予約の詳細のボタンからは消える。「予約」は基本の状態なので削除できない
     */
    public static function deleteStage(string $id, ?array $by = null): void
    {
        $cur = self::stages()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', '状態が見つかりません');
        }
        if ($id === 'stage-booked') {
            throw new StoreError('invalid', '「予約」は基本の状態なので削除できません（使わない場合は非表示にしてください）');
        }
        if ($cur['active'] && count(array_filter(self::liveStages(), fn($x) => $x['active'])) <= 1) {
            throw new StoreError('invalid', '表示する状態は1つ以上必要です');
        }
        self::putStage([...$cur, 'active' => false, 'deleted' => true]);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, '状態を削除', $id);
        }
    }

    /** 予約の状態の表示名（自由入力ならその文字。キャンセルはそのまま） */
    public static function stageLabelOf(array $r): string
    {
        if (self::inactive($r)) {
            return self::STATUS_LABEL[$r['status']];
        }
        $s = isset($r['stageId']) ? (self::stages()[$r['stageId']] ?? null) : null;
        // 以前の版で「自由入力」を状態として選んでいた予約は、段階から決める
        if (!$s || $s['free']) {
            $s = self::stages()[self::seed()['stageForStatus'][$r['status']] ?? ''] ?? null;
        }
        $label = $s['label'] ?? self::STATUS_LABEL[$r['status']];
        return !empty($r['stageText']) ? "{$label}・{$r['stageText']}" : $label;
    }

    private static function validateStage(array $s): array
    {
        $label = self::checkText('状態の名前', $s['label'], 12, true);
        foreach (self::stages() as $o) {
            if ($o['id'] !== $s['id'] && empty($o['deleted']) && $o['label'] === $label) {
                throw new StoreError('invalid', '同じ名前の状態があります');
            }
        }
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $s['color'])) {
            throw new StoreError('invalid', '色の指定が正しくありません');
        }
        return [...$s, 'label' => $label];
    }

    public static function createStage(array $input, ?array $by = null): array
    {
        if (count(self::liveStages()) >= 60) {
            throw new StoreError('invalid', '登録できる数を超えています');
        }
        $s = self::validateStage([
            'id' => new_id('stage'),
            'label' => $input['label'] ?? '',
            'color' => $input['color'] ?? '#6366f1',
            'phase' => $input['phase'] ?? 'arrived',
            'free' => $input['free'] ?? false,
            'order' => max([-1, ...array_column(self::stages(), 'order')]) + 1,
            'active' => $input['active'] ?? true,
        ]);
        self::putStage($s);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, '状態を追加', $s['id']);
        }
        return $s;
    }

    public static function updateStage(string $id, array $input, ?array $by = null): array
    {
        $cur = self::stages()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', '状態が見つかりません');
        }
        $next = self::validateStage([...$cur, ...$input, 'id' => $cur['id'], 'order' => $cur['order']]);
        if ($cur['active'] && !$next['active'] && count(array_filter(self::liveStages(), fn($x) => $x['active'])) <= 1) {
            throw new StoreError('invalid', '表示する状態は1つ以上必要です');
        }
        self::putStage($next);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, '状態を変更', $id);
        }
        return $next;
    }

    public static function reorderStages(array $ids, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($ids, $by) {
            $items = array_column(self::liveStages(), null, 'id');
            self::checkOrder($ids, $items);
            foreach ($ids as $i => $id) {
                self::putStage([...$items[$id], 'order' => $i]);
            }
            self::snapshotSettings();
            if ($by) {
                Auth::audit($by, '状態を並べ替え');
            }
            return self::liveStages();
        });
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
        usort($items, fn($a, $b) => ($a['order'] <=> $b['order']) ?: strcmp((string) $a['id'], (string) $b['id']));
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
            'stages' => self::sortedStages(),
            'dayNotes' => (object) self::dayNotesOn($date),
        ];
    }

    // ---- Todaysメモ（日付×レーン。カレンダーの始業時間より上に出す自由記載） ----

    private static function dayNotesOn(string $date): array
    {
        $out = [];
        foreach (self::sortedLanes() as $l) {
            $n = Db::i()->get('dayNote', "{$date}|{$l['id']}");
            if (is_array($n) && ($n['text'] ?? '') !== '') {
                $out[$l['id']] = $n['text'];
            }
        }
        return $out;
    }

    public static function getDayNotes(string $date): array
    {
        self::init();
        return ['date' => $date, 'notes' => (object) self::dayNotesOn($date)];
    }

    /** Todaysメモを書き換える（空で消す） */
    public static function setDayNote(string $date, string $laneId, string $text, ?array $by = null): array
    {
        self::init();
        $lane = self::lanes()[$laneId] ?? null;
        if (!$lane) {
            throw new StoreError('not_found', 'レーンが見つかりません');
        }
        $v = self::checkNote('Todaysメモ', $text, 1000);
        $note = ['date' => $date, 'laneId' => $laneId, 'text' => $v, 'updatedAt' => now_iso()];
        if ($by) {
            $note['updatedBy'] = $by['name'];
        }
        $id = "{$date}|{$laneId}";
        $prev = Db::i()->get('dayNote', $id);
        if ((is_array($prev) ? ($prev['text'] ?? '') : '') === $v) {
            return $note;
        }
        if ($v !== '') {
            Db::i()->put('dayNote', $id, $note);
        } else {
            Db::i()->delete('dayNote', $id);
        }
        if ($by) {
            Auth::audit($by, "Todaysメモ（{$date} {$lane['name']}）を" . ($v !== '' ? '変更' : '削除'));
        }
        return $note;
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
        return ['clinic' => self::clinic(), 'lanes' => self::sortedLanes(), 'menus' => self::sortedMenus(), 'products' => self::sortedProducts(), 'stages' => self::liveStages()];
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
        if (isset($input['stageId'])) {
            $stage = self::stages()[$input['stageId']] ?? null;
            if (!$stage || !empty($stage['deleted']) || (!$stage['active'] && $stage['id'] !== ($cur['stageId'] ?? null))) {
                throw new StoreError('invalid', '状態が見つかりません');
            }
            if ($stage['free']) {
                throw new StoreError('invalid', '自由入力は文字（stageText）で指定してください');
            }
            $next['stageId'] = $stage['id'];
            $next['status'] = $stage['phase'];
            $next['stageAt'] = now_iso();
        }
        if (isset($input['stageText'])) {
            // 自由入力は状態とは別に持つ（空で消す）
            $text = self::checkText('自由入力', $input['stageText'], 20, false);
            if ($text !== '') {
                $next['stageText'] = $text;
            } else {
                unset($next['stageText']);
            }
        }
        if (!isset($input['stageId']) && isset($input['status']) && !in_array($input['status'], self::INACTIVE, true)) {
            // 段階だけを直接変えたとき（古い画面・外部連携）は、院の状態の選択を外す
            unset($next['stageId']);
            $next['stageAt'] = now_iso();
        }
        if (isset($input['stageMin'])) {
            // 後から入力するとき用（例：「10:05 来院済」を10:20に記録）
            $next['stageAt'] = to_iso(clinic_date_of($next['startAt']), $input['stageMin']);
        }
        self::putReservation($next);
        if ($by) {
            $what = array_filter([
                $timeChanged || isset($input['endAt']) ? '時間' : null,
                isset($input['laneId']) && $input['laneId'] !== $cur['laneId'] ? 'レーン' : null,
                isset($input['stageId']) ? '状態→' . self::stageLabelOf($next) : (isset($input['status']) ? '状態→' . self::STATUS_LABEL[$input['status']] : null),
                isset($input['stageText']) ? '自由入力' : null,
                isset($input['stageMin']) && !isset($input['stageId']) ? '状態の時刻' : null,
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
        if (isset($input['postalCode'])) {
            $digits = preg_replace('/[〒\s\-‐‑–—―−ーｰ]/u', '', normalize_width($input['postalCode']));
            if ($digits !== '' && !preg_match('/^\d{7}$/', $digits)) {
                throw new StoreError('invalid', '郵便番号は7桁の数字で入力してください');
            }
            $out['postalCode'] = $opt($digits === '' ? '' : substr($digits, 0, 3) . '-' . substr($digits, 3));
        }
        if (isset($input['address'])) {
            $out['address'] = $opt(self::checkText('住所', $input['address'], 200, false));
        }
        if (isset($input['chartNo'])) {
            $chartNo = js_trim(normalize_width($input['chartNo']));
            // 空欄でもよい（まだ診察券を作っていない患者）。入れるときは英数字で、ほかの患者と重ならないこと
            if ($chartNo !== '' && !preg_match('/^[A-Za-z0-9-]{1,20}$/', $chartNo)) {
                throw new StoreError('invalid', '診察券番号は英数字で入力してください');
            }
            foreach ($chartNo === '' ? [] : self::patients() as $p) {
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
                        throw new StoreError('invalid', "このM3カルテ番号は " . ($p['chartNo'] !== '' ? "診察券{$p['chartNo']}（{$p['name']}）" : "{$p['name']} さん") . "に登録されています");
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
            $out['memo'] = $opt(self::checkNote('メモ', $input['memo'], 12000));
        }
        if (isset($input['history'])) {
            $out['history'] = $opt(self::checkNote('既往歴', $input['history'], 2000));
        }
        if (isset($input['medications'])) {
            $out['medications'] = $opt(self::checkNote('内服歴', $input['medications'], 2000));
        }
        if (isset($input['questionnaireOther'])) {
            $out['questionnaireOther'] = $opt(self::checkNote('その他の問診票情報', $input['questionnaireOther'], 8000));
        }
        return $out;
    }

    // ---- ファイル（同意書のスキャン・写真・PDF・Word） ----

    public const MAX_FILE_BYTES = 10 * 1024 * 1024;
    private const FILE_TYPES = [
        'image/jpeg' => 'image', 'image/png' => 'image', 'image/webp' => 'image', 'image/heic' => 'image', 'image/heif' => 'image',
        'application/pdf' => 'pdf', 'application/msword' => 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'doc',
    ];

    /** ファイルの先頭の印で種類を確かめる（拡張子や申告だけを信じない） */
    public static function sniffType(string $b): ?string
    {
        if (str_starts_with($b, "\xFF\xD8\xFF")) {
            return 'image/jpeg';
        }
        if (str_starts_with($b, "\x89PNG")) {
            return 'image/png';
        }
        if (substr($b, 0, 4) === 'RIFF' && substr($b, 8, 4) === 'WEBP') {
            return 'image/webp';
        }
        if (substr($b, 4, 4) === 'ftyp' && in_array(substr($b, 8, 4), ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heis'], true)) {
            return 'image/heic';
        }
        if (str_starts_with($b, '%PDF-')) {
            return 'application/pdf';
        }
        if (str_starts_with($b, "\xD0\xCF\x11\xE0")) {
            return 'application/msword';
        }
        if (str_starts_with($b, "PK\x03\x04")) {
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
        return null;
    }

    private static function cleanFileName(string $name, string $type): string
    {
        $base = js_slice(clean_name((string) preg_replace('#[\\\\/:*?"<>|]#u', '_', $name)), 100);
        if ($base !== '' && !has_forbidden_chars($base)) {
            return $base;
        }
        $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic', 'application/pdf' => 'pdf', 'application/msword' => 'doc'][$type] ?? 'docx';
        return "file.{$ext}";
    }

    public static function listFiles(string $patientId, ?string $date = null): array
    {
        $out = array_values(array_filter(
            Db::i()->where('file', 'k2', $patientId),
            fn($f) => $f['patientId'] === $patientId && empty($f['deleted']) && ($date === null || $f['date'] === $date),
        ));
        usort($out, fn($a, $b) => strcmp($a['createdAt'], $b['createdAt']));
        return $out;
    }

    public static function saveFile(string $patientId, array $input, ?array $by = null): array
    {
        $p = self::patient($patientId);
        if (!empty($p['deleted'])) {
            throw new StoreError('invalid', '削除された患者にはファイルを追加できません');
        }
        if (!is_date_string($input['date'])) {
            throw new StoreError('invalid', '日付が正しくありません');
        }
        if (!empty($input['reservationId'])) {
            $r = Db::i()->get('reservation', $input['reservationId']);
            if (!$r || $r['patientId'] !== $patientId) {
                throw new StoreError('invalid', '予約が見つかりません');
            }
        }
        $bytes = $input['bytes'];
        if ($bytes === '') {
            throw new StoreError('invalid', 'ファイルが空です');
        }
        if (strlen($bytes) > self::MAX_FILE_BYTES) {
            throw new StoreError('invalid', 'ファイルが大きすぎます（10MBまで）');
        }
        $type = self::sniffType($bytes);
        if (!$type || !isset(self::FILE_TYPES[$type])) {
            throw new StoreError('invalid', '追加できるのは 写真（JPEG・PNG・WebP・HEIC）・PDF・Word です');
        }
        $id = 'f-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4));
        $meta = ['id' => $id, 'patientId' => $patientId, 'date' => $input['date']];
        if (!empty($input['reservationId'])) {
            $meta['reservationId'] = $input['reservationId'];
        }
        $meta += [
            'name' => self::cleanFileName($input['name'], $type),
            'type' => $type,
            'kind' => self::FILE_TYPES[$type],
            'size' => strlen($bytes),
            'createdAt' => now_iso(),
        ];
        if ($by) {
            $meta['createdBy'] = $by;
        }
        Db::i()->transaction(function () use ($id, $bytes, $meta) {
            Db::i()->putBlob($id, $bytes);
            Db::i()->put('file', $id, $meta);
        });
        if ($by) {
            Auth::audit($by, 'ファイルを追加', $patientId);
        }
        return $meta;
    }

    /** @return array{0: array, 1: string} */
    public static function getFile(string $id): array
    {
        $meta = Db::i()->get('file', $id);
        if (!$meta || !empty($meta['deleted'])) {
            throw new StoreError('not_found', 'ファイルが見つかりません');
        }
        $bytes = Db::i()->getBlob($id);
        if ($bytes === null) {
            throw new StoreError('not_found', 'ファイルが見つかりません');
        }
        return [$meta, $bytes];
    }

    public static function deleteFile(string $id, ?array $by = null): array
    {
        $cur = Db::i()->get('file', $id);
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', 'ファイルが見つかりません');
        }
        $deleted = ['at' => now_iso()];
        if ($by) {
            $deleted['by'] = $by;
        }
        $next = [...$cur, 'deleted' => $deleted];
        Db::i()->put('file', $id, $next);
        if ($by) {
            Auth::audit($by, 'ファイルを削除', $cur['patientId']);
        }
        return $next;
    }

    // ---- 機器の連携（ネオボワールなど。院のパソコンに置いた取り込み係が写真を送ってくる） ----

    private const DEVICE_SOURCES = ['neovoir' => 'ネオボワール', 'google' => 'Google連携（問診票・同意書・料金表）'];

    /** 連携の一覧と受け取りの状況（鍵そのものは返さない） */
    public static function deviceLinks(): array
    {
        self::init();
        $db = Db::i();
        $links = [];
        foreach ($db->all('deviceLink') as $l) {
            unset($l['tokenHash']);
            $links[] = $l;
        }
        usort($links, fn($a, $b) => strcmp($a['createdAt'], $b['createdAt']));
        $last = null;
        $devices = array_values(array_filter($links, fn($l) => $l['source'] === 'neovoir'));
        foreach ($devices as $l) {
            if (isset($l['lastUsedAt']) && ($last === null || $l['lastUsedAt'] > $last)) {
                $last = $l['lastUsedAt'];
            }
        }
        $out = ['links' => $links, 'inbox' => $db->count('photoInbox'), 'received' => array_sum(array_map(fn($l) => $l['received'], $devices))];
        if ($last !== null) {
            $out['lastReceivedAt'] = $last;
        }
        return $out;
    }

    /** 接続用の鍵を作る。鍵はこのときだけ返し、保存するのはハッシュだけ */
    public static function createDeviceLink(array $input, array $by): array
    {
        self::init();
        $source = $input['source'];
        if (!isset(self::DEVICE_SOURCES[$source])) {
            throw new StoreError('invalid', '連携できない機器です');
        }
        $name = self::checkText('名前', $input['name'] ?? '', 40, false) ?: self::DEVICE_SOURCES[$source];
        $token = ($source === 'neovoir' ? 'nv_' : 'gi_') . bin2hex(random_bytes(20));
        $id = new_id('dl');
        $link = ['id' => $id, 'source' => $source, 'name' => $name, 'createdAt' => now_iso(), 'createdBy' => $by, 'received' => 0];
        Db::i()->put('deviceLink', $id, [...$link, 'tokenHash' => hash('sha256', $token)]);
        Auth::audit($by, "機器の連携を追加：{$name}");
        return ['link' => $link, 'token' => $token];
    }

    public static function revokeDeviceLink(string $id, array $by): array
    {
        $db = Db::i();
        $l = $db->get('deviceLink', $id);
        if (!$l) {
            throw new StoreError('not_found', '連携が見つかりません');
        }
        $l['revoked'] = ['at' => now_iso(), 'by' => $by];
        $db->put('deviceLink', $id, $l);
        Auth::audit($by, "機器の連携を止める：{$l['name']}");
        unset($l['tokenHash']);
        return $l;
    }

    private const NEOVOIR_LIGHTS = ['NL', 'PL', 'SL', 'UV'];
    private const DEFAULT_DEVICE_OPTIONS = ['lights' => ['NL', 'SL'], 'maxSide' => 2000];

    /** 取り込み方（光源・縮小）を変える。取り込み係は次に起きたときから従う */
    public static function setDeviceOptions(string $id, array $options, array $by): array
    {
        $db = Db::i();
        $l = $db->get('deviceLink', $id);
        if (!$l) {
            throw new StoreError('not_found', '連携が見つかりません');
        }
        $lights = array_values(array_filter(self::NEOVOIR_LIGHTS, fn($x) => in_array($x, $options['lights'], true)));
        $l['options'] = ['lights' => $lights, 'maxSide' => $options['maxSide']];
        $db->put('deviceLink', $id, $l);
        $size = $options['maxSide'] ? "長い辺{$options['maxSide']}px に縮小" : '原寸';
        Auth::audit($by, "機器の取り込み方を変更：{$l['name']}（" . implode('・', $lights) . "、{$size}）");
        unset($l['tokenHash']);
        return $l;
    }

    public static function deviceOptionsOf(array $link): array
    {
        return $link['options'] ?? self::DEFAULT_DEVICE_OPTIONS;
    }

    /** 鍵から連携を探す（止めたもの・違う鍵は null） */
    /** 外部連携の受け取り口で使う「Google連携の鍵」。合えば最後に使った日時を残して true */
    public static function acceptIntegrationLink(string $token): bool
    {
        $l = self::deviceLinkByToken($token);
        if ($l === null || $l['source'] !== 'google') {
            return false;
        }
        $db = Db::i();
        $cur = $db->get('deviceLink', $l['id']);
        if (is_array($cur) && (!isset($cur['lastUsedAt']) || strcmp($cur['lastUsedAt'], gmdate('Y-m-d\TH:i', time() - 60)) < 0)) {
            $db->put('deviceLink', $l['id'], [...$cur, 'lastUsedAt' => now_iso()]);
        }
        return true;
    }

    public static function deviceLinkByToken(string $token): ?array
    {
        if (strlen($token) < 20) {
            return null;
        }
        $h = hash('sha256', $token);
        foreach (Db::i()->all('deviceLink') as $l) {
            if (hash_equals($l['tokenHash'], $h) && empty($l['revoked'])) {
                return $l;
            }
        }
        return null;
    }

    /** 名前で患者を探す（漢字・フリガナ・ローマ字のどれかが空白を除いて同じで、ちょうど1人のときだけ） */
    private static function matchByName(string $name): array
    {
        $key = search_key($name);
        if ($key === '') {
            return ['id' => null, 'reason' => 'not_found'];
        }
        $hits = [];
        foreach (self::patients() as $p) {
            if (!empty($p['deleted'])) {
                continue;
            }
            foreach ([$p['name'], $p['kana'] ?? '', $p['nameAlt'] ?? ''] as $x) {
                if ($x !== '' && search_key($x) === $key) {
                    $hits[] = $p['id'];
                    break;
                }
            }
        }
        return count($hits) === 1 ? ['id' => $hits[0], 'reason' => null] : ['id' => null, 'reason' => $hits ? 'ambiguous' : 'not_found'];
    }

    /**
     * 機器の顧客番号（ネオボワールの番号など）で覚えた患者を先に使い、なければ名前で探す。
     * 一度結びついた番号は覚えておくので、次からは同姓同名でも取り違えない
     */
    private static function matchPhoto(string $source, string $ref, string $name): array
    {
        if ($ref !== '') {
            $m = Db::i()->get('deviceRef', "{$source}:{$ref}");
            $p = $m ? (self::patients()[$m['patientId']] ?? null) : null;
            if ($p && empty($p['deleted'])) {
                return ['id' => $p['id'], 'reason' => null];
            }
        }
        return self::matchByName($name);
    }

    private static function rememberRef(string $source, string $ref, string $patientId): void
    {
        if ($ref !== '') {
            Db::i()->put('deviceRef', "{$source}:{$ref}", ['patientId' => $patientId, 'at' => now_iso()]);
        }
    }

    /**
     * 機器から写真を受け取る。同じ写真（中身が同じ）は2回目以降は受け取らない。
     * 名前で患者が1人に決まればその患者の写真（撮った日の記録）に、決まらなければ「照合待ち」に置く
     */
    public static function receiveDevicePhoto(array $link, array $input): array
    {
        self::init();
        $bytes = $input['bytes'];
        if ($bytes === '') {
            throw new StoreError('invalid', 'ファイルが空です');
        }
        if (strlen($bytes) > self::MAX_FILE_BYTES) {
            throw new StoreError('invalid', 'ファイルが大きすぎます（10MBまで）');
        }
        $type = self::sniffType($bytes);
        if (!$type || (self::FILE_TYPES[$type] ?? null) !== 'image') {
            throw new StoreError('invalid', '受け取れるのは写真（JPEG・PNG・WebP・HEIC）だけです');
        }
        $db = Db::i();
        $id = 'nv-' . substr(hash('sha256', $bytes), 0, 24);
        if ($db->get('file', $id) !== null || $db->get('photoInbox', $id) !== null) {
            return ['status' => 'duplicate', 'id' => $id];
        }
        $patientName = self::checkText('患者名', $input['patientName'] ?? '', 60, false);
        $takenAt = isset($input['takenAt']) && is_iso_datetime($input['takenAt']) ? normalize_iso($input['takenAt']) : null;
        $date = clinic_date_of($takenAt ?? now_iso());
        $fileName = self::cleanFileName($input['fileName'] ?? '', $type);
        $ref = is_string($input['ref'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $input['ref']) ? $input['ref'] : '';
        $match = self::matchPhoto($link['source'], $ref, $patientName);
        $by = ['id' => 'device:' . $link['id'], 'name' => $link['name']];
        $out = $db->transaction(function () use ($db, $id, $bytes, $type, $date, $fileName, $patientName, $takenAt, $match, $link, $by, $ref) {
            $db->putBlob($id, $bytes);
            $base = ['id' => $id];
            if ($match['id'] !== null) {
                $meta = $base + ['patientId' => $match['id'], 'date' => $date, 'name' => $fileName, 'type' => $type, 'kind' => 'image', 'size' => strlen($bytes), 'createdAt' => now_iso(), 'createdBy' => $by, 'source' => $link['source']];
                $db->put('file', $id, $meta);
                self::rememberRef($link['source'], $ref, $match['id']);
            } else {
                $item = $base + ['source' => $link['source'], 'patientName' => $patientName];
                if ($ref !== '') {
                    $item['ref'] = $ref;
                }
                $item['date'] = $date;
                if ($takenAt !== null) {
                    $item['takenAt'] = $takenAt;
                }
                $item += ['name' => $fileName, 'type' => $type, 'size' => strlen($bytes), 'receivedAt' => now_iso(), 'reason' => $match['reason']];
                $db->put('photoInbox', $id, $item);
            }
            $cur = $db->get('deviceLink', $link['id']);
            $db->put('deviceLink', $link['id'], [...$cur, 'lastUsedAt' => now_iso(), 'received' => $cur['received'] + 1]);
            return $match['id'] !== null ? ['status' => 'saved', 'id' => $id, 'matched' => true] : ['status' => 'inbox', 'id' => $id, 'matched' => false];
        });
        return $out;
    }

    /** 照合待ちの写真（新しい順） */
    public static function listPhotoInbox(): array
    {
        $items = array_values(Db::i()->all('photoInbox'));
        usort($items, fn($a, $b) => strcmp($b['receivedAt'], $a['receivedAt']) ?: strcmp($a['id'], $b['id']));
        return $items;
    }

    public static function photoInboxContent(string $id): array
    {
        $item = Db::i()->get('photoInbox', $id);
        $bytes = $item ? Db::i()->getBlob($id) : null;
        if (!$item || $bytes === null) {
            throw new StoreError('not_found', '写真が見つかりません');
        }
        return [$item, $bytes];
    }

    /** 照合待ちの写真を患者に結びつける（撮った日の記録に入る） */
    public static function assignPhotoInbox(string $id, string $patientId, array $by): array
    {
        $db = Db::i();
        $item = $db->get('photoInbox', $id);
        if (!$item) {
            throw new StoreError('not_found', '写真が見つかりません');
        }
        $p = self::patient($patientId);
        if (!empty($p['deleted'])) {
            throw new StoreError('invalid', '削除された患者には結びつけられません');
        }
        $meta = self::inboxToFile($item, $patientId, $by);
        $db->transaction(function () use ($db, $id, $meta, $item, $patientId) {
            $db->put('file', $id, $meta);
            $db->delete('photoInbox', $id);
            self::rememberRef($item['source'], $item['ref'] ?? '', $patientId);
        });
        Auth::audit($by, '機器の写真を患者に結びつけ', $patientId);
        return $meta;
    }

    private static function inboxToFile(array $item, string $patientId, array $by): array
    {
        return ['id' => $item['id'], 'patientId' => $patientId, 'date' => $item['date'], 'name' => $item['name'], 'type' => $item['type'], 'kind' => 'image', 'size' => $item['size'], 'createdAt' => now_iso(), 'createdBy' => $by, 'source' => $item['source']];
    }

    public static function deletePhotoInbox(string $id, array $by): void
    {
        $db = Db::i();
        if (!$db->get('photoInbox', $id)) {
            throw new StoreError('not_found', '写真が見つかりません');
        }
        $db->transaction(function () use ($db, $id) {
            $db->delete('photoInbox', $id);
            $db->deleteBlob($id);
        });
        Auth::audit($by, '照合待ちの写真を削除');
    }

    /** 照合待ちの写真を、今の患者でもう一度名前照合する（Airリザーブからの移行のあとなど） */
    public static function rematchPhotoInbox(array $by): array
    {
        self::init();
        $db = Db::i();
        $matched = 0;
        foreach (self::listPhotoInbox() as $item) {
            $m = self::matchPhoto($item['source'], $item['ref'] ?? '', $item['patientName']);
            if ($m['id'] === null) {
                if (($item['reason'] ?? null) !== $m['reason']) {
                    $db->put('photoInbox', $item['id'], [...$item, 'reason' => $m['reason']]);
                }
                continue;
            }
            $meta = self::inboxToFile($item, $m['id'], ['id' => 'system', 'name' => '名前照合']);
            $db->transaction(function () use ($db, $item, $meta, $m) {
                $db->put('file', $item['id'], $meta);
                $db->delete('photoInbox', $item['id']);
                self::rememberRef($item['source'], $item['ref'] ?? '', $m['id']);
            });
            $matched++;
        }
        if ($matched > 0) {
            Auth::audit($by, "照合待ちの写真{$matched}枚を名前照合で患者に結びつけ");
        }
        return ['matched' => $matched, 'remaining' => $db->count('photoInbox')];
    }

    // ---- Airリザーブから移した「今日以降」の予約（入れ直しのために完全に消す） ----

    private const AIR_MARK = 'Air予約番号';

    /** 今日以降の予約のうち、メモに「Air予約番号」があるもの（今日より前の予約と患者には触れない） */
    private static function airFutureReservations(): array
    {
        $today = now_in_clinic()['date'];
        return array_values(array_filter(
            Db::i()->between('reservation', 'k1', $today, '9999-12-31'),
            fn($r) => clinic_date_of($r['startAt']) >= $today && str_contains((string) ($r['memo'] ?? ''), self::AIR_MARK),
        ));
    }

    public static function countAirFutureReservations(): array
    {
        self::init();
        return ['count' => count(self::airFutureReservations()), 'from' => now_in_clinic()['date']];
    }

    public static function deleteAirFutureReservations(array $by): array
    {
        self::init();
        $db = Db::i();
        $deleted = $db->transaction(function () use ($db) {
            $n = 0;
            foreach (self::airFutureReservations() as $r) {
                $db->delete('reservation', $r['id']);
                $n++;
            }
            return $n;
        });
        $from = now_in_clinic()['date'];
        Auth::audit($by, "Airリザーブから移した{$from}以降の予約{$deleted}件を完全に削除（入れ直しのため）");
        return ['deleted' => $deleted, 'from' => $from];
    }

    // ---- 指定した患者の予約を過去・未来とも完全に消す（スタッフ予定などを誤って予約として移したときの片付け） ----

    public static function countPatientReservations(string $patientId): array
    {
        self::init();
        self::patient($patientId);
        return ['patientId' => $patientId, 'count' => count(self::reservationsOf($patientId))];
    }

    public static function deletePatientReservations(string $patientId, array $by): array
    {
        self::init();
        $p = self::patient($patientId);
        $db = Db::i();
        $deleted = $db->transaction(function () use ($db, $patientId) {
            $n = 0;
            foreach (self::reservationsOf($patientId) as $r) {
                $db->delete('reservation', $r['id']);
                $n++;
            }
            return $n;
        });
        Auth::audit($by, "{$p['name']} の予約{$deleted}件を完全に削除");
        return ['patientId' => $patientId, 'deleted' => $deleted];
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
        // 診察券番号は自動では振らない（入れなければ空欄のまま）
        $chartNoGiven = js_trim($input['chartNo'] ?? '') !== '';
        $in = ['kana' => '', ...$input];
        if (!$chartNoGiven) {
            unset($in['chartNo']);
        }
        $fields = self::patientFields($in, null);
        $now = now_iso();
        $p = drop_null([
            'id' => new_id('p-new'),
            'chartNo' => $fields['chartNo'] ?? '',
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
            'laneId' => $r['laneId'],
            'version' => $r['version'],
            'menuIds' => $r['menuIds'],
            'stageLabel' => self::stageLabelOf($r),
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
                $rows[$date] ??= ['date' => $date, 'reservations' => [], 'note' => '', 'skincare' => [], 'files' => [], 'noteVersion' => 0];
                $rows[$date]['reservations'][] = self::reservationSummary($r);
            }
        }
        foreach (self::notesOf($id) as $n) {
            $d = $n['date'];
            $rows[$d] ??= ['date' => $d, 'reservations' => [], 'note' => '', 'skincare' => [], 'files' => [], 'noteVersion' => 0];
            $rows[$d]['note'] = $n['note'];
            $rows[$d]['skincare'] = $n['skincare'];
            $rows[$d]['noteVersion'] = $n['version'];
            $rows[$d]['noteUpdatedAt'] = $n['updatedAt'];
            if (!empty($n['updatedBy'])) {
                $rows[$d]['noteUpdatedBy'] = $n['updatedBy'];
            }
        }
        foreach (self::listFiles($id) as $f) {
            if ($f['date'] <= $today) {
                $rows[$f['date']] ??= ['date' => $f['date'], 'reservations' => [], 'note' => '', 'skincare' => [], 'files' => [], 'noteVersion' => 0];
                $rows[$f['date']]['files'][] = $f;
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
            'products' => array_values(array_filter(self::sortedProducts(), fn($p) => $p['active'])),
            'menuInfo' => (object) array_map(fn($m) => ['name' => $m['name'], 'color' => $m['color']], self::menus()),
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
        $note = self::checkNote('メモ', $input['note'], 16000);
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
        self::snapshotSettings();
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
        self::snapshotSettings();
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
            self::snapshotSettings();
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
            self::snapshotSettings();
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
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'メニューを追加', $menu['id']);
        }
        return $menu;
    }

    public static function updateMenu(string $id, array $input, ?array $by = null): array
    {
        $cur = self::menus()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', 'メニューが見つかりません');
        }
        $next = self::validateMenu([...$cur, ...$input, 'id' => $cur['id'], 'order' => $cur['order']]);
        self::putMenu($next);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'メニューを変更', $id);
        }
        return $next;
    }

    /** メニューの削除：予約の選択肢・設定の一覧から消す（過去の予約・見積の表示のため記録は残す） */
    public static function deleteMenu(string $id, ?array $by = null): void
    {
        $cur = self::menus()[$id] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            throw new StoreError('not_found', 'メニューが見つかりません');
        }
        self::putMenu([...$cur, 'active' => false, 'deleted' => true]);
        self::snapshotSettings();
        if ($by) {
            Auth::audit($by, 'メニューを削除', $id);
        }
    }

    public static function reorderMenus(array $ids, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($ids, $by) {
            $menus = self::menus();
            self::checkOrder($ids, $menus);
            foreach ($ids as $i => $id) {
                self::putMenu([...$menus[$id], 'order' => $i]);
            }
            self::snapshotSettings();
            if ($by) {
                Auth::audit($by, 'メニューを並べ替え');
            }
            return self::sortedMenus();
        });
    }

    // ---- 患者の削除（論理削除）・復元・統合 ----

    /** 統合してよいかの確認：姓名・セイメイ・生年月日がすべて一致すること。一致しない項目を返す */
    public static function identityMismatch(array $a, array $b): array
    {
        $out = [];
        $same = fn($x, $y) => !empty($x) && !empty($y) && search_key((string) $x) === search_key((string) $y);
        if (!$same($a['name'] ?? '', $b['name'] ?? '')) {
            $out[] = '姓名';
        }
        if (empty($a['kana']) || empty($b['kana'])) {
            $out[] = 'セイメイ（未入力）';
        } elseif (!$same($a['kana'], $b['kana'])) {
            $out[] = 'セイメイ';
        }
        if (empty($a['birthDate']) || empty($b['birthDate'])) {
            $out[] = '生年月日（未入力）';
        } elseif ($a['birthDate'] !== $b['birthDate']) {
            $out[] = '生年月日';
        }
        return $out;
    }

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
                $mismatch = self::identityMismatch($p, $o);
                $out[] = ['patient' => $o, 'reasons' => $reasons, 'identical' => !$mismatch, 'mismatch' => $mismatch];
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
            if ($p['id'] !== $id && empty($p['deleted']) && $cur['chartNo'] !== '' && $p['chartNo'] === $cur['chartNo']) {
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
            'identical' => !self::identityMismatch($keep, $dup),
            'mismatch' => self::identityMismatch($keep, $dup),
        ];
    }

    /**
     * 重複して登録した患者 dup を keep にまとめる（途中で失敗したら全部取り消す）。
     * 予約・日付ごとの記録を移し、空欄を補い、dup は削除扱い（mergedInto）で残す
     */
    // ---- 料金表（ホームページが正本。自由入力の項目も足せる） ----

    private const PRICE_SYNC_SEC = 86400;
    private const PRICE_RETRY_SEC = 3600;

    public static function priceUrls(): array
    {
        self::init();
        return Db::i()->meta('priceUrls') ?? self::seed()['priceUrls'] ?? [];
    }

    private static function sortedPrices(): array
    {
        $items = array_values(array_filter(Db::i()->all('price'), fn($p) => empty($p['removed'])));
        $rank = fn($p) => $p['source'] === 'homepage' ? 0 : ($p['source'] === 'sheet' ? 1 : 2);
        usort($items, fn($a, $b) => ($rank($a) <=> $rank($b)) ?: ($a['order'] <=> $b['order']) ?: strcmp($a['id'], $b['id']));
        return $items;
    }

    public static function getPriceList(): array
    {
        self::init();
        $sync = Db::i()->meta('priceSync');
        $out = ['items' => self::sortedPrices(), 'urls' => self::priceUrls()];
        if ($sync) {
            $out['syncedAt'] = $sync['at'];
        }
        $out['results'] = $sync['results'] ?? [];
        $sheets = [];
        foreach (Db::i()->meta('priceSheets') ?? [] as $name => $v) {
            $sheets[] = ['name' => (string) $name, 'at' => $v['at'], 'count' => $v['count']];
        }
        usort($sheets, fn($a, $b) => strcmp($a['name'], $b['name']));
        $out['sheets'] = $sheets;
        return $out;
    }

    public static function priceSyncDue(): bool
    {
        if (!self::priceUrls()) {
            return false;
        }
        $sync = Db::i()->meta('priceSync');
        if (!$sync) {
            return true;
        }
        $failed = false;
        foreach ($sync['results'] as $r) {
            if (!$r['ok']) {
                $failed = true;
            }
        }
        return time() - (int) floor(parse_ms($sync['at']) / 1000) >= ($failed ? self::PRICE_RETRY_SEC : self::PRICE_SYNC_SEC);
    }

    public static function setPriceUrls(array $urls, ?array $by = null): array
    {
        $clean = [];
        foreach ($urls as $u) {
            $u = trim($u);
            if ($u === '' || in_array($u, $clean, true)) {
                continue;
            }
            if (!preg_match('#^https?://[^\s/]+(/\S*)?$#', $u)) {
                throw new StoreError('invalid', "ホームページのアドレスが正しくありません：{$u}");
            }
            $clean[] = $u;
        }
        Db::i()->setMeta('priceUrls', $clean);
        if ($by) {
            Auth::audit($by, '料金表の取り込み元を変更');
        }
        return $clean;
    }

    private static function priceId(string $url, string $category, string $name, string $prefix = 'hp-'): string
    {
        return $prefix . substr(sha1("{$url}\n{$category}\n{$name}"), 0, 12);
    }

    /**
     * スプレッドシート（Apps Script）から送られてきた料金で、そのシートの分を入れ替える。
     * 送られてこなかった項目は候補に出さない
     */
    public static function receiveSheetPrices(string $sheet, array $items): array
    {
        self::init();
        return Db::i()->transaction(function () use ($sheet, $items) {
            $db = Db::i();
            $name0 = self::checkText('シート名', $sheet, 60, true);
            $url = "sheet:{$name0}";
            $at = now_iso();
            $all = $db->all('price');
            $seen = [];
            $order = 0;
            foreach ($items as $it) {
                $name = self::checkText('項目名', $it['name'], 120, false);
                if ($name === '') {
                    continue;
                }
                $category = self::checkText('分類', $it['category'], 60, false);
                if ($category === '') {
                    $category = 'その他';
                }
                $id = self::priceId($url, $category, $name, 'sh-');
                for ($n = 2; isset($seen[$id]); $n++) {
                    $id = self::priceId($url, $category, "{$name}#{$n}", 'sh-');
                }
                $seen[$id] = true;
                $text = js_trim($it['priceText'] ?? '');
                if ($text === '') {
                    $text = self::priceTextOf($it['priceYen']);
                }
                $cur = $all[$id] ?? null;
                $kind = $it['kind'] ?? null;
                $same = $cur && $cur['priceYen'] === $it['priceYen'] && $cur['priceText'] === $text && ($cur['kind'] ?? null) === $kind && empty($cur['removed']);
                $next = ['id' => $id, 'source' => 'sheet', 'category' => $category, 'name' => $name];
                if ($kind !== null) {
                    $next['kind'] = $kind;
                }
                $next += [
                    'priceYen' => $it['priceYen'], 'priceText' => $text, 'url' => $url,
                    'order' => $order++, 'updatedAt' => $same ? $cur['updatedAt'] : $at,
                ];
                if ($cur !== $next) {
                    $db->put('price', $id, $next);
                }
            }
            foreach ($all as $p) {
                if ($p['source'] === 'sheet' && ($p['url'] ?? null) === $url && !isset($seen[$p['id']]) && empty($p['removed'])) {
                    $db->put('price', $p['id'], [...$p, 'removed' => true, 'updatedAt' => $at]);
                }
            }
            $sheets = $db->meta('priceSheets') ?? [];
            $sheets[$name0] = ['at' => $at, 'count' => count($seen)];
            $db->setMeta('priceSheets', $sheets);
            return ['sheet' => $name0, 'count' => count($seen), 'at' => $at];
        });
    }

    private static function fetchPricePage(string $url): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'reserve-price-sync',
        ]);
        $html = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($html)) {
            return ['url' => $url, 'error' => '読み込めませんでした（通信エラー）'];
        }
        if ($status < 200 || $status >= 300) {
            return ['url' => $url, 'error' => "読み込めませんでした（{$status}）"];
        }
        if (strlen($html) > 3 * 1024 * 1024) {
            return ['url' => $url, 'error' => 'ページが大きすぎます'];
        }
        $items = PriceParse::parse($html);
        if (!$items) {
            return ['url' => $url, 'error' => '料金表が見つかりませんでした'];
        }
        return ['url' => $url, 'items' => $items];
    }

    /** ホームページから料金表を取り込む。読めなかったページの項目はそのまま残す */
    public static function syncPrices(?array $by = null): array
    {
        self::init();
        $pages = array_map([self::class, 'fetchPricePage'], self::priceUrls());
        Db::i()->transaction(function () use ($pages) {
            $db = Db::i();
            $all = $db->all('price');
            $at = now_iso();
            $results = [];
            $order = 0;
            foreach ($pages as $page) {
                if (!isset($page['items'])) {
                    $results[] = ['url' => $page['url'], 'ok' => false, 'count' => 0, 'error' => $page['error'] ?? '読み込めませんでした'];
                    foreach ($all as $p) {
                        if ($p['source'] === 'homepage' && ($p['url'] ?? null) === $page['url'] && empty($p['removed'])) {
                            $order = max($order, $p['order'] + 1);
                        }
                    }
                    continue;
                }
                $seen = [];
                foreach ($page['items'] as $it) {
                    $id = self::priceId($page['url'], $it['category'], $it['name']);
                    for ($n = 2; isset($seen[$id]); $n++) {
                        $id = self::priceId($page['url'], $it['category'], "{$it['name']}#{$n}");
                    }
                    $seen[$id] = true;
                    $cur = $all[$id] ?? null;
                    $same = $cur && $cur['priceYen'] === $it['priceYen'] && $cur['priceText'] === $it['priceText'] && empty($cur['removed']);
                    $next = [
                        'id' => $id, 'source' => 'homepage', 'category' => $it['category'], 'name' => $it['name'],
                        'priceYen' => $it['priceYen'], 'priceText' => $it['priceText'], 'url' => $page['url'],
                        'order' => $order++, 'updatedAt' => $same ? $cur['updatedAt'] : $at,
                    ];
                    if ($cur !== $next) {
                        $db->put('price', $id, $next);
                        $all[$id] = $next;
                    }
                }
                // ホームページから消えた項目は候補に出さない
                foreach ($all as $p) {
                    if ($p['source'] === 'homepage' && ($p['url'] ?? null) === $page['url'] && !isset($seen[$p['id']]) && empty($p['removed'])) {
                        $p = [...$p, 'removed' => true, 'updatedAt' => $at];
                        $db->put('price', $p['id'], $p);
                        $all[$p['id']] = $p;
                    }
                }
                $results[] = ['url' => $page['url'], 'ok' => true, 'count' => count($seen)];
            }
            // 取り込み元から外したページの項目も候補に出さない
            $urls = array_column($pages, 'url');
            foreach ($all as $p) {
                if ($p['source'] === 'homepage' && !empty($p['url']) && !in_array($p['url'], $urls, true) && empty($p['removed'])) {
                    $db->put('price', $p['id'], [...$p, 'removed' => true, 'updatedAt' => $at]);
                }
            }
            $db->setMeta('priceSync', ['at' => $at, 'results' => $results]);
        });
        if ($by) {
            Auth::audit($by, '料金表をホームページから取り込み');
        }
        return self::getPriceList();
    }

    public static function syncPricesIfDue(): void
    {
        if (self::priceSyncDue()) {
            self::syncPrices();
        }
    }

    private static function priceTextOf(?int $yen): string
    {
        return $yen === null ? '' : number_format($yen) . '円';
    }

    public static function createPriceItem(array $input, ?array $by = null): array
    {
        self::init();
        $manual = array_filter(Db::i()->all('price'), fn($p) => $p['source'] === 'manual');
        if (count($manual) >= 500) {
            throw new StoreError('invalid', '登録できる数を超えています');
        }
        $category = self::checkText('分類', $input['category'] ?? '', 60, false);
        $name = self::checkText('項目名', $input['name'] ?? '', 120, true);
        $yen = $input['priceYen'] ?? null;
        $p = [
            'id' => 'price-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4)),
            'source' => 'manual',
            'category' => $category !== '' ? $category : 'その他',
            'name' => $name,
            'priceYen' => $yen,
            'priceText' => self::priceTextOf($yen),
            'order' => ($manual ? max(array_map(fn($x) => $x['order'], $manual)) : -1) + 1,
            'updatedAt' => now_iso(),
        ];
        Db::i()->put('price', $p['id'], $p);
        if ($by) {
            Auth::audit($by, '料金表に項目を追加');
        }
        return $p;
    }

    private static function manualPrice(string $id): array
    {
        $cur = Db::i()->get('price', $id);
        if (!$cur || !empty($cur['removed'])) {
            throw new StoreError('not_found', '料金が見つかりません');
        }
        if ($cur['source'] !== 'manual') {
            throw new StoreError('invalid', 'ホームページから取り込んだ料金は、ホームページで直してください');
        }
        return $cur;
    }

    public static function updatePriceItem(string $id, array $input, ?array $by = null): array
    {
        self::init();
        $next = [...self::manualPrice($id), 'updatedAt' => now_iso()];
        if (isset($input['category'])) {
            $c = self::checkText('分類', $input['category'], 60, false);
            $next['category'] = $c !== '' ? $c : 'その他';
        }
        if (isset($input['name'])) {
            $next['name'] = self::checkText('項目名', $input['name'], 120, true);
        }
        if (array_key_exists('priceYen', $input)) {
            $next['priceYen'] = $input['priceYen'];
            $next['priceText'] = self::priceTextOf($input['priceYen']);
        }
        Db::i()->put('price', $id, $next);
        if ($by) {
            Auth::audit($by, '料金表の項目を変更');
        }
        return $next;
    }

    public static function deletePriceItem(string $id, ?array $by = null): void
    {
        self::init();
        self::manualPrice($id);
        Db::i()->delete('price', $id);
        if ($by) {
            Auth::audit($by, '料金表の項目を削除');
        }
    }

    // ---- 同意書（ひな形は Google ドキュメントが正本。差し込み・署名はこのソフトの中で行う） ----

    private static function templateMeta(array $t): array
    {
        unset($t['html']);
        return $t;
    }

    public static function listConsentTemplates(): array
    {
        self::init();
        $out = array_values(array_map([self::class, 'templateMeta'], array_filter(Db::i()->all('consentTemplate'), fn($t) => empty($t['removed']))));
        usort($out, fn($a, $b) => strcmp($a['title'], $b['title']) ?: strcmp($a['id'], $b['id']));
        return $out;
    }

    public static function consentTemplatesReceivedAt(): ?string
    {
        self::init();
        return Db::i()->meta('consentTemplatesAt');
    }

    public static function getConsentTemplate(string $id): array
    {
        self::init();
        $t = Db::i()->get('consentTemplate', $id);
        if (!$t || !empty($t['removed'])) {
            throw new StoreError('not_found', '同意書のひな形が見つかりません');
        }
        return $t;
    }

    /** 同意書フォルダから送られてきたひな形で入れ替える。メニューとの結びつけは残す */
    public static function receiveConsentTemplates(array $templates): array
    {
        self::init();
        return Db::i()->transaction(function () use ($templates) {
            $db = Db::i();
            $at = now_iso();
            $all = $db->all('consentTemplate');
            $seen = [];
            foreach ($templates as $t) {
                $id = "ct-{$t['driveId']}";
                if (isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $cur = $all[$id] ?? null;
                $title = self::checkText('同意書の名前', $t['title'], 120, true);
                if ($cur && empty($cur['removed']) && $cur['title'] === $title && $cur['modifiedTime'] === $t['modifiedTime'] && $cur['html'] === $t['html']) {
                    continue;
                }
                $db->put('consentTemplate', $id, [
                    'id' => $id, 'driveId' => $t['driveId'], 'title' => $title, 'modifiedTime' => $t['modifiedTime'],
                    'menuIds' => $cur['menuIds'] ?? [], 'receivedAt' => $at, 'html' => $t['html'],
                ]);
            }
            $removed = 0;
            foreach ($all as $t) {
                // ファイルから取り込んだひな形は、ドライブのフォルダにないので消さない
                if (!isset($seen[$t['id']]) && empty($t['removed']) && !self::isUploadedTemplate($t)) {
                    $db->put('consentTemplate', $t['id'], [...$t, 'removed' => true, 'receivedAt' => $at]);
                    $removed++;
                }
            }
            $db->setMeta('consentTemplatesAt', $at);
            return ['count' => count($seen), 'removed' => $removed, 'at' => $at];
        });
    }

    /** ファイル（Word・HTML・Googleドキュメントの書き出し）から取り込んだひな形か */
    public static function isUploadedTemplate(array $t): bool
    {
        return str_starts_with($t['driveId'], 'upload-');
    }

    /** ファイルから同意書のひな形を取り込む。同じ名前のものは入れ替える（メニューとの結びつけは残す） */
    public static function importConsentTemplates(array $templates, ?array $by = null): array
    {
        self::init();
        Db::i()->transaction(function () use ($templates) {
            $at = now_iso();
            foreach ($templates as $t) {
                $title = self::checkText('同意書の名前', $t['title'], 120, true);
                $driveId = 'upload-' . substr(sha1(search_key($title)), 0, 16);
                $id = "ct-{$driveId}";
                $cur = Db::i()->get('consentTemplate', $id);
                Db::i()->put('consentTemplate', $id, [
                    'id' => $id, 'driveId' => $driveId, 'title' => $title, 'modifiedTime' => $at,
                    'menuIds' => $cur['menuIds'] ?? [], 'receivedAt' => $at, 'html' => $t['html'],
                ]);
            }
        });
        if ($by) {
            Auth::audit($by, '同意書のひな形をファイルから取り込み（' . count($templates) . '件）');
        }
        return ['count' => count($templates)];
    }

    public static function deleteConsentTemplate(string $id, ?array $by = null): void
    {
        self::init();
        $t = self::getConsentTemplate($id);
        if (!self::isUploadedTemplate($t)) {
            throw new StoreError('invalid', 'Googleドライブのひな形は、ドライブのフォルダから消してください');
        }
        Db::i()->put('consentTemplate', $id, [...$t, 'removed' => true]);
        if ($by) {
            Auth::audit($by, "同意書のひな形「{$t['title']}」を削除");
        }
    }

    /** 共有されたGoogleスプレッドシート（CSV）・ドキュメント（HTML）を読む。患者の情報は送らない */
    public static function fetchGoogleExport(string $input): array
    {
        $target = google_export_url($input);
        if (!$target) {
            throw new StoreError('invalid', 'Googleスプレッドシートかドキュメントの共有リンクを入れてください');
        }
        $url = $target['url'];
        $denied = '読み込めませんでした。共有の設定を「リンクを知っている全員（閲覧者）」にしてください';
        for ($i = 0; $i < 6; $i++) {
            $host = (string) parse_url($url, PHP_URL_HOST);
            if (!allowed_google_host($host) || parse_url($url, PHP_URL_SCHEME) !== 'https') {
                throw new StoreError('invalid', $denied);
            }
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_HEADER => false,
                CURLOPT_USERAGENT => 'reserve-import',
            ]);
            $body = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $next = (string) curl_getinfo($ch, CURLINFO_REDIRECT_URL);
            curl_close($ch);
            if (!is_string($body)) {
                throw new StoreError('invalid', '読み込めませんでした（通信エラー）');
            }
            if ($status >= 300 && $status < 400 && $next !== '') {
                $url = $next;
                continue;
            }
            if ($status < 200 || $status >= 300) {
                throw new StoreError('invalid', $denied);
            }
            if (strlen($body) > 5_000_000) {
                throw new StoreError('invalid', '大きすぎて読み込めません（5MBまで）');
            }
            return ['kind' => $target['kind'], 'text' => $body];
        }
        throw new StoreError('invalid', '読み込めませんでした（転送が多すぎます）');
    }

    public static function setConsentTemplateMenus(string $id, array $menuIds, ?array $by = null): array
    {
        $t = self::getConsentTemplate($id);
        $ids = array_values(array_unique($menuIds));
        foreach ($ids as $m) {
            if (!isset(self::menus()[$m])) {
                throw new StoreError('invalid', 'メニューが見つかりません');
            }
        }
        $t['menuIds'] = $ids;
        Db::i()->put('consentTemplate', $id, $t);
        if ($by) {
            Auth::audit($by, "同意書「{$t['title']}」のメニューを変更");
        }
        return self::templateMeta($t);
    }

    private static function consentSummary(array $c): array
    {
        unset($c['html'], $c['signature']);
        return $c;
    }

    public static function listConsents(string $patientId): array
    {
        self::init();
        $out = array_values(array_map([self::class, 'consentSummary'], array_filter(
            Db::i()->where('consent', 'k2', $patientId),
            fn($c) => $c['patientId'] === $patientId && empty($c['deleted']),
        )));
        usort($out, fn($a, $b) => strcmp($b['date'], $a['date']) ?: strcmp($b['createdAt'], $a['createdAt']));
        return $out;
    }

    public static function createConsent(string $patientId, array $input, ?array $by = null): array
    {
        self::init();
        $p = self::patient($patientId);
        if (!empty($p['deleted'])) {
            throw new StoreError('invalid', '削除された患者には同意書を作れません');
        }
        $t = self::getConsentTemplate($input['templateId']);
        $treatment = isset($input['treatment']) ? self::checkText('施術名', $input['treatment'], 120, false) : '';
        if (!empty($input['reservationId'])) {
            $r = Db::i()->get('reservation', $input['reservationId']);
            if (!$r || $r['patientId'] !== $patientId) {
                throw new StoreError('invalid', '予約が見つかりません');
            }
            if (!isset($input['treatment'])) {
                $treatment = implode('、', array_values(array_filter(array_map(fn($m) => self::menus()[$m]['name'] ?? '', $r['menuIds']))));
            }
        }
        $rec = ['id' => 'cs-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4)), 'patientId' => $patientId];
        if (!empty($input['reservationId'])) {
            $rec['reservationId'] = $input['reservationId'];
        }
        $rec += ['templateId' => $t['id'], 'title' => $t['title'], 'templateModifiedTime' => $t['modifiedTime'], 'date' => $input['date'] ?? now_in_clinic()['date']];
        if ($treatment !== '') {
            $rec['treatment'] = $treatment;
        }
        $rec['signed'] = !empty($input['signature']);
        if (!empty($input['signature'])) {
            $rec['signature'] = $input['signature'];
        }
        $rec['createdAt'] = now_iso();
        if ($by) {
            $rec['createdBy'] = $by;
        }
        $rec['html'] = $t['html'];
        Db::i()->put('consent', $rec['id'], $rec);
        if ($by) {
            Auth::audit($by, "同意書「{$t['title']}」を" . ($rec['signed'] ? '署名して保存' : '発行（紙で署名）'), $patientId);
        }
        return self::consentSummary($rec);
    }

    public static function getConsentView(string $id): array
    {
        self::init();
        $c = Db::i()->get('consent', $id);
        if (!$c || !empty($c['deleted'])) {
            throw new StoreError('not_found', '同意書が見つかりません');
        }
        $p = self::patient($c['patientId']);
        $html = $c['html'];
        unset($c['html']);
        return [
            'record' => $c,
            'html' => $html,
            'patient' => drop_null(['id' => $p['id'], 'name' => $p['name'], 'kana' => $p['kana'], 'chartNo' => $p['chartNo'], 'birthDate' => $p['birthDate'] ?? null]),
            'clinic' => self::clinic(),
        ];
    }

    public static function deleteConsent(string $id, ?array $by = null): void
    {
        self::init();
        $c = Db::i()->get('consent', $id);
        if (!$c || !empty($c['deleted'])) {
            throw new StoreError('not_found', '同意書が見つかりません');
        }
        $deleted = ['at' => now_iso()];
        if ($by) {
            $deleted['by'] = $by;
        }
        Db::i()->put('consent', $id, [...$c, 'deleted' => $deleted]);
        if ($by) {
            Auth::audit($by, "同意書「{$c['title']}」を削除", $c['patientId']);
        }
    }

    // ---- 同意書の読み込み元（その時々にドライブから最新を読む） ----

    public static function consentSource(): ?array
    {
        self::init();
        $s = Db::i()->meta('consentSource');
        return $s && !empty($s['url']) ? $s : null;
    }

    public static function consentSourceInfo(): array
    {
        $s = self::consentSource();
        return ['url' => $s['url'] ?? '', 'hasKey' => !empty($s['key'])];
    }

    public static function setConsentSource(array $input, ?array $by = null): array
    {
        $url = js_trim($input['url']);
        // https のみ（動作確認用に手元の 127.0.0.1 だけ http を許す）
        if ($url !== '' && !preg_match('#^(https://[^\s/]+|http://127\.0\.0\.1(:\d+)?)(/\S*)?$#', $url)) {
            throw new StoreError('invalid', '読み込み元のアドレスは https:// で始まるものにしてください');
        }
        $cur = self::consentSource();
        $key = isset($input['key']) ? js_trim($input['key']) : ($cur['key'] ?? '');
        if ($url !== '' && $key === '') {
            throw new StoreError('invalid', '合言葉（キー）を入れてください');
        }
        Db::i()->setMeta('consentSource', $url !== '' ? ['url' => $url, 'key' => $key] : null);
        if ($by) {
            Auth::audit($by, '同意書の読み込み元を変更');
        }
        return self::consentSourceInfo();
    }

    private static function callConsentSource(array $params): mixed
    {
        $src = self::consentSource();
        if (!$src) {
            throw new RuntimeException('no source');
        }
        $sep = str_contains($src['url'], '?') ? '&' : '?';
        $url = $src['url'] . $sep . http_build_query(['key' => $src['key']] + $params);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 5,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => $params['action'] === 'list' ? 10 : 20,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $status < 200 || $status >= 300 || strlen($body) > 4_000_000) {
            throw new RuntimeException('fetch failed');
        }
        return json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    }

    private static function validConsentHead(mixed $t): bool
    {
        return is_array($t) && is_string($t['driveId'] ?? null) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $t['driveId'])
            && is_string($t['title'] ?? null) && $t['title'] !== '' && js_length($t['title']) <= 200
            && is_string($t['modifiedTime'] ?? null) && strlen($t['modifiedTime']) <= 40;
    }

    /** 一覧をドライブとそろえる。読めなければ前回のまま。読めたら true */
    public static function refreshConsentList(): bool
    {
        if (!self::consentSource()) {
            return false;
        }
        try {
            $list = self::callConsentSource(['action' => 'list']);
            if (!is_array($list) || !array_is_list($list)) {
                return false;
            }
            foreach ($list as $t) {
                if (!self::validConsentHead($t)) {
                    return false;
                }
            }
            Db::i()->transaction(function () use ($list) {
                $db = Db::i();
                $all = $db->all('consentTemplate');
                $at = now_iso();
                $seen = [];
                foreach ($list as $t) {
                    $id = "ct-{$t['driveId']}";
                    if (isset($seen[$id])) {
                        continue;
                    }
                    $seen[$id] = true;
                    $title = self::checkText('同意書の名前', $t['title'], 120, true);
                    $cur = $all[$id] ?? null;
                    if ($cur && empty($cur['removed']) && $cur['title'] === $title) {
                        continue;
                    }
                    $db->put('consentTemplate', $id, [
                        'id' => $id, 'driveId' => $t['driveId'], 'title' => $title, 'modifiedTime' => $cur['modifiedTime'] ?? $t['modifiedTime'],
                        'menuIds' => $cur['menuIds'] ?? [], 'receivedAt' => $cur['receivedAt'] ?? $at, 'html' => $cur['html'] ?? '',
                    ]);
                }
                foreach ($all as $t) {
                    if (!isset($seen[$t['id']]) && empty($t['removed']) && !self::isUploadedTemplate($t)) {
                        $db->put('consentTemplate', $t['id'], [...$t, 'removed' => true]);
                    }
                }
                $db->setMeta('consentTemplatesAt', $at);
            });
            return true;
        } catch (Throwable) {
            return false;
        }
    }

    /** 本文をドライブから読む。読めなければ前回読めた本文（stale: true） */
    public static function loadConsentTemplate(string $id): array
    {
        $cached = self::getConsentTemplate($id);
        // ファイルから取り込んだひな形は、ドライブから読み込まない
        if (!self::consentSource() || self::isUploadedTemplate($cached)) {
            return $cached;
        }
        try {
            $doc = self::callConsentSource(['action' => 'doc', 'id' => $cached['driveId']]);
            if (!self::validConsentHead($doc) || !is_string($doc['html'] ?? null) || js_length($doc['html']) > 400_000 || $doc['driveId'] !== $cached['driveId']) {
                throw new RuntimeException('bad doc');
            }
            $title = self::checkText('同意書の名前', $doc['title'], 120, true);
            $next = [
                'id' => $id, 'driveId' => $doc['driveId'], 'title' => $title, 'modifiedTime' => $doc['modifiedTime'],
                'menuIds' => $cached['menuIds'] ?? [], 'receivedAt' => now_iso(), 'html' => $doc['html'],
            ];
            if ($cached['title'] !== $title || $cached['modifiedTime'] !== $doc['modifiedTime'] || $cached['html'] !== $doc['html']) {
                Db::i()->put('consentTemplate', $id, $next);
                return $next;
            }
            return $cached;
        } catch (Throwable) {
            return [...$cached, 'stale' => true];
        }
    }

    // ---- 見積書 ----

    private const MAX_ESTIMATE_YEN = 100_000_000;
    private const DEFAULT_ESTIMATE_VALID_DAYS = 30;

    /** 見積の行を確かめて整える（メニュー・スキンケアは登録にあるものだけ） */
    private static function checkEstimateLines(array $lines): array
    {
        $out = [];
        foreach ($lines as $l) {
            if ($l['kind'] === 'menu' && (empty($l['refId']) || !isset(self::menus()[$l['refId']]))) {
                throw new StoreError('invalid', 'メニューが見つかりません');
            }
            if ($l['kind'] === 'product' && (empty($l['refId']) || !isset(self::products()[$l['refId']]))) {
                throw new StoreError('invalid', 'スキンケア＆内服が見つかりません');
            }
            $name = self::checkText('項目名', $l['name'], 120, true);
            $row = ['kind' => $l['kind']];
            if ($l['kind'] !== 'custom') {
                $row['refId'] = $l['refId'];
            }
            $out[] = $row + ['name' => $name, 'unitYen' => $l['unitYen'], 'qty' => $l['qty']];
        }
        return $out;
    }

    private static function estimateTotal(array $lines): int
    {
        $total = 0;
        foreach ($lines as $l) {
            $total += $l['unitYen'] * $l['qty'];
        }
        if ($total < 0) {
            throw new StoreError('invalid', '合計がマイナスになっています（割引が大きすぎます）');
        }
        if ($total > self::MAX_ESTIMATE_YEN) {
            throw new StoreError('invalid', '合計が大きすぎます');
        }
        return $total;
    }

    private static function checkEstimateDates(string $date, string $validUntil): void
    {
        if (strcmp($validUntil, $date) < 0) {
            throw new StoreError('invalid', '有効期限は発行日より後にしてください');
        }
    }

    public static function listEstimates(string $patientId): array
    {
        self::init();
        $out = array_values(array_filter(
            Db::i()->where('estimate', 'k2', $patientId),
            fn($e) => $e['patientId'] === $patientId && empty($e['deleted']),
        ));
        usort($out, fn($a, $b) => strcmp($b['date'], $a['date']) ?: strcmp($b['no'], $a['no']));
        return $out;
    }

    private static function liveEstimate(string $id): array
    {
        $e = Db::i()->get('estimate', $id);
        if (!$e || !empty($e['deleted'])) {
            throw new StoreError('not_found', '見積書が見つかりません');
        }
        return $e;
    }

    public static function getEstimateView(string $id): array
    {
        self::init();
        $e = self::liveEstimate($id);
        $p = self::patient($e['patientId']);
        return [
            'estimate' => $e,
            'patient' => drop_null(['id' => $p['id'], 'name' => $p['name'], 'kana' => $p['kana'], 'chartNo' => $p['chartNo'], 'birthDate' => $p['birthDate'] ?? null]),
            'clinic' => self::clinic(),
        ];
    }

    public static function createEstimate(string $patientId, array $input, ?array $by = null): array
    {
        self::init();
        $e = Db::i()->transaction(function () use ($patientId, $input, $by) {
            $p = self::patient($patientId);
            if (!empty($p['deleted'])) {
                throw new StoreError('invalid', '削除された患者には見積書を作れません');
            }
            if (!empty($input['reservationId'])) {
                $r = Db::i()->get('reservation', $input['reservationId']);
                if (!$r || $r['patientId'] !== $patientId) {
                    throw new StoreError('invalid', '予約が見つかりません');
                }
            }
            $date = $input['date'] ?? now_in_clinic()['date'];
            $validUntil = $input['validUntil'] ?? add_days($date, self::clinic()['estimateValidDays'] ?? self::DEFAULT_ESTIMATE_VALID_DAYS);
            self::checkEstimateDates($date, $validUntil);
            $lines = self::checkEstimateLines($input['lines']);
            $note = isset($input['note']) ? self::checkNote('備考', $input['note'], 1000) : '';
            // 見積番号は発行年ごとの通し番号
            $year = substr($date, 0, 4);
            $seqs = Db::i()->meta('estimateSeq') ?? [];
            $n = ($seqs[$year] ?? 0) + 1;
            $seqs[$year] = $n;
            Db::i()->setMeta('estimateSeq', $seqs);
            $e = [
                'id' => 'est-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4)),
                'no' => $year . '-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT),
                'patientId' => $patientId,
            ];
            if (!empty($input['reservationId'])) {
                $e['reservationId'] = $input['reservationId'];
            }
            $e += ['date' => $date, 'validUntil' => $validUntil, 'lines' => $lines, 'totalYen' => self::estimateTotal($lines)];
            if ($note !== '') {
                $e['note'] = $note;
            }
            $e['createdAt'] = now_iso();
            if ($by) {
                $e['createdBy'] = $by;
            }
            $e['version'] = 1;
            Db::i()->put('estimate', $e['id'], $e);
            return $e;
        });
        if ($by) {
            Auth::audit($by, "見積書を作成（No.{$e['no']}）", $patientId);
        }
        return $e;
    }

    public static function updateEstimate(string $id, array $input, ?array $by = null): array
    {
        self::init();
        $cur = self::liveEstimate($id);
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        $next = $cur;
        if (isset($input['date'])) {
            $next['date'] = $input['date'];
        }
        if (isset($input['validUntil'])) {
            $next['validUntil'] = $input['validUntil'];
        }
        self::checkEstimateDates($next['date'], $next['validUntil']);
        if (isset($input['lines'])) {
            $next['lines'] = self::checkEstimateLines($input['lines']);
            $next['totalYen'] = self::estimateTotal($next['lines']);
        }
        if (isset($input['note'])) {
            $note = self::checkNote('備考', $input['note'], 1000);
            if ($note !== '') {
                $next['note'] = $note;
            } else {
                unset($next['note']);
            }
        }
        $next['version'] = $cur['version'] + 1;
        $next['updatedAt'] = now_iso();
        if ($by) {
            $next['updatedBy'] = $by;
        }
        Db::i()->put('estimate', $id, $next);
        if ($by) {
            Auth::audit($by, "見積書を変更（No.{$next['no']}）", $next['patientId']);
        }
        return $next;
    }

    public static function deleteEstimate(string $id, array $input, ?array $by = null): array
    {
        self::init();
        $cur = self::liveEstimate($id);
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        $deleted = ['at' => now_iso()];
        if ($by) {
            $deleted['by'] = $by;
        }
        $next = [...$cur, 'deleted' => $deleted, 'version' => $cur['version'] + 1];
        Db::i()->put('estimate', $id, $next);
        if ($by) {
            Auth::audit($by, "見積書を削除（No.{$cur['no']}）", $cur['patientId']);
        }
        return $next;
    }

    // ---- 問診票（Googleフォームなどから。患者の情報はこちらからは送らない） ----

    private const FORBIDDEN_ALL = '/[\x{0000}-\x{001f}\x{007f}-\x{009f}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u';
    private const FORBIDDEN_EXCEPT_NL = '/[\x{0000}-\x{0009}\x{000b}-\x{001f}\x{007f}-\x{009f}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u';

    /** 外から来た1行の文字：使えない文字を外して長さをそろえる */
    private static function extLine(?string $v, int $max): string
    {
        return js_trim(js_slice(clean_name((string) preg_replace(self::FORBIDDEN_ALL, ' ', $v ?? '')), $max));
    }

    /** 外から来た複数行の文字 */
    private static function extBlock(?string $v, int $max): string
    {
        $s = str_replace(["\r\n", "\r"], "\n", normalize_nfc($v ?? ''));
        return js_trim(js_slice(js_trim((string) preg_replace(self::FORBIDDEN_EXCEPT_NL, '', $s)), $max));
    }

    /** 氏名（またはフリガナ）が合い、さらに生年月日か電話番号（10桁以上）が合う患者がちょうど1人のときだけ結びつける */
    private static function matchQuestionnaire(string $name, string $kana, ?string $birthDate, string $phone): ?string
    {
        $keys = array_values(array_filter([search_key($name), search_key($kana)], fn($k) => $k !== ''));
        if (!$keys) {
            return null;
        }
        $tel = digits_only($phone);
        $hits = [];
        foreach (self::patients() as $p) {
            if (!empty($p['deleted'])) {
                continue;
            }
            $nameHit = false;
            foreach ([$p['name'], $p['kana'] ?? '', $p['nameAlt'] ?? ''] as $x) {
                if ($x !== '' && in_array(search_key($x), $keys, true)) {
                    $nameHit = true;
                }
            }
            if (!$nameHit) {
                continue;
            }
            if (($birthDate !== null && ($p['birthDate'] ?? null) === $birthDate) || (strlen($tel) >= 10 && digits_only($p['phone'] ?? '') === $tel)) {
                $hits[] = $p['id'];
            }
        }
        return count($hits) === 1 ? $hits[0] : null;
    }

    public static function receiveQuestionnaires(array $responses): array
    {
        self::init();
        return Db::i()->transaction(function () use ($responses) {
            $known = [];
            foreach (Db::i()->all('questionnaire') as $q) {
                $known[$q['key']] = true;
            }
            $out = ['received' => 0, 'matched' => 0, 'unmatched' => 0, 'duplicates' => 0];
            foreach ($responses as $r) {
                $key = js_trim($r['key']);
                if (isset($known[$key])) {
                    $out['duplicates']++;
                    continue;
                }
                $known[$key] = true;
                $birthDate = !empty($r['birthDate']) && is_date_string($r['birthDate']) ? $r['birthDate'] : null;
                $name = self::extLine($r['name'], 60);
                $name = $name !== '' ? $name : '（氏名なし）';
                $kana = self::extLine($r['kana'] ?? '', 60);
                $phone = self::extLine($r['phone'] ?? '', 30);
                $patientId = self::matchQuestionnaire($name, $kana, $birthDate, $phone);
                $answers = [];
                foreach ($r['answers'] as $a) {
                    $qq = self::extLine($a['q'], 200);
                    $aa = self::extBlock($a['a'], 2000);
                    if ($qq !== '' && $aa !== '') {
                        $answers[] = ['q' => $qq, 'a' => $aa];
                    }
                }
                $q = [
                    'id' => 'qn-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4)),
                    'key' => $key,
                    'patientId' => $patientId,
                    'submittedAt' => self::extLine($r['submittedAt'], 40),
                    'name' => $name,
                    'kana' => $kana !== '' ? $kana : null,
                    'birthDate' => $birthDate,
                    'phone' => $phone !== '' ? $phone : null,
                ];
                foreach (['history', 'medications', 'allergies'] as $f) {
                    $v = self::extBlock($r[$f] ?? '', 2000);
                    $q[$f] = $v !== '' ? $v : null;
                }
                $q['answers'] = $answers;
                $q['receivedAt'] = now_iso();
                $q = drop_null($q);
                Db::i()->put('questionnaire', $q['id'], $q);
                if ($patientId) {
                    self::fillPatientFromQuestionnaire($patientId, $q);
                }
                $out['received']++;
                $patientId ? $out['matched']++ : $out['unmatched']++;
            }
            return $out;
        });
    }

    private static function sortQuestionnaires(array $list): array
    {
        usort($list, fn($a, $b) => strcmp($b['submittedAt'], $a['submittedAt']) ?: strcmp($b['receivedAt'], $a['receivedAt']));
        return $list;
    }

    public static function listQuestionnaires(string $patientId): array
    {
        self::init();
        return self::sortQuestionnaires(array_values(array_filter(
            Db::i()->where('questionnaire', 'k2', $patientId),
            fn($q) => ($q['patientId'] ?? null) === $patientId && empty($q['deleted']),
        )));
    }

    public static function listUnmatchedQuestionnaires(): array
    {
        self::init();
        return self::sortQuestionnaires(array_values(array_filter(
            Db::i()->where('questionnaire', 'k2', ''),
            fn($q) => empty($q['patientId']) && empty($q['deleted']),
        )));
    }

    private static function liveQuestionnaire(string $id): array
    {
        $q = Db::i()->get('questionnaire', $id);
        if (!$q || !empty($q['deleted'])) {
            throw new StoreError('not_found', '問診票が見つかりません');
        }
        return $q;
    }

    public static function linkQuestionnaire(string $id, string $chartNo, ?array $by = null): array
    {
        self::init();
        $q = self::liveQuestionnaire($id);
        $no = js_trim($chartNo);
        $found = null;
        foreach ($no === '' ? [] : self::patients() as $p) {
            if (empty($p['deleted']) && $p['chartNo'] === $no) {
                $found = $p;
                break;
            }
        }
        if (!$found) {
            throw new StoreError('invalid', 'その診察券番号の患者が見つかりません');
        }
        $next = [...$q, 'patientId' => $found['id']];
        if ($by) {
            $next['linkedBy'] = $by;
        }
        Db::i()->put('questionnaire', $id, $next);
        if ($by) {
            Auth::audit($by, '問診票を患者に結びつけ', $found['id']);
        }
        self::fillPatientFromQuestionnaire($found['id'], $next);
        return $next;
    }

    // 問診票の見出しの見分け（questionnaire.gs の COLUMNS と同じ考え方。Node.js 版と同じ）
    private const Q_KNOWN = '/タイムスタンプ|timestamp|回答日時|お名前|氏名|名前|フリガナ|ふりがな|カナ|生年月日|電話|既往|病歴|治療中の病気|かかっている病気|内服|服用|飲んでいる薬|お薬|アレルギー|住所|郵便番号|〒|メール|e-?mail/iu';
    private const Q_NONE = '/^(なし|無し|ない|無い|特になし|特に無し|特にない|特にありません|ありません|いいえ|no|none|n\/a|[-ー－―]+)[。．.]?$/iu';

    /** 「なし」などの回答は写さない */
    private static function answered(?string $v): bool
    {
        return $v !== null && $v !== '' && !preg_match(self::Q_NONE, (string) preg_replace('/[\s　]/u', '', $v));
    }

    /**
     * 結びついた問診票の回答を患者の基本情報へ写す（院長の決定：患者の欄が空のときだけ）。
     * 住所・電話 → 連絡先情報、アレルギー → 注意事項、既往歴・内服歴、どれにも当てはまらない回答 → その他の問診票情報（日付付きで足す）
     */
    private static function fillPatientFromQuestionnaire(string $patientId, array $q): void
    {
        $cur = self::patients()[$patientId] ?? null;
        if (!$cur || !empty($cur['deleted'])) {
            return;
        }
        $find = function (string $re, ?string $not = null) use ($q): ?string {
            foreach ($q['answers'] as $x) {
                if (preg_match($re, $x['q']) && !($not && preg_match($not, $x['q']))) {
                    return $x['a'];
                }
            }
            return null;
        };
        $address = $find('/住所/u', '/メール|郵便/u');
        $postal = $find('/郵便番号|〒/u', '/メール/u');
        if ($address !== null && preg_match('/^〒?\s*([0-9０-９]{3}[-－ー‐]?[0-9０-９]{4})\s*/u', $address, $m)) {
            $postal = $postal ?: $m[1];
            $address = substr($address, strlen($m[0]));
        }
        $wanted = [];
        if (empty($cur['phone']) && !empty($q['phone'])) {
            $wanted['phone'] = $q['phone'];
        }
        if (empty($cur['postalCode']) && $postal) {
            $wanted['postalCode'] = $postal;
        }
        if (empty($cur['address']) && self::answered($address)) {
            $wanted['address'] = (string) preg_replace('/\s*\n\s*/u', ' ', $address);
        }
        if (empty($cur['history']) && self::answered($q['history'] ?? null)) {
            $wanted['history'] = $q['history'];
        }
        if (empty($cur['medications']) && self::answered($q['medications'] ?? null)) {
            $wanted['medications'] = $q['medications'];
        }
        if (empty($cur['cautionNote']) && self::answered($q['allergies'] ?? null)) {
            $wanted['caution'] = true;
            $wanted['cautionNote'] = js_slice('アレルギー：' . $q['allergies'], 500);
        }
        $other = [];
        foreach ($q['answers'] as $x) {
            if (!preg_match(self::Q_KNOWN, $x['q']) && self::answered($x['a'])) {
                $other[] = "{$x['q']}：{$x['a']}";
            }
        }
        if ($other) {
            $block = '【問診票 ' . js_slice($q['submittedAt'], 10) . "】\n" . implode("\n", $other);
            $prev = $cur['questionnaireOther'] ?? '';
            $wanted['questionnaireOther'] = js_slice($prev !== '' ? "{$prev}\n\n{$block}" : $block, 8000);
        }
        // 形の合わない値（電話番号の形など）は、その項目だけ写さない
        $ok = [];
        foreach ($wanted as $k => $v) {
            try {
                self::patientFields([$k => $v], $patientId);
                $ok[$k] = $v;
            } catch (StoreError) {
                // 写さない
            }
        }
        if (!$ok) {
            return;
        }
        self::updatePatient($patientId, [...$ok, 'version' => $cur['version']], ['id' => 'questionnaire', 'name' => '問診票（自動取り込み）']);
    }

    public static function deleteQuestionnaire(string $id, ?array $by = null): void
    {
        self::init();
        $q = self::liveQuestionnaire($id);
        $deleted = ['at' => now_iso()];
        if ($by) {
            $deleted['by'] = $by;
        }
        Db::i()->put('questionnaire', $id, [...$q, 'deleted' => $deleted]);
        if ($by) {
            Auth::audit($by, '問診票を削除', $q['patientId'] ?? null);
        }
    }

    // ---- カルテ（施術記録） ----

    /** 入力を検査して、保存する項目にそろえる（空の項目は持たない） */
    private static function chartFields(array $input, ?array $cur = null): array
    {
        $pick = fn(string $k) => array_key_exists($k, $input) ? $input[$k] : ($cur[$k] ?? '');
        $out = [
            'treatment' => self::checkText('施術名', $input['treatment'] ?? $cur['treatment'] ?? '', 120, true),
            'drugs' => array_map(function ($d) {
                $o = ['name' => self::checkText('薬剤名', $d['name'], 80, true)];
                $lot = self::checkText('ロット番号', $d['lot'] ?? '', 40, false);
                $amount = self::checkText('使用量', $d['amount'] ?? '', 40, false);
                if ($lot !== '') {
                    $o['lot'] = $lot;
                }
                if ($amount !== '') {
                    $o['amount'] = $amount;
                }
                return $o;
            }, $input['drugs'] ?? $cur['drugs'] ?? []),
        ];
        $vals = [
            'area' => self::checkText('部位', $pick('area'), 200, false),
            'settings' => self::checkNote('条件', $pick('settings'), 1000),
            'anesthesia' => self::checkText('麻酔', $pick('anesthesia'), 100, false),
            'findings' => self::checkNote('所見・経過', $pick('findings'), 8000),
            'nextPlan' => self::checkText('次回の予定', $pick('nextPlan'), 200, false),
            'operator' => self::checkText('施術者', $pick('operator'), 60, false),
        ];
        foreach ($vals as $k => $v) {
            if ($v !== '') {
                $out[$k] = $v;
            }
        }
        return $out;
    }

    public static function listCharts(string $patientId): array
    {
        self::init();
        $out = array_values(array_filter(
            Db::i()->where('chart', 'k2', $patientId),
            fn($c) => $c['patientId'] === $patientId && empty($c['deleted']),
        ));
        usort($out, fn($a, $b) => strcmp($b['date'], $a['date']) ?: strcmp($a['createdAt'], $b['createdAt']));
        return $out;
    }

    private static function liveChart(string $id): array
    {
        $c = Db::i()->get('chart', $id);
        if (!$c || !empty($c['deleted'])) {
            throw new StoreError('not_found', 'カルテが見つかりません');
        }
        return $c;
    }

    public static function createChart(string $patientId, array $input, ?array $by = null): array
    {
        self::init();
        $p = self::patient($patientId);
        if (!empty($p['deleted'])) {
            throw new StoreError('invalid', '削除された患者にはカルテを書けません');
        }
        if (!empty($input['reservationId'])) {
            $r = Db::i()->get('reservation', $input['reservationId']);
            if (!$r || $r['patientId'] !== $patientId) {
                throw new StoreError('invalid', '予約が見つかりません');
            }
        }
        $c = [
            'id' => 'chart-' . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . '-' . bin2hex(random_bytes(4)),
            'patientId' => $patientId,
            'date' => $input['date'],
        ];
        if (!empty($input['reservationId'])) {
            $c['reservationId'] = $input['reservationId'];
        }
        $c += self::chartFields($input);
        $c['createdAt'] = now_iso();
        if ($by) {
            $c['createdBy'] = $by;
        }
        $c['version'] = 1;
        Db::i()->put('chart', $c['id'], $c);
        if ($by) {
            Auth::audit($by, "カルテを記入（{$c['date']} {$c['treatment']}）", $patientId);
        }
        return $c;
    }

    public static function updateChart(string $id, array $input, ?array $by = null): array
    {
        self::init();
        $cur = self::liveChart($id);
        if ($cur['version'] !== $input['version']) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        $next = ['id' => $cur['id'], 'patientId' => $cur['patientId'], 'date' => $input['date'] ?? $cur['date']];
        if (!empty($cur['reservationId'])) {
            $next['reservationId'] = $cur['reservationId'];
        }
        $next += self::chartFields($input, $cur);
        $next['createdAt'] = $cur['createdAt'];
        if (!empty($cur['createdBy'])) {
            $next['createdBy'] = $cur['createdBy'];
        }
        $next['updatedAt'] = now_iso();
        if ($by) {
            $next['updatedBy'] = $by;
        }
        $next['version'] = $cur['version'] + 1;
        Db::i()->put('chart', $id, $next);
        if ($by) {
            Auth::audit($by, "カルテを変更（{$next['date']} {$next['treatment']}）", $next['patientId']);
        }
        return $next;
    }

    /** カルテの削除：書いた本人か、管理操作のできるスタッフだけ */
    public static function deleteChart(string $id, int $version, array $staff): array
    {
        self::init();
        $cur = self::liveChart($id);
        if (!$staff['canManage'] && ($cur['createdBy']['id'] ?? null) !== $staff['id']) {
            throw new AuthError('forbidden', '書いた本人か、管理操作のできるスタッフだけが削除できます');
        }
        if ($cur['version'] !== $version) {
            throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
        }
        $actor = Auth::actorOf($staff);
        $next = [...$cur, 'deleted' => ['at' => now_iso(), 'by' => $actor], 'version' => $cur['version'] + 1];
        Db::i()->put('chart', $id, $next);
        Auth::audit($actor, "カルテを削除（{$cur['date']} {$cur['treatment']}）", $cur['patientId']);
        return $next;
    }

    public static function mergePatients(array $input, ?array $by = null): array
    {
        return Db::i()->transaction(function () use ($input, $by) {
            [$keep, $dup] = self::mergeTargets($input['keepId'], $input['dupId']);
            if ($keep['version'] !== $input['keepVersion'] || $dup['version'] !== $input['dupVersion']) {
                throw new StoreError('version_conflict', '他の端末で先に更新されました。画面を開き直してください');
            }
            $mismatch = self::identityMismatch($keep, $dup);
            if ($mismatch) {
                throw new StoreError('invalid', '姓名・セイメイ・生年月日がすべて一致する患者だけ統合できます（一致しない項目：' . implode('・', $mismatch) . '）');
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

            // 写真・同意書などのファイルと見積書を移す
            foreach ($db->where('file', 'k2', $dup['id']) as $f) {
                if ($f['patientId'] === $dup['id']) {
                    $db->put('file', $f['id'], [...$f, 'patientId' => $keep['id']]);
                }
            }
            foreach ($db->where('consent', 'k2', $dup['id']) as $c) {
                if ($c['patientId'] === $dup['id']) {
                    $db->put('consent', $c['id'], [...$c, 'patientId' => $keep['id']]);
                }
            }
            foreach ($db->where('estimate', 'k2', $dup['id']) as $e) {
                if ($e['patientId'] === $dup['id']) {
                    $ne = [...$e, 'patientId' => $keep['id'], 'version' => $e['version'] + 1, 'updatedAt' => $at];
                    if ($by) {
                        $ne['updatedBy'] = $by;
                    }
                    $db->put('estimate', $e['id'], $ne);
                }
            }
            foreach ($db->where('questionnaire', 'k2', $dup['id']) as $q) {
                if (($q['patientId'] ?? null) === $dup['id']) {
                    $db->put('questionnaire', $q['id'], [...$q, 'patientId' => $keep['id']]);
                }
            }
            foreach ($db->where('chart', 'k2', $dup['id']) as $c) {
                if ($c['patientId'] === $dup['id']) {
                    $nc = [...$c, 'patientId' => $keep['id'], 'version' => $c['version'] + 1, 'updatedAt' => $at];
                    if ($by) {
                        $nc['updatedBy'] = $by;
                    }
                    $db->put('chart', $c['id'], $nc);
                }
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
            $next['history'] = implode("\n", array_filter([$keep['history'] ?? '', $dup['history'] ?? ''])) ?: null;
            $next['medications'] = implode("\n", array_filter([$keep['medications'] ?? '', $dup['medications'] ?? ''])) ?: null;
            $next['questionnaireOther'] = implode("\n\n", array_filter([$keep['questionnaireOther'] ?? '', $dup['questionnaireOther'] ?? ''])) ?: null;
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

/** Google スプレッドシート・ドキュメントの共有リンク → 書き出しのアドレス（Node.js 版の googleExportUrl と同じ） */
function google_export_url(string $input): ?array
{
    $u = parse_url(trim($input));
    if (!is_array($u) || ($u['scheme'] ?? '') !== 'https' || ($u['host'] ?? '') !== 'docs.google.com' || isset($u['user']) || isset($u['port'])) {
        return null;
    }
    $path = ($u['path'] ?? '') . '/';
    $gid = preg_match('/(?:^|[#&?])gid=(\d{1,12})/', '?' . ($u['query'] ?? '') . '#' . ($u['fragment'] ?? ''), $g) ? $g[1] : '0';
    if (preg_match('#^/spreadsheets/d/e/([A-Za-z0-9_-]{10,200})/#', $path, $m)) {
        return ['kind' => 'sheet', 'url' => "https://docs.google.com/spreadsheets/d/e/{$m[1]}/pub?output=csv&gid={$gid}"];
    }
    if (preg_match('#^/spreadsheets/d/([A-Za-z0-9_-]{10,200})/#', $path, $m)) {
        return ['kind' => 'sheet', 'url' => "https://docs.google.com/spreadsheets/d/{$m[1]}/export?format=csv&gid={$gid}"];
    }
    if (preg_match('#^/document/d/e/([A-Za-z0-9_-]{10,200})/#', $path, $m)) {
        return ['kind' => 'doc', 'url' => "https://docs.google.com/document/d/e/{$m[1]}/pub"];
    }
    if (preg_match('#^/document/d/([A-Za-z0-9_-]{10,200})/#', $path, $m)) {
        return ['kind' => 'doc', 'url' => "https://docs.google.com/document/d/{$m[1]}/export?format=html"];
    }
    return null;
}

function allowed_google_host(string $host): bool
{
    return $host === 'docs.google.com' || preg_match('/^[a-z0-9-]+\.googleusercontent\.com$/', $host) === 1;
}

/** JavaScript の slice(0, n) と同じ（UTF-16 単位） */
function js_slice(string $s, int $n): string
{
    $u = (string) mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');
    return (string) mb_convert_encoding(substr($u, 0, $n * 2), 'UTF-8', 'UTF-16LE');
}
