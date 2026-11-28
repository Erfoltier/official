<?php
declare(strict_types=1);

/**
 * デモデータ（架空のスタッフ・患者・予約・来院記録）を入れる。コマンドラインだけで使い、サーバーには置かない。
 *   RESERVE_CONFIG=…/config.php php php/tools/demo-seed.php
 * 患者・予約がすでにある DB には入れない（本番のデータに混ざらないように）。
 * 架空の患者は p-0001〜p-0120、電話は架空の番号帯（0120-000-xxx）。PIN はすべて 1234（運用前に必ず変更する）
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../lib/bootstrap.php';

$db = Db::i();
$today = now_in_clinic()['date'];
Store::getDayBundle($today); // レーン・メニューなどの初期設定を入れる
if ($db->count('patient') > 0 || $db->count('reservation') > 0) {
    fwrite(STDERR, "患者か予約がすでにある DB には入れません\n");
    exit(1);
}

$hashPin = function (string $pin): array {
    $salt = bin2hex(random_bytes(16));
    return ['pinAlg' => 'pbkdf2-sha256', 'pinIter' => 210000, 'pinSalt' => $salt, 'pinHash' => hash_pbkdf2('sha256', $pin, $salt, 210000, 64, false)];
};
$db->transaction(function () use ($db, $hashPin) {
    foreach ($db->all('staff') as $id => $_) {
        $db->delete('staff', (string) $id);
    }
    foreach ([['staff-admin', '院長（デモ）', 'admin'], ['staff-dr', '医師（デモ）', 'doctor'], ['staff-ns1', '看護師A（デモ）', 'nurse'], ['staff-ns2', '看護師B（デモ）', 'nurse'], ['staff-rc1', '受付A（デモ）', 'reception']] as [$id, $name, $role]) {
        $db->put('staff', $id, ['id' => $id, 'name' => $name, 'role' => $role, 'active' => true, ...$hashPin('1234'), 'sessionVersion' => 1, 'failedCount' => 0, 'lockedUntil' => 0]);
    }
});

$FAMILY = [['佐藤', 'サトウ', 'Sato'], ['鈴木', 'スズキ', 'Suzuki'], ['高橋', 'タカハシ', 'Takahashi'], ['田中', 'タナカ', 'Tanaka'], ['伊藤', 'イトウ', 'Ito'], ['渡辺', 'ワタナベ', 'Watanabe'], ['山本', 'ヤマモト', 'Yamamoto'], ['中村', 'ナカムラ', 'Nakamura'], ['小林', 'コバヤシ', 'Kobayashi'], ['加藤', 'カトウ', 'Kato'], ['吉田', 'ヨシダ', 'Yoshida'], ['山田', 'ヤマダ', 'Yamada'], ['佐々木', 'ササキ', 'Sasaki'], ['松本', 'マツモト', 'Matsumoto'], ['井上', 'イノウエ', 'Inoue'], ['木村', 'キムラ', 'Kimura'], ['林', 'ハヤシ', 'Hayashi'], ['清水', 'シミズ', 'Shimizu'], ['山崎', 'ヤマザキ', 'Yamazaki'], ['森', 'モリ', 'Mori']];
$GIVEN = [['花子', 'ハナコ', 'Hanako'], ['美咲', 'ミサキ', 'Misaki'], ['結衣', 'ユイ', 'Yui'], ['陽菜', 'ヒナ', 'Hina'], ['葵', 'アオイ', 'Aoi'], ['さくら', 'サクラ', 'Sakura'], ['凛', 'リン', 'Rin'], ['芽依', 'メイ', 'Mei'], ['優花', 'ユウカ', 'Yuka'], ['七海', 'ナナミ', 'Nanami'], ['健太', 'ケンタ', 'Kenta'], ['翔', 'ショウ', 'Sho']];
// 漢字以外を含む氏名の例
$MIXED = [['山田 Anna', 'ヤマダ アンナ', 'Yamada Anna'], ['さくら 田中', 'サクラ タナカ', null], ['LEE Min-ji', 'イ ミンジ', '이민지'], ['佐藤 ゆい', 'サトウ ユイ', 'Sato Yui'], ['Emily Johnson', 'エミリー ジョンソン', null], ['高橋 エマ', 'タカハシ エマ', 'Takahashi Emma'], ['王 美玲', 'オウ メイリン', 'Wang Meiling'], ['鈴木 Mari（旧姓 森）', 'スズキ マリ', 'Suzuki Mari / 森']];
$rnd = fn() => mt_rand() / mt_getrandmax();
$pick = fn(array $a) => $a[mt_rand(0, count($a) - 1)];

mt_srand(42);
$patients = [];
for ($i = 0; $i < 120; $i++) {
    $p = ['id' => sprintf('p-%04d', $i + 1), 'chartNo' => (string) (10001 + $i), 'phone' => '0120-000-' . substr((string) (100 + $i), -3), 'version' => 1];
    if ($rnd() < 0.45) {
        $p['lineUserId'] = 'Udemo' . substr(hash('sha256', (string) $i), 0, 8);
    }
    $p['caution'] = $rnd() < 0.08;
    if ($p['caution']) {
        $p['cautionNote'] = 'リドカインで発赤の既往あり（デモ）';
    }
    if ($i % 15 === 7) {
        [$p['name'], $p['kana'], $alt] = $MIXED[intdiv($i, 15) % count($MIXED)];
    } else {
        $f = $pick($FAMILY);
        $g = $pick($GIVEN);
        $p['name'] = "{$f[0]} {$g[0]}";
        $p['kana'] = "{$f[1]} {$g[1]}";
        $alt = $rnd() < 0.3 ? "{$f[2]} {$g[2]}" : null;
    }
    if ($alt) {
        $p['nameAlt'] = $alt;
    }
    $patients[] = $p;
}

$order = function (array $xs): array {
    usort($xs, fn($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    return $xs;
};
$lanes = array_values(array_filter($order(array_values($db->all('lane'))), fn($l) => !empty($l['active']) && empty($l['deleted'])));
$menus = array_values(array_filter($order(array_values($db->all('menu'))), fn($m) => !empty($m['active']) && empty($m['deleted'])));
$clinic = $db->meta('clinic') ?: [];
$dayStart = (int) ($clinic['dayStartMin'] ?? 570);
$dayEnd = (int) ($clinic['dayEndMin'] ?? 1140);
$rare = ['予約（メモに自由記載）', '予約不可'];
$minutesFor = function (array $m) use ($rnd): int {
    $d = $m['duration'] ?? ['kind' => 'fixed', 'minutes' => $m['defaultMinutes'] ?? 15];
    if (($d['kind'] ?? 'fixed') === 'fixed') {
        return (int) ($d['minutes'] ?? $m['defaultMinutes'] ?? 15);
    }
    $opts = [];
    for ($x = (int) $d['min']; $x <= min(60, (int) $d['max']); $x += max(5, (int) $d['step'])) {
        $opts[] = $x;
    }
    if (!$opts) {
        return (int) ($m['defaultMinutes'] ?? 15);
    }
    $short = array_values(array_filter($opts, fn($x) => $x <= 30));
    $pool = $short && $rnd() < 0.7 ? $short : $opts;
    return $pool[mt_rand(0, count($pool) - 1)];
};
$now = now_in_clinic();
$statusFor = function (string $date, int $s, int $e) use ($now): string {
    if ($date > $now['date']) {
        return 'booked';
    }
    if ($date < $now['date'] || $e <= $now['minutes'] - 15) {
        return 'done';
    }
    if ($e <= $now['minutes']) {
        return 'checkout';
    }
    if ($s <= $now['minutes']) {
        return 'in_treatment';
    }
    return $s <= $now['minutes'] + 10 ? 'arrived' : 'booked';
};

// 2週間前〜90日先は毎日、半年前からは水曜日（美容の診療日）にも予約を入れる
$dates = [];
for ($d = add_days($today, -182); $d <= add_days($today, 90); $d = add_days($d, 1)) {
    $wd = (int) (new DateTimeImmutable($d, jst()))->format('w');
    if ($d >= add_days($today, -14) || $wd === 3) {
        $dates[] = $d;
    }
}
$at = now_iso();
$resv = [];
foreach ($dates as $date) {
    mt_srand(crc32($date));
    $busy = in_array((int) (new DateTimeImmutable($date, jst()))->format('w'), [0, 3], true);
    $n = 0;
    foreach ($lanes as $lane) {
        $lm = array_values(array_filter($menus, fn($m) => empty($m['laneIds']) || in_array($lane['id'], $m['laneIds'], true)));
        if (!$lm) {
            continue;
        }
        $t = $dayStart + mt_rand(0, 2) * 5;
        while ($t < $dayEnd - 10) {
            if ($t >= 780 && $t < 840) {
                $t = 840; // 昼休み
                continue;
            }
            if ($rnd() < ($busy ? 0.18 : 0.5)) {
                $t += 5 * (1 + mt_rand(0, 3));
                continue;
            }
            $menu = $pick($lm);
            if (in_array($menu['name'], $rare, true) && $rnd() < 0.85) {
                continue;
            }
            $end = min($t + $minutesFor($menu), $dayEnd);
            $r = [
                'id' => "r-{$date}-" . (++$n),
                'patientId' => $pick($patients)['id'],
                'laneId' => $lane['id'],
                'menuIds' => [$menu['id']],
                'startAt' => to_iso($date, $t),
                'endAt' => to_iso($date, $end),
                'status' => $rnd() < 0.05 ? 'cancelled' : $statusFor($date, $t, $end),
                'reminder' => ['status' => 'pending'],
                'version' => 1,
                'createdAt' => $at,
                'updatedAt' => $at,
            ];
            if ($rnd() < 0.1) {
                $r['memo'] = '前回赤み強め。出力控えめで';
            }
            $resv[] = $r;
            $t = $rnd() < 0.08 ? $t + 5 : $end; // ときどき2名同時
        }
    }
}

// 過去の来院に架空のメモとスキンケア
$catalog = ['ゼオスキン ミラミン', 'ゼオスキン ミラクトン', 'ゼオスキン デイリーPD', 'トレチノイン 0.025%', 'ハイドロキノン 4%', 'ビタミンC美容液', '保湿クリーム（セラミド）', '日焼け止め SPF50+', 'トラネキサム酸 内服'];
$templates = [['/脱毛/u', ['出力前回同様。照射後の赤み軽度', 'VIO含む。痛み強めのため出力1段階下げ', '毛量減ってきた。次回6〜8週後']], ['/ボトックス|BTX/u', ['眉間・額 計20単位', '目尻のみ。前回効き弱めとのこと']], ['/ヒアル/u', ['ほうれい線 0.5cc。内出血なし', '唇 0.3cc。腫れの説明済み']], ['/ハイフ|HIFU/u', ['全顔 300ショット。頬下部やや痛み', 'フェイスライン重点。次回3か月後']], ['/ピール/u', ['ピーリング後の乾燥に注意と説明', '皮むけ軽度。ゼオ開始希望']], ['/シミ|色素/u', ['頬のシミ3か所照射。テープ保護の説明', '前回照射部位の色素沈着なし']]];
$menuName = array_column($menus, 'name', 'id');
$byKey = [];
foreach ($resv as $r) {
    $d = clinic_date_of($r['startAt']);
    if ($d < $today && !in_array($r['status'], Store::INACTIVE, true)) {
        $byKey["{$r['patientId']}|{$d}"][] = $menuName[$r['menuIds'][0]] ?? '';
    }
}
ksort($byKey);
uksort($byKey, fn($a, $b) => strcmp(explode('|', $a)[1], explode('|', $b)[1]));
mt_srand(7);
$skin = [];
$notes = [];
foreach ($byKey as $k => $names) {
    if ($rnd() < 0.3) {
        continue; // 記録のない日もある
    }
    [$pid, $date] = explode('|', $k);
    $prev = $skin[$pid] ?? [];
    if ($rnd() < 0.6 && (!$prev || $rnd() < 0.25)) {
        $add = $pick($catalog);
        if (!in_array($add, $prev, true)) {
            $prev[] = $add;
        }
    }
    $skin[$pid] = array_slice($prev, 0, 5);
    $note = '経過良好';
    foreach ($templates as [$re, $list]) {
        if (preg_match($re, implode(' ', $names))) {
            $note = $pick($list);
            break;
        }
    }
    if ($rnd() < 0.3) {
        $note .= "\n次回の予約を受付で取得済み";
    }
    $notes[$k] = ['patientId' => $pid, 'date' => $date, 'note' => $note, 'skincare' => $skin[$pid], 'version' => 1, 'updatedAt' => $at];
}

$db->transaction(function () use ($db, $patients, $resv, $notes) {
    foreach ($patients as $p) {
        $db->put('patient', $p['id'], $p);
    }
    foreach ($resv as $r) {
        $db->put('reservation', $r['id'], $r);
    }
    foreach ($notes as $k => $n) {
        $db->put('visitNote', $k, $n);
    }
});
echo 'デモデータを入れました：患者 ' . count($patients) . '人・予約 ' . count($resv) . '件・来院記録 ' . count($notes) . "件\n";
