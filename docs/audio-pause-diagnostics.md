# 长插话与音频停顿诊断候选

本候选仅修改 Voice 内部的暂停状态机与私有诊断，不修改 Gateway、工具权限、共享配置或媒体协议。验收环境为本地 Candidate；未合入、未发布，未替换 build 32 稳定基线。

## 可复现的旧尾音错误续播

当播放器保留旧回复尾音、服务端已经确认用户开始发言，而用户连续说话超过 `nativeHoldMS`（默认 15 秒）时，原状态机会在固定超时到达后恢复旧回复，即使本地仍持续收到经服务确认的发言。

`confirmedLongUtteranceCannotResumeAnOldAudioTailAtFifteenSeconds` 以合成帧复现此行为，覆盖上游音频已生成完和仍在生成两种情况。候选将该超时改为对已确认发言的静默看门狗：持续的本地发言证据延长既有暂停；新响应、明确忽略、重置、无缓存的释放行为保持原样。未确认的声音仍不能仅凭能量取得暂停。若没有服务端结束/忽略事件，本地安静超过看门狗期限仍恢复，避免永久挂起。

这修复的是长插话期间旧尾音错误恢复，不是减少真实插话的暂停时间，也不能单凭此修复证明网络、ASR 或模型时延改善。实机 AEC、短/轻声、电视旁聊、连续播放及完整打断改答仍须按 `ios/stable-baseline-build32.md` 单独验收。

## 诊断数据的含义与限制

- `audio.delivery`：只观察已交给 Voice relay 的 PCM 长度和单调时钟；每段记首包/汇总，超过 500 ms 的包间隔最多记 8 条，其余仍计入汇总。包含音频时长、包数、最大间隔、结束原因；不保存 PCM、base64、正文或 provider 原始帧。
- 汇总的 `audioMs` 按现有输出 PCM16/24 kHz/单声道计算。`elapsedMs` 是交付窗口，不能当作真实播音时长；包间隔也可能被客户端既有缓存遮盖。
- `client.playback-state` 保留现有客户端上报的 speaking 布尔量。该值包含有排队缓存的情况，不能当作物理渲染游标或直接解释为“用户听到了”。
- `call.media` 记录既有终端类别、双工/播放策略与输入采样率；不记录身份、入口或设备凭据。
- 字幕补上 provider 已提供的 response/turn ID，便于与工具和音频对齐；不会为匿名 PCM 推测响应归属。

指标只能区分 Voice 交付侧的节奏；模型生成与模型到 Voice 的网络仍需要上游证据。手机收包、播放器暂停/续播、真实渲染游标继续以已留存的本地诊断或另经授权的实机验收为准。跨机器墙钟差只作近似，不将服务端首音当成用户说完到真实首音。

## 验证

```sh
swift test --package-path ios/VVoiceCore
node --test lab/realtime-direct-tools/audio-delivery-metrics.test.mjs lab/realtime-direct-tools/transcript-log.test.mjs lab/realtime-direct-tools/session.test.mjs
```

真实生产日志、正文和设备生命周期记录仅放在任务私有证据目录，不进入仓库。不得为了验证本候选自动拨打付费电话或采集原始音频。
