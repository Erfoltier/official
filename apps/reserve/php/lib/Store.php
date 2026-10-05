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
        // 設定のバックアップ：まだ記録がなければ、今の設定を「記録を始めた時点」として残す
        self::ensureBaseline();
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
        if (!$cur) {
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
            'identical' => !self::identityMismatch($keep, $dup),
            'mismatch' => self::identityMismatch($keep, $dup),
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
