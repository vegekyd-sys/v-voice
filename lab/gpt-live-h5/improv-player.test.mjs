import test from 'node:test';
import assert from 'node:assert/strict';
import {createImprovShow,invited,openingImageFor,openingShot} from '../realtime-direct-tools/improv-live.mjs';

test('Makaron owns one show, coalesces model and ASR controls, and ends without redialing',async()=>{
 const calls=[],events=[];
 const api=createImprovShow({run:async args=>{
   calls.push(args);
   if(args[0]==='start')return {id:'a1',phase:'waiting',playerPath:'/director/player.html#a1.'+'x'.repeat(43)};
   return {action:args.at(-1)==='直播结束吧'?'end':'send'};
 }});
 await assert.rejects(api.command({action:'start',shot:'猫'},{text:'搜索直播'},()=>{}));
 await api.command({action:'start',shot:'猫'},{text:'来场直播'},e=>events.push(e));
 const turn={text:'下雨了',id:'t1'};
 await Promise.all([api.observe(turn),api.command({action:'direct',shot:'下雨'},turn)]);
 assert.equal(calls.filter(c=>c[0]==='direct').length,1);
 await api.observe({text:'直播结束吧',id:'t2'});
 assert.deepEqual(events.map(e=>e.action),['start','end']);
 await api.observe({text:'继续讲课',id:'t3'});
 assert.equal(calls.length,3);
});

test('spoken invitations keep editing, search, negation and quoted examples out of a paid show',()=>{
 for(const text of ['开播吧','小何，帮我开个直播吧','用这张图开场直播','把这张照片作为首帧开播吗？','搞一场马卡龙直播','开始直播']) assert.equal(invited(text),true,text);
 for(const text of ['搜索直播','教我怎么开直播','比如说，开播吧','先别开直播','结束直播','帮我生成一段视频','我刚才没开成功','可以找个比赛直播吗']) assert.equal(invited(text),false,text);
 assert.equal(openingImageFor({action:'start',openingImage:'a9'},'用这张图开场直播'),'current');
 assert.equal(openingImageFor({action:'start',openingImage:'a1'},'开个直播，不用图片。'),'');
 assert.match(openingShot('开个直播，不用图片，拍一场玩具猫的音乐会。',false),/玩具猫/);
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
