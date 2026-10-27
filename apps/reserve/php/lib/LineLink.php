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
            $prof = self::profile($uid);
            if ($prof !== null) {
                $cur = self::withProfile($cur, $prof, self::pictureDhashes([$uid => $prof['picture']])[$uid] ?? '');
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
            return !is_array($cur) || empty($cur['displayName']) || !array_key_exists('pictureUrl', $cur);
        }));
        foreach (array_chunk($todo, 20) as $chunk) {
            if ($maxSeconds !== null && microtime(true) - $started > $maxSeconds) {
                $res['done'] = false;
                break;
            }
            $names = self::profileNames($chunk, $tok);
            $dh = self::pictureDhashes(array_filter(array_map(fn($p) => $p['picture'], $names)));
            $db->transaction(function () use ($db, $chunk, $names, $dh, &$res) {
                foreach ($chunk as $uid) {
                    $cur = $db->get('lineContact', $uid);
                    $cur = is_array($cur) ? $cur : ['userId' => $uid, 'firstAt' => now_iso(), 'lastAt' => '', 'lastType' => 'follower'];
                    $res['added'] += isset($cur['profileAt']) ? 0 : 1;
                    $cur['profileAt'] = now_iso();
                    if (isset($names[$uid])) {
                        $cur = self::withProfile($cur, $names[$uid], $dh[$uid] ?? '');
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

    /** プロフィールを「やりとりした LINE」に入れる（画像はアドレスと見た目の指紋。画像そのものは残さない） */
    private static function withProfile(array $cur, array $prof, string $dhash): array
    {
        unset($cur['pictureHash']);
        return [...$cur, 'displayName' => $prof['name'], 'pictureUrl' => $prof['picture'], 'pictureDhash' => $dhash];
    }

    /**
     * プロフィール画像の見た目の指紋（dHash：9×8 に縮めて、となりより明るいかの 64 ビットを16進で）。
     * 画像のアドレスは表示する場所ごとに変わるが、見た目は同じなので、管理画面の画像と見比べられる
     * （同じ写真なら大きさが違っても 0〜4、別の人は 26 以上離れる。拡張機能の background.js と同じ計算）
     */
    public static function dhash(string $bytes): ?string
    {
        $im = @imagecreatefromstring($bytes);
        if ($im === false) {
            return null;
        }
        $mid = imagecreatetruecolor(64, 64);
        imagecopyresampled($mid, $im, 0, 0, 0, 0, 64, 64, imagesx($im), imagesy($im));
        $small = imagecreatetruecolor(9, 8);
        imagecopyresampled($small, $mid, 0, 0, 0, 0, 9, 8, 64, 64);
        $hex = '';
        for ($y = 0; $y < 8; $y++) {
            $row = [];
            for ($x = 0; $x < 9; $x++) {
                $c = imagecolorat($small, $x, $y);
                $row[] = 0.299 * (($c >> 16) & 255) + 0.587 * (($c >> 8) & 255) + 0.114 * ($c & 255);
            }
            $bits = 0;
            for ($x = 0; $x < 8; $x++) {
                $bits = ($bits << 1) | ($row[$x] < $row[$x + 1] ? 1 : 0);
            }
            $hex .= sprintf('%02x', $bits);
        }
        return $hex;
    }

    /** 2つの指紋の違うビットの数 */
    private static function hamming(string $a, string $b): int
    {
        $n = 0;
        for ($i = 0; $i < 16; $i += 2) {
            $n += substr_count(decbin(hexdec(substr($a, $i, 2)) ^ hexdec(substr($b, $i, 2))), '1');
        }
        return $n;
    }

    /** 見た目の指紋が近い人（10 ビット以内）を近い順に */
    private static function nearByPicture(array $all, string $dh): array
    {
        $near = [];
        foreach ($all as $uid => $c) {
            if (is_array($c) && strlen((string) ($c['pictureDhash'] ?? '')) === 16) {
                $d = self::hamming($dh, (string) $c['pictureDhash']);
                if ($d <= 10) {
                    $near[(string) $uid] = $d;
                }
            }
        }
        asort($near);
        return $near;
    }

    /** 何人かのプロフィール画像（小さい版）を同時に読み、見た目の指紋にする */
    private static function pictureDhashes(array $urls): array
    {
        $out = [];
        if (self::$transport !== null || !function_exists('curl_multi_init')) {
            foreach ($urls as $k => $u) {
                [$code, $raw] = $u !== '' ? self::http('GET', $u . '/small', [], null) : [0, ''];
                $h = $code === 200 ? self::dhash($raw) : null;
                if ($h !== null) {
                    $out[$k] = $h;
                }
            }
            return $out;
        }
        $mh = curl_multi_init();
        $hs = [];
        foreach ($urls as $k => $u) {
            if ($u === '') {
                continue;
            }
            $ch = curl_init($u . '/small');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_FOLLOWLOCATION => true]);
            curl_multi_add_handle($mh, $ch);
            $hs[$k] = $ch;
        }
        do {
            $st = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 1.0);
            }
        } while ($running && $st === CURLM_OK);
        foreach ($hs as $k => $ch) {
            $h = curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200 ? self::dhash((string) curl_multi_getcontent($ch)) : null;
            if ($h !== null) {
                $out[$k] = $h;
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        return $out;
    }

    /** 何人かの表示名をまとめて問い合わせる（同時に送る。試験では $transport で1人ずつ） */
    private static function profileNames(array $uids, string $tok): array
    {
        $out = [];
        if (self::$transport !== null || !function_exists('curl_multi_init')) {
            foreach ($uids as $uid) {
                $n = self::profile($uid);
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
            $prof = self::profileOf($j);
            if ($prof !== null) {
                $out[$uid] = $prof;
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        return $out;
    }

    /**
     * 管理画面（chat.line.biz）でその人のチャットを開く先。LINE は「送る宛先（利用者ID）」と「管理画面のチャットID」を別々に付け、
     * 対応を API で教えないため、対応表（lineContact の chatId）にある人は直接、ない人はチャット一覧を開く。
     * 公式アカウントの番号（URL の前半）は meta lineChatAccount
     */
    public static function chatInfo(string $uid): array
    {
        $db = Db::i();
        $c = $db->get('lineContact', $uid);
        $acct = (string) ($db->meta('lineChatAccount') ?? '');
        $list = $acct !== '' ? "https://chat.line.biz/{$acct}" : 'https://chat.line.biz/';
        $chat = is_array($c) && !empty($c['chatId']) && $acct !== '' ? "{$list}/chat/{$c['chatId']}" : null;
        return ['displayName' => is_array($c) ? (string) ($c['displayName'] ?? '') : '', 'chatUrl' => $chat, 'listUrl' => $list];
    }

    /**
     * 管理画面で開いたチャットを、LINE の利用者に結びつける（Chrome 拡張の「LINE チャット連携」から）。
     * 手がかりの強い順：トークに出ている予約申請ID → プロフィール画像の見た目（dHash）→ 表示名（同じ人が1人だけのとき）。
     * 申請IDが別々の人を指す・画像が合わないときは結びつけない。見出しの名前（院で付けた名前のことがある）は検索用に残す
     */
    public static function learnChat(array $in): array
    {
        $acct = (string) ($in['account'] ?? '');
        $chatId = (string) ($in['chatId'] ?? '');
        if (!preg_match('/^U[0-9a-f]{32}$/i', $acct) || !preg_match('/^U[0-9a-f]{32}$/i', $chatId)) {
            return ['ok' => false, 'reason' => 'invalid'];
        }
        $db = Db::i();
        $known = (string) ($db->meta('lineChatAccount') ?? '');
        if ($known === '') {
            $db->setMeta('lineChatAccount', $acct);
        } elseif (strcasecmp($known, $acct) !== 0) {
            return ['ok' => false, 'reason' => 'other_account'];
        }
        $name = trim(mb_substr((string) ($in['name'] ?? ''), 0, 60));
        $icon = preg_match('/^[0-9a-f]{16}$/', (string) ($in['iconDhash'] ?? '')) ? (string) $in['iconDhash'] : '';
        // 開いたチャットは、だれか決まらなくても残す（あとでスタッフがチャットの URL を貼って手動で連携するときに使う）
        $seen = $db->get('lineChat', $chatId);
        $db->put('lineChat', $chatId, [...(is_array($seen) ? $seen : []), 'chatId' => $chatId, 'name' => $name, 'iconDhash' => $icon, 'at' => now_iso()]);
        $all = $db->all('lineContact');
        $uid = null;
        $how = '';
        $uids = [];
        foreach (array_slice((array) ($in['requestIds'] ?? []), 0, 10) as $rid) {
            $rec = is_string($rid) && preg_match('/^R\d{14}[0-9A-F]{8}$/i', $rid) ? Intake::record(strtoupper($rid)) : null;
            $u = is_array($rec) ? (string) ($rec['source']['userId'] ?? '') : '';
            if (preg_match('/^U[0-9a-f]{32}$/', $u)) {
                $uids[$u] = true;
            }
        }
        if (count($uids) > 1) {
            return ['ok' => false, 'reason' => 'ambiguous'];
        }
        if ($uids) {
            [$uid, $how] = [array_key_first($uids), 'request'];
        } elseif ($icon !== '') {
            // いちばん近い人が、2番目よりはっきり近いときだけ（似た写真の人を取り違えないように）
            $near = self::nearByPicture($all, $icon);
            $ds = array_values($near);
            if ($ds && (count($ds) === 1 || $ds[1] >= $ds[0] + 8)) {
                [$uid, $how] = [(string) array_key_first($near), 'picture'];
            }
        }
        if ($uid === null && $name !== '') {
            $key = search_key($name);
            $hit = array_keys(array_filter($all, fn($c) => is_array($c) && !empty($c['displayName']) && search_key((string) $c['displayName']) === $key));
            if (count($hit) === 1) {
                [$uid, $how] = [(string) $hit[0], 'name'];
            }
        }
        if ($uid === null) {
            return ['ok' => false, 'reason' => 'not_found'];
        }
        $cur = is_array($all[$uid] ?? null) ? $all[$uid] : ['userId' => $uid, 'firstAt' => now_iso(), 'lastAt' => '', 'lastType' => 'follower'];
        if ($how !== 'picture' && $icon !== '' && strlen((string) ($cur['pictureDhash'] ?? '')) === 16 && self::hamming($icon, (string) $cur['pictureDhash']) > 16) {
            return ['ok' => false, 'reason' => 'picture_mismatch'];
        }
        self::bindChat($uid, $chatId, $name);
        return ['ok' => true, 'how' => $how];
    }

    /** LINE の利用者と管理画面のチャットを結びつける（1つのチャットは1人。別の人に付いていれば外す） */
    public static function bindChat(string $uid, string $chatId, string $name = ''): void
    {
        $db = Db::i();
        $db->transaction(function () use ($db, $uid, $chatId, $name) {
            foreach ($db->all('lineContact') as $other => $c) {
                if ($other !== $uid && is_array($c) && strcasecmp((string) ($c['chatId'] ?? ''), $chatId) === 0) {
                    unset($c['chatId'], $c['chatName']);
                    $db->put('lineContact', (string) $other, $c);
                }
            }
            $cur = $db->get('lineContact', $uid);
            $cur = is_array($cur) ? $cur : ['userId' => $uid, 'firstAt' => now_iso(), 'lastAt' => '', 'lastType' => 'follower'];
            $seen = $db->get('lineChat', $chatId);
            $name = $name !== '' ? $name : (is_array($seen) ? (string) ($seen['name'] ?? '') : '');
            $db->put('lineContact', $uid, [...$cur, 'chatId' => $chatId, 'chatName' => $name !== '' ? $name : ($cur['chatName'] ?? ''), 'chatAt' => now_iso()]);
            if (is_array($seen)) {
                $db->put('lineChat', $chatId, [...$seen, 'userId' => $uid]);
            }
        });
    }

    /** 一覧から選んで手動で連携したとき：拡張機能が見たまま決まっていなかったチャットのうち、プロフィール画像が同じものが1つだけならつなぐ */
    public static function bindSeenChat(string $uid): bool
    {
        $db = Db::i();
        $c = $db->get('lineContact', $uid);
        $pic = is_array($c) ? (string) ($c['pictureDhash'] ?? '') : '';
        if (strlen($pic) !== 16 || !empty($c['chatId'])) {
            return false;
        }
        $hit = array_keys(array_filter($db->all('lineChat'), fn($ch) => is_array($ch) && empty($ch['userId']) && strlen((string) ($ch['iconDhash'] ?? '')) === 16 && self::hamming($pic, (string) $ch['iconDhash']) <= 10));
        if (count($hit) !== 1) {
            return false;
        }
        self::bindChat($uid, (string) $hit[0]);
        return true;
    }

    /**
     * 管理画面のチャットの URL（…/chat/U…）から、手動連携の候補を探す。拡張機能が見たチャットなら、結びついた人、
     * または同じプロフィール画像・同じ表示名の人。見ていないチャットは空（そのチャットを一度開けば出る）
     */
    public static function candidatesForChat(string $chatId): array
    {
        $db = Db::i();
        $seen = $db->get('lineChat', $chatId);
        if (!is_array($seen)) {
            return [];
        }
        if (!empty($seen['userId'])) {
            return [(string) $seen['userId']];
        }
        $all = $db->all('lineContact');
        $icon = (string) ($seen['iconDhash'] ?? '');
        $hit = strlen($icon) === 16 ? array_keys(self::nearByPicture($all, $icon)) : [];
        if (!$hit && ($seen['name'] ?? '') !== '') {
            $key = search_key((string) $seen['name']);
            $hit = array_keys(array_filter($all, fn($c) => is_array($c) && !empty($c['displayName']) && search_key((string) $c['displayName']) === $key));
        }
        return array_map('strval', array_slice($hit, 0, 20));
    }

    /** LINE のプロフィール：表示名と画像のアドレス。取れなければ null */
    private static function profile(string $uid): ?array
    {
        $tok = Reminder::lineToken();
        if ($tok === '' || (self::testMode() && self::$transport === null)) {
            return null;
        }
        [$code, $raw] = self::http('GET', self::API . '/v2/bot/profile/' . $uid, ['Authorization: Bearer ' . $tok], null);
        return self::profileOf($code === 200 ? json_decode($raw, true) : null);
    }

    private static function profileOf(mixed $j): ?array
    {
        if (!is_array($j) || !is_string($j['displayName'] ?? null)) {
            return null;
        }
        $pic = preg_match('#^https://s?profile\.line-scdn\.net/[A-Za-z0-9_-]{10,200}$#', (string) ($j['pictureUrl'] ?? '')) ? (string) $j['pictureUrl'] : '';
        return ['name' => mb_substr($j['displayName'], 0, 60), 'picture' => $pic];
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
