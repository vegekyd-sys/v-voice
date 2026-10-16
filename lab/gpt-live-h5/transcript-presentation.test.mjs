import assert from 'node:assert/strict';
import test from 'node:test';
import {createTranscriptPresentation, formatTranscriptTime} from './transcript-presentation.mjs';

const caption = (role, id, text, extra = {}) => ({type: `${role === 'user' ? 'input' : 'output'}_transcript.added`, item: {id, text}, ...extra});
const created = (role, id) => ({type: 'turn.created', turn: {role, id}});
const done = (role, id, transcript) => ({type: 'turn.done', turn: {role, id, transcript}});

test('natural caption sentences stay in one current row until the actual native turn completes', () => {
  const p = createTranscriptPresentation();
  p.consume(caption('assistant', 'fragment-a', '我正在查。'), 100);
  p.consume(caption('assistant', 'fragment-b', '结果还没回来。'), 200);
  assert.equal(p.snapshot().current.length, 1);
  assert.equal(p.snapshot().current[0].text, '我正在查。结果还没回来。');
  p.consume(created('assistant', 'real-turn'), 300);
  const firstKey = p.snapshot().current[0].key;
  p.consume(done('assistant', 'real-turn', '已经查到结果。'), 400);
  assert.equal(p.snapshot().current.length, 0);
  assert.equal(p.snapshot().history.length, 1);
  assert.equal(p.snapshot().history[0].key, firstKey);
  assert.equal(p.snapshot().history[0].text, '已经查到结果。');
  assert.equal(p.snapshot().history[0].at, 100, 'Visible time is the real first caption receipt, not finalization time');
});

test('interleaved caller and assistant streams do not mix their content', () => {
  const p = createTranscriptPresentation();
  p.consume(created('user', 'u1'), 100);
  p.consume(caption('user', 'u-a', '请帮我'), 110);
  p.consume(caption('assistant', 'v-a', '好的，'), 120);
  p.consume(caption('user', 'u-b', '查一下。'), 130);
  p.consume(caption('assistant', 'v-b', '我来查。'), 140);
  assert.deepEqual(p.snapshot().current.map(({speaker, text}) => ({speaker, text})),
    [{speaker: '你', text: '请帮我查一下。'}, {speaker: 'V', text: '好的，我来查。'}]);
  p.consume(done('user', 'u1', '请帮我查一下。'), 150);
  assert.equal(p.snapshot().history[0].role, 'user');
  assert.equal(p.snapshot().current[0].role, 'assistant');
});

test('two actual assistant turns remain separate even though the speaker is the same', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'a1'), 100); p.consume(caption('assistant', 'f1', '我开始了。'), 110);
  p.consume(done('assistant', 'a1', '我开始了。'), 120);
  p.consume(created('assistant', 'a2'), 200); p.consume(caption('assistant', 'f2', '结果出来了。'), 210);
  p.consume(done('assistant', 'a2', '结果出来了。'), 220);
  assert.deepEqual(p.snapshot().history.map(row => row.text), ['我开始了。', '结果出来了。']);
});

test('a late final updates only its matching old native turn while a new turn streams', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'old'), 100); p.consume(caption('assistant', 'f1', '旧回答'), 110);
  p.consume(created('assistant', 'new'), 200); p.consume(caption('assistant', 'f2', '新回答'), 210);
  p.consume(done('assistant', 'old', '旧回答结束。'), 220);
  assert.equal(p.snapshot().history[0].text, '旧回答结束。');
  assert.equal(p.snapshot().current[0].text, '新回答');
});

test('a real role/ID-only terminal completes the row and preserves every received caption', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'a1'), 100);
  p.consume(caption('assistant', 'f1', '一'), 110);
  p.consume(caption('assistant', 'f2', '二三'), 120);
  p.consume({type: 'turn.done', turn: {role: 'assistant', id: 'a1'}}, 130);
  assert.equal(p.snapshot().current.length, 0);
  assert.equal(p.snapshot().history.length, 1);
  assert.equal(p.snapshot().history[0].text, '一二三');
  p.consume({type: 'turn.done', turn: {role: 'assistant', id: 'a1'}}, 140);
  assert.equal(p.snapshot().history.length, 1);
});

test('an unseen old terminal cannot replace the newer role stream and split its following captions', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'new'), 100);
  p.consume(caption('assistant', 'new-f1', '新回答'), 110);
  p.consume({type: 'turn.done', turn: {role: 'assistant', id: 'unseen-old'}}, 120);
  p.consume(caption('assistant', 'new-f2', '继续'), 130);
  assert.equal(p.snapshot().current.length, 1);
  assert.equal(p.snapshot().current[0].text, '新回答继续');
  assert.equal(p.snapshot().history.length, 0, 'A body-less unseen terminal does not invent a visible old row');
});

test('a late completed caption with explicit turn_id never enters the new role stream', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'old'), 100);
  p.consume(caption('assistant', 'old-f1', '旧回答'), 110);
  p.consume({type: 'turn.done', turn: {role: 'assistant', id: 'old'}}, 120);
  p.consume(created('assistant', 'new'), 200);
  p.consume(caption('assistant', 'new-f1', '新回答'), 210);
  p.consume(caption('assistant', 'late-old-f2', '旧回答的迟到片段', {turn_id: 'old'}), 220);
  assert.equal(p.snapshot().history[0].text, '旧回答');
  assert.equal(p.snapshot().current[0].text, '新回答');
});

test('a fresh caption without turn ownership preserves receive order rather than guessing or dropping content', () => {
  const p = createTranscriptPresentation();
  p.consume(created('user', 'old'), 100); p.consume(caption('user', 'f1', '前一句'), 110);
  p.consume(done('user', 'old', '前一句'), 120);
  p.consume(created('user', 'new'), 200); p.consume(caption('user', 'f2', '当前内容'), 210);
  p.consume(caption('user', 'new-unowned-item', '无法从协议判别的片段'), 220);
  assert.equal(p.snapshot().history[0].text, '前一句');
  assert.equal(p.snapshot().current[0].text, '当前内容无法从协议判别的片段');
});

test('fragment retransmission and native final retransmission do not duplicate content', () => {
  const p = createTranscriptPresentation();
  p.consume(caption('assistant', 'f1', '好的'), 100);
  p.consume(caption('assistant', 'f1', '好的'), 110);
  p.consume(caption('assistant', 'f1', '好的。'), 120);
  assert.equal(p.snapshot().current[0].text, '好的。');
  p.consume(done('assistant', 'a1', '好的。'), 130);
  p.consume(done('assistant', 'a1', '好的。'), 140);
  p.consume(created('assistant', 'a1'), 150);
  assert.equal(p.snapshot().history.length, 1);
  assert.equal(p.snapshot().current.length, 0);
});

test('late completed caption retransmission cannot create a draft or borrow the next turn timestamp', () => {
  const p = createTranscriptPresentation();
  p.consume(caption('assistant', 'f1', '旧回复'), 100);
  p.consume(done('assistant', 'a1', '旧回复'), 200);
  p.consume(caption('assistant', 'f1', '旧回复'), 300);
  p.consume(caption('assistant', 'f2', '新回复'), 400);
  assert.equal(p.snapshot().current.length, 1);
  assert.equal(p.snapshot().current[0].text, '新回复');
  assert.equal(p.snapshot().current[0].at, 400);
});

test('transcript.done closes only a caption fragment, never creates a spurious conversational turn', () => {
  const p = createTranscriptPresentation();
  p.consume(caption('assistant', 'f1', '第一句。'), 100);
  p.consume({type: 'output_transcript.done', item: {id: 'f1', text: '第一句。'}}, 110);
  p.consume(caption('assistant', 'f2', '第二句。'), 120);
  assert.equal(p.snapshot().history.length, 0);
  assert.equal(p.snapshot().current.length, 1);
  assert.equal(p.snapshot().current[0].text, '第一句。第二句。');
});

test('real event IDs deduplicate deltas without losing legitimate repeated text', () => {
  const p = createTranscriptPresentation();
  p.consume({type: 'output_transcript.delta', delta: '哈', event_id: 'e1'}, 100);
  p.consume({type: 'output_transcript.delta', delta: '哈', event_id: 'e1'}, 110);
  p.consume({type: 'output_transcript.delta', delta: '哈', event_id: 'e2'}, 120);
  assert.equal(p.snapshot().current[0].text, '哈哈');
});

test('caption fragments with an explicit turn ID cannot append to a different turn', () => {
  const p = createTranscriptPresentation();
  p.consume(created('assistant', 'a1'), 100); p.consume(created('assistant', 'a2'), 200);
  p.consume(caption('assistant', 'f1', '旧', {turn_id: 'a1'}), 210);
  p.consume(caption('assistant', 'f2', '新', {turn_id: 'a2'}), 220);
  assert.deepEqual(p.snapshot().current.map(row => row.text), ['旧', '新']);
});

test('unrelated events never invent transcript text and received markup remains literal text', () => {
  const p = createTranscriptPresentation();
  for (const event of [{type: 'delegation.created'}, {type: 'session.updated'}, {type: 'error', error: {message: 'problem'}},
    {type: 'turn.done', turn: {role: 'assistant'}}, null]) p.consume(event, 100);
  assert.deepEqual(p.snapshot(), {history: [], current: []});
  p.consume(done('user', 'u1', '<img src=x onerror=alert(1)>'), 200);
  assert.equal(p.snapshot().history[0].text, '<img src=x onerror=alert(1)>');
  assert(!('html' in p.snapshot().history[0]), 'Rendering must use textContent, not HTML');
});

test('reset clears the previous call and snapshots cannot mutate internal transcript state', () => {
  const p = createTranscriptPresentation(); p.consume(caption('user', 'f1', '第一通电话'), 100);
  p.snapshot().current[0].text = '外部修改';
  assert.equal(p.snapshot().current[0].text, '第一通电话');
  assert.deepEqual(p.reset(), {history: [], current: []});
  p.consume(caption('user', 'f1', '新电话'), 200);
  assert.equal(p.snapshot().current[0].text, '新电话');
});

test('time labels use a real received timestamp and malformed times never fabricate one', () => {
  const at = new Date(2026, 9, 3, 11, 4).getTime();
  assert.equal(formatTranscriptTime(at), '11:04');
  for (const value of [NaN, Infinity, -1, '11:04']) assert.equal(formatTranscriptTime(value), '');
  assert.throws(() => createTranscriptPresentation().consume({}, NaN), /timestamp/u);
});

test('backend document is exact, separately labelled, deduplicated and does not finalize native speech',()=>{
 const p=createTranscriptPresentation(),text='## 原始方案\n| 日期 | 条件 |\n| --- | --- |\n| 2028-09 | 尚未核实 |';
 p.consume(created('user','u'),100);p.consume(caption('user','uf','我还想问'),101);
 const event={type:'backend.result',callId:'owned-doc',text};p.consume(event,102);p.consume({...event,text:'不可替换'},103);
 let s=p.snapshot();assert.equal(s.history.length,1);assert.equal(s.history[0].speaker,'V · 完整方案');assert.equal(s.history[0].text,text);assert.equal(s.current[0].text,'我还想问');
 p.consume(caption('assistant','af','结果在屏幕上。'),104);s=p.snapshot();assert.equal(s.current.find(x=>x.role==='assistant').text,'结果在屏幕上。');assert.equal(s.history.length,1);
 for(const bad of [{type:'backend.result',text},{...event,callId:''},{...event,callId:'other',text:''}])p.consume(bad,105);
 assert.equal(p.snapshot().history.length,1);p.reset();assert.deepEqual(p.snapshot(),{history:[],current:[]});
});

test('speaker input labels bind to their own utterance and later names update earlier bubbles',()=>{
 const p=createTranscriptPresentation();
 const turn={speakerId:'0',text:'你好',startMs:0,endMs:1000};
 p.consume({type:'speaker.utterance',turn},100);
 assert.equal(p.snapshot().history[0].speaker,'Speaker A');
 p.consume({type:'speaker.decision',turn:{...turn,speakerId:'speaker:0'},participants:[{id:'speaker:0',label:'Speaker A',name:'天意',certainty:'stated'}],shouldRespond:true},110);
 p.consume({type:'speaker.decision',turn:{speakerId:'speaker:1',text:'我叫十二',startMs:2000,endMs:3000},participants:[{id:'speaker:0',label:'Speaker A',name:'天意',certainty:'stated'},{id:'speaker:1',label:'Speaker B',name:'十二',certainty:'stated'}],shouldRespond:false},120);
 const rows=p.snapshot().history;
 assert.equal(rows.length,2);assert.equal(rows[0].speaker,'天意 · Speaker A');assert.equal(rows[0].speakerId,'speaker:0');assert.equal(rows[1].speaker,'十二 · Speaker B');assert.equal(rows[1].listenOnly,true);assert.notEqual(rows[0].speakerTone,rows[1].speakerTone);
 p.consume(done('assistant','v','你好十二'),130);assert.equal(p.snapshot().history[2].speaker,'V');
 assert.equal(p.snapshot().history[0].speaker,'天意 · Speaker A','a later speaker must never relabel earlier turns');
 p.reset();p.consume({type:'speaker.utterance',turn},140);assert.equal(p.snapshot().history[0].speaker,'Speaker A');
});
