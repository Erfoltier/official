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
        // 応答には詳細を出さない。原因調査のため、種類・場所だけを data/diag.txt（外から見えない）に残す
        error_log('reserve: unexpected error ' . get_class($err));
        self::logError($err);
        self::json(['error' => 'internal', 'message' => 'サーバーでエラーが発生しました'], 500);
    }

    /** 想定外のエラーの記録（患者情報を含まないよう、エラーの種類・プログラムの場所・PHPの版だけ） */
    public static function logError(Throwable $err): void
    {
        try {
            $file = RESERVE_ROOT . '/data/diag.txt';
            if (is_file($file) && filesize($file) > 200_000) {
                @rename($file, $file . '.old');
            }
            $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
            $path = (string) preg_replace('#/(p|r|f)-[^/]+#', '/$1-…', $path);
            $msg = $err instanceof PDOException || $err instanceof JsonException || $err instanceof TypeError || $err instanceof ValueError
                || $err instanceof RuntimeException || $err instanceof Error
                ? mb_substr(preg_replace('/\s+/', ' ', $err->getMessage()), 0, 200) : '';
            $line = sprintf(
                "%s PHP%s %s %s %s:%d %s\n",
                date('c'),
                PHP_VERSION,
                $path,
                get_class($err),
                basename($err->getFile()),
                $err->getLine(),
                $msg,
            );
            @file_put_contents($file, $line, FILE_APPEND | LOCK_EX);
            @chmod($file, 0644); // 患者情報は含まない。FTP の画面から読めるように
        } catch (Throwable) {
            // 記録に失敗しても応答は返す
        }
    }

    /** 実際のメソッド。共用サーバーで PUT/PATCH/DELETE が通らないため、POST + X-HTTP-Method-Override も受け付ける */
    /** ほかのサイト・ほかのページから送られてきた変更の操作か（ブラウザが付ける Origin・Sec-Fetch-Site で見分け、付いていなければ通す） */
    public static function crossSiteWrite(): bool
    {
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '') {
            $u = parse_url($origin);
            if (!is_array($u) || !isset($u['host'])) {
                return true;
            }
            $host = $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
            if (strtolower($host) !== strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''))) {
                return true;
            }
        }
        $site = (string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
        return $site !== '' && $site !== 'same-origin' && $site !== 'none';
    }

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
            'memo?' => fn($x) => V::str($x, 3000),
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
            'memo?' => fn($x) => V::str($x, 3000),
            'requestId?' => fn($x) => $x === '' ? '' : V::requestId($x),
            'stageId?' => [V::class, 'id'],
            'stageText?' => fn($x) => V::str($x, 40),
            'stageMin?' => fn($x) => V::int($x, 0, 1439),
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
            'birthDate?' => $s(10), 'caution?' => [V::class, 'bool'], 'cautionNote?' => $s(1000), 'memo?' => $s(12000),
            'history?' => $s(4000), 'medications?' => $s(4000),
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
            'docName?' => fn($x) => V::str($x, 100),
            'address?' => fn($x) => V::str($x, 200),
            'phone?' => fn($x) => V::str($x, 40),
            'issuer?' => fn($x) => V::str($x, 80),
            'estimateNote?' => fn($x) => V::str($x, 3000),
            'estimateValidDays?' => fn($x) => V::int($x, 1, 365),
            'estimatePaper?' => fn($x) => V::enum($x, ['A4', 'A5']),
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

    /** @return array<int, array> */
    public static function estimateLines(mixed $v): array
    {
        if (!is_array($v) || !array_is_list($v) || count($v) < 1 || count($v) > 40) {
            throw new InputError();
        }
        return array_map(fn($l) => V::shape($l, [
            'kind' => fn($x) => V::enum($x, ['menu', 'product', 'custom']),
            'refId?' => [V::class, 'id'],
            'name' => fn($x) => V::str($x, 200),
            'unitYen' => fn($x) => V::int($x, -10_000_000, 10_000_000),
            'qty' => fn($x) => V::int($x, 1, 99),
        ]), $v);
    }

    public static function priceItem(mixed $v): array
    {
        return V::shape($v, [
            'category?' => fn($x) => V::str($x, 100),
            'name?' => fn($x) => V::str($x, 200),
            'priceYen?' => fn($x) => $x === null ? null : V::int($x, -10_000_000, 10_000_000),
        ]);
    }

    public static function integrationConsentTemplates(mixed $v): array
    {
        return V::shape($v, ['templates' => function ($x) {
            if (!is_array($x) || !array_is_list($x) || count($x) > 200) {
                throw new InputError();
            }
            return array_map(fn($t) => V::shape($t, [
                'driveId' => [V::class, 'id'],
                'title' => function ($y) {
                    $y = V::str($y, 200);
                    if ($y === '') {
                        throw new InputError();
                    }
                    return $y;
                },
                'modifiedTime' => [V::class, 'iso'],
                'html' => fn($y) => V::str($y, 400_000),
            ]), $x);
        }])['templates'];
    }

    public static function consentSource(mixed $v): array
    {
        return V::shape($v, ['url' => fn($x) => V::str($x, 500), 'key?' => fn($x) => V::str($x, 200)]);
    }

    public static function consentTemplateMenus(mixed $v): array
    {
        return V::shape($v, ['menuIds' => fn($x) => V::ids($x, 0, 100)])['menuIds'];
    }

    public static function createConsent(mixed $v): array
    {
        return V::shape($v, [
            'templateId' => [V::class, 'id'],
            'reservationId?' => [V::class, 'id'],
            'date?' => [V::class, 'date'],
            'treatment?' => fn($x) => V::str($x, 200),
            'signature?' => function ($x) {
                $x = V::str($x, 400_000);
                if (!preg_match('#^data:image/png;base64,[A-Za-z0-9+/]+=*$#', $x)) {
                    throw new InputError();
                }
                return $x;
            },
        ]);
    }

    public static function integrationQuestionnaires(mixed $v): array
    {
        return V::shape($v, [
            'responses' => function ($x) {
                if (!is_array($x) || !array_is_list($x) || count($x) > 200) {
                    throw new InputError();
                }
                return array_map(fn($r) => V::shape($r, [
                    'key' => function ($y) {
                        $y = V::str($y, 200);
                        if ($y === '') {
                            throw new InputError();
                        }
                        return $y;
                    },
                    'submittedAt' => fn($y) => V::str($y, 40),
                    'name' => fn($y) => V::str($y, 120),
                    'kana?' => fn($y) => V::str($y, 120),
                    'birthDate?' => fn($y) => V::str($y, 10),
                    'phone?' => fn($y) => V::str($y, 30),
                    'history?' => fn($y) => V::str($y, 4000),
                    'medications?' => fn($y) => V::str($y, 4000),
                    'allergies?' => fn($y) => V::str($y, 4000),
                    'answers' => function ($y) {
                        if (!is_array($y) || !array_is_list($y) || count($y) > 80) {
                            throw new InputError();
                        }
                        return array_map(fn($a) => V::shape($a, ['q' => fn($z) => V::str($z, 300), 'a' => fn($z) => V::str($z, 4000)]), $y);
                    },
                ]), $x);
            },
        ]);
    }

    public static function importConsentTemplates(mixed $v): array
    {
        $t = V::shape($v, [
            'templates' => function ($x) {
                if (!is_array($x) || !array_is_list($x) || count($x) < 1 || count($x) > 30) {
                    throw new InputError();
                }
                return array_map(fn($y) => V::shape($y, ['title' => fn($z) => V::str($z, 200), 'html' => fn($z) => V::str($z, 400_000)]), $x);
            },
        ]);
        return $t['templates'];
    }

    public static function importFetch(mixed $v): string
    {
        return V::shape($v, ['url' => fn($x) => V::str($x, 2000)])['url'];
    }

    public static function linkQuestionnaire(mixed $v): string
    {
        $c = V::shape($v, ['chartNo' => fn($x) => V::str($x, 30)])['chartNo'];
        if ($c === '') {
            throw new InputError();
        }
        return $c;
    }

    public static function integrationPrices(mixed $v): array
    {
        return V::shape($v, [
            'sheet' => function ($x) {
                $x = V::str($x, 100);
                if ($x === '') {
                    throw new InputError();
                }
                return $x;
            },
            'items' => function ($x) {
                if (!is_array($x) || !array_is_list($x) || count($x) > 1000) {
                    throw new InputError();
                }
                return array_map(fn($it) => V::shape($it, [
                    'category' => fn($y) => V::str($y, 100),
                    'name' => fn($y) => V::str($y, 200),
                    'priceYen' => fn($y) => $y === null ? null : V::int($y, -10_000_000, 10_000_000),
                    'priceText?' => fn($y) => V::str($y, 100),
                    'kind?' => fn($y) => V::enum($y, ['treatment', 'product']),
                ]), $x);
            },
        ]);
    }

    /** @return string[] */
    public static function priceUrls(mixed $v): array
    {
        $o = V::shape($v, ['urls' => function ($x) {
            if (!is_array($x) || !array_is_list($x) || count($x) > 10) {
                throw new InputError();
            }
            return array_map(fn($u) => V::str($u, 300), $x);
        }]);
        return $o['urls'];
    }

    public static function createEstimate(mixed $v): array
    {
        return V::shape($v, [
            'reservationId?' => [V::class, 'id'],
            'date?' => [V::class, 'date'],
            'validUntil?' => [V::class, 'date'],
            'lines' => [self::class, 'estimateLines'],
            'note?' => fn($x) => V::str($x, 2000),
        ]);
    }

    private static function chartFields(bool $treatmentRequired): array
    {
        return [
            ($treatmentRequired ? 'treatment' : 'treatment?') => fn($x) => V::str($x, 300),
            'area?' => fn($x) => V::str($x, 400),
            'settings?' => fn($x) => V::str($x, 2000),
            'drugs?' => function ($x) {
                if (!is_array($x) || !array_is_list($x) || count($x) > 10) {
                    throw new InputError();
                }
                return array_map(fn($d) => V::shape($d, [
                    'name' => fn($y) => V::str($y, 200),
                    'lot?' => fn($y) => V::str($y, 100),
                    'amount?' => fn($y) => V::str($y, 100),
                ]), $x);
            },
            'anesthesia?' => fn($x) => V::str($x, 200),
            'findings?' => fn($x) => V::str($x, 16000),
            'nextPlan?' => fn($x) => V::str($x, 400),
            'operator?' => fn($x) => V::str($x, 100),
        ];
    }

    public static function createChart(mixed $v): array
    {
        return V::shape($v, ['date' => [V::class, 'date'], 'reservationId?' => [V::class, 'id'], ...self::chartFields(true)]);
    }

    public static function updateChart(mixed $v): array
    {
        return V::shape($v, ['version' => fn($x) => V::int($x, 1), 'date?' => [V::class, 'date'], ...self::chartFields(false)]);
    }

    public static function updateEstimate(mixed $v): array
    {
        return V::shape($v, [
            'version' => fn($x) => V::int($x, 1),
            'date?' => [V::class, 'date'],
            'validUntil?' => [V::class, 'date'],
            'lines?' => [self::class, 'estimateLines'],
            'note?' => fn($x) => V::str($x, 2000),
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

    public static function stage(mixed $v): array
    {
        return V::shape($v, [
            'label?' => fn($x) => V::str($x, 40),
            'color?' => fn($x) => V::str($x, 7),
            'phase?' => fn($x) => V::enum($x, ['booked', 'arrived', 'in_treatment', 'checkout', 'done']),
            'free?' => [V::class, 'bool'],
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
            'note' => fn($x) => V::str($x, 16000),
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
            'canManage?' => [V::class, 'bool'],
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
