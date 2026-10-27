<?php
// Only called with a disposable copied PHP tree and synthetic configuration.
require $argv[1] . '/lib/bootstrap.php';
require $argv[1] . '/lib/LaneBookingSafety.php';
$policyPath = $argv[1] . '/lib/LaneBookingPolicy.php';
$base = require $policyPath;
$set = function(array $p) use ($policyPath): void { file_put_contents($policyPath, '<?php return ' . var_export($p, true) . ';'); };
$check = function(bool $ok): void { if (!$ok) throw new RuntimeException('assertion_failed'); };
Store::init(); $db=Db::i();
$patient=['id'=>'p-new-muw2qgcj-124d9a','name'=>'試験 花子','kana'=>'シケン ハナコ','chartNo'=>'10087','version'=>1,'deleted'=>false];
$db->put('patient',$patient['id'],$patient);
$db->put('lane','lane-main',['id'=>'lane-main','name'=>'メイン','active'=>true]);
$db->put('menu','menu-s000099B91',['id'=>'menu-s000099B91','name'=>'シミまとめ標準20分','active'=>true,'duration'=>['kind'=>'fixed','minutes'=>20],'laneIds'=>['lane-main']]);
$p=array_merge($base,['enabled'=>true,'externalCalendarIsolated'=>true,'patientName'=>'試験 花子','patientId'=>$patient['id'],
 'revision'=>'fixed-hanako-20261027-v1','requestId'=>'R20261027LaneHanako1230Main1100','date'=>'2026-12-30','start'=>660,'end'=>680,'expiresAt'=>time()+110]);
$slot=['date'=>'2026-12-30','laneId'=>'lane-main','menuId'=>'menu-s000099B91','start'=>660,'end'=>680,'nonce'=>str_repeat('a',20)];
$by=['id'=>'synthetic-booking-actor','name'=>'合成試験','role'=>'integration'];
$input=['patientId'=>$patient['id'],'requestId'=>$p['requestId'],'memo'=>'合成試験 '.$p['requestId'],'slot'=>$slot,'revision'=>'','observedAt'=>gmdate('Y-m-d\TH:i:s\Z')];
$set($p);$initial=LaneBookingSafety::availability($slot);$input['revision']=$initial['revision'];$input['observedAt']=$initial['observedAt'];
$reject=function(array $policy,array $body)use($set,$check,$db,$by):void{
 $set($policy);$before=$db->all('reservation');$failed=false;
 try{LaneBookingSafety::create($body,$by);}catch(StoreError $error){
  // A stale/invalid availability fixture must not falsely prove an identity gate.
  $check(!str_contains($error->getMessage(),'availability_'));$failed=true;
 }
 $check($failed);$check($before===$db->all('reservation'));
};
foreach ([['patientId'=>'other'],['date'=>'2026-12-31'],['start'=>720,'end'=>740],['requestId'=>'R20261027DifferentScope'],['revision'=>'other'],['expiresAt'=>time()-1],['expiresAt'=>time()+500],['enabled'=>false],['externalCalendarIsolated'=>false]] as $patch) $reject(array_merge($p,$patch),$input);
$reject($p,array_merge($input,['requestId'=>'R20261027DifferentRequest']));
foreach ([['name'=>'別人'],['kana'=>'ベツジン'],['chartNo'=>'other'],['birthDate'=>'2001-01-01'],['phone'=>'00000000000'],['deleted'=>true]] as $patch){
 $db->put('patient',$patient['id'],array_merge($patient,$patch));$reject($p,$input);
}
$db->put('patient',$patient['id'],$patient);$set($p);
$check(LaneBookingSafety::testPatient()['patientId']===$patient['id']);
$a=LaneBookingSafety::availability($slot);$check($a['status']==='available');
$input['revision']=$a['revision'];$input['observedAt']=$a['observedAt'];
$created=LaneBookingSafety::create($input,$by);
$check($created['patientId']===$patient['id']);$check($created['requestId']===$p['requestId']);
$check($db->get('patient',$patient['id'])===$patient);
$check($db->get('reservation',$created['id'])['reminder']['status']==='skipped');
$check(LaneBookingSafety::create($input,$by)['id']===$created['id']);
$set($base);
echo json_encode(['verified'=>true,'rejections'=>16,'createdExactlyOnce'=>true,'patientUnchanged'=>true,'reminderSuppressed'=>true]);
