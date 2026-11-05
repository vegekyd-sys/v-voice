import { APPROVED_REACTION_ADDITIONS } from './avatar-approved-reactions.mjs';
// Only a coarse visual category crosses the wire; never arguments or results.
export const AVATAR_POSES = Object.freeze({
  idle: 'v-operator-idle-512.webp',
  listen: 'v-operator-square-listen-0-512.webp',
  memory: 'v-operator-square-memory-0-512.webp',
  web: 'v-operator-square-web-0-512.webp',
  calendar: 'v-operator-square-calendar-0-512.webp',
  background: 'v-operator-square-background-0-512.webp',
  complete: 'v-operator-square-complete-0-512.webp',
  reaction: 'v-operator-square-reaction-0-512.webp',
});
export const AVATAR_SEQUENCES = Object.freeze(Object.fromEntries(Object.keys(AVATAR_POSES).map(pose => [pose,
  Object.freeze(pose === 'idle' ? [AVATAR_POSES.idle] : Array.from({length:pose==='reaction'?APPROVED_REACTION_ADDITIONS.length:6}, (_,i)=>`v-operator-square-${pose}-${i}-512.webp`))])));
export const HOME_AVATAR_FILE = 'v-operator-home-1024.webp';
export const AVATAR_FILES = [HOME_AVATAR_FILE, ...Object.values(AVATAR_SEQUENCES).flatMap(files => files.flatMap(file => [file,file.replace('-512.webp','-256.webp')]))];
export const ACTIVITY_LABELS = Object.freeze({memory:'正在查记忆', web:'正在查资料', calendar:'正在查日程', background:'后台处理中'});
export function taskActivity(name, args = {}, depth = 0) {
  if (['end_call','openclaw_end_call','openclaw_live_call_control','cancel_task','current_time','set_speaker_volume'].includes(name)) return 'control';
  if (['memory_search','memory_get'].includes(name)) return 'memory';
  if (['web_search','web_fetch'].includes(name)) return 'web';
  if (name === 'feishu_calendar') return 'calendar';
  // Wrapped native tools have the same visual identity, without forwarding args.
  if (name === 'openclaw_tool' && depth === 0) {
    try { return taskActivity(args.tool, JSON.parse(args.arguments), 1); } catch { return 'background'; }
  }
  // An actual read-only calendar CLI invocation, not a guess from the user prompt.
  if (name === 'exec' && typeof args?.command === 'string' && !/[;&|`\n$]/u.test(args.command) && /^\s*['"]?lark-cli['"]?\s+['"]?calendar['"]?\s+['"]?\+agenda(?:['"]?\s|['"]?$)/u.test(args.command)) return 'calendar';
  return 'background';
}
export function createAvatarTasks() {
  const pending = new Map();
  // Start time and backend stage outlive clear(): presentation recovery
  // replays the same pending calls, which must not restart their clocks.
  const details = new Map();
  let completion = null;
  return {
    consume(event, now = Date.now()) {
      if (typeof event?.callId !== 'string' || !event.callId) return;
      if (event.type === 'tool.call') {
        const activity = Object.hasOwn(ACTIVITY_LABELS, event.activity) || event.activity === 'control'
          ? event.activity : taskActivity(event.name);
        if (activity !== 'control' && !pending.has(event.callId)) pending.set(event.callId, activity);
        if (activity !== 'control' && !details.has(event.callId)) details.set(event.callId, {startedAt: now, stage: event.execution==='foreground'&&typeof event.stage==='string'?event.stage.slice(0,80):null, step: 0,...(event.execution==='foreground'?{execution:'foreground'}:{})});
      } else if (event.type === 'tool.progress' && pending.has(event.callId) && typeof event.stage === 'string' && event.stage) {
        const detail = details.get(event.callId);
        if (detail && detail.stage !== event.stage) { detail.stage = event.stage; detail.step++; }
      } else if (['tool.result','tool.error'].includes(event.type) && pending.delete(event.callId)) {
        details.delete(event.callId);
        completion = {id:event.callId, ok:event.type === 'tool.result'};
      }
    },
    clear() { pending.clear(); completion = null; },
    reset() { pending.clear(); details.clear(); completion = null; },
    list(now = Date.now()) {
      return [...pending].map(([callId, activity]) => ({callId, activity, startedAt: details.get(callId)?.startedAt ?? now,
        stage: details.get(callId)?.stage ?? null, step: details.get(callId)?.step ?? 0,...(details.get(callId)?.execution?{execution:details.get(callId).execution}:{})}));
    },
    get completion() { return completion; },
    get size() { return pending.size; },
    get pose() { return [...pending.values()].at(-1) ?? 'idle'; },
  };
}
