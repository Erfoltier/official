import {it,expect} from 'vitest';
import {cpSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
it.each(['m11','m12','a36','a39'])('%sの指定本人・指定施術時間・13→14時・取消だけを許可する',async(kind)=>{
 const root=mkdtempSync(join(tmpdir(),'m11-pilot-')),app=join(root,'php');cpSync(resolve('php'),app,{recursive:true});
 const config=join(root,'config.php');writeFileSync(config,"<?php return ['db_dsn'=>'sqlite:'.__DIR__.'/synthetic.db','encryption_key'=>str_repeat('1',64),'session_secret'=>str_repeat('s',40),'initial_admin_pin'=>'123456','keep_sample_patients'=>true,'line_test_mode'=>true];");
 const {stdout}=await promisify(execFile)('php',['-d','display_errors=stderr',resolve('src/lib/__tests__/php/m11-pilot.php'),app,kind],{env:{...process.env,RESERVE_CONFIG:config},timeout:30000});
 const result=JSON.parse(stdout);expect(result.verified).toBe(true);expect(result.checks).toBeGreaterThanOrEqual(50);expect(result.productionWrites).toBe(0);expect(result.patientUnchanged).toBe(true);expect(result.sideEffectsSuppressed).toBe(true);
});
