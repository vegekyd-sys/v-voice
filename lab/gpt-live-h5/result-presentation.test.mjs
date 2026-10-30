import test from 'node:test';
import assert from 'node:assert/strict';
import {presentBackendResult,LONG_RESULT_NOTICE,readBackendResult,backendResultQuestion,speakableResult,speakableProgress,claimsCompletion} from './result-presentation.mjs';

test('short generated media is displayed and speech gives its caption without reading the URL',()=>{
 for (const text of ['小赛车在积木赛道上。\n![赛车](https://cdn.test/a.webp)','小赛车的五秒视频。\n[视频](https://cdn.test/a.mp4)']) {
  const result=presentBackendResult({result:text}); assert.equal(result.media,true);assert.equal(result.long,false);
  assert.equal(result.text,text);assert(!result.spokenText.includes('https:'));assert(result.spokenText.includes('小赛车'));
 }
 assert.equal(presentBackendResult({result:'![图](file:///tmp/a.png)'}).media,undefined);
});

test('short result remains exact; long result preserves complete body and uses brief source summary plus screen notice',()=>{
 for(const text of ['已查到十二的记录。','日期尚未确认。','😀'.repeat(300)])assert.deepEqual(presentBackendResult({result:text}),{text,long:false,spokenText:text});
 for(const text of ['😀'.repeat(301),'## 方案\n'+'原始日期、数字、限定条件。'.repeat(60),'```sh\ndate\n```','| 项目 | 日期 |\n| --- | --- |\n| 入学 | 2028-09 |',Array.from({length:8},(_,i)=>`- 条件${i}`).join('\n')]) {
  const result=presentBackendResult({result:text});assert.equal(result.text,text);assert.equal(result.long,true);assert(result.spokenText.endsWith(LONG_RESULT_NOTICE));assert(result.spokenText.length<200);
 }
 assert([...LONG_RESULT_NOTICE].length<100);assert(!LONG_RESULT_NOTICE.includes('已经发送'));
});
test('missing, failed and cancelled results never announce a document or success',()=>{
 for(const result of [null,undefined,{},'',{text:'   '},{cancelled:true,result:'x'.repeat(500)},{error:'真实失败',result:'x'.repeat(500)}])assert.equal(presentBackendResult(result),null);
});


test('same backend completion supplies a real short summary and untouched full document without another model run',()=>{
 const summary='建议先访校，再按当年政策核对。入学时间预计是2028年9月。',text='## 完整方案\n'+'日期、来源和必要条件。'.repeat(70),raw=`【语音摘要】\n${summary}\n【完整方案】\n${text}`;
 assert.deepEqual(readBackendResult(raw),{text,summary});assert.deepEqual(presentBackendResult(raw),{text,long:true,spokenText:summary+' '+LONG_RESULT_NOTICE});
 assert.equal(presentBackendResult({result:text,spokenSummary:summary}).spokenText,summary+' '+LONG_RESULT_NOTICE);
 assert.equal(readBackendResult('前置文字\n'+raw).text,'前置文字\n'+raw);
 assert(backendResultQuestion('原始目标').startsWith('原始目标\n'));assert(backendResultQuestion('原始目标').includes('100字以内'));
});

test('legacy fallback selects actual conclusion instead of a completion preamble, retaining nearby qualifications',()=>{
 const text='查完了。基于这次调研。\n## 核心结论\n优先选A，但仍需核对证件。预算目前只是参考。\n## 完整细节\n'+'后续来源与细节。'.repeat(60);
 const result=presentBackendResult(text);assert(result.spokenText.startsWith('优先选A，但仍需核对证件。预算目前只是参考。'));assert(!result.spokenText.includes('查完了'));assert.equal(result.text,text);
});


test('oversized backend summary is shortened from its own conclusion, never a report table cell',()=>{
 const summary='首选A，次选B，证件条件仍需确认。'+ '研究范围和后续行动。'.repeat(20),body='| 项 | 推荐 |\n| --- | --- |\n| 首选 | A |\n'+'全部正文'.repeat(200);
 const result=presentBackendResult(`【语音摘要】\n${summary}\n【完整方案】\n${body}`);
 assert.equal(result.text,body);assert(result.spokenText.startsWith('首选A，次选B，证件条件仍需确认。'));assert(!result.spokenText.startsWith('项'));
});


test('a short plain media URL surviving OpenClaw attachment extraction is still delivered to the screen',()=>{
 const text='已生成：玩具小赛车产品图。\n\n链接：https://cdn.test/snapshot.jpg';
 const result=presentBackendResult(text);
 assert.equal(result.media,true);assert.equal(result.long,false);assert.equal(result.text,text);
 assert(!result.spokenText.includes('https:'));
 for(const text of ['https://user:password@cdn.test/a.png','http://other.test/a.png','https://example.test/'])assert.equal(presentBackendResult(text).media,undefined);
});

test('backend report delivery stays with Voice without suppressing explicit message tasks',()=>{
 const q=backendResultQuestion('整理报告');assert.match(q,/Voice 主机/);assert.match(q,/不要为这项结果交付再查询群/);assert.match(q,/独立业务操作/);assert.match(q,/不得在没有发送回执/);
});
test('a spoken progress line before the headings keeps the document whole but still speaks the written summary',()=>{
 const summary='前10场从10月22日客场打湖人开始，最值得看揭幕战。',body='## 赛程\n'+'| 日期 | 对手 |\n|---|---|\n| 10-22 | 湖人 |\n'.repeat(12);
 for(const raw of [`赛程拿到了：前10场有5场全美直播。【语音摘要】\n${summary}\n【完整方案】\n${body}`,`赛程拿到了。\n【语音摘要】\n${summary}\n【完整方案】\n${body}`]){
  const read=readBackendResult(raw);assert.equal(read.text,raw);assert.equal(read.summary,summary);
  const shown=presentBackendResult(raw);assert(shown.spokenText.startsWith(summary));assert.doesNotMatch(shown.spokenText,/【/u);
 }
 assert.doesNotMatch(presentBackendResult('前置文字。【语音摘要】\n'+'很长'.repeat(80)+'\n'+body).spokenText,/【语音摘要】|【完整方案】/u,'a marker is never read aloud');
});

test('what the caller hears starts at the conclusion and names no second party',()=>{
 for(const [raw,heard] of [
  ['我查下相关资料。天街在西侧。','天街在西侧。'],['我查了一下，天街在西侧。','天街在西侧。'],['收到。我先核对了路线，走十五分钟。','走十五分钟。'],['好的，我帮你看一下，今天有雨。','今天有雨。'],
  ['后台整理好了，耀中偏双语。','我整理好了，耀中偏双语。'],['交给后台再试一次就行。','我来再试一次就行。'],
  ['我查到天街在西侧。','我查到天街在西侧。'],['我确认明天没课。','我确认明天没课。'],['我先查了 3 个来源，都说有雨。','我先查了 3 个来源，都说有雨。'],['记忆里只有使用记录，没有价格。','记忆里只有使用记录，没有价格。'],['我查了一下。','我查了一下。'],
 ])assert.equal(speakableResult(raw),heard,raw);
 assert.equal(presentBackendResult('我查下路线。天街在西侧。').text,'我查下路线。天街在西侧。','the document stays whole');
 assert.equal(presentBackendResult('我查下路线。天街在西侧。').spokenText,'天街在西侧。');
});
test('a claim of being done is told apart from a promise, a negation or an unfinished clause',()=>{
 for(const t of ['后台整理好了，核心区别很明确','都查到了。','弄好了！','这个完成了，你看','有结果了：耀中'])assert.equal(claimsCompletion(t),true,t);
 for(const t of ['等我整理好了告诉你。','还没查到，再等等。','有结果了我就说。','整理好了','查好了给你','一会儿弄好了，我告诉你','如果查到了，我跟你说','快弄好了，再等下','我帮你查一下','记忆里没有记录'])assert.equal(claimsCompletion(t),false,t);
 assert.equal(speakableProgress('整理好了，马上给你。'),null);assert.equal(speakableProgress('后台在拉最新赛程。'),'我在拉最新赛程。');
});
