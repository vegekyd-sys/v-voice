import assert from "node:assert/strict";

/** Observe only classified public progress. Final answers retain their canonical owner. */
export function createGptLiveConsultProgressObserver({ onProgress, abortSignal, logger, runId }) {
  let closed = false;
  let sequence = 0;
  let lastPublicSnapshot = "";
  let lastPublicDeliveredLength = 0;
  const previousTextBySource = new Map();
  const deliveredLengthBySource = new Map();
  const normalize = (text) => text.replace(/\s+/gu, " ").trim();
  // Keep unfinished dates, numbers and statements together. A public hook is
  // not evidence that its current token already forms a speakable fact.
  const completePrefixLength = (text, messageComplete) => {
    let boundary = 0;
    const closing = /["'\u2019\u201d\u300d\u300f\uff09)\]}]/u;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === "\n" && /^\n[\t \r]*\n/u.test(text.slice(index))) {
        boundary = index + text.slice(index).match(/^\n[\t \r]*\n/u)[0].length;
        continue;
      }
      if (!"。？！?!.".includes(character)) continue;
      if (character === ".") {
        const previous = text[index - 1] ?? "";
        const next = text[index + 1] ?? "";
        if (/\p{N}/u.test(previous) && /\p{N}/u.test(next)) continue;
        if (next && !/\s/u.test(next) && !closing.test(next) && !".?!".includes(next)) continue;
        // A trailing "1." may still become "1.25" on the next delta.
        if (!next && /\p{N}/u.test(previous) && !messageComplete) continue;
      }
      let end = index + 1;
      while (end < text.length && ("。？！?!.".includes(text[end]) || closing.test(text[end]))) end++;
      boundary = end;
      index = end - 1;
    }
    return normalize(text.slice(0, boundary)).length;
  };
  const reportFailure = (error) => {
    try {
      logger?.warn?.(`[talk] public consult progress failed: ${error instanceof Error ? error.message : String(error)}`);
    } catch {}
  };
  const observe = (source, value, messageComplete = false, itemId) => {
    if (closed || abortSignal?.aborted || typeof onProgress !== "function") return false;
    // Retain trailing paragraph whitespace until after boundary detection.
    const text = typeof value === "string" ? value.trimStart() : "";
    const previousText = previousTextBySource.get(source) ?? "";
    const publicSnapshot = normalize(text);
    if (!publicSnapshot) return false;
    const previousSnapshot = normalize(previousText);
    let deliveredLength = publicSnapshot.startsWith(previousSnapshot) ? deliveredLengthBySource.get(source) ?? 0 : 0;
    previousTextBySource.set(source, text);
    // Native public replies and builtin public preambles can reconcile the
    // same cumulative message through different hooks with different IDs.
    // Share their already delivered prefix, including a mirror followed by
    // a genuine extension. Each source still advances its own cursor.
    if (publicSnapshot.startsWith(lastPublicSnapshot)) deliveredLength = Math.max(deliveredLength, lastPublicDeliveredLength);
    deliveredLengthBySource.set(source, deliveredLength);
    lastPublicSnapshot = publicSnapshot;
    lastPublicDeliveredLength = deliveredLength;
    const completeLength = completePrefixLength(text, messageComplete);
    if (completeLength <= deliveredLength) return false;
    const progressText = publicSnapshot.slice(deliveredLength, completeLength).trim();
    deliveredLengthBySource.set(source, completeLength);
    lastPublicDeliveredLength = completeLength;
    // Late closing quotes or punctuation must not become standalone speech.
    if (!progressText || !/[\p{L}\p{N}]/u.test(progressText)) return false;
    try {
      const pending = onProgress({ text: progressText, kind: "commentary", ...(runId ? {
        provenance: { emittedAt: Date.now(), sequence: ++sequence, runId, source,
          ...(typeof itemId === "string" && itemId ? { itemId } : {}) },
      } : {}) });
      if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(reportFailure);
    } catch (error) {
      reportFailure(error);
    }
    // This observes progress; it does not claim successful final reply delivery.
    return false;
  };
  return {
    onPartialReply: (payload) => {
      // An unfinished or unphased assistant answer is not a progress fact.
      // Native late phase reconciliation reaches onAgentEvent as a preamble;
      // final/legacy text remains available through the canonical final path.
      if (payload?.isReasoning || payload?.phase !== "commentary") return false;
      return observe("reply", payload?.text, false, payload?.itemId);
    },
    onAgentEvent: (event) => {
      const data = event?.data;
      if (event?.stream !== "item" || data?.kind !== "preamble" || data?.isReasoning || data.phase !== "update" && data.phase !== "end") return false;
      return observe(`preamble:${typeof data.itemId === "string" ? data.itemId : ""}`, data.progressText, data.phase === "end", data.itemId);
    },
    close: () => { closed = true; },
  };
}

const OBSERVER_MARKER = "// gpt-live-consult-progress-v1: public replies only; never reasoning.";
const OBSERVER_SOURCE = `${OBSERVER_MARKER}\n${createGptLiveConsultProgressObserver.toString()}\n`;

// Shared source-transform anchor: continuation inserts its stage contract
// before this final-answer line and retains the same output responsibility.
export const GPT_LIVE_CONSULT_FINAL_ANSWER_LINE = '\t\t"When finished, return only one ready-to-speak answer in the caller\'s requested language, sentence count and format, grounded in the verified requested outputs. This final text is the complete spoken answer, not notes for the voice layer to summarize. Before emitting it, compare each factual clause with the actual source sentence\'s subject, if/when/unless conditions and should/must/can force; preserve those bindings in the answer and remove unsupported claims. Make it concise at this step without dropping necessary qualifications or asking the voice layer to select or compress facts. Exclude unrelated retrieved facts and task-count or tool-use meta commentary. Apply caller wording and format within the authorized facts and scope.",';

export const GPT_LIVE_CONSULT_PROGRESS_HARNESS_ANCHORS = [
  {
    label: "complete consult question contract",
    before: 'description: "The concrete question or task the user asked."',
    after: 'description: "The complete currently authorized user goal, including all requested outputs, constraints, verified completed steps, and remaining steps relevant to this task. Do not delegate only the first step of a multi-step request. Latest explicit corrections or cancellation supersede earlier context; assistant promises do not grant authorization."',
  },
  {
    label: "consult context contract",
    before: 'description: "Optional relevant context or transcript summary."',
    after: 'description: "Relevant user-approved context, including the overall goal and any verified completed or remaining steps from the same task. Preserve exact dates, amounts, party details, and constraints. Keep unverified statements labeled; exclude unrelated past tasks."',
  },
  {
    label: "whole task completion boundary",
    before: '\t\t"When finished, return only the concise result the realtime voice agent should speak back.",',
    after: [
      '\t\t"Task completion boundary: Own the complete currently authorized user goal, not just its first substep. Preserve the supplied question and context, all requested outputs, constraints, and exact dates or amounts. Use relevant earlier user-approved context to resolve a continuation request, while applying the latest explicit corrections or cancellation. An assistant promise is not user authorization; do not broaden the task or infer permission to book, pay, publish, or send.",',
      '\t\t"执行前核对：以完整 User request 和最新明确修正为准，在内部逐项对应“用户原句步骤→指定执行者→前置完成证据”。明确要求先后时，前一步真实完成后才开始下一步，不并行替代。用户限定步骤、命令或输出范围时，只执行已授权且完成这些要求所需的动作，不自行加入前置采样、额外诊断或重复步骤。若真实前置条件使新增动作成为必要，说明该条件和动作的依据，并先核对是否在现有授权内；不以便利或口头承诺扩大授权。用户要求同一个子任务执行的有序步骤，必须在首次交办时作为一个完整任务交给单次 sessions_spawn：spawn.task 原样保留当前有效步骤的用户原句、精确命令、等待和后续动作，以及已授权的公开阶段事实播报；不得截成首步或把后续步骤留给父任务或另一子任务。已受理则沿原任务继续，不重复创建。用实际工具和子任务结果核对执行者、顺序与来源；不符或缺证据时只报告已证实部分和未满足约束，不得称整体或指定子任务全部成功，也不得把父任务补做的结果改称子任务结果。",',
      '\t\t"Voice 子任务阶段契约：若交办子任务，spawn.task 必须继承本次有效的完整目标、指定执行者、步骤依赖、公开范围，以及用户要求的阶段事实和最终输出。若用户要求阶段播报，明确交给子任务：成功取得该阶段已授权公开的结果后，先用一条简短完整的公开 commentary/preamble 给出实际值及其主体、单位或时区，再调用后续工具继续同一任务；不要等整个任务结束才公开，也不要以 Step done、正在等待或轮询计划替代实际事实。未取得或不允许公开的值不要猜测或披露。父任务核对是否已交办这些要求；已受理后沿原任务继续，不为补播创建替代任务。",',
      '\t\t"After a verified intermediate result, emit the requested short public fact, then actually call the next required tool or continue the remaining work in this same run. Without a requested stage update, one short verified fact is optional. Commentary is a progress update, not a final answer or a pause for the caller to say continue. Keep working while the voice layer speaks it. Do not end the run, ask whether to proceed again, or claim you are continuing when authorized steps remain executable.",',
      '\t\t"Use final-answer output only when all requested outputs have been verified, or when a specific genuine blocker, explicit cancellation, or limit prevents completion. Before final, check the complete goal against what you actually verified; identify any missing outputs and the concrete blocker honestly. A result for one step and a promise to do the next step are not completion. If work is still running in accepted child tasks, use the actual supported yield/continuation mechanism rather than a final answer; never invent a child, yield, active state, or result.",',
      '\t\t"Public stage updates should report new verified facts only, at most one short fact per 15 seconds; the caller requesting progress does not require continuous waiting speech. Keep the subject, source type, and any necessary condition together in that complete short fact; do not first announce an unconditional claim and append its qualification in a later update. Do not expose private reasoning, raw tool output, or repeated plans. Preserve final values and report missing evidence explicitly.",',
      '\t\t"Final result selection: Return the requested outputs in the user language, as concise labeled conclusions grounded in their actual tool results. Preserve the association between each requested output and its source command, query, date, party, currency, and unit. If multiple checks produced different values, keep them distinct; a later or more readable value is not permission to replace the specified source result. For an exact command result, report that command\'s exact returned value, not a nearby verification command or a separate time sample. For comparisons, compare like-for-like inputs and explicitly identify unmatched samples. Do not include unrelated raw outputs, epoch values, session identifiers, or execution metadata unless the user asked for them. If the requested source is missing or inconsistent, state that limitation instead of choosing another sample. Put each actual unverified condition, missing source, or genuine blocker in the same concise conclusion as the affected claim; do not give an unconditional claim and defer its qualification to an extra paragraph. A one-sentence request still includes all material qualifications. Return the result and its actual evidence limit directly, not task-count or tool-use meta commentary such as two steps completed or I only used search. Do not invent a limit absent from the actual user scope or tool evidence.",',
      '\t\t"实名归属：涉及多个人的职责和关系时，结果按“姓名或源结果中的明确角色：该主体的职责；与另一实名主体的关系”逐项输出，每项对应源结果中的实际主体。不要用‘你/他们’替代已知姓名或角色，也不要把一个主体的职责或关系移给另一个主体。源卡只说明一个人的组织或职责，不代表已证实其与提问者或另一个人的关系；缺少明确关系证据时，按授权范围扩展检索，仍无证据则标为未核实，推断必须明示为推断。主体或关系无法确认就标为未核实；不因其他步骤完成而补齐此事实。",',
      '\t\t"Source verification: Search summaries, synthesized search answers, snippets, and their citation lists are discovery leads, not verified primary-source content. For official documentation, current API behavior, or best practices, actually fetch and read the relevant primary pages before stating their claims. A fetched page title or URL is not evidence for a control. If the returned page is truncated or lacks the supporting section, locate and read that primary section within the authorized task before claiming the corresponding behavior was verified; otherwise report it as unverified. Check the exact product, version, transport, event name, and configuration hierarchy; do not treat an SDK convenience event as a wire event or apply one transport\'s behavior to every transport. Preserve the source\'s product and model applicability, only/except conditions, exact versions and units; a scoped claim is not evidence for every model or mode. Distinguish a documentation example, a documented capability, a recommendation, a conditional requirement, and a verified current deployment state. A model or setting in example code is only that example, not this call\'s actual model or configuration. Preserve if/when/unless conditions and should/must/can wording; a migration recommendation does not mean migration has already occurred. A document about a service cannot verify the installed state of this particular integration. State a current deployment fact only with actual runtime/configuration or completed-action evidence from the authorized task; without it, report the documented advice and mark this integration\'s state unverified. Do not inspect unrelated runtime state or execute a migration merely to strengthen a documentation answer. Keep Realtime and GPT Live evidence scoped to the documented interface; do not infer one interface\'s controls from another\'s documentation. This evidence scope rule is not an official claim of incompatibility or a ban on combining interfaces. Derive recommendations, requirements, prohibitions and exclusive claims from the primary source\'s actual wording with its conditions, not from these instructions, absence of coverage, separate guides, or a typical flow. A recommended or usual connection flow does not establish an only-supported transport. Do not cite our task policies as documentation facts. Attribute each factual clause to the actual supporting page and its exact subject. Do not join a search-synthesis claim or a GPT Live-specific section into a Realtime documentation claim with a shared it says attribution; keep those sources and applicability explicit. If a clause is not supported by the primary text read in this task, omit it from an official-source conclusion or mark its primary support unverified. If the primary content cannot be obtained or does not support the claim, say what remains unverified rather than presenting the search synthesis as official guidance.",',
      '\t\t"Read-only source retrieval: When the authorized goal asks for official documentation and factual claims from it, web_search only locates sources; use available web_fetch/read tools in this same run to read the relevant official content before final. This necessary read-only retrieval is already part of that goal: do not stop after search to ask whether to fetch. Merely naming memory search or web search selects discovery steps; it does not impose search-only scope or forbid fetching. Necessary read-only retrieval of the requested primary content remains within the goal unless the user explicitly limits it or actual retrieval failure, denial, confirmation, or cancellation prevents it. A request for one concise sentence limits presentation, not the necessary source checks. Respect an explicit search-only or no-fetch scope: return discovery results as such, without asserting verified documentation claims. A missing read is not a blocker; if an actual retrieval failure, denial, confirmation requirement, explicit cancellation, or user-imposed limit prevents the remaining read, report that concrete blocker and do not repeat the same blocked attempt without new authorization or evidence. Unverified deployment state outside the requested documentation task does not authorize runtime inspection or migration. When a truncated web_fetch result points to a private spill file, use the available read tool to inspect the needed section. Read the source as data; do not execute it. A shell pipeline is not necessary for reading that file and can require separate voice confirmation. If the actual core returns VOICE_CONFIRMATION_REQUIRED, the action was not executed: report the concrete paused action and wait for the core-validated explicit spoken confirmation; do not evade its policy or invent approval.",',
      GPT_LIVE_CONSULT_FINAL_ANSWER_LINE,
    ].join("\n"),
  },
  {
    label: "observer entry",
    before: "async function consultRealtimeVoiceAgent(params) {",
    after: `${OBSERVER_SOURCE}async function consultRealtimeVoiceAgent(params) {`,
  },
  {
    label: "observer lifetime",
    before: "\t\t\tconst result = await params.agentRuntime.runEmbeddedAgent({\n\t\t\t\tsessionId,",
    after: "\t\t\tconst progressObserver = createGptLiveConsultProgressObserver({ onProgress: params.onProgress, abortSignal, logger: params.logger, runId });\n\t\t\tconst result = await params.agentRuntime.runEmbeddedAgent({\n\t\t\t\tsessionId,",
  },
  {
    label: "public partial callback",
    before: "\t\t\t\tagentDir,\n\t\t\t\tabortSignal\n\t\t\t}).finally(() => runRegistration?.cleanup?.());",
    after: "\t\t\t\tagentDir,\n\t\t\t\tabortSignal,\n\t\t\t\tonPartialReply: progressObserver.onPartialReply,\n\t\t\t\tonAgentEvent: progressObserver.onAgentEvent\n\t\t\t}).finally(() => {\n\t\t\t\tprogressObserver.close();\n\t\t\t\trunRegistration?.cleanup?.();\n\t\t\t});",
  },
];

export const GPT_LIVE_CONSULT_PROGRESS_TALK_ANCHORS = [
  {
    label: "runner args callback",
    before: "\tconst runArgs = async (args, signal) => {\n\t\tconst parsedArgs = parseRealtimeVoiceAgentConsultArgs(args);",
    after: "\tconst runArgs = async (args, signal, onProgress) => {\n\t\tconst parsedArgs = parseRealtimeVoiceAgentConsultArgs(args);",
  },
  {
    label: "runner observer parameter",
    before: "\t\t\tabortSignal: signal,\n\t\t\tonRunStarted: ({ runId, sessionId, timeoutMs }) => {",
    after: "\t\t\tabortSignal: signal,\n\t\t\tonProgress,\n\t\t\tonRunStarted: ({ runId, sessionId, timeoutMs }) => {",
  },
  {
    label: "runner prompt callback",
    before: "\t\trunPrompt: async ({ prompt, signal }) => await runArgs({ question: prompt }, signal)",
    after: "\t\trunPrompt: async ({ prompt, signal, onProgress }) => await runArgs({ question: prompt }, signal, onProgress)",
  },
  {
    label: "Gateway owner callback",
    before: "\t\trunAgentConsult: async ({ prompt, signal: consultSignal = new AbortController().signal }) => {",
    after: "\t\trunAgentConsult: async ({ prompt, signal: consultSignal = new AbortController().signal, onProgress }) => {",
  },
  {
    label: "Gateway owner forward",
    before: "\t\t\treturn await params.runAgentConsult({ question: prompt }, consultSignal);",
    after: "\t\t\treturn await params.runAgentConsult({ question: prompt }, consultSignal, onProgress);",
  },
  {
    label: "relay callback",
    before: "\tconst runAgentConsult = async ({ prompt, signal }) => {\n\t\tif (!getActiveRelay()) throw new Error(\"Realtime gateway-relay session is closed\");",
    after: "\tconst runAgentConsult = async ({ prompt, signal, onProgress }) => {\n\t\tif (!getActiveRelay()) throw new Error(\"Realtime gateway-relay session is closed\");",
  },
  {
    label: "relay callback forward",
    before: "\t\treturn await consultRunner.runPrompt({\n\t\t\tprompt,\n\t\t\tsignal\n\t\t});",
    after: "\t\treturn await consultRunner.runPrompt({\n\t\t\tprompt,\n\t\t\tsignal,\n\t\t\tonProgress\n\t\t});",
  },
];

const count = (source, needle) => source.split(needle).length - 1;
function patchAnchors(source, anchors, label) {
  assert.equal(typeof source, "string", `${label} must be text`);
  const applied = anchors.map(({ after }) => count(source, after));
  if (applied.every((value) => value === 1)) return source;
  assert(applied.every((value) => value === 0), `${label} progress patch is partial or ambiguous`);
  let patched = source;
  for (const { before, after, label: anchorLabel } of anchors) {
    assert.equal(count(patched, before), 1, `${label} ${anchorLabel} anchor drifted`);
    patched = patched.replace(before, after);
  }
  return patched;
}

export function patchGptLiveConsultProgressHarness(source) {
  return patchAnchors(source, GPT_LIVE_CONSULT_PROGRESS_HARNESS_ANCHORS, "realtime harness");
}

export function patchGptLiveConsultProgressTalk(source) {
  return patchAnchors(source, GPT_LIVE_CONSULT_PROGRESS_TALK_ANCHORS, "Talk runner");
}
