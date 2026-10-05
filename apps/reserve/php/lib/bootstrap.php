<?php
/**
 * 予約カレンダー PHP版（ロリポップ等の共用サーバー向け）。
 * 画面（静的ファイル）から呼ばれる API を、Node.js 版と同じ形で提供する。
 * 保存形式（暗号化・項目名）も Node.js 版と同じなので、データは相互に移せる。
 */
declare(strict_types=1);

define('RESERVE', true);
const RESERVE_ROOT = __DIR__ . '/..';

mb_internal_encoding('UTF-8');
date_default_timezone_set('Asia/Tokyo');

require_once __DIR__ . '/Errors.php';
require_once __DIR__ . '/Text.php';
require_once __DIR__ . '/Time.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Store.php';
require_once __DIR__ . '/Http.php';

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = getenv('RESERVE_CONFIG') ?: RESERVE_ROOT . '/config.php';
        if (!is_file($file)) {
            throw new RuntimeException('config.php がありません（config.sample.php をコピーして設定してください）');
        }
        // 暗号鍵が入っているので、サーバー上の持ち主だけが読めるようにする
        if ((fileperms($file) & 0077) !== 0) {
            @chmod($file, 0600);
        }
        $cfg = require $file;
    }
    return $cfg;
}
