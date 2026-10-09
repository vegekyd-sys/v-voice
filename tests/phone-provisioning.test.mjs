import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {provisionPhone,phoneLink} from '../lib/phone-provisioning.mjs';
import {readPhoneFile,updatePhoneFile} from '../lib/private-phone-file.mjs';
import {runPhoneCommand} from '../scripts/phone.mjs';
import {WebSocketServer} from 'ws';
const params={id:'phone-room-a',sessionKey:'agent:makaron:feishu:group:oc_room_a',accountId:'configured-account',kind:'group'};
const gateway={request:async(method,args)=>{assert.equal(method,'sessions.resolve');assert.equal(args.allowMissing,undefined);return {key:args.key,agentId:'makaron'};}};
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'voice-phones-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('provisioning verifies the exact existing key before returning a unique private phone',async()=>{
 const a=await provisionPhone({gateway,records:[],...params});const b=await provisionPhone({gateway,records:[a],...params,id:'phone-room-b'});
 assert.notEqual(a.accessToken,b.accessToken);assert.equal(a.callerId,'tianyi');assert.equal(a.permissionProfile,'personal-tianyi');
 await assert.rejects(provisionPhone({gateway:{request:async()=>({key:'agent:makaron:main'})},records:[],...params}),/exact phone session/);
 await assert.rejects(provisionPhone({gateway,records:[a],...params}),/duplicate/);
});
test('private atomic registry updates reject failed probes, competing writers and symlinks',async t=>{
 const dir=await temporary(t),file=join(dir,'entries.json'),a=await provisionPhone({gateway,records:[],...params});
 await updatePhoneFile(file,async()=>[a]);assert.equal((await lstat(file)).mode&0o777,0o600);
 const before=await readFile(file,'utf8');
 await assert.rejects(updatePhoneFile(file,async()=>{throw Error('Probe failed');}),/Probe failed/);
 assert.equal(await readFile(file,'utf8'),before);
 await writeFile(file+'.lock','other owner',{mode:0o600});await assert.rejects(updatePhoneFile(file,async()=>[]),{code:'EEXIST'});
 assert.equal(await readFile(file+'.lock','utf8'),'other owner');await rm(file+'.lock');
 await assert.rejects(updatePhoneFile(file,async()=>{await writeFile(file,'[]\n');return [a];}),/changed/);
 assert.equal(await readFile(file,'utf8'),'[]\n');
 const alias=join(dir,'alias.json');await symlink(file,alias);await assert.rejects(readPhoneFile(alias),/private regular/);
 await writeFile(join(dir,'public.json'),'[]',{mode:0o644});await assert.rejects(readPhoneFile(join(dir,'public.json')),/0600/);
});
test('link/list commands never print the bearer; generated link is exclusive and private',async t=>{
 const dir=await temporary(t),file=join(dir,'entries.json'),out=join(dir,'phone-link.txt');
 const a=await provisionPhone({gateway,records:[],...params});await updatePhoneFile(file,async()=>[a]);
 const list=await runPhoneCommand(['list','--entries',file]);assert(!JSON.stringify(list).includes(a.accessToken));
 const result=await runPhoneCommand(['link','--entries',file,'--id',a.id,'--origin','https://voice.example.com','--out',out]);
 assert(!JSON.stringify(result).includes(a.accessToken));assert.equal((await lstat(out)).mode&0o777,0o600);
 const url=new URL((await readFile(out,'utf8')).trim());assert.equal(url.searchParams.get('phone'),a.id);assert.equal(new URLSearchParams(url.hash.slice(1)).get('access'),a.accessToken);
 await assert.rejects(runPhoneCommand(['link','--entries',file,'--id',a.id,'--origin','https://voice.example.com','--out',out]),{code:'EEXIST'});
 assert.throws(()=>phoneLink('http://voice.example.com','/voice',a),/HTTPS/);
});

test('real admin CLI transport creates only private configuration using read-only RPC',async t=>{
 const dir=await temporary(t),file=join(dir,'entries.json'),config=join(dir,'gateway.json');
 const wss=new WebSocketServer({host:'127.0.0.1',port:0}),methods=[];
 await new Promise(r=>wss.once('listening',r));t.after(()=>wss.close());
 wss.on('connection',socket=>{
  socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'challenge'}}));
  socket.on('message',raw=>{const request=JSON.parse(raw);methods.push(request.method);
   if(request.method==='connect'){assert.deepEqual(request.params.scopes,['operator.read']);assert.deepEqual(request.params.caps,[]);}
   socket.send(JSON.stringify({type:'res',id:request.id,ok:true,payload:request.method==='connect'?{protocol:4}:{key:request.params.key,agentId:'makaron'}}));
  });
 });
 await writeFile(config,JSON.stringify({gateway:{port:wss.address().port,auth:{token:'${TEST_VOICE_TOKEN}'}}}),{mode:0o600});
 const result=await runPhoneCommand(['add','--entries',file,'--id',params.id,'--session',params.sessionKey,'--account',params.accountId,'--kind',params.kind,'--gateway-config',config],{TEST_VOICE_TOKEN:'only-a-fixture-token'});
 assert.equal(result.callsCreated,0);assert.equal(result.existingSessionVerified,true);
 assert.deepEqual(methods,['connect','sessions.resolve']);const records=await readPhoneFile(file);
 assert.equal(records[0].sessionKey,params.sessionKey);assert(!JSON.stringify(result).includes(records[0].accessToken));
});
