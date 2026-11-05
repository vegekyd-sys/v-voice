import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {Readable} from 'node:stream';
import {createLiveH5Server} from './server.mjs';
import {createShareInbox,normalizeShareText,shareMessage,sniffShareType,SHARE_LIMITS} from './share-inbox.mjs';

const JPEG=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(60,7)]);
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(40,1)]);
const MOV=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypqt  '),Buffer.alloc(80,2)]);
const token='private-test-token-with-at-least-32-characters';
const origin='https://openclaw.tianyi.live';

test('upload types are sniffed from bytes, never trusted from the declared type alone',()=>{
  assert.deepEqual(sniffShareType(JPEG,'image/jpeg'),['image','jpg']);
  assert.deepEqual(sniffShareType(PNG,'image/png'),['image','png']);
  assert.deepEqual(sniffShareType(MOV,'video/quicktime'),['video','mov']);
  assert.equal(sniffShareType(PNG,'image/jpeg'),null);
  assert.equal(sniffShareType(JPEG,'video/mp4'),null);
  assert.equal(sniffShareType(JPEG,'image/heic'),null);
  assert.equal(sniffShareType(Buffer.from('<svg/>'),'image/svg+xml'),null);
});

test('the caption stays the caller\'s words; links are labelled as data',()=>{
  assert.equal(normalizeShareText(undefined),'');
  assert.equal(normalizeShareText('  做成视频\u0007发群里 '),'做成视频 发群里');
  assert.throws(()=>normalizeShareText('x'.repeat(SHARE_LIMITS.maxTextChars+1)),/最多/);
  assert.throws(()=>normalizeShareText({}),/无效/);
  const message=shareMessage({text:'把这几张做成一段视频发到产品群',items:[{kind:'image',url:'https://v.example/share-media/a.jpg'},{kind:'image',url:'https://v.example/share-media/b.jpg'},{kind:'video',url:'https://v.example/share-media/c.mov'}]});
  assert.match(message,/^【手机分享】我刚从手机分享给你 2 张图片、1 段视频。/u);
  assert.match(message,/我的附言：把这几张做成一段视频发到产品群/u);
  assert.match(message,/1\. 图片 https:\/\/v\.example\/share-media\/a\.jpg\n2\. 图片 .*\n3\. 视频 /u);
  assert.match(message,/<<<media_1>>>/u);
  assert.match(shareMessage({text:'',items:[{kind:'image',url:'https://v.example/a.jpg'}]}),/没有写附言。先简短确认收到，再问我想怎么用/u);
});

async function inbox(t,limits){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'share-inbox-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let clock=1_000_000;const box=createShareInbox({directory,limits:{...SHARE_LIMITS,...limits},now:()=>clock});
  return {box,directory,tick:ms=>{clock+=ms;}};
}
const body=(bytes,type)=>Object.assign(Readable.from([bytes]),{headers:{'content-type':type,'content-length':String(bytes.length)}});

test('uploads are owner-bound, single-use, size-limited and expire with their files',async t=>{
  const {box,directory,tick}=await inbox(t,{maxImageBytes:1000,ttlMs:60000});
  const receive=(bytes,type,owner='owner-a')=>box.receive(body(bytes,type),{owner,contentType:type,publicBase:'https://v.example/voice/'});
  const a=await receive(JPEG,'image/jpeg');assert.equal(a.kind,'image');
  await assert.rejects(receive(Buffer.concat([JPEG,Buffer.alloc(2000)]),'image/jpeg'),error=>error.status===413);
  await assert.rejects(receive(PNG,'image/jpeg'),error=>error.status===415);
  await assert.rejects(receive(JPEG,'image/heic'),error=>error.status===415);
  await assert.rejects(box.claim('owner-b',[a.id]),error=>error.status===409);
  const [item]=await box.claim('owner-a',[a.id]);
  assert.match(item.url,/^https:\/\/v\.example\/voice\/share-media\/[A-Za-z0-9_-]{43}\.jpg$/u);
  await assert.rejects(box.claim('owner-a',[a.id]),error=>error.status===409);
  assert.equal((await fs.readdir(directory)).length,1);
  tick(60001);await box.sweep();
  assert.deepEqual(await fs.readdir(directory),[]);
});

async function server(t,{gatewayRequest,directVoice}={}){
  const shareDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'share-server-'));t.after(()=>fs.rm(shareDirectory,{recursive:true,force:true}));
  const calls=[];
  const bridge=createLiveH5Server({basePath:'/voice',publicOrigin:origin,accessToken:token,shareDirectory,directVoice,
    gateway:{request:async(method,params)=>{calls.push({method,params});return gatewayRequest?.(method,params)??{ok:true};}},offer:async()=>'v=0\r\nanswer'});
  await new Promise(resolve=>bridge.server.listen(0,'127.0.0.1',resolve));t.after(()=>bridge.dispose());
  const url=`http://127.0.0.1:${bridge.server.address().port}`;
  const raw=(route,{cookie,method='POST',type='application/json',data,headers={}}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(url+route,{method,headers:{host:new URL(origin).host,...(method==='POST'?{origin}:{}),...(cookie?{cookie}:{}),'content-type':type,...headers}},
      response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers})));
    req.on('error',reject);req.end(data);
  });
  const access=await raw('/voice/api/access',{data:JSON.stringify({access:token})});
  const cookie=access.headers.get('set-cookie').split(';',1)[0];
  const upload=(bytes,type,as=cookie)=>raw('/voice/api/share/media',{cookie:as,type,data:bytes});
  const share=value=>raw('/voice/api/share',{cookie,data:JSON.stringify(value)});
  return {calls,raw,cookie,upload,share};
}

test('outside a call, shared media becomes one background task for the bound Feishu session',async t=>{
  let started;const done=new Promise(resolve=>{started=resolve;});
  const f=await server(t,{gatewayRequest:(method,params)=>{
    if(method==='voice.product.task.start')return {taskId:'task-1',runId:'run-1'};
    if(method==='voice.product.task.read')return {taskId:'task-1',status:'ok',runId:'run-1',runs:['run-1'],text:'视频已生成：https://cdn.example/out.mp4'};
    if(method==='send'){if(/视频已生成/u.test(params.message))started(params);return {messageId:'om-'+Math.random()};}
    return {ok:true};
  }});
  assert.equal((await f.upload(JPEG,'image/jpeg','')).status,401);
  const first=await (await f.upload(JPEG,'image/jpeg')).json();
  const second=await (await f.upload(MOV,'video/quicktime')).json();
  assert.equal((await f.upload(PNG,'image/jpeg')).status,415);
  assert.equal((await f.share({media:[first.id],text:'x',voiceSessionId:'forged'})).status,400);
  const response=await f.share({media:[first.id,second.id],text:'把这些做成一段视频发到产品群'});
  assert.equal(response.status,202);
  assert.deepEqual({...await response.json(),taskOwner:undefined},{delivered:'background',taskOwner:undefined,images:1,videos:1});
  const sent=await done;
  const start=f.calls.find(call=>call.method==='voice.product.task.start').params;
  assert.equal(start.sessionKey.startsWith('agent:makaron:feishu:group:oc_'),true);
  assert.match(start.voiceSessionId,/^share-/u);
  assert.match(start.question,/我的附言：把这些做成一段视频发到产品群/u);
  const links=[...start.question.matchAll(/https:\/\/openclaw\.tianyi\.live\/voice\/share-media\/[A-Za-z0-9_-]{43}\.(?:jpg|mov)/gu)].map(m=>m[0]);
  assert.equal(links.length,2);
  assert.equal(sent.to.startsWith('oc_'),true);
  assert.match(sent.message,/视频已生成/u);
  assert.equal(f.calls.filter(call=>call.method==='send').some(call=>/V 收到了你从手机分享的素材/u.test(call.params.message)),true);
  // Makaron fetches the capability URL without a cookie; the bytes are the upload's.
  const media=await f.raw(new URL(links[0]).pathname,{method:'GET'});
  assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/jpeg');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()),JPEG);
  assert.equal((await f.raw('/voice/share-media/'+'A'.repeat(43)+'.jpg',{method:'GET'})).status,404);
  // A claimed upload cannot be shared a second time.
  assert.equal((await f.share({media:[first.id]})).status,409);
});

test('during a direct call, the share is said to V as the caller\'s own turn',async t=>{
  const forwarded=[];
  const directVoice={
    reserve:async()=>({voiceSessionId:'direct-1',ticket:'t',model:'seeduplex'}),
    share:(id,value)=>{forwarded.push({id,...value});return {ok:true};},
    close:async()=>{},dispose:async()=>{},presentation:()=>null,activity:()=>null,
  };
  const f=await server(t,{directVoice});
  const call=await f.raw('/voice/api/session',{cookie:f.cookie,data:JSON.stringify({model:'seeduplex'})});
  assert.equal(call.status,200,await call.clone().text());
  const item=await (await f.upload(PNG,'image/png')).json();
  const response=await f.share({media:[item.id],text:'换成夜景'});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{delivered:'call',voiceSessionId:'direct-1',images:1,videos:0});
  assert.equal(forwarded.length,1);assert.equal(forwarded[0].id,'direct-1');
  assert.match(forwarded[0].message,/我的附言：换成夜景/u);
  assert.equal(f.calls.some(c=>c.method==='voice.product.task.start'),false);
});
