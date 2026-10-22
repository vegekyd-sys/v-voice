import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallView, messageDisplay, resolveStatus, speakerDisplay, splitTurns, TRANSIENT_MS} from './call-view.mjs';
import {createAvatarTasks} from './avatar-state.mjs';

const connected = (patch = {}) => {
  const view = createCallView();
  view.set({call: 'connected', voice: 'listening', ...patch});
  return view;
};
const task = (patch = {}) => ({callId: 'c1', activity: 'web', stage: null, step: 0, startedAt: 0, ...patch});

test('status line is one short phrase, picked by priority, never stacked', () => {
  const view = connected({tasks: [task({stage: '上网搜索', startedAt: 0})]});
  assert.deepEqual(['task', '上网搜索中', '0:42'], [resolveStatus(view.get(), 42_000).key, resolveStatus(view.get(), 42_000).text, resolveStatus(view.get(), 42_000).time]);
  view.speakerEvent({type: 'speaker.recovery', reason: 'mixed-speakers'}, 50_000);
  assert.equal(resolveStatus(view.get(), 51_000).text, '声音重叠，请轮流说');
  assert.equal(resolveStatus(view.get(), 50_000 + TRANSIENT_MS + 1).key, 'task', 'a short notice expires back to the task');
  view.message('正在恢复语音连接…', 'info', 60_000);
  assert.equal(resolveStatus(view.get(), 61_000).key, 'warn');
  view.speakerEvent({type: 'speaker.error', fatal: true, message: '识人语音通道暂时断开，请重新拨号。'}, 62_000);
  const fatal = resolveStatus(view.get(), 63_000);
  assert.deepEqual([fatal.key, fatal.text, fatal.action], ['error', '识别断开', 'redial']);
  assert.match(fatal.full, /重新拨号/u, 'the full sentence stays available to screen readers');
});

test('every status phrase stays short enough for a 320px line', () => {
  const view = connected({tasks: [task({stage: '安排子任务'}), task({callId: 'c2'})]});
  const texts = [
    resolveStatus(view.get(), 5_000).text,
    ...['声音播放被暂停了，点一下页面恢复声音。', '上一段语音还没确认结束。若仍无声音，请结束通话后重新开始。', '正在恢复语音连接…', '语音尚未确认播完，可以点按钮结束通话。', '补充内容已发送。', '条件已交给原任务，等待后台应用。']
      .map(text => messageDisplay(text, /已发送|已交给/u.test(text) ? 'success' : 'info').text),
    messageDisplay('语音服务报告错误，请结束通话后重试。', 'error').text,
    ...['speaker.recovery', 'speaker.asr-reconnecting', 'speaker.asr-recovered', 'speaker.end-accepted'].map(type => speakerDisplay({type}).text),
  ];
  for (const text of texts) assert.ok([...text].length <= 9, text);
});

test('V state: dialing, speaking, thinking, listen-only aside and who is talking', () => {
  const view = createCallView();
  view.set({call: 'dialing'});
  assert.equal(resolveStatus(view.get(), 0).text, '正在连接');
  view.set({call: 'connected', voice: 'listening'});
  view.speakerEvent({type: 'speaker.utterance', participants: [{id: 'speaker:1', label: 'Speaker A', name: 'Tianyi'}], turn: {speakerId: '1', text: '帮我查', startMs: 0, endMs: 1}}, 1_000);
  const hearing = resolveStatus(view.get(), 1_000);
  assert.deepEqual([hearing.text, hearing.who.label, hearing.who.tone], ['在听', 'Tianyi', 0]);
  view.speakerEvent({type: 'speaker.decision', shouldRespond: true, participants: [], addresseeIds: []}, 2_000);
  assert.equal(resolveStatus(view.get(), 2_500).text, '在想…');
  view.voice('speaking');
  assert.equal(resolveStatus(view.get(), 3_000).text, '在说');
  view.voice('listening');
  view.speakerEvent({type: 'speaker.decision', shouldRespond: false, participants: [], addresseeIds: []}, 4_000);
  assert.equal(resolveStatus(view.get(), 4_000).text, '只听不答');
  view.voice('speaking');
  assert.equal(view.get().speaker.listenOnly, false, 'V answering ends the aside');
});

test('idle has no status line; an idle error becomes a home note', () => {
  const view = createCallView();
  assert.equal(resolveStatus(view.get(), 0), null);
  view.message('请允许麦克风访问后重试。', 'error');
  assert.equal(view.get().homeNote, '请允许麦克风访问后重试。');
  view.message('拨号后，直接说话。');
  assert.equal(view.get().homeNote, null);
});

test('a failed request inside a call is a notice, not a redial prompt', () => {
  const view = connected();
  view.message('steer failed', 'problem');
  const status = resolveStatus(view.get(), Date.now());
  assert.equal(status.key, 'notice');
  assert.equal(status.action, undefined);
});

test('the current turn starts at the latest caller words; earlier turns are quiet', () => {
  const row = (key, role) => ({key, role, text: key, complete: true});
  const turns = splitTurns({history: [row('u1', 'user'), row('v1', 'assistant'), row('u2', 'user'), row('u3', 'user'), row('v2', 'assistant')], current: [row('v3', 'assistant')]});
  assert.deepEqual(turns.earlier.map(r => r.key), ['u1', 'v1']);
  assert.deepEqual(turns.now.map(r => r.key), ['u2', 'u3', 'v2', 'v3']);
  assert.deepEqual(splitTurns({history: [row('g', 'assistant')], current: []}).now.map(r => r.key), ['g']);
  assert.deepEqual(splitTurns({history: [], current: []}), {earlier: [], now: []});
});

test('task progress keeps its start time across presentation recovery and counts real stages', () => {
  const tasks = createAvatarTasks();
  tasks.consume({type: 'tool.call', callId: 'a', name: 'delegate_to_v'}, 1_000);
  tasks.consume({type: 'tool.progress', callId: 'a', stage: '查记忆'}, 2_000);
  tasks.consume({type: 'tool.progress', callId: 'a', stage: '查记忆'}, 3_000);
  tasks.consume({type: 'tool.progress', callId: 'a', stage: '上网搜索'}, 4_000);
  tasks.clear();
  tasks.consume({type: 'tool.call', callId: 'a', name: 'delegate_to_v'}, 9_000);
  assert.deepEqual(tasks.list(10_000), [{callId: 'a', activity: 'background', startedAt: 1_000, stage: '上网搜索', step: 2}]);
  tasks.consume({type: 'tool.result', callId: 'a'});
  assert.deepEqual(tasks.list(), []);
  tasks.consume({type: 'tool.progress', callId: 'a', stage: '读网页'});
  assert.deepEqual(tasks.list(), [], 'progress for a finished task cannot resurrect it');
});

test('view notifies only on real changes', () => {
  const view = createCallView();
  let calls = 0;
  view.subscribe(() => calls++);
  view.set({badge: view.get().badge});
  view.set({badge: '通话中'});
  view.voice('idle');
  assert.equal(calls, 1);
});

test('completion must not reorder overlapping captions or hide the newest answer', () => {
  const user = {key:'u', role:'user', text:'问题', at:1, complete:false};
  const answer = {key:'a', role:'assistant', text:'答案', at:2, complete:true};
  assert.deepEqual(splitTurns({history:[answer],current:[user]}).now.map(r=>r.key), ['u','a']);
  assert.deepEqual(splitTurns({history:[{...user,complete:true},answer],current:[]}).now.map(r=>r.key), ['u','a']);
});
