// Run on V only. Starts an isolated Voice process; existing Gateway is read-only
// configuration and the normal backend task executor. No call is placed here.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {execFileSync} from 'node:child_process';
const root=path.resolve(process.argv[2]??'');
if(!root.startsWith('/var/lib/v-voice-candidates/location-')||!fs.existsSync(root+'/voice/manifest.json'))throw Error('Expected own private Candidate artifact');
const manifest=JSON.parse(fs.readFileSync(root+'/voice/manifest.json','utf8'));
const run=(cmd,args)=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const unit='voice-location-20261025',sourceUnit='openclaw-rtc-h5.service',port=28473;
let running=false;try{running=run('systemctl',['is-active',unit+'.service'])==='active';}catch{}if(running)throw Error('Own Candidate already running');

const pid=Number(run('systemctl',['show',sourceUnit,'-p','MainPID','--value']));if(pid<2)throw Error('Expected running production Voice source');
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(value=>{const i=value.indexOf('=');return [value.slice(0,i),value.slice(i+1)];}));
const args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0'),entry=args.find(x=>x.endsWith('/lab/gpt-live-h5/server.mjs'));
if(!entry)throw Error('Production Voice entrypoint changed');
const user=run('systemctl',['show',sourceUnit,'-p','User','--value'])||'root';
const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>listener.close(resolve));
// Copy runtime dependencies, never link a writable Candidate into production.
if(!fs.existsSync(root+'/voice/node_modules'))run('cp',['-a','--reflink=auto',path.resolve(entry,'../../..')+'/node_modules',root+'/voice/node_modules']);
for(const directory of ['transcripts','avatars','reports','tmp'])fs.mkdirSync(root+'/'+directory,{recursive:true,mode:0o700});
for(const key of ['VOICE_RELEASE_SOCKET','VOICE_RELEASE_BOOT_HOLD_UNTIL','VOICE_DEVICES_FILE','VOICE_DEVICE_VOLUME_FILE','VOICE_ENTRIES_FILE','VOICE_FEISHU_LOGIN_FILE','VOICE_PERSONAL_REPLY_ACCOUNT_ID','VOICE_CANDIDATE_RELEASE_FILE'])delete env[key];
Object.assign(env,{GPT_LIVE_H5_PORT:String(port),RTC_H5_PORT:String(port),GPT_LIVE_H5_BASE_PATH:'',RTC_H5_BASE_PATH:'',GPT_LIVE_H5_PUBLIC_ORIGIN:'',RTC_H5_PUBLIC_ORIGIN:'',GPT_LIVE_H5_ACCESS_TOKEN:'',RTC_H5_ACCESS_TOKEN:'',GPT_LIVE_H5_PREVIEW:'0',VOICE_STREAM_SPEAKER:'0',VOICE_DEFAULT_MODEL:'grok',VOICE_PHONE_INPUT_POLICY:'native',RTC_H5_TRANSCRIPT_DIR:root+'/transcripts',RTC_H5_AVATAR_LOG_DIR:root+'/avatars',VOICE_CALL_REPORTS_DIR:root+'/reports',VOICE_IOS_BINDINGS_FILE:root+'/bindings.private.json',TMPDIR:root+'/tmp'});
const envPath=root+'/environment.private.json';fs.writeFileSync(envPath,JSON.stringify(env),{mode:0o600});run('chown',['-R',user,root]);fs.chmodSync(root,0o700);
const launcher=root+'/launch.private.cjs';fs.writeFileSync(launcher,"const fs=require('node:fs'),cp=require('node:child_process');const env=JSON.parse(fs.readFileSync(process.argv[2]));const p=cp.spawn(process.argv[3],[process.argv[4]],{env,stdio:'inherit'});p.on('error',()=>{process.exitCode=1;});p.on('exit',code=>{process.exitCode=code??1;});",{mode:0o700});run('chown',[user,launcher]);
const node=fs.readlinkSync(`/proc/${pid}/exe`);
run('systemd-run',['--quiet','--unit='+unit,'--property=User='+user,'--property=WorkingDirectory='+root+'/voice','--property=UMask=0077','--property=KillMode=control-group',node,launcher,envPath,node,root+'/voice/lab/gpt-live-h5/server.mjs']);
console.log(JSON.stringify({candidate:unit,sourceCommit:manifest.commit,port,sourceVoicePid:pid,usesExistingGateway:true,callStarted:false,paidTestStarted:false,privateState:root}));
