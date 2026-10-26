<?php
/**
 * LINE との連携（問診票）。LINE のメッセージ通数を使わない作り：
 * - Webhook（monshin/line.php）：予約申請の文面（初診）や「問診票」という発言に、返信（Reply API・無料）で問診票の入口を返す
 * - LIFF（monshin/liff/）：LINE の中で開く問診票。開いた人を LINE の ID トークンで確かめ、その人の予約の問診票だけを出す。
 *   氏名・フリガナ・生年月日・電話（と性別）は患者情報から使い、もう一度は書かせない
 * 鍵：チャネルシークレットは DB（暗号化）に入れ、画面には出さない。アクセストークンはリマインドと同じもの
 */
declare(strict_types=1);

final class LineLink
{
    private const API = 'https://api.line.me';
    /** 回答の key の頭。予約ごとに1つ（二重に保存しない） */
    private const KEY = 'liff-';
    /** 患者情報から使う（書かせない）質問の役割 */
    private const PREFILL = ['name', 'kana', 'birthDate', 'phone'];

    /** @var null|callable(string, string, array, ?string): array テスト用の差し替え（[状態コード, 本文] を返す） */
    public static $transport = null;

    public static function settings(): array
    {
        Store::init();
        $s = Db::i()->meta('lineLink');
        $s = is_array($s) ? $s : [];
        return ['liffId' => (string) ($s['liffId'] ?? ''), 'loginChannelId' => (string) ($s['loginChannelId'] ?? '')];
    }

    private static function secret(): string
    {
        $s = Db::i()->meta('lineLinkSecrets');
        return is_array($s) ? (string) ($s['channelSecret'] ?? '') : '';
    }

    /** 設定画面に出す形（シークレットは入っているかどうかだけ） */
    public static function view(): array
    {
        return [...self::settings(), 'secretConfigured' => self::secret() !== '', 'tokenConfigured' => Reminder::lineToken() !== '', 'liffUrl' => self::liffUrl()];
    }

    public static function update(array $in, array $actor): array
    {
        Store::init();
        $cur = self::settings();
        if (array_key_exists('liffId', $in)) {
            $v = trim((string) $in['liffId']);
            if ($v !== '' && !preg_match('/^\d{6,20}-[A-Za-z0-9]{4,20}$/', $v)) {
                throw new StoreError('invalid', 'LIFF ID の形が正しくありません（例：1234567890-AbCdEfGh）');
            }
            $cur['liffId'] = $v;
        }
        if (array_key_exists('loginChannelId', $in)) {
            $v = trim((string) $in['loginChannelId']);
            if ($v !== '' && !preg_match('/^\d{6,20}$/', $v)) {
                throw new StoreError('invalid', 'チャネルID は数字で入力してください');
            }
            $cur['loginChannelId'] = $v;
        }
        // LIFF ID の頭の数字は LINE ログインのチャネルID
        if ($cur['loginChannelId'] === '' && $cur['liffId'] !== '') {
            $cur['loginChannelId'] = explode('-', $cur['liffId'], 2)[0];
        }
        Db::i()->setMeta('lineLink', $cur);
        if (array_key_exists('channelSecret', $in)) {
            $v = trim((string) $in['channelSecret']);
            if ($v !== '' && !preg_match('/^[0-9a-f]{32}$/', $v)) {
                throw new StoreError('invalid', 'チャネルシークレットは32桁の英数字です');
            }
            Db::i()->setMeta('lineLinkSecrets', ['channelSecret' => $v]);
        }
        Auth::audit($actor, 'LINE の問診票連携の設定を変更');
        return self::view();
    }

    public static function liffUrl(): string
    {
        $id = self::settings()['liffId'];
        return $id !== '' ? 'https://liff.line.me/' . $id : '';
    }

    private static function http(string $method, string $url, array $headers, ?string $body): array
    {
        if (self::$transport !== null) {
            return (self::$transport)($method, $url, $headers, $body);
        }
        $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '', 'timeout' => 10, 'ignore_errors' => true]]);
        $raw = @file_get_contents($url, false, $ctx);
        $line = is_array($http_response_header ?? null) ? (string) ($http_response_header[0] ?? '') : '';
        $code = preg_match('/\s(\d{3})\s/', $line, $m) ? (int) $m[1] : 0;
        return [$code, is_string($raw) ? $raw : ''];
    }

    /** 開発用の php -S で、config の line_test_mode があるときだけ、LINE に問い合わせない（本番の php-fpm では効かない） */
    public static function testMode(): bool
    {
        return PHP_SAPI === 'cli-server' && !empty(config()['line_test_mode']);
    }

    /** LIFF の ID トークンを LINE に確かめてもらい、LINE の利用者 ID を返す */
    public static function verifyIdToken(string $idToken): string
    {
        if (self::testMode() && preg_match('/^test:(U[0-9a-f]{32})$/', $idToken, $m)) {
            return $m[1];
        }
        $client = self::settings()['loginChannelId'];
        if ($idToken === '' || strlen($idToken) > 4096 || $client === '') {
            throw new StoreError('forbidden', 'LINE で開き直してください');
        }
        [$code, $raw] = self::http('POST', self::API . '/oauth2/v2.1/verify', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['id_token' => $idToken, 'client_id' => $client]));
        $claims = $code === 200 ? json_decode($raw, true) : null;
        $sub = is_array($claims) ? (string) ($claims['sub'] ?? '') : '';
        if (!preg_match('/^U[0-9a-f]{32}$/', $sub)) {
            throw new StoreError('forbidden', 'LINE の確認ができませんでした。LINE で開き直してください');
        }
        return $sub;
    }

    // ---- Webhook ----

    public static function verifySignature(string $body, string $signature): bool
    {
        $secret = self::secret();
        return $secret !== '' && $signature !== '' && hash_equals(base64_encode(hash_hmac('sha256', $body, $secret, true)), $signature);
    }

    /** LINE からの知らせを処理する。返信した件数を返す */
    public static function handleWebhook(array $payload): int
    {
        $n = 0;
        foreach ((array) ($payload['events'] ?? []) as $e) {
            if (is_array($e)) {
                try {
                    self::noteContact($e);
                } catch (Throwable) {
                    // 記録に失敗しても返信は続ける
                }
            }
            if (!is_array($e) || ($e['type'] ?? '') !== 'message' || ($e['message']['type'] ?? '') !== 'text' || empty($e['replyToken'])) {
                continue;
            }
            $text = (string) ($e['message']['text'] ?? '');
            self::noteIntakeMessage($e, $text);
            $reply = self::replyFor($text);
            if ($reply !== null && self::reply((string) $e['replyToken'], $reply)) {
                $n++;
            }
        }
        return $n;
    }

    /**
     * 公式アカウントにメッセージを送った・友だち追加した LINE を覚える（患者画面で手動で連携するときの候補）。
     * 残すのは LINE の利用者ID・表示名（LINE のプロフィール）・最後のやりとりの日時と種類だけ。発言の中身は残さない
     */
    private static function noteContact(array $e): void
    {
        $uid = (string) ($e['source']['userId'] ?? '');
        if (($e['source']['type'] ?? '') !== 'user' || !preg_match('/^U[0-9a-f]{32}$/', $uid)) {
            return;
        }
        $type = (string) ($e['type'] ?? '');
        if (!in_array($type, ['message', 'follow', 'postback'], true)) {
            return;
        }
        $db = Db::i();
        $cur = $db->get('lineContact', $uid);
        $cur = is_array($cur) ? $cur : ['userId' => $uid, 'firstAt' => now_iso()];
        $cur['lastAt'] = now_iso();
        $cur['lastType'] = $type;
        // 患者が送った文（文字のメッセージだけ）。手動で LINE を探すときの検索用に、新しい30件・各200字まで残す（DB は暗号化）
        if ($type === 'message' && ($e['message']['type'] ?? '') === 'text') {
            $t = trim(mb_substr((string) ($e['message']['text'] ?? ''), 0, 200));
            if ($t !== '') {
                $cur['texts'] = array_slice([...((array) ($cur['texts'] ?? [])), ['at' => now_iso(), 'text' => $t]], -30);
            }
        }
        // 表示名は1週間に1回だけ LINE に問い合わせる（変わることがあるため）
        if (empty($cur['profileAt']) || time() - strtotime((string) $cur['profileAt']) > 7 * 86400) {
            $name = self::profileName($uid);
            if ($name !== null) {
                $cur['displayName'] = $name;
            }
            $cur['profileAt'] = now_iso();
        }
        $db->put('lineContact', $uid, $cur);
    }

    /**
     * 公式アカウントの友だち全員を「やりとりした LINE」に入れる（表示名で手動の連携を探せるように）。
     * 友だちの一覧（認証済みアカウントで使える API）を読み、まだ表示名がない人だけプロフィールを問い合わせる。通数は使わない。
     * 何度流しても同じ結果。php/tools/line-followers.php から使う
     */
    public static function importFollowers(?float $maxSeconds = null): array
    {
        $tok = Reminder::lineToken();
        if ($tok === '') {
            throw new StoreError('invalid', 'LINE のアクセストークンが設定されていません');
        }
        $db = Db::i();
        $started = microtime(true);
        $res = ['followers' => 0, 'added' => 0, 'named' => 0, 'failed' => 0, 'done' => true];
        $todo = [];
        $start = null;
        do {
            [$code, $raw] = self::http('GET', self::API . '/v2/bot/followers/ids?limit=1000' . ($start !== null ? '&start=' . rawurlencode($start) : ''), ['Authorization: Bearer ' . $tok], null);
            $j = $code === 200 ? json_decode($raw, true) : null;
            if (!is_array($j)) {
                throw new StoreError('invalid', "友だちの一覧を読めませんでした（{$code}）");
            }
            foreach ((array) ($j['userIds'] ?? []) as $uid) {
                if (is_string($uid) && preg_match('/^U[0-9a-f]{32}$/', $uid)) {
                    $res['followers']++;
                    $todo[] = $uid;
                }
            }
            $start = is_string($j['next'] ?? null) ? $j['next'] : null;
        } while ($start !== null);
        // 表示名がまだない人だけ、20人ずつまとめて問い合わせる
        $todo = array_values(array_filter($todo, function ($uid) use ($db) {
            $cur = $db->get('lineContact', $uid);
            return !is_array($cur) || empty($cur['displayName']);
        }));
        foreach (array_chunk($todo, 20) as $chunk) {
            if ($maxSeconds !== null && microtime(true) - $started > $maxSeconds) {
                $res['done'] = false;
                break;
            }
            $names = self::profileNames($chunk, $tok);
            $db->transaction(function () use ($db, $chunk, $names, &$res) {
                foreach ($chunk as $uid) {
                    $cur = $db->get('lineContact', $uid);
                    $cur = is_array($cur) ? $cur : ['userId' => $uid, 'firstAt' => now_iso(), 'lastAt' => '', 'lastType' => 'follower'];
                    $res['added'] += isset($cur['profileAt']) ? 0 : 1;
                    $cur['profileAt'] = now_iso();
                    if (isset($names[$uid])) {
                        $cur['displayName'] = $names[$uid];
                        $res['named']++;
                    } else {
                        $res['failed']++;
                    }
                    $db->put('lineContact', $uid, $cur);
                }
            });
        }
        return $res;
    }

    /** 何人かの表示名をまとめて問い合わせる（同時に送る。試験では $transport で1人ずつ） */
    private static function profileNames(array $uids, string $tok): array
    {
        $out = [];
        if (self::$transport !== null || !function_exists('curl_multi_init')) {
            foreach ($uids as $uid) {
                $n = self::profileName($uid);
                if ($n !== null) {
                    $out[$uid] = $n;
                }
            }
            return $out;
        }
        $mh = curl_multi_init();
        $hs = [];
        foreach ($uids as $uid) {
            $ch = curl_init(self::API . '/v2/bot/profile/' . $uid);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok], CURLOPT_TIMEOUT => 15]);
            curl_multi_add_handle($mh, $ch);
            $hs[$uid] = $ch;
        }
        do {
            $st = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $st === CURLM_OK);
        foreach ($hs as $uid => $ch) {
            $j = curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200 ? json_decode((string) curl_multi_getcontent($ch), true) : null;
            if (is_array($j) && is_string($j['displayName'] ?? null)) {
                $out[$uid] = mb_substr($j['displayName'], 0, 60);
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        return $out;
    }

    /** LINE のプロフィールの表示名（取れなければ null） */
    private static function profileName(string $uid): ?string
    {
        $tok = Reminder::lineToken();
        if ($tok === '' || (self::testMode() && self::$transport === null)) {
            return null;
        }
        [$code, $raw] = self::http('GET', self::API . '/v2/bot/profile/' . $uid, ['Authorization: Bearer ' . $tok], null);
        $j = $code === 200 ? json_decode($raw, true) : null;
        return is_array($j) && is_string($j['displayName'] ?? null) ? mb_substr($j['displayName'], 0, 60) : null;
    }

    /**
     * 予約申請フォーム（monshin/intake/）が送った申請の文面が LINE に届いたことを残す
     * （フォームは intake-status-v1.php でこれを確かめ、届かなければ別の方法を案内する）。
     * 予約申請IDつきの文面だけを、config の intake.queue_dir に残す。それ以外の発言は残さない
     */
    private static function noteIntakeMessage(array $e, string $text): void
    {
        $dir = rtrim((string) (config()['intake']['queue_dir'] ?? ''), '/');
        if ($dir === '' || !is_dir($dir) || !preg_match('/予約申請ID[：:]\s*(R[A-Za-z0-9_-]{8,127})/u', $text, $m)) {
            return;
        }
        $uid = (string) ($e['source']['userId'] ?? '');
        $eventId = preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($e['webhookEventId'] ?? $e['message']['id'] ?? bin2hex(random_bytes(8))));
        $event = ['eventId' => $eventId, 'type' => 'message', 'timestamp' => (int) ($e['timestamp'] ?? 0), 'source' => ['type' => 'user', 'userId' => $uid], 'message' => ['type' => 'text', 'text' => mb_substr($text, 0, 5000)]];
        $path = "{$dir}/line_{$eventId}.json";
        if (@file_put_contents($path, json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
            @chmod($path, 0600);
        }
        // 確認が済んだ古い印（2日より前）は消す
        foreach (glob("{$dir}/line_*.json") ?: [] as $f) {
            if (@filemtime($f) < time() - 2 * 86400) {
                @unlink($f);
            }
        }
        // 申請の記録に「LINE に届いた」印を付ける（申請した LINE と同じ人のときだけ）。新しい申請は DB、移行前はファイル
        if (Intake::markLineReceived($m[1], $uid, $eventId)) {
            return;
        }
        $rec = "{$dir}/intake-records/{$m[1]}.json";
        $fp = is_file($rec) ? @fopen($rec, 'c+') : false;
        if ($fp && flock($fp, LOCK_EX)) {
            $r = json_decode((string) stream_get_contents($fp), true);
            if (is_array($r) && $uid !== '' && hash_equals((string) ($r['source']['userId'] ?? ''), $uid) && empty($r['lineMessageReceivedAt'])) {
                $r['lineMessageReceivedAt'] = gmdate('c');
                $r['lineMessageEventId'] = $eventId;
                if (($r['status'] ?? '') === 'submitted') {
                    $r['status'] = 'line_message_received';
                }
                ftruncate($fp, 0);
                rewind($fp);
                fwrite($fp, (string) json_encode($r, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            }
            flock($fp, LOCK_UN);
        }
        if ($fp) {
            fclose($fp);
        }
    }

    /** 返す文（返さないときは null）。患者の情報は入れない */
    public static function replyFor(string $text): ?string
    {
        $url = self::liffUrl();
        if ($url === '') {
            return null;
        }
        $t = normalize_width($text);
        // 予約申請フォームの送信には自動で返さない（院長の指示。受付の連絡は LINE の応答メッセージとスタッフの返信で行う）
        // 「問診票」とだけ送られたとき
        if (preg_match('/^\s*問診票?\s*[。．!！]?\s*$/u', $t)) {
            return "問診票はこちらからご記入いただけます（ご予約確定後）。\n{$url}";
        }
        return null;
    }

    private static function reply(string $token, string $text): bool
    {
        $body = json_encode(['replyToken' => $token, 'messages' => [['type' => 'text', 'text' => mb_substr($text, 0, 4900)]]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (self::testMode()) {
            Db::i()->setMeta('lineTestOutbox', json_decode($body, true));
            return true;
        }
        $tok = Reminder::lineToken();
        if ($tok === '') {
            return false;
        }
        [$code] = self::http('POST', self::API . '/v2/bot/message/reply', ['Content-Type: application/json', 'Authorization: Bearer ' . $tok], $body);
        return $code === 200;
    }

    // ---- LIFF の問診票 ----

    /** この患者について、書かずに済む質問（質問id => 患者情報から入れる値） */
    private static function prefill(array $questions, array $p): array
    {
        $vals = [
            'name' => (string) ($p['name'] ?? ''),
            'kana' => (string) ($p['kana'] ?? ''),
            'birthDate' => !empty($p['birthDate']) ? str_replace('-', '/', (string) $p['birthDate']) : '',
            'phone' => (string) ($p['phone'] ?? ''),
        ];
        $out = [];
        foreach (self::PREFILL as $role) {
            $x = Monshin::findRole($questions, $role);
            if ($x && $vals[$role] !== '') {
                $out[$x['id']] = $vals[$role];
            }
        }
        $sex = ['female' => '女性', 'male' => '男性'][$p['sex'] ?? ''] ?? '';
        foreach ($questions as $x) {
            if ($sex !== '' && preg_match('/性別/u', $x['label']) && ($x['type'] !== 'choice' || in_array($sex, $x['options'], true))) {
                $out[$x['id']] = $sex;
            }
        }
        return $out;
    }

    /** 開いた人（LINE の利用者）の、問診票を書く予約の一覧と質問 */
    public static function context(string $sub): array
    {
        $form = Monshin::form();
        $items = [];
        foreach (Store::upcomingForLine($sub) as ['reservation' => $r, 'patient' => $p]) {
            $known = self::prefill($form['questions'], $p);
            $sent = Store::questionnaireForReservation($r['id']);
            // 下書き：送信済みならその回答、まだなら前回の問診票の回答（同じ見出しの質問に入れる。本人の LINE だけに見せる）
            $base = $sent ?? Store::latestQuestionnaireOf((string) $p['id']);
            $items[] = [
                'reservationId' => $r['id'],
                'startAt' => $r['startAt'],
                'name' => (string) $p['name'],
                'done' => $sent !== null,
                'answers' => (object) self::answersFor($form['questions'], $base, $known),
                'fromPrevious' => $sent === null && $base !== null,
                // 書かずに済む質問（画面では確認のために見せるだけ）
                'known' => array_map(fn($id, $v) => ['id' => $id, 'label' => self::labelOf($form['questions'], $id), 'value' => $v], array_keys($known), $known),
            ];
        }
        return ['title' => $form['title'], 'intro' => $form['intro'], 'done' => $form['done'], 'questions' => $form['questions'], 'items' => $items];
    }

    /** 前の回答を、いまの質問（id）ごとの値にする。いまの質問にない見出しや、書かずに済む質問は入れない */
    private static function answersFor(array $questions, ?array $q, array $known): array
    {
        if ($q === null) {
            return [];
        }
        $byLabel = [];
        foreach ($q['answers'] ?? [] as $a) {
            $byLabel[(string) $a['q']] = (string) $a['a'];
        }
        $out = [];
        foreach ($questions as $x) {
            $v = $byLabel[$x['label']] ?? null;
            if ($v === null || isset($known[$x['id']])) {
                continue;
            }
            if ($x['type'] === 'multi') {
                $out['q_' . $x['id']] = array_values(array_filter(explode('、', $v), fn($o) => in_array($o, $x['options'], true)));
            } elseif ($x['type'] === 'date') {
                $out['q_' . $x['id']] = str_replace('/', '-', $v);
            } elseif ($x['type'] !== 'choice' || in_array($v, $x['options'], true)) {
                $out['q_' . $x['id']] = $v;
            }
        }
        return $out;
    }

    private static function labelOf(array $qs, string $id): string
    {
        foreach ($qs as $x) {
            if ($x['id'] === $id) {
                return $x['label'];
            }
        }
        return '';
    }

    /** LIFF からの送信。誤りがあれば [質問id => 文]、保存できれば [] */
    public static function submit(string $sub, string $reservationId, array $post, ?int $now = null): array
    {
        $now ??= (int) floor(microtime(true) * 1000);
        $mine = null;
        foreach (Store::upcomingForLine($sub) as $c) {
            if ($c['reservation']['id'] === $reservationId) {
                $mine = $c;
            }
        }
        if ($mine === null) {
            throw new StoreError('not_found', 'この予約の問診票は見つかりません');
        }
        // 来院日までは直せる（前の回答は「修正で置き換え」として残す）
        $prev = Store::questionnaireForReservation($reservationId);
        $key = self::KEY . $reservationId . ($prev !== null ? '-' . intdiv($now, 1000) : '');
        $form = Monshin::form();
        $p = $mine['patient'];
        $known = self::prefill($form['questions'], $p);
        [$errors, $answers] = Monshin::validate($form['questions'], $post, $known);
        if ($errors) {
            return $errors;
        }
        // 書かずに済ませた質問も、患者情報の値で回答に残す（並びは質問どおり）
        $byLabel = [];
        foreach ($answers as $a) {
            $byLabel[$a['q']] = $a['a'];
        }
        $all = [];
        foreach ($form['questions'] as $x) {
            $v = $known[$x['id']] ?? ($byLabel[$x['label']] ?? null);
            if ($v !== null && $v !== '') {
                $all[] = ['q' => $x['label'], 'a' => $v];
            }
        }
        $get = function (string $role) use ($form, $all): string {
            $x = Monshin::findRole($form['questions'], $role);
            foreach ($all as $a) {
                if ($x && $a['q'] === $x['label']) {
                    return $a['a'];
                }
            }
            return '';
        };
        $r = ['key' => $key, 'submittedAt' => date('Y/m/d H:i:s', intdiv($now, 1000)), 'name' => (string) $p['name'], 'answers' => $all];
        foreach (['kana', 'phone', 'history', 'medications', 'allergies'] as $k) {
            if (($v = $get($k)) !== '') {
                $r[$k] = $v;
            }
        }
        if (!empty($p['birthDate'])) {
            $r['birthDate'] = (string) $p['birthDate'];
        }
        Db::i()->transaction(function () use ($sub, $now, $r, $key, $p, $prev) {
            Monshin::checkRate('line:' . $sub, $now);
            if ($prev !== null) {
                Store::replaceQuestionnaireByPatient((string) $prev['id']);
            }
            Store::receiveQuestionnaires([$r], [$key => $p['id']]);
        });
        return [];
    }
}
