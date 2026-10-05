<?php
/**
 * API の入口。/reserve/api/v1/... へのアクセスは .htaccess でここに集まる。
 * URL とメソッドで処理を振り分ける（Node.js 版の src/app/api/v1 と同じ）。
 */
declare(strict_types=1);

require __DIR__ . '/../lib/bootstrap.php';

const STAFF_ADMIN = ['admin'];
const STAFF_MANAGE = ['admin', 'reception'];

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
    $actor = fn(array $s) => Auth::actorOf($s);

    $route = $method . ' ' . implode('/', array_map(fn($p) => preg_match('/^[A-Za-z0-9_-]{1,64}$/', $p) ? $p : '?', $path));
    $p = $path;
    $n = count($p);

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
        $r = Auth::verifyPin($in['staffId'], $in['pin']);
        Auth::audit(['id' => $r['staff']['id'], 'name' => $r['staff']['name']], 'ログイン');
        Http::json($r['staff'], 200, ['Set-Cookie: ' . Auth::sessionCookie(Auth::createSessionToken($r['staff']['id'], $r['sessionVersion']))]);
    }
    if ($route === 'POST auth/logout') {
        $s = Auth::currentStaff();
        if ($s) {
            Auth::audit(Auth::actorOf($s), 'ログアウト');
        }
        Http::noContent(['Set-Cookie: ' . Auth::clearSessionCookie()]);
    }
    if ($route === 'GET auth/me') {
        Http::json($me());
    }

    // ---- 外部連携（スタッフのログインではなく連携トークンで確認） ----
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
        $s = $me(STAFF_MANAGE);
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
        $me(STAFF_MANAGE);
        Http::json(Store::previewMerge(V::id($q('keep')), V::id($q('dup'))));
    }
    if ($route === 'POST patients/merge') {
        $s = $me(STAFF_MANAGE);
        $keep = Store::mergePatients(Schema::mergePatients(Http::readJson()), $actor($s));
        Http::json(Store::getPatientDetail($keep['id']));
    }
    if ($p[0] === 'patients' && $n >= 2 && $p[1] !== 'merge') {
        if ($method === 'GET' && $n === 2) {
            $me();
            Http::json(Store::getPatientDetail(V::id($p[1])));
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
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Store::deletePatient($id, Schema::deletePatient(Http::readJson()), $actor($s));
            Http::json(Store::getPatientDetail($id));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'restore') {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Store::restorePatient($id, Schema::versionOnly(Http::readJson()), $actor($s));
            Http::json(Store::getPatientDetail($id));
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
            $s = $me(STAFF_MANAGE);
            $in = Http::readJson();
            Http::json($kind === 'lanes' ? Store::createLane(Schema::lane($in), $actor($s)) : Store::createMenu(Schema::menu($in), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $me(STAFF_MANAGE);
            $ids = Schema::reorder(Http::readJson());
            Http::json(['items' => $kind === 'lanes' ? Store::reorderLanes($ids, $actor($s)) : Store::reorderMenus($ids, $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            $in = Http::readJson();
            Http::json($kind === 'lanes' ? Store::updateLane($id, Schema::lane($in), $actor($s)) : Store::updateMenu($id, Schema::menu($in), $actor($s)));
        }
        if ($method === 'DELETE' && $n === 2 && $kind === 'lanes') {
            $s = $me(STAFF_MANAGE);
            Store::deleteLane(V::id($p[1]), $actor($s));
            Http::noContent();
        }
    }

    // ---- ファイル ----
    if ($p[0] === 'files' && $n >= 2) {
        if ($method === 'GET' && $n === 2) {
            $me();
            [$meta, $bytes] = Store::getFile(V::id($p[1]));
            Http::file($meta, $bytes);
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me(STAFF_MANAGE);
            $f = Store::deleteFile(V::id($p[1]), $actor($s));
            Http::json(['id' => $f['id'], 'deleted' => true]);
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
            $s = $me(STAFF_MANAGE);
            Http::json(Store::createPriceItem(Schema::priceItem(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'sync') {
            $s = $me(STAFF_MANAGE);
            Http::json(Store::syncPrices($actor($s)));
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'urls') {
            $s = $me(STAFF_ADMIN);
            Store::setPriceUrls(Schema::priceUrls(Http::readJson()), $actor($s));
            Http::json(Store::syncPrices($actor($s)));
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me(STAFF_MANAGE);
            Http::json(Store::updatePriceItem(V::id($p[1]), Schema::priceItem(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Store::deletePriceItem($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
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
            $s = $me(STAFF_MANAGE);
            $e = Store::deleteEstimate(V::id($p[1]), ['version' => Schema::versionOnly(Http::readJson())], $actor($s));
            Http::json(['id' => $e['id'], 'deleted' => true]);
        }
    }

    // ---- 状態（院長・管理者と受付） ----
    if ($p[0] === 'stages') {
        if ($method === 'POST' && $n === 1) {
            $s = $me(STAFF_MANAGE);
            Http::json(Store::createStage(Schema::stage(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $me(STAFF_MANAGE);
            Http::json(['items' => Store::reorderStages(Schema::reorder(Http::readJson()), $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Http::json(Store::updateStage($id, Schema::stage(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Store::deleteStage($id, $actor($s));
            Http::json(['id' => $id, 'deleted' => true]);
        }
    }

    // ---- スキンケア・内服のプリセット（院長・管理者と受付） ----
    if ($p[0] === 'products') {
        if ($method === 'POST' && $n === 1) {
            $s = $me(STAFF_MANAGE);
            Http::json(Store::createProduct(Schema::product(Http::readJson()), $actor($s)), 201);
        }
        if ($method === 'POST' && $n === 2 && $p[1] === 'reorder') {
            $s = $me(STAFF_MANAGE);
            Http::json(['items' => Store::reorderProducts(Schema::reorder(Http::readJson()), $actor($s))]);
        }
        if ($method === 'PATCH' && $n === 2) {
            $s = $me(STAFF_MANAGE);
            $id = V::id($p[1]);
            Http::json(Store::updateProduct($id, Schema::product(Http::readJson()), $actor($s)));
        }
        if ($method === 'POST' && $n === 3 && $p[2] === 'delete') {
            $s = $me(STAFF_MANAGE);
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
    if ($route === 'GET audit') {
        $me(STAFF_ADMIN);
        Http::json(['items' => Auth::listAudit(300)]);
    }

    Http::json(['error' => 'not_found', 'message' => '見つかりません'], 404);
} catch (Throwable $e) {
    Http::error($e);
}
