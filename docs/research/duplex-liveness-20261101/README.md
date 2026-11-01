# 通话“一问一答”感：豆包能否边听边应和（2026-11-01 CST）

## 结论

- **豆包原生不行。** 字节 Seed 官方博客把“倾听时附和”写在未来方向里。官方全双工接口文档没有 VAD、判停、附和或 `response.create` 的配置项。实测同一段 60 秒合成独白，12 次（含 3 次明确提示要应和）没有一次短应和；开口都是整句回答。
- **GPT Live 1 的应和是模型自己的能力。** 我们的代码没有叠加任何音频，只在提示词里写了 Backchannel/Interruption policy（`lab/gpt-live-h5/instructions.mjs`）。OpenAI 文档也把 backchannel 列为可用提示词调节的模型行为。它不是每次都应和：5 次长说话里 3 次出现，但 5 次都没有中途答整句。
- **决定（2026-11-01）：不做模型外的硬编码应和。** 本 PR 的缓存音频加规则方案被用户否决，候选已下线，本 PR 不合入。下文保留它的设计和实测，只作记录。
- **也不换 Gemini。** 用户比较后认为 Gemini 3.8 Live 和其他候选差不多，不做网页电话候选。
- **当前结果：** 测过的模型里，只有 GPT Live 1 原生同时做到应和和不抢话，但它按现在的接法不能自己调工具。这个需求暂无能满足全部三条要求的方案，线上没有变化。

全部是合成语音测试，没有真人验收。

## 三条要求对照

| 候选 | ① 自己调工具，复杂才交后端 | ② 连续性：独白中的表现 | ③ 像人 | 中文 / 国内 | 说完到首音频 | 价格 |
| --- | --- | --- | --- | --- | --- | --- |
| 豆包 SeedDuplex（现状） | 通过：`current_time` 约 1.0 s 调用、约 2.1 s 出声；复杂请求调 `delegate_to_v` | **不通过**：0 次短应和；5/9 次中途答整句，平均 3.1 句 | 用户已在用，未重测 | 中文原生，国内直连 | 独白约 1.6 s | 未查到官方单价 |
| 豆包 + 应和层（已否决） | 同上，工具链路未改 | **部分**：每 60 秒 2～4 次应和；中途整句平均约 2 句（合成呼叫方不会停，见局限）；2 秒停顿仍接话 | **待真人验收** | 同上 | 约 1.6 s，未变慢 | 无新增费用：复用已有 ASR，应和音频已缓存 |
| GPT Live 1 | **不通过（现接法）**：模型没有自己的工具，全部委派给完整 V Agent；此前统计后台任务 p50 约 20 s | **最好**：5 次长说话 3 次有“嗯。/对。”，0 次中途答整句 | 用户认可 | 中文可用；国内直连未测（媒体直连 OpenAI） | 约 1.9～2.4 s（短问题 0.9～1.7 s） | $0.05/分钟，后台另计（官方价；现走 ChatGPT OAuth） |
| Grok Voice 3.0 | 通过：约 0.5 s 调用，但普通选择题也去搜索 | **不通过**：每个停顿都接，3 次分别 12/11/14 句 | 未测 | 海外服务，国内未测 | 约 1.0 s | $0.08/分钟 |
| Qwen 3.8 | 通过：约 0.6 s 调用，但把中午读成凌晨 | **不通过**：每次约 7 句；2 秒停顿 3/3 接话 | 未测 | 中文可用；本次走新加坡端点 | 约 1.0 s | 按 token，见 Qwen 候选文档 |
| Phonic-1 | 未测 | 未测 | 2026-10-30 人工验收不通过 | | | 已搁置，不再付费复测 |
| Gemini 3.8 Live（后补测，用户不选） | 通过：查时间 12/12 次约 0.85 s 调用；委派 8/8 次 | **部分**：默认 5 次 0 次短应和，4 次半句，0 次中途答整句；提示词后长独白 1/3 次“嗯。”，犹豫 3/3 次只说“嗯” | 未验证 | 国内直连未测；官方可用地区不含中国大陆 | 约 0.9 s | 官方音频价约 $0.023/分钟；若历史全额计费约 $0.04/分钟，未核实 |

样本少，只说明方向，不是统计结论。

## 现状

- 豆包走 `wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue`，模型 `1.2.6.1`。转弦由模型内部判定，只有 `input_audio_buffer.commit` 强制判停和 `response.cancel` 打断，没有可调阈值。
- 官方称动态判停能减少抢话，这和本次看到的结果不矛盾：它能等，但开口就是一轮回答。
- 线上网页电话是 `native` + `assisted`：呼叫方说话时客户端本地暂停 V 的播放，另有一路 ASR 只用于识别“停”。
- GPT Live 经 Gateway 的 `talk.client.create` 建 WebRTC，模型声明 `delegation: client`，没有函数工具。

## 实验方法

`scripts/research/duplex-liveness/`。全部用合成语音，按 20 ms 实时节奏发送，没有真人和真实设备。

- 独白：17 个分句，间隔 400～900 ms，约 60 秒，最后才提问。
- 犹豫：三段话，中间停 2 s 和 1.6 s。
- 还有短问题、查时间、复杂任务委派、讲故事时插话。
- 豆包、Grok、Qwen 直连真实接口。GPT Live 走真实 Gateway 预约和 WebRTC，用无头 Chrome 把合成音频当麦克风，只用独立测试会话，不接任何飞书入口。GPT Live 是阳性对照：它能应和，说明这段合成语音确实测得出来。
- 合成呼叫方不会因 V 开口而停下，真人会，所以“中途整句”的绝对数比真实通话高。各模型条件相同，可以相互比较。
- 未测：真实麦克风和回声消除、真人听感、手机扬声器、StackChan、弱网。

## 候选方案（已否决，仅作记录）

- `lab/realtime-direct-tools/backchannel.mjs`：呼叫方说满 1.5 s 后出现 260～620 ms 的停顿时，判断一次。这一路只发声：不发给上游，不进字幕和历史，不影响工具和后台任务。
- **该不该应和**：看 ASR 最新一句。问句、请求、“等一下”类不应和；V 正在说或刚说完不应和；两次之间冷却 5～9 秒，再随机跳过 20%。**该不该回答**仍由豆包决定，这一层不抢这个判断。
- 没有用小模型做判断：停顿后 300 ms 内就要出声，一次模型调用来不及。判断错的代价也小，最多是“嗯”之后紧跟回答。
- 音频来自小何本人（`scripts/generate-backchannel-clips.mjs`）：嗯、嗯嗯、哦、这样啊。去掉了“对”，避免在对方说坏事时显得赞同。
- 提示词：加 `NATIVE_LONG_TURN_POLICY`。
- 网页客户端：应和不会被呼叫方的声音暂停，真正的回答仍会让路。
- 开关 `VOICE_BACKCHANNEL=1`，默认关闭，所以生产不受影响。只开网页电话；iOS App 和 StackChan 有各自的本地暂停和回声行为，未开启。

## 候选的实测（真实豆包 + 真实流式 ASR，合成呼叫方，Gateway 为 fixture）

| 项目 | 结果 |
| --- | --- |
| 独白应和次数 | 9 次运行，每次 2～4 次，都落在分句内的短停顿 |
| 提示词（直连接口） | 中途开口：基线 5/9 次（平均 3.2 句）；加提示词 1/6 次（平均 0.3 句） |
| 提示词（完整服务） | 每次约 2 句。完整提示词更长，效果比直连接口差 |
| 没有问题的陈述 | 加提示词后仍回答（3/3），没有变成沉默 |
| 犹豫 | **仍接话**，如“慢慢说，我在听呢”。提示词未改善（3/3） |
| 短问题、查时间 | 不触发应和，工具调用正常 |
| 残余回声：应和以 -20 dB、-6 dB 混回麦克风（各 3 次） | 用户转写没有混入“嗯”，没有多出回答，首音频无变化。这是模拟，不能代替真机 |
| 单元测试 | `npm test` 全部通过 |

## 代价

- **延迟**：回答不变慢。应和发出约在停顿后 260 ms 加网络时间。
- **回声**：V 可能听到自己的应和，模拟未见影响；真实手机外放是最大未知。
- **误判**：把电视或旁人说话当呼叫方时也会“嗯”，这一路分不清谁在说话。“嗯”之后紧跟回答比较常见，这是预期行为。

## 下一步

- 没有已排定的后续。如果以后要继续，原生应和只有 GPT Live 1 测到，可考虑给它加快车道：简单请求由小模型加少量工具处理，复杂请求才交 V Agent。此前调研估计短任务 3～6 s（未实测）。需要重启 Gateway 装载插件，或提供 OpenAI API Key。
- 群聊记录中他人要求被委派的问题由 PR #190 处理，本 PR 未涉及。

## 来源

- [Seed 全双工语音大模型发布](https://seed.bytedance.com/zh/blog/introducing-seed-full-duplex-speech-llm-attentive-listening-robust-interference-suppression-enabling-more-natural-interaction)
- [豆包端到端实时语音（全双工）接口](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)、[接入必读](https://docs.volcengine.com/docs/doubao-voice/access-must-read?lang=zh)
- [OpenAI GPT-Live 指南](https://developers.openai.com/api/docs/guides/live)、[提示词指南](https://developers.openai.com/api/docs/guides/live-prompting)、[模型页](https://developers.openai.com/api/docs/models/gpt-live-1)
- [LiveKit GPT-Live 插件](https://docs.livekit.io/agents/models/realtime/plugins/gpt-live)
- [xAI 语音接口](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech)、[价格](https://docs.x.ai/developers/pricing)
- [Gemini 3.8 Live 模型页](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)、[价目](https://ai.google.dev/gemini-api/docs/pricing)、[可用地区](https://ai.google.dev/gemini-api/docs/available-regions)、[条款](https://ai.google.dev/gemini-api/terms)
