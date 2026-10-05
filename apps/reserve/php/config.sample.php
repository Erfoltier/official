<?php
/**
 * 設定ファイルの見本。config.php という名前でコピーして値を入れてください。
 * このファイルは直接開かれても何も表示しません。
 */
defined('RESERVE') || exit;

return [
    // アプリを置いた場所（URLのパス）。https://example.com/reserve/ なら '/reserve'
    'base_path' => '/reserve',

    // 保存先。SQLite（標準）。data フォルダは .htaccess で外から見えないようにしてある
    'db_dsn' => 'sqlite:' . __DIR__ . '/data/reserve.db',
    // ロリポップのMySQLを使う場合の例：
    // 'db_dsn' => 'mysql:host=mysqlXXX.phy.lolipop.lan;dbname=LAA0000000-reserve;charset=utf8mb4',
    // 'db_user' => 'LAA0000000', 'db_pass' => '********',

    // 保存データの暗号鍵（64桁の16進数）。なくすとデータが読めなくなるので、別の安全な場所にも控える
    'encryption_key' => '',

    // スタッフのログイン状態の署名用（32文字以上のランダムな文字列）
    'session_secret' => '',

    // スタッフが1人もいないときに作る「院長」アカウントのPIN（4〜8桁）
    'initial_admin_pin' => '',

    // 外部連携API用のトークン（32文字以上。使わないなら空のまま）
    'integration_token' => '',
];
