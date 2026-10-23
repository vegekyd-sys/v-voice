import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLookupRecovery,TOOL_FAILURE_LINE,TOOL_RESULT_PROMPT_LINE} from './lookup-recovery.mjs';
function fixture(){let at=10000;const spoken=[],events=[],s={pending:0,lastUserAt:0};const r=createLookupRecovery({now:()=>at,state:()=>s,progress:()=>true,say:text=>{spoken.push(text);return true;},audit:e=>events.push(e)});return {r,s,spoken,events,advance:ms=>{at+=ms;r.tick();}};}
for(const failed of [false,true])test(`shared recovery: ${failed?'failure':'result'} is spoken once only after idle`,()=>{
 const f=fixture(),call={callId:'lookup',name:'web_search'};f.r.started(call);f.r.finished(call,failed?{error:'failed'}:{answer:'fact'},true);
 f.s.playing=true;f.advance(9000);assert.equal(f.spoken.length,0);assert(f.r.waiting());f.s.playing=false;f.advance(1);
 assert.deepEqual(f.spoken,[failed?TOOL_FAILURE_LINE:TOOL_RESULT_PROMPT_LINE]);f.advance(10000);assert.equal(f.spoken.length,1);assert(!f.r.waiting());
});
test('answered, cancelled, retired and routed lookups never speak stale recovery',()=>{
 for(const mode of ['answered','cancelled','retired','routed']){const f=fixture(),call={callId:'a',name:'memory_search'};f.r.started(call);f.r.finished(call,mode==='cancelled'?{cancelled:true}:{answer:'private'},mode!=='retired');if(mode==='answered')f.r.answered();if(mode==='routed')f.s.routed=true;f.advance(9000);assert.deepEqual(f.spoken,[],mode);}
});
test('pending lookup keeps its native turn: only capped PCM progress, never injected TTS',()=>{
 const f=fixture(),call={callId:'a',name:'memory_search'};f.r.started(call);f.s.pending=1;
 for(let i=0;i<5;i++)f.advance(16000);
 assert.equal(f.events.filter(e=>e.type==='lookup.progress').length,3);assert.deepEqual(f.spoken,[]);
});
test('recovery expires instead of holding an unavailable receiver forever',()=>{
 const f=fixture(),call={callId:'a',name:'web_search'};f.r.started(call);f.r.finished(call,{answer:'fact'},true);f.s.playing=true;f.advance(30000);assert(!f.r.waiting());assert.deepEqual(f.spoken,[]);
});
