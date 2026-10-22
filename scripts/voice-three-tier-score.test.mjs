import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreEngine} from './voice-three-tier-score.mjs';

function fixture(){
 const pair={scenario:{turns:[
  {id:'1',kind:'identity',text:'现在说话的是谁？请只说我的名字。',expectedName:'小林',startMs:1000,endMs:3000},
  {id:'2',kind:'identity',text:'现在说话的是谁？请只说我的名字。',expectedName:'小周',startMs:12000,endMs:14000},
 ]}};
 const engine={events:[],protocol:[],errors:[],unexpectedGatewayRequests:[]};
 return {pair,engine,score:()=>scoreEngine(pair,engine)};
}
function reply(engine,{at=4000,text='小林',id='r1',connection=1,heard='现在说话的是谁？请只说我的名字。',questionId,delivered=true}={}){
 engine.protocol.push({type:'conversation.item.input_audio_transcription.completed',at:at-500,connection,text:heard,questionId});
 engine.protocol.push({type:'response.output_text.done',at,connection,text,responseId:id,questionId:questionId??'q-'+id});
 if(delivered)engine.events.push({type:'audio',at:at-100,responseId:id,bytes:3200},{type:'transcript',role:'assistant',final:true,at:at+1,text});
}
test('delivered audio and same-connection ASR order score, repeated names stay distinct',()=>{
 const f=fixture();reply(f.engine);reply(f.engine,{at:15000,id:'r2',text:'小周'});
 assert.equal(f.score().correct,2);assert.equal(f.score().unboundReplies,0);
 assert.equal(f.score().rows[0].replies[0].association,'same-connection-asr-order');
});
test('explicit question ownership keeps a delayed answer on its original turn',()=>{
 const f=fixture();f.engine.protocol.push({type:'conversation.item.input_audio_transcription.completed',at:3500,connection:1,text:f.pair.scenario.turns[0].text,questionId:'q1'});
 f.engine.protocol.push({type:'response.output_text.done',at:15000,connection:1,text:'小林',responseId:'r1',questionId:'q1'});
 f.engine.events.push({type:'audio',at:14900,responseId:'r1',bytes:3200},{type:'transcript',role:'assistant',final:true,at:15001,text:'小林'});
 assert.equal(f.score().rows[0].correct,true);assert.equal(f.score().rows[0].late,true);assert.equal(f.score().rows[1].answered,false);
});
test('speculative output that never reached the client cannot pass',()=>{
 const f=fixture();reply(f.engine,{delivered:false});assert.equal(f.score().correct,0);
});
test('TV ASR and replies stay extra rather than becoming the foreground answer',()=>{
 const f=fixture();reply(f.engine,{heard:'欢迎收看今天的天气资讯',text:'小林'});
 assert.equal(f.score().correct,0);assert.equal(f.score().extraReplies,1);
});
test('a truncated foreground transcript stays attached to that question',()=>{
 const f=fixture();reply(f.engine,{heard:'请指说我的名字。',text:'不确定你的名字'});
 assert.equal(f.score().extraReplies,0);assert.equal(f.score().rows[0].answered,true);assert.equal(f.score().rows[0].correct,false);
});
test('ASR on a different connection and missing audio cannot pass',()=>{
 const f=fixture();reply(f.engine);f.engine.protocol[1].connection=2;
 assert.equal(f.score().correct,0);assert.equal(f.score().unboundReplies,1);
 const g=fixture();reply(g.engine);g.engine.events=g.engine.events.filter(e=>e.type!=='audio');assert.equal(g.score().correct,0);
});
test('one tracker label for both introductions cannot count as two-person separation',()=>{
 const f=fixture();f.engine.path='speaker';
 f.pair.scenario.turns.unshift({id:'introA',person:'A',kind:'introA',startMs:0,endMs:100},{id:'introB',person:'B',kind:'introB',startMs:200,endMs:300});
 f.pair.scenario.turns[2].person='A';f.pair.scenario.turns[3].person='B';
 f.engine.events.push({type:'speaker.identity',startMs:0,speakerId:'same'},{type:'speaker.identity',startMs:200,speakerId:'same'},{type:'speaker.identity',startMs:1000,speakerId:'same'});
 assert.equal(f.score().explicitSpeakerTracking.distinct,false);assert.equal(f.score().explicitSpeakerTracking.correct,0);
});
