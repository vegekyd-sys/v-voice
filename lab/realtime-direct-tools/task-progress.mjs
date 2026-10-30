// Real backend stages for one delegated task, from the Gateway's own agent
// events for the task's exact runs. What the caller hears is what the backend
// is actually doing: the search terms it used, the memory it looks up, the
// site it reads. Tool outputs and model reasoning never reach narration.
const TOOL_LABELS = Object.freeze({
  memory_search:'查记忆', memory_get:'读记忆原文',
  web_search:'上网搜索', x_search:'搜索资料', web_fetch:'读网页',
  read:'读资料', pdf:'读 PDF 文档', image:'看图片',
  exec:'运行命令', process:'等命令跑完', bash:'运行命令', shell:'运行命令',
  feishu_calendar:'查日程', lark_read:'查飞书',
  sessions_spawn:'安排子任务', subagents:'安排子任务',
  image_generate:'生成图片', video_generate:'生成视频', music_generate:'生成音乐',
  message:'发消息', write:'写文件', edit:'改文件', apply_patch:'改文件',
});
export const STAGE_LABELS = new Set(Object.values(TOOL_LABELS));
const QUIET_LABELS = new Set(['运行命令', '等命令跑完', '安排子任务']);
const clip = (text, max = 32) => {
  const flat = String(text).replace(/[\s\u200b]+/gu, ' ').replace(/["“”「」]/gu, '').trim();
  return flat.length <= max ? flat : flat.slice(0, max).replace(/[\s,，、.。;；:：-]*\S*$/u, '') || flat.slice(0, max);
};
/** The caller-facing subject of one tool call, from its own arguments. */
export function stepDetail(name, args) {
  const base = typeof name === 'string' ? name.split(/[.:/]/u).at(-1) : '';
  if (!args || typeof args !== 'object') return null;
  if (['web_search', 'x_search', 'memory_search'].includes(base) && typeof args.query === 'string' && args.query.trim()) return clip(args.query);
  if (base === 'web_fetch' && typeof args.url === 'string') {
    try {return new URL(args.url).hostname.replace(/^www\./u, '');} catch {return null;}
  }
  return null;
}
/** One spoken sentence for a step, in V's own voice; the detail is the step's own subject. */
export function stepPhrase(label, detail) {
  if (label === '上网搜索' || label === '搜索资料') return detail ? `我在查${detail}` : '我在上网查';
  if (label === '查记忆') return detail ? `我翻翻记忆里${detail}的记录` : '我翻翻记忆里的记录';
  if (label === '读网页') return detail ? `我在看 ${detail} 上的内容` : '我在看网页';
  return label ? `我在${label}` : '我在弄下一步';
}
export const toolStageLabel = name => {
  const base = typeof name === 'string' ? name.split(/[.:/]/u).at(-1) : '';
  return Object.hasOwn(TOOL_LABELS, base) ? TOOL_LABELS[base] : null;
};

/**
 * The Gateway's own acceptance of a sub-agent spawned by this task's run: the
 * child's run and session then belong to the same task. Nothing else is read.
 */
export function spawnedChild(payload) {
  const d = payload?.data ?? {};
  if (payload?.stream !== 'tool' || d.phase !== 'result' || toolStageLabel(d.name) !== '安排子任务' || d.isError === true) return null;
  let value = d.result?.details;
  if (!value?.childSessionKey) try { value = JSON.parse(d.result?.content?.find(c => c?.type === 'text')?.text ?? ''); } catch { value = null; }
  const runId = typeof value?.runId === 'string' ? value.runId.trim() : '', sessionKey = typeof value?.childSessionKey === 'string' ? value.childSessionKey.trim() : '';
  return value?.status === 'accepted' && runId && sessionKey ? {runId, sessionKey} : null;
}

/**
 * Tracks tool calls of the task's own runs. Returns true when the stage changed.
 * Tools usually return within a second while the model thinks between them, so
 * the stage is the latest step taken, and whether it is still running.
 */
export function createTaskStages({now = Date.now} = {}) {
  const pending = new Map(), done = new Set(), streams = {};
  let failed = 0, changedAt = 0, lastLabel = null, events = 0, latest = null;
  const start = (id, name, args) => {
    if (done.has(id) || pending.has(id)) return false;
    const step = {id, label:toolStageLabel(name), detail:stepDetail(name, args), failed:false};
    // A shell command or an unknown tool says nothing about the task to the
    // caller: it counts as a step but the stage stays on the last describable one.
    if (step.label && !QUIET_LABELS.has(step.label)) latest = step;
    pending.set(id, step);changedAt = now();return true;
  };
  const end = (id, error) => {
    const step = pending.get(id);
    if (done.has(id) || !step) return false;
    pending.delete(id);done.add(id);if (error) {failed++;step.failed = true;}
    changedAt = now();return true;
  };
  return {
    /** Only events whose run belongs to this task are passed in. */
    consume(payload) {
      const d = payload?.data ?? {}, stream = payload?.stream;
      events++;const key = [stream, d.kind, d.phase].filter(Boolean).join('/');streams[key] = (streams[key] ?? 0) + 1;
      const id = typeof d.toolCallId === 'string' && d.toolCallId ? d.toolCallId : null;
      if (!id) return false;
      // The same call arrives as both a `tool` and an `item` event; one id, one step.
      if (stream === 'tool' || (stream === 'item' && d.kind === 'tool')) {
        if (d.phase === 'start') return start(id, d.name, d.args);
        if (d.phase === 'result' || d.phase === 'end')
          return end(id, d.isError === true || d.result?.isError === true || d.status === 'failed');
      }
      return false;
    },
    snapshot() {
      return {latest:latest?.label ?? null, detail:latest?.detail ?? null, latestRunning:Boolean(latest && pending.has(latest.id)), latestFailed:Boolean(latest?.failed),
        steps:done.size + pending.size, completed:done.size, failed, changedAt, events};
    },
    /** Remember what was last said, so the same stage is not announced twice. */
    spoken(key) {lastLabel = key;},
    lastSpoken: () => lastLabel,
    observed: () => ({events, streams:{...streams}, steps:done.size + pending.size}),
  };
}
/** What makes a stage worth a new line: a new subject or kind of step, or a failure. */
export const stageKey = stage => stage.steps ? `${stage.latest ?? '?'}|${stage.detail ?? ''}|${stage.failed}` : 'none';

/**
 * One short spoken line from verified state only: what V is doing right now
 * (the latest step and that step's own subject). Time is never spoken: the
 * screen shows it. Null when there is nothing the caller would want to hear.
 */
export function stageLine(stage) {
  if (!stage.steps || !stage.latest) return null;
  if (stage.latestFailed && !stage.latestRunning) return '刚才有一步没走通，我还在弄。';
  return `${stepPhrase(stage.latest, stage.detail)}。`;
}
// For a long silence with nothing new. Bounded, and it never states a duration.
export const IDLE_LINES = Object.freeze(['还在弄，有新进展我就说。', '这个有点费工夫，我还在看。']);
// The model said a job is done before it is: V corrects itself at once.
export const NOT_DONE_LINE = '等一下，这个我还没弄完，弄好了告诉你。';
export const TASK_FAILED_LINE = '这个我没弄成，要不要我再试一次？';
