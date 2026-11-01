import {orderedTranscriptRows} from './transcript-presentation.mjs';
// The page's single view state. app.js (the call engine) writes it; the React
// UI (ui-bundle.mjs) reads it. Pure data: no DOM, no network, no timers.

export const TRANSIENT_MS = 4000;
export const THINKING_MS = 12000;

const NORMAL = new Set(['拨号后，直接说话。', 'V 正在听，直接说话就好', '正在连接 V…']);
export const TASK_LABELS = Object.freeze({memory: '查记忆', web: '查询网页', calendar: '查日程', background: '后台处理'});

/** A page status sentence, reduced to a few words for the one status line. */
export function messageDisplay(text, tone = 'info') {
  if (typeof text !== 'string' || !text || NORMAL.has(text)) return null;
  const full = text;
  if (/^正在结束通话/u.test(text)) return {kind: 'ending', text: '正在结束', spinner: true, full};
  if (/声音播放(被|已)暂停|恢复声音播放/u.test(text)) return {kind: 'action', text: '声音暂停', action: 'resume', actionLabel: '轻点恢复', full};
  if (/上一段语音还没确认结束/u.test(text)) return {kind: 'warn', text: '若无声音，请重拨', full};
  if (/正在恢复语音连接/u.test(text)) return {kind: 'warn', text: '恢复连接中', spinner: true, full};
  if (/语音尚未确认播完/u.test(text)) return {kind: 'notice', text: '可点挂断结束', full};
  if (tone === 'error') {
    const short = /语音服务报告错误/u.test(text) ? '语音服务出错' : /连接已中断/u.test(text) ? '连接已中断'
      : /麦克风/u.test(text) ? '请允许使用麦克风' : text;
    return {kind: 'error', text: short, action: 'redial', actionLabel: '重拨', full};
  }
  // A failed request inside a working call: say so, but the call goes on.
  if (tone === 'problem') return {kind: 'notice', tone: 'warn', text, full};
  if (tone === 'success') {
    const short = /补充内容已发送/u.test(text) ? '已发送' : /条件已交给原任务/u.test(text) ? '已交给后台'
      : /已请求取消/u.test(text) ? '已请求取消' : text;
    return {kind: 'notice', tone: 'success', text: short, transient: true, full};
  }
  return {kind: 'notice', text, full};
}

/** Speaker-routing events that change the status line; null clears it. */
export function speakerDisplay(value) {
  const full = value.message ?? '';
  if (value.type === 'speaker.error') {
    if (value.reason === 'farewell-no-audio') return {kind: 'notice', text: '告别没播出', action: 'hangup', actionLabel: '挂断', full};
    if (value.fatal || /重新拨号|重拨|已关闭|断开/u.test(full)) return {kind: 'error', text: '识别断开', action: 'redial', actionLabel: '重拨', full};
    return {kind: 'notice', text: '没听清，请再说一次', transient: true, full};
  }
  if (value.type === 'speaker.recovery') return {kind: 'notice', text: value.reason === 'mixed-speakers' ? '声音重叠，请轮流说' : '没听清，请再说一次', transient: true, full};
  if (value.type === 'speaker.asr-reconnecting') return {kind: 'warn', text: '识别恢复中', spinner: true, full};
  if (value.type === 'speaker.asr-recovered') return {kind: 'notice', tone: 'success', text: '识别已恢复', transient: true, full};
  if (value.type === 'speaker.end-accepted') return {kind: 'ending', text: '正在道别', spinner: true, full};
  if (value.type === 'speaker.end-revoked') return null;
  return undefined;
}

export const clock = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const live = (item, now) => item && (!item.transient || now - item.at < TRANSIENT_MS);

/**
 * One status line. Highest rank wins; nothing is stacked. Background work that
 * loses the line stays visible through the avatar's work pose.
 */
export function resolveStatus(state, now = Date.now()) {
  if (state.call === 'idle') return null;
  const message = live(state.message, now) ? state.message : null;
  const speaker = live(state.speaker.status, now) ? state.speaker.status : null;
  const pick = kind => [message, speaker].find(item => item?.kind === kind);
  for (const kind of ['error', 'warn', 'action']) {
    const item = pick(kind);
    if (item) return {key: kind, tone: kind, ...item};
  }
  if (state.call === 'ending' || pick('ending')) {
    const item = pick('ending') ?? {text: '正在结束', spinner: true, full: '正在结束通话'};
    return {key: 'ending', tone: 'notice', ...item};
  }
  const notice = pick('notice');
  if (notice) return {key: 'notice', tone: notice.tone ?? 'notice', ...notice};
  const tasks = state.tasks;
  if (tasks.length) {
    const latest = tasks.at(-1);
    const label = latest.stage ?? TASK_LABELS[latest.activity] ?? TASK_LABELS.background;
    const time = clock(now - Math.min(...tasks.map(task => task.startedAt)));
    const text = tasks.length > 1 ? `${tasks.length} 个任务` : `${label}中`;
    return {key: 'task', tone: 'task', text, time, tappable: true,
      full: `${tasks.every(task=>task.execution==='foreground')?'当前任务':'后台任务'}进行中：${tasks.length > 1 ? `${tasks.length} 个任务，最新` : ''}${label}，已进行 ${time}`};
  }
  return voiceStatus(state, now);
}

function voiceStatus(state, now) {
  if (state.call === 'dialing') return {key: 'voice', tone: 'voice', text: '正在连接', spinner: true, full: '正在连接 V'};
  if (state.voice === 'speaking') return {key: 'voice', tone: 'voice', text: '在说', full: 'V 在说话'};
  if (state.thinkingAt != null && now - state.thinkingAt < THINKING_MS) return {key: 'voice', tone: 'voice', text: '在想…', thinking: true, full: 'V 在想'};
  const speaker = state.speaker;
  if (speaker.listenOnly) return {key: 'voice', tone: 'voice', text: '只听不答', full: '旁聊，V 只听不答'};
  const person = speaker.lastSpeakerId && speaker.people.find(p => p.id === speaker.lastSpeakerId);
  if (person) return {key: 'voice', tone: 'voice', text: '在听', who: person, full: `V 在听 ${person.label}`};
  return {key: 'voice', tone: 'voice', text: '在听', full: 'V 在听，直接说话就好'};
}

/** Earlier turns stay quiet; the current turn starts at the latest caller words. */
export function splitTurns(snapshot) {
  const rows = orderedTranscriptRows(snapshot);
  let start = rows.findLastIndex(row => row.role === 'user');
  if (start < 0) start = Math.max(0, rows.length - 1);
  while (start > 0 && rows[start - 1].role === 'user') start--;
  return {earlier: rows.slice(0, start), now: rows.slice(start)};
}

const speakerId = id => String(id).startsWith('speaker:') ? String(id) : 'speaker:' + id;

export const INITIAL_VIEW = Object.freeze({
  call: 'idle', voice: 'idle', thinkingAt: null, callStartedAt: null,
  dial: {disabled: true, label: '拨号'}, stopLabel: '结束通话', badge: '连接中',
  statusText: '拨号后，直接说话。', statusTone: 'info', message: null, entry: null, homeNote: null, homeNoteTone: 'info',
  speaker: {multi: false, people: [], lastSpeakerId: null, listenOnly: false, status: null},
  tasks: [], cancelEnabled: false,
  transcript: {history: [], current: []},
  composer: {enabled: false, open: false}, muted: false, outputMuted: false,
  models: [], model: 'seeduplex', modelDisabled: false,
  grok: {voices: [], voice: null, hint: '', listenHref: './compare', listenAvailable: false},
  reading: false,
});

export function createCallView(initial = {}) {
  let state = {...INITIAL_VIEW, ...initial};
  const listeners = new Set();
  const set = patch => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next || Object.keys(next).every(key => Object.is(state[key], next[key]))) return;
    state = {...state, ...next};
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set,
    message(text, tone = 'info', now = Date.now()) {
      const display = messageDisplay(text, tone);
      set({statusText: text, statusTone: tone, message: display && {...display, at: now}, homeNote: state.call === 'idle' && display ? display.full : null, homeNoteTone: display?.kind === 'error' ? 'error' : 'info'});
    },
    voice(voice) {
      if (voice === state.voice) return;
      // V answering ends both "thinking" and an earlier listen-only aside.
      set(voice === 'speaking' ? {voice, thinkingAt: null, speaker: {...state.speaker, listenOnly: false}} : {voice});
    },
    thinking(now = Date.now()) { if (state.voice !== 'speaking') set({thinkingAt: now}); },
    speakerEvent(value, now = Date.now()) {
      const speaker = {...state.speaker, multi: true};
      if (Array.isArray(value.participants)) {
        const people = [...speaker.people];
        for (const person of value.participants) {
          if (!person?.id) continue;
          const id = speakerId(person.id), label = person.name ?? person.label ?? '说话人';
          const index = people.findIndex(p => p.id === id);
          if (index >= 0) people[index] = {...people[index], label};
          else people.push({id, label, tone: people.length % 5});
        }
        speaker.people = people;
      }
      let thinkingAt = state.thinkingAt;
      if (value.type === 'speaker.utterance' && value.turn?.speakerId !== undefined) {
        const id = speakerId(value.turn.speakerId);
        if (!speaker.people.some(p => p.id === id)) speaker.people = [...speaker.people, {id, label: 'Speaker ' + String.fromCharCode(65 + speaker.people.length), tone: speaker.people.length % 5}];
        speaker.lastSpeakerId = id;
        speaker.listenOnly = false;
      }
      if (value.type === 'speaker.decision') {
        speaker.listenOnly = value.shouldRespond === false;
        if (value.shouldRespond && state.voice !== 'speaking') thinkingAt = now;
      }
      const display = speakerDisplay(value);
      if (display !== undefined) speaker.status = display && {...display, at: now};
      set({speaker, thinkingAt});
    },
  };
}
