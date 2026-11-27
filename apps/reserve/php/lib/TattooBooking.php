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
    public const MAX_ITEMS = 60;
    private const MAX_ITEM_MINUTES = 180;
    /** 日曜のご来院の案内（院長の文面 11/18）。予約ページ・確定メール・リマインド（タトゥー除去のメニューの予約）で同じ文を出す */
    public const VISIT_NOTICE = [
        '日曜日は表のシャッターが閉まっております。建物左側面の駐車場に沿った奥に「美容皮膚科予約済の方専用入口」と掲示された扉がございますので、そちらからお入りください。',
        'この日は受付がおりませんので、到着されましたら当院の LINE に「到着済」とご送信いただき、待合室におかけになってお待ちください。',
        'ご予約の時間は「ご来院時間のご予約」であり、診療開始時刻ではございません。前の方の処置の状況や混雑により、お呼び出しが遅れる場合がございます。後のご予定には十分に余裕をもってお越しください。',
    ];

    /** ご来院前のお願い（院長の指示 11/19）：照射する部分の毛は剃ってくる。眉のアートメイクも、照射する部分は眉毛ごと剃る（院長「打ってほしい部分は眉毛だろうが剃る」） */
    public const SHAVE_NOTICE = [
        'tattoo' => '照射部位の産毛は、ご来院前にご自身で剃ってきてください。',
        'artmake' => '照射する部分は、眉毛も含めて、ご来院前にご自身で剃ってきてください。',
    ];
    /** 日曜のご予約すべてのご来院前のお願い（施術によらない。院長 11/19） */
    public const NO_MAKEUP = 'お顔の診察や施術を受ける方は、当日はノーメイクでお越しください。ファンデーションを軽く拭き取っても残りがあると、レーザーの照射に悪影響があります。';
    /** 予約ページの同意事項で太字にする語句（院長 11/21） */
    public const CONSENT_STRONG = ['ノーメイク', 'デリケートゾーンやお尻の施術を受ける方', 'タトゥー・アートメイク除去の方', '最大15分の枠', '「美容皮膚科予約済の方専用入口」と掲示された扉', 'LINE に「到着済」', '「ご来院時間のご予約」であり、診療開始時刻ではございません'];

    /** 予約ページに出す文（HTML）。決めた語句を太字に */
    public static function strongHtml(string $text): string
    {
        $out = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
        foreach (self::CONSENT_STRONG as $w) {
            $e = htmlspecialchars($w, ENT_QUOTES, 'UTF-8');
            $out = str_replace($e, '<strong>' . $e . '</strong>', $out);
        }
        return $out;
    }

    /** デリケートゾーン・お尻の施術の方へ（院長 11/21） */
    public const DELICATE_NOTICE = 'デリケートゾーンやお尻の施術を受ける方は、受診前にお尻拭きでの拭き取り、またはウォッシュレットでの洗浄を必ずお願いします。';
    /** キャンセル・日程変更にかかる料金規定（ホームページの料金ページ https://ishidahihuka.jp/service/price/ の「注意事項」と同じ文。院長 11/19） */
    public const CANCEL_POLICY = [
        '前々日の14時まで：無料',
        '前々日14時～前日：施術料金の20％、または施術予定メニューが決まっていない方は3,000円',
        '当日：施術料金の50％、または施術予定メニューが決まっていない方は8,000円。コース契約中の方は1回分消化',
        '悪質なキャンセルや無断キャンセルは、次回以降のご予約をお断りします。',
        'キャンセル料は次回来院時にお支払いください。',
    ];
    /** 予約ページ（除去するものを選ぶ前にも出す）の文 */
    public const SHAVE_NOTICE_PAGE = '照射する部分の毛は、ご来院前にご自身で剃ってきてください（眉のアートメイクの方は、照射する部分の眉毛も剃ってください）。';

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
                    // 顔のメニューか（11/20 より前に保存したものは見本の分け方）
                    fn($it) => (array_key_exists('category', $it) ? $it : $it + ['category' => self::PRESET_CATEGORY[$it['id']] ?? '']) + ['neobo' => self::face($it)],
                    array_values(array_filter((array) $c['sundayMenus'], fn($it) => is_array($it) && !empty($it['id'])))
                )
                : self::presets(),
        ];
    }

    // 11/21 に「除去・レーザー」から改名（院長：体・唇の黒ずみ美白トーニングを入れるため）
    public const REMOVAL_CATEGORY = '除去・美白・レーザー';
    /** プリセットの分類（院長 11/19：まず分類を選び、次にメニュー） */
    private const PRESET_CATEGORY = [
        'botox' => '注射・注入', 'hyperhidrosis' => '注射・注入', 'hyaluronic' => '注射・注入', 'juvelook' => '注射・注入', 'babycollagen' => '注射・注入',
        'miraclel' => '注射・注入', 'fatx' => '注射・注入', 'sunekos' => '注射・注入', 'fillroad' => '注射・注入', 'tapink' => '注射・注入',
        'pinkglow' => '注射・注入', 'tranestamp' => '注射・注入', 'juveacell' => '注射・注入', 're2o' => '注射・注入',
        'hokuro' => '除去・美白・レーザー', 'spot' => '除去・美白・レーザー', 'dyelaser' => '除去・美白・レーザー', 'isotretinoin' => '内服', 'zoskin' => 'ゼオスキン',
        'tcapeel' => 'ピーリング', 'amalfi' => 'ピーリング', 'massagepeel' => 'ピーリング', 'milano' => 'ピーリング', 'salicylic' => 'ピーリング',
        'laserhair' => '脱毛', 'needlehair' => '脱毛',
        // 11/19 追加（院長「全部日曜に入れて。オンオフはこっちで」。すべてオフ）
        'dermapen' => 'ダーマペン', 'velvet' => 'ダーマペン', 'supervelvet' => 'ダーマペン',
        'co2frac' => '除去・美白・レーザー', 'darktoning' => '除去・美白・レーザー', 'tightening' => '除去・美白・レーザー', 'spotmonitor' => '除去・美白・レーザー',
        'hifu' => 'たるみ', 'mouthsag' => 'たるみ', 'sagging' => 'たるみ', 'marionette' => 'たるみ', 'neckwrinkle' => 'たるみ', 'ponyorin' => 'たるみ',
        'scalp' => '薄毛', 'agafaga' => '薄毛',
    ];
    private const M = 'lane-main';
    private const N = ['lane-1', 'lane-3'];
    private const MEMO = 'menu-s000099DC1'; // 予約（メモに自由記載）
    /** 機器・ベッド・レーンのルールは ClinicRules にまとめてある（院長 11/28） */
    public const GENTLEMAX = ClinicRules::GENTLEMAX;
    public const PICO = ClinicRules::PICO;
    public const CO2 = ClinicRules::CO2;
    public const BED2_LANE = ClinicRules::MAIN;
    public const CO2_MOVE_LANE = ClinicRules::MACHINES[ClinicRules::CO2]['moveTo'];
    /** 黒ずみ美白トーニング（院長 11/21） */
    public const TONING_MENU = '黒ずみトーニング';
    private const TONING_PARTS = ['リップ（唇・口角。アートメイク不可）', '両脇', 'ニップル（乳首＋乳輪）', 'デリケートゾーン（V・I）', '臀部（Oライン不可）'];
    private const TONING_NOTE = 'リップは口紅、脇は制汗剤を落としてお越しください。VI・お尻は受診前に拭き取りまたは洗浄をお願いします。毛の自己処理は前日までに済ませてください。';

    /** 名前で予約のメニューを探す（なければ空） */
    private static function menuByName(string $name): string
    {
        foreach (Db::i()->all('menu') as $m) {
            if (($m['name'] ?? '') === $name && !empty($m['active']) && empty($m['deleted'])) {
                return $m['id'];
            }
        }
        return '';
    }
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
        // ほくろ除去：個数を1つ選ぶ（院長 11/19。時間は時間表「初診ほくろまとめ15」20分・「20以上」30分。1〜4個は表にないので20分）。初診のみ・医師レーン
        // （PRESETS の 'hokuro' は下で部位の形に置き換える）
        // シミ取り（時間表「初診シミ」20分・登録「シミまとめ標準20分」。どちらも医師レーン。院長 11/19）
        ['spot', 'シミ取り', 20, [self::M], 'menu-x003', 20, [self::M], 'menu-s000099B91', ''],
        ['dyelaser', '色素レーザー（ダイレーザー）', 20, [self::M], self::CONSULT, 10, [self::M], 'menu-s00009A3AE', ''],
        ['isotretinoin', 'イソトレチノイン', 15, [self::M], self::MEMO, 10, [self::M], self::MEMO, ''],
        ['tcapeel', 'TCAピーリング', 15, [self::M], self::MEMO, 10, [self::M], self::MEMO, ''],
        ['amalfi', 'アマルフィーピール', 15, [self::M], self::MEMO, 20, self::N, self::MEMO, ''],
        ['zoskin', 'ゼオスキンヘルス（カウンセリング）', 15, [self::M], self::MEMO, 15, [self::M], self::MEMO, ''],
        ['massagepeel', 'マッサージピール', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18A', ''],
        ['milano', 'ミラノリピール', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18B', ''],
        ['salicylic', 'サリチル酸ピーリング', 15, [self::M], self::CONSULT, 20, self::N, 'menu-s00009A18C', ''],
    ];

    /** レーザー脱毛の部位ごとの時間（シート1「レーザー脱毛」。施術後の掃除とカルテ記載込み）。[部位, 男性の分, 女性の分] */
    /**
     * レーザー脱毛の部位（ホームページ「医療脱毛」の料金表の部位分け・並び。院長 11/20）。[部位, 女性の分, 男性の分]。男性だけの部位は女性を null。
     * 鼻下＋顎・鼻下＋顎＋顎下のセットは入れない（ばらの部位を複数選ぶ。まとめて選んだときは予約枠時間一覧のまとめの時間）。
     * 時間は予約枠時間一覧（11/20 時点）。スプレッドシートから受け取ったら、そちらに合わせる（applyLaserSheet）
     */
    private const LASER_HAIR_PARTS = [
        ['眉上・眉間', 10, 10], ['鼻下', 5, 10], ['顎', 5, 10], ['顎下', 5, 10], ['両頬', null, 5],
        ['両ワキ', 5, 5], ['乳輪(太い毛のみ)', 5, 5], ['へそ周り(濃い毛のみ)', 5, 5],
        ['肘上10cm', 5, 5], ['肘～指先', 25, 25], ['Vライン前面', 5, 5], ['I+Oライン', 15, 20], ['手+指', 5, 5],
        ['太もも', 30, 40], ['膝', 10, 10], ['スネ', 20, 30], ['足甲～指先', 5, 5],
    ];

    /** レーザー脱毛の部位（$col 1：女性、2：男性） */
    private static function laserParts(int $col): array
    {
        return array_values(array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[$col]], array_filter(self::LASER_HAIR_PARTS, fn($r) => $r[$col] !== null)));
    }

    /** 保存済みのレーザー脱毛を、ホームページの部位分けに置き換える（本番の一覧の入れ替え用）。予約枠時間一覧を受け取っていれば、その時間 */
    public static function laserHairParts(array $it): array
    {
        return self::applyLaserSheet([...$it, 'partGroups' => [['name' => '女性', 'parts' => self::laserParts(1)], ['name' => '男性', 'parts' => self::laserParts(2)]], 'pickOne' => false]);
    }

    /**
     * 予約枠時間一覧（スプレッドシート「シート1」のA・B列）の名前と、ホームページの部位の対応。
     * まとめの行（鼻下+顎 など）は、その部位をすべて選んだときにまとめの時間を使う（院長 11/20）
     */
    private const LASER_SHEET_NAME = [
        '眉上・眉間' => '眉', '乳輪(太い毛のみ)' => '乳輪', 'へそ周り(濃い毛のみ)' => 'へそ回り', '肘～指先' => '前腕～手先',
        'Vライン前面' => 'V', 'I+Oライン' => 'IO', '太もも' => '大腿', 'スネ' => '下腿',
    ];
    private const LASER_SHEET_COMBOS = [
        '下肢全部' => ['大腿', '膝', '下腿', '足甲～指先'],
        '鼻下+顎+顎下' => ['鼻下', '顎', '顎下'],
        '下腿～足先' => ['下腿', '足甲～指先'],
        '鼻下+顎' => ['鼻下', '顎'],
        'VIO' => ['V', 'IO'],
    ];

    /** 部位の名前をくらべるときの形（全角・半角と、波線 ～ 〜 ~ の違いをそろえる） */
    private static function sheetKey(string $name): string
    {
        return str_replace(['~', '〜', '∼'], '～', normalize_width(js_trim($name)));
    }

    /** ホームページの部位の名前 → 予約枠時間一覧の名前 */
    private static function sheetNameOf(string $name): string
    {
        $k = self::sheetKey($name);
        foreach (self::LASER_SHEET_NAME as $from => $to) {
            if (self::sheetKey($from) === $k) {
                return self::sheetKey($to);
            }
        }
        return $k;
    }

    /**
     * 予約枠時間一覧のセルの値（行ごとの配列）から、レーザー脱毛の時間を読む。
     * ['女' => [名前 => 分], '男' => [...], 'explain' => 初診説明の分]。読めなければ null
     */
    public static function parseTimeSheet(array $rows): ?array
    {
        $out = ['女' => [], '男' => [], 'explain' => 0];
        $sex = '';
        $num = fn($v) => preg_match('/^(\d{1,3})\s*分?$/u', normalize_width(js_trim((string) $v)), $m) ? (int) $m[1] : null;
        foreach ($rows as $r) {
            if (!is_array($r)) {
                continue;
            }
            $a = self::sheetKey((string) ($r[0] ?? ''));
            $b = $num($r[1] ?? '');
            if ($a === '男' || $a === '女') {
                $sex = $a;
            } elseif ($a === '初診説明' && $b !== null) {
                $out['explain'] = $b;
            } elseif ($sex !== '' && $a !== '' && $b !== null && $b >= 5 && $b <= self::MAX_ITEM_MINUTES && $b % 5 === 0) {
                $out[$sex][$a] = $b;
            }
        }
        return $out['女'] !== [] && $out['男'] !== [] ? $out : null;
    }

    /** レーザー脱毛の部位の時間と、まとめの時間・初診説明を、受け取った予約枠時間一覧に合わせる（なければそのまま） */
    public static function applyLaserSheet(array $it, ?array $sheet = null): array
    {
        $sheet ??= Db::i()->meta('laserHairSheet');
        if (!is_array($sheet) || ($it['partGroups'] ?? []) === []) {
            return $it;
        }
        foreach ($it['partGroups'] as &$g) {
            $times = $sheet[$g['name'] === '男性' ? '男' : ($g['name'] === '女性' ? '女' : '')] ?? null;
            if (!is_array($times)) {
                continue;
            }
            // 前に受け取った時間も、名前の形をそろえて使う
            $times = array_combine(array_map(fn($k) => self::sheetKey((string) $k), array_keys($times)), array_values($times));
            $idx = [];
            foreach ($g['parts'] as $i => &$pt) {
                $key = self::sheetNameOf($pt['name']);
                $idx[$key] = $i;
                if (isset($times[$key])) {
                    $pt['minutes'] = $times[$key];
                }
            }
            unset($pt);
            $g['combos'] = [];
            foreach (self::LASER_SHEET_COMBOS as $name => $parts) {
                $name = self::sheetKey($name);
                $parts = array_map(fn($p) => self::sheetKey($p), $parts);
                if (isset($times[$name]) && array_diff($parts, array_keys($idx)) === []) {
                    $g['combos'][] = ['parts' => array_map(fn($p) => $idx[$p], $parts), 'minutes' => $times[$name]];
                }
            }
        }
        unset($g);
        if (($sheet['explain'] ?? 0) >= 5) {
            $it['firstMinutes'] = $sheet['explain'];
        }
        return $it;
    }

    /**
     * 予約枠時間一覧を受け取る（スプレッドシートの Apps Script から）。保存して、日曜メニューのレーザー脱毛の時間を合わせる。
     * シートが消された・壊れた（部位やまとめの行・初診説明が足りない、時間が数字でない）ときは何も変えず、前に受け取った時間のまま動く。
     * 断った理由は meta laserHairSheetError に残し、Apps Script には失敗を返す（院長 11/20）
     */
    public static function receiveTimeSheet(array $rows): array
    {
        $sheet = self::parseTimeSheet($rows);
        $missing = $sheet === null ? ['男・女の表'] : self::sheetMissing($sheet);
        if ($missing !== []) {
            $reason = '予約枠時間一覧が足りないため、取り込みませんでした（前の時間のまま）：' . implode('、', array_slice($missing, 0, 10)) . (count($missing) > 10 ? ' ほか' : '');
            Db::i()->setMeta('laserHairSheetError', ['at' => now_iso(), 'reason' => $reason]);
            throw new StoreError('invalid', $reason);
        }
        $prev = Db::i()->meta('laserHairSheet');
        if (is_array($prev)) {
            Db::i()->setMeta('laserHairSheetPrev', $prev);
        }
        Db::i()->setMeta('laserHairSheet', [...$sheet, 'at' => now_iso()]);
        Db::i()->setMeta('laserHairSheetError', null);
        $c = Store::clinic();
        $changed = 0;
        if (array_key_exists('sundayMenus', $c)) {
            $items = self::settings()['items'];
            foreach ($items as &$it) {
                if (($it['id'] ?? '') === 'laserhair') {
                    $next = self::applyLaserSheet($it, $sheet);
                    $changed += (int) ($next !== $it);
                    $it = $next;
                }
            }
            unset($it);
            if ($changed) {
                Store::updateClinic(['sundayMenus' => $items], ['id' => 'system', 'name' => '予約枠時間一覧（スプレッドシート）']);
            }
        }
        return ['ok' => true, 'female' => count($sheet['女']), 'male' => count($sheet['男']), 'changed' => $changed];
    }

    /** 受け取ったシートに足りないもの（予約ページの部位・まとめの行・初診説明）。全部そろっていれば空 */
    private static function sheetMissing(array $sheet): array
    {
        $missing = [];
        if (($sheet['explain'] ?? 0) < 5) {
            $missing[] = '初診説明';
        }
        foreach ([1 => '女', 2 => '男'] as $col => $sex) {
            $need = [];
            foreach (self::LASER_HAIR_PARTS as $r) {
                if ($r[$col] !== null) {
                    $need[] = self::sheetNameOf($r[0]);
                }
            }
            foreach (self::LASER_SHEET_COMBOS as $name => $parts) {
                if (array_diff(array_map(fn($p) => self::sheetKey($p), $parts), $need) === []) {
                    $need[] = self::sheetKey($name);
                }
            }
            foreach ($need as $n) {
                if (!isset($sheet[$sex][$n])) {
                    $missing[] = "{$sex}の{$n}";
                }
            }
        }
        return $missing;
    }

    /** 予約枠時間一覧の取り込みの状況（設定の画面に出す） */
    public static function sheetStatus(): array
    {
        $ok = Db::i()->meta('laserHairSheet');
        $err = Db::i()->meta('laserHairSheetError');
        return ['at' => is_array($ok) ? (string) ($ok['at'] ?? '') : '', 'errorAt' => is_array($err) ? (string) $err['at'] : '', 'error' => is_array($err) ? (string) $err['reason'] : ''];
    }

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
        // 針脱毛は4本で1分。初診は説明15分を足す（1件の上限は90分：一人の看護師が続けて行うのは1時間半を超えるなら1件まで）
        $out[] = [
            'id' => 'laserhair', 'name' => '医療レーザー脱毛', 'enabled' => false,
            // 機器（ジェントルマックスプロ）は1台で1番レーンだけ（院長 11/20）
            'firstMinutes' => 15, 'firstLaneIds' => $lane(['lane-1']), 'firstMenuId' => $menu('menu-s0000A43A3'),
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane(['lane-1']), 'repeatMenuId' => $menu('menu-s0000A1344'),
            'machine' => self::GENTLEMAX, 'note' => '',
            'partGroups' => [
                ['name' => '女性', 'parts' => self::laserParts(1)],
                ['name' => '男性', 'parts' => self::laserParts(2)],
            ],
            'countPerMinute' => 0, 'maxMinutes' => 0, 'creamAsk' => true,
        ];
        $out[count($out) - 1] = self::applyLaserSheet($out[count($out) - 1]);
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
        // ダーマペン系・炭酸ガス（予約エンジンルール「複合/麻酔施術」：麻酔クリーム10分の40〜60分後に施術。ダーマペン系は共通機器でレーン横断の重複禁止。炭酸ガスの施術はメイン）。
        // 施術時間：ヴェルヴェット・スーパーヴェルヴェットは時間表の20分、ダーマペンは30分（自由10〜90分のため仮。オンにする前に確かめる）、炭酸ガスは全顔15分
        // 麻酔は麻酔クリームだけなので、麻酔の注射の時間は0（予約ページで麻酔の注射を選べない。院長 11/20）
        $out[] = $flow('dermapen', 'ダーマペン', self::N, 'menu-x093', 30, 0, 'ダーマペン');
        $out[] = $flow('velvet', 'ヴェルヴェットスキン', self::N, 'menu-x036', 20, 0, 'ダーマペン');
        $out[] = $flow('supervelvet', 'スーパーヴェルヴェットスキン', self::N, 'menu-x037', 20, 0, 'ダーマペン');
        // 炭酸ガスは範囲で施術の時間：全顔15分・部分10分（麻酔の種類によらない。院長 11/20）
        $out[] = [...$flow('co2frac', '炭酸ガスフラクショナル', [self::M], 'menu-s0000A7D2D', 15, 0, '炭酸ガス'),
            'partGroups' => [['name' => '範囲', 'parts' => [['name' => '全顔', 'minutes' => 15], ['name' => '部分', 'minutes' => 10]]]], 'pickOne' => true, 'pickLabel' => '範囲'];
        // 決まった時間のもの（時間表・公開治療メニュー照合から。初診は医師の診察だけ）
        $fixed = fn(string $id, string $name, int $fm, string $fmenu, int $rm, array $rl, string $rmenu, string $machine = '') => [
            'id' => $id, 'name' => $name, 'enabled' => false,
            'firstMinutes' => $fm, 'firstLaneIds' => $fm > 0 ? $lane([self::M]) : [], 'firstMenuId' => $fm > 0 ? $menu($fmenu) : '',
            'repeatMinutes' => $rm, 'repeatLaneIds' => $rm > 0 ? $lane($rl) : [], 'repeatMenuId' => $rm > 0 ? $menu($rmenu) : '',
            'machine' => $machine, 'note' => '', 'partGroups' => [], 'countPerMinute' => 0, 'maxMinutes' => 0,
        ];
        // Qスイッチルビーレーザーはシミ取りと同じなので、シミ取りに統合（院長 11/20）
        $out[] = $fixed('tightening', 'レーザーシャワー・タイトニングレーザー', 20, self::CONSULT, 15, ['lane-1'], 'menu-x030', self::GENTLEMAX);
        $out[] = $fixed('spotmonitor', 'シミ・くすみ・肝斑の集中治療モニター', 20, 'menu-x018', 15, [self::M], 'menu-x028');
        $out[] = $fixed('mouthsag', '口元たるみ集中治療', 20, 'menu-mw7qa5ak-95be93', 30, [self::M], 'menu-x099');
        $out[] = $fixed('sagging', 'たるみ治療', 20, 'menu-mw7qa5ak-95be93', 0, [], '');
        $out[] = $fixed('marionette', 'マリオネットライン治療', 30, 'menu-s00009A0D8', 20, [self::M], 'menu-s00009A0D8');
        $out[] = $fixed('neckwrinkle', '首のしわ治療', 20, 'menu-mw7qa5ak-95be93', 0, [], '');
        $out[] = $fixed('ponyorin', 'ぽにょりん', 20, self::CONSULT, 0, [], '');
        $out[] = $fixed('scalp', '頭皮注射（毛髪成長因子）', 20, 'menu-x013', 15, [self::M], 'menu-x027');
        // AGA・FAGA：初診は「保険の日に案内」（時間表）なので受けない。再診の薬の相談15分だけ
        $out[] = $fixed('agafaga', 'AGA・FAGA（お薬の再診）', 0, '', 15, [self::M], 'menu-x101');
        // ハイフ（時間表）：初めては看護師のカウンセリング15分を足す。コース×部位の時間。オーダーメイドは各部位＋15分。脱毛とは別機械
        $hifu = [['顔＋顎下', 45, 30], ['顔', 30, 20], ['頬', 15, 10], ['顎下', 15, 10], ['首', 15, 10]];
        $out[] = [
            'id' => 'hifu', 'name' => 'ハイフ', 'enabled' => false,
            'firstMinutes' => 15, 'firstLaneIds' => $lane(self::N), 'firstMenuId' => $menu('menu-x041'),
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane(self::N), 'repeatMenuId' => $menu('menu-s0000C0E47'),
            'machine' => 'ハイフ', 'note' => '',
            'partGroups' => [
                ['name' => 'スタンダード・引き締め', 'parts' => array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[1]], $hifu)],
                ['name' => 'オーダーメイド', 'parts' => array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[1] + 15], $hifu)],
                ['name' => 'ライト', 'parts' => array_map(fn($r) => ['name' => $r[0], 'minutes' => $r[2]], $hifu)],
                ['name' => '頬または顎下の脂肪集中', 'parts' => [['name' => '1部位', 'minutes' => 15]]],
            ],
            'countPerMinute' => 0, 'maxMinutes' => 0,
        ];
        $out[] = [
            // 初診も受ける（院長 11/20）：説明15分に続けて本数の施術（3番レーン）
            'id' => 'needlehair', 'name' => '針脱毛', 'enabled' => false,
            'firstMinutes' => 15, 'firstLaneIds' => $lane(['lane-3']), 'firstMenuId' => $menu('menu-s0000A43A3'),
            // 針脱毛の機器は1台で3番レーンだけ（院長 11/20）
            'repeatMinutes' => 0, 'repeatLaneIds' => $lane(['lane-3']), 'repeatMenuId' => $menu('menu-s0000B6B1C'),
            'machine' => '', 'note' => '', 'partGroups' => [], 'countPerMinute' => 4, 'maxMinutes' => 90, 'needle' => true,
        ];
        // 体・唇の黒ずみ美白トーニング（女性看護師が照射。機器はディスカバリーピコプラス：タトゥー・シミ取りと同じ。院長 11/21）
        // 初診：脱毛と同じく1番・3番で説明10分＋照射（1部位10分、追加1部位ごとに5分）。再診：1部位10分、追加1部位ごとに5分（院長 11/21）
        $tone = self::menuByName(self::TONING_MENU);
        $out[] = [
            'id' => 'darktoning', 'name' => '体・唇の黒ずみ美白トーニング', 'enabled' => false,
            'firstMinutes' => 10, 'firstBase' => 5, 'firstLaneIds' => $lane(self::N), 'firstMenuId' => $tone,
            'repeatMinutes' => 5, 'repeatLaneIds' => $lane(self::N), 'repeatMenuId' => $tone,
            'machine' => self::PICO, 'note' => self::TONING_NOTE,
            'partGroups' => [['name' => '部位', 'parts' => array_map(fn($n) => ['name' => $n, 'minutes' => 5], self::TONING_PARTS)]],
            'countPerMinute' => 0, 'maxMinutes' => 0, 'pickLabel' => '照射する部位',
        ];
        // ほくろ除去は個数を1つ選ぶ（院長 11/19）。ネオボは顔だけなので、顔以外のメニューはモニターでも撮影の枠を取らない（院長 11/20）
        foreach ($out as &$it) {
            $it['neobo'] = !in_array($it['id'], self::NOT_FACE, true);
            // シミ取りはタトゥー除去と同じ機器（ピコ）
            if ($it['id'] === 'spot') {
                $it['machine'] = self::PICO;
            }
            if ($it['id'] === 'hokuro') {
                // ほくろ除去は炭酸ガスレーザー（院長 11/27）
                $it['machine'] = self::CO2;
                $it = self::hokuroParts($it);
            } elseif ($it['id'] === 'dyelaser') {
                $it = self::dyeParts($it);
            }
        }
        unset($it);
        return self::reshapeSagging(array_map(fn($it) => $it + ['category' => self::PRESET_CATEGORY[$it['id']] ?? ''], $out));
    }

    /**
     * たるみの分類を院長の指示どおりに（11/19）：ハイフ → たるみマリオネットライン集中治療（ハイフ＋ヒアルロン酸＋ぽにょりん割引セット）
     * → 首のしわ治療（ヒアルロン酸・肌育注射など）→ その他（自由記載）。口元たるみ集中治療・ぽにょりんはセットにまとめて消す。
     * オン・オフとレーンは今の設定のまま。見本と本番の保存済みの一覧の両方に使う
     */
    public static function reshapeSagging(array $items): array
    {
        [, $menus] = Store::laneAndMenuIds();
        $set = [
            // セット：初診30分（ヒアルロン酸の初診の枠）、再診30分（口元たるみ集中治療〈部分HIFU＋…〉の枠）。どちらも医師レーン（院長 11/20 確認）
            'marionette' => ['name' => 'たるみマリオネットライン集中治療（ハイフ＋ヒアルロン酸＋ぽにょりん割引セット）', 'repeatMinutes' => 30, 'repeatMenuId' => in_array('menu-x099', $menus, true) ? 'menu-x099' : ''],
            'neckwrinkle' => ['name' => '首のしわ治療（ヒアルロン酸・肌育注射など）'],
            'sagging' => ['name' => 'その他（自由記載）'],
        ];
        $byId = [];
        foreach ($items as $it) {
            if (in_array($it['id'], ['mouthsag', 'ponyorin'], true)) {
                continue;
            }
            if (isset($set[$it['id']])) {
                $it = [...$it, ...$set[$it['id']], 'category' => 'たるみ'];
                if ($it['id'] === 'marionette' && ($it['repeatLaneIds'] ?? []) === []) {
                    $it['repeatLaneIds'] = ['lane-main'];
                }
            }
            $byId[$it['id']] = $it;
        }
        // 脂肪溶解注射（Fat X）は注射・注入のまま（院長「移さない」）
        $order = ['hifu', 'marionette', 'neckwrinkle', 'sagging'];
        $out = [];
        foreach ($byId as $id => $it) {
            if (in_array($id, $order, true)) {
                if ($id === 'hifu' || !isset($byId['hifu'])) {
                    foreach ($order as $k) {
                        if (isset($byId[$k]) && !in_array($k, array_column($out, 'id'), true)) {
                            $out[] = $byId[$k];
                        }
                    }
                }
                continue;
            }
            $out[] = $it;
        }
        return $out;
    }

    /**
     * 色素レーザーの範囲（全顔・頬・顎・ポイント照射〈1か所から。1か所2,200円のメニュー〉）。どれも10分（院長 11/19）。
     * 初診は医師の診察20分＝説明10分＋範囲10分、再診は範囲の10分
     */
    public static function dyeParts(array $it): array
    {
        return [
            ...$it,
            'firstMinutes' => 10,
            'repeatMinutes' => 0,
            'partGroups' => [['name' => '範囲', 'parts' => [['name' => '全顔', 'minutes' => 10], ['name' => '頬', 'minutes' => 10], ['name' => '顎', 'minutes' => 10], ['name' => 'ポイント照射（1か所から）', 'minutes' => 10]]]],
            'pickOne' => true, 'pickLabel' => '範囲',
        ];
    }

    /** ほくろ除去の個数（顔1〜4個 15分・顔15個までまとめ 20分・顔20個以上まとめ 30分。院長 11/19）。初診のみ（再診はレーンなし） */
    public static function hokuroParts(array $it): array
    {
        return [
            ...$it,
            'firstMinutes' => 0,
            'repeatMinutes' => 0, 'repeatLaneIds' => [], 'repeatMenuId' => '',
            'partGroups' => [['name' => '顔', 'parts' => [['name' => '顔1〜4個', 'minutes' => 15], ['name' => '顔15個までまとめ', 'minutes' => 20], ['name' => '顔20個以上まとめ', 'minutes' => 30]]]],
            'pickOne' => true, 'pickLabel' => '個数',
        ];
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
                && (($it['creamMinutes'] ?? 0) > 0 || ($it['partGroups'] ?? []) !== [])
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
    /** モニターのネオボ撮影（＋麻酔クリーム）・麻酔クリームの枠を取るレーン。4番が埋まっている・予約不可のときは1番・3番で（院長 11/20） */
    private const FOUR_LANES = ['lane-4', 'lane-1', 'lane-3'];
    private const NEOBO_MENU = 'menu-s0000B6B52';
    /** 顔以外のメニュー（モニターでもネオボ撮影の枠を取らない。院長 11/20） */
    public const NOT_FACE = ['hyperhidrosis', 'isotretinoin', 'zoskin', 'laserhair', 'needlehair', 'scalp', 'agafaga', 'neckwrinkle', 'darktoning'];
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
            // 麻酔の注射の時間が0のメニュー（炭酸ガス・ダーマペン系は麻酔クリームだけ。院長 11/20）は、麻酔の注射を選べない
            if ($fp === null || ($fp[1] === 'injection' && (int) ($it['injectionMinutes'] ?? 0) === 0)) {
                return null;
            }
            // 範囲で施術の時間が決まるもの（炭酸ガス：全顔15分・部分10分。麻酔の種類によらない。院長 11/20）
            if (($it['partGroups'] ?? []) !== []) {
                return self::partsMinutes($it, $pick, 0);
            }
            return (int) ($fp[1] === 'injection' ? $it['injectionMinutes'] : $it['creamMinutes']);
        }
        // 初診は医師の診察だけのもの（黒ずみトーニング）：部位によらず初診の時間
        if ($first && !empty($it['firstFixed'])) {
            $m = (int) ($it['firstMinutes'] ?? 0);
            return $m >= 5 ? $m : null;
        }
        // 初診は説明（firstMinutes）に加えて、施術の土台の時間（firstBase。黒ずみトーニングは照射が1部位10分＝土台5分＋部位5分）
        return self::partsMinutes($it, $pick, (int) ($it[($first ? 'first' : 'repeat') . 'Minutes'] ?? 0) + ($first ? (int) ($it['firstBase'] ?? 0) : 0));
    }

    /** 足す時間 $min に、選んだ部位・本数の時間を足す（5分刻みに切り上げ）。選び方がおかしい・上限を超えるときは null */
    private static function partsMinutes(array $it, array $pick, int $min): ?int
    {
        if (($it['partGroups'] ?? []) !== []) {
            $g = $it['partGroups'][(int) ($pick['group'] ?? -1)] ?? null;
            $idx = array_values(array_unique(array_map('intval', array_filter((array) ($pick['parts'] ?? []), 'is_numeric'))));
            if (!is_numeric($pick['group'] ?? null) || $g === null || $idx === [] || (!empty($it['pickOne']) && count($idx) !== 1)) {
                return null;
            }
            foreach ($idx as $i) {
                if (!isset($g['parts'][$i])) {
                    return null;
                }
            }
            // まとめの時間（鼻下＋顎 など）：その部位をすべて選んだら、ばらの合計の代わりにまとめの時間（大きいまとめから）
            $left = $idx;
            $combos = $g['combos'] ?? [];
            usort($combos, fn($x, $y) => count($y['parts']) <=> count($x['parts']));
            foreach ($combos as $cb) {
                if (array_diff($cb['parts'], $left) === []) {
                    $min += (int) $cb['minutes'];
                    $left = array_diff($left, $cb['parts']);
                }
            }
            foreach ($left as $i) {
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
    /** 部位ごとの時間のメニューの問いの見出し（ほくろなら「個数」）。なければ「部位」 */
    public static function pickLabel(array $it): string
    {
        $l = trim((string) ($it['pickLabel'] ?? ''));
        return $l !== '' ? $l : '部位';
    }

    public static function pickText(array $it, array $pick): string
    {
        if (self::isFlow($it)) {
            $fp = self::flowPick($pick);
            $range = ($it['partGroups'] ?? []) !== [] ? self::partsText($it, $pick) : '';
            return $fp === null ? '' : ($range !== '' ? self::pickLabel($it) . '：' . $range . '／' : '') . '今回：' . self::STATUSES[$fp[0]] . '／麻酔：' . self::ANESTHESIA[$fp[1]];
        }
        return self::partsText($it, $pick);
    }

    private static function partsText(array $it, array $pick): string
    {
        if (($it['partGroups'] ?? []) !== []) {
            $g = $it['partGroups'][(int) ($pick['group'] ?? 0)] ?? ['name' => '', 'parts' => []];
            $names = [];
            foreach (array_unique(array_map('intval', (array) ($pick['parts'] ?? []))) as $i) {
                if (isset($g['parts'][$i])) {
                    $names[] = $g['parts'][$i]['name'];
                }
            }
            // 部位が1つだけの区分（ハイフの「頬または顎下の脂肪集中」など）は区分の名前だけ
            if (count($g['parts']) === 1 && count($it['partGroups']) > 1) {
                return $g['name'];
            }
            return (count($it['partGroups']) > 1 ? $g['name'] . '：' : '') . implode('・', $names);
        }
        if (($it['countPerMinute'] ?? 0) > 0) {
            return (int) ($pick['count'] ?? 0) . '本';
        }
        return '';
    }

    /** 針脱毛の料金の概算に使う、性別と局所麻酔注射の有無（院長 11/20。針脱毛の麻酔は局所麻酔注射だけ） */
    public const NEEDLE_SEX = ['female' => '女性', 'male' => '男性'];
    public const YES_NO = ['no' => '希望しない', 'yes' => '希望する'];
    /** 麻酔は約両手面積あたり（ホームページ「医療脱毛」：麻酔クリーム〈レーザー脱毛のみ〉税抜2,500円・局所麻酔注射〈針脱毛のみ〉税抜5,000円）。税込 */
    public const CREAM_YEN = 2750;
    public const INJECTION_YEN = 5500;
    public const ESTIMATE_NOTE = '料金は仮の概算です。当日の診察によって異なる場合があります。';

    /** 針脱毛の本数（VIO・VIO以外。同じ日に両方受ける方もいる）。[VIO, VIO以外]。数でなければ 0 */
    public static function needleCounts(array $pick): array
    {
        $n = fn($k) => is_numeric($pick[$k] ?? null) ? max(0, (int) $pick[$k]) : 0;
        return [$n('countVio'), $n('countOther')];
    }

    /**
     * 針脱毛の料金の概算（税込）。ホームページの料金表（取り込み済みの「医療ニードル脱毛」）から：VIO・VIO以外それぞれ 20本までの料金＋21本目からの1本ごと、針代1本、局所麻酔注射（約両手面積1つ分）。
     * 選び方が足りない・料金表にないときは null。['lines' => [[名前, 円], ...], 'total' => 円, 'text' => 1行の文]
     */
    public static function needleEstimate(array $pick): ?array
    {
        $sex = (string) ($pick['sex'] ?? '');
        $anes = (string) ($pick['needleAnes'] ?? '');
        [$vio, $other] = self::needleCounts($pick);
        if (!isset(self::NEEDLE_SEX[$sex], self::YES_NO[$anes]) || $vio + $other < 1 || $vio + $other > self::MAX_COUNT) {
            return null;
        }
        $yen = [];
        foreach (Store::getPriceList()['items'] as $x) {
            if (($x['source'] ?? '') === 'homepage' && ($x['category'] ?? '') === '医療ニードル脱毛' && is_int($x['priceYen'] ?? null)) {
                $yen[(string) $x['name']] = $x['priceYen'];
            }
        }
        $lines = [];
        foreach ([['VIO以外', $other, '一般部位（男女共通）'], ['VIO', $vio, $sex === 'male' ? '男性VIO' : '女性VIO']] as [$label, $n, $row]) {
            if ($n < 1) {
                continue;
            }
            $base = $yen["{$row} 20本まで"] ?? null;
            $per = $yen["{$row} 21本以上"] ?? null;
            if ($base === null || $per === null) {
                return null;
            }
            $lines[] = ["{$label}（{$n}本）", $base + max(0, $n - 20) * $per];
        }
        if (!isset($yen['針代'])) {
            return null;
        }
        $lines[] = ['針代（1本）', $yen['針代']];
        if ($anes === 'yes') {
            $lines[] = ['局所麻酔注射（約両手面積1つ分）', self::INJECTION_YEN];
        }
        $total = array_sum(array_column($lines, 1));
        $text = implode('＋', array_map(fn($l) => $l[0] . ' ' . number_format($l[1]) . '円', $lines)) . '＝合計 ' . number_format($total) . '円（税込）';
        return ['lines' => $lines, 'total' => $total, 'text' => $text];
    }

    /** 希望施術の一覧の予約（入力は book で確かめ済み）。仕事ごと・枠ごとに予約を作る */
    private static function bookChain(array $entries, array $f, array $s, ?string $uid): array
    {
        $jobs = self::jobsOf($entries, $s);
        $anyFirst = (bool) array_filter($entries, fn($e) => $e['first']);
        $result = Db::i()->transaction(function () use ($jobs, $anyFirst, $entries, $f, $s, $uid) {
            // 送る直前にもう一度、その時刻が選べるか確かめる（書き込みの鍵を持ったまま）
            $slot = null;
            foreach (self::planChain($jobs, $anyFirst, $s)[$f['date']] ?? [] as $c) {
                if ($c[0] === $f['time']) {
                    $slot = $c;
                }
            }
            if (!$slot) {
                return ['ok' => false, 'error' => 'slot_taken'];
            }
            try {
                $pat = Store::bookingEnsurePatient(['name' => $f['name'], 'kana' => $f['kana'], 'birthDate' => $f['birthDate'], 'phone' => $f['phone'], 'email' => $f['email'], 'sex' => self::chainSex($jobs)], self::ACTOR);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'contact_us'];
            }
            $patientId = $pat['patient']['id'];
            $segs = $slot[3];
            usort($segs, fn($x, $y) => $x[2] <=> $y[2]);
            $whole = implode('／', array_map(fn($j) => $j['label'], $jobs));
            $r = null;
            foreach ($segs as $i => [$lane, $menus, $a, $b, $role, $j]) {
                $job = $jobs[$j];
                $e = $job['entry'];
                $memo = implode("\n", array_filter([
                    $job['label'] . '（Web予約・日曜）' . ($job['consult'] ? '' : ($e['first'] ? '初診' : (($e['pick']['status'] ?? '') === 'monitor' ? 'モニター' : '再診'))),
                    $role . '（' . self::hm($a) . '〜' . self::hm($b) . '）',
                    $e !== null ? self::entryText($e) : null,
                    ($job['note'] ?? '') !== '' ? $job['note'] : null,
                    count($jobs) > 1 ? 'この日のご予約：' . $whole : null,
                    ...($i === 0 ? ($f['clinicLines'] ?? []) : []),
                    $f['email'] !== '' ? 'メール：' . $f['email'] : null,
                    $uid !== null ? '確定の連絡：LINE（予約ページを LINE で開いて予約）' : null,
                    $f['lineName'] !== '' ? 'LINEの表示名：' . $f['lineName'] : null,
                    $f['notes'] !== '' ? 'ご相談：' . $f['notes'] : null,
                ], fn($l) => $l !== null && $l !== ''));
                $made = Store::bookingCreate([
                    'patientId' => $patientId,
                    'laneId' => $lane,
                    'menuIds' => $menus,
                    'startAt' => to_iso($f['date'], $a),
                    'endAt' => to_iso($f['date'], $b),
                    'memo' => $memo,
                    'lineUserId' => $uid,
                ], self::ACTOR);
                $r ??= $made;
            }
            if ($uid !== null) {
                Store::bookingLinkLine($patientId, $uid, 'LINE紐付け（日曜の予約を LINE で）', self::ACTOR);
            }
            return ['ok' => true, 'end' => self::hm($slot[2]), 'id' => $r['id'], 'segs' => $segs, 'patientId' => $patientId];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => 'multi', 'jobs' => $jobs, 'segs' => $result['segs'], 'end' => $result['end']];
        $f['askQuestionnaire'] = self::askQuestionnaire($f, (string) $result['patientId']);
        [$lined] = $uid !== null ? Reminder::pushText($uid, self::mailBody($f, 'line')) : [false];
        $sent = false;
        if (!$lined && $f['email'] !== '') {
            [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject('multi'), self::mailBody($f)) : [false];
        }
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'duration' => self::chainDurationText($jobs), 'lined' => (bool) $lined, 'mailed' => (bool) $sent, 'questionnaire' => $f['askQuestionnaire'] ? self::questionnaireUrl($uid !== null ? 'line' : 'mail') : ''];
    }

    /** 希望施術1つの選んだ内容（部位・本数・面積・麻酔など）。予約メモ・確定の連絡に書く */
    private static function entryText(array $e): string
    {
        $it = $e['item'];
        $pick = $e['pick'];
        if (!$e['sameDay']) {
            return '当日施術の希望：無（ご相談のみ）' . ($pick['part'] !== '' ? '／部位：' . $pick['part'] : '');
        }
        if ($it === null) {
            return implode('／', array_filter([
                isset(self::STATUSES[(string) ($pick['status'] ?? '')]) ? '今回の治療内容：' . self::STATUSES[$pick['status']] : null,
                '面積：' . self::num((float) $e['area']) . 'cm²（照射' . self::treatMinutes((float) $e['area']) . '分）',
                $e['kind'] === 'tattoo' && ($pick['color'] ?? '') !== '' ? '色：' . ($pick['color'] === 'black' ? '黒のみ' : 'カラーあり') : null,
                '料金の目安：' . number_format(self::price((float) $e['area'])) . '円（税込・麻酔代別）',
                '局所麻酔注射：' . (!empty($pick['anesthesia']) ? '希望あり' : '希望なし'),
                $pick['part'] !== '' ? '部位：' . $pick['part'] : null,
            ]));
        }
        $what = self::pickText($it, $pick);
        return implode('／', array_filter([
            !self::isFlow($it) && isset(self::STATUSES[(string) ($pick['status'] ?? '')]) ? '今回の治療内容：' . self::STATUSES[$pick['status']] : null,
            $what !== '' ? ((($it['countPerMinute'] ?? 0) > 0 && !self::isFlow($it)) ? '本数：' : (self::isFlow($it) ? '' : self::pickLabel($it) . '：')) . $what : null,
            ...self::needleLines($it, $pick),
            ...self::creamLines($it, $pick),
            $pick['part'] !== '' ? '部位：' . $pick['part'] : null,
        ]));
    }

    /** 予約で聞いた性別（female／male、聞いていなければ空）：針脱毛は性別の欄、レーザー脱毛などは「女性」「男性」の部位の区分 */
    public static function sexOfPick(?array $it, array $pick): string
    {
        if ($it === null) {
            return '';
        }
        if (!empty($it['needle'])) {
            return isset(self::NEEDLE_SEX[(string) ($pick['sex'] ?? '')]) ? (string) $pick['sex'] : '';
        }
        if (($it['partGroups'] ?? []) === [] || empty($pick['parts'])) {
            return '';
        }
        return ['女性' => 'female', '男性' => 'male'][$it['partGroups'][(int) ($pick['group'] ?? 0)]['name'] ?? ''] ?? '';
    }

    /** 複数の施術のうち、性別が分かる最初のもの */
    private static function chainSex(array $jobs): string
    {
        foreach ($jobs as $job) {
            $e = $job['entry'] ?? null;
            if ($e !== null && ($x = self::sexOfPick($e['item'] ?? null, (array) ($e['pick'] ?? []))) !== '') {
                return $x;
            }
        }
        return '';
    }

    /** 予約メモ・確定の連絡に書く、針脱毛の性別・部位・麻酔と料金の概算 */
    private static function needleLines(array $it, array $pick): array
    {
        if (empty($it['needle'])) {
            return [];
        }
        $e = self::needleEstimate($pick);
        [$vio, $other] = self::needleCounts($pick);
        return [
            '性別：' . (self::NEEDLE_SEX[(string) ($pick['sex'] ?? '')] ?? '') . "／VIO：{$vio}本／VIO以外：{$other}本／局所麻酔注射：" . (self::YES_NO[(string) ($pick['needleAnes'] ?? '')] ?? ''),
            $e !== null ? '料金の概算：' . $e['text'] . '（' . self::ESTIMATE_NOTE . '）' : null,
        ];
    }

    /** 予約メモ・確定の連絡に書く、レーザー脱毛の麻酔クリームの希望 */
    private static function creamLines(array $it, array $pick): array
    {
        if (empty($it['creamAsk'])) {
            return [];
        }
        $yes = ($pick['cream'] ?? '') === 'yes';
        return ['麻酔クリーム：' . ($yes ? '希望する（約両手面積あたり' . number_format(self::CREAM_YEN) . '円・税込）' : '希望しない')];
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
                    'one' => !empty($it['pickOne']),
                    'pickLabel' => self::pickLabel($it),
                    'flow' => self::isFlow($it),
                    'noInjection' => self::isFlow($it) && (int) ($it['injectionMinutes'] ?? 0) === 0,
                    'needle' => !empty($it['needle']),
                    'creamAsk' => !empty($it['creamAsk']),
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
                // まとめの時間（予約枠時間一覧の 鼻下+顎 など。部位の番号と分）
                $combos = [];
                foreach (array_slice(array_values((array) ($g['combos'] ?? [])), 0, 20) as $cb) {
                    $ci = array_values(array_unique(array_map('intval', array_filter((array) ($cb['parts'] ?? []), 'is_numeric'))));
                    $cm = (int) ($cb['minutes'] ?? 0);
                    if (count($ci) >= 2 && max($ci) < count($parts) && min($ci) >= 0 && $cm >= 5 && $cm <= self::MAX_ITEM_MINUTES && $cm % 5 === 0) {
                        $combos[] = ['parts' => $ci, 'minutes' => $cm];
                    }
                }
                if ($parts !== []) {
                    $groups[] = ['name' => $gname !== '' ? $gname : '部位', 'parts' => $parts] + ($combos !== [] ? ['combos' => $combos] : []);
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
            // 部位ごとの時間で、1つだけ選ぶもの（ほくろの個数など）と、その問いの見出し（空なら「部位」）
            $row['pickOne'] = $groups !== [] && !empty($it['pickOne']);
            $row['pickLabel'] = $groups !== [] ? mb_substr(js_trim(normalize_width((string) ($it['pickLabel'] ?? ''))), 0, 10) : '';
            // 麻酔つきの注入（本数とは一緒に使わない。範囲〈全顔・部分など〉で施術の時間を分けるときは部位の区分を使う）
            $flow = !empty($it['flow']) && $cpm === 0;
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
            if ($on && $flow && ($it['repeatLaneIds'] ?? []) !== [] && (($row['creamMinutes'] === 0 && $groups === []) || $anes === [] || $row['creamMenuId'] === '' || $row['neoboMenuId'] === '')) {
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
            // モニターのときネオボ撮影の枠を取るか（顔のメニュー）。針脱毛の料金の概算を出すか（本数で決まるメニューだけ）
            $row['neobo'] = self::face([...$it, 'id' => $id]);
            $row['needle'] = $cpm > 0 && !empty($it['needle']);
            // 麻酔クリームの有無を聞くか（レーザー脱毛。院長 11/20）
            $row['creamAsk'] = !empty($it['creamAsk']);
            // 初診は医師の診察だけ（部位・本数によらず初診の時間。黒ずみトーニング。院長 11/21）
            $row['firstFixed'] = !empty($it['firstFixed']);
            // 初診の施術に足す土台の時間（説明とは別。黒ずみトーニング：照射は1部位10分＝土台5分＋部位5分）
            $fb = (int) ($it['firstBase'] ?? 0);
            if ($fb < 0 || $fb > self::MAX_ITEM_MINUTES || $fb % 5 !== 0) {
                throw new StoreError('invalid', "「{$name}」の初診の施術に足す時間は0〜" . self::MAX_ITEM_MINUTES . '分（5分刻み）で入れてください');
            }
            $row['firstBase'] = $fb;
            $out[] = $row;
        }
        return $out;
    }

    public const STAFF_FREE_LANES = ClinicRules::STAFF_FREE_LANES;

    /**
     * レーンの埋まっている時間。メイン以外（1番・3番など）は、その日の Todaysメモに出勤スタッフの名前が入っていなければ
     * 一日中埋まっている扱いにして、日曜の予約を入れない（院長 11/27）
     */
    private static function laneBusy(string $date, string $lane): array
    {
        $busy = Store::busyMinutes($date, $lane);
        if (ClinicRules::needsStaff($lane) && !self::staffed($date, $lane)) {
            $busy[] = [0, 24 * 60];
        }
        return $busy;
    }

    /** その日のそのレーンの Todaysメモに何か書いてあるか（出勤スタッフの名前） */
    public static function staffed(string $date, string $lane): bool
    {
        $notes = (array) Store::getDayNotes($date)['notes'];
        return trim((string) ($notes[$lane] ?? '')) !== '';
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
            // Web で受け付けていないメニュー（シミ取りなど）も、院内で入れた予約は同じ機器を使うので含める（院長 11/27：ピコは1台）
            if (($it['machine'] ?? '') === $machine) {
                // 初診で機器を使うのは、部位・本数で時間が決まるもの（脱毛など：説明に続けて照射）だけ。ほかの初診は医師の診察
                if (!self::isFlow($it) && self::variable($it) && empty($it['firstFixed'])) {
                    $ids[] = $it['firstMenuId'];
                }
                $ids[] = $it['repeatMenuId'];
            }
        }
        // 予約メニューの名前からも（シミ → ピコ、ほくろ・炭酸ガス → 炭酸ガス、レーザー脱毛など → ジェントルマックスプロ。ClinicRules::MACHINES）
        foreach (Db::i()->all('menu') as $m) {
            if (empty($m['deleted']) && ClinicRules::usesMachine((string) ($m['name'] ?? ''), $machine)) {
                $ids[] = (string) $m['id'];
            }
        }
        return array_values(array_unique(array_filter($ids, fn($x) => $x !== '')));
    }

    /**
     * 機器が使われている時間。ピコは2番ベッド（メイン）に置いてあるので、メインで炭酸ガスをしている時間も使えない。
     * 炭酸ガスの側（メインで入れてよいか）は co2Fits で見る
     */
    private static function machineBusyOf(string $date, string $machine, array $s): array
    {
        if ($machine === '') {
            return [];
        }
        $busy = Store::busyMinutesForMenus($date, self::machineMenus($machine, $s));
        if ($machine === self::PICO) {
            $busy = [...$busy, ...Store::busyMinutesForMenus($date, self::machineMenus(self::CO2, $s), self::BED2_LANE)];
        }
        return $busy;
    }

    /**
     * 炭酸ガスを $lane で $a〜$b に入れてよいか。メイン（2番ベッド）はピコを使っていない時だけ。
     * ピコを使っている時は3番へ動かす：3番が空いていて、医師（メイン）も空いている時だけ（医師の枠を足す）
     * 戻り値：入れられない → null、入れられる → 足す枠（[] か メインの医師の枠1つ）
     */
    private static function co2Fits(string $lane, int $a, int $b, array $picoBusy, array $mainBusy, array $it): ?array
    {
        $pico = self::overlaps($picoBusy, $a, $b);
        if ($lane === self::BED2_LANE) {
            return $pico ? null : [];
        }
        if ($lane === self::CO2_MOVE_LANE) {
            if (!$pico || self::overlaps($mainBusy, $a, $b)) {
                return null;
            }
            // 医師の枠のメニュー：その施術の医師の診察メニュー、なければ炭酸ガスフラクショナルの医師の診察メニュー
            $menu = (string) ($it['doctorMenuId'] ?? '');
            if ($menu === '') {
                foreach (self::settings()['items'] as $x) {
                    if (($x['machine'] ?? '') === self::CO2 && ($x['doctorMenuId'] ?? '') !== '') {
                        $menu = (string) $x['doctorMenuId'];
                        break;
                    }
                }
            }
            return [[self::BED2_LANE, $menu, $a, $b, '医師（2番ベッドでピコを使うため3番で炭酸ガス）']];
        }
        return [];
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
    /**
     * 予約申請フォーム（普段の LINE の予約申請）の希望日時に出す、日曜の予約ページへの案内のアドレス。
     * 設定の「予約申請フォームに案内を出す」がオンで、日曜の Web 予約もオンのときだけ（空なら出さない）
     */
    public static function intakeLink(): string
    {
        $c = Store::clinic();
        if (empty($c['sundayIntakeLink']) || !self::settings()['enabled']) {
            return '';
        }
        return self::liffUrl() !== '' ? self::liffUrl() : self::pageUrl();
    }

    public static function liffUrl(): string
    {
        $id = self::settings()['liffId'];
        return $id !== '' ? 'https://liff.line.me/' . $id : '';
    }

    /**
     * 設定画面のプレビュー（院長 11/19）：患者の画面を、受け付けがオフでも開いて見られる期限つきの印（2時間）。
     * 予約ページとは別のサイトなのでログインの Cookie は届かない。印は session_secret で署名し、設定を読めるスタッフにだけ渡す
     */
    public static function previewToken(?int $now = null): string
    {
        $exp = ($now ?? time()) + 7200;
        return $exp . '.' . b64url(hash_hmac('sha256', "tattoo-preview|{$exp}", self::previewSecret(), true));
    }

    public static function previewValid(string $token, ?int $now = null): bool
    {
        if (!preg_match('/^(\d{10})\.([A-Za-z0-9_-]{20,64})$/', $token, $m) || (int) $m[1] < ($now ?? time())) {
            return false;
        }
        return hash_equals(b64url(hash_hmac('sha256', "tattoo-preview|{$m[1]}", self::previewSecret(), true)), $m[2]);
    }

    private static function previewSecret(): string
    {
        $s = (string) (config()['session_secret'] ?? '');
        if (strlen($s) < 32) {
            throw new RuntimeException('session_secret がありません');
        }
        return $s;
    }

    /** プレビューで見る設定：受け付けをオンにしたことにする。$all ならオフのメニューも出す */
    public static function previewSettings(bool $all): array
    {
        $s = self::settings();
        $s['enabled'] = true;
        if ($all) {
            $s['tattooOn'] = $s['artmakeOn'] = true;
            $s['items'] = array_map(fn($it) => ['enabled' => true] + $it, array_map(fn($it) => array_diff_key($it, ['enabled' => 1]), $s['items']));
        }
        return $s;
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

    /** 4番の仕事（ネオボ撮影・麻酔クリーム）をするレーン。$prefer（メニューの設定）→ 4番 → 1番・3番の順で、今あるもの */
    private static function fourLanes(array $prefer = []): array
    {
        [$lanes] = Store::laneAndMenuIds();
        return array_values(array_intersect(array_unique([...$prefer, ...self::FOUR_LANES]), $lanes));
    }

    /** [$a, $b) が受付時間帯のどれかに収まり、$lanes のどれかが空いていれば、そのレーン。なければ null */
    private static function freeLane(string $date, array $windows, array $lanes, int $a, int $b): ?string
    {
        $in = false;
        foreach ($windows as [$ws, $we]) {
            $in = $in || ($a >= $ws && $b <= $we);
        }
        if (!$in) {
            return null;
        }
        foreach ($lanes as $l) {
            if (!self::overlaps(self::laneBusy($date, $l), $a, $b)) {
                return $l;
            }
        }
        return null;
    }

    /** モニターのネオボ撮影（＋麻酔クリーム）に付けるメニュー */
    private static function neoboMenu(): string
    {
        [, $menus] = Store::laneAndMenuIds();
        return in_array(self::NEOBO_MENU, $menus, true) ? self::NEOBO_MENU : self::MEMO;
    }

    /** モニタープログラム中の再診か（どのメニューも、まず4番でネオボ撮影＋麻酔クリーム15分。院長 11/20） */
    private static function isMonitor(bool $first, array $pick): bool
    {
        return !$first && ($pick['status'] ?? '') === 'monitor';
    }

    /** モニターのときネオボ撮影の枠を取るメニューか（顔のメニュー。保存前の一覧は見本の分け方） */
    public static function face(array $it): bool
    {
        return array_key_exists('neobo', $it) ? $it['neobo'] !== false : !in_array($it['id'] ?? '', self::NOT_FACE, true);
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

    /** これより短い空きは何も入れられない半端な隙間（院長 11/20：10分あればシミ20分の後でも色素10分が入る） */
    private const MIN_GAP = 10;

    /**
     * 選べる時刻の候補から、20分以上の空きを虫食いにして前後に10分未満の半端な隙間を作る時刻を除く（時刻順）。20分未満の空きは自由に埋めてよい。
     * 同じ来院の時刻に候補が複数（レーン違い）あれば、隙間の少ないほう。1つも残らない日は、半端な隙間がいちばん小さい時刻を1つだけ（院長 11/20）。
     * $segsOf：候補 → その予約で埋まる [レーン, 開始分, 終了分] の一覧
     * @param list<array> $cands
     */
    private static function tidy(string $date, array $windows, array $cands, callable $segsOf, array $forced = []): array
    {
        // 機器が空いたすぐ後の時刻（$forced：来院の分）は、隙間が残っても出す（院長 11/28：トーニングが終わる11時からタトゥーを取れるように）
        $keep = [];
        // ほかの予約があって医師が院内にいる時間（最初の予約〜最後の予約）の中に収まる時刻も、隙間が残っても出す。
        // どのみち医師がいる時間なので、空けておくより受けたほうが機会損失がない（院長 11/28：時間効率と機会損失の両方で見る）
        $span = Store::presenceSpan($date);
        $busy = [];
        $best = [];
        foreach ($cands as $c) {
            // レーンごとに、続けて取る枠をまとめてから、その前後に残る空きを測る
            $byLane = [];
            foreach ($segsOf($c) as [$l, $a, $b]) {
                $byLane[$l][] = [$a, $b];
            }
            $waste = 0;
            foreach ($byLane as $l => $iv) {
                usort($iv, fn($x, $y) => $x[0] <=> $y[0]);
                $blocks = [];
                foreach ($iv as [$a, $b]) {
                    if ($blocks && $a <= $blocks[count($blocks) - 1][1]) {
                        $blocks[count($blocks) - 1][1] = max($blocks[count($blocks) - 1][1], $b);
                    } else {
                        $blocks[] = [$a, $b];
                    }
                }
                $busy[$l] ??= self::laneBusy($date, $l);
                $gaps = self::gaps($windows, $busy[$l]);
                foreach ($blocks as [$a, $b]) {
                    foreach ($gaps as [$gs, $ge]) {
                        // 20分未満の空き（もともと1つしか入らない）は自由に埋めてよい。虫食いにしないのは2つ以上入る空きだけ（院長 11/20）
                        if ($a >= $gs && $b <= $ge && $ge - $gs >= 2 * self::MIN_GAP) {
                            foreach ([$a - $gs, $ge - $b] as $left) {
                                if ($left > 0 && $left < self::MIN_GAP) {
                                    $waste += $left;
                                }
                            }
                        }
                    }
                }
            }
            $arrive = (int) (substr($c[0], 0, 2)) * 60 + (int) substr($c[0], 3, 2);
            $inside = $span !== null;
            foreach ($segsOf($c) as [, $a, $b]) {
                $inside = $inside && $a >= $span[0] && $b <= $span[1];
            }
            if (in_array($arrive, $forced, true) || $inside) {
                $keep[$arrive] ??= $c;
                continue;
            }
            if (!isset($best[$arrive]) || $waste < $best[$arrive][0]) {
                $best[$arrive] = [$waste, $c];
            }
        }
        ksort($best);
        $clean = array_values(array_map(fn($x) => $x[1], array_filter($best, fn($x) => $x[0] === 0)));
        if ($clean === [] && $best !== []) {
            $min = min(array_column($best, 0));
            foreach ($best as $x) {
                if ($x[0] === $min) {
                    $clean = [$x[1]];
                    break;
                }
            }
        }
        // 機器が空いたすぐ後の時刻を足して、時刻順に
        $all = [...$clean, ...array_values(array_filter($keep, fn($c) => !in_array($c[0], array_column($clean, 0), true)))];
        usort($all, fn($x, $y) => strcmp($x[0], $y[0]));
        return $all;
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
     * 前後に半端な隙間を作る時刻は除く（tidy）。ネオボは顔だけなので、モニターの方でも撮影の枠は取らない（院長 11/20）。
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
            $busy = self::laneBusy($date, $s['laneId']);
            $nurseBusy = $s['explainLaneId'] !== '' ? self::laneBusy($date, $s['explainLaneId']) : null;
            $machineBusy = self::machineBusyOf($date, $s['machine'], $s);
            $found = [];
            $forced = [];
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
                    $found[] = [self::hm($arrive), $c[1], $c[2]];
                }
                // 機器（ピコ）が空いたすぐ後から照射。初診の説明はレーザーを使わないので、機器を使っている時間に重ねてよい（院長 11/28）
                foreach ($machineBusy as [, $be]) {
                    $c = self::fitAt($be, $gs, $ge, $ws, $treat, $firstVisit, $nurseBusy);
                    if ($c === null || self::overlaps($machineBusy, $c[1], $c[1] + $treat) || ($date === $now['date'] && $c[0] <= $now['minutes'])) {
                        continue;
                    }
                    $found[] = [self::hm($c[0]), $c[1], $c[2]];
                    $forced[] = $c[0];
                }
            }
            $found = self::tidy($date, $windows, $found, fn($c) => array_filter([[$s['laneId'], $c[2] ? $c[1] : $c[1] - ($firstVisit ? self::EXPLAIN_MINUTES : 0), $c[1] + $treat], $c[2] ? [$s['explainLaneId'], $c[1] - self::EXPLAIN_MINUTES, $c[1]] : null]), $forced);
            if ($found) {
                $out[$date] = $found;
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

    /**
     * 照射を $start（機器が空いた時刻）から始める場合の [来院の分, 照射の開始分, 説明のレーンを使うか]。空き [gs, ge) に入らなければ null。
     * 初診の説明は、直前の10分を説明のレーンで、だめなら照射のレーンで（空きの中なら機器を使っている時間でもよい）、だめなら説明のレーンで照射の前に
     */
    private static function fitAt(int $start, int $gs, int $ge, int $ws, int $treat, bool $first, ?array $nurseBusy): ?array
    {
        $x = self::EXPLAIN_MINUTES;
        if ($start < $gs || $start + $treat > $ge) {
            return null;
        }
        if (!$first) {
            return [$start, $start, false];
        }
        if ($nurseBusy !== null && $start - $x >= $ws && !self::overlaps($nurseBusy, $start - $x, $start)) {
            return [$start - $x, $start, true];
        }
        if ($start - $x >= $gs) {
            return [$start - $x, $start, false];
        }
        if ($nurseBusy !== null && $start + $x + $treat <= $ge && !self::overlaps($nurseBusy, $start, $start + $x)) {
            return [$start, $start + $x, true];
        }
        return null;
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
        // モニターの方は、施術の直前に4番（だめなら1番・3番）でネオボ撮影（＋麻酔クリーム）15分（日曜メニュー。タトゥー・アートメイクは顔でないので取らない）
        $monitor = self::isMonitor($first, $pick) && self::face($it);
        $four = $monitor ? self::fourLanes() : [];
        $neobo = $monitor ? self::neoboMenu() : '';
        $out = [];
        $co2 = ($it['machine'] ?? '') === self::CO2;
        foreach ($byDate as $date => $windows) {
            $machineBusy = self::machineBusyOf($date, (string) ($it['machine'] ?? ''), $s);
            $picoBusy = $co2 ? self::machineBusyOf($date, self::PICO, $s) : [];
            $found = [];
            $forced = [];
            $freeAt = array_column($machineBusy, 1);
            foreach (ClinicRules::lanes($it[$k . 'LaneIds'], (string) ($it['machine'] ?? '')) as $lane) {
                foreach (self::gaps($windows, self::laneBusy($date, $lane)) as [$gs, $ge, $ws, $we]) {
                    if ($ge - $gs < $len) {
                        continue;
                    }
                    $starts = $ge < $we ? [$gs, $ge - $len] : [$gs];
                    if ($monitor) {
                        $starts[] = max($gs, $ws + self::NEOBO_SLOT);
                    }
                    // 同じ機器をほかのレーンで使っている間は入れないので、その機器が空いたすぐ後も候補に（院長 11/21：ピコはタトゥー・シミ取り・トーニングで共用）
                    foreach ($machineBusy as [, $be]) {
                        if ($be > $gs && $be + $len <= $ge) {
                            $starts[] = $be;
                        }
                    }
                    foreach (array_unique($starts) as $start) {
                        if ($start + $len > $ge || self::overlaps($machineBusy, $start, $start + $len)) {
                            continue;
                        }
                        // 炭酸ガス（ほくろ）：2番ベッドでピコを使っている時は3番へ（医師の枠をメインに）
                        $extra = $co2 ? self::co2Fits($lane, $start, $start + $len, $picoBusy, self::laneBusy($date, self::BED2_LANE), $it) : [];
                        if ($extra === null) {
                            continue;
                        }
                        $arrive = $start;
                        $segs = $extra !== [] ? [[$lane, $it[$k . 'MenuId'], $start, $start + $len, '施術'], ...$extra] : null;
                        if ($monitor) {
                            $arrive = $start - self::NEOBO_SLOT;
                            $nl = self::freeLane($date, $windows, $four, $arrive, $start);
                            if ($nl === null) {
                                continue;
                            }
                            $segs = [[$nl, $neobo, $arrive, $start, 'ネオボ撮影（＋麻酔クリーム）'], [$lane, $it[$k . 'MenuId'], $start, $start + $len, '施術'], ...$extra];
                        }
                        if ($date === $now['date'] && $arrive <= $now['minutes']) {
                            continue;
                        }
                        $found[] = $segs === null ? [self::hm($arrive), $start, $lane] : [self::hm($arrive), $start, $lane, $segs];
                        // 機器が空いたすぐ後の時刻は、隙間が残っても出す（院長 11/28）
                        if (in_array($start, $freeAt, true)) {
                            $forced[] = $arrive;
                        }
                    }
                }
            }
            $found = self::tidy($date, $windows, $found, fn($c) => isset($c[3]) ? array_map(fn($g) => [$g[0], $g[2], $g[3]], $c[3]) : [[$c[2], $c[1], $c[1] + $len]], $forced);
            if ($found) {
                $out[$date] = $found;
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
        $monitor = $status === 'monitor' && self::face($it);
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
        $four = self::fourLanes($it['anesLaneIds'] ?? []);
        $out = [];
        foreach ($byDate as $date => $windows) {
            $busy = fn(string $lane) => self::laneBusy($date, $lane);
            $machineBusy = self::machineBusyOf($date, (string) ($it['machine'] ?? ''), $s);
            $doctorBusy = $doctor ? $busy($doctorLane) : [];
            $co2 = ($it['machine'] ?? '') === self::CO2;
            $picoBusy = $co2 ? self::machineBusyOf($date, self::PICO, $s) : [];
            $found = [];
            foreach (ClinicRules::lanes($it['repeatLaneIds'], (string) ($it['machine'] ?? '')) as $lane) {
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
                        if (self::overlaps($machineBusy, $start, $end)) {
                            continue;
                        }
                        // 炭酸ガス：2番ベッドでピコを使っている時は3番へ（医師の枠をメインに足す。診察もその中）
                        $extra = $co2 ? self::co2Fits($lane, $start, $end, $picoBusy, $busy(self::BED2_LANE), $it) : [];
                        if ($extra === null) {
                            continue;
                        }
                        $moved = $extra !== [];
                        if ($doctor && !$moved && self::overlaps($doctorBusy, $start, $start + self::DOCTOR_SLOT)) {
                            continue;
                        }
                        $segs = [[$lane, $it['repeatMenuId'], $start, $end, '施術'], ...$extra];
                        if ($doctor && !$moved) {
                            $segs[] = [$doctorLane, $it['doctorMenuId'], $start, $start + self::DOCTOR_SLOT, '医師の診察（施術の最初に重ねる）'];
                        }
                        $arrive = $start;
                        if ($pre !== null) {
                            $ok = false;
                            foreach ($waits as $wait) {
                                $a0 = $start - $wait - $pre[0];
                                $al = self::freeLane($date, $windows, $four, $a0, $a0 + $pre[0]);
                                if ($al !== null) {
                                    $segs[] = [$al, $pre[1], $a0, $a0 + $pre[0], $pre[2]];
                                    $arrive = $a0;
                                    $ok = true;
                                    break;
                                }
                            }
                            if (!$ok) {
                                continue;
                            }
                        }
                        if ($date === $now['date'] && $arrive <= $now['minutes']) {
                            continue;
                        }
                        $found[] = [self::hm($arrive), $arrive, $lane, $segs];
                    }
                }
            }
            $found = self::tidy($date, $windows, $found, fn($c) => array_map(fn($g) => [$g[0], $g[2], $g[3]], $c[3]));
            if ($found) {
                $out[$date] = $found;
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
            if ($status === 'monitor' && self::face($it)) {
                return $anes === 'cream' ? "撮影・麻酔のあと約45分お待ちいただき施術（施術は約{$m}分）" : '約' . ($m + self::NEOBO_SLOT) . '分（ネオボ撮影' . self::NEOBO_SLOT . "分・施術{$m}分）";
            }
            return $anes === 'cream' ? "麻酔クリームのあと約45分お待ちいただき施術（施術は約{$m}分）" : "約{$m}分";
        }
        if ($m !== null && self::isMonitor($first, $pick) && self::face($it)) {
            return '約' . ($m + self::NEOBO_SLOT) . '分（ネオボ撮影' . self::NEOBO_SLOT . "分・施術{$m}分）";
        }
        return $m === null ? '' : "約{$m}分";
    }

    /** 本人の LINE（ID トークン）が公式アカウントを友だち追加しているか。true／false、確かめられなければ null */
    public static function friendOf(string $idToken): ?bool
    {
        $s = self::settings();
        if ($idToken === '' || $s['liffId'] === '') {
            return null;
        }
        try {
            $uid = LineLink::verifyIdToken($idToken, explode('-', $s['liffId'], 2)[0]);
        } catch (StoreError) {
            return null;
        }
        return Reminder::isFriend($uid);
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
        // 希望施術が複数・当日施術なし（相談のみ）があるときは、施術ごとの一覧（entries）で送ってくる（院長 11/20）
        $multi = is_array($in['entries'] ?? null) && array_is_list($in['entries']);
        if ($item === null && !$multi && !self::ready($s)) {
            return ['ok' => false, 'error' => 'closed'];
        }
        $kind = $multi ? 'multi' : ($item !== null ? 'menu' : (in_array($in['kind'] ?? '', ['tattoo', 'artmake'], true) ? $in['kind'] : ''));
        if (in_array($kind, ['tattoo', 'artmake'], true) && !self::kindOn($kind, $s)) {
            return ['ok' => false, 'error' => 'closed'];
        }
        $visit = in_array($in['visit'] ?? '', ['first', 'repeat'], true) ? $in['visit'] : '';
        // 当院の美容皮膚科の初診・再診（水曜・祝日の LINE 予約申請フォームと同じ問い。院長 11/19）。予約ページはこれを送る。
        // 初診 → 初めての時間。再診は今回の治療内容で：この治療は初めて → 初めての時間、継続・モニター → 再診の時間。
        // 麻酔つきの注入は、再診なら再診（今回の治療内容は麻酔・診察の枠の決め方に使う）
        $clinicLines = [];
        $badClinic = [];
        if (array_key_exists('clinicVisit', $in)) {
            $cv = in_array($in['clinicVisit'], ['initial', 'returning'], true) ? $in['clinicVisit'] : '';
            $st = array_key_exists((string) ($in['status'] ?? ''), self::STATUSES) ? (string) $in['status'] : '';
            $yn = fn(string $k) => in_array($in[$k] ?? '', ['有', '無'], true) ? (string) $in[$k] : '';
            if ($cv === '') {
                $badClinic[] = 'clinicVisit';
                $visit = '';
            } elseif ($cv === 'initial') {
                $visit = 'first';
                if ($yn('insuranceHistory') === '' || $yn('sameDayTreatment') === '') {
                    $badClinic[] = 'initialInfo';
                }
                $ref = mb_substr(js_trim(normalize_width((string) ($in['referrer'] ?? ''))), 0, 60);
                $clinicLines = ['当院の美容皮膚科：初診（保険通院歴：' . $yn('insuranceHistory') . '、当日施術の希望：' . $yn('sameDayTreatment') . '）', $ref !== '' ? '紹介者：' . $ref : null];
            } elseif ($multi) {
                // 希望施術が複数：今回の治療内容は施術ごと（entriesOf で確かめ、予約メモは施術ごと）
                $clinicLines = ['当院の美容皮膚科：再診'];
            } else {
                if ($st === '') {
                    $badClinic[] = 'status';
                }
                $visit = ($item !== null && self::isFlow($item)) || $st !== 'new' ? 'repeat' : 'first';
                $clinicLines = ['当院の美容皮膚科：再診（今回の治療内容：' . (self::STATUSES[$st] ?? '') . '）'];
            }
        }
        if ($item !== null && $visit !== '' && !self::accepts($item, $visit === 'first')) {
            $visit = '';
        }
        $f['clinicLines'] = array_values(array_filter($clinicLines));
        // 当院の美容皮膚科が初診の方には、確定の連絡と予約後の画面で問診票の記入をお願いする（院長 11/19）
        $f['clinicInitial'] = ($in['clinicVisit'] ?? '') === 'initial';
        $f['clinicReturning'] = ($in['clinicVisit'] ?? '') === 'returning';
        $color = in_array($in['color'] ?? '', ['black', 'color'], true) ? $in['color'] : '';
        $anesthesia = $item === null && ($in['anesthesia'] ?? '') === 'yes';
        $area = $item === null ? self::areaOf($in['rects'] ?? null) : null;
        $bad = [];
        if ($kind === '') $bad[] = 'kind';
        if ($visit === '' && $badClinic === [] && !$multi) $bad[] = 'visit';
        array_push($bad, ...$badClinic);
        if ($item === null && $area === null && !$multi) $bad[] = 'area';
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
        // LINE で開く設定のときは、LINE で開いて公式アカウントを友だち追加した方だけ（確定の連絡・予約の変更を LINE で行うため。院長 11/20）
        if ($s['liffId'] !== '' && $uid === null) {
            return ['ok' => false, 'error' => 'line_required'];
        }
        if ($uid !== null && Reminder::isFriend($uid) === false) {
            return ['ok' => false, 'error' => 'friend_required'];
        }
        // メールアドレスは LINE で開いたときも必須（院長 11/20。LINE が届かないときの確定の連絡）
        if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) $bad[] = 'email';
        if (!is_date_string($f['date']) || !preg_match('/^\d{2}:\d{2}$/', $f['time'])) $bad[] = 'slot';
        // ご来院前のお願い〜キャンセル・日程変更の料金規定を読んで了承した（予約ページのチェック。院長 11/20）
        if (empty($in['agree'])) $bad[] = 'agree';
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
        if ($multi) {
            try {
                $entries = self::entriesOf($in['entries'], (string) ($in['clinicVisit'] ?? ''), (string) ($in['status'] ?? ''), $s);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'invalid', 'fields' => [$e->getMessage()]];
            }
            return self::bookChain($entries, $f, $s, $uid);
        }
        if ($item !== null) {
            $pick = ['group' => $in['group'] ?? null, 'parts' => is_array($in['parts'] ?? null) ? $in['parts'] : [], 'count' => $in['count'] ?? null, 'status' => $in['status'] ?? null, 'anesthesia' => $in['anesthesiaType'] ?? null,
                'sex' => $in['sex'] ?? null, 'needleAnes' => $in['needleAnes'] ?? null, 'cream' => $in['cream'] ?? null,
                'countVio' => $in['countVio'] ?? null, 'countOther' => $in['countOther'] ?? null];
            // 針脱毛は VIO・VIO以外の本数の合計で時間を決める
            if (!empty($item['needle'])) {
                $pick['count'] = array_sum(self::needleCounts($pick));
            }
            if (self::itemMinutes($item, $visit === 'first', $pick) === null) {
                return ['ok' => false, 'error' => 'invalid', 'fields' => self::isFlow($item) ? ['flow'] : [($item['countPerMinute'] ?? 0) > 0 ? 'count' : 'parts']];
            }
            // 針脱毛は性別・部位・麻酔も（料金の概算のため）
            if (!empty($item['needle']) && (!isset(self::NEEDLE_SEX[(string) ($pick['sex'] ?? '')], self::YES_NO[(string) ($pick['needleAnes'] ?? '')]))) {
                return ['ok' => false, 'error' => 'invalid', 'fields' => ['needle']];
            }
            // レーザー脱毛は麻酔クリームの有無も
            if (!empty($item['creamAsk']) && !isset(self::YES_NO[(string) ($pick['cream'] ?? '')])) {
                return ['ok' => false, 'error' => 'invalid', 'fields' => ['cream']];
            }
            return self::bookItem($item, $visit === 'first', $f, $s, $uid, $pick);
        }
        $treat = self::treatMinutes($area);
        $first = $visit === 'first';
        $monitor = self::isMonitor($first, ['status' => $in['status'] ?? null]);
        $result = Db::i()->transaction(function () use ($f, $s, $kind, $first, $color, $anesthesia, $area, $treat, $uid, $monitor) {
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
                ($kind === 'artmake' ? 'アートメイク除去' : 'タトゥー除去') . '（Web予約・日曜）' . ($first ? '初診' : ($monitor ? 'モニター' : '再診')),
                ...$f['clinicLines'],
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
            return ['ok' => true, 'end' => self::hm($start + $treat), 'id' => $r['id'], 'patientId' => $patientId];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => $kind, 'visit' => $visit, 'area' => $area, 'anesthesia' => $anesthesia, 'end' => $result['end']];
        $f['askQuestionnaire'] = self::askQuestionnaire($f, (string) $result['patientId']);
        // 確定の連絡：LINE で開いた人は LINE へ（送れなければメールがあればメール）。それ以外はメール
        [$lined] = $uid !== null ? Reminder::pushText($uid, self::mailBody($f, 'line')) : [false];
        $sent = false;
        if (!$lined && $f['email'] !== '') {
            [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject($kind), self::mailBody($f)) : [false];
        }
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'duration' => self::durationText($treat, $first), 'lined' => (bool) $lined, 'mailed' => (bool) $sent, 'questionnaire' => $f['askQuestionnaire'] ? self::questionnaireUrl($uid !== null ? 'line' : 'mail') : ''];
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
                $pat = Store::bookingEnsurePatient(['name' => $f['name'], 'kana' => $f['kana'], 'birthDate' => $f['birthDate'], 'phone' => $f['phone'], 'email' => $f['email'], 'sex' => self::sexOfPick($it, $pick)], self::ACTOR);
            } catch (StoreError $e) {
                return ['ok' => false, 'error' => 'contact_us'];
            }
            $memo = implode("\n", array_filter([
                $it['name'] . '（Web予約・日曜）' . ($first ? '初診' : '再診') . "（{$len}分）",
                ...($f['clinicLines'] ?? []),
                $what !== '' ? (($it['countPerMinute'] ?? 0) > 0 ? '本数：' : self::pickLabel($it) . '：') . $what : null,
                ...self::needleLines($it, $pick),
                ...self::creamLines($it, $pick),
                $first && self::variable($it) && empty($it['firstFixed']) && (int) $it['firstMinutes'] > 0 ? "初診の説明：{$it['firstMinutes']}分（この予約の最初）" : null,
                $f['part'] !== '' ? '部位（患者の記入）：' . $f['part'] : null,
                $f['email'] !== '' ? 'メール：' . $f['email'] : null,
                $uid !== null ? '確定の連絡：LINE（予約ページを LINE で開いて予約）' : null,
                $f['lineName'] !== '' ? 'LINEの表示名：' . $f['lineName'] : null,
                $f['notes'] !== '' ? 'ご相談：' . $f['notes'] : null,
            ]));
            $patientId = $pat['patient']['id'];
            // 麻酔つきの注入：麻酔・撮影・医師の診察・施術の枠をそれぞれ予約に（予約申請と同じく、モニターは必ず「モニター」と書く）
            if ($segs !== null) {
                $head = $it['name'] . '（Web予約・日曜）' . (($pick['status'] ?? '') === 'monitor' ? 'モニター' : '再診') . "\n" . $what;
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
                            ...($f['clinicLines'] ?? []),
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
                return ['ok' => true, 'end' => self::hm($treatEnd), 'id' => $r['id'], 'patientId' => $patientId];
            }
            $r = Store::bookingCreate([
                'patientId' => $patientId,
                'laneId' => $lane,
                // 時間が変わるメニューの初診は、説明と施術を続けて取るので、再診（施術）のメニューも付ける（機器の重なりを見分けるため）
                'menuIds' => array_values(array_unique(array_filter([$it[$k . 'MenuId'], $first && self::variable($it) && empty($it['firstFixed']) ? $it['repeatMenuId'] : '']))),
                'startAt' => to_iso($f['date'], $start),
                'endAt' => to_iso($f['date'], $start + $len),
                'memo' => $memo,
                'lineUserId' => $uid,
            ], self::ACTOR);
            if ($uid !== null) {
                Store::bookingLinkLine($patientId, $uid, 'LINE紐付け（日曜の予約を LINE で）', self::ACTOR);
            }
            return ['ok' => true, 'end' => self::hm($start + $len), 'id' => $r['id'], 'patientId' => $patientId];
        });
        if (!$result['ok']) {
            return $result;
        }
        $f += ['kind' => 'menu', 'item' => $it, 'visit' => $first ? 'first' : 'repeat', 'end' => $result['end'], 'pick' => $pick];
        $f['askQuestionnaire'] = self::askQuestionnaire($f, (string) $result['patientId']);
        [$lined] = $uid !== null ? Reminder::pushText($uid, self::mailBody($f, 'line')) : [false];
        $sent = false;
        if (!$lined && $f['email'] !== '') {
            [$sent] = Reminder::mailReady() ? Reminder::sendText($f['email'], self::mailSubject('menu', $it['name']), self::mailBody($f)) : [false];
        }
        return ['ok' => true, 'date' => $f['date'], 'time' => $f['time'], 'end' => $result['end'], 'duration' => self::itemDurationText($it, $first, $pick), 'lined' => (bool) $lined, 'mailed' => (bool) $sent, 'questionnaire' => $f['askQuestionnaire'] ? self::questionnaireUrl($uid !== null ? 'line' : 'mail') : ''];
    }

    // ---- 複数の施術・当日施術なし（相談のみ）：続けて取る（院長 11/20） ----

    /** 施術と施術の間に置いてよい待ち（分。混んでいて続けて取れないとき。20分まで：院長 11/20） */
    private const CHAIN_WAITS = [0, 5, 10, 15, 20];
    /** 当日施術なし（相談のみ）の枠（分）。相談がいくつあっても1つ */
    public const CONSULT_MINUTES = 15;
    public const CONSULT_NOTICE = '当日施術希望がなく診察のみの方はカウンセリング料がかかります。また混雑状況により最大15分の枠となりますのでご了承ください。';

    /** 脱毛のメニューか（相談は看護師レーン） */
    private static function isHair(array $it): bool
    {
        return in_array($it['id'] ?? '', ['laserhair', 'needlehair'], true) || ($it['category'] ?? '') === '脱毛';
    }

    /** レーザーのメニューか（同じ日のピーリングはレーザーの後） */
    private static function isLaser(?array $it, string $kind): bool
    {
        if ($it === null) {
            return in_array($kind, ['tattoo', 'artmake'], true);
        }
        return in_array($it['category'] ?? '', ['除去・美白・レーザー', '除去・レーザー'], true) || in_array($it['id'] ?? '', ['laserhair', 'tightening', 'darktoning'], true);
    }

    /**
     * 予約ページの「希望施術」の一覧をそろえる。各行：kind（"m:<id>"・tattoo・artmake）、sameDay（有・無）、選んだ内容。
     * 初診・再診（clinicVisit）と今回の治療内容（status）から、施術ごとに初診の時間か再診の時間かを決める。
     * 誤りは StoreError（invalid、項目名つき）
     * @return list<array{kind:string,item:?array,first:bool,sameDay:bool,pick:array,area:?float,label:string}>
     */
    public static function entriesOf(array $raw, string $clinicVisit, string $status, array $s): array
    {
        if ($raw === [] || count($raw) > 6) {
            throw new StoreError('invalid', 'entries');
        }
        $out = [];
        foreach (array_values($raw) as $e) {
            if (!is_array($e)) {
                throw new StoreError('invalid', 'entries');
            }
            $kind = (string) ($e['kind'] ?? '');
            $item = str_starts_with($kind, 'm:') ? self::item(substr($kind, 2), $s) : null;
            if ($item === null && !in_array($kind, ['tattoo', 'artmake'], true)) {
                throw new StoreError('invalid', 'kind');
            }
            if ($item === null && !self::kindOn($kind, $s)) {
                throw new StoreError('invalid', 'kind');
            }
            $sameDay = (string) ($e['sameDay'] ?? '');
            if (!in_array($sameDay, ['有', '無'], true)) {
                throw new StoreError('invalid', 'sameDay');
            }
            // 今回の治療内容は施術ごと（院長 11/20）。再診で当日施術ありなら必須
            $st = (string) ($e['status'] ?? $status);
            if ($clinicVisit === 'returning' && $sameDay === '有' && !isset(self::STATUSES[$st])) {
                throw new StoreError('invalid', 'status');
            }
            if (!in_array($clinicVisit, ['initial', 'returning'], true)) {
                throw new StoreError('invalid', 'clinicVisit');
            }
            $first = $clinicVisit === 'initial' || ($clinicVisit === 'returning' && !($item !== null && self::isFlow($item)) && $st === 'new');
            $pick = [
                'group' => $e['group'] ?? null, 'parts' => is_array($e['parts'] ?? null) ? $e['parts'] : [], 'count' => $e['count'] ?? null,
                'status' => $clinicVisit === 'returning' ? $st : '', 'anesthesia' => $e['anesthesiaType'] ?? null, 'sex' => $e['sex'] ?? null, 'needleAnes' => $e['needleAnes'] ?? null,
                'cream' => $e['cream'] ?? null, 'countVio' => $e['countVio'] ?? null, 'countOther' => $e['countOther'] ?? null,
            ];
            $area = null;
            $label = $item['name'] ?? ($kind === 'artmake' ? 'アートメイク除去' : 'タトゥー除去');
            if ($sameDay === '有') {
                if ($item !== null) {
                    if (!self::accepts($item, $first)) {
                        throw new StoreError('invalid', 'visit');
                    }
                    if (!empty($item['needle'])) {
                        $pick['count'] = array_sum(self::needleCounts($pick));
                    }
                    if (self::itemMinutes($item, $first, $pick) === null) {
                        throw new StoreError('invalid', self::isFlow($item) ? 'flow' : (($item['countPerMinute'] ?? 0) > 0 ? 'count' : 'parts'));
                    }
                    if (!empty($item['needle']) && !isset(self::NEEDLE_SEX[(string) ($pick['sex'] ?? '')], self::YES_NO[(string) ($pick['needleAnes'] ?? '')])) {
                        throw new StoreError('invalid', 'needle');
                    }
                    if (!empty($item['creamAsk']) && !isset(self::YES_NO[(string) ($pick['cream'] ?? '')])) {
                        throw new StoreError('invalid', 'cream');
                    }
                } else {
                    $area = self::areaOf($e['rects'] ?? null);
                    if ($area === null) {
                        throw new StoreError('invalid', 'area');
                    }
                    $pick['anesthesia'] = ($e['anesthesia'] ?? '') === 'yes';
                    $pick['color'] = in_array($e['color'] ?? '', ['black', 'color'], true) ? $e['color'] : '';
                }
            }
            $pick['part'] = mb_substr(js_trim(normalize_width((string) ($e['part'] ?? ''))), 0, 60);
            $out[] = ['kind' => $kind, 'item' => $item, 'first' => $first, 'sameDay' => $sameDay === '有', 'pick' => $pick, 'area' => $area, 'label' => $label];
        }
        return $out;
    }

    /**
     * 希望施術の一覧から、続けて取る仕事（job）を作る。相談のみ（当日施術なし）はまとめて15分を最初に1つ（脱毛の相談があれば看護師レーン、なければ医師レーン）。
     * 施術は選んだ順。ただし同じ日のピーリングはレーザーの後（院長 11/20）。
     * job：['label', 'entry', 'steps' => [[lanes, menuIds, len, role, machine, waits（次の段までの待ちの候補）, with（同時に重ねる [lane, menu, len, role]）], ...]]
     */
    public static function jobsOf(array $entries, array $s): array
    {
        [$lanes, $menus] = Store::laneAndMenuIds();
        $menuOk = fn(string $id) => in_array($id, $menus, true) ? $id : self::MEMO;
        $jobs = [];
        $consult = array_values(array_filter($entries, fn($e) => !$e['sameDay']));
        // 当日施術の希望が1つでもあれば、相談のみの枠は別に取らず、その施術の間に話を聞く（予約のメモにだけ書く。院長 11/20）
        $consultNote = $consult !== [] && count($consult) < count($entries) ? 'ほかにご相談（当日施術なし。施術の間に伺う）：' . implode('・', array_column($consult, 'label')) : '';
        if ($consult !== [] && $consultNote === '') {
            $hair = array_values(array_filter($consult, fn($e) => $e['item'] !== null && self::isHair($e['item'])));
            $initial = (bool) array_filter($consult, fn($e) => $e['first']);
            $doctor = self::M;
            $jobs[] = ['label' => 'ご相談のみ（当日施術なし）：' . implode('・', array_column($consult, 'label')), 'entry' => null, 'consult' => true, 'steps' => [[
                'lanes' => $hair !== [] ? array_values(array_intersect(self::N, $lanes)) : [$doctor],
                'menus' => [$hair !== [] && ($hair[0]['item']['firstMenuId'] ?? '') !== '' ? $hair[0]['item']['firstMenuId'] : $menuOk($initial ? self::CONSULT : self::MEMO)],
                'len' => self::CONSULT_MINUTES, 'role' => 'ご相談（当日施術なし）', 'machine' => '', 'waits' => [0], 'with' => null,
            ]]];
        }
        $treat = array_values(array_filter($entries, fn($e) => $e['sameDay']));
        // ピーリングはレーザーの後へ（ほかは選んだ順）
        $lastLaser = -1;
        foreach ($treat as $i => $e) {
            if (self::isLaser($e['item'], $e['kind'])) {
                $lastLaser = $i;
            }
        }
        $peel = fn($e) => $e['item'] !== null && ($e['item']['category'] ?? '') === 'ピーリング';
        $order = [];
        foreach ($treat as $i => $e) {
            if (!($peel($e) && $i < $lastLaser)) {
                $order[] = $e;
            }
            if ($i === $lastLaser) {
                foreach ($treat as $j => $p) {
                    if ($j < $lastLaser && $peel($p)) {
                        $order[] = $p;
                    }
                }
            }
        }
        $four = self::fourLanes();
        $neobo = self::neoboMenu();
        foreach ($order as $e) {
            $it = $e['item'];
            $first = $e['first'];
            $steps = [];
            if ($it === null) {
                // タトゥー・アートメイク除去：照射は照射のレーン。初診は説明10分（説明のレーン、なければ照射のレーンに続けて）
                $len = self::treatMinutes((float) $e['area']);
                $menu = [$s['menuId']];
                if ($first && $s['explainLaneId'] !== '') {
                    $steps[] = ['lanes' => [$s['explainLaneId'], $s['laneId']], 'menus' => [$s['explainMenuId'] !== '' ? $s['explainMenuId'] : $s['menuId']], 'len' => self::EXPLAIN_MINUTES, 'role' => '初診説明', 'machine' => '', 'waits' => [0], 'with' => null];
                    $steps[] = ['lanes' => [$s['laneId']], 'menus' => $menu, 'len' => $len, 'role' => '照射', 'machine' => $s['machine'], 'waits' => [0], 'with' => null];
                } else {
                    // 説明も照射のレーンで：説明はレーザーを使わないので機器は照射の間だけ（院長 11/28）
                    if ($first) {
                        $steps[] = ['lanes' => [$s['laneId']], 'menus' => $menu, 'len' => self::EXPLAIN_MINUTES, 'role' => '初診説明', 'machine' => '', 'waits' => [0], 'with' => null];
                    }
                    $steps[] = ['lanes' => [$s['laneId']], 'menus' => $menu, 'len' => $len, 'role' => '照射', 'machine' => $s['machine'], 'waits' => [0], 'with' => null];
                }
            } elseif (!$first && self::isFlow($it)) {
                // 麻酔つきの注入：麻酔・撮影 → 待ち → 施術（この治療が初めてなら施術の最初に医師の診察を重ねる）
                [$status, $anes] = self::flowPick($e['pick']) ?? ['continue', 'none'];
                $len = (int) self::itemMinutes($it, false, $e['pick']);
                $monitor = $status === 'monitor' && self::face($it);
                $cream = $anes === 'cream';
                if ($monitor || $cream) {
                    $steps[] = ['lanes' => self::fourLanes($it['anesLaneIds'] ?? []), 'menus' => [$monitor ? $it['neoboMenuId'] : $it['creamMenuId']], 'len' => $monitor ? self::NEOBO_SLOT : self::CREAM_SLOT, 'role' => $monitor ? 'ネオボ撮影＋頬麻酔' : '麻酔クリーム', 'machine' => '', 'waits' => $cream ? self::WAITS : [0], 'with' => null];
                }
                $doctorLane = $it['doctorLaneId'] !== '' ? $it['doctorLaneId'] : ($it['firstLaneIds'][0] ?? '');
                $with = $status === 'new' && $doctorLane !== '' && ($it['doctorMenuId'] ?? '') !== '' ? [$doctorLane, $it['doctorMenuId'], self::DOCTOR_SLOT, '医師の診察（施術の最初に重ねる）'] : null;
                $steps[] = ['lanes' => $it['repeatLaneIds'], 'menus' => [$it['repeatMenuId']], 'len' => $len, 'role' => '施術', 'machine' => (string) ($it['machine'] ?? ''), 'waits' => [0], 'with' => $with];
            } else {
                $k = $first ? 'first' : 'repeat';
                $len = (int) self::itemMinutes($it, $first, $e['pick']);
                if (self::isMonitor($first, $e['pick']) && self::face($it)) {
                    $steps[] = ['lanes' => $four, 'menus' => [$neobo], 'len' => self::NEOBO_SLOT, 'role' => 'ネオボ撮影（＋麻酔クリーム）', 'machine' => '', 'waits' => [0], 'with' => null];
                }
                $uses = $first && self::variable($it) && empty($it['firstFixed']);
                $steps[] = ['lanes' => $it[$k . 'LaneIds'], 'menus' => array_values(array_unique(array_filter([$it[$k . 'MenuId'], $uses ? $it['repeatMenuId'] : '']))), 'len' => $len, 'role' => $first ? '初診' : '施術', 'machine' => !$first || $uses ? (string) ($it['machine'] ?? '') : '', 'waits' => [0], 'with' => null];
            }
            $jobs[] = ['label' => $e['label'], 'entry' => $e, 'consult' => false, 'steps' => $steps, 'note' => $jobs === [] ? $consultNote : ''];
        }
        return $jobs;
    }

    /**
     * 仕事を続けて取れる来院の時刻。日付 => [[来院の時刻, 来院の分, 終わりの分, 枠の一覧 [[lane, menuIds, 開始, 終了, role, job番号], ...]], ...]。
     * 最初の段は、そのレーンの空きの最初か最後（タトゥーと同じ）。仕事と仕事の間は 0〜15分の待ち、段と段の間は段の待ち。
     * レーン・同じ機器の重なりを避け、前後に半端な隙間を作る時刻は除く（tidy）
     */
    public static function planChain(array $jobs, bool $anyFirst, ?array $s = null): array
    {
        $s ??= self::settings();
        if ($jobs === [] || !$s['enabled']) {
            return [];
        }
        $now = now_in_clinic();
        $last = $anyFirst ? (new DateTimeImmutable($now['date']))->modify('+' . self::FIRST_VISIT_MONTHS . ' months')->format('Y-m-d') : '9999-12-31';
        $byDate = [];
        foreach ($s['slots'] as $line) {
            $w = OnlineCs::parseWindow($line);
            if ($w && $w['date'] >= $now['date'] && $w['date'] <= $last) {
                $byDate[$w['date']][] = [$w['start'], $w['end']];
            }
        }
        $out = [];
        foreach ($byDate as $date => $windows) {
            $busy = [];
            $laneBusy = function (string $l) use (&$busy, $date) {
                return $busy[$l] ??= self::laneBusy($date, $l);
            };
            $mBusy = [];
            $machineBusy = function (string $m) use (&$mBusy, $date, $s) {
                return $mBusy[$m] ??= self::machineBusyOf($date, $m, $s);
            };
            $inWindow = function (int $a, int $b) use ($windows): bool {
                foreach ($windows as [$ws, $we]) {
                    if ($a >= $ws && $b <= $we) {
                        return true;
                    }
                }
                return false;
            };
            // 置いた枠と、そのレーン・機器が空いているか
            $free = function (string $lane, string $machine, int $a, int $b, array $placed) use ($laneBusy, $machineBusy, $inWindow): bool {
                if (!$inWindow($a, $b) || self::overlaps($laneBusy($lane), $a, $b)) {
                    return false;
                }
                if ($machine !== '' && self::overlaps($machineBusy($machine), $a, $b)) {
                    return false;
                }
                foreach ($placed as $g) {
                    if ($g[2] < $b && $a < $g[3] && ($g[0] === $lane || ($machine !== '' && $g[6] === $machine))) {
                        return false;
                    }
                    // ピコと、メイン（2番ベッド）での炭酸ガスは同じ時刻に入れない
                    if ($g[2] < $b && $a < $g[3] && $machine === self::PICO && $g[6] === self::CO2 && $g[0] === self::BED2_LANE) {
                        return false;
                    }
                }
                return true;
            };
            // 仕事 $j の段 $k を $start から置く。置けたら全部の枠、置けなければ null
            $place = function (int $j, int $k, int $start, array $placed) use (&$place, $jobs, $free): ?array {
                if ($j >= count($jobs)) {
                    return $placed;
                }
                $st = $jobs[$j]['steps'][$k];
                $end = $start + $st['len'];
                foreach (ClinicRules::lanes($st['lanes'], $st['machine']) as $lane) {
                    if (!$free($lane, $st['machine'], $start, $end, $placed)) {
                        continue;
                    }
                    $extra = [];
                    if ($st['machine'] === self::CO2) {
                        // ピコを使っている時間（予約済み＋この予約で置いたもの）
                        $picoBusy = [...$machineBusy(self::PICO), ...array_map(fn($g) => [$g[2], $g[3]], array_filter($placed, fn($g) => $g[6] === self::PICO))];
                        $mainBusy = [...$laneBusy(self::BED2_LANE), ...array_map(fn($g) => [$g[2], $g[3]], array_filter($placed, fn($g) => $g[0] === self::BED2_LANE))];
                        $extra = self::co2Fits($lane, $start, $end, $picoBusy, $mainBusy, $jobs[$j]['entry']['item'] ?? []);
                        if ($extra === null) {
                            continue;
                        }
                    }
                    $segs = [...$placed, [$lane, $st['menus'], $start, $end, $st['role'], $j, $st['machine']], ...array_map(fn($x) => [$x[0], [$x[1]], $x[2], $x[3], $x[4], $j, ''], $extra)];
                    if ($st['with'] !== null && $extra === []) {
                        [$wl, $wm, $wlen, $wrole] = $st['with'];
                        if (!$free($wl, '', $start, $start + $wlen, $segs)) {
                            continue;
                        }
                        $segs[] = [$wl, [$wm], $start, $start + $wlen, $wrole, $j, ''];
                    }
                    $lastStep = $k + 1 >= count($jobs[$j]['steps']);
                    foreach ($lastStep ? self::CHAIN_WAITS : $st['waits'] as $wait) {
                        $r = $lastStep ? $place($j + 1, 0, $end + $wait, $segs) : $place($j, $k + 1, $end + $wait, $segs);
                        if ($r !== null) {
                            return $r;
                        }
                    }
                }
                return null;
            };
            $first = $jobs[0]['steps'][0];
            $starts = [];
            $forced = [];
            // 最初の施術で機器を使う段が、機器が空いたすぐ後に始まる来院の時刻（説明などの前の段の分だけ前）。隙間が残っても出す（院長 11/28）
            $pre = 0;
            foreach ($jobs[0]['steps'] as $st0) {
                if ($st0['machine'] !== '') {
                    foreach ($machineBusy($st0['machine']) as [, $be]) {
                        $starts[] = $be - $pre;
                        $forced[] = $be - $pre;
                    }
                    break;
                }
                $pre += $st0['len'];
            }
            foreach ($first['lanes'] as $lane) {
                foreach (self::gaps($windows, $laneBusy($lane)) as [$gs, $ge, , $we]) {
                    $starts[] = $gs;
                    if ($ge < $we && $ge - $first['len'] >= $gs) {
                        $starts[] = $ge - $first['len'];
                    }

                }
            }
            $found = [];
            foreach (array_unique($starts) as $t) {
                if ($date === $now['date'] && $t <= $now['minutes']) {
                    continue;
                }
                $segs = $place(0, 0, $t, []);
                if ($segs !== null) {
                    $found[] = [self::hm($t), $t, max(array_column($segs, 3)), $segs];
                }
            }
            $found = self::tidy($date, $windows, $found, fn($c) => array_map(fn($g) => [$g[0], $g[2], $g[3]], $c[3]), $forced);
            if ($found) {
                $out[$date] = $found;
            }
        }
        ksort($out);
        return $out;
    }

    /** 複数の施術の所要時間の文（「約45分（ご相談15分・ボトックス注射10分…）」） */
    public static function chainDurationText(array $jobs): string
    {
        $parts = [];
        $total = 0;
        foreach ($jobs as $job) {
            $m = array_sum(array_column($job['steps'], 'len'));
            $total += $m;
            $parts[] = ($job['consult'] ? 'ご相談' : $job['label']) . "{$m}分";
        }
        return count($jobs) > 1
            ? '約' . $total . '分〜（' . implode('・', $parts) . '。混雑により施術の間に少しお待ちいただく場合があります）'
            : '約' . $total . '分（' . $parts[0] . '）';
    }

    private static function num(float $a): string
    {
        return rtrim(rtrim(number_format($a, 1, '.', ''), '0'), '.');
    }

    private static function mailSubject(string $kind, string $itemName = ''): string
    {
        if ($kind === 'multi') {
            return '【' . Store::publicInfo()['publicName'] . '】日曜日のご予約を承りました';
        }
        if ($kind === 'menu') {
            return '【' . Store::publicInfo()['publicName'] . '】' . $itemName . 'のご予約を承りました';
        }
        $what = $kind === 'artmake' ? 'アートメイク除去' : 'タトゥー除去';
        return '【' . Store::publicInfo()['publicName'] . '】' . $what . '（日曜日）のご予約を承りました';
    }

    /**
     * 問診票をお願いするか：当院の初診の方、または再診でも、最後の問診票がご来院日の1年より前の方（問診票の記録がない方も）。
     * 受診区分を送らない呼び出し（タトゥーの従来の形）は出さない（院長 11/21）
     */
    public static function askQuestionnaire(array $f, string $patientId): bool
    {
        if (!empty($f['clinicInitial'])) {
            return true;
        }
        if (empty($f['clinicReturning']) || $patientId === '') {
            return false;
        }
        $q = Store::latestQuestionnaireOf($patientId);
        $at = $q === null ? '' : substr(str_replace('/', '-', (string) ($q['submittedAt'] ?? $q['receivedAt'] ?? '')), 0, 10);
        return $at === '' || strcmp($at, add_days((string) $f['date'], -365)) <= 0;
    }

    /** 予約を承ったすぐ後に出す、問診票のお願い（画面・LINE・メール） */
    public const QUESTIONNAIRE_ASK = 'アレルギーや内服など事前問診票をご回答ください。';

    /** 問診票の入口：LINE で予約した方は LINE の中で開く問診票、ほかは Web の問診票 */
    public static function questionnaireUrl(string $channel): string
    {
        $line = LineLink::liffUrl();
        $web = (string) (config()['monshin_url'] ?? '');
        return $channel === 'line' && $line !== '' ? $line : ($web !== '' ? $web : $line);
    }

    public static function mailBody(array $f, string $channel = 'mail'): string
    {
        $p = Store::publicInfo();
        // 承りましたのすぐ後に、問診票の入口（askQuestionnaire の方だけ。LINE の問診票は氏名・電話番号などを入力済みで開く）
        $q = !empty($f['askQuestionnaire']) ? self::questionnaireUrl($channel) : '';
        $qLines = $q !== '' ? [self::QUESTIONNAIRE_ASK, $q] : [];
        $c = Store::clinic();
        $phone = (string) ($c['phone'] ?? '');
        if ($f['kind'] === 'multi') {
            // 希望施術が複数・相談のみ：施術ごとの時刻と内容
            $lines = [];
            foreach ($f['jobs'] as $j => $job) {
                $mine = array_values(array_filter($f['segs'], fn($g) => $g[5] === $j));
                $a = min(array_column($mine, 2));
                $b = max(array_column($mine, 3));
                $lines[] = '・' . self::hm($a) . '〜' . self::hm($b) . ' ' . ($job['consult'] ? $job['label'] : $job['label'] . (($job['entry']['first'] ?? false) ? '（初診）' : ''));
                if ($job['entry'] !== null && $job['entry']['sameDay']) {
                    $t = self::entryText($job['entry']);
                    if ($t !== '') {
                        $lines[] = '　' . $t;
                    }
                }
            }
            $notes = array_values(array_filter(array_map(fn($job) => ($job['entry']['item']['note'] ?? '') ?: null, $f['jobs'])));
            if (array_filter($f['jobs'], fn($job) => in_array($job['entry']['kind'] ?? '', ['tattoo', 'artmake'], true) && $job['entry']['sameDay'])) {
                $notes[] = 'タトゥー・アートメイク除去の方：' . self::SHAVE_NOTICE_PAGE;
            }
            $consult = (bool) array_filter($f['jobs'], fn($job) => $job['consult']);
            return implode("\n", array_filter([
                "{$f['name']} 様",
                '',
                '日曜日のご予約を承りました。',
                ...$qLines,
                '',
                '日時：' . format_date_ja($f['date']) . " {$f['time']}",
                '内容：',
                ...$lines,
                '混雑により、施術と施術の間に少しお待ちいただく場合があります。',
                $consult ? self::CONSULT_NOTICE : null,
                $p['accessUrl'] !== '' ? 'アクセス：' . $p['accessUrl'] : ($p['address'] !== '' ? '場所：' . $p['address'] : null),
                '',
                '【ご来院前のお願い】',
                self::NO_MAKEUP,
                ...$notes,
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
        if ($f['kind'] === 'menu') {
            $it = $f['item'];
            $first = $f['visit'] === 'first';
            return implode("\n", array_filter([
                "{$f['name']} 様",
                '',
                "{$it['name']}のご予約を承りました。",
                ...$qLines,
                '',
                '日時：' . format_date_ja($f['date']) . " {$f['time']}",
                '区分：' . ($first ? '初診' : '再診'),
                self::pickText($it, $f['pick'] ?? []) !== '' ? ((self::isFlow($it) ? '' : (($it['countPerMinute'] ?? 0) > 0 ? '本数：' : self::pickLabel($it) . '：')) . self::pickText($it, $f['pick'] ?? [])) : null,
                ...self::needleLines($it, $f['pick'] ?? []),
                ...self::creamLines($it, $f['pick'] ?? []),
                $p['accessUrl'] !== '' ? 'アクセス：' . $p['accessUrl'] : ($p['address'] !== '' ? '場所：' . $p['address'] : null),
                '',
                '【ご来院前のお願い】',
                self::NO_MAKEUP,
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
            ...$qLines,
            '',
            '日時：' . format_date_ja($f['date']) . " {$f['time']}",
            '区分：' . ($f['visit'] === 'first' ? '初診（照射の前にご説明があります）' : '再診'),
            '希望照射面積：' . self::num((float) $f['area']) . 'cm²',
            '料金の目安：1回 ' . number_format(self::price((float) $f['area'])) . '円（税込）' . ($f['anesthesia'] ? '＋局所麻酔注射 1ccあたり5,500円（税込）' : ''),
            '面積は当日に測り、照射の前に料金をお伝えします。',
            $p['accessUrl'] !== '' ? 'アクセス：' . $p['accessUrl'] : ($p['address'] !== '' ? '場所：' . $p['address'] : null),
            '',
            'タトゥー・アートメイク除去は日曜日の診療です。ほかの美容皮膚科の診療日（水曜・祝日）とは異なりますのでご注意ください。',
            '',
            '【ご来院前のお願い】',
            self::NO_MAKEUP,
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
