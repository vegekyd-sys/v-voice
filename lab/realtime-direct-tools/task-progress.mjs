// Real backend stages for one delegated task, from the Gateway's own agent
// events for the task's exact runs. A tool name maps to a fixed phrase; tool
// arguments, outputs, paths and model reasoning never reach narration.
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

/** Tracks tool calls of the task's own runs. Returns true when the stage changed. */
export function createTaskStages({now = Date.now} = {}) {
  const pending = new Map(), done = new Set(), streams = {};
  let failed = 0, changedAt = 0, lastLabel = null, events = 0;
  const start = (id, name) => {
    if (done.has(id) || pending.has(id)) return false;
    pending.set(id, {label:toolStageLabel(name), at:now()});changedAt = now();return true;
  };
  const end = (id, error) => {
    if (done.has(id) || !pending.delete(id)) return false;
    done.add(id);if (error) failed++;changedAt = now();return true;
  };
  return {
    /** Only events whose runId belongs to this task are passed in. */
    consume(payload) {
      const d = payload?.data ?? {}, stream = payload?.stream;
      events++;const key = [stream, d.kind, d.phase].filter(Boolean).join('/');streams[key] = (streams[key] ?? 0) + 1;
      const id = typeof d.toolCallId === 'string' && d.toolCallId ? d.toolCallId : null;
      if (!id) return false;
      // The same call arrives as both a `tool` and an `item` event; one id, one step.
      if (stream === 'tool' || (stream === 'item' && d.kind === 'tool')) {
        if (d.phase === 'start') return start(id, d.name);
        if (d.phase === 'result' || d.phase === 'end')
          return end(id, d.isError === true || d.result?.isError === true || d.status === 'failed');
      }
      return false;
    },
    snapshot() {
      const running = [...pending.values()].at(-1);
      return {running:Boolean(running), label:running?.label ?? null, runningSince:running?.at ?? null,
        completed:done.size, failed, changedAt, events};
    },
    /** Remember what was last said, so the same stage is not announced twice. */
    spoken(label) {lastLabel = label;},
    lastSpoken: () => lastLabel,
    observed: () => ({events, streams:{...streams}, steps:done.size + pending.size}),
  };
}

// Rounded down: "已经40秒了" is never more than the time that actually passed.
const minutes = ms => ms < 60000 ? `${Math.max(1, Math.floor(ms / 10000)) * 10}秒` : `${Math.floor(ms / 30000) / 2}分钟`.replace('.5分钟', '分半钟');

/**
 * One short spoken line from verified state only: elapsed time since the task
 * was admitted, the tool that is actually running, and how many steps returned.
 * `heartbeat` marks a repeat of an unchanged stage, which then leads with time.
 */
export function stageLine(stage, {elapsedMs, heartbeat = false} = {}) {
  const time = minutes(elapsedMs);
  if (stage.running && stage.label) return heartbeat ? `后台还在${stage.label}，已经${time}了。` : `后台正在${stage.label}。`;
  if (stage.running) return heartbeat ? `后台还在处理，已经${time}了。` : `后台在做下一步。`;
  if (stage.failed && !heartbeat) return `有一步没成功，后台还在继续。`;
  if (stage.completed) return heartbeat ? `后台已经做完${stage.completed}步，还在继续，已经${time}了。` : `后台做完了${stage.completed}步，还在继续。`;
  return `后台还在处理，已经${time}了。`;
}
