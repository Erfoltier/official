<?php
/**
 * 院のパソコンに保存する控え（院長・管理者が 設定 → バックアップ から押したときだけ）。
 *
 * 1. 予約・患者・記録・設定（データベース丸ごと）：院長が決めた合言葉で全体を暗号化した1つのファイル（.lrbk）。
 *    中にデータベースの鍵（config の encryption_key）も合言葉で包んで入れるので、サーバーが無くなっても合言葉だけで戻せる。
 *    戻し方は php/tools/restore-local-backup.php（docs/SPEC.md「控え」）。
 * 2. 写真などのファイル（data/blobs）：もともと鍵で暗号化された .bin を tar にまとめたもの。前回の保存から増えた分だけも選べる。
 *
 * 形式（.lrbk）：1行目 "LANE-RESERVE-BACKUP 1"、2行目 JSON の見出し（salt・包んだ鍵・secretstream の header など）、
 * 続けて 1MB ずつの secretstream（XChaCha20-Poly1305）の塊。最後の塊に FINAL の印。
 */
declare(strict_types=1);

final class LocalBackup
{
    private const MAGIC = "LANE-RESERVE-BACKUP 1\n";
    private const CHUNK = 1_048_576;

    /** 合言葉から暗号の鍵を作る（Argon2id。サーバーの PHP の上限に収まる重さ） */
    private static function derive(string $pass, string $salt): string
    {
        return sodium_crypto_pwhash(
            SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_KEYBYTES,
            $pass,
            $salt,
            SODIUM_CRYPTO_PWHASH_OPSLIMIT_INTERACTIVE,
            SODIUM_CRYPTO_PWHASH_MEMLIMIT_INTERACTIVE,
            SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13,
        );
    }

    public static function checkPass(mixed $pass): string
    {
        $pass = is_string($pass) ? $pass : '';
        if (mb_strlen($pass) < 10 || mb_strlen($pass) > 200) {
            throw new StoreError('invalid', '合言葉は10文字以上にしてください（戻すときに必要です。紙などに控えて、院内の安全な場所に保管してください）');
        }
        return $pass;
    }

    /** データベースの控えを作り、合言葉で暗号化したファイルを $out に書く。戻り値は見出し */
    public static function writeData(string $pass, string $out): array
    {
        $dsn = (string) config()['db_dsn'];
        if (!str_starts_with($dsn, 'sqlite:')) {
            throw new StoreError('invalid', 'この保存方式ではパソコンへの控えに対応していません（SQLite のみ）');
        }
        $tmp = tempnam(sys_get_temp_dir(), 'lrbk');
        @unlink($tmp);
        $pdo = new PDO($dsn, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('PRAGMA busy_timeout = 10000');
        $pdo->prepare('VACUUM INTO ?')->execute([$tmp]);
        $pdo = null;
        try {
            $salt = random_bytes(SODIUM_CRYPTO_PWHASH_SALTBYTES);
            $key = self::derive($pass, $salt);
            $wrapNonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            [$state, $header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($key);
            $head = [
                'created' => now_iso(),
                'clinic' => (string) (Store::clinic()['name'] ?? ''),
                'kind' => 'data',
                'bytes' => (int) filesize($tmp),
                'salt' => base64_encode($salt),
                'wrapNonce' => base64_encode($wrapNonce),
                // データベースの中身を開く鍵（config の encryption_key）を、合言葉の鍵で包む
                'wrappedKey' => base64_encode(sodium_crypto_secretbox((string) config()['encryption_key'], $wrapNonce, $key)),
                'stream' => base64_encode($header),
                'chunk' => self::CHUNK,
            ];
            $in = fopen($tmp, 'rb');
            $fh = fopen($out, 'wb');
            fwrite($fh, self::MAGIC . json_encode($head, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
            $left = $head['bytes'];
            do {
                $buf = (string) fread($in, self::CHUNK);
                $left -= strlen($buf);
                $tag = $left <= 0 ? SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL : SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE;
                fwrite($fh, sodium_crypto_secretstream_xchacha20poly1305_push($state, $buf, '', $tag));
            } while ($left > 0);
            fclose($in);
            fclose($fh);
            sodium_memzero($key);
            unset($head['wrappedKey'], $head['salt'], $head['wrapNonce'], $head['stream']);
            return $head;
        } finally {
            @unlink($tmp);
        }
    }

    /** .lrbk を合言葉で開き、データベースを $dbOut に書く。戻り値：['encryptionKey' => …, 'head' => …]（復元ツール・テスト用） */
    public static function readData(string $file, string $pass, string $dbOut): array
    {
        $fh = fopen($file, 'rb');
        if (!$fh || fread($fh, strlen(self::MAGIC)) !== self::MAGIC) {
            throw new RuntimeException('LANE RESERVE の控えのファイルではありません');
        }
        $head = json_decode((string) fgets($fh), true);
        if (!is_array($head) || ($head['kind'] ?? '') !== 'data') {
            throw new RuntimeException('控えの見出しが読めません');
        }
        $key = self::derive($pass, base64_decode($head['salt']));
        $encKey = sodium_crypto_secretbox_open(base64_decode($head['wrappedKey']), base64_decode($head['wrapNonce']), $key);
        if ($encKey === false) {
            throw new RuntimeException('合言葉が違います');
        }
        $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull(base64_decode($head['stream']), $key);
        $out = fopen($dbOut, 'wb');
        $abytes = SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES;
        $done = false;
        while (!$done) {
            $c = (string) fread($fh, (int) $head['chunk'] + $abytes);
            if ($c === '') {
                throw new RuntimeException('控えのファイルが途中で切れています');
            }
            $r = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $c);
            if ($r === false) {
                throw new RuntimeException('控えのファイルが壊れています');
            }
            [$plain, $tag] = $r;
            fwrite($out, $plain);
            $done = $tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL;
        }
        fclose($out);
        fclose($fh);
        sodium_memzero($key);
        return ['encryptionKey' => $encKey, 'head' => $head];
    }

    /** 写真などのファイルの置き場所（なければ null） */
    public static function blobDir(): ?string
    {
        $cfg = config();
        if (!empty($cfg['blob_dir'])) {
            return rtrim((string) $cfg['blob_dir'], '/');
        }
        $dsn = (string) $cfg['db_dsn'];
        return str_starts_with($dsn, 'sqlite:') ? dirname(substr($dsn, 7)) . '/blobs' : null;
    }

    /** $since（UNIX 秒）より新しい写真などのファイルの一覧 [相対パス => 絶対パス] */
    public static function blobFiles(int $since = 0): array
    {
        $dir = self::blobDir();
        $files = [];
        if ($dir === null || !is_dir($dir)) {
            return $files;
        }
        foreach (glob("{$dir}/*/*.bin") ?: [] as $f) {
            if ($since === 0 || (int) filemtime($f) > $since) {
                $files['blobs/' . basename(dirname($f)) . '/' . basename($f)] = $f;
            }
        }
        ksort($files);
        return $files;
    }

    /** 写真などのファイルを tar にまとめて出力に流す（ファイルは鍵で暗号化されたまま） */
    public static function streamTar(array $files, $out): int
    {
        $n = 0;
        foreach ($files as $name => $path) {
            $size = (int) filesize($path);
            $h = str_pad($name, 100, "\0") . str_pad('0000600', 8, "\0", STR_PAD_RIGHT) . str_pad('0000000', 8, "\0") . str_pad('0000000', 8, "\0")
                . str_pad(decoct($size), 11, '0', STR_PAD_LEFT) . "\0" . str_pad(decoct((int) filemtime($path)), 11, '0', STR_PAD_LEFT) . "\0"
                . '        ' . '0' . str_repeat("\0", 100) . "ustar\0" . '00' . str_repeat("\0", 32 + 32 + 8 + 8 + 155 + 12);
            $sum = 0;
            for ($i = 0; $i < 512; $i++) {
                $sum += ord($h[$i]);
            }
            $h = substr_replace($h, str_pad(decoct($sum), 6, '0', STR_PAD_LEFT) . "\0 ", 148, 8);
            fwrite($out, $h);
            $in = fopen($path, 'rb');
            stream_copy_to_stream($in, $out);
            fclose($in);
            $pad = (512 - $size % 512) % 512;
            if ($pad) {
                fwrite($out, str_repeat("\0", $pad));
            }
            $n++;
        }
        fwrite($out, str_repeat("\0", 1024));
        return $n;
    }

    /** 手動で作ったバックアップ（サーバー内の「今すぐ作成」・院のパソコンへの保存）の履歴。新しい順に30件 */
    public static function record(array $actor, string $kind, string $detail): void
    {
        $log = array_values((array) (Db::i()->meta('manualBackups') ?? []));
        array_unshift($log, ['at' => now_iso(), 'kind' => $kind, 'by' => (string) ($actor['name'] ?? ''), 'detail' => $detail]);
        Db::i()->setMeta('manualBackups', array_slice($log, 0, 30));
    }

    public static function history(): array
    {
        return array_values((array) (Db::i()->meta('manualBackups') ?? []));
    }
}
