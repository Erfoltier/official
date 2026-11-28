<?php
/**
 * LINE の予約申請フォーム（intake/）の受け口が使う設定。LANE RESERVE の config.php の 'intake' から読む
 * （公開フォルダに設定ファイルを置かないため）。
 *   'intake' => [
 *     'queue_dir' => '/srv/reserve/private/intake',   // 申請の記録（intake-records/）と、LINE への送信の確認用の記録を置く（公開フォルダの外）
 *     'token_secret' => '（32文字以上のランダムな文字列）',  // 送信の確認に使う印の署名
 *     'liff_id' => '（予約申請フォームの LIFF ID）',
 *     'special_dates' => ['2026-11-03', ...],          // 水曜以外の特別診療日（空なら intake/special-clinic-days.json）
 *   ],
 * LANE RESERVE の 'line_intake_dir' は queue_dir/intake-records を指す
 */
declare(strict_types=1);

function intake_common_config(): array
{
    static $c = null;
    if ($c !== null) {
        return $c;
    }
    defined('RESERVE') || define('RESERVE', true);
    $file = getenv('RESERVE_CONFIG') ?: __DIR__ . '/../config.php';
    $all = is_file($file) ? require $file : [];
    $i = is_array($all['intake'] ?? null) ? $all['intake'] : [];
    $queue = (string) ($i['queue_dir'] ?? '');
    $secret = (string) ($i['token_secret'] ?? '');
    if ($queue === '' || strlen($secret) < 32) {
        throw new RuntimeException('intake configuration is unavailable');
    }
    $liff = (string) ($i['liff_id'] ?? '');
    return $c = [
        'queue_dir' => $queue,
        // 受け口のプログラム（line-webhook 由来）が使う名前に合わせる
        'pull_token' => $secret,
        'liff_id' => $liff,
        'channel_id' => (string) ($i['channel_id'] ?? explode('-', $liff, 2)[0]),
        'special_dates' => array_values(array_filter((array) ($i['special_dates'] ?? []), fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d))),
    ];
}
