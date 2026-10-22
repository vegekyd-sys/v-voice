import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {buildLarkReadArgv,calendarReadArgs,createVoiceLarkReader} from './lark-readonly.mjs';

function fixture(t,script){
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'voice-lark-read-')));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const config=path.join(home,'voice-lark-cli'),profile=path.join(config,'openclaw');
  fs.mkdirSync(config,{mode:0o700});fs.mkdirSync(profile,{mode:0o700});
  fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({apps:{test:{defaultAs:'user',users:[{openId:'fixture'}]}}}),{mode:0o600});
  const binary=path.join(home,'lark-fixture.mjs');
  fs.writeFileSync(binary,`#!${process.execPath}\nimport fs from 'node:fs';\n${script}`,{mode:0o700});
  const environment={HOME:home,PATH:path.dirname(process.execPath),LARKSUITE_CLI_CONFIG_DIR:config,LARKSUITE_CLI_DATA_DIR:home,OPENROUTER_API_KEY:'must-not-reach-child'};
  return {home,config,environment,binary,reader:opts=>createVoiceLarkReader({environment,binary,...opts})};
}
test('only verified read shortcuts and options accepted; identity/output/write/shell entrypoints blocked',()=>{
  assert.deepEqual(buildLarkReadArgv(['calendar','+agenda']),['calendar','+agenda','--as','user','--format','json']);
  assert.deepEqual(buildLarkReadArgv(['im','+messages-search','--help']),['im','+messages-search','--help']);
  for(const argv of [['calendar','+create'],['auth','login'],['exec','true'],['im','+messages-send'],['calendar','+agenda','--as','bot'],['calendar','+agenda','--output','x'],['calendar','+agenda','--start=@x'],['drive','+search','--query','@file'],['task','+get-my-tasks','--page-all'],['calendar','+agenda','--start','x','--start','y'],['drive','+search','--page-size','999']])assert.throws(()=>buildLarkReadArgv(argv));
});
test('calendar dates expand to Shanghai whole-day bounds and reject impossible dates',()=>{
  assert.deepEqual(calendarReadArgs({start:'2026-10-11',end:'2026-10-11'}).argv,['calendar','+agenda','--start','2026-10-11T00:00:00+08:00','--end','2026-10-11T23:59:59+08:00']);
  for(const start of ['2026-02-30','2026-13-01','today;curl'])assert.throws(()=>calendarReadArgs({start}));
});
test('actual local child gets argv verbatim, fixed user identity, private profile and no unrelated API keys',async t=>{
  const f=fixture(t,`console.log(JSON.stringify({ok:true,data:{argv:process.argv.slice(2),profile:process.env.LARKSUITE_CLI_CONFIG_DIR,tz:process.env.TZ,secret:process.env.OPENROUTER_API_KEY??null}}));`);
  const r=await f.reader().read({argv:['drive','+search','--query','$(touch malicious); & hi']},'read');
  const data=JSON.parse(r.content[0].text).data;
  assert.deepEqual(data.argv,['drive','+search','--query','$(touch malicious); & hi','--as','user','--format','json']);assert.equal(data.profile,f.config);assert.equal(data.tz,'Asia/Shanghai');assert.equal(data.secret,null);assert.equal(r.details.source,'voice-local-lark');
  assert.equal(fs.existsSync(path.join(f.home,'malicious')),false);
});
test('local calendar accepts only real business success, not zero exit or JSON alone',async t=>{
  for(const [body,exit] of [['{bad',0],['{"ok":false,"error":{"subtype":"not_bound"}}',0],['{"ok":true}',3]]){
    const f=fixture(t,`console.log(${JSON.stringify(body)});process.exit(${exit});`);
    await assert.rejects(f.reader().calendar({},'calendar'),/未成功/);
  }
});
test('private identity fails closed before any executable starts, including symlink and shared permissions',async t=>{
  const f=fixture(t,`fs.writeFileSync(process.env.HOME+'/started','yes');console.log('{"ok":true}');`);
  fs.chmodSync(f.config,0o755);await assert.rejects(f.reader().calendar({}),/私有/);assert(!fs.existsSync(f.home+'/started'));
  fs.chmodSync(f.config,0o700);const file=f.config+'/openclaw/config.json';fs.renameSync(file,file+'.old');fs.symlinkSync(file+'.old',file);await assert.rejects(f.reader().calendar({}),/私有/);
  await assert.rejects(createVoiceLarkReader({environment:{}}).calendar({}),/未就绪/);
});
test('abort waits for actual OS close and kills only this local process group; no late result returned',async t=>{
  const f=fixture(t,`fs.writeFileSync(process.env.HOME+'/pid',String(process.pid));setTimeout(()=>console.log('{"ok":true}'),30000);`);
  const c=new AbortController(),work=f.reader().calendar({},'cancel',c.signal);const rejected=assert.rejects(work,/已取消/);
  for(let n=0;n<100&&!fs.existsSync(f.home+'/pid');n++)await delay(10);
  assert(fs.existsSync(f.home+'/pid'));const pid=Number(fs.readFileSync(f.home+'/pid'));c.abort();await rejected;
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  const already=new AbortController();already.abort();await assert.rejects(f.reader().calendar({},'pre',already.signal),{name:'AbortError'});
});
test('timeout and oversized output stop real local child and do not truncate into fabricated success',async t=>{
  const slow=fixture(t,`setTimeout(()=>console.log('{"ok":true}'),30000);`);
  await assert.rejects(slow.reader({timeoutMs:50}).calendar({}),/超时/);
  const large=fixture(t,`console.log(JSON.stringify({ok:true,data:'x'.repeat(10000)}));`);
  await assert.rejects(large.reader({maxBytes:100}).calendar({}),/过大/);
});
test('a service without its own Feishu profile reports the local reader unavailable',t=>{
  assert.equal(fixture(t,'').reader().available,true);
  assert.equal(createVoiceLarkReader({environment:{PATH:'/usr/bin'}}).available,false);
});
