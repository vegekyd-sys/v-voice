import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  Pcm24To16Resampler,
  nativeListeningAside,
  SeeduplexRealtimeVoiceBridge,
  SEEDUPLEX_MODEL,
  SEEDUPLEX_RESOURCE_ID,
  SEEDUPLEX_VOICES,
  buildSeeduplexAgentConsultPrompt,
  buildSeeduplexRealtimeVoiceProvider,
  buildSeeduplexSession,
  SEEDUPLEX_WORKING_SPEECH_VARIANTS,
  decodeSeeduplexFloat32Pcm,
  resolveSeeduplexApiKey,
  resolveSeeduplexVoice,
  stripEnglishLeadIn,
} from "./seeduplex-realtime-provider.mjs";

class FakeSocket extends EventEmitter {
  readyState = 0;
  sent = [];
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  message(value) {
    this.emit("message", Buffer.from(JSON.stringify(value)), false);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }
}

function audio24k(samples) {
  const value = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => value.writeInt16LE(sample, index * 2));
  return value;
}

function floatAudio(samples) {
  const value = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => value.writeFloatLE(sample, index * 4));
  return value.toString("base64");
}

test("provider exposes one model and the two named voice profiles", () => {
  const provider = buildSeeduplexRealtimeVoiceProvider({
    env: { VOLCENGINE_REALTIME_API_KEY: "configured" },
  });
  assert.equal(provider.id, "seeduplex");
  assert.deepEqual(provider.models, [SEEDUPLEX_MODEL]);
  assert.deepEqual(provider.voices, ["xiaohe", "companion"]);
  assert.deepEqual(provider.capabilities.transports, ["gateway-relay"]);
  assert.equal(provider.capabilities.supportsToolCalls, true);
  assert.equal(provider.isConfigured({ providerConfig: {} }), true);
  assert.equal(
    buildSeeduplexRealtimeVoiceProvider({ env: {} }).isConfigured({ providerConfig: {} }),
    false,
  );
});

test("credential resolution is explicit and voice aliases map to pinned speakers", () => {
  assert.equal(resolveSeeduplexApiKey({ apiKey: " direct " }, {}), "direct");
  assert.equal(
    resolveSeeduplexApiKey({}, { DOUBAO_SPEECH_API_KEY: " fallback " }),
    "fallback",
  );
  assert.deepEqual(resolveSeeduplexVoice("companion"), {
    id: "companion",
    speaker: SEEDUPLEX_VOICES.companion,
  });
  assert.throws(() => resolveSeeduplexVoice("unknown"), /Unsupported/);
});

test("session request preserves Talk instructions and native tools", () => {
  const session = buildSeeduplexSession(
    { model: SEEDUPLEX_MODEL, voice: "companion" },
    {
      instructions: "Use the full V agent when needed.",
      language: "zh",
      tools: [
        {
          type: "function",
          name: "openclaw_agent_consult",
          description: "Delegate to V",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
  );
  assert.equal(session.session.audio.input.format.rate, 16_000);
  assert.equal(session.session.audio.output.format.rate, 24_000);
  assert.equal(session.session.audio.output.voice, SEEDUPLEX_VOICES.companion);
  assert.equal(session.session.tools[0].name, "openclaw_agent_consult");
  assert.match(session.session.instructions, /full V agent/);
  assert.match(session.session.instructions, /整个会话只能使用中文/);
  assert.match(session.session.instructions, /禁止使用英文开场白/);
});

test("session request keeps Chinese replies consistent when the browser omits language", () => {
  const session = buildSeeduplexSession(
    { model: SEEDUPLEX_MODEL, voice: "xiaohe" },
    { tools: [] },
  );
  assert.match(session.session.instructions, /用户说中文时，所有回复都必须使用中文/);
  assert.match(session.session.instructions, /不要在中文请求后默认使用英文开场白/);
});

test("agent consult prompt preserves the concrete voice request and constraints", () => {
  const prompt = buildSeeduplexAgentConsultPrompt({
    question: "检查项目状态",
    context: "当前项目是 VLab",
    responseStyle: "简短中文",
  });
  assert.match(prompt, /检查项目状态/);
  assert.match(prompt, /当前项目是 VLab/);
  assert.match(prompt, /简短中文/);
  assert.match(prompt, /same language/);
  assert.match(prompt, /must be Chinese/);
  assert.throws(() => buildSeeduplexAgentConsultPrompt({}), /requires a question/);
});

test("Chinese Agent results cannot retain an English spoken preamble", () => {
  assert.equal(
    stripEnglishLeadIn(
      "I have a clear picture now. Here's what I found:\n\n**查询结果：** 当前没有项目。",
      '{"question":"查询项目"}',
    ),
    "**查询结果：** 当前没有项目。",
  );
  assert.equal(
    stripEnglishLeadIn("All systems are operational.", '{"question":"status"}'),
    "All systems are operational.",
  );
  assert.equal(
    stripEnglishLeadIn("All systems are operational.", '{"question":"检查状态"}'),
    "处理已完成，但没有返回可播报的中文结果，请再试一次。",
  );
  assert.equal(
    stripEnglishLeadIn(
      `最近的项目 doesn't map cleanly. Let me report back truthfully.

The request asked me to 调用 OpenClaw. I should answer honestly in Chinese.

当前环境里没有项目列表。OpenClaw 查询失败，请稍后重试。`,
      '{"question":"查询最近的项目"}',
    ),
    "当前环境里没有项目列表。OpenClaw 查询失败，请稍后重试。",
  );
});

test("24 kHz PCM16 input is statefully converted to 16 kHz", () => {
  const resampler = new Pcm24To16Resampler();
  assert.deepEqual([...resampler.push(audio24k([0, 3]))], []);
  const first = resampler.push(audio24k([6, 9, 12, 15]));
  assert.equal(first.length, 8);
  assert.deepEqual(
    [first.readInt16LE(0), first.readInt16LE(2), first.readInt16LE(4), first.readInt16LE(6)],
    [0, 5, 9, 14],
  );
});

test("float32 upstream output becomes bounded 24 kHz PCM16", () => {
  const decoded = decodeSeeduplexFloat32Pcm(floatAudio([-2, -1, -0.5, 0, 0.5, 1, 2]));
  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => decoded.readInt16LE(index * 2)),
    [-32768, -32768, -16384, 0, 16384, 32767, 32767],
  );
  assert.throws(() => decodeSeeduplexFloat32Pcm(Buffer.alloc(3).toString("base64")), /Invalid/);
});

test("barge-in drains locally when Seeduplex omits its cancellation acknowledgement", async () => {
  const socket = new FakeSocket();
  const audio = [];
  const clears = [];
  const responses = [];
  const provider = buildSeeduplexRealtimeVoiceProvider({
    env: { VOLCENGINE_REALTIME_API_KEY: "secret-value" },
    createWebSocket: async () => socket,
  });
  const bridge = provider.createBridge({
    providerConfig: { voice: "xiaohe" },
    onAudio: (value) => audio.push(value),
    onClearAudio: (reason) => clears.push(reason),
    onResponseDone: (outcome) => responses.push(outcome),
    onError(error) {
      assert.fail(error.message);
    },
    onClose() {},
  });

  const connecting = bridge.connect();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  socket.message({ type: "session.created" });
  await connecting;
  socket.message({ type: "response.created", response_id: "response-1" });
  bridge.handleBargeIn();
  // A barge-in signal alone only flushes local playback, matching GPT Live One.
  // Input VAD raises it on silence during a long Agent consult, so tearing the
  // upstream generation down here is what loses the turn.
  assert.notEqual(socket.sent.at(-1).type, "response.cancel");
  assert.deepEqual(clears, ["barge-in"]);
  assert.deepEqual(responses, []);

  // Confirming that the user really spoke is what earns the cancellation.
  socket.message({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "等一下",
  });
  assert.equal(socket.sent.at(-1).type, "response.cancel");
  assert.match(socket.sent.at(-1).event_id, /^event_/u);

  socket.message({ type: "response.output_audio.delta", delta: floatAudio([0.5]) });
  socket.message({ type: "response.output_audio.done", response_id: "response-1" });
  socket.message({ type: "response.done", response_id: "response-1" });
  assert.equal(audio.length, 0, "late cancelled audio must stay suppressed");
  assert.equal(responses.length, 0, "late cancelled completion must stay suppressed");

  socket.message({ type: "conversation.item.input_audio_transcription.started" });
  socket.message({ type: "response.created", response_id: "response-2" });
  socket.message({ type: "response.output_audio.delta", delta: floatAudio([0.25]) });
  socket.message({ type: "response.output_audio.done", response_id: "response-2" });
  assert.equal(audio.length, 1, "the next provider generation must remain usable");
  assert.deepEqual(responses.at(-1), { status: "completed", responseId: "response-2" });
  const cancelCount = socket.sent.filter((event) => event.type === "response.cancel").length;
  bridge.handleBargeIn();
  assert.equal(
    socket.sent.filter((event) => event.type === "response.cancel").length,
    cancelCount,
    "completed upstream output must not receive a stale response.cancel",
  );
  assert.equal(
    responses.filter((outcome) => outcome.status === "cancelled").length,
    0,
    "local cancellation completion is owned by the Gateway drain",
  );
  bridge.close();
});

test("bridge owns auth, audio conversion, transcripts and exactly-once tool results", async () => {
  const socket = new FakeSocket();
  let socketOptions;
  const events = [];
  const audio = [];
  const calls = [];
  const responses = [];
  const provider = buildSeeduplexRealtimeVoiceProvider({
    env: { VOLCENGINE_REALTIME_API_KEY: "secret-value" },
    createWebSocket: async (_url, options) => {
      socketOptions = options;
      return socket;
    },
  });
  const bridge = provider.createBridge({
    providerConfig: { voice: "xiaohe" },
    instructions: "Talk naturally.",
    tools: [
      {
        type: "function",
        name: "openclaw_agent_consult",
        description: "Delegate",
        parameters: { type: "object", properties: {} },
      },
    ],
    onAudio: (value) => audio.push(value),
    onClearAudio: (reason) => events.push(["clear", reason]),
    onTranscript: (...args) => events.push(["transcript", ...args]),
    onToolCall: (call) => calls.push(call),
    onResponseDone: (outcome) => responses.push(outcome),
    onReady: () => events.push(["ready"]),
    onError: (error) => events.push(["error", error.message]),
    onClose: (reason) => events.push(["close", reason]),
  });

  const connecting = bridge.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socketOptions.headers["X-Api-Key"], "secret-value");
  assert.equal(socketOptions.headers["X-Api-Resource-Id"], SEEDUPLEX_RESOURCE_ID);
  socket.open();
  assert.equal(socket.sent[0].type, "session.create");
  assert.equal(socket.sent[0].session.audio.output.voice, SEEDUPLEX_VOICES.xiaohe);
  socket.message({ type: "session.created" });
  await connecting;
  assert.equal(bridge.isConnected(), true);

  bridge.sendAudio(Buffer.alloc(960));
  assert.equal(socket.sent[1].type, "input_audio_buffer.append");
  assert.equal(Buffer.from(socket.sent[1].audio, "base64").length, 640);
  socket.message({
    type: "conversation.item.input_audio_transcription.completed",
    text: "帮我看看项目",
  });
  socket.message({ type: "response.output_audio.delta", delta: floatAudio([0.25, -0.25]) });
  assert.deepEqual(events.find((event) => event[0] === "transcript"), [
    "transcript",
    "user",
    "帮我看看项目",
    true,
  ]);
  assert.deepEqual([audio[0].readInt16LE(0), audio[0].readInt16LE(2)], [8192, -8192]);
  socket.message({ type: "response.output_audio.done", response_id: "response-1" });
  socket.message({ type: "response.done", response_id: "response-1" });
  assert.deepEqual(responses, [{ status: "completed", responseId: "response-1" }]);

  socket.message({
    type: "response.function_call_arguments.done",
    items: [
      {
        call_id: "call-1",
        name: "openclaw_agent_consult",
        arguments: JSON.stringify({ request: "检查项目" }),
      },
    ],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.request, "检查项目");
  bridge.submitToolResult("call-1", { text: "项目正常" });
  bridge.submitToolResult("call-1", { text: "duplicate ignored" });
  assert.equal(
    socket.sent.filter((event) => event.type === "conversation.item.create").length,
    1,
  );
  assert.equal(socket.sent.at(-1).items[0].content[0].text, '{"text":"项目正常"}');

  bridge.close();
  assert.equal(socket.sent.at(-1).type, "session.close");
  socket.close();
  assert.equal(events.filter((event) => event[0] === "close").length, 1);
});

test("upstream rejection never relays vendor diagnostics or credentials", async () => {
  const socket = new FakeSocket();
  const errors = [];
  const provider = buildSeeduplexRealtimeVoiceProvider({
    env: { VOLCENGINE_REALTIME_API_KEY: "do-not-leak" },
    createWebSocket: async () => socket,
  });
  const bridge = provider.createBridge({
    providerConfig: {},
    onAudio() {},
    onClearAudio() {},
    onError: (error) => errors.push(error.message),
    onClose() {},
  });
  const connecting = bridge.connect();
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit("unexpected-response", {}, { statusCode: 403, resume() {} });
  await assert.rejects(connecting, /not enabled/);
  assert.equal(errors.join(" ").includes("do-not-leak"), false);
});

test("Gateway-owned consults return one ordered Seeduplex tool-result batch", async () => {
  const socket = new FakeSocket();
  const prompts = [];
  const browserCalls = [];
  const pending = [];
  let activeConsults = 0;
  let maxActiveConsults = 0;
  const serverEvents = [];
  const responses = [];
  const provider = buildSeeduplexRealtimeVoiceProvider({
    env: { VOLCENGINE_REALTIME_API_KEY: "secret-value" },
    createWebSocket: async () => socket,
  });
  const bridge = provider.createBridge({
    providerConfig: { voice: "xiaohe" },
    instructions: "Use the agent.",
    tools: [
      {
        type: "function",
        name: "openclaw_agent_consult",
        description: "Delegate",
        parameters: { type: "object", properties: {} },
      },
    ],
    runAgentConsult: async ({ prompt, signal }) => {
      assert.equal(signal.aborted, false);
      prompts.push(prompt);
      activeConsults += 1;
      maxActiveConsults = Math.max(maxActiveConsults, activeConsults);
      return await new Promise((resolve) => {
        pending.push((text) => {
          activeConsults -= 1;
          resolve({ text });
        });
      });
    },
    onAudio() {},
    onClearAudio() {},
    onToolCall: (call) => browserCalls.push(call),
    onTranscript() {},
    onResponseDone: (outcome) => responses.push(outcome),
    onEvent: (event) => serverEvents.push(event.type),
    onError(error) {
      assert.fail(error.message);
    },
    onClose() {},
  });

  const connecting = bridge.connect();
  await new Promise((resolve) => setImmediate(resolve));
  socket.open();
  socket.message({ type: "session.created" });
  await connecting;
  socket.message({ type: "response.created", response_id: "initial-response" });
  // Volcengine can deliver the final transcription after response.created.
  // That ordering must not reopen Gateway ownership for internal TTS responses.
  socket.message({
    type: "conversation.item.input_audio_transcription.completed",
    text: "请查询项目",
  });
  socket.message({
    type: "response.function_call_arguments.done",
    items: [
      {
        call_id: "call-1",
        name: "openclaw_agent_consult",
        arguments: JSON.stringify({ question: "第一个问题" }),
      },
      {
        call_id: "call-2",
        name: "openclaw_agent_consult",
        arguments: JSON.stringify({ question: "第二个问题" }),
      },
    ],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(browserCalls.length, 0, "Gateway-owned calls must not reach the browser");
  assert.equal(pending.length, 1, "only the first Agent consult starts immediately");
  assert.equal(maxActiveConsults, 1);
  const workingEvents = socket.sent.filter(
    (event) => event.type === "conversation.item.create",
  );
  assert.equal(workingEvents.length, 1);
  const workingPayloads = workingEvents[0].items.map((item) => [
    item.call_id,
    JSON.parse(item.content[0].text),
  ]);
  assert.deepEqual(workingPayloads.map(([callId]) => callId), ["call-1", "call-2"]);
  for (const [, payload] of workingPayloads) {
    assert.equal(payload.status, "working");
    assert.equal(payload.language, "zh-CN");
    assert.equal(payload.instruction, "只使用中文播报 message 字段，不要说任何英文。");
    // The wait phrase must come from the rotation, never a single hard-coded
    // sentence: speaking the identical line on every delegated turn is what
    // made the assistant sound canned.
    assert.ok(
      SEEDUPLEX_WORKING_SPEECH_VARIANTS.includes(payload.message),
      `unexpected wait phrase: ${payload.message}`,
    );
  }
  assert.notEqual(
    workingPayloads[0][1].message,
    workingPayloads[1][1].message,
    "consecutive consults spoke the same wait phrase",
  );
  pending[0]("结果一");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2, "the second consult starts after the first settles");
  assert.equal(maxActiveConsults, 1, "same-session Agent consults are serialized");
  pending[1]("结果二");
  await new Promise((resolve) => setImmediate(resolve));
  socket.message({ type: "response.created", response_id: "working-generated" });
  socket.message({ type: "response.created", response_id: "working-generated-duplicate" });
  socket.message({ type: "response.output_audio.delta", delta: floatAudio([0.5]) });
  socket.message({ type: "response.output_audio.done", response_id: "working-response" });
  assert.equal(prompts.filter((entry) => typeof entry === "string").length, 2);
  let speechEvents = socket.sent.filter(
    (event) => event.type === "speech_text_buffer.commit",
  );
  assert.equal(speechEvents.length, 1);
  // The spoken announcement reuses the phrase chosen for this batch rather than
  // drawing a third one.
  assert.equal(speechEvents[0].text, workingPayloads.at(-1)[1].message);
  socket.message({ type: "response.created", response_id: "working-tts" });
  socket.message({ type: "response.output_audio.done", response_id: "working-tts" });
  speechEvents = socket.sent.filter(
    (event) => event.type === "speech_text_buffer.commit",
  );
  assert.equal(speechEvents.length, 2);
  assert.equal(speechEvents[1].text, "结果一\n结果二");
  bridge.submitToolResult("call-1", { result: "duplicate ignored" });
  assert.equal(
    socket.sent.filter((event) => event.type === "speech_text_buffer.commit").length,
    2,
  );
  socket.message({ type: "response.created", response_id: "final-response" });
  socket.message({ type: "response.output_audio.done", response_id: "final-response" });
  socket.message({
    type: "response.done",
    response: { id: "final-response", status: "completed" },
  });
  assert.equal(serverEvents.includes("response.output_audio.done"), false);
  assert.equal(serverEvents.includes("response.done"), false);
  assert.deepEqual(
    serverEvents.filter((type) => type === "response.created"),
    ["response.created"],
    "every provider-internal continuation must retain the original Gateway output owner",
  );
  assert.deepEqual(responses, [
    { status: "completed", responseId: "initial-response" },
  ]);
  bridge.close();
});

test('Seeduplex greeting uses native SayHello rather than injecting unpaired history', async () => {
  const socket = new FakeSocket();
  const bridge = buildSeeduplexRealtimeVoiceProvider({env:{VOLCENGINE_REALTIME_API_KEY:'test'},createWebSocket:async()=>socket}).createBridge({providerConfig:{voice:'xiaohe'},onAudio(){},onError:error=>assert.fail(error.message),onClose(){}});
  const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
  bridge.triggerGreeting('请向天懿问候');
  assert.equal(socket.sent.at(-1).type,'speech_text_buffer.commit');
  assert.equal(socket.sent.at(-1).text,'天懿，你好，我是 V，在呢。');
  assert(!socket.sent.some(event=>event.type==='conversation.item.create'));
  bridge.close();
});

test('greeting caption is the exact requested speech, emitted once at its first valid audio frame', async () => {
 const socket = new FakeSocket(), events = [];
 const bridge = new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture-key'},greetingText:'你好，天懿，我在呢。',
  onTranscript:(...args)=>events.push(['text',...args]), onAudio:()=>events.push(['audio']),
  onError:error=>assert.fail(error.message),onClose(){}},{createWebSocket:async()=>socket});
 bridge.triggerGreeting();assert.equal(socket.sent.length,0);
 const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
 bridge.triggerGreeting();bridge.triggerGreeting();
 assert.equal(socket.sent.filter(e=>e.type==='speech_text_buffer.commit').length,1);
 assert.equal(events.length,0,'Submitting speech does not manufacture an audible greeting');
 socket.message({type:'response.output_audio.started',response_id:'hello',tts_type:'chat_tts_text'});
 assert.equal(events.length,0,'Sentence-start without PCM does not display the greeting');
 socket.message({type:'response.output_audio.delta',response_id:'hello',delta:floatAudio([.1,.2])});
 socket.message({type:'response.output_audio.delta',response_id:'hello',delta:floatAudio([.3])});
 socket.message({type:'response.output_audio.done',response_id:'hello'});
 assert.deepEqual(events,[['text','assistant','你好，天懿，我在呢。',true,'greeting'],['audio'],['audio']]);
 socket.message({type:'response.output_text.done',response_id:'next',text:'听得见，你说吧。'});
 assert.deepEqual(events.at(-1),['text','assistant','听得见，你说吧。',true]);
 bridge.close();
});

for (const ending of ['close','barge-in','no-audio','superseded']) test(`unplayed greeting is never shown after ${ending}`,async()=>{
 const socket=new FakeSocket(),texts=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture-key'},onTranscript:(...args)=>texts.push(args),onAudio(){},onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
 bridge.triggerGreeting();socket.message({type:'response.output_audio.started',response_id:'hello',tts_type:'chat_tts_text'});
 if(ending==='close')bridge.close();
 if(ending==='barge-in')bridge.handleBargeIn();
 if(ending==='no-audio')socket.message({type:'response.output_audio.done',response_id:'hello'});
 if(ending==='superseded')socket.message({type:'response.output_audio.started',response_id:'next',tts_type:'default'});
 socket.message({type:'response.output_audio.delta',response_id:ending==='superseded'?'next':'hello',delta:floatAudio([.1])});
 assert.equal(texts.length,0);bridge.close();
});

test('async background tool releases the native call, accepts chat, and adds actual final paired context once',async()=>{
 const socket=new FakeSocket(),texts=[];
 const bridge=buildSeeduplexRealtimeVoiceProvider({env:{VOLCENGINE_REALTIME_API_KEY:'test'},createWebSocket:async()=>socket}).createBridge({providerConfig:{voice:'xiaohe'},tools:[{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{}}}],onAudio(){},onToolCall:call=>bridge.beginBackgroundTool(call.callId,'完整真实任务'),onTranscript:(...args)=>texts.push(args),onError:e=>assert.fail(e.message),onClose(){}});
 const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
 socket.message({type:'response.function_call_arguments.done',items:[{call_id:'owned-background',name:'delegate_to_v',arguments:'{}'}]});
 const ack=socket.sent.find(x=>x.type==='conversation.item.create');assert.equal(JSON.parse(ack.items[0].content[0].text).accepted,true);assert.equal(bridge.toolBatches.length,0);
 socket.message({type:'response.output_text.done',text:'小汽车笑话'});assert(texts.some(x=>x[1]==='小汽车笑话'));
 bridge.completeBackgroundTool('owned-background',{result:'已完成全部步骤。'});bridge.completeBackgroundTool('owned-background',{result:'不得重复播报。'});
 const history=socket.sent.find(x=>x.items?.length===2);assert.equal(history.items[0].content[0].text,'完整真实任务');assert.equal(history.items[1].content[0].text,'已完成全部步骤。');
 assert.equal(socket.sent.filter(x=>x.type==='speech_text_buffer.commit'&&x.text==='已完成全部步骤。').length,1);assert(texts.some(x=>x[3]==='V-backend'));bridge.close();
});


test('host notice leaves the native function turn intact and never holds a completed tool result',async()=>{
 const socket=new FakeSocket(),calls=[],notices=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},tools:['memory_search','web_search'].map(name=>({type:'function',name,parameters:{type:'object'}})),toolStartNotice:()=> '我查一下记录。',onToolStartNotice:(text,call)=>notices.push({text,call}),onAudio(){},onToolCall:call=>{calls.push(call);bridge.submitToolResult(call.callId,{answer:'真实工具结果'});},onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const opening=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await opening;
 const call=id=>socket.message({type:'response.function_call_arguments.done',items:[{call_id:id,name:'memory_search',arguments:'{}'}]});
 call('first');assert.equal(calls.length,1);assert.equal(notices.length,1);assert.equal(notices[0].call.callId,'first');assert.equal(socket.sent.filter(e=>e.items?.[0]?.role==='tool').length,1);
 assert(!socket.sent.some(e=>['speech_text_buffer.commit','response.cancel','response.create'].includes(e.type)));
 call('same-goal-second-step');assert.equal(notices.length,1);assert.equal(socket.sent.filter(e=>e.items?.[0]?.role==='tool').length,2);
 socket.message({type:'conversation.item.input_audio_transcription.completed',text:'查另外一件事'});call('next-user');assert.equal(notices.length,2);assert.equal(socket.sent.filter(e=>e.items?.[0]?.role==='tool').length,3);
 bridge.close();
});

test('parallel function results aggregate independently of host notice playback',async()=>{
 const socket=new FakeSocket(),calls=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},tools:['memory_search','web_search'].map(name=>({type:'function',name,parameters:{type:'object'}})),toolStartNotice:()=> '我查一下。',onToolStartNotice(){},onAudio(){},onToolCall:call=>calls.push(call),onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const opening=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await opening;
 socket.message({type:'response.function_call_arguments.done',items:[{call_id:'memory',name:'memory_search',arguments:'{}'},{call_id:'web',name:'web_search',arguments:'{}'}]});
 bridge.submitToolResult('web',{actual:'web'});assert(!socket.sent.some(e=>e.items?.[0]?.role==='tool'));
 bridge.submitToolResult('memory',{actual:'memory'});const output=socket.sent.find(e=>e.items?.[0]?.role==='tool');assert.deepEqual(output.items.map(e=>e.call_id),['memory','web']);assert(!socket.sent.some(e=>e.type==='speech_text_buffer.commit'));bridge.close();
});
test('Seeduplex repeats only a new audio event, never a replay of the same event identity',async()=>{
 const socket=new FakeSocket(),audio=[];const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},onAudio:b=>audio.push(b),onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const opening=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await opening;
 const e={type:'response.output_audio.delta',event_id:'native-audio',delta:floatAudio([.25,-.25])};socket.message(e);socket.message(e);socket.message({...e,event_id:'native-audio-next'});assert.equal(audio.length,2);bridge.close();
});

test('fixed backend TTS cancels without response.created or delayed ASR, suppresses its tail, and accepts the next real boundary',async()=>{
 const socket=new FakeSocket(),audio=[],done=[],clears=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},onAudio:(b,m)=>audio.push({b,m}),onClearAudio:r=>clears.push(r),onResponseDone:e=>done.push(e),onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const connect=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await connect;
 bridge.speakProgress('后台已经查完，下面是完整结果。');
 socket.message({type:'response.output_audio.started',response_id:'backend-final',tts_type:'chat_tts_text'});
 socket.message({type:'response.output_audio.delta',delta:floatAudio([.5])});
 assert.deepEqual(audio[0].m,{source:'injected-speech',responseId:'backend-final'});
 bridge.handleBargeIn();bridge.handleBargeIn();
 assert.equal(socket.sent.filter(e=>e.type==='response.cancel').length,1);assert.equal(done.length,0);
 // Already-in-flight sentence start and unlabelled deltas cannot revive it.
 socket.message({type:'response.output_audio.started',response_id:'backend-final',tts_type:'chat_tts_text'});
 socket.message({type:'response.output_audio.delta',delta:floatAudio([.5])});
 socket.message({type:'response.output_audio.done',response_id:'backend-final'});
 assert.equal(audio.length,1);assert.equal(done.length,0);
 socket.message({type:'response.output_audio.started',response_id:'new-question',tts_type:'default'});
 socket.message({type:'response.output_audio.delta',delta:floatAudio([-.5])});
 socket.message({type:'response.output_audio.done',response_id:'new-question'});
 assert.equal(audio.length,2);assert.deepEqual(audio[1].m,{responseId:'new-question'});
 assert.equal(done.at(-1).responseId,'new-question');assert(clears.length>=1);bridge.close();
});

test('long backend document keeps full paired history but commits only short speech, not a fabricated full spoken caption',async()=>{
 const socket=new FakeSocket(),texts=[];
 const bridge=buildSeeduplexRealtimeVoiceProvider({env:{VOLCENGINE_REALTIME_API_KEY:'test'},createWebSocket:async()=>socket}).createBridge({providerConfig:{voice:'xiaohe'},tools:[{type:'function',name:'delegate_to_v',parameters:{type:'object',properties:{}}}],onAudio(){},onToolCall:call=>bridge.beginBackgroundTool(call.callId,'原始任务'),onTranscript:(...args)=>texts.push(args),onError:e=>assert.fail(e.message),onClose(){}});
 const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
 socket.message({type:'response.function_call_arguments.done',items:[{call_id:'doc',name:'delegate_to_v',arguments:'{}'}]});
 const text='## 全文\n'+'日期和限定。'.repeat(100),spokenText='结果在屏幕上，可以整理成文档发给你。';
 bridge.completeBackgroundTool('doc',{result:text},{spokenText,displayedFullResult:true});bridge.completeBackgroundTool('doc',{result:text},{spokenText,displayedFullResult:true});
 const history=socket.sent.find(x=>x.items?.length===2);assert.equal(history.items[1].content[0].text,text);
 assert.deepEqual(socket.sent.filter(x=>x.type==='speech_text_buffer.commit').map(x=>x.text),[spokenText]);assert(!texts.some(x=>x[1]===text));
 assert.equal(texts.length,0,'Submitting the summary is not proof it played');
 socket.message({type:'response.output_audio.started',response_id:'summary',tts_type:'chat_tts_text'});
 assert.equal(texts.length,0);
 socket.message({type:'response.output_audio.delta',response_id:'summary',delta:floatAudio([.1])});
 socket.message({type:'response.output_audio.delta',response_id:'summary',delta:floatAudio([.2])});
 assert.deepEqual(texts,[['assistant',spokenText,true,'V-backend-summary']]);bridge.close();
});

test('a confirmed device barge-in cancels a reply mid-generation and the next utterance is still heard',async()=>{
 const socket=new FakeSocket(),audio=[],texts=[],events=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},onAudio:b=>audio.push(b),onTranscript:(role,text,final)=>final&&texts.push([role,text]),onEvent:e=>events.push(e.type),onClearAudio(){},onResponseDone(){},onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const connect=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await connect;
 // A long story: Seeduplex sends no transcription while it is still generating.
 socket.message({type:'response.output_audio.started',response_id:'story'});
 socket.message({type:'response.output_audio.delta',response_id:'story',delta:floatAudio([.5])});
 bridge.handleBargeIn({confirmed:true});
 assert.equal(socket.sent.filter(e=>e.type==='response.cancel').length,1);
 socket.message({type:'response.output_audio.started',response_id:'story'});
 socket.message({type:'response.output_audio.delta',response_id:'story',delta:floatAudio([.5])});
 assert.equal(audio.length,1,'the cancelled story does not resume');
 socket.message({type:'conversation.item.input_audio_transcription.started'});
 socket.message({type:'conversation.item.input_audio_transcription.completed',transcript:'停一下，换个故事'});
 assert.deepEqual(texts.at(-1),['user','停一下，换个故事']);
 socket.message({type:'response.output_audio.started',response_id:'answer'});
 socket.message({type:'response.output_audio.delta',response_id:'answer',delta:floatAudio([.25])});
 assert.equal(audio.length,2,'the reply to the interruption plays');
 // Once generation has finished a confirmed barge-in only flushes locally:
 // Seeduplex hears the talk-over itself, and a cancel then broke its ASR.
 socket.message({type:'response.output_audio.done',response_id:'answer'});
 bridge.handleBargeIn({confirmed:true});
 assert.equal(socket.sent.filter(e=>e.type==='response.cancel').length,1);
 assert.deepEqual(events.filter(e=>e==='client.response.cancel').length,1);
 bridge.close();
});

test('after a cancel, the next turn keeps the reply text that precedes its first audio',async()=>{
 const socket=new FakeSocket(),texts=[],audio=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},onAudio:b=>audio.push(b),onTranscript:(role,text,final)=>final&&texts.push([role,text]),onClearAudio(){},onResponseDone(){},onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const connect=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await connect;
 socket.message({type:'response.output_audio.started',response_id:'story'});
 bridge.handleBargeIn({confirmed:true});
 // A refused cancel never ends the session.
 const cancel=socket.sent.find(e=>e.type==='response.cancel');
 socket.message({type:'error',error:{event_id:cancel.event_id,message:'unexpected'}});
 socket.message({type:'response.output_text.done',response_id:'story',text:'旧故事的尾巴'});
 socket.message({type:'conversation.item.input_audio_transcription.started'});
 socket.message({type:'conversation.item.input_audio_transcription.completed',transcript:'今天星期几'});
 socket.message({type:'response.output_text.done',text:'今天是星期日。'});
 socket.message({type:'response.output_audio.started',response_id:'weekday'});
 socket.message({type:'response.output_audio.delta',response_id:'weekday',delta:floatAudio([.25])});
 assert.deepEqual(texts,[['user','今天星期几'],['assistant','今天是星期日。']]);
 assert.equal(audio.length,1);
 bridge.close();
});

test('host task narration is captioned with its own source, only once its audio actually plays',async()=>{
 const socket=new FakeSocket(),texts=[];
 const bridge=buildSeeduplexRealtimeVoiceProvider({env:{VOLCENGINE_REALTIME_API_KEY:'test'},createWebSocket:async()=>socket}).createBridge({providerConfig:{voice:'xiaohe'},tools:[],onAudio(){},onToolCall(){},onTranscript:(...args)=>texts.push(args),onError:e=>assert.fail(e.message),onClose(){}});
 const connecting=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await connecting;
 bridge.speakProgress('后台正在读网页。',{caption:true,source:'task-progress'});
 assert.deepEqual(socket.sent.filter(x=>x.type==='speech_text_buffer.commit').map(x=>x.text),['后台正在读网页。']);assert.equal(texts.length,0);
 socket.message({type:'response.output_audio.started',response_id:'stage',tts_type:'chat_tts_text'});
 socket.message({type:'response.output_audio.delta',response_id:'stage',delta:floatAudio([.1])});
 assert.deepEqual(texts,[['assistant','后台正在读网页。',true,'task-progress']]);bridge.close();
});

test('native full-duplex recognition can yield reversibly without cancelling an answer or backend work',async()=>{
 const socket=new FakeSocket(),speech=[],details=[],clears=[],audio=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture-key'},nativeDuplex:true,
  onInputSpeech:(active,detail)=>{speech.push(active);if(!active)details.push(detail);},onClearAudio:reason=>clears.push(reason),onAudio:bytes=>audio.push(bytes),onError:error=>assert.fail(error.message)},
  {createWebSocket:async()=>socket});
 const ready=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await ready;
 socket.message({type:'response.output_audio.started',response_id:'old',tts_type:'default'});
 socket.message({type:'conversation.item.input_audio_transcription.started'});
 assert.deepEqual(speech,[true]);assert.deepEqual(clears,[]);assert(!socket.sent.some(e=>e.type==='response.cancel'));
 socket.message({type:'conversation.item.input_audio_transcription.completed',text:'嗯。'});
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 assert.equal(audio.length,1,'the paused answer is retained when there is no replacement answer');assert.deepEqual(speech,[true,false]);
 socket.message({type:'conversation.item.input_audio_transcription.started'});
 socket.message({type:'conversation.item.input_audio_transcription.failed'});assert.deepEqual(speech,[true,false,true,false]);
 socket.message({type:'conversation.item.input_audio_transcription.completed',text:'  '});
 assert.deepEqual(details,[{recognized:true},{recognized:false},{recognized:false}]);
 socket.message({type:'response.canceled',response_id:'old'});assert.deepEqual(clears,['barge-in'],'a real upstream cancel still clears playback');
 bridge.close();
});

async function listeningAsideFixture(nativeDuplex=true){
 const socket=new FakeSocket(),audio=[],texts=[],events=[],clears=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},nativeDuplex,
  onAudio:(b,m)=>audio.push({b,m}),onTranscript:(...t)=>texts.push(t),onClearAudio:()=>clears.push(true),onEvent:e=>events.push(e),onError:e=>assert.fail(e.message),onClose(){}},{createWebSocket:async()=>socket});
 const connect=bridge.connect();await new Promise(r=>setImmediate(r));socket.open();socket.message({type:'session.created'});await connect;
 return {socket,bridge,audio,texts,events,clears};
}
test('a native listening aside is not spoken and cannot displace the ongoing story or its response owner',async t=>{
 const f=await listeningAsideFixture();t.after(()=>f.bridge.close());const e=x=>f.socket.message(x);
 e({type:'response.output_audio.started',response_id:'story'});e({type:'response.output_audio.delta',response_id:'story',delta:floatAudio([.25])});
 e({type:'response.output_text.delta',response_id:'aside',delta:'（安静等候，'});
 e({type:'response.output_audio.started',response_id:'aside'});e({type:'response.output_audio.delta',response_id:'aside',delta:floatAudio([.9])});
 assert.equal(f.audio.length,1,'uncertain parenthesized PCM waits for disposition');
 e({type:'response.output_text.done',response_id:'aside',text:'（安静等候，不插话、不回应背景广播）'});
 e({type:'response.output_audio.delta',response_id:'aside',delta:floatAudio([.9])});
 e({type:'response.output_audio.delta',response_id:'story',delta:floatAudio([.2])});
 assert.deepEqual(f.audio.map(a=>a.m.responseId),['story','story']);assert.equal(f.bridge.audioResponseId,'story');assert.equal(f.texts.length,0);assert.equal(f.clears.length,0);
 assert(f.events.some(e=>e.type==='native.listening-aside'));
 e({type:'conversation.item.input_audio_transcription.completed',text:'现在说话的是谁？'});
 e({type:'response.output_text.done',response_id:'next',text:'小周'});e({type:'response.output_audio.started',response_id:'next'});e({type:'response.output_audio.delta',response_id:'next',delta:floatAudio([.4])});
 assert.equal(f.audio.at(-1).m.responseId,'next');assert(f.texts.some(t=>t[1]==='小周'));assert.equal(f.socket.sent.filter(e=>e.type==='session.create').length,1);
});
for(const text of ['（2+3）等于5。','（轻声）答案是五。','（安静的森林里有一只小鸟。）'])test('ordinary parenthesized content remains audible: '+text,async t=>{
 const f=await listeningAsideFixture();t.after(()=>f.bridge.close());f.socket.message({type:'response.output_text.delta',response_id:'normal',delta:text.slice(0,3)});
 f.socket.message({type:'response.output_audio.started',response_id:'normal'});f.socket.message({type:'response.output_audio.delta',response_id:'normal',delta:floatAudio([.25])});
 f.socket.message({type:'response.output_text.done',response_id:'normal',text});assert.equal(f.audio.length,1);assert(f.texts.some(t=>t[1]===text&&t[2]));
});
test('a requested verbatim aside and a non-native route are not treated as background decisions',async t=>{
 for(const native of [true,false]){
  const f=await listeningAsideFixture(native);t.after(()=>f.bridge.close());f.socket.message({type:'conversation.item.input_audio_transcription.completed',text:'请逐字朗读括号里的安静等候。'});
  f.socket.message({type:'response.output_text.done',response_id:'read',text:'（安静等候，不插话）'});f.socket.message({type:'response.output_audio.started',response_id:'read'});f.socket.message({type:'response.output_audio.delta',response_id:'read',delta:floatAudio([.25])});
  assert.equal(f.audio.length,1);assert(!f.events.some(e=>e.type==='native.listening-aside'));
 }
});

test('listening aside variants are bounded to an entire quiet disposition',()=>{
 for(const value of ['（安静等着，不插话，等需要回应时再开口）','（安静等待）'])assert.equal(nativeListeningAside(value),true);
 for(const value of ['我先不说话','听起来像电视里的播报声呀','（安静等着）答案是五'])assert.equal(nativeListeningAside(value),false);
});

test('native replacement text retires playback before new PCM and cannot relabel an old tail',async()=>{
 const socket=new FakeSocket(),audio=[],clears=[],done=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},nativeDuplex:true,
  onAudio:(bytes,metadata)=>audio.push({bytes,metadata}),onClearAudio:(reason,metadata)=>clears.push({reason,...metadata}),onResponseDone:e=>done.push(e),onError:e=>assert.fail(e.message)},
  {createWebSocket:async()=>socket});
 const ready=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await ready;
 socket.message({type:'response.output_audio.started',response_id:'old',tts_type:'default'});
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 socket.message({type:'response.output_audio.done',response_id:'old'});
 socket.message({type:'conversation.item.input_audio_transcription.started'});
 socket.message({type:'conversation.item.input_audio_transcription.completed',text:'换个问题。'});
 socket.message({type:'response.output_text.delta',response_id:'next',delta:'新问题的回答。'});
 assert.deepEqual(clears,[{reason:'response-replaced',retiredResponseId:'old'}],'accepted new response must clear the generated old queue before its PCM');
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 socket.message({type:'response.output_audio.delta',delta:floatAudio([.5])});
 assert.equal(audio.length,1,'identified and anonymous tails of the retired TTS may not leak');
 socket.message({type:'response.output_audio.delta',response_id:'next',delta:floatAudio([-.5])});
 assert.equal(audio.at(-1).metadata.responseId,'next','a packet identity must not inherit the previous TTS start');
 socket.message({type:'response.output_audio.started',response_id:'next',tts_type:'default'});
 socket.message({type:'response.output_audio.started',response_id:'old',tts_type:'default'});
 socket.message({type:'response.output_audio.done',response_id:'old'});
 assert.equal(bridge.audioResponseId,'next');assert.equal(bridge.responseActive,true);assert.equal(done.length,1);
 socket.message({type:'response.output_audio.delta',delta:floatAudio([-.25])});
 assert.equal(audio.at(-1).metadata.responseId,'next');assert.equal(clears.length,1);
 assert(!socket.sent.some(e=>e.type==='response.cancel'),'replacement never cancels a background task or the new model reply');
 bridge.close();
});

test('native TTS start without response.created replaces a queue before its first PCM',async()=>{
 const socket=new FakeSocket(),clears=[],audio=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},nativeDuplex:true,onClearAudio:(reason,metadata)=>clears.push({reason,...metadata}),onAudio:(_b,m)=>audio.push(m),onError:e=>assert.fail(e.message)}, {createWebSocket:async()=>socket});
 const ready=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await ready;
 socket.message({type:'response.output_audio.started',response_id:'old',tts_type:'default'});
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 socket.message({type:'response.output_audio.started',response_id:'next',tts_type:'default'});
 assert.deepEqual(clears,[{reason:'response-replaced',retiredResponseId:'old'}]);
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 socket.message({type:'response.output_audio.delta',response_id:'next',delta:floatAudio([-.5])});
 assert.deepEqual(audio.map(x=>x.responseId),['old','next']);bridge.close();
});

test('an explicit old PCM packet can never acquire the newer TTS identity',async()=>{
 const socket=new FakeSocket(),audio=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},nativeDuplex:true,onAudio:(_b,m)=>audio.push(m),onError:e=>assert.fail(e.message)}, {createWebSocket:async()=>socket});
 const ready=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await ready;
 for(const id of ['old','next']){socket.message({type:'response.output_audio.started',response_id:id,tts_type:'default'});socket.message({type:'response.output_audio.delta',response_id:id,delta:floatAudio([.25])});}
 socket.message({type:'response.output_audio.delta',response_id:'old',delta:floatAudio([.5])});
 assert.deepEqual(audio.map(x=>x.responseId),['old','next'],'the late old PCM must be dropped, never relabelled next');bridge.close();
});

test('native old anonymous usage or cancel receipt cannot finish or clear a newer reply',async()=>{
 const socket=new FakeSocket(),clears=[],done=[];
 const bridge=new SeeduplexRealtimeVoiceBridge({providerConfig:{apiKey:'fixture'},nativeDuplex:true,onClearAudio:(reason,metadata)=>clears.push({reason,...metadata}),onResponseDone:e=>done.push(e),onError:e=>assert.fail(e.message)}, {createWebSocket:async()=>socket});
 const ready=bridge.connect();await new Promise(resolve=>setImmediate(resolve));socket.open();socket.message({type:'session.created'});await ready;
 socket.message({type:'response.output_audio.started',response_id:'old',tts_type:'default'});
 socket.message({type:'response.output_audio.done',response_id:'old'});
 socket.message({type:'response.output_text.delta',response_id:'next',delta:'新的回答'});
 socket.message({type:'response.done'});socket.message({type:'response.canceled'});socket.message({type:'response.output_audio.done'});
 assert.equal(done.length,1);assert.equal(clears.length,1);
 socket.message({type:'response.output_audio.started',response_id:'next',tts_type:'default'});
 socket.message({type:'response.done'});socket.message({type:'response.canceled'});
 assert.equal(bridge.responseActive,true);
 socket.message({type:'response.output_audio.done'});
 assert.equal(done.at(-1).responseId,'next');assert.equal(clears.length,1);bridge.close();
});
