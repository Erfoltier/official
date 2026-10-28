<?php
declare(strict_types=1);

/** Additive, dedicated pilot API. Never called by staff routes or the broad proxy.
 * No arbitrary patient lookup, patient creation, cancellation, update, or menu write.
 * Database checks and insertion share BEGIN IMMEDIATE through the existing Db class.
 */
final class LaneBookingSafety
{
    private static function fail(string $code): never
    {
        throw new StoreError('conflict', '予約安全確認: ' . $code);
    }

    private static function policy(): array
    {
        $p = require __DIR__ . '/LaneBookingPolicy.php';
        $m11 = is_array($p) && ($p['revision'] ?? '') === 'fixed-m11r-jan2027-20261028-v1';
        $minutes = $m11 ? 10 : 20;
        if (!is_array($p) || ($p['mode'] ?? '') !== 'fixed_test'
            || !in_array($p['patientName'] ?? '', ['試験 太郎', '試験 花子'], true)
            || ($p['laneId'] ?? '') !== 'lane-main'
            || ($p['menuId'] ?? '') !== ($m11 ? 'menu-x021' : 'menu-s000099B91')
            || ($p['menuName'] ?? '') !== ($m11 ? '再診 色素レーザー' : 'シミまとめ標準20分')
            || ($p['minutes'] ?? 0) !== $minutes
            || !is_int($p['start'] ?? null) || !is_int($p['end'] ?? null)
            || $p['start'] % 5 || $p['end'] % 5 || $p['end'] - $p['start'] !== $minutes
            || $p['start'] < 540 || $p['start'] > 1110
            || !is_string($p['revision'] ?? null) || $p['revision'] === '') {
            self::fail('policy_invalid');
        }
        if ($m11 && (($p['patientName'] ?? '') !== '試験 太郎'
            || ($p['patientId'] ?? '') !== 'p-new-muw2osez-7b5626'
            || ($p['requestId'] ?? '') !== 'R20261028LaneM11R0106Main1300'
            || ($p['date'] ?? '') !== '2027-01-06' || $p['start'] !== 780 || $p['end'] !== 790)) self::fail('m11_scope');
        if ($p['patientName'] === '試験 花子'
            && (($p['patientId'] ?? '') !== 'p-new-muw2qgcj-124d9a'
                || ($p['revision'] ?? '') !== 'fixed-hanako-20261027-v1'
                || ($p['requestId'] ?? '') !== 'R20261027LaneHanako1230Main1100'
                || ($p['date'] ?? '') !== '2026-12-30' || $p['start'] !== 660 || $p['end'] !== 680)) self::fail('hanako_scope');
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', (string) ($p['date'] ?? ''), new DateTimeZone('Asia/Tokyo'));
        if (!$d || $d->format('Y-m-d') !== $p['date'] || $d->format('N') !== '3') self::fail('pilot_date_invalid');
        return $p;
    }

    private static function isolated(array $p): bool
    {
        return $p['patientName'] === '試験 花子' || $p['revision'] === 'fixed-m11r-jan2027-20261028-v1';
    }

    private static function exactKeys(array $v, array $required): void
    {
        $a = array_keys($v); sort($a); sort($required);
        if ($a !== $required) self::fail('fields_invalid');
    }

    private static function normalizeName(string $s): string
    {
        return preg_replace('/[\s　]+/u', '', $s) ?? '';
    }

    public static function testPatient(): array
    {
        return self::isolated(self::policy())
            ? Store::withoutMaintenance(fn() => self::testPatientChecked())
            : self::testPatientChecked();
    }

    private static function testPatientChecked(): array
    {
        $p = self::policy();
        if (is_string($p['patientId'] ?? null) && $p['patientId'] !== '') {
            // Explicitly selected fixed-test ID takes precedence over name duplicates.
            // patient() independently rejects missing, deleted or renamed records.
            Store::init();
            self::patient($p);
            return ['patientId' => $p['patientId'], 'name' => $p['patientName']];
        }
        // Query is fixed by policy, never supplied by the caller.
        $items = Store::bookingFindPatients($p['patientName']);
        if (count($items) >= 10) self::fail('test_patient_ambiguous');
        $hits = array_values(array_filter($items, fn($v) => self::normalizeName((string) ($v['name'] ?? '')) === self::normalizeName($p['patientName'])));
        if (count($hits) === 0) self::fail('test_patient_not_found');
        if (count($hits) !== 1) self::fail('test_patient_not_unique');
        return ['patientId' => $hits[0]['id'], 'name' => $p['patientName']];
    }

    public static function constraints(): array
    {
        return self::isolated(self::policy())
            ? Store::withoutMaintenance(fn() => self::constraintsChecked())
            : self::constraintsChecked();
    }

    private static function constraintsChecked(): array
    {
        Store::init();
        $p = self::policy();
        $out = [];
        foreach (Db::i()->all('menu') as $m) {
            if (empty($m['active']) || !empty($m['deleted'])) continue;
            $out[] = ['id' => $m['id'], 'name' => $m['name'], 'duration' => $m['duration'] ?? null, 'laneIds' => $m['laneIds'] ?? null];
        }
        return ['scope' => 'fixed_test_only', 'enabled' => $p['enabled'] === true && $p['externalCalendarIsolated'] === true,
            'policyRevision' => $p['revision'], 'menus' => $out];
    }

    private static function request(array $r, array $p): void
    {
        self::exactKeys($r, ['date', 'laneId', 'menuId', 'start', 'end', 'nonce']);
        foreach (['date', 'laneId', 'menuId', 'start', 'end'] as $key) {
            if (($r[$key] ?? null) !== $p[$key]) self::fail('outside_pilot_scope');
        }
        if (!is_string($r['nonce']) || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $r['nonce'])) self::fail('nonce_invalid');
    }

    private static function iso(array $p, string $key): string
    {
        return $p['date'] . sprintf('T%02d:%02d:00+09:00', intdiv($p[$key], 60), $p[$key] % 60);
    }

    private static function catalog(array $p): array
    {
        $db = Db::i();
        $lane = $db->get('lane', $p['laneId']);
        $m = $db->get('menu', $p['menuId']);
        if (!$lane || empty($lane['active']) || !empty($lane['deleted'])) self::fail('lane_inactive');
        if (!$m || empty($m['active']) || !empty($m['deleted']) || ($m['name'] ?? '') !== $p['menuName']
            || !is_array($m['laneIds'] ?? null) || !in_array($p['laneId'], $m['laneIds'], true)) self::fail('menu_lane_unverified');
        if (($m['duration']['kind'] ?? '') !== 'fixed' || ($m['duration']['minutes'] ?? 0) !== $p['minutes']) self::fail('menu_duration_changed');
        $c = Store::clinic();
        if (($c['slotMin'] ?? null) !== 5 || !is_int($c['dayStartMin'] ?? null) || !is_int($c['dayEndMin'] ?? null)
            || $p['start'] < $c['dayStartMin'] || $p['end'] > $c['dayEndMin']) self::fail('clinic_window_unverified');
        return [$lane, $m, $c];
    }

    private static function state(array $r, array $p): array
    {
        self::request($r, $p);
        $catalog = self::catalog($p);
        $start = strtotime(self::iso($p, 'start')); $end = strtotime(self::iso($p, 'end'));
        if ($start === false || $end === false || $start <= time()) self::fail('time_invalid');
        $db = Db::i(); $busy = false; $unknown = false; $digest = [];
        // Read internally; never return patient IDs, appointment IDs, memo or names.
        foreach ($db->where('reservation', 'k1', $p['date']) as $b) {
            if (in_array($b['status'] ?? '', Store::INACTIVE, true)) continue;
            // Explicit manual unavailability is conservative across lanes.
            $manualBlock = in_array('menu-s0000C60FE', $b['menuIds'] ?? [], true);
            if (($b['laneId'] ?? '') !== $p['laneId'] && !$manualBlock) continue;
            $s = strtotime((string) ($b['startAt'] ?? '')); $e = strtotime((string) ($b['endAt'] ?? ''));
            if ($s === false || $e === false || $e <= $s || !in_array($b['status'] ?? '', Store::STATUSES, true)) { $unknown = true; continue; }
            $digest[] = [$b['id'], $b['version'] ?? null, $b['status'], $b['startAt'], $b['endAt'], $b['menuIds'] ?? []];
            if ($s < $end && $e > $start) $busy = true;
        }
        // Free-text day notes may encode a closure/absence. Do not infer meaning.
        $note = $db->get('dayNote', $p['date'] . '|' . $p['laneId']);
        if (trim((string) ($note['text'] ?? '')) !== '') $unknown = true;
        sort($digest);
        $revision = hash('sha256', json_encode([$p, $catalog, $digest, $note], JSON_THROW_ON_ERROR));
        return ['schemaVersion' => 1, 'scope' => $p['revision'] === 'fixed-m11r-jan2027-20261028-v1' ? 'fixed_test_main_pigment_only' : 'fixed_test_main_spots_only',
            'status' => $unknown ? 'human_review' : ($busy ? 'unavailable' : 'available'),
            'reason' => $unknown ? 'day_state_unverified' : ($busy ? 'lane_busy' : 'verified_pilot_slot'),
            'date' => $p['date'], 'laneId' => $p['laneId'], 'menuId' => $p['menuId'],
            'start' => $p['start'], 'end' => $p['end'], 'nonce' => $r['nonce'],
            'policyRevision' => $p['revision'], 'revision' => $revision,
            'observedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'sharedResources' => [], 'sharedResourceBasis' => 'doctor_main_only_no_nurse_device',
            'enabled' => $p['enabled'] === true && $p['externalCalendarIsolated'] === true];
    }

    public static function availability(array $r): array
    {
        return self::isolated(self::policy())
            ? Store::withoutMaintenance(fn() => self::availabilityChecked($r))
            : self::availabilityChecked($r);
    }

    private static function availabilityChecked(array $r): array
    {
        Store::init(); $p = self::policy();
        return Db::i()->transaction(fn() => self::state($r, $p));
    }

    private static function patient(array $p): void
    {
        if (!is_string($p['patientId']) || $p['patientId'] === '') self::fail('test_patient_not_bound');
        $patient = Db::i()->get('patient', $p['patientId']);
        if (!$patient || !empty($patient['deleted']) || self::normalizeName((string) ($patient['name'] ?? '')) !== self::normalizeName($p['patientName'])) self::fail('test_patient_mismatch');
        if ($p['patientName'] === '試験 花子'
            && (self::normalizeName((string) ($patient['kana'] ?? '')) !== 'シケンハナコ'
                || (string) ($patient['chartNo'] ?? '') !== '10087'
                || ($patient['birthDate'] ?? '') !== '' && $patient['birthDate'] !== '2000-01-01'
                || ($patient['phone'] ?? '') !== '' && $patient['phone'] !== '09012345678')) self::fail('hanako_identity_changed');
    }

    private static function minimal(array $r, array $p, array $by): array
    {
        if (($r['patientId'] ?? '') !== $p['patientId'] || ($r['createdBy']['id'] ?? '') !== $by['id']) self::fail('reservation_scope_mismatch');
        return array_intersect_key($r, array_flip(['id', 'patientId', 'version', 'status', 'laneId', 'menuIds', 'startAt', 'endAt', 'memo', 'requestId']));
    }

    public static function read(string $id, array $by): array
    {
        $p = self::policy(); self::patient($p);
        $r = Db::i()->get('reservation', $id);
        // Read the one completed M11 sequence after its expiring write policy
        // was restored. minimal() still verifies the current credential owner.
        $m11 = $r && $p['patientId'] === 'p-new-muw2osez-7b5626'
            && ($r['patientId'] ?? '') === $p['patientId'] && ($r['safePilotRevision'] ?? '') === 'fixed-m11r-jan2027-20261028-v1'
            && ($r['requestId'] ?? '') === 'R20261028LaneM11R0106Main1300'
            && ($r['laneId'] ?? '') === 'lane-main' && ($r['menuIds'] ?? []) === ['menu-x021']
            && in_array([$r['version'] ?? null, $r['status'] ?? '', $r['startAt'] ?? '', $r['endAt'] ?? ''], [
                [1,'booked','2027-01-06T13:00:00+09:00','2027-01-06T13:10:00+09:00'],
                [2,'booked','2027-01-06T14:00:00+09:00','2027-01-06T14:10:00+09:00'],
                [3,'cancelled','2027-01-06T14:00:00+09:00','2027-01-06T14:10:00+09:00'],
            ], true);
        if (!$r || (!$m11 && (($r['safePilotRevision'] ?? '') === 'fixed-m11r-jan2027-20261028-v1'
            || ($r['safePilotRevision'] ?? '') !== $p['revision']))) self::fail('reservation_not_pilot');
        return self::minimal($r, $p, $by);
    }

    public static function create(array $in, array $by): array
    {
        return self::isolated(self::policy())
            ? Store::withoutMaintenance(fn() => self::createChecked($in, $by))
            : self::createChecked($in, $by);
    }

    private static function createChecked(array $in, array $by): array
    {
        self::exactKeys($in, ['patientId', 'requestId', 'memo', 'slot', 'revision', 'observedAt']);
        Store::init(); $p = self::policy();
        if ($p['enabled'] !== true || $p['externalCalendarIsolated'] !== true) self::fail('pilot_disabled');
        if (self::isolated($p)
            && (($in['requestId'] ?? '') !== $p['requestId']
                || !is_int($p['expiresAt'] ?? null) || $p['expiresAt'] <= time() || $p['expiresAt'] > time() + 120)) self::fail('hanako_approval_expired_or_changed');
        if ($in['patientId'] !== $p['patientId'] || !is_array($in['slot'])) self::fail('patient_or_slot_invalid');
        if (!is_string($in['requestId']) || !preg_match('/^R[0-9][A-Za-z0-9_-]{15,79}$/D', $in['requestId'])) self::fail('request_id_invalid');
        if (!is_string($in['memo']) || $in['memo'] === '' || strlen($in['memo']) > 12000 || strip_tags($in['memo']) !== $in['memo']) self::fail('memo_invalid');
        self::request($in['slot'], $p);
        $payloadHash = hash('sha256', json_encode([$in['patientId'], $in['requestId'], $in['memo'], $p['date'], $p['laneId'], $p['menuId'], $p['start'], $p['end']], JSON_THROW_ON_ERROR));
        return Db::i()->transaction(function () use ($in, $p, $by, $payloadHash) {
            if (self::isolated($p)
                && (self::policy() !== $p || $p['expiresAt'] <= time())) self::fail('hanako_policy_changed_or_expired');
            self::patient($p); $db = Db::i();
            $key = hash('sha256', $by['id'] . '|' . $in['requestId']);
            $receipt = $db->get('safeBookingReceipt', $key);
            if ($receipt) {
                if (($receipt['payloadHash'] ?? '') !== $payloadHash) self::fail('request_id_payload_conflict');
                // Same request returns its record, never performs another write.
                return self::read($receipt['reservationId'], $by);
            }
            $observed = is_string($in['observedAt']) && preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/D', $in['observedAt']) ? strtotime($in['observedAt']) : false;
            if ($observed === false || $observed > time() || time() - $observed > 30) self::fail('availability_expired');
            $current = self::state($in['slot'], $p);
            if ($current['status'] !== 'available' || !is_string($in['revision']) || !hash_equals($current['revision'], $in['revision'])) self::fail('availability_changed');
            // A second request ID must not duplicate the same fixed-test slot.
            foreach ($db->where('reservation', 'k2', $p['patientId']) as $prior) {
                if (($prior['requestId'] ?? '') === $in['requestId']) self::fail('untracked_request_exists');
            }
            $created = Store::bookingCreate(['patientId' => $p['patientId'], 'laneId' => $p['laneId'], 'menuIds' => [$p['menuId']],
                'startAt' => self::iso($p, 'start'), 'endAt' => self::iso($p, 'end'), 'memo' => $in['memo'], 'requestId' => $in['requestId']], $by);
            $r = $db->get('reservation', $created['id']);
            if (!$r || ($r['memo'] ?? null) !== $in['memo']) self::fail('stored_memo_mismatch');
            $r['safePilotRevision'] = $p['revision'];
            // Reminder::visitsOn must also exclude safePilotRevision records.
            // A stored skipped status alone is NOT a notification suppression gate.
            $r['reminder'] = ['status' => 'skipped', 'reason' => 'fixed_test_pilot'];
            $db->put('reservation', $r['id'], $r);
            $db->put('safeBookingReceipt', $key, ['payloadHash' => $payloadHash, 'reservationId' => $r['id'], 'createdAt' => gmdate('c')]);
            return self::minimal($r, $p, $by);
        });
    }
}
