<?php
declare(strict_types=1);

/** Booking-authenticated, fixed fictitious identity only. Does not invoke
 * Store::init/createPatient: those can seed/purge or auto-link questionnaires.
 * Patient/history/receipt/audit commit together, no message or chart side effect.
 */
final class LanePatientSafety {
    private static function fail(string $why):never { throw new StoreError('conflict','patient safety: '.$why); }
    private static function keys(array $value,array $keys):void {
        $actual=array_keys($value);sort($actual);sort($keys);if($actual!==$keys)self::fail('fields');
    }
    public static function hash(mixed $value):string {return hash('sha256',json_encode($value,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));}
    private static function identity(array $i):array {
        self::keys($i,['name','kana','birthDate','phone']);
        foreach($i as $v)if(!is_string($v)||$v===''||preg_match('/[\x00-\x1f\x7f<>]/u',$v))self::fail('identity');
        if(mb_strlen($i['name'])>60||mb_strlen($i['kana'])>60||!preg_match('/^\d{10,11}$/D',$i['phone']))self::fail('identity');
        $d=DateTimeImmutable::createFromFormat('!Y-m-d',$i['birthDate'],new DateTimeZone('Asia/Tokyo'));
        if(!$d||$d->format('Y-m-d')!==$i['birthDate']||$i['birthDate']>date('Y-m-d'))self::fail('birth_date');
        // The client sends canonical fields; reject normalization discrepancies.
        if(js_trim(normalize_width($i['name']))!==$i['name']||mb_convert_kana(js_trim($i['kana']),'KVC','UTF-8')!==$i['kana'])self::fail('noncanonical_identity');
        return ['name'=>$i['name'],'kana'=>$i['kana'],'birthDate'=>$i['birthDate'],'phone'=>$i['phone']];
    }
    private static function policy(array $by):array {
        $p=require __DIR__.'/LanePatientPolicy.php';
        if(!is_array($p)||($p['contract']??'')!=='atomic-fixed-patient-v1'||!is_array($p['identity']??null)
            ||!preg_match('/^R[0-9][A-Za-z0-9_-]{15,79}$/D',$p['requestId']??'')||!str_starts_with($by['id']??'','booking:'))self::fail('binding');
        $p['identity']=self::identity($p['identity']);
        // This contract is not a general patient creation endpoint.
        if(!str_starts_with(preg_replace('/[\s　]+/u','',$p['identity']['name']),'試験')
            ||preg_replace('/[\s　]+/u','',$p['identity']['name'])==='試験太郎')self::fail('distinct_test_identity_required');
        return $p;
    }
    private static function ready(array $p):void {
        if(($p['enabled']??false)!==true||($p['sourceCompatibilityVerified']??false)!==true||($p['externalPatientWritersIsolated']??false)!==true)self::fail('disabled');
        if(!str_starts_with(config()['db_dsn']??'','sqlite:')||!is_string($p['releaseRoot'])||realpath($p['releaseRoot'])!==$p['releaseRoot'])self::fail('release');
        self::keys($p['sourceHashes'],['lib/Db.php','lib/Store.php','lib/Auth.php','lib/Text.php','api/index.php']);
        foreach($p['sourceHashes'] as $file=>$h)if(!is_string($h)||!preg_match('/^[a-f0-9]{64}$/D',$h)||!hash_equals($h,hash_file('sha256',$p['releaseRoot'].'/'.$file)))self::fail('release_changed');
        $a=$p['approval']??null;
        if(!is_array($a)||($a['actor']??'')!=='explicit_human'||!is_int($a['expiresAt']??null)||$a['expiresAt']<time()
            ||($a['binding']??'')!==self::hash(['requestId'=>$p['requestId'],'identityHash'=>self::hash($p['identity']),'visitType'=>'initial']))self::fail('approval');
    }
    private static function candidates(array $identity):array {
        $norm=fn($v)=>fold_name_variants(search_key((string)$v));$hits=[];
        // No candidate records leave the server. Deleted or incompletely
        // identified same-name records still prevent an automatic duplicate.
        foreach(Db::i()->all('patient') as $id=>$p){
            if($norm($p['name']??'')===$norm($identity['name'])||$norm($p['kana']??'')===$norm($identity['kana'])
                ||digits_only((string)($p['phone']??''))===$identity['phone'])$hits[$id]=$p;
        }
        ksort($hits);return $hits;
    }
    private static function projection(array $p,array $by):array {
        $identityHash=self::hash($p['identity']);$hits=self::candidates($p['identity']);
        $receipt=Db::i()->get('safePatientReceipt',hash('sha256',$by['id'].'|'.$p['requestId']));
        $patient=$receipt?Db::i()->get('patient',$receipt['patientId']??''):null;
        $owned=$patient&&($patient['registrationOwner']??'')===$by['id']&&($patient['registrationRequestId']??'')===$p['requestId']
            &&($receipt['identityHash']??'')===$identityHash&&!empty($patient['id'])&&empty($patient['deleted']);
        $ready=true;try{self::ready($p);}catch(StoreError){$ready=false;}
        return ['contract'=>$p['contract'],'requestId'=>$p['requestId'],'identityHash'=>$identityHash,'complete'=>true,
            'matchCount'=>count($hits),'revision'=>self::hash([$identityHash,$hits]),'atomicAvailable'=>$ready,'observedAt'=>gmdate('Y-m-d\TH:i:s\Z'),
            'ownershipVerified'=>(bool)$owned,'receipt'=>$receipt,
            'patient'=>$owned?['id'=>$patient['id'],'identityHash'=>self::hash(array_intersect_key($patient,array_flip(['name','kana','birthDate','phone']))),
                'needsReview'=>$patient['needsReview']??null,'registrationRequestId'=>$patient['registrationRequestId']]:null];
    }
    public static function inspect(string $requestId,string $identityHash,array $by):array {
        $p=self::policy($by);
        if($requestId!==$p['requestId']||$identityHash!==self::hash($p['identity']))self::fail('scope');
        return Db::i()->transaction(fn()=>self::projection($p,$by));
    }
    public static function create(array $in,array $by):array {
        self::keys($in,['requestId','identity','identityHash','revision','observedAt']);$p=self::policy($by);self::ready($p);
        if(!is_array($in['identity'])||self::identity($in['identity'])!==$p['identity']||$in['identityHash']!==self::hash($p['identity'])||$in['requestId']!==$p['requestId'])self::fail('scope');
        return Db::i()->transaction(function()use($in,$p,$by){
            if(self::policy($by)!==$p)self::fail('policy_changed');self::ready($p);
            $at=is_string($in['observedAt'])?strtotime($in['observedAt']):false;
            if($at===false||gmdate('Y-m-d\TH:i:s\Z',$at)!==$in['observedAt']||$at>time()||time()-$at>30)self::fail('stale_evidence');
            $before=self::projection($p,$by);
            if($before['matchCount']!==0||$before['receipt']!==null||$before['revision']!==$in['revision'])self::fail('duplicate_or_changed');
            $db=Db::i();$id=new_id('p-new');if($db->get('patient',$id))self::fail('id_collision');$at=now_iso();
            $patient=['id'=>$id,...$p['identity'],'chartNo'=>'','version'=>1,'updatedAt'=>$at,'needsReview'=>'booking',
                'registrationOwner'=>$by['id'],'registrationRequestId'=>$p['requestId'],'safePatientContract'=>$p['contract']];
            $db->put('patient',$id,$patient);
            $db->put('patientHistory',$id,[['at'=>$at,'fields'=>['新規登録'],'by'=>$by]]);
            $receipt=['requestId'=>$p['requestId'],'identityHash'=>$in['identityHash'],'patientId'=>$id,'createdAt'=>$at];
            $db->put('safePatientReceipt',hash('sha256',$by['id'].'|'.$p['requestId']),$receipt);
            Auth::audit($by,'固定試験患者を新規登録',$id);
            if($db->get('patient',$id)!==$patient)self::fail('readback');
            return ['accepted'=>true,'patientId'=>$id,'completionVerified'=>false];
        });
    }
}
