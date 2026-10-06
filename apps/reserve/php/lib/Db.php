<?php
declare(strict_types=1);

/**
 * 保存先（Node.js 版 db.ts と同じ形式）。
 * docs 表に「種類・ID・暗号化したJSON・索引列」を1件ずつ持つ。暗号は AES-256-GCM（IV12バイト＋タグ16バイト＋本文）。
 */
final class Db
{
    private static ?Db $instance = null;
    private PDO $pdo;
    private string $key;
    private bool $mysql;
    private int $txDepth = 0;

    public static function i(): Db
    {
        return self::$instance ??= new Db();
    }

    /** テスト用：開き直す */
    public static function reset(): void
    {
        self::$instance = null;
    }

    private function __construct()
    {
        $cfg = config();
        $hex = (string) ($cfg['encryption_key'] ?? '');
        if (!preg_match('/^[0-9a-fA-F]{64}$/', $hex)) {
            throw new RuntimeException('encryption_key（64桁の16進数）が設定されていません');
        }
        $this->key = (string) hex2bin($hex);
        $dsn = (string) $cfg['db_dsn'];
        $this->mysql = str_starts_with($dsn, 'mysql:');
        if (str_starts_with($dsn, 'sqlite:')) {
            $file = substr($dsn, 7);
            if ($file !== ':memory:' && !is_dir(dirname($file))) {
                mkdir(dirname($file), 0700, true);
            }
        }
        $this->pdo = new PDO($dsn, $cfg['db_user'] ?? null, $cfg['db_pass'] ?? null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->migrate();
        if (str_starts_with($dsn, 'sqlite:') && substr($dsn, 7) !== ':memory:') {
            @chmod(substr($dsn, 7), 0600);
        }
    }

    /**
     * 整った控えを作る（使用中でも壊れない VACUUM INTO。中身は暗号化されたまま）。
     * 保存先は DB と同じフォルダの backups/（外から見えない data/ の中）。直近 $keep 個を残す
     */
    public function backup(int $keep = 10): array
    {
        $dsn = (string) config()['db_dsn'];
        if (!str_starts_with($dsn, 'sqlite:') || substr($dsn, 7) === ':memory:') {
            throw new RuntimeException('この保存方式では控えを作れません（SQLite のファイルだけ）');
        }
        $dir = dirname(substr($dsn, 7)) . '/backups';
        if (!is_dir($dir)) {
            mkdir($dir, 0700, true);
        }
        $name = 'reserve-' . gmdate('Ymd-His') . '.db';
        $out = "{$dir}/{$name}";
        $this->pdo->prepare('VACUUM INTO ?')->execute([$out]);
        @chmod($out, 0600);
        $files = glob("{$dir}/reserve-*.db") ?: [];
        rsort($files);
        foreach (array_slice($files, $keep) as $old) {
            @unlink($old);
        }
        // できた控えをその場で開いて検査する（壊れていないか・中身の件数）
        $chk = new PDO('sqlite:' . $out, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $integrity = (string) $chk->query('PRAGMA integrity_check')->fetchColumn();
        $docs = (int) $chk->query('SELECT COUNT(*) FROM docs')->fetchColumn();
        $live = (int) $this->pdo->query('SELECT COUNT(*) FROM docs')->fetchColumn();
        $chk = null;
        return ['file' => "backups/{$name}", 'bytes' => (int) filesize($out), 'integrity' => $integrity, 'docs' => $docs, 'liveDocs' => $live];
    }

    private function migrate(): void
    {
        if ($this->mysql) {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS docs (
                kind VARCHAR(32) NOT NULL, id VARCHAR(128) NOT NULL, data LONGBLOB NOT NULL,
                updated_at VARCHAR(32) NOT NULL, k1 VARCHAR(64) NULL, k2 VARCHAR(128) NULL,
                PRIMARY KEY (kind, id), INDEX docs_k1 (kind, k1), INDEX docs_k2 (kind, k2)
            ) DEFAULT CHARSET=utf8mb4');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS audit (
                seq BIGINT AUTO_INCREMENT PRIMARY KEY, at VARCHAR(32) NOT NULL, data LONGBLOB NOT NULL
            ) DEFAULT CHARSET=utf8mb4');
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS blobs (id VARCHAR(128) PRIMARY KEY, data LONGBLOB NOT NULL)');
            return;
        }
        // 共用サーバーのファイル置き場では WAL 方式が不安定なことがあるため、標準の方式（DELETE）を使う
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
        $this->pdo->exec('PRAGMA journal_mode = DELETE');
        $this->pdo->exec('PRAGMA synchronous = FULL');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS docs (
            kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, updated_at TEXT NOT NULL,
            k1 TEXT, k2 TEXT, PRIMARY KEY (kind, id))');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS audit (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, data BLOB NOT NULL)');
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, data BLOB NOT NULL)');
        $cols = array_column($this->pdo->query('PRAGMA table_info(docs)')->fetchAll(), 'name');
        if (!in_array('k1', $cols, true)) {
            $this->pdo->exec('ALTER TABLE docs ADD COLUMN k1 TEXT');
        }
        if (!in_array('k2', $cols, true)) {
            $this->pdo->exec('ALTER TABLE docs ADD COLUMN k2 TEXT');
        }
        $this->pdo->exec('CREATE INDEX IF NOT EXISTS docs_k1 ON docs (kind, k1); CREATE INDEX IF NOT EXISTS docs_k2 ON docs (kind, k2);');
    }

    // ---- 暗号化 ----

    private function encrypt(mixed $value): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $body = openssl_encrypt(json_out($value), 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($body === false) {
            throw new RuntimeException('暗号化に失敗しました');
        }
        return $iv . $tag . $body;
    }

    private function decrypt(string $blob): mixed
    {
        $plain = openssl_decrypt(substr($blob, 28), 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, substr($blob, 0, 12), substr($blob, 12, 16));
        if ($plain === false) {
            throw new RuntimeException('データを読めません（暗号鍵が違う可能性があります）');
        }
        return json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
    }

    /** ファイル本体（写真・PDFなど）を暗号化する。形式は JSON と同じ（IV12＋タグ16＋本文） */
    private function encryptBytes(string $bytes): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $body = openssl_encrypt($bytes, 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($body === false) {
            throw new RuntimeException('暗号化に失敗しました');
        }
        return $iv . $tag . $body;
    }

    public function putBlob(string $id, string $bytes): void
    {
        $sql = $this->mysql
            ? 'INSERT INTO blobs (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)'
            : 'INSERT OR REPLACE INTO blobs (id, data) VALUES (?, ?)';
        $st = $this->pdo->prepare($sql);
        $st->bindValue(1, $id);
        $st->bindValue(2, $this->encryptBytes($bytes), PDO::PARAM_LOB);
        $st->execute();
    }

    public function getBlob(string $id): ?string
    {
        $st = $this->pdo->prepare('SELECT data FROM blobs WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            return null;
        }
        $blob = is_resource($row['data']) ? stream_get_contents($row['data']) : $row['data'];
        $plain = openssl_decrypt(substr($blob, 28), 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, substr($blob, 0, 12), substr($blob, 12, 16));
        if ($plain === false) {
            throw new RuntimeException('ファイルを読めません（暗号鍵が違う可能性があります）');
        }
        return $plain;
    }

    /** 索引列（暗号化しない）：日付と患者IDだけ。Node.js 版 indexKeys と同じ */
    private static function indexKeys(string $kind, string $id, mixed $v): array
    {
        return match ($kind) {
            'reservation' => [isset($v['startAt']) ? substr((string) $v['startAt'], 0, 10) : null, $v['patientId'] ?? null],
            'visitNote' => [$v['date'] ?? null, $v['patientId'] ?? null],
            'patientHistory' => [null, $id],
            'file', 'estimate', 'consent', 'chart' => [$v['date'] ?? null, $v['patientId'] ?? null],
            // 問診票：k2 = 患者ID（結びついていない回答は空文字）
            'questionnaire' => [null, $v['patientId'] ?? ''],
            default => [null, null],
        };
    }

    // ---- 読み書き ----

    public function get(string $kind, string $id): mixed
    {
        $st = $this->pdo->prepare('SELECT data FROM docs WHERE kind = ? AND id = ?');
        $st->execute([$kind, $id]);
        $row = $st->fetch();
        return $row ? $this->decrypt($row['data']) : null;
    }

    /** @return array<string, mixed> id => 値 */
    public function all(string $kind): array
    {
        $st = $this->pdo->prepare('SELECT id, data FROM docs WHERE kind = ?' . $this->order());
        $st->execute([$kind]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[$r['id']] = $this->decrypt($r['data']);
        }
        return $out;
    }

    /** @return array<string, mixed> 索引列で絞り込んだもの */
    public function where(string $kind, string $col, string $value): array
    {
        if ($col !== 'k1' && $col !== 'k2') {
            throw new InvalidArgumentException('bad column');
        }
        $st = $this->pdo->prepare("SELECT id, data FROM docs WHERE kind = ? AND {$col} = ?" . $this->order());
        $st->execute([$kind, $value]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[$r['id']] = $this->decrypt($r['data']);
        }
        return $out;
    }

    /** ID順に読む（Node.js 版と同じ並び。同じ開始時刻の予約の順番がそろう） */
    private function order(): string
    {
        return ' ORDER BY id';
    }

    /** @return array<string, mixed> 索引列が $from 以上 $to 以下のもの */
    public function between(string $kind, string $col, string $from, string $to): array
    {
        if ($col !== 'k1' && $col !== 'k2') {
            throw new InvalidArgumentException('bad column');
        }
        $st = $this->pdo->prepare("SELECT id, data FROM docs WHERE kind = ? AND {$col} >= ? AND {$col} <= ?" . $this->order());
        $st->execute([$kind, $from, $to]);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $out[$r['id']] = $this->decrypt($r['data']);
        }
        return $out;
    }

    public function count(string $kind, ?string $col = null, ?string $value = null): int
    {
        $sql = 'SELECT COUNT(*) AS n FROM docs WHERE kind = ?';
        $args = [$kind];
        if ($col === 'k1' || $col === 'k2') {
            $sql .= " AND {$col} = ?";
            $args[] = $value;
        }
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        return (int) $st->fetch()['n'];
    }

    public function put(string $kind, string $id, mixed $value): void
    {
        [$k1, $k2] = self::indexKeys($kind, $id, $value);
        $sql = $this->mysql
            ? 'INSERT INTO docs (kind, id, data, updated_at, k1, k2) VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at), k1 = VALUES(k1), k2 = VALUES(k2)'
            // 共用サーバーの SQLite は古いことがあるため（ロリポップは ON CONFLICT 非対応）、昔からある書き方を使う
            : 'INSERT OR REPLACE INTO docs (kind, id, data, updated_at, k1, k2) VALUES (?, ?, ?, ?, ?, ?)';
        $st = $this->pdo->prepare($sql);
        $st->bindValue(1, $kind);
        $st->bindValue(2, $id);
        $st->bindValue(3, $this->encrypt($value), PDO::PARAM_LOB);
        $st->bindValue(4, now_iso());
        $st->bindValue(5, $k1);
        $st->bindValue(6, $k2);
        $st->execute();
    }

    public function delete(string $kind, string $id): void
    {
        $this->pdo->prepare('DELETE FROM docs WHERE kind = ? AND id = ?')->execute([$kind, $id]);
    }

    public function deleteBlob(string $id): void
    {
        $this->pdo->prepare('DELETE FROM blobs WHERE id = ?')->execute([$id]);
    }

    public function meta(string $id): mixed
    {
        return $this->get('meta', $id);
    }

    public function setMeta(string $id, mixed $value): void
    {
        $this->put('meta', $id, $value);
    }

    public function appendAudit(array $entry): void
    {
        $st = $this->pdo->prepare('INSERT INTO audit (at, data) VALUES (?, ?)');
        $st->bindValue(1, $entry['at']);
        $st->bindValue(2, $this->encrypt($entry), PDO::PARAM_LOB);
        $st->execute();
    }

    public function audit(int $limit): array
    {
        $st = $this->pdo->prepare('SELECT data FROM audit ORDER BY seq DESC LIMIT ' . max(1, $limit));
        $st->execute();
        return array_map(fn($r) => $this->decrypt($r['data']), $st->fetchAll());
    }

    /** まとめて書き込む（途中で失敗したら全部取り消す）。入れ子にしてもよい */
    public function transaction(callable $fn): mixed
    {
        if ($this->txDepth > 0) {
            return $fn();
        }
        // SQLite は最初から書き込みの鍵を取る（BEGIN IMMEDIATE）。同時に来た2つの書き込みが
        // 途中で鍵を取り合って「database is locked」になるのを防ぎ、待ち合わせ（busy_timeout）を効かせる
        if ($this->mysql) {
            $this->pdo->beginTransaction();
        } else {
            $this->pdo->exec('BEGIN IMMEDIATE');
        }
        $this->txDepth++;
        try {
            $out = $fn();
            $this->mysql ? $this->pdo->commit() : $this->pdo->exec('COMMIT');
            return $out;
        } catch (Throwable $e) {
            $this->mysql ? $this->pdo->rollBack() : $this->pdo->exec('ROLLBACK');
            throw $e;
        } finally {
            $this->txDepth--;
        }
    }
}

/** JavaScript の JSON.stringify と同じ書き方（日本語や / をエスケープしない） */
function json_out(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
}
