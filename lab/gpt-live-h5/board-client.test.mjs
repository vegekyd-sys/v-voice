import assert from 'node:assert/strict';
import test from 'node:test';
import {BOARD_PROGRESS_INTERVAL_MS, createBoardClient, createSpokenCursor, readEventStream} from './board-client.mjs';

// Manual clock: timers fire only when the test advances time.
function harness(reply = () => []) {
  let time = 0, sequence = 0;
  const timers = new Map(), requests = [], scenes = [], events = [];
  const client = createBoardClient({
    now: () => time, observe: event => events.push(event), onScene: scene => scenes.push(scene),
    setTimer: (fn, wait) => { const id = ++sequence; timers.set(id, {fn, at: time + wait}); return id; },
    clearTimer: id => timers.delete(id),
    request: async (payload, {signal, onEvent}) => {
      const call = {payload, signal}; requests.push(call);
      const result = reply(payload, call);
      for (const value of Array.isArray(result) ? result : await result) onEvent(value);
    },
  });
  const advance = async ms => {
    const end = time + ms;
    for (;;) {
      // Settle pending promises first: a finished request may arm a timer.
      for (let turn = 0; turn < 12; turn++) await Promise.resolve();
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); time = Math.max(time, due[1].at); due[1].fn();
    }
    time = end;
  };
  return {client, requests, scenes, events, advance};
}
const row = (key, role, text, extra = {}) => ({key, role, text, at: Number(key.split('-')[1]), ...extra});
const snap = (history, current = []) => ({snapshot: {history, current}});
const steps = {op: 'put', rev: 2, block: {id: 's', t: 'steps', items: [{id: 'a', h: '拨号'}, {id: 'b', h: '接通'}]}};

test('a settled question asks once and draws what streams back', async () => {
  const h = harness(() => [{op: 'scene', title: '通话', rev: 1}, steps, {op: 'done', reason: 'drawn', durationMs: 900, firstOpMs: 400}]);
  h.client.update(snap([], [row('turn-1', 'user', '电话是怎么')]));
  await h.advance(1000);
  assert.equal(h.requests.length, 0, 'a caption still changing is not a question yet');
  h.client.update(snap([row('turn-1', 'user', '电话是怎么接通的')]));
  h.client.update(snap([row('turn-1', 'user', '电话是怎么接通的')]));
  await h.advance(400);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].payload, {trigger: 'user', rev: 0, turns: [{role: 'user', text: '电话是怎么接通的'}]});
  assert.deepEqual(h.scenes.map(scene => [scene.rev, scene.blocks.length]), [[1, 0], [2, 1]]);
  assert.equal(h.client.scene.title, '通话');
  assert.deepEqual(h.events.map(event => event.type), ['requested', 'done', 'finished']);
  await h.advance(5000);
  assert.equal(h.requests.length, 1, 'nothing new was said');
});

test('while V speaks only whole phrases are sent, no faster than the interval', async () => {
  const h = harness();
  const user = row('turn-1', 'user', '讲讲原理');
  h.client.update(snap([user]));
  await h.advance(400);
  h.client.update(snap([user], [row('turn-2', 'assistant', '好的，分三')]));
  await h.advance(400);
  assert.equal(h.requests.length, 1, 'no finished phrase yet');
  h.client.update(snap([user], [row('turn-2', 'assistant', '好的，分三步。第一步是拨')]));
  await h.advance(400);
  assert.deepEqual([h.requests[1].payload.trigger, h.requests[1].payload.turns.at(-1)], ['assistant_progress', {role: 'assistant', text: '好的，分三步。'}]);
  h.client.update(snap([user], [row('turn-2', 'assistant', '好的，分三步。第一步是拨号。第二步')]));
  await h.advance(1000);
  assert.equal(h.requests.length, 2, 'throttled');
  await h.advance(BOARD_PROGRESS_INTERVAL_MS);
  assert.equal(h.requests[2].payload.turns.at(-1).text, '好的，分三步。第一步是拨号。');
  h.client.update(snap([user, row('turn-2', 'assistant', '好的，分三步。第一步是拨号。第二步是接通。')]));
  await h.advance(400);
  assert.deepEqual([h.requests[3].payload.trigger, h.requests[3].payload.turns.at(-1).text], ['assistant_end', '好的，分三步。第一步是拨号。第二步是接通。']);
  await h.advance(10000);
  assert.equal(h.requests.length, 4);
});

test('an unfinished caller caption counts once V has started answering', async () => {
  const h = harness();
  h.client.update(snap([], [row('turn-1', 'user', '今天有什么安排'), row('turn-2', 'assistant', '我看一下。')]));
  await h.advance(400);
  assert.equal(h.requests[0].payload.trigger, 'user');
});

test('a new question aborts the picture still being drawn for the old one', async () => {
  let release;
  const h = harness((payload, call) => call.payload.turns.at(-1).text === '第一个问题'
    ? new Promise(resolve => { release = () => resolve([{op: 'scene', title: '旧', rev: 1}]); }) : [{op: 'scene', title: '新', rev: 1}]);
  const first = row('turn-1', 'user', '第一个问题');
  h.client.update(snap([first]));
  await h.advance(400);
  h.client.update(snap([first, row('turn-2', 'user', '换个问题')]));
  assert.equal(h.requests[0].signal.aborted, true);
  release();
  await h.advance(400);
  assert.deepEqual(h.scenes.map(scene => scene.title), ['新']);
  assert.equal(h.events.some(event => event.type === 'finished' && event.run === 1), true);
});

test('a delivered document and a finished lookup both ask with the evidence trigger', async () => {
  const h = harness();
  const rows = [row('turn-1', 'user', '查一下'), row('turn-2', 'assistant', '查到了。')];
  h.client.update(snap(rows));
  await h.advance(400);
  await h.advance(400);
  assert.deepEqual(h.requests.map(call => call.payload.trigger), ['user', 'assistant_end']);
  h.client.update(snap([...rows, row('document-3', 'assistant', '# 报告\n\n' + '长'.repeat(3000), {document: true})]));
  await h.advance(400);
  assert.equal(h.requests[2].payload.trigger, 'evidence');
  assert.deepEqual([h.requests[2].payload.turns.at(-1).role, h.requests[2].payload.turns.at(-1).text.length], ['document', 2000]);
  h.client.evidence();
  await h.advance(400);
  assert.equal(h.requests[3].payload.trigger, 'evidence');
});

test('a full scene replaces the page copy and the next request carries its revision', async () => {
  const scene = {rev: 7, serial: 2, title: '同步', focus: 's/b', blocks: [steps.block, {id: 'x', t: 'iframe'}]};
  const h = harness(payload => payload.rev === 0 ? [{op: 'sync', scene}, {op: 'focus', id: 's/a', rev: 8}, {op: 'bogus'}] : []);
  h.client.update(snap([row('turn-1', 'user', '继续')]));
  await h.advance(400);
  assert.deepEqual([h.client.scene.rev, h.client.scene.focus, h.client.scene.blocks.length], [8, 's/a', 1]);
  h.client.update(snap([row('turn-1', 'user', '继续'), row('turn-2', 'user', '再来')]));
  await h.advance(400);
  assert.equal(h.requests[1].payload.rev, 8);
});

test('a failed request leaves the board as it was; dispose stops everything', async () => {
  const h = harness(() => { throw Error('offline'); });
  h.client.update(snap([row('turn-1', 'user', '你好')]));
  await h.advance(400);
  assert.deepEqual(h.events.map(event => event.type), ['requested', 'failed']);
  assert.equal(h.scenes.length, 0);
  h.client.update(snap([row('turn-1', 'user', '你好'), row('turn-2', 'user', '在吗')]));
  h.client.dispose();
  await h.advance(5000);
  assert.equal(h.requests.length, 1);
});

test('the event stream is parsed across chunk boundaries', async () => {
  const parts = ['data: {"op":"scene","title":"a","rev":1}\n\nda', 'ta: {"op":"focus","id":""}\n\n: keepalive\n\ndata: not json\n\ndata: {"op":"done"}'];
  const encoder = new TextEncoder();
  const body = {getReader() { let index = 0; return {read: async () => index < parts.length ? {done: false, value: encoder.encode(parts[index++])} : {done: true}}; }};
  const seen = [];
  await readEventStream({body}, value => seen.push(value.op));
  assert.deepEqual(seen, ['scene', 'focus', 'done']);
});

test('the spoken position is the played share of the reply\'s own audio', () => {
  const cursor = createSpokenCursor();
  // An earlier reply played out completely: 96 kB received, nothing queued.
  assert.equal(cursor.index({key: 'turn-1', textLength: 10, outputBytes: 96000, queuedBytes: 0}), 0);
  // The next reply: text and audio arrive far ahead of playback.
  assert.equal(cursor.index({key: 'turn-2', textLength: 40, outputBytes: 96000, queuedBytes: 0}), 0);
  assert.equal(cursor.index({key: 'turn-2', textLength: 40, outputBytes: 96000 + 480000, queuedBytes: 480000}), 0);
  assert.equal(cursor.index({key: 'turn-2', textLength: 100, outputBytes: 96000 + 960000, queuedBytes: 720000}), 25);
  assert.equal(cursor.index({key: 'turn-2', textLength: 100, outputBytes: 96000 + 960000, queuedBytes: 0}), 100);
  // A barge-in flushes the queue; the following reply starts from zero again.
  assert.equal(cursor.index({key: 'turn-3', textLength: 20, outputBytes: 96000 + 960000, queuedBytes: 0}), 0);
  assert.equal(cursor.index({key: 'turn-3', textLength: 20, outputBytes: 96000 + 960000 + 48000, queuedBytes: 24000}), 10);
});
