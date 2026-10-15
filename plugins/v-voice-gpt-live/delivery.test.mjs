import test from 'node:test';import assert from 'node:assert/strict';
import {createVoiceDeliveryOwner} from './delivery.mjs';
test('interrupt retires old speech while preserving real work and complete result',()=>{
 const documents=[],progress=[];const owner=createVoiceDeliveryOwner({onBackendResult:r=>{documents.push(r);return '完整结论';}});
 owner.transcript('user','查资料',true);const signal=new AbortController().signal;
 const params=owner.begin({signal,continuationIdentity:{delegationItemId:'real'},onProgress:p=>progress.push(p)});
 params.onProgress({text:'已查到'});owner.transcript('user','停一下',false);params.onProgress({text:'旧进度'});owner.transcript('user','停一下',true);
 assert.equal(params.signal,signal);assert.equal(signal.aborted,false);assert.equal(progress.length,1);
 assert.deepEqual(owner.result({delegationId:'real',text:'完整报告'.repeat(500)}),{spokenText:'完整结论',channel:'commentary'});assert.equal(documents[0].text.length,2000);
});
test('accepted host end mutes results without cancelling Agent and rejects invented identity',()=>{
 const owner=createVoiceDeliveryOwner();assert.throws(()=>owner.begin({}),/real native/);
 let n=0;const p=owner.begin({continuationIdentity:{delegationItemId:'real'},onProgress:()=>n++});assert.equal(owner.end().ok,true);p.onProgress({text:'late'});assert.equal(n,0);assert.equal(owner.result({delegationId:'real',text:'结果'}).channel,'commentary');owner.close();assert.throws(()=>owner.end(),/closed/);
});

test('native and direct backend questions share the host-owned result-delivery contract',()=>{
 const owner=createVoiceDeliveryOwner(),signal=new AbortController().signal;
 const p=owner.begin({question:'整理一份报告',signal,continuationIdentity:{delegationItemId:'exact'}});
 assert(p.question.startsWith('整理一份报告\n'));assert.match(p.question,/Voice 主机/);assert.match(p.question,/独立业务操作/);assert.equal(p.signal,signal);
});

test('native delivery speaks the prepared factual summary even when the host returned a generic preface',()=>{
 let full;const owner=createVoiceDeliveryOwner({onBackendResult:value=>{full=value.text;return '查了一下，我会帮你理清想法。';}});
 owner.begin({continuationIdentity:{delegationItemId:'native'}});
 const text='查了一下，再给你这版介绍。\n\n【语音摘要】\n客户内容交付、项目跟进、个人事务和系统维护。\n【完整方案】\n'+'完整具体例子。'.repeat(80);
 const spoken=owner.result({delegationId:'native',text});assert(spoken.startsWith('客户内容交付'));assert.equal(full,text);
});
