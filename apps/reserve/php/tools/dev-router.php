<?php
// 開発用：php -S で API だけを動かすときの入口（サーバーには置かない）。画面は next dev が出し、/api/* をここへ回す
$uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
// 患者の問診票（ログイン不要の送信ページ）
if (preg_match('#^/monshin/assets/([a-z0-9-]+\.webp)$#', $uri, $m)) {
    header('Content-Type: image/webp');
    readfile(__DIR__ . '/../monshin/assets/' . $m[1]);
    return true;
}
if ($uri === '/monshin' || str_starts_with($uri, '/monshin/')) {
    // 予約申請フォームの画面（静的ファイル）
    if (preg_match('#^/monshin/intake/(?:([A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)?))?$#', $uri, $m)) {
        $f = __DIR__ . '/../monshin/intake/' . (($m[1] ?? '') !== '' ? $m[1] : 'index.html');
        if (!is_file($f)) {
            http_response_code(404);
            return true;
        }
        $types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript', 'css' => 'text/css', 'json' => 'application/json', 'png' => 'image/png', 'webp' => 'image/webp'];
        header('Content-Type: ' . ($types[pathinfo($f, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
        readfile($f);
        return true;
    }
    if (preg_match('#^/monshin/(intake-[a-z0-9-]+|liff-diagnostic-v1)\.php$#', $uri, $m)) {
        require __DIR__ . '/../monshin/' . $m[1] . '.php';
        return true;
    }
    $file = match (true) {
        $uri === '/monshin/line.php' => 'line.php',
        $uri === '/monshin/liff/api.php' => 'liff/api.php',
        str_starts_with($uri, '/monshin/liff') => 'liff/index.php',
        default => 'index.php',
    };
    $_SERVER['SCRIPT_NAME'] = '/monshin/' . $file;
    require __DIR__ . '/../monshin/' . $file;
    return true;
}
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
