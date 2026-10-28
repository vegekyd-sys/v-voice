# Fish Realtime STT 候选接入 · 2026-10-29

状态：**代码候选已实现，Fish 真实语音测试和可试聊入口被凭据阻塞**。没有合入、正式部署、手机安装或真人音频验收。基于 `origin/main` 的 `0dbc893e3b89042f5c0e103fa1547cd9ea6efdf7`，独立分支 `codex/voice-fish-stt-20261029`。

## 模型与 provider 结论

目标是 Fish `transcribe-stream-1`（Preview），原生地址 `wss://api.fish.audio/v1/asr/realtime`，MessagePack 二进制帧，服务端 Bearer 认证。它输出转写与接话信号，不生成对话答案或语音。不是文件转写 `transcribe-1-pro`，也不是 Drama 3 或 S2 TTS。

官方声明支持中文及多语言 turn detection；这不构成本次中文、中英混说、背景声或打断验收。Cekura 第一和 2.21% WER 是发布者宣称，本次未复核，不作为选型实测。

| 路线 | 本次只读审计与实际请求 | 结论 |
| --- | --- | --- |
| EvoLink 现有账户 | `/v1/models` HTTP 200，274 项；语音匹配 `qwen-audio-3.1-tts-flash`，无目标 ID | 没有确认到目标 realtime STT |
| OpenRouter 现有账户 | `/api/v1/models` HTTP 200，456 项，无目标 ID；公开 Fish 页面是文件转写 `fish-audio/transcribe-1-pro` | 不用文件转写冒充实时 turn API；普通目录可能不包含独立音频目录，结论限定于未确认到目标接口 |
| fal 现有账户 | 官方 Model Search，`q=fish`、`q=transcribe-stream-1` 均 HTTP 200，零模型，无后续游标 | 没有确认到目标接口；未部署 GPU |
| Fish 原生 | 本机、现有应用 env 与运行中的正式 Voice 凭据字段审计未找到 Fish Key；目标地址无认证握手 HTTP 401，未发送音频 | 当前明确阻塞是可用 Fish API Key；账户是否另有 preview 开通条件须认证握手确认 |
| 既有 DeepSeek | `/models` HTTP 200，返回 `deepseek-flash`、`deepseek-v4-pro`；真实调用了 `deepseek-flash` | 对话层复用现有 provider；本次官方版本名 DeepSeek-V4.1-Flash-1017 |
| 既有火山 | 真实调用 `seed-tts-2.0` 单向流式 HTTP，小何音色，24kHz mono PCM | 输出层复用现有 provider，不购买新 TTS |

审计只输出字段名、是否存在、模型与状态，没有保存凭据值。没有注册、充值、订阅或联系供应商。

## 实现与范围

组合：**Fish STT → DeepSeek `deepseek-flash` → 火山 `seed-tts-2.0` / `zh_female_xiaohe_uranus_bigtts`**。

- `VOICE_ENABLE_FISH=1` 显式开启独立 `fish-stt` 候选；缺任一凭据时目录禁用。默认模型、豆包和 GPT Live 原路径保持。
- 客户端继续上传既有 16/24kHz PCM；服务端组为 100ms MessagePack `bin`。API Key 不进入前端。校验上游生效的音频配置与事件序号。
- `speech_start`、未确认 draft、旁聊、附和不触发工具；`user_turn_taken` 停旧输出，`committed.user_turn` 为真才交给对话模型。draft 在用户 turn 已确认后按完整快照修订同一字幕，最终转写覆盖。
- `eager_end_of_turn`、`turn_resumed` 记录事件；首版不基于 speculative text 启动工具。不会把提前结束信号等同于可靠接话或全双工验收。
- DeepSeek 流式文字与工具调用继续接入共用 `session.mjs` 的工具执行器、后台任务、结果、身份、设备能力桥。工具目录来自本次既有会话，不新授予权限，不改 Gateway/Worker。
- TTS 为流式 PCM；为控制首版复杂度，等一轮对话文本完成后再开始 TTS，没有逐 token 合成。不应据此推断最终延迟最优。
- 输出生成与现有 `playback.state` 一起反馈 `agent_speaking`。真正的插话取消本代网络请求并过滤迟到 PCM；无确认的客户端声音不自动取消。没有自动重连或重放旧音频，断线明确要求重拨。
- 单次最多三分钟，连接、对话、TTS 请求前先占用保守预算；服务启动必须指定私有预算文件，重启继续累计。预算实例/文件仅允许本候选单一进程使用。

属于共用 Voice 内部模型适配，复用已有接口/权限，所以采用隔离 Candidate；没有修改跨服务合同，不占用共享 VLab。Swift 和固件没有增加 Fish 模型/中文关键词路由，仅更新按仓库要求生成的共用 H5 产物。现有原生目录接受已声明 `gateway-relay` 的动态 ID，是源码核对结论，尚不代表已安装 iPhone 的 Fish 通话通过。

## 实际结果与未验

| 项目 | 结果 | 证据边界 |
| --- | --- | --- |
| Fish API 地址/认证 | HTTP 401 | 真实网络请求，无 Key、无音频；不是 ASR 成功 |
| DeepSeek → 火山 TTS | 成功，一句合成公开测试文本 | 50 input / 17 output tokens；TTS `text_words=32` |
| 文本提交至首个 PCM | 1184ms，单样本 | 不含 Fish STT，不是可听首声，不是 p50/p95，不与豆包/GPT Live 完整首声比较 |
| 输出文件 | 248658 bytes PCM；5.180375 秒、24kHz、mono、16bit WAV | `ffprobe` 解码信息已核对；听感等待用户听验 |
| 故障与工具接入 | 自动测试通过 | Mock Fish/LLM/PCM：协议、序号、HTTP 错误、draft 修订、eager/resume、附和/噪声、重复 commit、插话淘汰、工具结果续接、既有身份与原生投影、持久预算 |
| 中文/混说、短长停顿、自我修正、连续输入 | 8 份本机离线合成素材已生成 | Fish 未调用，准确率与实际 partial/final/eot 延迟均未知 |
| 并发、限流、丢包/重连 | 上游未实测 | 本地覆盖中断/序号缺口后停止；未压测共享账户限额；Fish 会话无法恢复旧连接 |
| 完整试聊、手机麦克风/AEC、外放/耳机、后台/锁屏、实际插话听感 | 未验 | 没有打开本人麦克风、自动拨号、采集现场人声或安装 App |

8 份素材覆盖中文、中英混说、350ms/1800ms 停顿、自我修正、连续说话、附和和插话。附和/插话测试将发送 `agent_speaking`，不会真实播放助手音频，因此即使以后跑通，也不能据此声称声学回声消除或真实扬声器打断通过。文件尾部是合成素材边界，不是人工标注语音终点；统计会保留这一限制。自然 endpointing 与 `audio_done` 强制提交分别记录。

## 费用

截至本次真实调用：DeepSeek 的供应商 usage 为 50 输入/17 输出 tokens，按公开峰时价格上界约 **US$0.0000354**；火山返回 32 计费字符，按后付费 **¥3/万字符** 约 **¥0.0096**。没有假定现有余额、赠送量或折扣为零成本；未核对账单，不做精确汇率换算。

私有 ledger 的 **US$0.0103389 是保守预算预留，不是供应商实扣**：LLM 用请求 UTF-8 字节数估 token 上界，火山故意按数值 US$3/万字符预留以避免汇率低估。当前未超 US$5 目标/US$10 绝对上限；代码进一步在 US$4 保守预留时停止。未来平台后台工具/生成会产生独立费用，本次真实 API smoke 不连接 Gateway、不执行外部动作；真人试聊仍应保持本 chat 的总预算范围。

Fish 官方为 **US$0.36/连接小时**，按秒结算，连接静音也收费，若发送音频时长更长则取较长者；最多 60 分钟 session/60 秒 turn，入门档为同账户共享 5 并发。本次没有建立已认证 Fish session。

## 继续执行

唯一新增凭据需求是可用于该 preview 的 `FISH_API_KEY` 和可用 API 余额。请保存在用户控制的本机私有 env 文件，权限 `600`，只提供路径，不在聊天或 Git 粘贴密钥。若账户无余额/无 preview 权限，只报告真实 402/权限拒绝，不自动充值或改模型。

已有对话与 TTS 凭据通过私有运行环境提供 `DEEPSEEK_API_KEY`、`VOLCENGINE_TTS_API_KEY`（或 `DOUBAO_SPEECH_API_KEY`）。不要把现有完整应用 env 复制进仓库。

```sh
# 不付费的页面预览；没有 Gateway 或麦克风。
node scripts/candidate/fish-preview.mjs

# 不付费的本地 macOS 合成素材，需系统 say 与 ffmpeg。
node scripts/candidate/fish-evaluate.mjs --prepare

# 必须显式提供私有凭据文件后才运行；预算共用 artifacts 下的私有 ledger。
node --env-file=/absolute/private/providers.env --env-file=/absolute/private/fish.env scripts/candidate/fish-evaluate.mjs
node --env-file=/absolute/private/providers.env --env-file=/absolute/private/fish.env scripts/candidate/fish-smoke.mjs
```

smoke 不带 `FISH_TEST_PCM` 时只检查 Fish 认证前置条件并测试对话/TTS 半段，不会默默声称已测试 Fish 音频。将一份已准备的 16kHz mono s16le PCM 路径设为 `FISH_TEST_PCM` 可补单份实时识别，完整矩阵用 evaluate。

凭据可用后，再从已提交候选源码打包到新登记的独立目录，以原有 Gateway 和服务端入口映射启动共用服务，使用新的私有 state/日志/绑定目录及 `VOICE_FISH_BUDGET_FILE`，只开启 `VOICE_ENABLE_FISH=1`。不得启动到现有旧候选目录，也不得改正式服务 unit/env。必须先真实走通认证、转写和音频输出后才给用户可试聊入口；当前交付的 localhost 仅为 UI 预览，验证结束已停止。

真人验收顺序：用户打开已准备好的私有候选、主动选择 Fish、主动拨号并授权麦克风；按同一输入逐项说中文/混说、短长停顿、自我修正、连续说话、附和和明确插话；核对字幕、最终内容、旧音频是否停住、可听首声与完整回复。手机、耳机/外放、后台、锁屏分别登记，不自动覆盖本人 App。

## 参考

- [Fish Realtime STT 能力](https://docs.fish.audio/features/speech-to-text/realtime)
- [Fish 原生 WebSocket 协议](https://docs.fish.audio/api-reference/endpoint/websocket/asr-realtime)
- [Fish 价格、连接计费与并发](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)
- [DeepSeek 模型和峰谷计价](https://api-docs.deepseek.com/quick_start/pricing/)
- [火山语音计费](https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh)
- [火山单向流式 TTS](https://docs.volcengine.com/docs/doubao-voice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [fal 官方模型搜索](https://fal.ai/docs/platform-apis/v1/models)
- [OpenRouter 的 Fish 文件转写](https://openrouter.ai/fish-audio/transcribe-1-pro)
