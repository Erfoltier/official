<?php
declare(strict_types=1);

/** UNDEPLOYED fixed-test candidate. Uses only the observed Db/Store interface.
 * No generic updateReservation (it resets reminders), patient creation, network,
 * or staff route. Real Store encryption/index/audit compatibility is a separate gate.
 */
final class LaneMutationSafety
{
    private static function fail(string $code): never { throw new StoreError('conflict', '予約安全確認: ' . $code); }
    private static function keys(array $a, array $keys): void {
        $actual = array_keys($a); sort($actual); sort($keys);
        if ($actual !== $keys) self::fail('fields_invalid');
    }
    private static function digest(mixed $value): string { return hash('sha256', json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); }
    private static function policy(): array {
        $p = require __DIR__ . '/LaneMutationPolicy.php';
        if (!is_array($p) || ($p['contract'] ?? '') !== 'atomic-fixed-mutation-v1') self::fail('policy_invalid');
        foreach (['patientId','patientName','reservationId','requestId','m3PatientId','m3VisitId','date','laneId','menuId','menuName','safePilotRevision'] as $key) {
            if (!is_string($p[$key] ?? null) || $p[$key] === '') self::fail('policy_binding_missing');
        }
        return $p;
    }
    private static function release(array $p): void {
        if ($p['enabled'] !== true || $p['sourceCompatibilityVerified'] !== true || $p['externalCalendarIsolated'] !== true) self::fail('disabled');
        if (!str_starts_with((string)(config()['db_dsn'] ?? ''), 'sqlite:')) self::fail('sqlite_required');
        $root = $p['releaseRoot'] ?? null;
        if (!is_string($root) || realpath($root) !== $root) self::fail('release_root');
        $hashes = $p['sourceHashes'] ?? [];
        self::keys($hashes, ['lib/Db.php','lib/Store.php','lib/Reminder.php','api/index.php']);
        foreach ($hashes as $relative => $expected) {
            if (!is_string($expected) || !preg_match('/^[a-f0-9]{64}$/D', $expected) || !is_file($root . '/' . $relative)
                || !hash_equals($expected, hash_file('sha256', $root . '/' . $relative))) self::fail('release_changed');
        }
    }
    private static function fresh(mixed $at): void {
        $stamp = is_string($at) && preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/D', $at) ? strtotime($at) : false;
        if ($stamp === false || gmdate('Y-m-d\TH:i:s\Z', $stamp) !== $at || $stamp > time() || time() - $stamp > 30) self::fail('evidence_expired');
    }
    private static function patient(array $p): void {
        $patient = Db::i()->get('patient', $p['patientId']);
        if (!$patient || !empty($patient['deleted']) || preg_replace('/[\s　]+/u', '', $patient['name'] ?? '') !== preg_replace('/[\s　]+/u', '', $p['patientName'])) self::fail('patient_changed');
    }
    private static function owned(string $id, array $p, array $by): array {
        if ($id !== $p['reservationId'] || !is_string($by['id'] ?? null) || $by['id'] === '') self::fail('scope');
        $r = Db::i()->get('reservation', $id);
        if (!$r || ($r['id'] ?? '') !== $id || ($r['patientId'] ?? '') !== $p['patientId'] || ($r['createdBy']['id'] ?? '') !== $by['id']
            || ($r['requestId'] ?? '') !== $p['requestId'] || ($r['safePilotRevision'] ?? '') !== $p['safePilotRevision']) self::fail('owner_or_source');
        return $r;
    }
    private static function minimal(array $r): array {
        return array_intersect_key($r, array_flip(['id','patientId','version','status','laneId','menuIds','startAt','endAt','memo','requestId']));
    }
    private static function iso(string $date, int $minute): string { return $date . sprintf('T%02d:%02d:00+09:00', intdiv($minute,60), $minute%60); }
    private static function target(array $t, array $p): void {
        self::keys($t, ['date','laneId','menuId','start','end']);
        foreach (['date','laneId','menuId'] as $k) if ($t[$k] !== $p[$k]) self::fail('target_scope');
        if (!is_int($t['start']) || !is_int($t['end']) || $t['start'] % 5 || $t['end'] - $t['start'] !== 20
            || !in_array($t['start'], $p['allowedStarts'], true)) self::fail('target_time');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $t['date'], new DateTimeZone('Asia/Tokyo'));
        if (!$date || $date->format('Y-m-d') !== $t['date'] || $date->format('N') !== '3' || strtotime(self::iso($t['date'], $t['start'])) <= time()) self::fail('target_date');
        // Store::clinic calls init, which can seed or purge unrelated records.
        // Require an existing clinic definition; never run those migrations here.
        $db = Db::i(); $menu = $db->get('menu', $p['menuId']); $lane = $db->get('lane', $p['laneId']); $c = $db->meta('clinic') ?? config()['clinic'] ?? [];
        if (!$menu || empty($menu['active']) || !empty($menu['deleted']) || ($menu['name'] ?? '') !== $p['menuName']
            || ($menu['duration']['kind'] ?? '') !== 'fixed' || ($menu['duration']['minutes'] ?? 0) !== 20 || !in_array($p['laneId'], $menu['laneIds'] ?? [], true)
            || !$lane || empty($lane['active']) || !empty($lane['deleted']) || ($c['slotMin'] ?? null) !== 5
            || !is_int($c['dayStartMin'] ?? null) || !is_int($c['dayEndMin'] ?? null) || $t['start'] < $c['dayStartMin'] || $t['end'] > $c['dayEndMin']) self::fail('catalog_changed');
        $note = $db->get('dayNote', $p['date'] . '|' . $p['laneId']);
        if (trim((string)($note['text'] ?? '')) !== '') self::fail('day_note');
        $start = strtotime(self::iso($p['date'], $t['start'])); $end = strtotime(self::iso($p['date'], $t['end']));
        foreach ($db->where('reservation', 'k1', $p['date']) as $other) {
            if (($other['id'] ?? '') === $p['reservationId'] || in_array($other['status'] ?? '', ['cancelled','no_show'], true)) continue;
            if (($other['laneId'] ?? '') !== $p['laneId'] && !in_array('menu-s0000C60FE', $other['menuIds'] ?? [], true)) continue;
            $a = strtotime($other['startAt'] ?? ''); $z = strtotime($other['endAt'] ?? '');
            if ($a === false || $z === false || $z <= $a || !in_array($other['status'] ?? '', ['booked','arrived','in_treatment','checkout','done'], true)) self::fail('occupancy_unknown');
            if ($a < $end && $z > $start) self::fail('overlap');
        }
    }
    public static function payloadHash(array $in): string {
        // Fixed order; approval does not silently depend on JSON property order.
        return self::digest([$in['operationId'], $in['reservationId'], $in['version'], $in['operation'], $in['target'], $in['memoHash']]);
    }
    public static function m3SourceHash(array $m): string {
        // Approval binds the source facts, not the instant of a later reread.
        // mutate() still checks exact fields and freshness before using this.
        return self::digest([$m['patientId'] ?? null, $m['visitId'] ?? null,
            $m['originalCount'] ?? null, $m['replacementCount'] ?? null, $m['sourceVersion'] ?? null,
            $m['startAt'] ?? null, $m['endAt'] ?? null, $m['memoHash'] ?? null]);
    }
    public static function mutate(array $in, array $by): array {
        self::keys($in, ['operationId','reservationId','version','operation','target','memoHash','observedAt','m3Proof']);
        if (!is_string($in['operationId']) || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D', $in['operationId'])
            || !is_int($in['version']) || $in['version'] < 1 || !in_array($in['operation'], ['change','cancel'], true)
            || !is_string($in['memoHash']) || !preg_match('/^[a-f0-9]{64}$/D', $in['memoHash']) || !is_array($in['m3Proof'])) self::fail('request_invalid');
        if (($in['operation'] === 'change' && !is_array($in['target'])) || ($in['operation'] === 'cancel' && $in['target'] !== null)) self::fail('target_invalid');
        $p = self::policy(); self::release($p);
        // Do NOT call Store::init: source inspection found unrelated seed/purge paths.
        return Db::i()->transaction(function() use($in,$p,$by) {
            if (self::policy() !== $p) self::fail('policy_changed_while_waiting');
            self::release($p);
            self::fresh($in['observedAt']); self::patient($p);
            $approval = $p['approval'] ?? null;
            if (!is_array($approval) || ($approval['payloadHash'] ?? '') !== self::payloadHash($in)
                || ($approval['actor'] ?? '') !== 'explicit_human' || !is_int($approval['expiresAt'] ?? null) || $approval['expiresAt'] < time()) self::fail('approval_missing');
            $m = $in['m3Proof']; self::keys($m,['patientId','visitId','originalCount','replacementCount','sourceVersion','startAt','endAt','memoHash','observedAt']);
            self::fresh($m['observedAt']);
            if (($approval['m3SourceHash'] ?? '') !== self::m3SourceHash($m) || $m['patientId'] !== $p['m3PatientId'] || $m['visitId'] !== $p['m3VisitId']
                || $m['originalCount'] !== 1 || $m['replacementCount'] !== 0 || $m['sourceVersion'] !== $in['version']
                || !is_string($m['memoHash']) || !preg_match('/^[a-f0-9]{64}$/D', $m['memoHash'])) self::fail('m3_inconsistent');
            $db = Db::i(); $r = self::owned($in['reservationId'], $p, $by);
            $sourceStart = strtotime($r['startAt'] ?? ''); $sourceEnd = strtotime($r['endAt'] ?? '');
            if (($r['version'] ?? null) !== $in['version'] || ($r['status'] ?? '') !== 'booked' || ($r['laneId'] ?? '') !== $p['laneId']
                || ($r['menuIds'] ?? []) !== [$p['menuId']] || substr($r['startAt'] ?? '',0,10) !== $p['date']
                || substr($r['endAt'] ?? '',0,10) !== $p['date'] || $sourceStart === false || $sourceEnd === false || $sourceStart <= time() || $sourceEnd - $sourceStart !== 1200
                || $m['startAt'] !== $r['startAt'] || $m['endAt'] !== $r['endAt']) self::fail('source_conflict');
            if (!is_string($r['memo'] ?? null) || !hash_equals($in['memoHash'],hash('sha256',$r['memo']))
                || preg_match('/Air予約番号\s*[:：]/u',strip_tags($r['memo'])) === 1 || !empty($r['fromAir'])
                || ($r['reminder']['status'] ?? '') !== 'skipped' || ($r['reminder']['reason'] ?? '') !== 'fixed_test_pilot') self::fail('memo_origin_notification');
            $key = hash('sha256', $by['id'] . '|' . $in['operationId']);
            if ($db->get('safeMutationReceipt', $key)) self::fail('already_attempted_readonly_reconcile');
            $matches = 0;
            foreach ($db->where('reservation','k2',$p['patientId']) as $prior) if (($prior['requestId'] ?? '') === $p['requestId']) $matches++;
            if ($matches !== 1) self::fail('request_not_unique');
            $next = $r;
            if ($in['operation'] === 'change') {
                self::target($in['target'],$p);
                $next['startAt'] = self::iso($p['date'],$in['target']['start']); $next['endAt'] = self::iso($p['date'],$in['target']['end']);
                if ($next['startAt'] === $r['startAt']) self::fail('no_change');
            } else {
                $next['status'] = 'cancelled';
                // Preserve the current application's cancellation-history
                // contract without invoking generic writes/LINE auto-linking.
                $next['cancelledAt'] = now_iso();
                $next['cancelledBy'] = $by;
            }
            $next['version'] = $r['version'] + 1;
            $next['updatedAt'] = now_iso();
            $next['updatedBy'] = $by;
            // Same connection BEGIN IMMEDIATE protects get/version/occupancy/put.
            // Do not call generic updateReservation or emit reminder/LINE effects.
            $db->put('reservation',$r['id'],$next);
            $db->put('safeMutationReceipt',$key,['reservationId'=>$r['id'],'operationId'=>$in['operationId'],'operation'=>$in['operation'],
                'beforeVersion'=>$r['version'],'version'=>$next['version'],'payloadHash'=>self::payloadHash($in),'createdAt'=>now_iso()]);
            Auth::audit($by, $in['operation'] === 'change' ? '固定試験予約を変更（時間）' : '固定試験予約を変更（状態→キャンセル）', $r['id']);
            $stored = self::owned($r['id'],$p,$by);
            if ($stored !== $next) self::fail('stored_mismatch');
            return self::minimal($stored);
        });
    }
}
