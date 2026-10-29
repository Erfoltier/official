import {it, expect} from "vitest";
import {cpSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

it("指定された既存試験患者・申請・日時・期限だけを許可し、患者を変更しない", async () => {
  const root=mkdtempSync(join(tmpdir(),"hanako-pilot-"));
  const app=join(root,"php");cpSync(resolve("php"),app,{recursive:true});
  const config=join(root,"config.php");
  writeFileSync(config,"<?php return ['db_dsn'=>'sqlite:'.__DIR__.'/synthetic.db','encryption_key'=>str_repeat('1',64),'session_secret'=>str_repeat('s',40),'initial_admin_pin'=>'123456','keep_sample_patients'=>true,'line_test_mode'=>true];");
  const {stdout}=await promisify(execFile)("php",["-d","display_errors=stderr",resolve("src/lib/__tests__/php/hanako-pilot.php"),app],{env:{...process.env,RESERVE_CONFIG:config},timeout:30000});
  expect(JSON.parse(stdout)).toEqual({verified:true,rejections:16,createdExactlyOnce:true,patientUnchanged:true,reminderSuppressed:true});
});
