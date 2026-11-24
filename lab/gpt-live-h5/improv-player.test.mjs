import test from 'node:test';
import assert from 'node:assert/strict';
import {createImprovShow} from '../realtime-direct-tools/improv-live.mjs';
import {createImprovPlayer as createImprovPlayerForTest} from './improv-player.mjs';

test('tool calls open, direct and stop once using Makaron receipts',async()=>{
 const calls=[],events=[];
 const api=createImprovShow({run:async args=>{
   calls.push(args);
   if(args[0]==='start')return {id:'a1',phase:'waiting',playerPath:'/director/player.html#a1.'+'x'.repeat(43)};
   return args[0]==='stop'?{phase:'ended'}:{action:'send'};
 }});
 await api.command({action:'start',shot:'猫'},{text:'就这么办'},e=>events.push(e));
 const turn={text:'下雨了',id:'t1'};
 await Promise.all([api.command({action:'direct',shot:'下雨'},turn),api.command({action:'direct',shot:'下雨'},turn)]);
 await api.command({action:'end'},{text:'今天演到这儿'});
 assert.deepEqual(events.map(e=>e.action),['start','end']);
 assert.deepEqual(calls.map(c=>c[0]),['start','direct','stop']);
 assert.equal(calls[1].at(-1),'下雨');
 assert.ok(calls[0].includes('--story'),'Makaron keeps the story moving between directions');
 assert.ok(calls[1].includes('--ready'),'a shot the model wrote skips the spoken-draft cleanup');
});

test('the caller\'s own words still go through the cleanup, and the story can be turned off',async()=>{
 const calls=[];
 const api=createImprovShow({story:false,run:async args=>{calls.push(args);return args[0]==='start'?{id:'a2',phase:'waiting',playerPath:'/director/player.html#a2.'+'x'.repeat(43)}:{action:'send'};}});
 await api.command({action:'start',shot:'猫'},{text:'开播'},()=>{});
 await api.command({action:'direct'},{text:'嗯，下雨吧',id:'t9'});
 assert.ok(!calls[0].includes('--story'));
 assert.ok(!calls[1].includes('--ready'));
 assert.equal(calls[1].at(-1),'嗯，下雨吧');
});

test('reopening a playing show refocuses its single player and never buys a second session',async()=>{
 const starts=[],events=[];
 const api=createImprovShow({run:async args=>{starts.push(args);return {id:'s1',phase:'waiting',playerPath:'/director/player.html#s1.'+'x'.repeat(43)};}});
 const send=e=>events.push(e.action);
 const turn={text:'开播吧'};
 await Promise.all([api.command({action:'start',shot:'帷幕升起'},turn,send),api.command({action:'start',shot:'帷幕升起'},turn,send)]);
 await api.command({action:'start',shot:'帷幕升起'},{text:'再开直播'},send);
 assert.equal(starts.length,1);
 assert.deepEqual(events,['start','focus']);
});

test('reference edits use the actual caller upload or canonical avatar within this call',async()=>{
 const {createAssetShelf,SELF_IMAGE}=await import('./board-assets.mjs');
 const shelf=createAssetShelf({standing:[SELF_IMAGE]});
 const uploaded=shelf.add('call',{source:'upload',url:'https://cdn.example/train.png'});
 assert.equal(await shelf.openingImage('other',uploaded.id),'');
 const command="makaron edit --image-model gemini-2.1 --image "+uploaded.id+" '画成水彩'";
 assert.match(shelf.begin('call',{command}).command,/cdn.example\/train.png/u);
 shelf.share=async()=>({url:'https://cdn.example/avatar.jpg',until:Infinity});
 assert.equal(await shelf.openingImage('call','v'),'https://cdn.example/avatar.jpg');
});

test('opening on this picture preserves its shape and excludes invented opening scenery',async()=>{
 const {createAssetShelf}=await import('./board-assets.mjs');
 const shelf=createAssetShelf(),url='https://cdn.example/basketball.png';
 const {id}=shelf.add('call',{url});
 shelf.seen('call',[id],{[id]:1});
 const words='你，你用这个开始做个直播吧？';
 const image=await shelf.openingImage('call','current');
 const events=[],calls=[];
 const api=createImprovShow({run:async args=>{calls.push(args);return {id:'s',phase:'waiting',playerPath:'/director/player.html#s.'+'x'.repeat(43)};}});
 await api.command({action:'start',shot:'保持原构图，篮球开始转动'},{text:words},e=>events.push(e),image,shelf.openingAspect('call',image));
 assert.equal(events[0].imageUrl,url);
 assert.equal(calls[0].at(-1),url);
 assert.equal(calls[0][calls[0].indexOf('--aspect-ratio')+1],'1:1');
 assert.equal(calls[0][2],'保持原构图，篮球开始转动');
 shelf.begin('call',{command:"makaron edit --image-model gemini-2.1 '另一幅画'"});
 assert.equal(await shelf.openingImage('call','current'),'');
});

test('late Director audio joins the call once, ducks under overlapping speech and detaches without muting the recorder', async t=>{
 const {createImprovPlayer}=await import('./improv-player.mjs');
 const origin='https://voice.example', page=new EventTarget(), stream=new EventTarget();
 const track={readyState:'live',enabled:true}, tracks=[];
 stream.getAudioTracks=()=>tracks;
 const frame={contentWindow:{},contentDocument:{querySelector:()=>({srcObject:stream})},remove(){}};
 const browser={window:page,location:{origin},document:{baseURI:origin+'/voice/',createElement:()=>frame,body:{append(){}}},MediaStream:class{constructor(tracks){this.tracks=tracks;}}};
 for(const [key,value] of Object.entries(browser)){
   const previous=Object.getOwnPropertyDescriptor(globalThis,key);
   Object.defineProperty(globalThis,key,{configurable:true,value});
   t.after(()=>previous?Object.defineProperty(globalThis,key,previous):Reflect.deleteProperty(globalThis,key));
 }
 const destination={}, param={value:0,setTargetAtTime(level){this.value=level;}};
 let sources=0, disconnected=false, soundOutput=null;
 const context={currentTime:0,destination,createGain:()=>({gain:param,connect(node){soundOutput=node;},disconnect(){soundOutput=null;}}),
   createMediaStreamSource(input){sources++;assert.deepEqual(input.tracks,[track]);return {connect(){},disconnect(){disconnected=true;}};}};
 const player=createImprovPlayer({context,update(){},notice(){},ended(){}});
 player.receive({action:'start',id:'s',playerPath:'/director/player.html'});
 const signal=action=>page.dispatchEvent(Object.assign(new Event('message'),{origin,source:frame.contentWindow,data:{source:'makaron-director',id:'s',action}}));
 signal('playing');assert.equal(sources,0);
 tracks.push(track);stream.dispatchEvent(new Event('addtrack'));signal('playing');
 assert.equal(sources,1);assert.equal(soundOutput,destination);
 const normal=param.value;assert.ok(normal>0);
 player.setCallerSpeaking(true);const reduced=param.value;assert.ok(reduced>0 && reduced<normal);
 player.setHostSpeaking(true);player.setCallerSpeaking(false);assert.equal(param.value,reduced);
 player.toggleSound();player.setHostSpeaking(false);assert.equal(param.value,0);
 player.setOutputMuted(true);player.toggleSound();assert.equal(param.value,0);
 player.setOutputMuted(false);assert.equal(param.value,normal);
 signal('ended');assert.equal(soundOutput,null);assert.equal(disconnected,true);assert.equal(track.enabled,true);
 stream.dispatchEvent(new Event('addtrack'));assert.equal(sources,1);
});

test('a searched photograph is selected by the order on the visible lesson page',async()=>{
 const {createAssetShelf}=await import('./board-assets.mjs');
 const shelf=createAssetShelf();
 shelf.share=async query=>({url:'https://photos.example/'+query,until:Infinity});
 const upload=shelf.add('call',{url:'https://photos.example/upload',source:'upload'});
 for(const query of ['louvre','orsay','tower'])shelf.found('call',{query});
 shelf.visible('call',['p3','p1','p2']);shelf.seen('call',['p1'],{p1:.65});
 assert.equal(await shelf.openingImage('call',undefined,2),'https://photos.example/louvre');
 assert.equal(shelf.openingAspect('call','https://photos.example/louvre'),'9:16');
 assert.equal(await shelf.openingImage('call','current'),'');
 shelf.pick('call','p2');assert.equal(await shelf.openingImage('call','current'),'https://photos.example/orsay');
 shelf.visible('call',[upload.id]);assert.equal(await shelf.openingImage('call','current'),'https://photos.example/upload');
 shelf.visible('call',['p1']);assert.equal(await shelf.openingImage('call','current'),'https://photos.example/louvre');
});


test('a stopped show remains available to its uploader after the capture timeout',async t=>{
 const {createImprovPlayer}=await import('./improv-player.mjs');
 t.mock.timers.enable({apis:['setTimeout']});
 const origin='https://voice.example',win=new EventTarget();
 let removed=false;
 const frame={contentWindow:{postMessage(){}},remove(){removed=true;}};
 for(const [name,value] of Object.entries({window:win,location:new URL(origin),document:{baseURI:origin+'/',createElement:()=>frame,body:{append(){}}}})){
   const old=Object.getOwnPropertyDescriptor(globalThis,name);
   Object.defineProperty(globalThis,name,{configurable:true,value});
   t.after(()=>old?Object.defineProperty(globalThis,name,old):Reflect.deleteProperty(globalThis,name));
 }
 const clips=[];
 const player=createImprovPlayer({update(){},notice(){},ended(){},archive:clip=>clips.push(clip)});
 const send=(action,data={})=>win.dispatchEvent(Object.assign(new Event('message'),{origin,source:frame.contentWindow,data:{id:'s',source:'makaron-director',action,...data}}));
 player.receive({action:'start',id:'s',playerPath:'/director/player.html'});
 player.finish();
 send('recorded',{blob:new Blob(['video'])});
 t.after(()=>URL.revokeObjectURL(clips[0].recording));
 assert.ok(clips[0].recording);
 t.mock.timers.tick(100_000);
 assert.equal(removed,false);
 send('ended');
 assert.equal(removed,true);
 assert.equal(clips.at(-1).done,true);
});

test('a failed start leaves the same request free to retry and hands Makaron\'s reason to the model',async()=>{
 let fail=true;const events=[];
 const api=createImprovShow({run:async args=>{
   if(args[0]==='start'&&fail){fail=false;throw Error('Makaron Director：已有直播会话，请先收播');}
   if(args[0]==='start')return {id:'r1',phase:'waiting',playerPath:'/director/player.html#r1.'+'x'.repeat(43)};
   return {phase:'ended'};
 }});
 const turn={text:'用这张开直播'};
 await assert.rejects(api.command({action:'start',shot:'开场'},turn,e=>events.push(e)),/已有直播会话/u);
 const result=await api.command({action:'start',shot:'开场',caption:'巧克力店开门了'},turn,e=>events.push(e));
 assert.equal(result.state,'connecting');
 assert.equal(events[0].caption,'巧克力店开门了');
});

test('a show that ended on its own tells the next direction why, and labels follow accepted directions',async()=>{
 const events=[];
 const api=createImprovShow({run:async args=>args[0]==='start'?{id:'e1',phase:'waiting',playerPath:'/director/player.html#e1.'+'x'.repeat(43)}:args[0]==='direct'?{action:'send',version:2}:{phase:'ended'}});
 const send=e=>events.push(e);
 await api.command({action:'start',shot:'开场'},{text:'开播'},send);
 await api.command({action:'direct',shot:'一只小橘猫轻轻跳上木质柜台，尾巴扫过玻璃罐',caption:'小橘猫跳上柜台'},{text:'来只小橘猫',id:'t2'},send);
 assert.deepEqual(events.at(-1),{type:'improv.live',action:'label',id:'e1',version:2,text:'小橘猫跳上柜台'});
 await api.end('e1','time');
 await assert.rejects(api.command({action:'direct',shot:'下雪'},{text:'下雪吧'},send),/时长上限/u);
});

test('the player captions a shot with the host caption, never the Director prompt, and reports milestones',()=>{
 const listeners=[],updates=[],stages=[],ended=[];
 const frame={hidden:false,contentWindow:{postMessage(){}},contentDocument:{querySelector:()=>null},remove(){}};
 globalThis.window={addEventListener:(t,l)=>listeners.push(l),removeEventListener(){}};
 globalThis.document={baseURI:'https://v.example/voice/',createElement:()=>frame,body:{append(){}}};
 globalThis.location={origin:'https://v.example'};
 let now=0;
 const player=createImprovPlayerForTest({update:v=>updates.push(v),ended:(id,reason)=>ended.push(reason),notice(){},stage:s=>stages.push(s),clock:()=>now});
 player.receive({action:'start',id:'p1',playerPath:'/director/player.html#p1.'+'x'.repeat(43),name:'巧克力店',caption:'开门营业'});
 const post=data=>listeners.forEach(l=>l({source:frame.contentWindow,origin:'https://v.example',data:{source:'makaron-director',id:'p1',...data}}));
 now=13000;post({action:'playing'});
 post({action:'direction',state:'playing',version:1,text:'以巴黎巧克力店柜台后的V为第一帧，暖光保持'});
 assert.equal(updates.at(-1).cue.text,'开门营业');
 post({action:'direction',state:'playing',version:2,text:'长长的导演提示词'});
 assert.equal(updates.at(-1).cue.text,'');
 player.receive({action:'label',id:'p1',version:2,text:'小橘猫跳上柜台'});
 assert.equal(updates.at(-1).cue.text,'小橘猫跳上柜台');
 post({action:'direction',state:'playing',version:3,text:'老板弯腰把礼盒推到小猫面前，近景',caption:'老板把礼盒推给小猫'});
 assert.equal(updates.at(-1).cue.text,'老板把礼盒推给小猫','a showrunner beat carries its own caption');
 post({action:'ended',reason:'time'});
 assert.deepEqual(stages.map(s=>s.stage),['first-frame','direction-played','direction-played','ended']);
 assert.equal(stages[0].ms,13000);
 assert.deepEqual(ended,['time']);
 delete globalThis.window;delete globalThis.document;delete globalThis.location;
});

test('live arguments the tool does not have are dropped instead of refusing the call',async()=>{
 const {improvArguments}=await import('../realtime-direct-tools/improv-live.mjs');
 assert.deepEqual(improvArguments({action:'direct',shot:'下雨',image:'a1',mood:'',openingImage:'a1'}),{action:'direct',shot:'下雨'});
 assert.deepEqual(improvArguments({action:'start',shot:'开场',openingImage:'a1',imagePosition:0,extra:1}),{action:'start',shot:'开场',openingImage:'a1'});
});
