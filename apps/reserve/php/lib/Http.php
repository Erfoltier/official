<?php
declare(strict_types=1);

/**
 * 応答と入力の検査（Node.js 版 http.ts と schemas.ts と同じ）。
 */
final class Http
{
    public static function json(mixed $data, int $status = 200, array $headers = []): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        foreach ($headers as $h) {
            header($h, false);
        }
        echo json_out($data);
        exit;
    }

    public static function noContent(array $headers = []): never
    {
        http_response_code(204);
        ini_set('default_mimetype', '');
        header_remove('Content-Type');
        header('Cache-Control: no-store');
        foreach ($headers as $h) {
            header($h, false);
        }
        exit;
    }

    public static function error(Throwable $err): never
    {
        if ($err instanceof AuthError) {
            $status = match ($err->codeName) {
                'login_required' => 401, 'forbidden' => 403, 'locked' => 429, 'invalid' => 400, default => 401,
            };
            self::json(['error' => $err->codeName, 'message' => $err->getMessage()], $status);
        }
        if ($err instanceof StoreError) {
            $status = match ($err->codeName) { 'not_found' => 404, 'version_conflict' => 409, default => 400 };
            self::json(['error' => $err->codeName, 'message' => $err->getMessage()], $status);
        }
        if ($err instanceof InputError) {
            self::json(['error' => 'invalid', 'message' => '入力内容が正しくありません'], 400);
        }
        // 詳細（患者情報を含みうる）は応答にもログにも出さない
        error_log('reserve: unexpected error ' . get_class($err));
        self::json(['error' => 'internal', 'message' => 'サーバーでエラーが発生しました'], 500);
    }

    /** 実際のメソッド。共用サーバーで PUT/PATCH/DELETE が通らないため、POST + X-HTTP-Method-Override も受け付ける */
    public static function method(): string
    {
        $m = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $o = strtoupper((string) ($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? ''));
        return $m === 'POST' && in_array($o, ['PUT', 'PATCH', 'DELETE'], true) ? $o : $m;
    }

    public static function readJson(int $maxBytes = 16_384): mixed
    {
        $text = (string) file_get_contents('php://input', false, null, 0, $maxBytes * 4 + 1);
        if (js_length($text) > $maxBytes) {
            throw new StoreError('invalid', 'リクエストが大きすぎます');
        }
        try {
            return json_decode($text, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new StoreError('invalid', 'JSONの形式が正しくありません');
        }
    }

    /** ファイル本体を読む（上限を超えたら断る） */
    public static function readBytes(int $maxBytes): string
    {
        $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($declared > $maxBytes) {
            throw new StoreError('invalid', 'ファイルが大きすぎます（10MBまで）');
        }
        $bytes = (string) file_get_contents('php://input', false, null, 0, $maxBytes + 1);
        if (strlen($bytes) > $maxBytes) {
            throw new StoreError('invalid', 'ファイルが大きすぎます（10MBまで）');
        }
        return $bytes;
    }

    /** ファイルの中身を返す。写真・PDFはその場で表示し、Word はダウンロードさせる */
    public static function file(array $meta, string $bytes): never
    {
        http_response_code(200);
        $disposition = $meta['kind'] === 'doc' ? 'attachment' : 'inline';
        header('Content-Type: ' . $meta['type']);
        header('Content-Length: ' . strlen($bytes));
        header("Content-Disposition: {$disposition}; filename=\"file\"; filename*=UTF-8''" . rawurlencode($meta['name']));
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        if ($meta['kind'] !== 'pdf') {
            header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
        } else {
            header_remove('Content-Security-Policy');
        }
        echo $bytes;
        exit;
    }

    /** 外部連携API（リマインド送信プログラム等）の認証。トークン未設定なら停止（503） */
    public static function checkIntegrationAuth(): void
    {
        $expected = (string) (config()['integration_token'] ?? '');
        if (strlen($expected) < 32) {
            self::json(['error' => 'disabled', 'message' => '外部連携APIは無効です'], 503);
        }
        $auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        $given = (string) ($_SERVER['HTTP_X_INTEGRATION_TOKEN'] ?? (str_starts_with($auth, 'Bearer ') ? substr($auth, 7) : ''));
        if (!hash_equals($expected, $given)) {
            self::json(['error' => 'unauthorized'], 401);
        }
    }
}

/**
 * 入力の形の検査（zod の代わり）。合わなければ InputError（400「入力内容が正しくありません」）
 */
final class V
{
    /** オブジェクトで、知らない項目がないこと（strict） */
    public static function obj(mixed $v, array $keys, bool $strict = true): array
    {
        if (!is_array($v) || (array_is_list($v) && $v !== [])) {
            throw new InputError();
        }
        if ($strict && array_diff(array_keys($v), $keys)) {
            throw new InputError();
        }
        return $v;
    }

    public static function id(mixed $v): string
    {
        if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{1,64}$/', $v)) {
            throw new InputError();
        }
        return $v;
    }

    /** 予約申請ID（英数字・ハイフン・下線、40文字まで） */
    public static function requestId(mixed $v): string
    {
        if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{1,40}$/', $v)) {
            throw new InputError();
        }
        return $v;
    }

    public static function date(mixed $v): string
    {
        if (!is_date_string($v)) {
            throw new InputError();
        }
        return $v;
    }

    public static function str(mixed $v, int $max): string
    {
        if (!is_string($v) || js_length($v) > $max) {
            throw new InputError();
        }
        return $v;
    }

    public static function int(mixed $v, ?int $min = null, ?int $max = null): int
    {
        if (is_float($v) && floor($v) === $v && abs($v) < 2 ** 53) {
            $v = (int) $v;
        }
        if (!is_int($v) || ($min !== null && $v < $min) || ($max !== null && $v > $max)) {
            throw new InputError();
        }
        return $v;
    }

    public static function bool(mixed $v): bool
    {
        if (!is_bool($v)) {
            throw new InputError();
        }
        return $v;
    }

    public static function iso(mixed $v): string
    {
        if (!is_iso_datetime($v)) {
            throw new InputError();
        }
        return $v;
    }

    public static function enum(mixed $v, array $allowed): string
    {
        if (!is_string($v) || !in_array($v, $allowed, true)) {
            throw new InputError();
        }
        return $v;
    }

    /** @return string[] */
    public static function ids(mixed $v, int $min, int $max): array
    {
        if (!is_array($v) || !array_is_list($v) || count($v) < $min || count($v) > $max) {
            throw new InputError();
        }
        return array_map([self::class, 'id'], $v);
    }

    /**
     * 項目ごとの検査関数で、渡された項目だけを検査して返す。
     * @param array<string, callable> $spec  キー名の末尾に ? があれば省略可
     */
    public static function shape(mixed $v, array $spec, bool $strict = true): array
    {
        $keys = array_map(fn($k) => rtrim($k, '?'), array_keys($spec));
        $v = self::obj($v, $keys, $strict);
        $out = [];
        foreach ($spec as $k => $check) {
            $optional = str_ends_with($k, '?');
            $name = rtrim($k, '?');
            if (!array_key_exists($name, $v)) {
                if (!$optional) {
                    throw new InputError();
                }
                continue;
            }
            $out[$name] = $check($v[$name]);
        }
        return $out;
    }
}

// ---- 各APIの入力の形（schemas.ts と同じ） ----

final class Schema
{
    public static function createReservation(mixed $v): array
    {
        return V::shape($v, [
            'patientId' => [V::class, 'id'],
            'laneId' => [V::class, 'id'],
            'menuIds' => fn($x) => V::ids($x, 1, 5),
            'startAt' => [V::class, 'iso'],
            'endAt' => [V::class, 'iso'],
            'memo?' => fn($x) => V::str($x, 500),
            'requestId?' => [V::class, 'requestId'],
        ], false);
    }

    public static function updateReservation(mixed $v): array
    {
        return V::shape($v, [
            'version' => fn($x) => V::int($x, 1),
            'laneId?' => [V::class, 'id'],
            'startAt?' => [V::class, 'iso'],
            'endAt?' => [V::class, 'iso'],
            'status?' => fn($x) => V::enum($x, Store::STATUSES),
            'menuIds?' => fn($x) => V::ids($x, 1, 5),
            'memo?' => fn($x) => V::str($x, 500),
            'requestId?' => fn($x) => $x === '' ? '' : V::requestId($x),
        ]);
    }

    public static function integrationRequestId(mixed $v): string
    {
        return V::shape($v, ['requestId' => [V::class, 'requestId']])['requestId'];
    }

    public static function integrationM3(mixed $v): string
    {
        return V::shape($v, ['m3ChartNo' => fn($x) => V::str($x, 30)])['m3ChartNo'];
    }

    public static function reminderResult(mixed $v): array
    {
        return V::shape($v, ['status' => fn($x) => V::enum($x, ['sent', 'skipped', 'failed'])]);
    }

    private static function patientFields(): array
    {
        $s = fn(int $max) => fn($x) => V::str($x, $max);
        return [
            'kana?' => $s(120), 'nameAlt?' => $s(120), 'phone?' => $s(30), 'email?' => $s(200), 'chartNo?' => $s(30), 'm3ChartNo?' => $s(30),
            'birthDate?' => $s(10), 'caution?' => [V::class, 'bool'], 'cautionNote?' => $s(1000), 'memo?' => $s(4000),
        ];
    }

    public static function createPatient(mixed $v): array
    {
        return V::shape($v, ['name' => fn($x) => V::str($x, 120), ...self::patientFields()]);
    }

    public static function updatePatient(mixed $v): array
    {
        return V::shape($v, ['version' => fn($x) => V::int($x, 1), 'name?' => fn($x) => V::str($x, 120), ...self::patientFields()]);
    }

    public static function versionOnly(mixed $v): int
    {
        return V::shape($v, ['version' => fn($x) => V::int($x, 1)])['version'];
    }

    public static function lane(mixed $v): array
    {
        return V::shape($v, [
            'name?' => fn($x) => V::str($x, 80),
            'shortName?' => fn($x) => V::str($x, 30),
            'active?' => [V::class, 'bool'],
        ]);
    }

    public static function menu(mixed $v): array
    {
        $min = fn($x) => V::int($x, 0, 1440);
        $nullableInt = fn($x) => $x === null ? null : V::int($x);
        return V::shape($v, [
            'name?' => fn($x) => V::str($x, 160),
            'abbr?' => fn($x) => V::str($x, 30),
            'duration?' => function ($x) use ($min) {
                $kind = is_array($x) ? ($x['kind'] ?? null) : null;
                return match ($kind) {
                    'fixed' => V::shape($x, ['kind' => fn($k) => $k, 'minutes' => $min]),
                    'range' => V::shape($x, ['kind' => fn($k) => $k, 'min' => $min, 'max' => $min, 'step' => $min]),
                    default => throw new InputError(),
                };
            },
            'defaultMinutes?' => $min,
            'startStepMin?' => $min,
            'priceYen?' => $nullableInt,
            'capacity?' => $nullableInt,
            'laneIds?' => fn($x) => V::ids($x, 0, 50),
            'color?' => fn($x) => V::str($x, 7),
            'active?' => [V::class, 'bool'],
        ]);
    }

    public static function clinic(mixed $v): array
    {
        $min = fn($x) => V::int($x, 0, 1440);
        return V::shape($v, [
            'name?' => fn($x) => V::str($x, 80),
            'dayStartMin?' => $min,
            'dayEndMin?' => $min,
            'slotMin?' => function ($x) {
                $x = V::int($x);
                if (!in_array($x, [5, 10, 15, 30], true)) {
                    throw new InputError();
                }
                return $x;
            },
        ]);
    }

    public static function product(mixed $v): array
    {
        return V::shape($v, [
            'name?' => fn($x) => V::str($x, 120),
            'category?' => fn($x) => V::enum($x, ['skincare', 'oral']),
            'priceYen?' => fn($x) => $x === null ? null : V::int($x),
            'active?' => [V::class, 'bool'],
        ]);
    }

    public static function reorder(mixed $v): array
    {
        return V::shape($v, ['ids' => fn($x) => V::ids($x, 1, 500)])['ids'];
    }

    public static function visitNote(mixed $v): array
    {
        return V::shape($v, [
            'note' => fn($x) => V::str($x, 8000),
            'skincare' => function ($x) {
                if (!is_array($x) || !array_is_list($x) || count($x) > 30) {
                    throw new InputError();
                }
                return array_map(fn($s) => V::str($s, 120), $x);
            },
            'version' => fn($x) => V::int($x, 0),
        ]);
    }

    public static function login(mixed $v): array
    {
        return V::shape($v, ['staffId' => [V::class, 'id'], 'pin' => fn($x) => V::str($x, 16)]);
    }

    public static function createStaff(mixed $v): array
    {
        return V::shape($v, [
            'name' => fn($x) => V::str($x, 60),
            'role' => fn($x) => V::enum($x, Auth::ROLES),
            'pin' => fn($x) => V::str($x, 16),
        ]);
    }

    public static function updateStaff(mixed $v): array
    {
        return V::shape($v, [
            'name?' => fn($x) => V::str($x, 60),
            'role?' => fn($x) => V::enum($x, Auth::ROLES),
            'active?' => [V::class, 'bool'],
            'pin?' => fn($x) => V::str($x, 16),
        ]);
    }

    public static function deletePatient(mixed $v): array
    {
        return V::shape($v, ['version' => fn($x) => V::int($x, 1), 'reason' => fn($x) => V::str($x, 200)]);
    }

    public static function mergePatients(mixed $v): array
    {
        return V::shape($v, [
            'keepId' => [V::class, 'id'],
            'dupId' => [V::class, 'id'],
            'keepVersion' => fn($x) => V::int($x, 1),
            'dupVersion' => fn($x) => V::int($x, 1),
        ]);
    }
}
