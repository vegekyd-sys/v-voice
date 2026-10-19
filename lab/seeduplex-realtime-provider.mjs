import { randomUUID, createHash } from "node:crypto";

export const SEEDUPLEX_MODEL = "1.2.6.1";
export const SEEDUPLEX_UPSTREAM =
  "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
export const SEEDUPLEX_RESOURCE_ID = "volc.speech.dialog";
export const SEEDUPLEX_VOICES = Object.freeze({
  xiaohe: "zh_female_xiaohe_uranus_bigtts",
  companion: "zh_female_jiaochuannv_uranus_bigtts",
});

const INPUT_FRAME_BYTES = 640;
const MAX_PENDING_INPUT_BYTES = 16_000 * 2 * 10;
const MAX_TOOL_CALLS = 100;
const MAX_TOOL_RESULT_BYTES = 32_000;
const MAX_CONSULT_RESULT_CHARS = 8_000;
const MAX_UPSTREAM_MESSAGE_BYTES = 1_048_576;

// Provider messages can contain prompts or credentials. Persist only a code and
// a fixed classification, never an arbitrary upstream message.
export function classifySeeduplexError(event = {}) {
  const detail = event.error ?? event;
  const code = String(detail.code ?? event.code ?? "");
  const upstreamCode = /^\d{3,8}$/.test(code) ? code : undefined;
  const message = typeof detail.message === "string" ? detail.message : "";
  const clientError = /InvalidSpeaker|ExceededConcurrentDurationLimit|invalid.parameter|api.key|unauthoriz/i.test(message);
  const inputTimeout = /NoAudioInputTooLong|stream recv timeout|Abnormal silence audio/i.test(message);
  const recoverable = !clientError && (inputTimeout || /^5\d{2}(?:\d{5})?$/.test(code));
  return { upstreamCode, category: clientError ? "configuration" : inputTimeout ? "input-timeout" : recoverable ? "upstream-transient" : "upstream-rejected", recoverable };
}
// The runtime asks the voice agent for "at most one short natural backchannel
// ... vary it". A single constant defeated that: every delegated turn spoke the
// identical sentence, which is what made the assistant sound canned. Rotate
// instead, so consecutive consults never repeat.
export const SEEDUPLEX_WORKING_SPEECH_VARIANTS = Object.freeze([
  "好，我看一下。",
  "稍等，我查查。",
  "嗯，我来看看。",
  "我找一下啊。",
  "让我确认一下。",
]);
let seeduplexWorkingSpeechCursor = Math.floor(Math.random() * SEEDUPLEX_WORKING_SPEECH_VARIANTS.length);

export function nextSeeduplexWorkingSpeech() {
  const value = SEEDUPLEX_WORKING_SPEECH_VARIANTS[seeduplexWorkingSpeechCursor];
  seeduplexWorkingSpeechCursor =
    (seeduplexWorkingSpeechCursor + 1) % SEEDUPLEX_WORKING_SPEECH_VARIANTS.length;
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveSeeduplexApiKey(providerConfig = {}, env = process.env) {
  return (
    optionalString(providerConfig.apiKey) ??
    optionalString(env.VOLCENGINE_REALTIME_API_KEY) ??
    optionalString(env.DOUBAO_SPEECH_API_KEY) ??
    optionalString(env.VOLCENGINE_TTS_API_KEY)
  );
}

export function resolveSeeduplexVoice(value) {
  const normalized = optionalString(value)?.toLowerCase() ?? "xiaohe";
  const speaker = SEEDUPLEX_VOICES[normalized];
  if (!speaker) {
    throw new Error(`Unsupported Seeduplex voice: ${normalized}`);
  }
  return { id: normalized, speaker };
}

export function buildSeeduplexSession(providerConfig, request) {
  const model = optionalString(providerConfig.model) ?? SEEDUPLEX_MODEL;
  if (model !== SEEDUPLEX_MODEL) {
    throw new Error(`Unsupported Seeduplex model: ${model}`);
  }
  const voice = resolveSeeduplexVoice(providerConfig.voice);
  const language = optionalString(request.language)?.toLowerCase();
  const instructions = [
    optionalString(request.instructions),
    "语言规则：根据用户最近一句话的语言作答。用户说中文时，所有回复都必须使用中文，包括调用工具前的确认、等待提示和最终回答；不要在中文请求后默认使用英文开场白，不要说 Let me check、Sure 或 I will。用户使用其他语言时再跟随该语言。",
    language?.startsWith("zh")
      ? "重要语言规则：本次通话指定中文。整个会话只能使用中文，包括调用工具之前的简短确认、等待提示和最终回答。禁止使用英文开场白；不要说 Let me check、Sure 或 I will。"
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
  const tools = (request.tools ?? []).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return {
    type: "session.create",
    session: {
      model,
      instructions,
      audio: {
        input: { format: { type: "pcm", rate: 16_000 } },
        output: {
          format: { type: "pcm", rate: 24_000 },
          voice: voice.speaker,
          speed: 0,
          loudness: 0,
        },
      },
      tools,
    },
  };
}

/** Downsample signed PCM16LE from 24 kHz to 16 kHz while preserving chunk state. */
export class Pcm24To16Resampler {
  #pending = [];

  push(audio) {
    if (!Buffer.isBuffer(audio) || audio.length % 2 !== 0) {
      throw new Error("Seeduplex input must be PCM16LE");
    }
    for (let offset = 0; offset < audio.length; offset += 2) {
      this.#pending.push(audio.readInt16LE(offset));
    }
    const groups = Math.floor(this.#pending.length / 3);
    const output = Buffer.allocUnsafe(groups * 4);
    for (let group = 0; group < groups; group += 1) {
      const base = group * 3;
      output.writeInt16LE(this.#pending[base], group * 4);
      output.writeInt16LE(
        Math.round((this.#pending[base + 1] + this.#pending[base + 2]) / 2),
        group * 4 + 2,
      );
    }
    if (groups) this.#pending.splice(0, groups * 3);
    return output;
  }
}

/** A 16 kHz hardware source already matches the upstream input rate. */
class Pcm16Passthrough {
  push(audio) {
    if (!Buffer.isBuffer(audio) || audio.length % 2 !== 0) {
      throw new Error("Seeduplex input must be PCM16LE");
    }
    return audio;
  }
}

function inputResampler(request) {
  return request.inputSampleRate === 16_000 ? new Pcm16Passthrough() : new Pcm24To16Resampler();
}

/** The pinned service labels output as PCM but sends float32 little-endian. */
export function decodeSeeduplexFloat32Pcm(encoded) {
  if (typeof encoded !== "string") throw new Error("Invalid Seeduplex audio frame");
  const input = Buffer.from(encoded, "base64");
  if (!input.length || input.length % 4 !== 0 || input.length > 480_000) {
    throw new Error("Invalid Seeduplex audio frame");
  }
  const output = Buffer.allocUnsafe(input.length / 2);
  for (let offset = 0; offset < input.length; offset += 4) {
    const sample = input.readFloatLE(offset);
    if (!Number.isFinite(sample)) throw new Error("Invalid Seeduplex audio sample");
    const bounded = Math.max(-1, Math.min(1, sample));
    output.writeInt16LE(
      bounded < 0 ? Math.round(bounded * 32768) : Math.round(bounded * 32767),
      offset / 2,
    );
  }
  return output;
}

async function createDefaultWebSocket(url, options) {
  // production-worker is a sibling of the pinned OpenClaw runtime. Keeping the
  // dependency inside that runtime avoids a second, independently drifting ws.
  const { WebSocket } = await import("ws");
  return new WebSocket(url, options);
}

function serializeToolResult(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_TOOL_RESULT_BYTES) {
    throw new Error("Seeduplex tool result is too large");
  }
  return text;
}

export function buildSeeduplexAgentConsultPrompt(args = {}) {
  const question =
    optionalString(args.question) ??
    optionalString(args.prompt) ??
    optionalString(args.query) ??
    optionalString(args.task) ??
    optionalString(args.request);
  if (!question) throw new Error("Seeduplex agent consult requires a question");
  const context = optionalString(args.context);
  const responseStyle = optionalString(args.responseStyle);
  const confirmationId = optionalString(args.confirmationId);
  return [
    "Live voice request during a Gateway-relay Talk session.",
    "Act as the configured OpenClaw agent for this user. Use available tools when the request asks you to do work.",
    "Return only the concise terminal result that the realtime voice agent should speak. Preserve failures, limits, numbers, and pending approvals.",
    "Answer in the same language as the user's request. If the user speaks Chinese, the terminal result must be Chinese.",
    responseStyle ? `Spoken style: ${responseStyle}` : undefined,
    context ? `Additional realtime context:\n${context}` : undefined,
    confirmationId ? `Server-issued voice confirmation id: ${confirmationId}` : undefined,
    `User request:\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildAgentConsultProviderResult(result) {
  const text = optionalString(result?.text);
  if (!text) {
    return {
      error: "The OpenClaw agent consult ended without a confirmed result. Do not claim success.",
    };
  }
  return { result: text.slice(0, MAX_CONSULT_RESULT_CHARS) };
}

function spokenToolResult(result) {
  if (typeof result === "string") return optionalString(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  return (
    optionalString(result.result) ??
    optionalString(result.text) ??
    (optionalString(result.error)
      ? `OpenClaw Agent 没有完成：${optionalString(result.error)}`
      : undefined)
  );
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

export function stripEnglishLeadIn(text, request) {
  if (!hasChinese(request)) return text;
  const paragraphs = text.split(/\n\s*\n/gu).map((value) => value.trim()).filter(Boolean);
  const chineseParagraphs = paragraphs.filter((paragraph) => {
    const chineseCharacters = paragraph.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
    const latinWords = paragraph.match(/[A-Za-z]{2,}/gu)?.length ?? 0;
    return chineseCharacters >= 2 && latinWords <= Math.max(4, chineseCharacters / 3);
  });
  const candidate = chineseParagraphs.length > 0 ? chineseParagraphs.join("\n\n") : text;
  const firstChinese = candidate.search(/[\u3400-\u9fff]/u);
  if (firstChinese < 0) {
    return "处理已完成，但没有返回可播报的中文结果，请再试一次。";
  }
  if (firstChinese === 0) return candidate.trim();
  const prefix = candidate.slice(0, firstChinese);
  if (!/[A-Za-z]/u.test(prefix)) return candidate.trim();
  return candidate.slice(firstChinese).replace(/^[\s:：*#-]+/u, "").trim();
}

export class SeeduplexRealtimeVoiceBridge {
  constructor(request, options = {}) {
    this.request = request;
    this.options = options;
    this.socket = null;
    this.connected = false;
    this.ready = false;
    this.terminal = false;
    this.closeNotified = false;
    this.resampler = inputResampler(this.request);
    this.pendingInput = Buffer.alloc(0);
    this.toolBatches = [];
    this.seenToolCalls = new Map();
    this.seenEvents = new Map();
    this.pendingToolCalls = new Map();
    this.backgroundTools = new Map();
    this.toolNoticeUsed = false;
    this.completedResponses = new Set();
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectTimer = null;
    this.abortController = new AbortController();
    this.agentConsultTail = Promise.resolve();
    this.skipNextResponseDone = false;
    this.cancelledOutputPending = false;
    this.outputClosed = false;
    this.bargeInPending = false;
    this.pendingWorkingSpeech = undefined;
    this.responseActive = false;
    this.injectedSpeech = false;
    this.greetingRequested = false;
    this.pendingGreeting = null;
    this.retiredResponses = new Set();
    this.audioResponseId = null;
    this.responseOwnerAnnounced = false;
    this.responseOwnerId = undefined;
    this.supportsToolResultContinuation = true;
    this.supportsToolResultSuppression = false;
    this.sessionId = null;
    this.reconnecting = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = [];
    this.outbox = [];
    this.startedAt = Date.now();
    this.lastInputAt = Date.now();
    this.inputMuted = false;
    this.inputTimer = null;
    this.lastFrameAt = 0;
    this.pacingTimer = null;
    this.cancelEventId = null;
  }

  connect() {
    if (this.terminal) return Promise.reject(new Error("Seeduplex session is closed"));
    if (this.ready) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    void this.#open();
    return this.connectPromise;
  }

  async #open() {
    const apiKey = resolveSeeduplexApiKey(this.request.providerConfig, this.options.env);
    if (!apiKey) return this.#fail(new Error("Seeduplex API key missing"));
    try {
      const createWebSocket = this.options.createWebSocket ?? createDefaultWebSocket;
      const socket = await createWebSocket(
        this.options.upstream ?? SEEDUPLEX_UPSTREAM,
        {
          headers: {
            "X-Api-Key": apiKey,
            "X-Api-Resource-Id": SEEDUPLEX_RESOURCE_ID,
            "X-Api-Connect-Id": randomUUID(),
          },
          handshakeTimeout: 15_000,
          maxPayload: MAX_UPSTREAM_MESSAGE_BYTES,
          perMessageDeflate: false,
        },
      );
      if (this.terminal) {
        socket.close();
        return;
      }
      this.socket = socket;
      this.connectTimer = setTimeout(
        () => this.#recover({category:"setup-timeout",recoverable:true}),
        this.options.connectTimeoutMs ?? 20_000,
      );
      socket.on("open", () => {
        if (this.terminal || socket !== this.socket) return;
        this.connected = true;
        try {
          const event = buildSeeduplexSession(this.request.providerConfig, this.request);
          // The live endpoint requires session.create on a new connection;
          // supplying its previous id retains history (verified on the endpoint).
          if (this.sessionId) event.session.id = this.sessionId;
          this.#send(event);
        } catch (error) {
          this.#fail(error instanceof Error ? error : new Error("Invalid Seeduplex session"));
        }
      });
      socket.on("message", (data, binary) => { if (socket === this.socket) this.#onMessage(data, binary); });
      socket.on("unexpected-response", (_request, response) => {
        if (socket !== this.socket || this.terminal) return;
        response.resume?.();
        const status = Number(response.statusCode);
        if (status >= 500 && status <= 599) return this.#recover({category:"upstream-transient",upstreamCode:String(status),recoverable:true});
        this.#fail(
          new Error(
            status === 401 || status === 403
              ? "Seeduplex credential is not enabled for volc.speech.dialog"
              : status === 429
                ? "Seeduplex rate limit exceeded"
                : "Seeduplex upstream rejected the session",
          ),
        );
      });
      socket.on("error", () => { if (socket === this.socket) this.#recover({category:"network",recoverable:true}); });
      socket.on("close", () => {
        if (socket !== this.socket) return;
        if (!this.terminal) this.#recover({category:"network",recoverable:true});
        else this.#notifyClose("completed");
      });
    } catch {
      this.#recover({category:"network",recoverable:true});
    }
  }

  sendAudio(audio) {
    if (this.terminal) return;
    this.lastInputAt = Date.now();
    // Audio received while reconnecting belongs to an unavailable input stream.
    // Do not replay seconds of stale speech as a burst into the resumed session.
    if (this.reconnecting) return;
    const converted = this.resampler.push(audio);
    if (!converted.length) return;
    this.pendingInput = Buffer.concat([this.pendingInput, converted]);
    if (this.pendingInput.length > MAX_PENDING_INPUT_BYTES) {
      this.#fail(new Error("Seeduplex pending input audio overflow"));
      return;
    }
    this.#pumpInput();
  }

  // Candidate routing may reject a speculative turn before any output or tool
  // is released. Retire its input backlog and generation together.
  cancelPendingResponse() {
    this.pendingInput = Buffer.alloc(0);
    this.#cancelUpstreamResponse();
  }

  #pumpInput() {
    if (!this.ready || this.terminal || this.pendingInput.length < INPUT_FRAME_BYTES) return;
    const wait = 20 - (Date.now() - this.lastFrameAt);
    if (wait > 0) {
      this.pacingTimer ??= setTimeout(() => {this.pacingTimer = null;this.#pumpInput();}, wait);
      this.pacingTimer.unref?.();
      return;
    }
    if (this.inputMuted) {
      this.inputMuted = false;
      this.#send({type:"input_audio_unmute.commit"});
      this.#diagnostic({stage:"input-resumed"});
    }
    const frame = this.pendingInput.subarray(0, INPUT_FRAME_BYTES);
    this.pendingInput = this.pendingInput.subarray(INPUT_FRAME_BYTES);
    this.#send({ type: "input_audio_buffer.append", audio: frame.toString("base64") });
    const now = Date.now(), deadline = this.lastFrameAt + 20;
    // Compensate small timer jitter instead of accumulating one millisecond of
    // backlog per packet over hours. A large stall never emits a catch-up burst.
    this.lastFrameAt = Math.abs(now-deadline) <= 5 ? deadline : now;
    if (this.pendingInput.length >= INPUT_FRAME_BYTES) this.#pumpInput();
  }

  #watchInput() {
    if (!this.ready || this.terminal || this.inputMuted || Date.now() - this.lastInputAt < (this.options.inputIdleMs ?? 2_000)) return;
    this.inputMuted = true;
    this.#send({type:"input_audio_mute.commit"});
    this.#diagnostic({stage:"input-paused"});
  }

  #diagnostic(value) {
    this.request.onDiagnostic?.({...value,sessionAgeMs:Date.now()-this.startedAt});
  }

  #recover(reason) {
    if (this.terminal || this.reconnectTimer) return;
    this.#diagnostic({stage:"upstream-error",...reason});
    if (!reason.recoverable) return this.#fail(new Error("豆包语音连接未完成，请重新拨号。"));
    const now = Date.now();
    this.reconnectAttempts = this.reconnectAttempts.filter(at => now-at < 60_000);
    if (this.reconnectAttempts.length >= (this.options.maxReconnectAttempts ?? 3)) return this.#fail(new Error("语音连接暂时无法恢复，请重新拨号。"));
    this.reconnectAttempts.push(now);
    this.reconnecting = true;
    this.ready = false;
    this.connected = false;
    this.pendingInput = Buffer.alloc(0);
    this.resampler = inputResampler(this.request);
    clearTimeout(this.connectTimer);
    clearTimeout(this.pacingTimer);this.pacingTimer = null;
    const old = this.socket;this.socket = null;
    old?.terminate?.();if (!old?.terminate) old?.close();
    this.request.onClearAudio?.("reconnecting");
    this.responseActive = false;
    this.pendingGreeting = null;
    this.pendingSpeechCaption = null;
    this.#diagnostic({stage:"reconnecting",attempt:this.reconnectAttempts.length});
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.#open();
    }, this.options.reconnectDelayMs ?? Math.min(4_000, 250 * 2 ** (this.reconnectAttempts.length-1)));
    this.reconnectTimer.unref?.();
  }

  setMediaTimestamp(_timestamp) {}

  beginBackgroundTool(callId, question) {
    // Finish the native function immediately; the host owns the async job.
    // Keeping a native continuation open suppresses later conversational turns.
    this.backgroundTools.set(callId, question);
    this.submitToolResult(callId, {accepted:true,status:"working",message:"已交给 V 后台，我会继续做完。",instruction:"简短说明任务已开始，随后正常回应用户聊天。任务仍在后台继续，不要声称已完成。"}, {backgroundAck:true});
  }

  completeBackgroundTool(callId, result, options = {}) {
    const question = this.backgroundTools.get(callId);
    if (question === undefined) return;
    this.backgroundTools.delete(callId);
    if (result?.cancelled) return;
    const text = spokenToolResult(result);
    if (!text) return;
    // Documented paired history, containing the actual delegated request and
    // actual backend answer. This is context, not a new human utterance.
    this.#send({type:"conversation.item.create",event_id:`event_${randomUUID()}`,items:[
      {role:"user",content:[{type:"input_text",text:question}]},
      {role:"assistant",content:[{type:"input_text",text}]},
    ]});
    if (!options.displayedFullResult) this.request.onTranscript?.("assistant", text, true, "V-backend");
    this.speakProgress(options.spokenText ?? text, { caption: options.displayedFullResult === true });
  }

  speakProgress(text, { caption = false } = {}) {
    if (this.terminal || (!this.ready && !this.reconnecting)) return;
    this.pendingSpeechCaption = caption ? { text, started: false, responseId: null } : null;
    this.injectedSpeech = true;
    this.responseActive = true;
    this.outputClosed = false;
    this.responseOwnerAnnounced = false;
    this.#send({ type: "speech_text_buffer.commit", event_id: `event_${randomUUID()}`, text });
  }

  sendUserMessage(text) {
    const normalized = optionalString(text);
    if (!normalized || !this.ready) return;
    this.responseOwnerAnnounced = false;
    this.responseOwnerId = undefined;
    this.outputClosed = false;
    this.#send({
      type: "conversation.item.create",
      items: [{ role: "user", content: [{ type: "input_text", text: normalized }] }],
    });
  }

  triggerGreeting(instructions) {
    if (!this.ready || this.terminal || this.greetingRequested) return;
    // Seeduplex conversation.item.create injects paired history; it does not
    // trigger an assistant turn. SayHello is the documented speech event.
    const text = this.request.greetingText ?? "天意，你好，我是 V，在呢。";
    this.greetingRequested = true;
    this.pendingGreeting = { text, started: false, responseId: null };
    this.#send({type: "speech_text_buffer.commit", event_id: `event_${randomUUID()}`,
      text});
  }

  handleBargeIn({ confirmed = false } = {}) {
    if (!this.ready) return;
    // Flushing local playback is the whole barge-in, matching the GPT Live One
    // bridge. A barge-in signal is only ever a guess by input VAD, and during a
    // 30-second Agent consult the provider raises that guess on silence. Making
    // it cheap means a wrong guess costs one flushed buffer instead of the turn:
    // the upstream generation keeps streaming and Gateway output ownership is
    // untouched. The upstream response is cancelled only once the user is
    // confirmed to have actually said something, in #cancelUpstreamResponse.
    this.request.onClearAudio?.("barge-in");
    this.pendingGreeting = null;
    this.bargeInPending = true;
    // Host-injected backend speech may postpone native ASR until its TTS ends.
    // A client speech onset must retire that playback, not wait for ASREnded.
    // A confirmed barge-in (a speaker whose own echo cancellation heard someone
    // talk over V) is already the evidence: while a long answer is still being
    // generated Seeduplex sends no transcription, so waiting would let it resume.
    // Once generation has finished, leave it to Seeduplex: a cancel then left
    // its ASR starting turns that never completed (device test 2026-10-18).
    if (this.injectedSpeech || (confirmed && this.responseActive)) this.#cancelUpstreamResponse(true);
  }

  /**
   * Tear down the upstream generation. Reserved for a confirmed user utterance,
   * a sustained client speech onset during host-injected TTS may cancel immediately.
   */
  #cancelUpstreamResponse(force = false) {
    this.bargeInPending = false;
    this.pendingSpeechCaption = null;
    if (!this.ready || this.cancelledOutputPending || (!this.responseActive && !force)) return;
    this.cancelledOutputPending = true;
    const retiredId = this.audioResponseId ?? this.responseOwnerId;
    if (retiredId) this.retiredResponses.add(retiredId);
    if (this.retiredResponses.size > 256) this.retiredResponses.delete(this.retiredResponses.values().next().value);
    this.responseActive = false;
    this.cancelEventId = `event_${randomUUID()}`;
    this.#send({ type: "response.cancel", event_id: this.cancelEventId });
    this.request.onEvent?.({ direction: "client", type: "client.response.cancel" });
  }

  submitToolResult(callId, result, options = {}) {
    if (options.suppressResponse) {
      throw new Error("Seeduplex does not support suppressed tool results");
    }
    const batch = this.pendingToolCalls.get(callId);
    if (!batch) {
      const continuing = this.toolBatches.find(
        (candidate) => candidate.continuing && candidate.ids.includes(callId),
      );
      if (continuing) {
        if (options.willContinue || continuing.finalResults.has(callId)) return;
        const text = spokenToolResult(result);
        continuing.finalResults.set(
          callId,
          text ?? "OpenClaw Agent 没有返回可以播报的结果。",
        );
        this.#dispatchContinuedResult(continuing);
        return;
      }
      if (this.seenToolCalls.has(callId)) return;
      throw new Error(`Unknown Seeduplex tool call: ${callId}`);
    }
    if (batch.results.has(callId)) return;
    batch.results.set(callId, {
      call_id: callId,
      role: "tool",
      content: [{ type: "input_text", text: serializeToolResult(result) }],
    });
    batch.continuing = options.willContinue === true;
    this.#flushToolBatch(batch);
  }

  #flushToolBatch(batch) {
    if (batch.results.size !== batch.ids.length) return;
    this.#send({
      type: "conversation.item.create",
      event_id: `event_${randomUUID()}`,
      items: batch.ids.map((id) => batch.results.get(id)),
    });
    for (const id of batch.ids) this.pendingToolCalls.delete(id);
    if (batch.continuing) {
      batch.finalResults = new Map();
      batch.phase = "waiting-working-audio";
    } else {
      this.toolBatches.splice(this.toolBatches.indexOf(batch), 1);
    }
  }

  #dispatchContinuedResult(batch) {
    if (
      batch.phase !== "waiting-finals" ||
      batch.finalResults.size !== batch.ids.length
    ) {
      return;
    }
    const text = batch.ids
      .map((id) => batch.finalResults.get(id))
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_CONSULT_RESULT_CHARS);
    batch.phase = "waiting-final-audio";
    batch.spokenText = text;
    this.request.onTranscript?.("assistant", text, true);
    this.#send({
      type: "speech_text_buffer.commit",
      event_id: `event_${randomUUID()}`,
      text,
    });
  }

  acknowledgeMark(_markName) {}

  close() {
    if (this.terminal) return;
    this.terminal = true;
    this.ready = false;
    this.abortController.abort(new Error("Seeduplex session closed"));
    clearTimeout(this.connectTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.pacingTimer);
    clearInterval(this.inputTimer);
    this.outbox.length = 0;
    if (this.socket?.readyState === 1) {
      this.#send({ type: "session.close" });
      setTimeout(() => this.socket?.close(), 1_000).unref?.();
    } else {
      this.socket?.close();
      this.#notifyClose("completed");
    }
    this.connectResolve?.();
  }

  isConnected() {
    return this.connected && this.ready && !this.terminal;
  }

  #send(event) {
    if (!event.event_id) event = {...event,event_id:`event_${randomUUID()}`};
    if (!this.ready && (this.reconnecting || this.sessionId) && !["session.create","session.close"].includes(event.type)) {
      if (event.type === "input_audio_buffer.append") return;
      if (this.outbox.length >= 128) return this.#fail(new Error("语音恢复中的待处理内容过多，请重新拨号。"));
      this.outbox.push(event);return;
    }
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(event));
  }

  #onMessage(data, binary) {
    if (this.terminal) return;
    if (binary) return this.#fail(new Error("Invalid Seeduplex upstream event"));
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return this.#fail(new Error("Invalid Seeduplex upstream event"));
    }
    if (typeof event.event_id === 'string' && event.event_id) {
      const signature = createHash('sha256').update(JSON.stringify(event)).digest('hex');
      const previous = this.seenEvents.get(event.event_id);
      if (previous) { if (previous !== signature) this.#fail(new Error('Seeduplex event identity conflict')); return; }
      this.seenEvents.set(event.event_id, signature);
      if (this.seenEvents.size > 2048) this.seenEvents.delete(this.seenEvents.keys().next().value);
    }
    this.request.onProtocolEvent?.(event);
    const type = event?.type;
    const responseId = optionalString(event.response_id) ?? optionalString(event.response?.id);
    if (responseId && this.retiredResponses.has(responseId) && type?.startsWith("response.")) return;
    // This service emits TTSSentenceStart, without response.created. Use its
    // actual response ID as the boundary; an old tail cannot reopen playback.
    if (type === "response.output_audio.started") {
      this.cancelledOutputPending = false;
      this.outputClosed = false;
      this.responseActive = true;
      this.audioResponseId = responseId;
      const caption = this.pendingSpeechCaption;
      if (caption) {
        if (event.tts_type === "chat_tts_text" && !caption.started) {
          caption.started = true; caption.responseId = responseId;
        } else if (event.tts_type === "default" || responseId !== caption.responseId) {
          this.pendingSpeechCaption = null;
        }
      }
      if (this.pendingGreeting) {
        if (event.tts_type === "chat_tts_text" && !this.pendingGreeting.started) {
          this.pendingGreeting.started = true;
          this.pendingGreeting.responseId = responseId;
        } else if (event.tts_type === "default" || responseId !== this.pendingGreeting.responseId) {
          this.pendingGreeting = null;
        }
      }
      if (event.tts_type === "default") this.injectedSpeech = false;
    }

    if (type === "error" && this.cancelledOutputPending &&
      (event.error?.event_id === this.cancelEventId || event.event_id === this.cancelEventId)) {
      // response.cancel is documented to return an error when its target ended
      // in the race between local playback and the upstream command. A refused
      // cancel never ends the session; record that it happened, not its text.
      this.request.onEvent?.({ direction: "server", type: "client.response.cancel.rejected" });
      return;
    }
    if (type === "error") return this.#recover(classifySeeduplexError(event));
    if (type === "session.created") {
      const resumed = Boolean(this.sessionId);
      if (resumed && event.session?.id !== this.sessionId) return this.#fail(new Error("语音上下文未能恢复，请重新拨号。"));
      this.sessionId = optionalString(event.session?.id) ?? this.sessionId;
      this.ready = true;
      this.reconnecting = false;
      this.inputMuted = false;
      this.lastInputAt = Date.now();
      this.cancelledOutputPending = false;
      this.outputClosed = false;
      this.seenEvents.clear();
      clearTimeout(this.connectTimer);
      this.connectResolve?.();
      if (resumed) this.#diagnostic({stage:"recovered"});
      else this.request.onReady?.();
      this.inputTimer ??= setInterval(() => this.#watchInput(), 250);
      this.inputTimer.unref?.();
      for (const queued of this.outbox.splice(0)) this.#send(queued);
      this.#pumpInput();
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.started" ||
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      // Any user transcription means a new turn is underway, so output must
      // reopen even when the provider never announces a Gateway-visible
      // response.created for it. Without this the Gateway loses its turn-bound
      // fallback claim and the next reply is dropped silently. Unlike the
      // owner-announcement reset below, reopening output has no ordering
      // hazard: outputClosed is only ever set once a turn has completed.
      this.outputClosed = false;
    }
    if (type === "conversation.item.input_audio_transcription.started") {
      if (this.injectedSpeech && this.responseActive) this.#cancelUpstreamResponse(true);
      this.responseOwnerAnnounced = false;
      this.responseOwnerId = undefined;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      // A completed transcription carrying real text is the only evidence that
      // the user actually spoke. Only then does a pending barge-in earn the
      // right to tear the upstream generation down. This runs after the reset
      // above so the fresh suppression is not immediately cleared.
      const spoken = optionalString(event.transcript) ?? optionalString(event.text);
      // A finished utterance after an earlier cancel opens the next turn, whose
      // reply text arrives before its first audio. Retired response ids still
      // filter the cancelled tail.
      if (spoken && this.cancelledOutputPending) this.cancelledOutputPending = false;
      if (spoken && this.bargeInPending) this.#cancelUpstreamResponse();
      this.bargeInPending = false;
    }
    const continuingBatch = this.toolBatches.find((batch) => batch.continuing);
    const internalContinuationResponse =
      type === "response.created" &&
      (Boolean(continuingBatch) || this.responseOwnerAnnounced);
    if (type === "response.created") {
      // The cancellation suppression exists to swallow the tail of the
      // generation that was cancelled. A new response.created IS the next
      // generation, so it ends the suppression. Clearing on the user
      // transcription instead armed the suppression over the very turn that
      // transcription started, which silenced that turn's whole reply.
      this.cancelledOutputPending = false;
    }
    if (type === "response.created") {
      this.responseActive = true;
      if (!internalContinuationResponse) {
        this.responseOwnerAnnounced = true;
        this.responseOwnerId = optionalString(event.response_id);
        this.outputClosed = false;
      }
    }
    if (
      this.outputClosed &&
      (type === "response.canceled" ||
        type === "response.done" ||
        type.startsWith("response.output_"))
    ) {
      // The continued consult already completed this Gateway output generation.
      // Seeduplex keeps trailing frames on its own internal response after the
      // final speech_text_buffer commit; forwarding them reaches a Gateway that
      // has no live response owner. The next Gateway-visible response.created
      // reopens output.
      return;
    }
    if (
      this.cancelledOutputPending &&
      (type === "response.canceled" ||
        type === "response.done" ||
        type.startsWith("response.output_"))
    ) {
      // Ignore frames from the provider generation that the browser already
      // cancelled. A subsequent response.created opens the next generation.
      return;
    }
    if (type === "session.closed") {
      this.terminal = true;
      this.ready = false;
      clearInterval(this.inputTimer);clearTimeout(this.pacingTimer);
      this.socket?.close();
      this.#notifyClose("completed");
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.started" ||
      type === "response.canceled"
    ) {
      this.request.onClearAudio?.("barge-in");
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = optionalString(event.transcript) ?? optionalString(event.text);
      if (text) {
        this.toolNoticeUsed = false;
        this.request.onTranscript?.("user", text, true);
      }
    }
    const workingBatch = continuingBatch;
    const suppressWorkingTranscript =
      workingBatch?.phase === "waiting-working-audio" ||
      workingBatch?.phase === "waiting-working-tts";
    if (
      type === "response.output_text.delta" &&
      typeof event.delta === "string" &&
      !suppressWorkingTranscript
    ) {
      this.request.onTranscript?.("assistant", event.delta, false);
    }
    if (
      type === "response.output_text.done" &&
      typeof event.text === "string" &&
      !suppressWorkingTranscript
    ) {
      this.request.onTranscript?.("assistant", event.text, true);
    }
    if (
      type === "response.output_audio.delta" &&
      typeof event.delta === "string" &&
      workingBatch?.phase !== "waiting-working-audio"
    ) {
      try {
        const audio = decodeSeeduplexFloat32Pcm(event.delta);
        const caption = this.pendingSpeechCaption;
        if (audio.length && caption?.started &&
          (!responseId || responseId === caption.responseId) &&
          (this.audioResponseId ?? responseId ?? null) === caption.responseId) {
          this.pendingSpeechCaption = null;
          this.request.onTranscript?.("assistant", caption.text, true, "V-backend-summary");
        }
        const greeting = this.pendingGreeting;
        if (audio.length && greeting?.started &&
          (!responseId || responseId === greeting.responseId) &&
          (this.audioResponseId ?? responseId ?? null) === greeting.responseId) {
          // SayHello returns PCM but no output_text events. Publish the exact
          // submitted speech only when its first valid audio frame arrives.
          this.pendingGreeting = null;
          this.request.onTranscript?.("assistant", greeting.text, true, "greeting");
        }
        this.request.onAudio(audio, { ...(this.injectedSpeech ? {source:"injected-speech"} : {}), responseId: this.audioResponseId ?? responseId });
        this.request.onMark?.(`seeduplex-audio-${randomUUID()}`);
      } catch {
        return this.#fail(new Error("Invalid Seeduplex audio output"));
      }
    }
    if (type === "response.output_audio.done") {
      this.pendingGreeting = null;
      this.pendingSpeechCaption = null;
      this.request.onAudioSegmentDone?.();
      const continuing = this.toolBatches.find(
        (batch) =>
          batch.continuing &&
          (batch.phase === "waiting-working-audio" ||
            batch.phase === "waiting-working-tts" ||
            batch.phase === "waiting-final-audio"),
      );
      if (continuing?.phase === "waiting-working-audio") {
        continuing.phase = "waiting-working-tts";
        const spoken = this.pendingWorkingSpeech ?? nextSeeduplexWorkingSpeech();
        this.request.onTranscript?.("assistant", spoken, true);
        this.#send({
          type: "speech_text_buffer.commit",
          event_id: `event_${randomUUID()}`,
          text: spoken,
        });
      } else if (continuing?.phase === "waiting-working-tts") {
        continuing.phase = "waiting-finals";
        this.#dispatchContinuedResult(continuing);
      } else if (continuing?.phase === "waiting-final-audio") {
        continuing.phase = "completed";
        this.toolBatches.splice(this.toolBatches.indexOf(continuing), 1);
        this.skipNextResponseDone = true;
        // A continued consult is one Gateway output generation even though
        // Seeduplex creates separate upstream responses for the working and
        // final speech_text_buffer commits. Complete the exact response id that
        // established Gateway ownership, not the last internal upstream id.
        this.#onResponseDone({
          status: "completed",
          responseId: this.responseOwnerId ?? event.response_id,
        });
        this.outputClosed = true;
      } else {
        this.#onResponseDone({ status: "completed", responseId: event.response_id });
      }
      this.responseActive = false;
    } else if (type === "response.done") {
      if (this.skipNextResponseDone) {
        this.skipNextResponseDone = false;
      } else {
        const hasOpenContinuation = this.toolBatches.some(
          (batch) => batch.continuing && batch.phase !== "completed",
        );
        if (!hasOpenContinuation) {
          this.#onResponseDone({
            status: "completed",
            responseId: event.response_id ?? optionalString(event.response?.id),
          });
        }
      }
      this.responseActive = false;
    } else if (type === "response.canceled") {
      this.responseActive = false;
      this.#onResponseDone({
        status: "cancelled",
        responseId: event.response_id,
        reason: "barge-in",
      });
    }
    if (type === "response.function_call_arguments.done") this.#onToolCalls(event.items);
    // Completion is emitted only through the typed onResponseDone callback.
    // Forwarding the same raw events activates OpenClaw's legacy completion
    // fallback and would end a continued Agent turn after the working audio.
    if (
      type !== "response.done" &&
      type !== "response.output_audio.done" &&
      !internalContinuationResponse
    ) {
      this.request.onEvent?.({
        direction: "server",
        type: typeof type === "string" ? type : "unknown",
        responseId: optionalString(event.response_id),
      });
    }
  }

  #onToolCalls(items) {
    if (!Array.isArray(items) || !items.length) return;
    const allowed = new Set((this.request.tools ?? []).map((tool) => tool.name));
    const calls = [];
    for (const item of items) {
      const callId = optionalString(item?.call_id);
      const name = optionalString(item?.name);
      if (!callId || !name || !allowed.has(name)) {
        return this.#fail(new Error("Invalid Seeduplex tool call"));
      }
      let args;
      try {
        args = JSON.parse(item.arguments);
      } catch {
        return this.#fail(new Error("Invalid Seeduplex tool call"));
      }
      const signature = JSON.stringify([name,args]);
      if (this.seenToolCalls.has(callId)) {
        if (this.seenToolCalls.get(callId) !== signature) return this.#fail(new Error("Seeduplex tool identity conflict"));
        continue; // Resumption can redeliver a known call; never execute it twice.
      }
      if (calls.some(call => call.callId === callId)) return this.#fail(new Error("Invalid Seeduplex tool call"));
      calls.push({ callId, name, args });
    }
    if (!calls.length) return;
    if (this.pendingToolCalls.size + this.backgroundTools.size + calls.length > MAX_TOOL_CALLS) {
      return this.#fail(new Error("Seeduplex tool-call session limit exceeded"));
    }
    const batch = {
      ids: calls.map((call) => call.callId),
      results: new Map(),
      continuing: false,
      finalResults: new Map(),
      phase: "collecting",
    };
    this.toolBatches.push(batch);
    // Host-owned cached PCM explains the selected function without injecting
    // another upstream response or delaying its native function result.
    const notice = !this.toolNoticeUsed && this.request.toolStartNotice?.(calls[0]);
    if (notice) {
      this.toolNoticeUsed = true;
      this.request.onToolStartNotice?.(notice, calls[0]);
    }
    for (const call of calls) {
      this.seenToolCalls.set(call.callId, JSON.stringify([call.name,call.args]));
      this.pendingToolCalls.set(call.callId, batch);
      if (
        call.name === "openclaw_agent_consult" &&
        typeof this.request.runAgentConsult === "function"
      ) {
        // Gateway-relay sessions provide runAgentConsult and therefore own the
        // entire delegation. Publishing the same call through onToolCall makes
        // the browser start a second Agent run against the same session.
        const workingSpeech = nextSeeduplexWorkingSpeech();
        this.pendingWorkingSpeech = workingSpeech;
        this.submitToolResult(
          call.callId,
          {
            status: "working",
            language: "zh-CN",
            message: workingSpeech,
            instruction: "只使用中文播报 message 字段，不要说任何英文。",
          },
          { willContinue: true },
        );
        this.agentConsultTail = this.agentConsultTail.then(() =>
          this.#runAgentConsult(call),
        );
      } else {
        this.request.onToolCall?.({
          itemId: call.callId,
          callId: call.callId,
          name: call.name,
          args: call.args,
        });
      }
    }
    // Bound dedup memory without imposing a lifetime limit on healthy calls.
    for (const id of this.seenToolCalls.keys()) {
      if (this.seenToolCalls.size <= 2048) break;
      if (!this.pendingToolCalls.has(id) && !this.backgroundTools.has(id)) this.seenToolCalls.delete(id);
    }
  }

  async #runAgentConsult(call) {
    try {
      const result = await this.request.runAgentConsult({
        prompt: buildSeeduplexAgentConsultPrompt(call.args),
        signal: this.abortController.signal,
      });
      if (this.terminal || this.abortController.signal.aborted) return;
      const normalizedResult = buildAgentConsultProviderResult(result);
      if (typeof normalizedResult.result === "string") {
        normalizedResult.result = stripEnglishLeadIn(
          normalizedResult.result,
          JSON.stringify(call.args ?? {}),
        );
      }
      this.submitToolResult(call.callId, normalizedResult);
    } catch {
      if (this.terminal || this.abortController.signal.aborted) return;
      this.submitToolResult(call.callId, {
        error: "The OpenClaw agent consult failed. Tell the user it did not complete.",
      });
    }
  }

  #onResponseDone(outcome) {
    const key = optionalString(outcome.responseId) ?? "active-response";
    if (this.completedResponses.has(key)) return;
    if (this.completedResponses.size >= MAX_TOOL_CALLS) {
      this.completedResponses.delete(this.completedResponses.values().next().value);
    }
    this.completedResponses.add(key);
    this.request.onResponseDone?.(outcome);
  }

  #fail(error) {
    if (this.terminal) return;
    this.terminal = true;
    this.ready = false;
    this.abortController.abort(error);
    clearTimeout(this.connectTimer);
    clearTimeout(this.reconnectTimer);clearTimeout(this.pacingTimer);clearInterval(this.inputTimer);
    this.outbox.length = 0;
    this.connectReject?.(error);
    try {
      this.request.onError?.(error);
    } finally {
      this.#notifyClose("error");
      this.socket?.close();
    }
  }

  #notifyClose(reason) {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.request.onClose?.(reason);
  }
}

export function buildSeeduplexRealtimeVoiceProvider(options = {}) {
  return {
    id: "seeduplex",
    label: "Volcengine Seeduplex 3.0",
    aliases: ["volcengine", "doubao"],
    defaultModel: SEEDUPLEX_MODEL,
    models: [SEEDUPLEX_MODEL],
    voices: Object.keys(SEEDUPLEX_VOICES),
    autoSelectOrder: 30,
    capabilities: {
      transports: ["gateway-relay"],
      inputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24_000, channels: 1 }],
      outputAudioFormats: [{ encoding: "pcm16", sampleRateHz: 24_000, channels: 1 }],
      supportsBrowserSession: false,
      supportsBargeIn: true,
      handlesInputAudioBargeIn: true,
      supportsToolCalls: true,
      supportsVideoFrames: false,
      supportsSessionResumption: false,
    },
    resolveConfig: ({ rawConfig }) => ({
      ...rawConfig,
      model: optionalString(rawConfig.model) ?? SEEDUPLEX_MODEL,
      voice: optionalString(rawConfig.voice) ?? "xiaohe",
    }),
    isConfigured: ({ providerConfig }) =>
      Boolean(resolveSeeduplexApiKey(providerConfig, options.env)),
    createBridge: (request) => new SeeduplexRealtimeVoiceBridge(request, options),
  };
}
