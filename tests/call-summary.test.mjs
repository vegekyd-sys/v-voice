import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSummary,summaryText,minutesCard} from '../lib/call-summary.mjs';
import {createConversationCalls,callSummarizerFromEnv} from '../lib/conversation-calls.mjs';
import {conversationReplyText} from '../lib/conversation-replies.mjs';

const brief={kind:'brief',title:'通话已接通',lead:'能听到，声音清楚。',sections:[]};
test('structured minutes persist as readable text and restore history without card schema',async()=>{
 const summary={kind:'substantive',title:'计划与待核实信息',lead:'',sections:[{label:'建议',text:'先做 A，再做 B；尚未确认。'},{label:'待核实',text:'交易信息仍需核实。'}]};
 const sent=[],edits=[],binding={id:'fixture',kind:'dm',sessionKey:'fixture',accountId:'fixture',callerId:'fixture'};
 const calls=createConversationCalls({gateway:{request:async(m,a)=>{if(m==='tools.invoke'){edits.push(a);return {ok:true,output:{details:{ok:true,messageId:'receipt'}}};}assert.equal(m,'send');sent.push(a);return {messageId:'receipt',chatId:'oc_fixture'};}},publicOrigin:'https://example.com',summarize:async()=>summary});
 const call=calls.begin(binding,{to:'ou_fixture'},'owner',{statusCard:false});call.ready();call.user('提出计划并核实信息');call.captureTask('pending');call.close();call.close();await calls.flush();
 const report=await calls.read(binding,call.id);assert.deepEqual(report.summaryDocument,summary);assert.equal(report.summary,summaryText(summary));assert.equal(sent.length,1);
 assert.equal(edits.length,1);const card=edits[0].args.card;assert.equal(card.body.elements[0].columns[0].background_style,'purple-50');
 assert.match(JSON.stringify(card),/电话纪要/);assert.match(JSON.stringify(card),/部分任务仍在后台处理/);
 assert.equal(conversationReplyText(JSON.stringify(card)),'语音通话纪要：计划与待核实信息\n\n建议\n\n先做 A，再做 B；尚未确认。\n\n待核实\n\n交易信息仍需核实。');
});
test('brief minutes and legacy fallback render safely with transcript links',()=>{
 const card=minutesCard({summaryDocument:brief},'https://example.com/report?call=fixture');
 assert.equal(card.body.elements.length,3);assert.match(conversationReplyText(JSON.stringify(card)),/能听到，声音清楚。/);
 const unsafe={...brief,title:'<at id=all>**[link]**',lead:'<b>literal & _text</b>'};
 const safe=minutesCard({summaryDocument:unsafe},'https://example.com/(report)');
 assert.doesNotMatch(JSON.stringify(safe.body),/<at id=all>|<b>/);assert.match(JSON.stringify(safe),/%28report%29/);
 assert.match(conversationReplyText(JSON.stringify(safe)),/<b>literal & _text<\/b>/);
 assert.match(JSON.stringify(minutesCard({summary:'摘要暂时不可用。'},'https://example.com')),/摘要暂时不可用/);
});
test('invalid structured completions retry once then preserve transcript fallback',async()=>{
 for(const value of [null,{}, {...brief,sections:[null]}, {...brief,lead:''},{...brief,title:'x'.repeat(45)}])assert.throws(()=>parseSummary(value),/summary-invalid/);
 let attempts=0;const summarize=callSummarizerFromEnv({VOICE_CALL_SUMMARY_API_KEY:'test',VOICE_CALL_SUMMARY_MODEL:'test'},{wait:async()=>{},fetchImpl:async(_,options)=>{
  const body=JSON.parse(options.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.tools,undefined);attempts++;
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:attempts===1?'not json':JSON.stringify(brief)}}]})};
 }});
 assert.deepEqual(await summarize({turns:[{role:'user',text:'能听到吗？'}]}),brief);assert.equal(attempts,2);
});

for(const mismatch of [false,true])test(`summary style uses the exact DM receipt or verified session; mismatch=${mismatch}`,async()=>{
 const binding={id:'fixture',kind:'dm',agentId:'makaron',sessionKey:'agent:makaron:feishu:direct:ou_fixture',accountId:'bot',callerId:'fixture'},target={agentId:'makaron',sessionKey:binding.sessionKey,accountId:'bot',to:'ou_fixture'};
 const sent=[],edits=[],audits=[];let attempts=0;
 const calls=createConversationCalls({publicOrigin:'https://example.com',summarize:async()=>brief,audit:e=>audits.push(e),gateway:{request:async(method,args)=>{
  if(method==='send'){sent.push(args);return {messageId:'owned'};}
  if(method==='sessions.describe')return {session:{key:binding.sessionKey,agentId:'makaron',origin:{provider:'feishu',accountId:'bot',nativeDirectUserId:mismatch?'ou_other':'ou_fixture',chatType:'direct',nativeChannelId:'oc_fixture'}}};
  edits.push(args);if(++attempts===1)throw Error('network timeout');
  assert.equal(args.args.messageId,'owned');assert.equal(args.args.target,'oc_fixture');return {ok:true,output:{details:{ok:true,messageId:'owned'}}};
 }}});
 const call=calls.begin(binding,target,'owner',{statusCard:false});call.ready();call.user('能听到吗');call.close();call.close();await calls.flush();
 assert.equal(sent.length,1);const fallback=JSON.parse(sent[0].message);assert.equal(fallback.header.title.content,'电话纪要');assert.match(fallback.body.elements[0].text.content,/声音清楚/);assert.equal(fallback.body.elements.at(-1).tag,'button');
 assert.equal(edits.length,mismatch?0:2);if(!mismatch)assert.deepEqual(edits[0],edits[1]);
 assert.equal(audits.some(e=>e.type==='call.summary-styled'),!mismatch);assert.equal(audits.some(e=>e.stage==='summary-style'),mismatch);
 assert.equal((await calls.read(binding,call.id)).summaryState,'generated');
});

for(const conflict of [false,true])test(`durable DM binding survives missing session origin; conflicting receipt=${conflict}`,async()=>{
 const binding={id:'fixture',kind:'dm',nativeChatId:'oc_bound'},edits=[],audit=[];
 const calls=createConversationCalls({publicOrigin:'https://example.com',summarize:async()=>brief,audit:e=>audit.push(e),gateway:{request:async(method,args)=>{
  if(method==='send')return {messageId:'om_owned',...(conflict?{chatId:'oc_other'}:{})};
  assert.notEqual(method,'sessions.describe','mutable origin is not required');
  edits.push(args);return {ok:true,output:{details:{ok:true,messageId:'om_owned'}}};
 }}});
 const call=calls.begin(binding,{to:'ou_fixture'},'owner',{statusCard:false});call.ready();call.user('试音');call.close();await calls.flush();
 const report=await calls.read(binding,call.id);assert.equal(report.summaryDelivery.state,conflict?'style-failed':'styled');
 assert.equal(edits.length,conflict?0:1);
 if(conflict){assert.equal(report.summaryDelivery.error,'call-card-target-unconfirmed');assert.equal(audit.find(e=>e.stage==='summary-style').error,'call-card-target-unconfirmed');}
 else{assert.equal(edits[0].args.target,'oc_bound');assert.equal(audit.find(e=>e.type==='call.summary-styled').voiceSessionId,'owner');}
});
