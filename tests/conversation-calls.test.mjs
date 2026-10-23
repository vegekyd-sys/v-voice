import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createConversationCalls,callSummarizerFromEnv} from '../lib/conversation-calls.mjs';
import {createConversationReplyDelivery} from '../lib/conversation-replies.mjs';
const binding={id:'test-group',kind:'group',sessionKey:'agent:makaron:feishu:group:oc_a',callerId:'tianyi',accountId:'bot',displayName:'测试群'},target={sessionKey:binding.sessionKey,to:'oc_a'};
test('group call: real readiness, one summary, admitted complete transcript and late results survive',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-call-'));let at=1000,release;const sent=[];
 const edits=[];const gateway={request:async(method,args)=>{if(method==='tools.invoke'){edits.push(args);return {ok:true,output:{details:{ok:true,messageId:args.args.messageId}}};}sent.push(args);return {messageId:'om_'+sent.length};}};
 const calls=createConversationCalls({gateway,directory,publicOrigin:'https://phone.example',basePath:'/voice',now:()=>at,summarize:async()=>new Promise(r=>release=r)});
 try{
  const report=calls.begin(binding,target,'call');const delivery=createConversationReplyDelivery({gateway,target,ownerId:'call',callReport:report});
  assert.equal(sent.length,0);delivery.ready();delivery.ready();
  delivery.user('你好',{turnId:'u0'});delivery.begin('r0');delivery.transcript('你好，我在。',{final:true,responseId:'r0'});await delivery.finish({responseId:'r0'});
  delivery.user('查下今天安排',{turnId:'u1'});delivery.begin('r1');delivery.transcript('我来',{responseId:'r1'});delivery.transcript('查一下',{responseId:'r1'});delivery.interrupt('r1');
  delivery.user('旁边的人聊天',{turnId:'aside'});delivery.begin('ra');delivery.transcript('旁聊',{final:true,responseId:'ra'});delivery.ignore('ra');
  delivery.user('请生成方案',{turnId:'u2'});delivery.captureTask('request');delivery.captureTask('run',{from:'request'});
  at=66000;await delivery.close();
  // close releases audio without waiting for the summarizer.
  for(let i=0;!release&&i<100;i++)await new Promise(r=>setTimeout(r,5));assert.ok(release);assert.ok(calls.pending);
  assert.equal(sent.length,1);assert.equal(JSON.parse(sent[0].message).body.elements[0].content,'V正在电话通话 · 00:00');assert.equal(edits.at(-1).args.messageId,'om_1');assert.match(edits.at(-1).args.card.body.elements[0].content,/V电话通话已结束/);
  await delivery.result('run:final','方案已生成',{questionId:'run'});assert.equal(sent.length,2);
  release('讨论了今天的安排，并请求生成方案，结果待后台返回。');await calls.flush();
  assert.equal(sent.length,3);const card=JSON.parse(sent[2].message);assert.equal(card.body.elements[0].text.content,'讨论了今天的安排，并请求生成方案，结果待后台返回。');assert.doesNotMatch(JSON.stringify(card),/次提问|1 分 5 秒|电话已结束/);
  const url=new URL(card.body.elements.at(-1).behaviors[0].default_url);assert.equal(url.searchParams.get('phone'),binding.id);
  const saved=await calls.read(binding,report.id);assert.equal(saved.summaryState,'generated');assert.equal(saved.pendingTasks,true);assert.equal(saved.turns.length,5);assert.equal(saved.turns.find(r=>r.text==='我来查一下').interrupted,true);assert.ok(!saved.turns.some(t=>t.text==='方案已生成'||t.text==='旁聊'));
  assert.equal((await stat(join(directory,report.id+'.json'))).mode&0o777,0o600);
  const reopened=createConversationCalls({directory});assert.deepEqual(await reopened.read(binding,report.id),saved);assert.equal(await reopened.read({...binding,sessionKey:'different'},report.id),null);assert.equal(await reopened.read(binding,'../../secret'),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('reservation cancellation stays silent; unavailable summary retains full dialogue honestly',async()=>{
 const sent=[],calls=createConversationCalls({gateway:{request:async(_,a)=>{sent.push(a);return{messageId:'ok'};}},publicOrigin:'https://phone.example',basePath:'/voice',summarize:async()=>{throw Error('timeout');}});
 const cancelled=calls.begin(binding,target,'cancelled');cancelled.close();await calls.flush();assert.equal(sent.length,0);
 const live=calls.begin(binding,target,'live');live.ready();live.user('我要安排一场会议');live.close();live.close();await calls.flush();assert.equal(sent.filter(a=>a.message).length,2);const report=await calls.read(binding,live.id);assert.equal(report.turns[0].text,'我要安排一场会议');assert.equal(report.summaryState,'unavailable');assert.match(report.summary,/暂时未生成摘要/);
});
test('summary request is bounded, has no tools and rejects truncated completion',async()=>{
 let payload;const summarize=callSummarizerFromEnv({XAI_API_KEY:'test',VOICE_CALL_SUMMARY_MODEL:'test-model'},{fetchImpl:async(_,options)=>{payload=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'half'}}]})};}});
 await assert.rejects(summarize({turns:[{role:'user',text:'测试'}]}),/summary-invalid/);assert.equal(payload.tools,undefined);assert.equal(payload.max_tokens,1000);
});

test('same status receipt updates after a delayed start; close never posts a second status',async()=>{
 let finishSend;const edits=[],sent=[],errors=[];
 const gateway={request:async(method,a)=>{if(method==='send'){sent.push(a);if(sent.length===1)return new Promise(r=>finishSend=r);return {messageId:'summary'};}edits.push(a);return {ok:true,output:{details:{ok:true,messageId:a.args.messageId}}};}};
 const calls=createConversationCalls({gateway,publicOrigin:'https://phone.example',audit:e=>errors.push(e)}),call=calls.begin(binding,target,'fast');call.ready();call.close();finishSend({messageId:'original'});await calls.flush();
 assert.equal(sent.length,2);assert.equal(edits.length,1);assert.equal(edits[0].args.messageId,'original');assert.match(edits[0].args.card.body.elements[0].content,/V电话通话已结束/);assert.equal(errors.filter(e=>e.type==='call.report-error'&&e.stage.startsWith('status')).length,0);
});
test('failed status edit is recorded without duplicate notification or losing the summary',async()=>{
 const sent=[],audit=[];const calls=createConversationCalls({gateway:{request:async(m,a)=>{if(m==='send'){sent.push(a);return {messageId:'owned'};}return {ok:false,error:{message:'denied'}};}},publicOrigin:'https://phone.example',audit:e=>audit.push(e)});
 const call=calls.begin(binding,target,'failure');call.ready();call.user('你好');call.close();await calls.flush();assert.equal(sent.length,2);assert.ok(audit.some(e=>e.stage==='status-ended'));assert.equal((await calls.read(binding,call.id)).turns.length,1);
});
test('connected status uses the same receipt for styling and hangup, including an ambiguous edit retry',async()=>{
 const sent=[],edits=[];let first=true;
 const gateway={request:async(method,a)=>{if(method==='send'){sent.push(a);return {messageId:'owned-card'};}edits.push(a);if(first){first=false;throw Object.assign(Error('request timed out'),{code:'TIMEOUT'});}return {ok:true,output:{details:{ok:true,messageId:a.args.messageId}}};}};
 const calls=createConversationCalls({gateway,publicOrigin:'https://phone.example'}),call=calls.begin(binding,target,'connected');call.ready();await calls.flush();
 assert.equal(edits.length,2);assert.deepEqual(edits[0],edits[1]);assert.match(edits[1].args.card.body.elements[0].content,/V正在电话通话/);assert.equal(edits[1].args.card.body.elements[0].text_size,'notation');
 call.close();await calls.flush();assert.equal(sent.length,2);assert.equal(edits.length,3);assert.ok(edits.every(a=>a.args.messageId==='owned-card'));assert.match(edits[2].args.card.body.elements[0].content,/V电话通话已结束/);
});
test('live counter uses elapsed time; a slow tick cannot overwrite ended duration or leave a timer',async()=>{
 let at=1000,slow=false,release;const edits=[],scheduled=new Map();let timerId=0;
 const gateway={request:async(method,a)=>{if(method==='send')return {messageId:'timer-card'};edits.push(a.args.card.body.elements[0].content);if(slow&&!a.args.card.body.elements[0].content.includes('已结束'))await new Promise(r=>release=r);return {ok:true,output:{details:{ok:true,messageId:'timer-card'}}};}};
 const calls=createConversationCalls({gateway,publicOrigin:'https://phone.example',now:()=>at,setTimer:(fn,ms)=>{const id=++timerId;scheduled.set(id,{fn,ms});return id;},clearTimer:id=>scheduled.delete(id)});
 const call=calls.begin(binding,target,'timer');call.ready();await calls.flush();assert.match(edits[0],/00:00/);assert.equal(scheduled.size,1);
 const [id,tick]=[...scheduled][0];scheduled.delete(id);at=3500;await tick.fn();assert.match(edits.at(-1),/00:02/);assert.equal(scheduled.size,1);
 const [nextId,next]=[...scheduled][0];scheduled.delete(nextId);at=6000;slow=true;const inFlight=next.fn();assert.ok(release);at=62000;call.close();assert.doesNotMatch(edits.at(-1),/已结束/);
 release();await inFlight;await calls.flush();assert.match(edits.at(-1),/V电话通话已结束 · 1 分 1 秒/);assert.equal(scheduled.size,0);
 const count=edits.length;await next.fn();assert.equal(edits.length,count);
});


test('short summaries request low reasoning and retry a timeout once without losing input',async()=>{
 const requests=[];let waits=0;
 const summarize=callSummarizerFromEnv({XAI_API_KEY:'fixture',VOICE_CALL_SUMMARY_MODEL:'grok-4.7'},{wait:async()=>{waits++;},fetchImpl:async(_,options)=>{
  requests.push(JSON.parse(options.body));if(requests.length===1)throw Object.assign(Error('provider timeout'),{name:'TimeoutError'});
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'我把刚才电话的重点整理好了。'}}]})};
 }});
 assert.equal(await summarize({turns:[{role:'user',text:'请整理通话要点'}]}),'我把刚才电话的重点整理好了。');
 assert.equal(requests.length,2);assert.equal(waits,1);assert.equal(requests[0].reasoning_effort,'low');
 assert.deepEqual(requests[0].messages,requests[1].messages);assert.equal(requests[1].tools,undefined);
});
test('summary failures are bounded and permanent errors are not retried',async()=>{
 for(const status of [401,503]){
  let requests=0;const summarize=callSummarizerFromEnv({XAI_API_KEY:'fixture',VOICE_CALL_SUMMARY_MODEL:'grok-4.7'},{wait:async()=>{},fetchImpl:async()=>{requests++;return{ok:false,status};}});
  await assert.rejects(summarize({turns:[{role:'user',text:'测试'}]}),e=>e.message==='summary-http-'+status&&e.attempts===(status===401?1:2));
  assert.equal(requests,status===401?1:2);
 }
});

test('DM edits follow the native chat ID from its exact send receipt, through ticks and close',async()=>{
 for(const nested of [false,true]){
  const dm={...binding,kind:'dm',sessionKey:'agent:makaron:feishu:direct:ou_alice'},to={...target,sessionKey:dm.sessionKey,to:'ou_alice',accountId:'bot'};
  const edits=[],sends=[],timers=[];let at=1000;
  const gateway={request:async(method,args)=>{
   if(method==='send'){sends.push(args);return nested?{results:[{messageId:'unrelated',chatId:'oc_wrong'},{messageId:'owned',chatId:'oc_alice'}],messageId:'owned'}:{messageId:'owned',chatId:'oc_alice'};}
   assert.equal(args.args.target,'oc_alice','Feishu compares the actual message chat ID');assert.equal(args.args.messageId,'owned');assert.equal(args.sessionKey,dm.sessionKey);assert.equal(args.args.accountId,'bot');edits.push(args.args.card.body.elements[0].content);
   return {ok:true,output:{details:{ok:true,messageId:'owned'}}};
  }};
  const calls=createConversationCalls({gateway,publicOrigin:'https://phone.example',now:()=>at,setTimer:fn=>{timers.push(fn);return 1;},clearTimer:()=>{}}),call=calls.begin(dm,to,'dm');
  call.ready();await calls.flush();at=6000;await timers.pop()();call.close();await calls.flush();
  assert.match(edits[1],/00:05/);assert.match(edits.at(-1),/已结束 · 5 秒/);assert.equal(sends.length,2);assert.ok(sends.every(s=>s.to==='ou_alice'));
 }
});
test('missing or mismatched DM receipt chat cannot redirect an edit to the user ID or another receipt',async()=>{
 for(const receipt of [{messageId:'owned'},{messageId:'owned',chatId:'ou_alice'},{messageId:'owned',results:[{messageId:'other',chatId:'oc_wrong'}]}]){
  const audit=[],sent=[];let edits=0;const calls=createConversationCalls({publicOrigin:'https://phone.example',audit:e=>audit.push(e),gateway:{request:async(m,a)=>{if(m==='send'){sent.push(a);return receipt;}if(m==='sessions.describe')return {session:null};edits++;throw Error('must not edit');}}});
  const call=calls.begin({...binding,kind:'dm'}, {...target,to:'ou_alice'},'missing-chat');call.ready();call.user('内容保留');call.close();await calls.flush();
  assert.equal(edits,0);assert.equal(sent.length,2);assert.ok(audit.some(e=>e.stage==='status-start'));assert.equal((await calls.read({...binding,kind:'dm'},call.id)).turns.length,1);
 }
});

for(const mismatch of [null,'key','agentId','accountId','nativeDirectUserId','provider','chatType','nativeChannelId'])test(`DM falls back to exact trusted session metadata; mismatch=${mismatch}`,async()=>{
 const dm={...binding,agentId:'makaron',kind:'dm',sessionKey:'agent:makaron:feishu:direct:ou_alice'},to={...target,agentId:'makaron',sessionKey:dm.sessionKey,to:'ou_alice',accountId:'bot'};
 const session={key:dm.sessionKey,agentId:'makaron',origin:{provider:'feishu',accountId:'bot',nativeDirectUserId:'ou_alice',chatType:'direct',nativeChannelId:'oc_alice'}};
 if(mismatch){if(['key','agentId'].includes(mismatch))session[mismatch]='wrong';else session.origin[mismatch]='wrong';}
 let edits=0,lookups=0;const errors=[];
 const calls=createConversationCalls({publicOrigin:'https://phone.example',audit:e=>errors.push(e),gateway:{request:async(m,a)=>{
  if(m==='send')return {messageId:'owned'};
  if(m==='sessions.describe'){lookups++;assert.deepEqual(a,{key:dm.sessionKey,includeDerivedTitles:false,includeLastMessage:false});return {session};}
  edits++;assert.equal(a.args.target,'oc_alice');return {ok:true,output:{details:{ok:true,messageId:'owned'}}};
 }}});
 const call=calls.begin(dm,to,'fallback');call.ready();call.close();await calls.flush();assert.equal(lookups,1);assert.equal(edits,mismatch?0:1);assert.equal(errors.some(e=>e.stage==='status-start'),!!mismatch);
});
