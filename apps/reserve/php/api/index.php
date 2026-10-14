<?php
/**
 * API の入口。/reserve/api/v1/... へのアクセスは .htaccess でここに集まる。
 * URL とメソッドで処理を振り分ける（Node.js 版の src/app/api/v1 と同じ）。
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

const STAFF_ADMIN = ['admin'];

try {
    $uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $pos = strpos($uri, '/api/v1/');
    if ($pos === false) {
        Http::json(['error' => 'not_found', 'message' => '見つかりません'], 404);
    }
    $path = array_map('rawurldecode', explode('/', trim(substr($uri, $pos + 8), '/')));
    $method = Http::method();
    $q = fn(string $k) => isset($_GET[$k]) && is_string($_GET[$k]) ? $_GET[$k] : null;
    $me = fn(?array $roles = null) => Auth::requireStaff($roles);
    $manager = fn() => Auth::requireManager();
    $actor = fn(array $s) => Auth::actorOf($s);

    $route = $method . ' ' . implode('/', array_map(fn($p) => preg_match('/^[A-Za-z0-9_-]{1,64}$/', $p) ? $p : '?', $path));
    $p = $path;
    $n = count($p);

    // ---- 変更の操作は、このサイトの画面から送られたものだけ受け付ける（CSRF の多重防御。外部連携は別のトークン認証） ----
    if (!in_array($method, ['GET', 'HEAD'], true) && ($p[0] ?? '') !== 'integration' && Http::crossSiteWrite()) {
        Http::json(['error' => 'forbidden', 'message' => 'この操作は受け付けられません'], 403);
    }

    // ---- 動作確認（設置直後の確認用。中身は返さない） ----
    if ($route === 'GET health') {
        Db::i()->count('lane');
        Http::json(['ok' => true]);
    }

    // ---- ログイン ----
    if ($route === 'GET auth/staff') {
        Http::json(['items' => array_map(fn($s) => ['id' => $s['id'], 'name' => $s['name'], 'role' => $s['role']], Auth::listStaff())]);
    }
    if ($route === 'POST auth/login') {
        $in = Schema::login(Http::readJson());
        // 端末を見分ける Cookie（なければここで渡す。断るときにも渡すよう、先に出しておく）
        foreach (Devices::ensureCookie() as $hdr) {
            header($hdr, false);
        }
        // 同じ接続元からの失敗が多すぎれば、PINを確かめる前に断る
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        Auth::checkLoginRate($ip);
        try {
            $r = Auth::verifyPin($in['staffId'], $in['pin']);
        } catch (AuthError $e) {
            Auth::noteLoginFailure($ip);
            throw $e;
        }
        // 登録した端末だけで使う設定なら、未承認の端末は承認待ちに入れて断る
        Devices::checkAtLogin($r['staff']);
        // 二要素認証が要るときは、まだログインさせずに確認券を返す
        $two = Auth::afterPin($r['staff'], $r['sessionVersion']);
        if (empty($two['done'])) {
            Http::json($two);
        }
        Auth::audit(['id' => $r['staff']['id'], 'name' => $r['staff']['name']], 'ログイン');
        Http::json($r['staff'], 200, ['Set-Cookie: ' . Auth::sessionCookie(Auth::createSessionToken($r['staff']['id'], $r['sessionVersion']))]);
    }
    if ($route === 'POST auth/login/2fa') {
        $in = Http::readJson();
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        Auth::checkLoginRate($ip);
        try {
            $r = Auth::verifySecondFactor(V::str($in['ticket'] ?? '', 1000), V::str($in['code'] ?? '', 20));
        } catch (AuthError $e) {
            Auth::noteLoginFailure($ip);
            throw $e;
        }
        Devices::checkAtLogin($r['staff']);
        Auth::audit(['id' => $r['staff']['id'], 'name' => $r['staff']['name']], 'ログイン（二要素認証）');
        Http::json($r['staff'], 200, ['Set-Cookie: ' . Auth::sessionCookie(Auth::createSessionToken($r['staff']['id'], $r['sessionVersion']))]);
    }
    // 二要素認証を必須にするか（院長・管理者）
    if ($route === 'GET security') {
        $me(STAFF_ADMIN);
        Http::json(['require2fa' => TwoFactor::required(), 'requireDevice' => Devices::required()]);
    }
    if ($route === 'POST security') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        $out = [];
        if (is_array($in) && array_key_exists('require2fa', $in)) {
            $out += TwoFactor::setRequired(!empty($in['require2fa']), $actor($s));
        }
        if (is_array($in) && array_key_exists('requireDevice', $in)) {
            $out += Devices::setRequired(!empty($in['requireDevice']), $actor($s));
        }
        Http::json(['require2fa' => TwoFactor::required(), 'requireDevice' => Devices::required()] + $out);
    }
    // 登録した端末（院長・管理者）
    if ($route === 'GET devices') {
        $me(STAFF_ADMIN);
        Http::json(['items' => Devices::list()]);
    }
    if ($method === 'POST' && $n === 3 && $p[0] === 'devices' && preg_match('/^[0-9a-f]{64}$/', $p[1])) {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        $status = ['approve' => 'approved', 'block' => 'blocked', 'pending' => 'pending', 'delete' => 'delete'][$p[2]] ?? '';
        if ($status === '') {
            throw new InputError();
        }
        Http::json(Devices::setStatus($p[1], $status, $actor($s), is_array($in) && is_string($in['label'] ?? null) ? $in['label'] : null));
    }
    if ($method === 'POST' && $n === 3 && $p[0] === 'staff' && $p[2] === 'reset-2fa') {
        $s = $me(STAFF_ADMIN);
        Http::json(Auth::resetSecondFactor($actor($s), V::id($p[1])));
    }
    if ($route === 'POST auth/logout') {
        $s = Auth::currentStaff();
        if ($s) {
            Auth::audit(Auth::actorOf($s), 'ログアウト');
            Auth::revokeSessionToken(Auth::sessionToken());
        }
        Http::noContent(['Set-Cookie: ' . Auth::clearSessionCookie()]);
    }
    if ($route === 'GET auth/me') {
        Http::json($me());
    }

    // ---- 外部連携（スタッフのログインではなく連携トークンで確認） ----
    if ($route === 'POST integration/reminders/run') {
        Http::checkIntegrationAuth();
        Http::json(Reminder::tick(true));
    }
    if ($p[0] === 'integration' && ($p[1] ?? '') === 'reminders') {
        Http::checkIntegrationAuth();
        if ($method === 'GET' && $n === 2) {
            Http::json(Store::reminderFeed(V::date($q('date'))));
        }
        if ($method === 'POST' && $n === 3) {
            $id = V::id($p[2]);
            $status = Schema::reminderResult(Http::readJson())['status'];
            $r = Store::setReminderStatus($id, $status);
            Http::json(['reservationId' => $r['id'], 'reminder' => $r['reminder']]);
        }
    }

    if ($p[0] === 'integration' && $method === 'POST' && $n === 4 && $p[1] === 'reservations' && $p[3] === 'request-id') {
        Http::checkIntegrationAuth();
        $r = Store::setReservationRequestId(V::id($p[2]), Schema::integrationRequestId(Http::readJson()));
        Http::json(['reservationId' => $r['id'], 'requestId' => $r['requestId'] ?? null, 'version' => $r['version']]);
    }
    if ($p[0] === 'integration' && $method === 'POST' && $n === 2 && $p[1] === 'consent-templates') {
        Http::checkIntegrationAuth();
        Http::json(Store::receiveConsentTemplates(Schema::integrationConsentTemplates(Http::readJson(20_000_000))));
    }
    if ($p[0] === 'integration' && $method === 'POST' && $n === 2 && $p[1] === 'questionnaires') {
        Http::checkIntegrationAuth();
        // 過去の回答をまとめて受け取るときは時間がかかるので、許されていれば時間の上限を延ばす
        @set_time_limit(120);
        Http::json(Store::receiveQuestionnaires(Schema::integrationQuestionnaires(Http::readJson(2_000_000))['responses']));
    }
    // 機器の連携（院のパソコンの取り込み係から。鍵は設定 → 外部機器の連携 で発行）
    if ($p[0] === 'integration' && ($p[1] ?? '') === 'photos') {
        $link = Http::deviceLink();
        if ($method === 'GET' && $n === 3 && $p[2] === 'ping') {
            // 取り込み方（光源・縮小）も返す。取り込み係は毎回これに従う
            Http::json(['ok' => true, 'name' => $link['name'], 'source' => $link['source'], 'options' => Store::deviceOptionsOf($link)]);
        }
        if ($method === 'POST' && $n === 2) {
            $name = (string) ($q('name') ?? '');
            $file = (string) ($q('file') ?? '');
            $in = ['patientName' => mb_check_encoding($name, 'UTF-8') ? $name : '', 'fileName' => mb_check_encoding($file, 'UTF-8') ? $file : ''];
            if ($q('takenAt') !== null) {
                $in['takenAt'] = $q('takenAt');
            }
            if ($q('ref') !== null) {
                $in['ref'] = $q('ref');
            }
            $in['bytes'] = Http::readBytes(Store::MAX_FILE_BYTES);
            Http::json(Store::receiveDevicePhoto($link, $in));
        }
    }
    if ($p[0] === 'integration' && $method === 'POST' && $n === 2 && $p[1] === 'prices') {
        Http::checkIntegrationAuth();
        $in = Schema::integrationPrices(Http::readJson(262_144));
        Http::json(Store::receiveSheetPrices($in['sheet'], $in['items']));
    }
    if ($p[0] === 'integration' && $method === 'POST' && $n === 4 && $p[1] === 'patients' && $p[3] === 'm3-chart-no') {
        Http::checkIntegrationAuth();
        $pt = Store::setPatientM3ChartNo(V::id($p[2]), Schema::integrationM3(Http::readJson()));
        Http::json(['patientId' => $pt['id'], 'm3ChartNo' => $pt['m3ChartNo'] ?? null, 'version' => $pt['version']]);
    }

    // ---- カレンダー・設定 ----
    if ($route === 'GET day') {
        $me();
        Http::json(Store::getDayBundle(V::date($q('date'))));
    }
    // ---- 受付メモ（日付×患者。スタッフ全員） ----
    if ($p[0] === 'reception-notes' && $n === 3 && $method === 'PUT') {
        $s = $me();
        $in = Http::readJson(65_536);
        Http::json(Store::setReceptionNote(V::date($p[1]), V::id($p[2]), V::str(is_array($in) ? ($in['text'] ?? null) : null, 8000), $actor($s)));
    }

    // ---- Todaysメモ（日付×レーン。スタッフ全員） ----
    if ($p[0] === 'day-notes' && $n >= 2) {
        if ($method === 'GET' && $n === 2) {
            $me();
            Http::json(Store::getDayNotes(V::date($p[1])));
        }
        if ($method === 'PUT' && $n === 3) {
            $s = $me();
            $in = Http::readJson();
            Http::json(Store::setDayNote(V::date($p[1]), V::id($p[2]), V::str(is_array($in) ? ($in['text'] ?? null) : null, 2000), $actor($s)));
        }
    }
    if ($route === 'GET month') {
        $me();
        $month = $q('month');
        if (!is_string($month) || !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month)) {
            throw new InputError();
        }
        $days = Store::monthCounts($month);
        Http::json(['month' => $month, 'days' => $days ?: new stdClass()]);
    }
    if ($route === 'PATCH clinic') {
        $s = $manager();
        Http::json(Store::updateClinic(Schema::clinic(Http::readJson()), $actor($s)));
    }
    if ($route === 'GET settings/restore') {
        $me(STAFF_ADMIN);
        Http::json(Store::listRestorePoints());
    }
    if ($route === 'POST settings/restore') {
        $s = $me(STAFF_ADMIN);
        $key = V::shape(Http::readJson(), ['key' => fn($x) => V::enum($x, ['1d', '1w', '1m', '3m', '6m', '1y'])])['key'];
        Store::restoreSettings($key, $actor($s));
        Http::json(Store::listRestorePoints());
    }
    if ($route === 'GET settings') {
        $me();
        Http::json(Store::getSettings());
    }

    // ---- 予約 ----
    if ($route === 'POST reservations') {
        $s = $me();
        Http::json(Store::createReservation(Schema::createReservation(Http::readJson(65_536)), $actor($s)), 201);
    }
    // リマインドを今すぐ送る（その予約の来院へ）
    if ($method === 'POST' && $n === 3 && $p[0] === 'reservations' && $p[2] === 'remind') {
        $s = $me();
        Http::json(Reminder::sendNow(V::id($p[1]), $actor($s)));
    }
    // 予約の申請で見つかった LINE を患者に紐付ける（スタッフが確かめて押す）
    if ($method === 'POST' && $n === 3 && $p[0] === 'reservations' && $p[2] === 'link-line') {
        $s = $me();
        Http::json(Store::linkPatientLineFromReservation(V::id($p[1]), $actor($s)));
    }
    // Airリザーブの取り込みで付いた「要確認」の印を外す
    if ($method === 'POST' && $n === 3 && $p[0] === 'patients' && $p[2] === 'reviewed') {
        $s = $me();
        Http::json(Store::clearPatientReview(V::id($p[1]), $actor($s)));
    }
    if ($method === 'PATCH' && $n === 2 && $p[0] === 'reservations') {
        $s = $me();
        $id = V::id($p[1]);
        Http::json(Store::updateReservation($id, Schema::updateReservation(Http::readJson(65_536)), $actor($s)));
    }

    // ---- 患者 ----
    if ($route === 'GET patients') {
        $me();
        Http::json(['items' => Store::searchPatients(mb_substr($q('q') ?? '', 0, 50))]);
    }
    if ($route === 'POST patients') {
        $s = $me();
        Http::json(Store::createPatient(Schema::createPatient(Http::readJson(65_536)), $actor($s)), 201);
    }
    if ($route === 'GET patients/merge') {
        $manager();
        Http::json(Store::previewMerge(V::id($q('keep')), V::id($q('dup'))));
    }
    if ($route === 'POST patients/merge') {
        $s = $manager();
        $keep = Store::mergePatients(Schema::mergePatients(Http::readJson()), $actor($s));
        Http::json(Store::getPatientDetail($keep['id']));
    }
    if ($p[0] === 'patients' && $n >= 2 && $p[1] !== 'merge') {
        if ($method === 'GET' && $n === 2) {
            $s = $me();
            $d = Store::getPatientDetail(V::id($p[1]));
            Auth::noteAccess($s, '患者を表示', 'patient:' . $p[1]);
            Http::json($d);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me();
            $id = V::id($p[1]);
            Store::updatePatient($id, Schema::updatePatient(Http::readJson(65_536)), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'unlink-line') {
            $s = $me();
            $id = V::id($p[1]);
            Store::unlinkPatientLine($id, Schema::versionOnly(Http::readJson()), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deletePatient($id, Schema::deletePatient(Http::readJson()), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'restore') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::restorePatient($id, Schema::versionOnly(Http::readJson()), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'unmerge') {
            $s = $manager();
            $id = V::id($p[1]);
            $r = Store::unmergePatient($id, Schema::versionOnly(Http::readJson()), $actor($s));
            Http::json([...Store::getPatientDetail($id), 'unmerge' => ['counts' => $r['counts'], 'notes' => $r['notes']]]);
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'files') {
            $me();
            $date = $q('date');
            Http::json(['items' => Store::listFiles(V::id($p[1]), $date === null ? null : V::date($date))]);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'files') {
            $s = $me();
            $id = V::id($p[1]);
            $rid = $q('reservationId');
            $name = rawurldecode((string) ($_SERVER['HTTP_X_FILE_NAME'] ?? ''));
            if (!mb_check_encoding($name, 'UTF-8')) {
                $name = '';
            }
            $bytes = Http::readBytes(Store::MAX_FILE_BYTES);
            Http::json(Store::saveFile($id, [
                'date' => V::date($q('date')),
                'reservationId' => $rid ? V::id($rid) : null,
                'name' => $name,
                'bytes' => $bytes,
            ], $actor($s)), 201);
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'consents') {
            $me();
            Http::json(['items' => Store::listConsents(V::id($p[1]))]);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'consents') {
            $s = $me();
            $in = Schema::createConsent(Http::readJson(500_000));
            // 発行する直前にドライブの最新を読み、その文面を控えに残す
            Store::loadConsentTemplate($in['templateId']);
            Http::json(Store::createConsent(V::id($p[1]), $in, $actor($s)), 201);
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'questionnaires') {
            $me();
            Http::json(['items' => Store::listQuestionnaires(V::id($p[1]))]);
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'charts') {
            $me();
            Http::json(['items' => Store::listCharts(V::id($p[1]))]);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'charts') {
            $s = $me();
            Http::json(Store::createChart(V::id($p[1]), Schema::createChart(Http::readJson(65_536)), $actor($s)), 201);
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'estimates') {
            $me();
            Http::json(['items' => Store::listEstimates(V::id($p[1]))]);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'estimates') {
            $s = $me();
            Http::json(Store::createEstimate(V::id($p[1]), Schema::createEstimate(Http::readJson(65_536)), $actor($s)), 201);
        }
        if ($method === 'PUT' && $n === 4 && $p[2] === 'visits') {
            $s = $me();
            $id = V::id($p[1]);
            Store::saveVisitNote($id, V::date($p[3]), Schema::visitNote(Http::readJson(65_536)), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
    }

    // ---- レーン・メニュー（院長・管理者と受付） ----
    foreach (['lanes', 'menus'] as $kind) {
        if ($p[0] !== $kind) {
            continue;
        }
        if ($method === 'POST' && $n === 1) {
            $s = $manager();
            $in = Http::readJson();
            Http::json($kind === 'lanes' ? Store::createLane(Schema::lane($in), $actor($s)) : Store::createMenu(Schema::menu($in), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $manager();
            $ids = Schema::reorder(Http::readJson());
            Http::json(['items' => $kind === 'lanes' ? Store::reorderLanes($ids, $actor($s)) : Store::reorderMenus($ids, $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $manager();
            $id = V::id($p[1]);
            $in = Http::readJson();
            Http::json($kind === 'lanes' ? Store::updateLane($id, Schema::lane($in), $actor($s)) : Store::updateMenu($id, Schema::menu($in), $actor($s)));
        }
        if ($method === 'DELETE' && $n === 2) {
            $s = $manager();
            $kind === 'lanes' ? Store::deleteLane(V::id($p[1]), $actor($s)) : Store::deleteMenu(V::id($p[1]), $actor($s));
            Http::noContent();
        }
    }

    // ---- ファイル ----
    if ($p[0] === 'files' && $n >= 2) {
        if ($method === 'GET' && $n === 2) {
            $s = $me();
            $thumb = ($_GET['size'] ?? '') === 'thumb';
            [$meta, $bytes] = $thumb ? Store::getFileThumb(V::id($p[1])) : Store::getFile(V::id($p[1]));
            if (!$thumb) {
                Auth::noteAccess($s, 'ファイルを表示', 'file:' . $p[1]);
            }
            Http::file($meta, $bytes);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me();
            $f = Store::deleteFile(V::id($p[1]), $actor($s));
            Http::json(['id' => $f['id'], 'deleted' => true]);
        }
    }

    // ---- 結びついている問診票を、患者の空いている欄へ写し直す（院長・管理者） ----
    if ($route === 'POST questionnaires/refill') {
        $s = $me(STAFF_ADMIN);
        Http::json(Store::refillFromQuestionnaires($actor($s)));
    }

    // ---- M3 の患者一覧との照合（院長・管理者）。CSV はブラウザの中だけで読み、照合できた分だけ届く ----
    // ---- リマインドの設定（院長・管理者） ----
    if ($route === 'GET admin/reminders') {
        $me(STAFF_ADMIN);
        Http::json(Reminder::publicSettings());
    }
    if ($route === 'PUT admin/reminders') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson(20_000);
        if (!is_array($in)) {
            Http::json(['error' => 'invalid', 'message' => '設定を読み込めませんでした'], 400);
        }
        Http::json(Reminder::updateSettings($in, $actor($s)));
    }
    if ($route === 'GET admin/reminders/preview') {
        $me(STAFF_ADMIN);
        Http::json(Reminder::preview(V::date($q('date'))));
    }
    if ($route === 'POST admin/reminders/run') {
        $me(STAFF_ADMIN);
        Http::json(Reminder::tick(true));
    }

    // ---- Airリザーブの予約の取り込み（院長・管理者） ----
    if ($route === 'GET admin/air-sync') {
        $me(STAFF_ADMIN);
        Http::json(AirSync::publicSettings());
    }
    if ($route === 'PUT admin/air-sync') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson(4_000);
        if (!is_array($in)) {
            Http::json(['error' => 'invalid', 'message' => '設定を読み込めませんでした'], 400);
        }
        Http::json(AirSync::updateSettings($in, $actor($s)));
    }
    if ($route === 'POST admin/air-sync/run') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        $date = is_array($in) && is_string($in['date'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $in['date']) ? $in['date'] : (new DateTimeImmutable(now_in_clinic()['date'], jst()))->modify('+1 day')->format('Y-m-d');
        $r = AirSync::run($date);
        Auth::audit($actor($s), "Airリザーブの予約を手動で取り込み（{$date}・{$r['count']}件）");
        Http::json($r);
    }

    if ($route === 'POST admin/air-sync/compare') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        $r = AirSync::compare((string) ($in['from'] ?? ''), (string) ($in['to'] ?? ''));
        Auth::noteAccess($s, 'Airリザーブとカレンダーの予約を見比べ', 'air-compare:' . $r['from'] . '..' . $r['to']);
        Http::json($r);
    }

    // ---- LINE 予約フォームの申請の受付箱（スタッフ） ----
    if ($route === 'GET intake') {
        $s = $me();
        $r = Intake::list((int) ($_GET['days'] ?? 30));
        Auth::noteAccess($s, '予約申請の受付箱を表示', 'intake:' . count($r['items']));
        Http::json($r);
    }
    if ($method === 'POST' && $n === 3 && $p[0] === 'intake' && $p[2] === 'mark') {
        $s = $me();
        $in = Http::readJson();
        $action = is_array($in) && in_array($in['action'] ?? null, ['done', 'skip'], true) ? $in['action'] : null;
        Http::json(Intake::mark((string) $p[1], $action, $actor($s)));
    }

    if ($route === 'GET admin/m3-fill') {
        $s = $me(STAFF_ADMIN);
        $items = Store::m3FillCandidates();
        Auth::noteAccess($s, 'M3照合のため氏名がカタカナの患者を表示', 'patients:' . count($items));
        Http::json(['items' => $items]);
    }
    if ($route === 'POST admin/m3-fill') {
        $s = $me(STAFF_ADMIN);
        set_time_limit(300);
        $in = Http::readJson(300_000); // 照合できた患者の分を、画面から 200 名ずつ送ってくる
        if (!is_array($in) || ($in['confirm'] ?? null) !== 'APPLY' || !is_array($in['items'] ?? null) || count($in['items']) > 1000) {
            Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"APPLY","items":[…]} を送ってください'], 400);
        }
        $str = fn($v, int $max) => is_string($v) && mb_strlen($v) <= $max ? $v : null;
        $items = [];
        foreach ($in['items'] as $x) {
            $id = $str($x['id'] ?? null, 64);
            $name = $str($x['name'] ?? null, 60);
            if ($id === null || $name === null) {
                continue;
            }
            $items[] = ['id' => $id, 'name' => $name, 'kana' => $str($x['kana'] ?? null, 60), 'birthDate' => $str($x['birthDate'] ?? null, 10), 'phone' => $str($x['phone'] ?? null, 20), 'm3ChartNo' => $str($x['m3ChartNo'] ?? null, 20)];
        }
        // 書き換える前に、必ず控えを取る（分けて送るときは最初の1回だけ。写真は書き換えないので除いて手早く）
        $b = null;
        if (($in['backup'] ?? true) !== false) {
            $b = Db::i()->backupDocs();
            Auth::audit($actor($s), 'M3照合の前に保存データの控えを作成：' . $b['file']);
        }
        Http::json(Store::applyM3Fill($items, $actor($s)) + ['backup' => $b['file'] ?? null]);
    }

    // ---- 整った控え（バックアップ）をサーバーの data/backups/ に作る（院長・管理者） ----
    if ($route === 'POST admin/backup') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        if (!is_array($in) || ($in['confirm'] ?? null) !== 'BACKUP') {
            Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"BACKUP"} を送ってください'], 400);
        }
        $r = Db::i()->backup();
        Auth::audit($actor($s), '保存データの控えを作成：' . $r['file']);
        Http::json($r);
    }

    // ---- 写真などの置き場所（DB の表 → data/blobs/ のファイル）。移すのも詰めるのも院長・管理者が画面から押したときだけ ----
    if ($route === 'GET admin/storage') {
        $me(STAFF_ADMIN);
        Http::json(Db::i()->blobStats());
    }
    if ($route === 'POST admin/storage/move') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        if (!is_array($in) || ($in['confirm'] ?? null) !== 'MOVE') {
            Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"MOVE"} を送ってください'], 400);
        }
        @set_time_limit(60);
        $r = Db::i()->moveBlobsOut(15.0);
        if ($r['moved'] > 0) {
            Auth::audit($actor($s), "写真などをデータベースの外へ移動：{$r['moved']}件（残り{$r['left']}件）");
        }
        Http::json($r + ['stats' => Db::i()->blobStats()]);
    }
    if ($route === 'POST admin/storage/compact') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        if (!is_array($in) || ($in['confirm'] ?? null) !== 'COMPACT') {
            Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"COMPACT"} を送ってください'], 400);
        }
        if (Db::i()->blobStats()['inDb'] > 0) {
            Http::json(['error' => 'invalid', 'message' => '先に写真をすべて移動してください'], 400);
        }
        @set_time_limit(120);
        $r = Db::i()->compact();
        Auth::audit($actor($s), 'データベースを小さくした：' . round($r['before'] / 1048576) . 'MB → ' . round($r['after'] / 1048576) . 'MB');
        Http::json($r + ['stats' => Db::i()->blobStats()]);
    }

    // ---- 指定した患者の予約を過去・未来とも完全に消す（院長・管理者。患者そのものは消さない） ----
    if ($p[0] === 'reservations' && ($p[1] ?? '') === 'by-patient' && $n >= 3) {
        if ($method === 'GET' && $n === 3) {
            $me(STAFF_ADMIN);
            Http::json(Store::countPatientReservations(V::id($p[2])));
        }
        if ($method === 'POST' && $n === 4 && $p[3] === 'delete') {
            $s = $me(STAFF_ADMIN);
            $in = Http::readJson();
            if (!is_array($in) || ($in['confirm'] ?? null) !== 'DELETE') {
                Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"DELETE"} を送ってください'], 400);
            }
            Http::json(Store::deletePatientReservations(V::id($p[2]), $actor($s)));
        }
    }

    // ---- Airリザーブから移した今日以降の予約を完全に消す（院長・管理者。入れ直しのため） ----
    if ($p[0] === 'reservations' && ($p[1] ?? '') === 'air-future') {
        if ($method === 'GET' && $n === 2) {
            $me(STAFF_ADMIN);
            Http::json(Store::countAirFutureReservations());
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me(STAFF_ADMIN);
            $in = Http::readJson();
            if (!is_array($in) || ($in['confirm'] ?? null) !== 'DELETE') {
                Http::json(['error' => 'invalid', 'message' => '確認のため {"confirm":"DELETE"} を送ってください'], 400);
            }
            Http::json(Store::deleteAirFutureReservations($actor($s)));
        }
    }

    // ---- 機器の連携の設定（院長・管理者）と、照合待ちの写真 ----
    if ($p[0] === 'device-links') {
        if ($method === 'GET' && $n === 1) {
            $me(STAFF_ADMIN);
            Http::json(Store::deviceLinks());
        }
        if ($method === 'POST' && $n === 1) {
            $s = $me(STAFF_ADMIN);
            Http::json(Store::createDeviceLink(Schema::deviceLink(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'revoke') {
            $s = $me(STAFF_ADMIN);
            Http::json(Store::revokeDeviceLink(V::id($p[1]), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'options') {
            $s = $me(STAFF_ADMIN);
            Http::json(Store::setDeviceOptions(V::id($p[1]), Schema::deviceOptions(Http::readJson()), $actor($s)));
        }
    }
    if ($p[0] === 'photo-inbox') {
        if ($method === 'GET' && $n === 1) {
            $me();
            Http::json(['items' => Store::listPhotoInbox()]);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'rematch') {
            $s = $manager();
            Http::json(Store::rematchPhotoInbox($actor($s)));
        }
        if ($method === 'GET' && $n === 3 && $p[2] === 'content') {
            $me();
            [$item, $bytes] = Store::photoInboxContent(V::id($p[1]));
            Http::file(['kind' => 'image', 'type' => $item['type'], 'name' => $item['name']], $bytes);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'assign') {
            $s = $me();
            Http::json(Store::assignPhotoInbox(V::id($p[1]), Schema::photoAssign(Http::readJson())['patientId'], $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            Store::deletePhotoInbox(V::id($p[1]), $actor($s));
            Http::json(['id' => $p[1], 'deleted' => true]);
        }
    }

    // ---- 同意書 ----
    if ($p[0] === 'consent-templates') {
        if ($method === 'GET' && $n === 1) {
            $me();
            // ?cached=1 なら、ドライブを見に行かずに前回の内容をすぐ返す
            $live = $q('cached') === '1' ? false : Store::refreshConsentList();
            Http::json(['items' => Store::listConsentTemplates(), 'receivedAt' => Store::consentTemplatesReceivedAt(), 'live' => $live, 'source' => Store::consentSourceInfo()['url'] !== '']);
        }
        if ($method === 'GET' && $n === 2) {
            $me();
            Http::json($q('cached') === '1' ? Store::getConsentTemplate(V::id($p[1])) : Store::loadConsentTemplate(V::id($p[1])));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'menus') {
            $s = $manager();
            Http::json(Store::setConsentTemplateMenus(V::id($p[1]), Schema::consentTemplateMenus(Http::readJson()), $actor($s)));
        }
    }
    if ($p[0] === 'price-sheet-source' && $n === 1) {
        if ($method === 'GET') {
            $me(STAFF_ADMIN);
            Http::json(Store::priceSheetSourceInfo());
        }
        if ($method === 'POST') {
            $s = $me(STAFF_ADMIN);
            Http::json(Store::setPriceSheetSource(Schema::consentSource(Http::readJson()), $actor($s)));
        }
    }
    if ($p[0] === 'consent-source' && $n === 1) {
        if ($method === 'GET') {
            $me(STAFF_ADMIN);
            Http::json(Store::consentSourceInfo());
        }
        if ($method === 'POST') {
            $s = $me(STAFF_ADMIN);
            Http::json(Store::setConsentSource(Schema::consentSource(Http::readJson()), $actor($s)));
        }
    }
    if ($p[0] === 'consents' && $n >= 2) {
        if ($method === 'GET' && $n === 2) {
            $s = $me();
            $c = Store::getConsentView(V::id($p[1]));
            Auth::noteAccess($s, '同意書を表示', 'consent:' . $p[1]);
            Http::json($c);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deleteConsent($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- 料金表 ----
    if ($p[0] === 'prices') {
        if ($method === 'GET' && $n === 1) {
            $me();
            Store::syncPricesIfDue();
            Http::json(Store::getPriceList());
        }
        if ($method === 'POST' && $n === 1) {
            $s = $manager();
            Http::json(Store::createPriceItem(Schema::priceItem(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'sync') {
            $s = $manager();
            Http::json(Store::syncPrices($actor($s)));
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'urls') {
            $s = $me(STAFF_ADMIN);
            Store::setPriceUrls(Schema::priceUrls(Http::readJson()), $actor($s));
            Http::json(Store::syncPrices($actor($s)));
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $manager();
            Http::json(Store::updatePriceItem(V::id($p[1]), Schema::priceItem(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deletePriceItem($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- 取り込み（ファイル・Googleの共有リンクから。管理操作のできるスタッフ） ----
    if ($p[0] === 'imports' && $method === 'POST' && $n === 2) {
        $s = $manager();
        if ($p[1] === 'fetch') {
            Http::json(Store::fetchGoogleExport(Schema::importFetch(Http::readJson())));
        }
        if ($p[1] === 'prices') {
            $in = Schema::integrationPrices(Http::readJson(524_288));
            $r = Store::receiveSheetPrices($in['sheet'], $in['items']);
            Auth::audit($actor($s), "料金表を取り込み（{$in['sheet']}・" . count($in['items']) . '件）');
            Http::json($r);
        }
        if ($p[1] === 'consent-templates') {
            Http::json(Store::importConsentTemplates(Schema::importConsentTemplates(Http::readJson(13_000_000)), $actor($s)));
        }
    }
    if ($p[0] === 'consent-templates' && $method === 'POST' && $n === 3 && $p[2] === 'delete') {
        $s = $manager();
        $id = V::id($p[1]);
        Store::deleteConsentTemplate($id, $actor($s));
        Http::json(['id' => $id, 'deleted' => true]);
    }

    // ---- 患者が入力する問診票の質問（院長・管理者）。送信の受け口は monshin/index.php ----
    if ($route === 'GET monshin/form') {
        $me(STAFF_ADMIN);
        // 患者向けのページ（monshin/）を置いていないサーバーでは、設定画面にも出さない
        Http::json(['form' => Monshin::form(), 'defaults' => Monshin::defaults(), 'enabled' => is_file(RESERVE_ROOT . '/monshin/index.php'), 'url' => (string) (config()['monshin_url'] ?? '')]);
    }
    if ($route === 'POST monshin/form') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson(262_144);
        if (!is_array($in) || !isset($in['questions']) || !is_array($in['questions']) || !array_is_list($in['questions'])) {
            throw new InputError();
        }
        foreach ($in['questions'] as $x) {
            if (!is_array($x)) {
                throw new InputError();
            }
        }
        Http::json(Monshin::saveForm($in, $actor($s)));
    }
    // LINE の問診票連携（LIFF ID・チャネルシークレット）。院長・管理者
    if ($route === 'GET line-link') {
        $me(STAFF_ADMIN);
        Http::json(LineLink::view());
    }
    if ($route === 'POST line-link') {
        $s = $me(STAFF_ADMIN);
        $in = Http::readJson();
        if (!is_array($in)) {
            throw new InputError();
        }
        Http::json(LineLink::update($in, $actor($s)));
    }
    if ($route === 'GET monshin/headings') {
        $me(STAFF_ADMIN);
        Http::json(['items' => Monshin::pastHeadings()]);
    }
    // 回答を CSV で書き出す（院長・管理者）。その場で作って返し、サーバーにファイルは残さない。書き出したことは操作の記録に残す
    if ($route === 'GET questionnaires/export') {
        $s = $me(STAFF_ADMIN);
        $from = (string) ($q('from') ?? '');
        $to = (string) ($q('to') ?? '');
        $csv = Monshin::exportCsv($from, $to, $actor($s));
        Http::file(['kind' => 'doc', 'type' => 'text/csv; charset=utf-8', 'name' => "問診票_{$from}_{$to}.csv"], $csv);
    }

    // ---- 問診票 ----
    if ($p[0] === 'questionnaires') {
        if ($method === 'GET' && $n === 2 && $p[1] === 'unmatched') {
            $me();
            Http::json(['items' => Store::listUnmatchedQuestionnaires()]);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'link') {
            $s = $me();
            Http::json(Store::linkQuestionnaire(V::id($p[1]), Schema::linkQuestionnaire(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deleteQuestionnaire($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- カルテ ----
    if ($p[0] === 'charts' && $n >= 2) {
        if ($method === 'PATCH' && $n === 2) {
            $s = $me();
            Http::json(Store::updateChart(V::id($p[1]), Schema::updateChart(Http::readJson(65_536)), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me();
            $c = Store::deleteChart(V::id($p[1]), Schema::versionOnly(Http::readJson()), $s);
            Http::json(['id' => $c['id'], 'deleted' => true]);
        }
    }

    // ---- 見積書 ----
    if ($p[0] === 'estimates' && $n >= 2) {
        if ($method === 'GET' && $n === 2) {
            $me();
            Http::json(Store::getEstimateView(V::id($p[1])));
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me();
            Http::json(Store::updateEstimate(V::id($p[1]), Schema::updateEstimate(Http::readJson(65_536)), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $e = Store::deleteEstimate(V::id($p[1]), ['version' => Schema::versionOnly(Http::readJson())], $actor($s));
            Http::json(['id' => $e['id'], 'deleted' => true]);
        }
    }

    // ---- 状態（院長・管理者と受付） ----
    if ($p[0] === 'stages') {
        if ($method === 'POST' && $n === 1) {
            $s = $manager();
            Http::json(Store::createStage(Schema::stage(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $manager();
            Http::json(['items' => Store::reorderStages(Schema::reorder(Http::readJson()), $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $manager();
            $id = V::id($p[1]);
            Http::json(Store::updateStage($id, Schema::stage(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deleteStage($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- スキンケア・内服のプリセット（院長・管理者と受付） ----
    if ($p[0] === 'products') {
        if ($method === 'POST' && $n === 1) {
            $s = $manager();
            Http::json(Store::createProduct(Schema::product(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $manager();
            Http::json(['items' => Store::reorderProducts(Schema::reorder(Http::readJson()), $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $manager();
            $id = V::id($p[1]);
            Http::json(Store::updateProduct($id, Schema::product(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $manager();
            $id = V::id($p[1]);
            Store::deleteProduct($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- スタッフ・操作ログ（院長・管理者のみ） ----
    if ($route === 'GET staff') {
        $me(STAFF_ADMIN);
        Http::json(['items' => Auth::listStaff(true)]);
    }
    if ($route === 'POST staff') {
        $s = $me(STAFF_ADMIN);
        Http::json(Auth::createStaff($actor($s), Schema::createStaff(Http::readJson())), 201);
    }
    if ($method === 'PATCH' && $n === 2 && $p[0] === 'staff') {
        $s = $me(STAFF_ADMIN);
        $id = V::id($p[1]);
        Http::json(Auth::updateStaff($actor($s), $id, Schema::updateStaff(Http::readJson())));
    }
    // 閲覧の記録（だれが・いつ・どの患者を見たか）。院長・管理者。見たことも操作の記録に残す
    if ($route === 'GET access-log') {
        $s = $me(STAFF_ADMIN);
        $r = Store::accessLog((string) ($q('from') ?? ''), (string) ($q('to') ?? ''), $q('patientId') ?: null, $q('staffId') ?: null);
        Auth::audit($actor($s), '閲覧の記録を確認');
        Http::json($r);
    }
    if ($route === 'GET audit') {
        $me(STAFF_ADMIN);
        Http::json(['items' => Auth::listAudit(300)]);
    }

    Http::json(['error' => 'not_found', 'message' => '見つかりません'], 404);
} catch (Throwable $e) {
    Http::error($e);
}
