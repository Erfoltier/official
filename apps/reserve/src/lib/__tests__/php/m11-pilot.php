<?php
// Disposable copied source and encrypted SQLite only. Never use a live config.
require $argv[1].'/lib/bootstrap.php';
require $argv[1].'/lib/LaneBookingSafety.php';
require $argv[1].'/lib/LaneMutationSafety.php';
$root=realpath($argv[1]);$db=Db::i();$checks=0;
$m12=($argv[2]??'m11')==='m12';
$minutes=$m12?15:10;
$requestId=$m12?'R20261029LaneM12R0106Main1300':'R20261028LaneM11R0106Main1300';
$revision=$m12?'fixed-m12r-jan2027-20261029-v1':'fixed-m11r-jan2027-20261028-v1';
$originalBookingPolicy=require $root.'/lib/LaneBookingPolicy.php';
$check=function(bool $ok)use(&$checks):void{if(!$ok)throw new RuntimeException('assertion_failed_'.($checks+1));$checks++;};
$set=function(string $name,array $p)use($root):void{file_put_contents($root.'/lib/'.$name.'.php','<?php return '.var_export($p,true).';');};
$db->setMeta('initialized',true);$db->setMeta('clinic',['slotMin'=>5,'dayStartMin'=>540,'dayEndMin'=>1140]);
$patient=['id'=>'p-new-muw2osez-7b5626','name'=>'試験 太郎','kana'=>'シケン タロウ','chartNo'=>'10001','version'=>1];
$sentinel=['id'=>'synthetic-unrelated','name'=>'合成保全','version'=>1];
$db->put('patient',$patient['id'],$patient);$db->put('patient',$sentinel['id'],$sentinel);
$db->put('lane','lane-main',['id'=>'lane-main','name'=>'メイン','active'=>true]);
$menu=['id'=>$m12?'menu-x103':'menu-x021','name'=>$m12?'Qスイッチルビーレーザー（シミ）':'再診 色素レーザー','active'=>true,'duration'=>$m12?['kind'=>'range','min'=>5,'max'=>60,'step'=>5]:['kind'=>'fixed','minutes'=>10],'defaultMinutes'=>$minutes,'laneIds'=>['lane-main']];$db->put('menu',$menu['id'],$menu);
$p=['mode'=>'fixed_test','enabled'=>true,'externalCalendarIsolated'=>true,'revision'=>$revision,
 'patientId'=>$patient['id'],'patientName'=>$patient['name'],'requestId'=>$requestId,
 'date'=>'2027-01-06','laneId'=>'lane-main','menuId'=>$menu['id'],'menuName'=>$menu['name'],'minutes'=>$minutes,'start'=>780,'end'=>780+$minutes,'expiresAt'=>time()+110];
$by=['id'=>'booking:synthetic','name'=>'合成試験','role'=>'integration'];
$slot=['date'=>$p['date'],'laneId'=>$p['laneId'],'menuId'=>$p['menuId'],'start'=>780,'end'=>780+$minutes,'nonce'=>str_repeat('a',20)];
$set('LaneBookingPolicy',$p);$a=LaneBookingSafety::availability($slot);$check($a['scope']===($m12?'fixed_test_main_q_ruby_only':'fixed_test_main_pigment_only')&&$a['status']==='available');
$in=['patientId'=>$patient['id'],'requestId'=>$p['requestId'],'memo'=>'合成試験原文 '.$p['requestId'],'slot'=>$slot,'revision'=>$a['revision'],'observedAt'=>$a['observedAt']];
$reject=function(callable $fn)use($db,$check):void{$before=$db->all('reservation');$failed=false;try{$fn();}catch(StoreError){$failed=true;}$check($failed);$check($before===$db->all('reservation'));};
foreach([['enabled'=>false],['externalCalendarIsolated'=>false],['patientId'=>'other'],['patientName'=>'試験 花子'],['date'=>'2026-12-31'],['date'=>'2026-12-30'],['date'=>'2027-01-13'],['requestId'=>'R20261027LaneM11R1230Main1300'],['revision'=>'fixed-m11r-20261027-v1'],['start'=>840,'end'=>850],['minutes'=>20],['menuId'=>'menu-s000099B91'],['menuName'=>'wrong'],['requestId'=>'R20261027OtherTrial'],['expiresAt'=>time()-1],['expiresAt'=>time()+300]] as $patch){$set('LaneBookingPolicy',array_merge($p,$patch));$reject(fn()=>LaneBookingSafety::create($in,$by));}
$set('LaneBookingPolicy',$p);$reject(fn()=>LaneBookingSafety::create(array_merge($in,['requestId'=>'R20261027OtherRequest']),$by));
if($m12){
 foreach([['defaultMinutes'=>20],['duration'=>['kind'=>'fixed','minutes'=>15]],['duration'=>['kind'=>'range','min'=>10,'max'=>60,'step'=>5]],['laneIds'=>['lane-main','lane-1']]] as $patch){
  $db->put('menu',$menu['id'],array_merge($menu,$patch));$reject(fn()=>LaneBookingSafety::create($in,$by));
 }
 $db->put('menu',$menu['id'],$menu);
}
$r=LaneBookingSafety::create($in,$by);$check($r['version']===1&&$r['startAt']==='2027-01-06T13:00:00+09:00'&&$r['endAt']==='2027-01-06T13:'.$minutes.':00+09:00');
$check(LaneBookingSafety::create($in,$by)['id']===$r['id']);$check(count($db->all('reservation'))===1);
$check($db->get('patient',$patient['id'])===$patient&&$db->get('patient',$sentinel['id'])===$sentinel);
$check($db->meta('slotMenusSeeded')===null&&$db->meta('stagesSeeded')===null);
$hashes=[];foreach(['lib/Db.php','lib/Store.php','lib/Reminder.php','api/index.php'] as $path)$hashes[$path]=hash_file('sha256',$root.'/'.$path);
$m=['patientId'=>'2117349','visitId'=>'99990001','originalCount'=>1,'replacementCount'=>0,'sourceVersion'=>1,'startAt'=>$r['startAt'],'endAt'=>$r['endAt'],'memoHash'=>hash('sha256','合成受付メモ'),'observedAt'=>gmdate('Y-m-d\TH:i:s\Z')];
$body=['operationId'=>$p['requestId'].'Change','reservationId'=>$r['id'],'version'=>1,'operation'=>'change',
 'target'=>['date'=>$p['date'],'laneId'=>$p['laneId'],'menuId'=>$p['menuId'],'start'=>840,'end'=>840+$minutes],
 'memoHash'=>hash('sha256',$r['memo']),'observedAt'=>$m['observedAt'],'m3Proof'=>$m];
$mp=['contract'=>'atomic-fixed-mutation-v1','enabled'=>true,'sourceCompatibilityVerified'=>true,'externalCalendarIsolated'=>true,
 'patientId'=>$patient['id'],'patientName'=>$patient['name'],'reservationId'=>$r['id'],'requestId'=>$p['requestId'],
 'm3PatientId'=>'2117349','m3VisitId'=>$m['visitId'],'date'=>$p['date'],'laneId'=>$p['laneId'],'menuId'=>$p['menuId'],'menuName'=>$p['menuName'],
 'safePilotRevision'=>$p['revision'],'allowedStarts'=>[840],'releaseRoot'=>$root,'sourceHashes'=>$hashes];
$approve=function(array $base,array $b)use($set):array{$base['approval']=['actor'=>'explicit_human','payloadHash'=>LaneMutationSafety::payloadHash($b),'m3SourceHash'=>LaneMutationSafety::m3SourceHash($b['m3Proof']),'expiresAt'=>time()+110];$set('LaneMutationPolicy',$base);return $base;};
$mp=$approve($mp,$body);
foreach([['patientId'=>'other'],['requestId'=>'R20261027OtherTrial'],['menuId'=>'menu-s000099B91'],['allowedStarts'=>[780,840]],['enabled'=>false]] as $patch){$set('LaneMutationPolicy',array_merge($mp,$patch));$reject(fn()=>LaneMutationSafety::mutate($body,$by));}
$set('LaneMutationPolicy',$mp);
foreach([['operationId'=>$p['requestId'].'Other'],['target'=>array_merge($body['target'],['end'=>860])],['version'=>2],['m3Proof'=>array_merge($m,['visitId'=>'99990002'])],['observedAt'=>'2020-01-01T00:00:00Z']] as $patch){$bad=array_merge($body,$patch);$approve($mp,$bad);$reject(fn()=>LaneMutationSafety::mutate($bad,$by));}
$approve($mp,$body);
if($m12){
 foreach([['defaultMinutes'=>20],['duration'=>['kind'=>'fixed','minutes'=>15]],['laneIds'=>['lane-main','lane-1']]] as $patch){
  $db->put('menu',$menu['id'],array_merge($menu,$patch));$reject(fn()=>LaneMutationSafety::mutate($body,$by));
 }
 $db->put('menu',$menu['id'],$menu);
}
$changed=LaneMutationSafety::mutate($body,$by);$check($changed['version']===2&&$changed['startAt']==='2027-01-06T14:00:00+09:00'&&$changed['endAt']==='2027-01-06T14:'.$minutes.':00+09:00'&&$changed['memo']===$r['memo']);
$reject(fn()=>LaneMutationSafety::mutate($body,$by));
$cancel=array_merge($body,['operationId'=>$p['requestId'].'Cancel','operation'=>'cancel','version'=>2,'target'=>null,
 'm3Proof'=>array_merge($m,['visitId'=>'99990002','sourceVersion'=>2,'startAt'=>$changed['startAt'],'endAt'=>$changed['endAt']])]);
$mp['m3VisitId']='99990002';$approve($mp,$cancel);
$done=LaneMutationSafety::mutate($cancel,$by);$check($done['status']==='cancelled'&&$done['version']===3&&$done['memo']===$r['memo']);
$reject(fn()=>LaneMutationSafety::mutate($cancel,$by));
$set('LaneBookingPolicy',$originalBookingPolicy);
$check(LaneBookingSafety::read($r['id'],$by)['version']===3);
$reject(fn()=>LaneBookingSafety::read($r['id'],['id'=>'booking:other']));
$saved=$db->get('reservation',$r['id']);
foreach([['requestId'=>'R20261027OtherTrial'],['patientId'=>'synthetic-unrelated'],['version'=>4],['menuIds'=>['menu-s000099B91']],['startAt'=>'2027-01-06T15:00:00+09:00']] as $patch){
 $db->put('reservation',$r['id'],array_merge($saved,$patch));$reject(fn()=>LaneBookingSafety::read($r['id'],$by));
}
$db->put('reservation',$r['id'],$saved);
$check($db->get('patient',$patient['id'])===$patient&&$db->get('patient',$sentinel['id'])===$sentinel);
$check($db->get('reservation',$r['id'])['reminder']['status']==='skipped');
$check($db->meta('slotMenusSeeded')===null&&$db->meta('stagesSeeded')===null);
echo json_encode(['verified'=>true,'checks'=>$checks,'createChangeCancel'=>true,'productionWrites'=>0,'patientUnchanged'=>true,'sideEffectsSuppressed'=>true]);
