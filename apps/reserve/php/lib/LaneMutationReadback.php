<?php
declare(strict_types=1);
/** Independent read-only SQLite snapshot. No app bootstrap or credentials.
 * The trusted caller opens mode=ro, sets query_only, and supplies the reviewed
 * decryption function. Neither callback nor binding may come from an HTTP body.
 */
final class LaneMutationReadback
{
    public static function inspect(PDO $pdo, callable $decode, array $binding, string $operationId, string $ownerId): array {
        if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite' || (int)$pdo->query('PRAGMA query_only')->fetchColumn() !== 1
            || $pdo->inTransaction() || $ownerId === '' || !preg_match('/^[A-Za-z0-9_-]{16,80}$/D',$operationId)) throw new RuntimeException('readonly_contract');
        foreach(['patientId','patientName','reservationId','requestId','safePilotRevision'] as $key) if(!is_string($binding[$key]??null)||$binding[$key]==='')throw new RuntimeException('binding');
        $get = function(string $kind,string $id) use($pdo,$decode) {
            $s=$pdo->prepare('SELECT data FROM docs WHERE kind=? AND id=?'); $s->execute([$kind,$id]); $data=$s->fetchColumn();
            return $data===false?null:$decode($data);
        };
        $pdo->beginTransaction();
        try {
            $patient=$get('patient',$binding['patientId']); $r=$get('reservation',$binding['reservationId']);
            if(!$patient||!empty($patient['deleted'])||preg_replace('/[\s　]+/u','',$patient['name']??'')!==preg_replace('/[\s　]+/u','',$binding['patientName'])
                ||!$r||($r['id']??'')!==$binding['reservationId']||($r['patientId']??'')!==$binding['patientId']||($r['createdBy']['id']??'')!==$ownerId
                ||($r['requestId']??'')!==$binding['requestId']||($r['safePilotRevision']??'')!==$binding['safePilotRevision'])throw new RuntimeException('scope');
            $receipt=$get('safeMutationReceipt',hash('sha256',$ownerId.'|'.$operationId));
            if($receipt&&(($receipt['reservationId']??'')!==$r['id']||($receipt['operationId']??'')!==$operationId))throw new RuntimeException('receipt_scope');
            $out=['reservation'=>array_intersect_key($r,array_flip(['id','patientId','version','status','laneId','menuIds','startAt','endAt','memo','requestId'])),
                'receipt'=>$receipt?array_intersect_key($receipt,array_flip(['reservationId','operationId','operation','beforeVersion','version','payloadHash','createdAt'])):null,
                'notificationStoredSuppressed'=>($r['reminder']['status']??'')==='skipped'&&($r['reminder']['reason']??'')==='fixed_test_pilot',
                'observedAt'=>gmdate('Y-m-d\TH:i:s\Z'),'automaticRetry'=>false,'externalWrites'=>0,'complete'=>false];
            // Stored status is not proof that the independent Reminder job excludes it.
            $pdo->commit(); return $out;
        } catch(Throwable $e) {$pdo->rollBack();throw $e;}
    }
}
