<?php
// 開発用：php -S で API だけを動かすときの入口（サーバーには置かない）。画面は next dev が出し、/api/* をここへ回す
$uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (!str_starts_with($uri, '/api/')) {
    http_response_code(404);
    echo 'not found';
    return true;
}
// next dev を通ってきたときは、ブラウザが開いている側のホスト名で同じサイトかを見分ける
if (!empty($_SERVER['HTTP_X_FORWARDED_HOST'])) {
    $_SERVER['HTTP_HOST'] = $_SERVER['HTTP_X_FORWARDED_HOST'];
}
$_SERVER['SCRIPT_NAME'] = '/api/index.php';
require __DIR__ . '/../api/index.php';
return true;
