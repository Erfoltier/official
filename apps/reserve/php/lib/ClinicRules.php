<?php
/**
 * 院の予約のルール（機器・ベッド・レーン）を1か所に。
 * 日曜の即時予約（TattooBooking）が使う。水曜・祝日の美容皮膚科の即時予約を入れるときも、ここを使う（院長 11/28）。
 * ルールを足すときはここと docs/SPEC.md の「予約のルール」の表を直す。
 */
declare(strict_types=1);

final class ClinicRules
{
    /** メイン＝医師のレーン＝2番ベッド */
    public const MAIN = 'lane-main';

    public const GENTLEMAX = 'ジェントルマックスプロ';
    public const PICO = 'ディスカバリーピコプラス';
    public const CO2 = '炭酸ガス';
    public const INNERFILL = 'インナーフィル';

    /** 出勤スタッフがいなくても予約を入れられるレーン（メインは医師。予約を受ける日は医師が必ずいる）。ほかは Todaysメモに名前がある日だけ（院長 11/27） */
    public const STAFF_FREE_LANES = [self::MAIN];

    /**
     * 機器（どれも1台なので、同じ機器は同じ時刻に重ねない）。
     *   lanes  … 置き場所の都合で施術できるレーン（null は制限なし）
     *   words  … 予約メニューの名前にこの言葉があれば、その機器を使う（院内で入れた予約も重ねないため）
     *   bed    … 置いてあるベッド（レーン）。同じベッドの機器は同じ時刻に使えない
     *   moveTo … 同じベッドのほかの機器を使っている間に、動かして施術するレーン
     *   except … 名前にこの言葉があれば、words に合っても機器を使わない
     * 機器はどれも1台（院長 11/28）。機器のない施術（ピーリングなど。薬剤がたくさんある）は、1番・3番で同じ時刻に入れてよい
     */
    public const MACHINES = [
        // 1番ベッドに設置：レーザー脱毛・レーザーシャワー・タイトニングレーザー（院長 11/20・11/28）
        self::GENTLEMAX => ['lanes' => ['lane-1'], 'words' => ['レーザー脱毛', 'レーザーシャワー', 'タイトニング'], 'bed' => null, 'moveTo' => null, 'except' => []],
        // 2番ベッドに設置：タトゥー除去・アートメイク除去・シミ（ルビーも出せる）・黒ずみトーニング（院長 11/21・11/27）
        self::PICO => ['lanes' => null, 'words' => ['シミ'], 'bed' => self::MAIN, 'moveTo' => null, 'except' => []],
        // 2番ベッドに設置：ほくろ除去・炭酸ガスフラクショナル。ピコを使っている間は3番へ動かす（院長 11/27）
        // 「炭酸ガスフラクショナル麻酔」は麻酔クリームの時間なので使わない
        self::CO2 => ['lanes' => null, 'words' => ['ほくろ', '炭酸ガス'], 'bed' => self::MAIN, 'moveTo' => 'lane-3', 'except' => ['麻酔']],
        // スタンプ注射の機械：フィルロード・トラネ+ピンク・ピンクグロー・トラネキサム酸スタンプ注射・ジュブアセル（看護師施術）・リジュラン（看護師施術、導入予定）。
        // 手打ちは使わない。局所麻酔注射のときは麻酔のあとすぐ施術（クリームのような待ちはない。院長 11/28）
        self::INNERFILL => ['lanes' => null, 'words' => ['フィルロード', 'トラネ注射', '機械打ち', 'ジュブアセル看護師', 'リジュラン看護師'], 'bed' => null, 'moveTo' => null, 'except' => ['手打ち']],
    ];

    /** 名前にこの言葉があるメニューは、どの機器も使わない（説明の時間） */
    public const NOT_MACHINE_WORDS = ['説明'];

    /** 予約メニューの名前から、その機器を使うか */
    public static function usesMachine(string $menuName, string $machine): bool
    {
        foreach ([...self::NOT_MACHINE_WORDS, ...(self::MACHINES[$machine]['except'] ?? [])] as $w) {
            if (str_contains($menuName, $w)) {
                return false;
            }
        }
        foreach (self::MACHINES[$machine]['words'] ?? [] as $w) {
            if (str_contains($menuName, $w)) {
                return true;
            }
        }
        return false;
    }

    /** その機器で施術できるレーン：置き場所で絞り、動かせる機器はベッドのレーンがあれば動かす先も足す */
    public static function lanes(array $lanes, string $machine): array
    {
        $r = self::MACHINES[$machine] ?? null;
        if ($r === null) {
            return $lanes;
        }
        if ($r['lanes'] !== null) {
            $lanes = array_values(array_filter($lanes, fn($l) => in_array($l, $r['lanes'], true)));
        }
        if ($r['moveTo'] !== null && in_array($r['bed'], $lanes, true) && !in_array($r['moveTo'], $lanes, true)) {
            $lanes[] = $r['moveTo'];
        }
        return $lanes;
    }

    /** そのレーンに予約を入れるには、Todaysメモに出勤スタッフの名前が要るか */
    public static function needsStaff(string $lane): bool
    {
        return $lane !== '' && !in_array($lane, self::STAFF_FREE_LANES, true);
    }
}
