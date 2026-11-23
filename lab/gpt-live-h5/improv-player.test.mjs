import test from 'node:test';
import assert from 'node:assert/strict';
import {createImprovShow} from '../realtime-direct-tools/improv-live.mjs';

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
