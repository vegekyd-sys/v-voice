# Grok Voice 3.0 候选接入与对照

默认 Grok 语音模型固定为 `grok-voice-3.0`。沿用服务端 `XAI_API_KEY`、`eve` 音色、high reasoning、中文转写和 24kHz PCM，以及原有工具、后台委派、结果上屏和通话结束流程。密钥不进入浏览器、版本库或模型事件。

## 版本与回退

服务端可设置 `XAI_VOICE_MODEL`：

| 值 | 用途 |
| --- | --- |
| 未设置 / `grok-voice-3.0` | 默认 3.0 |
| `grok-voice-2.0` | 2.0 对照或人工回退 |
| `grok-voice-think-fast-2.0` | 保留旧部署使用的 2.0 pin |

候选服务可设置 `VOICE_DEFAULT_MODEL=grok`，让首次打开及刷新时默认选择 Grok；这只改变界面默认选择，不创建语音连接，也不授予额外权限。

不使用 `latest`，避免比较期间自动变更版本。无效值在初始化时拒绝，不静默回退。模型选择仅由服务端配置；浏览器仍传 `model: "grok"`，不能指定上游版本、身份或权限。目录、reservation、审计记录和页面模型名称均反映服务端选择。

xAI 在 2026-10-14 发布 3.0，说明接口与 2.0 不变、价格相同；2.0 已标记 deprecated，继续可用多久需以供应商为准。不可把官方 benchmark 当作 V 的实际任务验收。

- [3.0 发布说明](https://x.ai/news/grok-voice-3)
- [语音接口与迁移说明](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech)
- [API 更新记录](https://docs.x.ai/developers/release-notes)

## 可重复的隔离对照

`scripts/compare-grok-voice.mjs` 默认不发起调用；必须明确传 `--run` 并从环境注入 `XAI_API_KEY`。每次调用真实 xAI 语音模型，会消耗 API 额度。默认两轮、每轮八种任务、两个固定模型，顺序交替，单个场景最多等待18秒。脚本不连接生产 Gateway，也不读真实用户会话；所有工具、日历、记忆和后台结果均为合成 fixture。未知 RPC 直接报错，不能发送消息或生成真实媒体。

在已注入密钥的服务端环境运行，输出目录必须在仓库之外：

```sh
node scripts/compare-grok-voice.mjs --run --rounds 2 --out /absolute/private/grok-comparison
```

任务包括飞书日历、记忆检索、复杂方案委派、已有结果上屏、媒体任务委派、工具失败、明确告别和引用告别但继续聊天。使用真实生产代码的 `createDirectVoiceService`、WebSocket relay、Grok bridge、提示词、工具校验和结果交付逻辑。只对 Gateway 返回值做隔离替换。后台委派经过真实异步接续与 force_message 返回路径，但后台模型本身未调用。

可选 `--audio-dir /absolute/private/pcm`，其中包含 `calendar.pcm`、`farewell.pcm`、`quoted-farewell.pcm`，格式为无文件头的 24kHz 单声道 PCM16LE。两个模型复用完全相同的音频，按20ms实时帧输入，并附加1秒静音，测试上游 VAD、中文转写、音频回复和结束信号。此阶段使用合成音频时，只能称合成语音链路验证，不能称真人听感、真实麦克风或 AEC 验收。

每例保存 JSON 证据及收到的 WAV。版本以供应商 `session.created/updated` 的 model 核对；记录工具选择和参数、关键事实、上屏内容、是否实际发出结束信号。分别记录首音频、首次工具调用和最终文本返回时间。工具回执后的首音频也会记录，但它可能属于尚未传完的“我查一下”，不能当作真实答案的起音时间。音频输入延迟从输入文件发送结束计起，文本从提交计起；二者不可混算。生成音频的传输完成不等于物理扬声器播放完成；评测客户端只模拟播放 drain 回执。

通过率是有限场景的规则评分，需检查失败原文；不得将它写成总体模型质量或统计显著性结论。所有原文、音频和运行日志保留在外部私有目录，不提交 Git。

## 验收边界

本改动只影响 Voice 的模型适配与界面标注，使用既有 Gateway 契约，适合 Candidate 验证。`npm test` 覆盖固定模型请求、目录/审计一致性及已有工具/挂断回归。页面预览不创建语音连接。上线前仍需真实 Candidate 通话，覆盖手机权限、声学回声、真人插话、长通话、后台任务与实际告别播放完成。独立 worktree 的测试通过不表示已合入或上线。
