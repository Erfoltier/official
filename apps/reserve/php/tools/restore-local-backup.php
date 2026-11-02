<?php
/**
 * 院のパソコンに保存した控え（.lrbk）から、予約データベースを取り出す（サーバーが無くなったときなど。新しいサーバーで root が流す）。
 *
 *   php restore-local-backup.php <バックアップ.lrbk> <出力先フォルダ>
 *   合言葉は聞かれたときに入れる（画面には出ない）。
 *
 * 出力先に reserve.db ができ、データベースの鍵（encryption_key）が画面に出る。
 * 新しいサーバーの config.php の 'encryption_key' をその値にし、reserve.db を db_dsn の場所に置く（docs/SPEC.md「控え」）。
 * 写真の控え（.tar）は、データベースと同じフォルダで tar xf すると blobs/ に戻る。
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
[$_, $file, $dir] = $argv + [null, null, null];
if (!$file || !$dir || !is_file($file) || !is_dir($dir)) {
    fwrite(STDERR, "使い方：php restore-local-backup.php <バックアップ.lrbk> <出力先フォルダ>\n");
    exit(2);
}
// 合言葉を、画面に出さずに読む
$pass = getenv('LRBK_PASS');
if ($pass === false) {
    fwrite(STDERR, '合言葉：');
    @system('stty -echo');
    $pass = rtrim((string) fgets(STDIN), "\r\n");
    @system('stty echo');
    fwrite(STDERR, "\n");
}
// config がなくても動くよう、控えの読み取りに要る部分だけ読み込む
define('RESERVE', true);
require_once __DIR__ . '/../lib/Errors.php';
require_once __DIR__ . '/../lib/LocalBackup.php';
$out = rtrim($dir, '/') . '/reserve.db';
if (file_exists($out)) {
    fwrite(STDERR, "{$out} がすでにあります。別のフォルダを指定してください\n");
    exit(2);
}
try {
    $r = LocalBackup::readData($file, $pass, $out);
} catch (Throwable $e) {
    @unlink($out);
    fwrite(STDERR, '戻せませんでした：' . $e->getMessage() . "\n");
    exit(1);
}
chmod($out, 0600);
$ok = (new PDO('sqlite:' . $out))->query('PRAGMA integrity_check')->fetchColumn();
echo "取り出しました：{$out}（作成 {$r['head']['created']}・{$r['head']['clinic']}・整合性 {$ok}）\n";
echo "config.php の 'encryption_key' => '{$r['encryptionKey']}'\n";
