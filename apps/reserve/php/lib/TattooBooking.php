<?php
/**
 * タトゥー・アートメイク除去（日曜の不定期診療）の Web 予約。オンラインカウンセリング（OnlineCs）と同じ作り。
 * 院が開けた受付日時（設定 → 院の情報、1行に1つ「2026-12-06 10:00-13:00」）の中で、
 * 照射面積から決まる時間の枠を、予約の前後に隙間ができる時刻だけ出す（受付時間帯の空きの「最初」と、後ろに予約がある空きの「最後」だけ）。
 * 初診は照射の前に説明10分を取る。説明は隣のレーン（看護師）で照射の直前に取り、空いていなければ照射のレーンに続けて取る。
 * 患者向けの画面・文言に「詰める」などの仕組みは出さない。選べる時刻だけを見せる。
 *
 * 日曜メニュー（sundayMenus）：タトゥー以外にも、院が日曜の受付を許可したメニューを同じ予約ページで選べる（院長 11/19）。
 * 1つごとに、受け付けるか（オン・オフ）・患者に見せる名前・初診と再診それぞれの時間（分。0 なら受けない）・レーン（複数なら空いているほう）・予約に付けるメニュー・機器の名前。
 * 一度も保存していないときは、予約枠時間一覧（スプレッドシート）から作ったプリセット（PRESETS。すべてオフ）を出す。
 * 選べる時刻の決め方はタトゥーと同じ（空きの最初と、後ろに予約がある空きの最後）。同じ機器の名前のメニュー同士は、レーンが違っても同じ時刻に入れない。
 */
declare(strict_types=1);

final class TattooBooking
{
    /** 初診の説明の時間（分） */
    public const EXPLAIN_MINUTES = 10;
    /** 初診の予約を受ける先の期間（か月）。再診は受付日時を開けた分だけ */
    public const FIRST_VISIT_MONTHS = 2;
    public const ACTOR = ['id' => 'web-tattoo', 'name' => 'Web予約（タトゥー除去・日曜）'];
    /** 1辺の上限（cm）と、1か所の面積の上限（cm²） */
    private const MAX_SIDE = 100.0;
    /** 日曜メニューの数の上限と、1回の時間の上限（分） */
    public const MAX_ITEMS = 40;
    private const MAX_ITEM_MINUTES = 180;
    /** 日曜のご来院の案内（院長の文面 11/18）。予約ページ・確定メール・リマインド（タトゥー除去のメニューの予約）で同じ文を出す */
    public const VISIT_NOTICE = [
        '日曜日は表のシャッターが閉まっております。建物左側面の駐車場に沿った奥に「美容皮膚科予約済の方専用入口」と掲示された扉がございますので、そちらからお入りください。',
        'この日は受付がおりませんので、到着されましたら当院の LINE に「到着済」とご送信いただき、待合室におかけになってお待ちください。',
        'ご予約の時間は「ご来院時間のご予約」です。前の方の処置の状況や混雑により、お呼び出しが遅れる場合がございます。後のご予定には十分に余裕をもってお越しください。',
    ];

    /** ご来院前のお願い（院長の指示 11/19）：照射する部位の産毛は剃ってくる。眉は周りの産毛だけ（ホームページの「照射前の準備」と同じ文） */
    public const SHAVE_NOTICE = [
        'tattoo' => '照射部位の産毛は、ご来院前にご自身で剃ってきてください。',
        'artmake' => '眉の周りの産毛は、ご来院前にご自身で剃ってきてください（眉毛そのものは剃らないでください）。',
    ];
    /** キャンセル・日程変更にかかる料金規定（ホームページの料金ページ https://ishidahihuka.jp/service/price/ の「注意事項」と同じ文。院長 11/19） */
    public const CANCEL_POLICY = [
        '前々日の14時まで：無料',
        '前々日14時～前日：施術料金の20％、または施術予定メニューが決まっていない方は3,000円',
        '当日：施術料金の50％、または施術予定メニューが決まっていない方は8,000円。コース契約中の方は1回分消化',
        '悪質なキャンセルや無断キャンセルは、次回以降のご予約をお断りします。',
        'キャンセル料は次回来院時にお支払いください。',
    ];
    /** 予約ページ（除去するものを選ぶ前にも出す）の文 */
    public const SHAVE_NOTICE_PAGE = '照射部位の産毛は、ご来院前にご自身で剃ってきてください。眉のアートメイクの方は眉の周りの産毛だけを剃り、眉毛そのものは剃らないでください。';

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
            // LINE の中でこのページを開く LIFF アプリの ID（LINE Developers で作る。エンドポイントは …/tattoo/）。空なら LINE を使わない
            'liffId' => (string) ($c['tattooLiffId'] ?? ''),
            'machine' => (string) ($c['tattooMachine'] ?? ''),
            // 日曜メニューのうち、タトゥー除去・アートメイク除去をそれぞれ受け付けるか（省くとオン）
            'tattooOn' => ($c['tattooKindOn'] ?? true) !== false,
            'artmakeOn' => ($c['artmakeKindOn'] ?? true) !== false,
            // タトゥー除去・アートメイク除去の分類（予約ページで分類を選ぶときの名前）
            'removalCategory' => (string) ($c['removalCategory'] ?? '') !== '' ? (string) $c['removalCategory'] : self::REMOVAL_CATEGORY,
            // 予約ページに出す順（"tattoo"・"artmake"・日曜メニューの id）。ないものは後ろに今の順で
            'order' => array_values(array_filter((array) ($c['sundayOrder'] ?? []), 'is_string')),
            // タトゥー以外に日曜に受け付けるメニュー（normalizeItems の形）。まだ保存していなければプリセット
            // 分類を入れる前（11/19）に保存したものは、見本の分類を使う
            'items' => array_key_exists('sundayMenus', $c)
                ? array_map(
                    fn($it) => array_key_exists('category', $it) ? $it : $it + ['category' => self::PRESET_CATEGORY[$it['id']] ?? ''],
                    array_values(array_filter((array) $c['sundayMenus'], fn($it) => is_array($it) && !empty($it['id'])))
                )
                : self::presets(),
        ];
    }

    public const REMOVAL_CATEGORY = '除去・レーザー';
    /** プリセットの分類（院長 11/19：まず分類を選び、次にメニュー） */
    private const PRESET_CATEGORY = [
        'botox' => '注射・注入', 'hyperhidrosis' => '注射・注入', 'hyaluronic' => '注射・注入', 'juvelook' => '注射・注入', 'babycollagen' => '注射・注入',
        'miraclel' => '注射・注入', 'fatx' => '注射・注入', 'sunekos' => '注射・注入', 'fillroad' => '注射・注入', 'tapink' => '注射・注入',
        'pinkglow' => '注射・注入', 'tranestamp' => '注射・注入', 'juveacell' => '注射・注入', 're2o' => '注射・注入',
        'hokuro' => '除去・レーザー', 'dyelaser' => '除去・レーザー', 'isotretinoin' => '内服・ご相談', 'oral' => '内服・ご相談', 'zoskin' => '内服・ご相談',
        'tcapeel' => 'ピーリング', 'amalfi' => 'ピーリング', 'massagepeel' => 'ピーリング', 'milano' => 'ピーリング', 'salicylic' => 'ピーリング',
        'laserhair' => '脱毛', 'needlehair' => '脱毛',
    ];
    private const M = 'lane-main';
    private const N = ['lane-1', 'lane-3'];
    private const MEMO = 'menu-s000099DC1'; // 予約（メモに自由記載）
    private const CONSULT = 'menu-s0000BB7B7'; // 完全初診
    /**
     * 日曜メニューのプリセット（11/19、スプレッドシート「予約枠時間一覧」のシート1・公開治療メニュー照合_20260820・予約エンジンルールから）。すべてオフ。
     * [id, 名前, 初診の分, 初診のレーン, 初診のメニュー, 再診の分, 再診のレーン, 再診のメニュー, ご来院前のお願い]
     * 初診は医師の診察の枠だけ（メイン）。看護師の施術は1番・3番。
     * 入れていないもの：麻酔の後に施術が続くもの（ダーマペン・ヴェルヴェット・炭酸ガス・モニター）、時間が部位や方式で決まるもの（脱毛・ハイフ・トラネ・ピンクグロー・フィルロード）、
     * 「要承認」のもの（Qスイッチルビー・リトゥオ／ジュブアセル・たるみ・外用剤）、予約の要らない商品購入
     */
    private const PRESETS = [
        ['botox', 'ボトックス注射', 20, [self::M], 'menu-s0000C1A4E', 10, [self::M], 'menu-s00009A18E', ''],
        ['hyperhidrosis', '多汗症ボトックス', 20, [self::M], 'menu-s0000C1A4E', 15, [self::M], 'menu-s00009A18E', ''],
        ['hyaluronic', 'ヒアルロン酸注射', 30, [self::M], 'menu-s00009A0D8', 20, [self::M], 'menu-s00009A0D8', ''],
        ['juvelook', 'ジュベルックボリューム', 30, [self::M], self::MEMO, 20, [self::M], self::MEMO, ''],
        ['babycollagen', 'ベビーコラーゲン', 30, [self::M], self::MEMO, 20, [self::M], self::MEMO, ''],
        ['miraclel', 'ミラクルL注射', 30, [self::M], 'menu-s00009A0D8', 20, [self::M], 'menu-s00009A0D8', ''],
        ['fatx', 'Fat X（脂肪溶解注射）', 30, [self::M], 'menu-s00009A18F', 15, [self::M], 'menu-s00009A191', ''],
        ['sunekos', 'スネコス', 30, [self::M], 'menu-s00009E6B7', 15, [self::M], 'menu-s000099E63', ''],
        ['hokuro', 'ほくろ除去', 20, [self::M], 'menu-s00009A192', 0, [], '', ''],
        ['dyelaser', '色素レーザー（ダイレーザー）', 20, [self::M], self::CONSULT, 10, [self::M], 'menu-s00009A3AE', ''],
        ['isotretinoin', 'イソトレチノイン', 15, [self::M], self::MEMO, 10, [self::M], self::MEMO, ''],
        ['oral', '美白・しわ・ニキビの内服（はじめてのご相談）', 15, [self::M], self::MEMO, 0, [], '', ''],
        ['tcapeel', 'TCAピーリング', 15, [self::M], self::MEMO, 10, [self::M], self::MEMO, ''],
        ['amalfi', 'アマルフィーピール', 15, [self::M], self::MEMO, 20, self::N, self::MEMO, ''],
        ['zoskin', 'ゼオスキンヘルス（カウンセリング）', 15, [self::M], self::MEMO, 15, [self::M], self::MEMO, ''],
        ['massagepeel', 'マッサージピール', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18A', ''],
        ['milano', 'ミラノリピール', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18B', ''],
        ['salicylic', 'サリチル酸ピーリング', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18C', ''],
    ];

    /** レーザー脱毛の部位ごとの時間（シート1「レーザー脱毛」。施術後の掃除とカルテ記載込み）。[部位, 男性の分, 女性の分] */
    private const LASER_HAIR_PARTS = [
        ['下肢全部', 90, 60], ['大腿', 40, 30], ['下腿～足先', 40, 30], ['膝', 10, 10], ['下腿', 30, 20],
        ['鼻下', 10, 10], ['顎', 10, 10], ['顎下', 10, 10], ['鼻下+顎+顎下', 15, 15], ['鼻下+顎', 10, 10], ['眉', 10, 10],
        ['前腕', 20, 20], ['前腕～手先', 25, 25], ['へそ回り', 10, 10], ['V', 10, 10], ['IO', 20, 15], ['VIO', 30, 20],
    ];

    /** プリセットを今の設定に合わせて出す（ないレーン・使えないメニューは空にする。オフなので、オンにするときに選び直す） */
    public static function presets(): array
    {
        [$lanes, $menus] = Store::laneAndMenuIds();
        $out = [];
        foreach (self::PRESETS as [$id, $name, $fm, $fl, $fmenu, $rm, $rl, $rmenu, $note]) {
            $out[] = [
                'id' => $id, 'name' => $name, 'enabled' => false,
                'firstMinutes' => $fm, 'firstLaneIds' => array_values(array_intersect($fl, $lanes)), 'firstMenuId' => in_array($fmenu, $menus, true) ? $fmenu : '',
                'repeatMinutes' => $rm, 'repeatLaneIds' => array_values(array_intersect($rl, $lanes)), 'repeatMenuId' => in_array($rmenu, $menus, true) ? $rmenu : '',
                'machine' => '', 'note' => $note, 'partGroups' => [], 'countPerMinute' => 0, 'maxMinutes' => 0,
            ];
        }
        $lane = fn(array $ids) => array_values(array_intersect($ids, $lanes));
        $menu = fn(string $id) => in_array($id, $menus, true) ? $id : '';
        // 医療脱毛（シート1・予約エンジンルール「複合/脱毛初回」）：初回は看護師レーンで説明15分を先に取り、続けて部位の照射。
        // 針脱毛は4本で1分。本数が分からない初回は受けない（再診だけ。1件の上限は90分：一人の看護師が続けて行うのは1時間半を超えるなら1件まで）
        $out[] = [
            'id' => 'laserhair', 'name' => '医療レーザー脱毛', 'enabled' => false,
            'firstMinutes' => 15, 'firstLaneIds' => $lane(self::N), 'firstMenuId' => $menu('menu-s0000A43A3'),
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane(self::N), 'repeatMenuId' => $menu('menu-s0000A1344'),
            'machine' => '', 'note' => '',
            'partGroups' => [
                ['name' => '男性', 'parts' => array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[1]], self::LASER_HAIR_PARTS)],
                ['name' => '女性', 'parts' => array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[2]], self::LASER_HAIR_PARTS)],
            ],
            'countPerMinute' => 0, 'maxMinutes' => 0,
        ];
        // 麻酔つきの注入（院長 11/19：スタンプ系〈フィルロード・TAピンク・ピンクグロー・トラネキサム酸スタンプ〉の施術は麻酔によらず20分、ジュブアセル・リトゥオは30分。リトゥオは医師のみ）
        $flow = fn(string $id, string $name, array $treatLanes, string $treatMenu, int $cream, int $inj, string $machine) => [
            'id' => $id, 'name' => $name, 'enabled' => false,
            'firstMinutes' => 20, 'firstLaneIds' => $lane([self::M]), 'firstMenuId' => $menu(self::CONSULT),
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane($treatLanes), 'repeatMenuId' => $menu($treatMenu),
            'machine' => $machine, 'note' => '', 'partGroups' => [], 'countPerMinute' => 0, 'maxMinutes' => 0,
            'flow' => true, 'creamMinutes' => $cream, 'injectionMinutes' => $inj, 'anesLaneIds' => $lane(['lane-4']),
            'creamMenuId' => $menu(self::MEMO), 'neoboMenuId' => $menu('menu-s0000B6B52'), 'doctorMenuId' => $menu(self::MEMO), 'doctorLaneId' => in_array(self::M, $lanes, true) ? self::M : '',
        ];
        $out[] = $flow('fillroad', 'フィルロード', self::N, 'menu-s0000B6EB7', 20, 20, 'インナーフィル');
        $out[] = $flow('tapink', 'トラネ＋ピンク（TAピンク）', self::N, 'menu-s0000B6EB5', 20, 20, 'インナーフィル');
        $out[] = $flow('pinkglow', 'ピンクグロー', self::N, 'menu-s0000B6EB5', 20, 20, 'インナーフィル');
        $out[] = $flow('tranestamp', 'トラネキサム酸スタンプ注射', self::N, 'menu-s0000B6EB5', 20, 20, 'インナーフィル');
        $out[] = $flow('juveacell', 'ジュブアセル', self::N, 'menu-s0000D0B81', 30, 30, 'インナーフィル');
        $out[] = $flow('re2o', 'リトゥオ', [self::M], 'menu-s0000D14AA', 30, 30, '');
        $out[] = [
            'id' => 'needlehair', 'name' => '針脱毛（2回目以降）', 'enabled' => false,
            'firstMinutes' => 15, 'firstLaneIds' => [], 'firstMenuId' => '',
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane(self::N), 'repeatMenuId' => $menu('menu-s0000B6B1C'),
            'machine' => '', 'note' => '', 'partGroups' => [], 'countPerMinute' => 4, 'maxMinutes' => 90,
        ];
        return array_map(fn($it) => $it + ['category' => self::PRESET_CATEGORY[$it['id']] ?? ''], $out);
    }

    /** 予約ページを開けるか（受け付けがオンで、タトゥーか日曜メニューのどちらかを受けられる） */
    public static function open(?array $s = null): bool
    {
        $s ??= self::settings();
        return $s['enabled'] && (self::ready($s) || array_filter($s['items'], fn($it) => self::accepts($it, true) || self::accepts($it, false)) !== []);
    }

    /** 日曜メニューを id で探す */
    public static function item(string $id, ?array $s = null): ?array
    {
        $s ??= self::settings();
        foreach ($s['items'] as $it) {
            if ($it['id'] === $id) {
                return $it;
            }
        }
        return null;
    }

    /** 部位ごと（partGroups）か本数（countPerMinute）で時間が変わるメニューか。そのときの初診・再診の時間は「足す時間」（初診の説明など。0でもよい） */
    public static function variable(array $it): bool
    {
        return ($it['partGroups'] ?? []) !== [] || ($it['countPerMinute'] ?? 0) > 0;
    }

    /** その日曜メニューで初診（$first）または再診を受けるか（時間・レーン・メニューがそろっている。時間が変わるメニューは、レーンを選んだ区分を受ける） */
    public static function accepts(array $it, bool $first): bool
    {
        if (!$first && self::isFlow($it)) {
            return ($it['enabled'] ?? true) !== false && ($it['repeatLaneIds'] ?? []) !== [] && ($it['repeatMenuId'] ?? '') !== ''
                && ($it['creamMinutes'] ?? 0) > 0 && ($it['injectionMinutes'] ?? 0) > 0
                && ($it['anesLaneIds'] ?? []) !== [] && ($it['creamMenuId'] ?? '') !== '' && ($it['neoboMenuId'] ?? '') !== '';
        }
        $k = $first ? 'first' : 'repeat';
        return ($it['enabled'] ?? true) !== false && (self::variable($it) || ($it[$k . 'Minutes'] ?? 0) > 0) && ($it[$k . 'LaneIds'] ?? []) !== [] && ($it[$k . 'MenuId'] ?? '') !== '';
    }

    /**
     * 麻酔つきの注入（フィルロード・ピンクグロー・トラネ・ジュブアセルなど。予約枠時間一覧の「麻酔連動」「複合/モニター注入」「麻酔／現在の指示」）。
     * 当院がはじめての方は医師の診察だけ（初診の時間）。受診したことのある方は、今回の治療内容と麻酔を選び、次のように枠を続けて取る：
     * - モニタープログラム中：麻酔のレーン（4番）でネオボ撮影＋頬麻酔 → 麻酔クリームなら40〜60分後、それ以外は直後に施術
     * - 院内の麻酔クリーム：麻酔のレーンで麻酔10分 → 40〜60分後に施術（なるべく45分後）
     * - 麻酔の注射・ご自身で塗ってくる・なし：施術だけ（麻酔の注射のときは注射の時間）
     * - この治療は初めて：施術の最初の10分にメインで医師の診察を重ねる
     */
    public const STATUSES = ['new' => 'この治療は初めて', 'continue' => '継続／コース消化', 'monitor' => 'モニタープログラム中'];
    public const ANESTHESIA = ['cream' => '院内の麻酔クリーム', 'injection' => '麻酔の注射', 'self' => 'ご自身で麻酔クリームを塗ってくる', 'none' => '麻酔なし'];
    private const CREAM_SLOT = 10;
    private const NEOBO_SLOT = 15;
    private const DOCTOR_SLOT = 10;
    /** 麻酔の後、施術までの待ち（分）。試す順 */
    private const WAITS = [45, 40, 50, 55, 60];

    public static function isFlow(array $it): bool
    {
        return !empty($it['flow']);
    }

    /** 麻酔つきの注入の、今回の治療内容と麻酔（選び方がおかしければ null） */
    private static function flowPick(array $pick): ?array
    {
        $st = (string) ($pick['status'] ?? '');
        $an = (string) ($pick['anesthesia'] ?? '');
        return isset(self::STATUSES[$st], self::ANESTHESIA[$an]) ? [$st, $an] : null;
    }

    /** 本数の上限（入力の誤りを防ぐ） */
    private const MAX_COUNT = 5000;

    /**
     * 患者の選んだ内容（部位・本数）からの時間（分、5分刻みに切り上げ）。選び方がおかしい・上限を超えるときは null。
     * $pick：['group' => 何番目の区分, 'parts' => [何番目の部位, ...], 'count' => 本数]
     */
    public static function itemMinutes(array $it, bool $first, array $pick = []): ?int
    {
        // 麻酔つきの注入：施術の時間（麻酔の注射なら注射の時間、それ以外はクリームの時間）
        if (!$first && self::isFlow($it)) {
            $fp = self::flowPick($pick);
            return $fp === null ? null : (int) ($fp[1] === 'injection' ? $it['injectionMinutes'] : $it['creamMinutes']);
        }
        $min = (int) ($it[($first ? 'first' : 'repeat') . 'Minutes'] ?? 0);
        if (($it['partGroups'] ?? []) !== []) {
            $g = $it['partGroups'][(int) ($pick['group'] ?? -1)] ?? null;
            $idx = array_values(array_unique(array_map('intval', array_filter((array) ($pick['parts'] ?? []), 'is_numeric'))));
            if (!is_numeric($pick['group'] ?? null) || $g === null || $idx === []) {
                return null;
            }
            foreach ($idx as $i) {
                if (!isset($g['parts'][$i])) {
                    return null;
                }
                $min += (int) $g['parts'][$i]['minutes'];
            }
        } elseif (($it['countPerMinute'] ?? 0) > 0) {
            $n = is_numeric($pick['count'] ?? null) ? (int) $pick['count'] : 0;
            if ($n < 1 || $n > self::MAX_COUNT) {
                return null;
            }
            $min += (int) ceil($n / $it['countPerMinute']);
        }
        $min = (int) (ceil($min / 5) * 5);
        $max = (int) ($it['maxMinutes'] ?? 0) ?: self::MAX_ITEM_MINUTES;
        return $min >= 5 && $min <= $max ? $min : null;
    }

    /** 予約メモ・確定の連絡に書く、選んだ内容（「女性：VIO・へそ回り」「300本」）。なければ空 */
    public static function pickText(array $it, array $pick): string
    {
        if (self::isFlow($it)) {
            $fp = self::flowPick($pick);
            return $fp === null ? '' : '今回：' . self::STATUSES[$fp[0]] . '／麻酔：' . self::ANESTHESIA[$fp[1]];
        }
        if (($it['partGroups'] ?? []) !== []) {
            $g = $it['partGroups'][(int) ($pick['group'] ?? 0)] ?? ['name' => '', 'parts' => []];
            $names = [];
            foreach (array_unique(array_map('intval', (array) ($pick['parts'] ?? []))) as $i) {
                if (isset($g['parts'][$i])) {
                    $names[] = $g['parts'][$i]['name'];
                }
            }
            return (count($it['partGroups']) > 1 ? $g['name'] . '：' : '') . implode('・', $names);
        }
        if (($it['countPerMinute'] ?? 0) > 0) {
            return (int) ($pick['count'] ?? 0) . '本';
        }
        return '';
    }

    /** 予約ページに出す日曜メニューの一覧（患者に見せてよい項目だけ） */
    public static function publicItems(?array $s = null): array
    {
        $s ??= self::settings();
        $out = [];
        foreach ($s['items'] as $it) {
            $first = self::accepts($it, true);
            $repeat = self::accepts($it, false);
            if ($first || $repeat) {
                $out[] = [
                    'id' => $it['id'], 'name' => $it['name'], 'first' => $first, 'repeat' => $repeat, 'note' => $it['note'] ?? '',
                    'category' => (string) ($it['category'] ?? ''),
                    // 部位ごとの時間のメニューは区分（男性・女性など）と部位の名前だけ（時間は出さない）。本数で決まるメニューは本数を入れてもらう
                    'groups' => array_map(fn($g) => ['name' => $g['name'], 'parts' => array_column($g['parts'], 'name')], $it['partGroups'] ?? []),
                    'count' => ($it['countPerMinute'] ?? 0) > 0,
                    'flow' => self::isFlow($it),
                ];
            }
        }
        return $out;
    }

    /**
     * 予約ページに出すメニューを、設定の並び順で。タトゥー除去・アートメイク除去（受け付けるとき）と日曜メニュー（publicItems）。
     * @return list<array{key:string,category:string,item:?array}> key は "tattoo"・"artmake"・"m:<id>"
     */
    public static function publicMenus(?array $s = null): array
    {
        $s ??= self::settings();
        $all = [];
        if (self::ready($s) && $s['tattooOn']) {
            $all['tattoo'] = ['key' => 'tattoo', 'category' => $s['removalCategory'], 'item' => null];
        }
        if (self::ready($s) && $s['artmakeOn']) {
            $all['artmake'] = ['key' => 'artmake', 'category' => $s['removalCategory'], 'item' => null];
        }
        foreach (self::publicItems($s) as $it) {
            $all[$it['id']] = ['key' => 'm:' . $it['id'], 'category' => $it['category'] !== '' ? $it['category'] : 'その他', 'item' => $it];
        }
        $out = [];
        foreach ($s['order'] as $k) {
            if (isset($all[$k])) {
                $out[] = $all[$k];
                unset($all[$k]);
            }
        }
        return [...$out, ...array_values($all)];
    }

    /** 分類を選ばせるか：分類が2つ以上で、メニューが7つ以上あるとき（少なければ一覧のまま） */
    public static function useCategories(array $menus): bool
    {
        return count($menus) >= 7 && count(array_unique(array_column($menus, 'category'))) >= 2;
    }

    /**
     * 設定で送られた日曜メニューの一覧をそろえる。レーン・メニューは今あるものだけ。
     * id は保存のたびに変わらないよう、送られた id（英数字）を使い、なければ作る
     * @param list<string> $laneIds
     * @param list<string> $menuIds
     */
    public static function normalizeItems(array $items, array $laneIds, array $menuIds): array
    {
        if (count($items) > self::MAX_ITEMS) {
            throw new StoreError('invalid', '日曜に受け付けるメニューは' . self::MAX_ITEMS . '件までです');
        }
        $out = [];
        $seen = [];
        foreach ($items as $i => $it) {
            $n = $i + 1;
            $name = mb_substr(js_trim(normalize_width((string) ($it['name'] ?? ''))), 0, 40);
            if ($name === '') {
                throw new StoreError('invalid', "日曜に受け付けるメニューの{$n}行目：患者に見せる名前を入れてください");
            }
            $id = (string) ($it['id'] ?? '');
            if (!preg_match('/^[a-z0-9]{4,20}$/', $id) || isset($seen[$id])) {
                $id = bin2hex(random_bytes(5));
            }
            $seen[$id] = true;
            // オフのものは、足りない項目があっても残せる（オンにするときにそろえる）
            $on = ($it['enabled'] ?? true) !== false;
            $row = ['id' => $id, 'name' => $name, 'enabled' => $on];
            // 部位ごとの時間（区分 → 部位と分）。区分は4つ、部位は区分ごとに60まで
            $groups = [];
            foreach (array_slice(array_values((array) ($it['partGroups'] ?? [])), 0, 4) as $g) {
                $gname = mb_substr(js_trim(normalize_width((string) ($g['name'] ?? ''))), 0, 20);
                $parts = [];
                foreach (array_slice(array_values((array) ($g['parts'] ?? [])), 0, 60) as $pt) {
                    $pname = mb_substr(js_trim(normalize_width((string) ($pt['name'] ?? ''))), 0, 30);
                    $pm = (int) ($pt['minutes'] ?? 0);
                    if ($pname === '') {
                        throw new StoreError('invalid', "「{$name}」の部位の名前を入れてください");
                    }
                    if ($pm < 5 || $pm > self::MAX_ITEM_MINUTES || $pm % 5 !== 0) {
                        throw new StoreError('invalid', "「{$name}」の部位「{$pname}」の時間は5〜" . self::MAX_ITEM_MINUTES . '分（5分刻み）で入れてください');
                    }
                    $parts[] = ['name' => $pname, 'minutes' => $pm];
                }
                if ($parts !== []) {
                    $groups[] = ['name' => $gname !== '' ? $gname : '部位', 'parts' => $parts];
                }
            }
            $cpm = $groups === [] ? (int) ($it['countPerMinute'] ?? 0) : 0;
            if ($cpm < 0 || $cpm > 100) {
                throw new StoreError('invalid', "「{$name}」の1分あたりの本数は0〜100で入れてください");
            }
            $maxMin = (int) ($it['maxMinutes'] ?? 0);
            if ($maxMin < 0 || $maxMin > self::MAX_ITEM_MINUTES || $maxMin % 5 !== 0) {
                throw new StoreError('invalid', "「{$name}」の時間の上限は0〜" . self::MAX_ITEM_MINUTES . '分（5分刻み。0は上限なし）で入れてください');
            }
            $row += ['partGroups' => $groups, 'countPerMinute' => $cpm, 'maxMinutes' => $maxMin];
            // 麻酔つきの注入（部位・本数とは一緒に使わない）
            $flow = !empty($it['flow']) && $groups === [] && $cpm === 0;
            $row['flow'] = $flow;
            foreach (['creamMinutes' => 'クリームのときの施術', 'injectionMinutes' => '麻酔の注射のときの施術'] as $fk => $flabel) {
                $v = (int) ($it[$fk] ?? 0);
                if ($v < 0 || $v > self::MAX_ITEM_MINUTES || $v % 5 !== 0) {
                    throw new StoreError('invalid', "「{$name}」の{$flabel}の時間は0〜" . self::MAX_ITEM_MINUTES . '分（5分刻み）で入れてください');
                }
                $row[$fk] = $v;
            }
            $anes = array_values(array_unique(array_map('strval', (array) ($it['anesLaneIds'] ?? []))));
            foreach ($anes as $l) {
                if (!in_array($l, $laneIds, true)) {
                    throw new StoreError('invalid', "「{$name}」の麻酔のレーンが見つかりません");
                }
            }
            $row['anesLaneIds'] = $anes;
            foreach (['creamMenuId' => '麻酔クリーム', 'neoboMenuId' => 'ネオボ撮影＋頬麻酔', 'doctorMenuId' => '医師の診察'] as $fk => $flabel) {
                $v = (string) ($it[$fk] ?? '');
                if ($v !== '' && !in_array($v, $menuIds, true)) {
                    throw new StoreError('invalid', "「{$name}」の{$flabel}のメニューが見つかりません");
                }
                $row[$fk] = $v;
            }
            $dl = (string) ($it['doctorLaneId'] ?? '');
            if ($dl !== '' && !in_array($dl, $laneIds, true)) {
                throw new StoreError('invalid', "「{$name}」の医師の診察のレーンが見つかりません");
            }
            $row['doctorLaneId'] = $dl;
            if ($on && $flow && ($it['repeatLaneIds'] ?? []) !== [] && ($row['creamMinutes'] === 0 || $row['injectionMinutes'] === 0 || $anes === [] || $row['creamMenuId'] === '' || $row['neoboMenuId'] === '')) {
                throw new StoreError('invalid', "「{$name}」は、施術の時間（クリーム・注射）、麻酔のレーン、麻酔クリームとネオボのメニューを入れてください（受診したことのある方を受けないときは再診のレーンを外す）");
            }
            $variable = $groups !== [] || $cpm > 0 || $flow;
            foreach (['first' => '初診', 'repeat' => '再診'] as $k => $label) {
                $min = (int) ($it[$k . 'Minutes'] ?? 0);
                if ($min < 0 || $min > self::MAX_ITEM_MINUTES || $min % 5 !== 0) {
                    throw new StoreError('invalid', "「{$name}」の{$label}の時間は0〜" . self::MAX_ITEM_MINUTES . '分（5分刻み）で入れてください');
                }
                $lanes = array_values(array_unique(array_map('strval', (array) ($it[$k . 'LaneIds'] ?? []))));
                foreach ($lanes as $l) {
                    if (!in_array($l, $laneIds, true)) {
                        throw new StoreError('invalid', "「{$name}」の{$label}のレーンが見つかりません");
                    }
                }
                $menu = (string) ($it[$k . 'MenuId'] ?? '');
                if ($menu !== '' && !in_array($menu, $menuIds, true)) {
                    throw new StoreError('invalid', "「{$name}」の{$label}のメニューが見つかりません");
                }
                if ($on && !$variable && $min > 0 && ($lanes === [] || $menu === '')) {
                    throw new StoreError('invalid', "「{$name}」の{$label}は、レーンと予約に付けるメニューを選んでください（受けないときは時間を0に）");
                }
                // 時間が変わるメニューは、レーンを選んだ区分を受ける（メニューも要る）
                if ($on && $variable && $lanes !== [] && $menu === '') {
                    throw new StoreError('invalid', "「{$name}」の{$label}の予約に付けるメニューを選んでください（受けないときはレーンを外す）");
                }
                $row += [$k . 'Minutes' => $min, $k . 'LaneIds' => $lanes, $k . 'MenuId' => $menu];
            }
            if ($on && !$variable && $row['firstMinutes'] === 0 && $row['repeatMinutes'] === 0) {
                throw new StoreError('invalid', "「{$name}」は、初診か再診の時間を入れてください");
            }
            if ($on && $variable && $row['firstLaneIds'] === [] && $row['repeatLaneIds'] === []) {
                throw new StoreError('invalid', "「{$name}」は、初診か再診のレーンを選んでください");
            }
            $row['machine'] = mb_substr(js_trim((string) ($it['machine'] ?? '')), 0, 30);
            $row['note'] = mb_substr(js_trim(normalize_width((string) ($it['note'] ?? ''))), 0, 200);
            $row['category'] = mb_substr(js_trim(normalize_width((string) ($it['category'] ?? ''))), 0, 20);
            $out[] = $row;
        }
        return $out;
    }

    /** 機器の名前 → その機器を使う予約のメニュー（タトゥーの照射と日曜メニュー） */
    private static function machineMenus(string $machine, array $s): array
    {
        if ($machine === '') {
            return [];
        }
        $ids = [];
        if ($s['machine'] === $machine && $s['menuId'] !== '') {
            $ids[] = $s['menuId'];
        }
        foreach ($s['items'] as $it) {
            if (($it['enabled'] ?? true) !== false && ($it['machine'] ?? '') === $machine) {
                // 麻酔つきの注入の初診は医師の診察だけなので、機器は使わない
                if (!self::isFlow($it)) {
                    $ids[] = $it['firstMenuId'];
                }
                $ids[] = $it['repeatMenuId'];
            }
        }
        return array_values(array_unique(array_filter($ids, fn($x) => $x !== '')));
    }

    /** タトゥー・アートメイクのどちらかを受け付けられるか（受け付けがオンで、照射のレーンとメニューがあり、どちらかがオン） */
    public static function ready(?array $s = null): bool
    {
        $s ??= self::settings();
        return $s['enabled'] && $s['laneId'] !== '' && $s['menuId'] !== '' && ($s['tattooOn'] || $s['artmakeOn']);
    }

    /** タトゥー（tattoo）・アートメイク（artmake）のそれぞれを受け付けるか */
    public static function kindOn(string $kind, ?array $s = null): bool
    {
        $s ??= self::settings();
        return self::ready($s) && in_array($kind, ['tattoo', 'artmake'], true) && $s[$kind . 'On'];
    }

    /** この来院（Reminder::visitsOn の1件）にタトゥー除去の照射か初診説明のメニューが入っているか */
    public static function inVisit(array $v): bool
    {
        $s = self::settings();
        $ids = array_filter([$s['menuId'], $s['explainMenuId']], fn($x) => $x !== '');
        if ($ids !== [] && array_intersect($ids, $v['menuIds'] ?? []) !== []) {
            return true;
        }
        // 日曜メニュー：同じメニューを平日にも使うので、日曜の来院のときだけ
        $date = (string) ($v['date'] ?? substr((string) ($v['arrivalAt'] ?? ''), 0, 10));
        if (!is_date_string($date) || (new DateTimeImmutable($date))->format('w') !== '0') {
            return false;
        }
        $items = [];
        foreach (array_filter($s['items'], fn($it) => ($it['enabled'] ?? true) !== false) as $it) {
            $items[] = $it['firstMenuId'];
            $items[] = $it['repeatMenuId'];
        }
        $items = array_filter($items, fn($x) => $x !== '');
        return $items !== [] && array_intersect($items, $v['menuIds'] ?? []) !== [];
    }

    /** 患者に見せる所要時間の文：「約20分（ご説明10分・照射10分）」／再診は「約10分（照射）」 */
    public static function durationText(int $treat, bool $first): string
    {
        return $first
            ? '約' . ($treat + self::EXPLAIN_MINUTES) . '分（ご説明' . self::EXPLAIN_MINUTES . "分・照射{$treat}分）"
            : "約{$treat}分（照射）";
    }

    /** LINE で開くアドレス（ホームページのボタン・LINE のメニューに貼る）。LIFF がなければ空 */
    public static function liffUrl(): string
    {
        $id = self::settings()['liffId'];
        return $id !== '' ? 'https://liff.line.me/' . $id : '';
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
     * @return list<array{0:int,1:int,2:int,3:int}> [空きの開始, 空きの終了, 受付時間帯の開始, 受付時間帯の終了]
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
                    $out[] = [$cur, min($bs, $we), $ws, $we];
                }
                $cur = max($cur, $be);
            }
            if ($cur < $we) {
                $out[] = [$cur, $we, $ws, $we];
            }
        }
        return $out;
    }

    /**
     * 選べる枠。日付 => [[来院の時刻 "HH:MM", 照射の開始分, 説明のレーンを使うか], ...]（時刻順）。
     * 空きの区間ごとに「最初から」と「最後から」の2つだけを出す（予約が前後に隙間なく並ぶ）。
     * 「最後から」は、空きのすぐ後ろに予約があるときだけ。受付の終わりまで空いているときは出さない（空いた日は受付の最初の時刻だけ。院長 11/19「中途半端な午後から入ると困る」）。
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
        $last = $firstVisit ? (new DateTimeImmutable($now['date']))->modify('+' . self::FIRST_VISIT_MONTHS . ' months')->format('Y-m-d') : '9999-12-31';
        $byDate = [];
        foreach ($s['slots'] as $line) {
            $w = OnlineCs::parseWindow($line);
            if ($w && $w['date'] >= $now['date'] && $w['date'] <= $last) {
                $byDate[$w['date']][] = [$w['start'], $w['end']];
            }
        }
        $out = [];
        $machine = self::machineMenus($s['machine'], $s);
        foreach ($byDate as $date => $windows) {
            $busy = Store::busyMinutes($date, $s['laneId']);
            $nurseBusy = $s['explainLaneId'] !== '' ? Store::busyMinutes($date, $s['explainLaneId']) : null;
            $machineBusy = Store::busyMinutesForMenus($date, $machine);
            $found = [];
            foreach (self::gaps($windows, $busy) as [$gs, $ge, $ws, $we]) {
                foreach ($ge < $we ? ['front', 'back'] : ['front'] as $side) {
                    $c = self::fit($side, $gs, $ge, $ws, $treat, $firstVisit, $nurseBusy, $windows);
                    // 同じ機器をほかのレーンで使っている時間には照射を入れない
                    if ($c === null || self::overlaps($machineBusy, $c[1], $c[1] + $treat)) {
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
            // 空きの最初で、直前に説明を取れない（受付の始まり・説明のレーンが埋まっている）ときも、説明は説明のレーンで取り、
            // 照射はその後ろから（照射のレーンの最初の10分は空く。院長 11/19「まず1番レーンで説明10分、その後メインで照射」）
            if ($side === 'front' && $gs + $x + $treat <= $ge && !self::overlaps($nurseBusy, $gs, $gs + $x)) {
                return [$gs, $gs + $x, true];
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
     * 日曜メニューの選べる枠。日付 => [[来院の時刻 "HH:MM", 開始分, レーン], ...]（時刻順）。
     * 受付日時はタトゥーと同じ。レーンが複数なら、設定の順に空いているほうへ。時刻の決め方はタトゥーの再診と同じ
     * @return array<string, list<array{0:string,1:int,2:string}>>
     */
    public static function planItem(array $it, bool $first, ?array $s = null, array $pick = []): array
    {
        $s ??= self::settings();
        $len = self::itemMinutes($it, $first, $pick);
        if (!$s['enabled'] || !self::accepts($it, $first) || $len === null) {
            return [];
        }
        if (!$first && self::isFlow($it)) {
            return self::planFlow($it, $len, self::flowPick($pick), $s);
        }
        $k = $first ? 'first' : 'repeat';
        $now = now_in_clinic();
        $last = $first ? (new DateTimeImmutable($now['date']))->modify('+' . self::FIRST_VISIT_MONTHS . ' months')->format('Y-m-d') : '9999-12-31';
        $byDate = [];
        foreach ($s['slots'] as $line) {
            $w = OnlineCs::parseWindow($line);
            if ($w && $w['date'] >= $now['date'] && $w['date'] <= $last) {
                $byDate[$w['date']][] = [$w['start'], $w['end']];
            }
        }
        $machine = self::machineMenus((string) ($it['machine'] ?? ''), $s);
        $out = [];
        foreach ($byDate as $date => $windows) {
            $machineBusy = Store::busyMinutesForMenus($date, $machine);
            $found = [];
            foreach ($it[$k . 'LaneIds'] as $lane) {
                foreach (self::gaps($windows, Store::busyMinutes($date, $lane)) as [$gs, $ge, , $we]) {
                    if ($ge - $gs < $len) {
                        continue;
                    }
                    foreach ($ge < $we ? [$gs, $ge - $len] : [$gs] as $start) {
                        if (isset($found[$start]) || self::overlaps($machineBusy, $start, $start + $len)) {
                            continue;
                        }
                        if ($date === $now['date'] && $start <= $now['minutes']) {
                            continue;
                        }
                        $found[$start] = [self::hm($start), $start, $lane];
                    }
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
     * 麻酔つきの注入の枠。日付 => [[来院の時刻, 来院の分, 施術のレーン, [[レーン, メニュー, 開始分, 終了分, 何の枠], ...]], ...]。
     * 施術の枠はほかと同じく、施術のレーンの空きの最初か、後ろに予約がある空きの最後にそろえ、麻酔・撮影の枠はそこから逆算する
     */
    private static function planFlow(array $it, int $treat, array $fp, array $s): array
    {
        [$status, $anes] = $fp;
        $monitor = $status === 'monitor';
        $cream = $anes === 'cream';
        // 施術の前の枠：[長さ, メニュー, 名前]、施術までの待ちの候補
        $pre = $monitor ? [self::NEOBO_SLOT, $it['neoboMenuId'], 'ネオボ撮影＋頬麻酔'] : ($cream ? [self::CREAM_SLOT, $it['creamMenuId'], '麻酔クリーム'] : null);
        $waits = $pre === null ? [] : ($cream ? self::WAITS : [0]);
        $doctorLane = $it['doctorLaneId'] !== '' ? $it['doctorLaneId'] : ($it['firstLaneIds'][0] ?? '');
        $doctor = $status === 'new' && $doctorLane !== '' && ($it['doctorMenuId'] ?? '') !== '';
        $now = now_in_clinic();
        $byDate = [];
        foreach ($s['slots'] as $line) {
            $w = OnlineCs::parseWindow($line);
            if ($w && $w['date'] >= $now['date']) {
                $byDate[$w['date']][] = [$w['start'], $w['end']];
            }
        }
        $machine = self::machineMenus((string) ($it['machine'] ?? ''), $s);
        $inWindow = function (array $windows, int $a, int $b): bool {
            foreach ($windows as [$ws, $we]) {
                if ($a >= $ws && $b <= $we) {
                    return true;
                }
            }
            return false;
        };
        $out = [];
        foreach ($byDate as $date => $windows) {
            $busy = fn(string $lane) => Store::busyMinutes($date, $lane);
            $machineBusy = Store::busyMinutesForMenus($date, $machine);
            $doctorBusy = $doctor ? $busy($doctorLane) : [];
            $found = [];
            foreach ($it['repeatLaneIds'] as $lane) {
                foreach (self::gaps($windows, $busy($lane)) as [$gs, $ge, $ws, $we]) {
                    if ($ge - $gs < $treat) {
                        continue;
                    }
                    // 空きの最初・最後に加えて、麻酔・撮影が受付の始まりより前になってしまうときは、受付の始まりに麻酔をして待ったあとの時刻
                    $starts = $ge < $we ? [$gs, $ge - $treat] : [$gs];
                    if ($pre !== null) {
                        $starts[] = max($gs, $ws + $pre[0] + $waits[0]);
                    }
                    foreach (array_unique($starts) as $start) {
                        $end = $start + $treat;
                        if ($end > $ge) {
                            continue;
                        }
                        if (self::overlaps($machineBusy, $start, $end) || ($doctor && self::overlaps($doctorBusy, $start, $start + self::DOCTOR_SLOT))) {
                            continue;
                        }
                        $segs = [[$lane, $it['repeatMenuId'], $start, $end, '施術']];
                        if ($doctor) {
                            $segs[] = [$doctorLane, $it['doctorMenuId'], $start, $start + self::DOCTOR_SLOT, '医師の診察（施術の最初に重ねる）'];
                        }
                        $arrive = $start;
                        if ($pre !== null) {
                            $ok = false;
                            foreach ($waits as $wait) {
                                $a0 = $start - $wait - $pre[0];
                                if (!$inWindow($windows, $a0, $a0 + $pre[0])) {
                                    continue;
                                }
                                foreach ($it['anesLaneIds'] as $al) {
                                    if (!self::overlaps($busy($al), $a0, $a0 + $pre[0])) {
                                        $segs[] = [$al, $pre[1], $a0, $a0 + $pre[0], $pre[2]];
                                        $arrive = $a0;
                                        $ok = true;
                                        break 2;
                                    }
                                }
                            }
                            if (!$ok) {
                                continue;
                            }
                        }
                        if (isset($found[$arrive]) || ($date === $now['date'] && $arrive <= $now['minutes'])) {
                            continue;
                        }
                        $found[$arrive] = [self::hm($arrive), $arrive, $lane, $segs];
                    }
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

    /** 日曜メニューの所要時間の文（「約15分」）。選び方が足りなければ空 */
    public static function itemDurationText(array $it, bool $first, array $pick = []): string
    {
        $m = self::itemMinutes($it, $first, $pick);
        if ($m !== null && !$first && self::isFlow($it)) {
            [$status, $anes] = self::flowPick($pick);
            if ($status === 'monitor') {
                return $anes === 'cream' ? "撮影・麻酔のあと約45分お待ちいただき施術（施術は約{$m}分）" : "撮影のあと施術（施術は約{$m}分）";
            }
            return $anes === 'cream' ? "麻酔クリームのあと約45分お待ちいただき施術（施術は約{$m}分）" : "約{$m}分";
        }
        return $m === null ? '' : "約{$m}分";
    }

    /**
     * 予約を受け付ける。うまくいけば ['ok'=>true, 'date', 'time', 'end', 'mailed']。
     * 入力の誤りは ['ok'=>false, 'error'=>'invalid', 'fields'=>[...]]、枠が埋まっていれば 'slot_taken'
     */
    public static function book(array $in, string $ip, ?int $nowMs = null): array
    {
        $nowMs ??= (int) floor(microtime(true) * 1000);
        $s = self::settings();
        if (!self::open($s)) {
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
        // 日曜メニュー（タトゥー以外）を選んだとき
        $item = is_string($in['item'] ?? null) && $in['item'] !== '' ? self::item($in['item'], $s) : null;
        if (is_string($in['item'] ?? null) && $in['item'] !== '' && $item === null) {
            return ['ok' => false, 'error' => 'invalid', 'fields' => ['kind']];
        }
        if ($item === null && !self::ready($s)) {
            return ['ok' => false, 'error' => 'closed'];
        }
        $kind = $item !== null ? 'menu' : (in_array($in['kind'] ?? '', ['tattoo', 'artmake'], true) ? $in['kind'] : '');
        if ($kind !== '' && $kind !== 'menu' && !self::kindOn($kind, $s)) {
            return ['ok' => false, 'error' => 'closed'];
        }
        $visit = in_array($in['visit'] ?? '', ['first', 'repeat'], true) ? $in['visit'] : '';
        if ($item !== null && $visit !== '' && !self::accepts($item, $visit === 'first')) {
            $visit = '';
        }
        $color = in_array($in['color'] ?? '', ['black', 'color'], true) ? $in['color'] : '';
        $anesthesia = $item === null && ($in['anesthesia'] ?? '') === 'yes';
        $area = $item === null ? self::areaOf($in['rects'] ?? null) : null;
        $bad = [];
        if ($kind === '') $bad[] = 'kind';
        if ($visit === '') $bad[] = 'visit';
        if ($item === null && $area === null) $bad[] = 'area';
        if ($f['name'] === '') $bad[] = 'name';
        if ($f['kana'] === '') $bad[] = 'kana';
        if (!is_date_string($f['birthDate']) || $f['birthDate'] >= now_in_clinic()['date'] || $f['birthDate'] < '1900-01-01') $bad[] = 'birthDate';
        if (!preg_match('/^0\d{9,10}$/', digits_only($f['phone']))) $bad[] = 'phone';
        // LINE の中で開いたときは、確定の連絡を LINE に送る（メールは任意）。ID トークンで本人の LINE を確かめる
        $uid = null;
        $idToken = (string) ($in['idToken'] ?? '');
        if ($idToken !== '' && $s['liffId'] !== '') {
            try {
                $uid = LineLink::verifyIdToken($idToken, explode('-', $s['liffId'], 2)[0]);
            } catch (StoreError) {
                return ['ok' => false, 'error' => 'line_auth'];
            }
        }
        if ($uid === null ? !filter_var($f['email'], FILTER_VALIDATE_EMAIL) : ($f['email'] !== '' && !filter_var($f['email'], FILTER_VALIDATE_EMAIL))) $bad[] = 'email';
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
        if ($item !== null) {
            $pick = ['group' => $in['group'] ?? null, 'parts' => is_array($in['parts'] ?? null) ? $in['parts'] : [], 'count' => $in['count'] ?? null, 'status' => $in['status'] ?? null, 'anesthesia' => $in['anesthesiaType'] ?? null];
            if (self::itemMinutes($item, $visit === 'first', $pick) === null) {
                return ['ok' => false, 'error' => 'invalid', 'fields' => self::isFlow($item) ? ['flow'] : [($item['countPerMinute'] ?? 0) > 0 ? 'count' : 'parts']];
            }
            return self::bookItem($item, $visit === 'first', $f, $s, $uid, $pick);
        }
        $treat = self::treatMinutes($area);
        $first = $visit === 'first';
        $result = Db::i()->transaction(function () use ($f, $s, $kind, $first, $color, $anesthesia, $area, $treat, $uid) {
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
                $f['email'] !== '' ? 'メール：' . $f['email'] : null,
                $uid !== null ? '確定の連絡：LINE（予約ページを LINE で開いて予約）' : null,
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
                'lineUserId' => $uid,
            ], self::ACTOR);
            if ($nurse) {
                Store::bookingCreate([
                    'patientId' => $patientId,
                    'laneId' => $s['explainLaneId'],
                    'menuIds' => $s['explainMenuId'] !== '' ? [$s['explainMenuId']] : [$s['menuId']],
                    'startAt' => to_iso($f['date'], $start - $x),
                    'endAt' => to_iso($f['date'], $start),
                    'memo' => "タトゥー除去の初診説明（Web予約・日曜）\n照射はこのあと" . self::hm($start) . 'から（' . $treat . '分）',
                    'lineUserId' => $uid,
                ], self::ACTOR);
            }
            if ($uid !== null) {
                Store::bookingLinkLine($patientId, $uid, 'LINE紐付け（タトゥー除去の予約を LINE で）', self::ACTOR);
            }
            return ['ok' => true, 'end' => self::hm($start + $treat), 'id' => $r['id']];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => $kind, 'visit' => $visit, 'area' => $area, 'anesthesia' => $anesthesia, 'end' => $result['end']];
        // 確定の連絡：LINE で開いた人は LINE へ（送れなければメールがあればメール）。それ以外はメール
        [$lined] = $uid !== null ? Reminder::pushText($uid, self::mailBody($f)) : [false];
        $sent = false;
        if (!$lined && $f['email'] !== '') {
            [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject($kind), self::mailBody($f)) : [false];
        }
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'duration' => self::durationText($treat, $first), 'lined' => (bool) $lined, 'mailed' => (bool) $sent];
    }

    /** 日曜メニューの予約（入力は book で確かめ済み） */
    private static function bookItem(array $it, bool $first, array $f, array $s, ?string $uid, array $pick = []): array
    {
        $k = $first ? 'first' : 'repeat';
        $len = (int) self::itemMinutes($it, $first, $pick);
        $what = self::pickText($it, $pick);
        $result = Db::i()->transaction(function () use ($it, $first, $f, $s, $uid, $k, $len, $pick, $what) {
            // 送る直前にもう一度、その時刻が選べるか確かめる（書き込みの鍵を持ったまま）
            $slot = null;
            foreach (self::planItem($it, $first, $s, $pick)[$f['date']] ?? [] as $c) {
                if ($c[0] === $f['time']) {
                    $slot = $c;
                }
            }
            if (!$slot) {
                return ['ok' => false, 'error' => 'slot_taken'];
            }
            [, $start, $lane] = $slot;
            $segs = $slot[3] ?? null;
            try {
                $pat = Store::bookingEnsurePatient(['name' => $f['name'], 'kana' => $f['kana'], 'birthDate' => $f['birthDate'], 'phone' => $f['phone'], 'email' => $f['email']], self::ACTOR);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'contact_us'];
            }
            $memo = implode("\n", array_filter([
                $it['name'] . '（Web予約・日曜）' . ($first ? '初診' : '再診') . "（{$len}分）",
                $what !== '' ? (($it['countPerMinute'] ?? 0) > 0 ? '本数：' : '部位：') . $what : null,
                $first && self::variable($it) && (int) $it['firstMinutes'] > 0 ? "初診の説明：{$it['firstMinutes']}分（この予約の最初）" : null,
                $f['part'] !== '' ? '部位（患者の記入）：' . $f['part'] : null,
                $f['email'] !== '' ? 'メール：' . $f['email'] : null,
                $uid !== null ? '確定の連絡：LINE（予約ページを LINE で開いて予約）' : null,
                $f['lineName'] !== '' ? 'LINEの表示名：' . $f['lineName'] : null,
                $f['notes'] !== '' ? 'ご相談：' . $f['notes'] : null,
            ]));
            $patientId = $pat['patient']['id'];
            // 麻酔つきの注入：麻酔・撮影・医師の診察・施術の枠をそれぞれ予約に（予約申請と同じく、モニターは必ず「モニター」と書く）
            if ($segs !== null) {
                $fp = self::flowPick($pick);
                $head = $it['name'] . '（Web予約・日曜）' . ($fp[0] === 'monitor' ? 'モニター' : '再診') . "\n" . $what;
                $r = null;
                usort($segs, fn($x, $y) => $x[2] <=> $y[2]);
                $treatEnd = $start;
                foreach ($segs as [$sl, $sm, $ss, $se, $role]) {
                    $made = Store::bookingCreate([
                        'patientId' => $patientId,
                        'laneId' => $sl,
                        'menuIds' => [$sm],
                        'startAt' => to_iso($f['date'], $ss),
                        'endAt' => to_iso($f['date'], $se),
                        'memo' => implode("\n", array_filter([
                            "{$head}\n{$role}（" . self::hm($ss) . '〜' . self::hm($se) . '）',
                            $f['part'] !== '' ? '部位：' . $f['part'] : null,
                            $f['email'] !== '' ? 'メール：' . $f['email'] : null,
                            $uid !== null ? '確定の連絡：LINE（予約ページを LINE で開いて予約）' : null,
                            $f['notes'] !== '' ? 'ご相談：' . $f['notes'] : null,
                        ])),
                        'lineUserId' => $uid,
                    ], self::ACTOR);
                    $r ??= $made;
                    if ($role === '施術') {
                        $treatEnd = $se;
                    }
                }
                if ($uid !== null) {
                    Store::bookingLinkLine($patientId, $uid, 'LINE紐付け（日曜の予約を LINE で）', self::ACTOR);
                }
                return ['ok' => true, 'end' => self::hm($treatEnd), 'id' => $r['id']];
            }
            $r = Store::bookingCreate([
                'patientId' => $patientId,
                'laneId' => $lane,
                // 時間が変わるメニューの初診は、説明と施術を続けて取るので、再診（施術）のメニューも付ける（機器の重なりを見分けるため）
                'menuIds' => array_values(array_unique(array_filter([$it[$k . 'MenuId'], $first && self::variable($it) ? $it['repeatMenuId'] : '']))),
                'startAt' => to_iso($f['date'], $start),
                'endAt' => to_iso($f['date'], $start + $len),
                'memo' => $memo,
                'lineUserId' => $uid,
            ], self::ACTOR);
            if ($uid !== null) {
                Store::bookingLinkLine($patientId, $uid, 'LINE紐付け（日曜の予約を LINE で）', self::ACTOR);
            }
            return ['ok' => true, 'end' => self::hm($start + $len), 'id' => $r['id']];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => 'menu', 'item' => $it, 'visit' => $first ? 'first' : 'repeat', 'end' => $result['end'], 'pick' => $pick];
        [$lined] = $uid !== null ? Reminder::pushText($uid, self::mailBody($f)) : [false];
        $sent = false;
        if (!$lined && $f['email'] !== '') {
            [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject('menu', $it['name']), self::mailBody($f)) : [false];
        }
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'duration' => self::itemDurationText($it, $first, $pick), 'lined' => (bool) $lined, 'mailed' => (bool) $sent];
    }

    private static function num(float $a): string
    {
        return rtrim(rtrim(number_format($a, 1, '.', ''), '0'), '.');
    }

    private static function mailSubject(string $kind, string $itemName = ''): string
    {
        $what = match ($kind) { 'artmake' => 'アートメイク除去', 'menu' => $itemName, default => 'タトゥー除去' };
        return '【' . Store::publicInfo()['publicName'] . '】' . $what . '（日曜日）のご予約を承りました';
    }

    public static function mailBody(array $f): string
    {
        $p = Store::publicInfo();
        $c = Store::clinic();
        $phone = (string) ($c['phone'] ?? '');
        if ($f['kind'] === 'menu') {
            $it = $f['item'];
            $first = $f['visit'] === 'first';
            return implode("\n", array_filter([
                "{$f['name']} 様",
                '',
                "{$it['name']}（日曜日）のご予約を承りました。",
                '',
                '日時：' . format_date_ja($f['date']) . " {$f['time']}〜{$f['end']}（ご来院は {$f['time']} までにお願いします）",
                '所要時間：' . self::itemDurationText($it, $first, $f['pick'] ?? []),
                '区分：' . ($first ? '初診' : '再診'),
                self::pickText($it, $f['pick'] ?? []) !== '' ? ((self::isFlow($it) ? '' : (($it['countPerMinute'] ?? 0) > 0 ? '本数：' : '部位：')) . self::pickText($it, $f['pick'] ?? [])) : null,
                $p['accessUrl'] !== '' ? 'アクセス：' . $p['accessUrl'] : ($p['address'] !== '' ? '場所：' . $p['address'] : null),
                ($it['note'] ?? '') !== '' ? '' : null,
                ($it['note'] ?? '') !== '' ? '【ご来院前のお願い】' : null,
                ($it['note'] ?? '') !== '' ? $it['note'] : null,
                '',
                '【日曜日のご来院について】',
                ...self::VISIT_NOTICE,
                '',
                'ご予約の変更・キャンセルは、当院の LINE' . ($phone !== '' ? "、またはお電話（{$phone}）" : '') . 'でご連絡ください。',
                '',
                '【キャンセル・日程変更にかかる料金規定】',
                ...self::CANCEL_POLICY,
                '',
                $p['publicName'],
            ], fn($l) => $l !== null));
        }
        $what = $f['kind'] === 'artmake' ? 'アートメイク除去' : 'タトゥー除去';
        return implode("\n", array_filter([
            "{$f['name']} 様",
            '',
            "{$what}のご予約を承りました。",
            '',
            '日時：' . format_date_ja($f['date']) . " {$f['time']}〜{$f['end']}（ご来院は {$f['time']} までにお願いします）",
            '所要時間：' . self::durationText(self::treatMinutes((float) $f['area']), $f['visit'] === 'first'),
            '区分：' . ($f['visit'] === 'first' ? '初診（照射の前にご説明があります）' : '再診'),
            '希望照射面積：' . self::num((float) $f['area']) . 'cm²',
            '料金の目安：1回 ' . number_format(self::price((float) $f['area'])) . '円（税込）' . ($f['anesthesia'] ? '＋局所麻酔注射 1ccあたり5,500円（税込）' : ''),
            '面積は当日に測り、照射の前に料金をお伝えします。',
            $p['accessUrl'] !== '' ? 'アクセス：' . $p['accessUrl'] : ($p['address'] !== '' ? '場所：' . $p['address'] : null),
            '',
            'タトゥー・アートメイク除去は日曜日の診療です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なりますのでご注意ください。',
            '',
            '【ご来院前のお願い】',
            self::SHAVE_NOTICE[$f['kind'] === 'artmake' ? 'artmake' : 'tattoo'],
            '',
            '【日曜日のご来院について】',
            ...self::VISIT_NOTICE,
            '',
            'ご予約の変更・キャンセルは、当院の LINE' . ($phone !== '' ? "、またはお電話（{$phone}）" : '') . 'でご連絡ください。',
            '',
            '【キャンセル・日程変更にかかる料金規定】',
            ...self::CANCEL_POLICY,
            '',
            $p['publicName'],
        ], fn($l) => $l !== null));
    }
}
