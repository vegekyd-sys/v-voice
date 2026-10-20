# 语音通话“断掉”审计（2026-10-13 ～ 10-20）

审计时间 2026-10-20 11:30 CST。只读：没有部署、没有重启服务、没有提权。所有时间是上海时间（CST）。通话 ID 只写前 8 位。

用户的原话是“说到一半停下来”“我说话它收不到”“要问好几句才回答”。本文按根因整理这三种体验对应的日志证据，并说明每个根因由哪个 PR 或哪个线程负责。

## 结论

1. **网页电话：每次 Gateway 重启都会把电话服务一起停掉。** V 上 `openclaw-rtc-h5.service` 写了 `Requires=openclaw-gateway.service`，systemd 停 Gateway 时会连带停掉 Voice，正在进行的通话全部断开。这一周电话服务停了 68 次，其中 38 次是 Gateway 重启带起来的（10-17 之后 20 次里有 15 次）。每次之后 Voice 会因为 Gateway 还没起来，接连崩溃重启 8–87 次，大约 30–60 秒打不开。上海节点连的是同一个 Gateway，经历了同样 17 次中断，但服务一次也没重启，说明 Voice 本身能撑过 Gateway 断线，问题出在 unit 依赖上。
2. **机器人（StackChan）170 通里只有 20 通是用户自己道别结束的（12%）。** 其余按原因分：接通后一句也没识别到（27%）；V 说完 10 秒没人接话（20%）；设备断开（14%）；判成背景闲聊（14%）；以及几类较少的原因（见下表）。
3. **能在 v-voice 里修的、有明确代码根因的有 4 项**：插话后 10 秒被误判闲置（由 continuity 的 #34 修复，#36 补了回归测试）、本地飞书工具未配置也照样交给模型（#37）、Gateway 启动期瞬断导致崩溃重启（#38）、机器人追问窗口不能按设备调（#39）。
4. **回复慢全部和工具有关。** 不调工具时，用户说完到 V 开口中位数 0.17 秒；超过 4 秒的 61 轮全部调了工具。最慢的是 `memory_search`（27 秒、48 秒、27 秒）和 `look`（5 次在 15 秒超时）。
5. **这四天 seeduplex 没有发生过一次上游错误或重连**（`upstream-error` / `reconnecting` 都是 0），所以断线不是语音模型连接断了造成的。

## 数据范围与限制

| 入口 | 数据 | 范围 | 通话数 |
|---|---|---|---|
| 网页电话（V，`openclaw-rtc-h5`） | 只有 systemd journal（服务启停、Gateway 连接错误） | 10-13 ～ 10-20 | 无法统计 |
| ReSpeaker 音箱（上海，设备 `speaker-test`） | transcripts | 10-17 02:10 ～ 10-20 | 4 通真实通话 |
| StackChan 机器人（上海，设备 `stackchan`） | transcripts | 10-17 02:10 ～ 10-20 10:55 | 170 通 |

- **网页电话的 transcripts 没有读到。** `/var/lib/openclaw-voice-h5/` 的属主是 `openclaw`，权限 0700，`ssh v` 登录的 `ubuntu` 用户读不了。按要求没有用 sudo。要补齐网页电话这一块，需要 Tianyi 授权以下任一种方式：允许用 `sudo -u openclaw` 只读复制该目录；或者由 Tianyi 把 10-13 以来的 `*.jsonl` 复制给 ubuntu 用户；或者给 ubuntu 加该目录的只读 ACL。拿到后，用同一套方法就能补出网页电话的表。
- 上海的 `v-voice-speaker` 从 10-17 02:10 才开始运行，在这之前 ReSpeaker 跑在 VLab 上，不在本次范围内。所以“过去一周”对音箱和机器人实际只覆盖了 3.5 天。
- 剔除了 11 通 ReSpeaker 上的脚本化测试（10-17 02:12–03:47，固定话术“讲一个关于猫的小故事”）和 2 通 `speaker-sim` 模拟器通话。ReSpeaker 在 10-17 之后没有真实通话，下文主要是 StackChan 的数据。
- “用户说完”取 seeduplex 给出用户 final 转写的时间。这个时间晚于用户真正停嘴的时间，所以下面的延迟是**偏小**的估计。调工具时先播放的缓存提示音（“我查一下”）不计为 V 开口。
- 工具失败只有 ok/error 状态，transcripts 里不记录失败原因。拍照、看图、音量这几类事件被 transcripts 白名单丢掉了（见“观测盲区”）。

## 一、网页电话：Gateway 重启连带停服

| 指标（10-13 ～ 10-20） | 数值 |
|---|---|
| 电话服务停止次数（`Stopping openclaw-rtc-h5`） | 68 |
| 其中停止后 15 秒内出现 Gateway 连接失败（即 Gateway 重启连带） | 38 |
| 其中 10-17 以后 | 20 次中 15 次 |
| 进程崩溃退出 | 614 次：`Gateway TRANSPORT_ERROR` 533 次、`ECONNREFUSED` 66 次、`CONNECT_TIMEOUT` 8 次、`Candidate Gateway unavailable` 7 次 |
| 运行超过 30 秒以后才崩溃 | 4 次，都是启动后约 35–40 秒的 `CONNECT_TIMEOUT`，仍属启动阶段 |

这是 Gateway 重启时 V 上出现的固定序列，以 10-17 03:39 为例：

```
03:39:59 Stopping openclaw-rtc-h5     ← systemd 因 Requires= 连带停止，通话断开
03:40:01 Started → Gateway TRANSPORT_ERROR → 进程退出
…… 共 8 次，每 3 秒一次
03:40:24 最后一次启动成功
```

同一时间段（03:40、04:13、05:06、10:49、18:25、22:17 …）上海节点也记到了 Gateway 连接错误的爆发（10-17 到 10-20 共 17 次，每次 1–2 分钟），但上海的服务一直在运行：Gateway 客户端断线后会自动重连，通话不会因此结束。

- 根因：V 上的 unit 用了 `Requires=openclaw-gateway.service`。这是 V 上的运维配置，不在仓库里。
- 修复：**运维改动**，需要 Tianyi 授权、需要 sudo：把 `Requires=` 改成 `Wants=`，保留 `After=`。`docs/deployment.md` 里补充了这条说明。
- 代码侧：在 Gateway 启动窗口内（60 秒），把传输层错误也当作可重试，进程会等 Gateway 就绪，不再退出后让 systemd 每 3 秒拉起一次（[#38](https://github.com/vegekyd-sys/v-voice/pull/38)）。等待期间电话仍然打不通，这一步只消除崩溃风暴；真正止住“Gateway 重启就断电话”的是上面那条 unit 改动。

## 二、音箱 / 机器人：通话怎么结束的

StackChan，170 通；中位时长 39 秒，超过 3 分钟的 9 通，没有超过 10 分钟的。“90 秒内重拨”指上一通结束后 90 秒内又发起了下一通，用来近似判断这次挂断不是用户想要的。

| 结束方式（细分） | 通数 | 占比 | 90 秒内重拨 | 根因 / 负责方 |
|---|---:|---:|---:|---|
| 接通后一句话也没识别到（12 秒闲置） | 46 | 27% | 19 | R3，原因未定，需要先补观测 |
| V 说完后 10 秒没人接话 | 34 | 20% | 16 | R2，#39 |
| 设备断开（`device-disconnected`） | 24 | 14% | 17 | R5，固件 / Wi‑Fi，不在 v-voice |
| 背景闲聊挂断：转写开始了，但 20–30 秒没有出结果 | 24 | 14% | 11 | R4：其中 9 通和等工具有关，归 continuity 线程；另外 15 通是嘈杂环境下识别不收尾 |
| 用户道别（end_call、道别语） | 20 | 12% | 5 | 正常 |
| 用户插话后 10 秒被判闲置 | 8 | 5% | 5 | R1，#34 修复，#36 补回归测试 |
| `slow-playback` | 8 | 5% | 2 | R6，已由 1dda663 修复 |
| 等工具时闲置 | 3 | 2% | 3 | R7，continuity 线程 |
| 用户说了话，V 还没回答就闲置挂断 | 2 | 1% | 2 | R8 / R10 |
| 服务停止（`server-stopping`，部署重启） | 1 | 1% | 0 | 发布流程 |

ReSpeaker 的 4 通真实通话里，3 通是用户道别结束，1 通是 V 说完 10 秒没人接话。

## 三、根因和实例

### R1 用户插话后，追问窗口把正在说话的人挂断（#34 修复，[#36](https://github.com/vegekyd-sys/v-voice/pull/36) 补回归测试）

- 机制：用户插话时，seeduplex 先发出 `transcription.started`，这时会记录 `lastUserAt`；随后播放被清掉，设备回报 `playback.state speaking:false`，于是 `replyEndedAt` 被设成一个**更晚**的时间。追问规则用 `lastUserAt > replyEndedAt` 判断“回复之后有没有人说话”，结果判为没有，10 秒后就以 `idle` 挂断。可这时 `userSpeaking` 还是 true，用户仍在说话。
- 证据：这 8 通都是用户开口后**正好 10 秒**被挂断，期间没有出现转写结果。其中 5 通在 90 秒内重拨了。
- 实例：
  - 10-17 19:07:35（40879cba）V 刚说完“在呢，怎么啦？”，用户马上开口，19:07:45 挂断。
  - 10-18 13:01:28（428120f6）讲故事时用户插话，13:01:39 挂断。
  - 10-18 22:51:12（d09bca3d）`look` 回答完，用户接着说，22:51:23 挂断。
- 修复：continuity 线程的 #34 新增了说话宽限 `chatterSpeechGraceMs`：从开口算起 15 秒内，任何窗口都不会挂断正在说或正在转写的那句话。这个宽限比 10 秒的追问窗口长，所以已经覆盖了这 8 通。#36 只在 #34 之上补了这个场景的回归测试：去掉宽限时测试失败。宽限过后，识别仍卡着的这一句按 #34 的设计处理：麦克风安静时请用户再说一遍，否则回落到闲置窗口。

### R2 追问窗口 10 秒对连续聊天太短（[#39](https://github.com/vegekyd-sys/v-voice/pull/39)）

- 机制：V 说完后，10 秒内没有人开口就挂断。下一句得重新唤醒机器人。
- 证据：34 通（20%），其中 16 通在 90 秒内重拨，有 6 通在 30 秒内重拨。用户其实还想接着聊。
- 实例：10-18 22:57:12（5823fbbc）挂断后 6 秒重拨；10-18 07:26:57（ff638c0a）V 最后一句是问句，挂断后 9 秒重拨；10-18 08:38:37（958e304d）挂断后 12 秒重拨。
- 修复：设备记录支持 `followUpMs`（5–60 秒），不配置时仍是 10 秒，ReSpeaker 行为不变。建议 StackChan 配 30 秒，具体值等真机验证后再定。窗口加长后，房间里的闲聊仍由背景闲聊规则（30 秒）兜底。

### R3 接通后一句也没识别到（未修，先补观测）

- 46 通（27%），都是 `userTurns=0`，在 12 秒闲置时挂断。其中：
  - 39 通的上行音频一直在传（约 14 秒、44 万字节），全部 46 通中有 28 通触发了本地 `input-speech`（RMS ≥ 450），但 seeduplex **一个转写事件都没有**。对照：成功的通话里，第一个 `transcription.started` 在 ready 后中位 1.9 秒、p90 5.7 秒就出现了。
  - 7 通上行在 3 秒内就停了（`inputBytes` 只有 0–6.7 万字节），固件不再发麦克风音频。
- 常见的情况是连续几通失败、最后一通才成功，例如 10-17 22:39:13 / 22:39:38 / 22:40:01 / 22:41:05 连续 4 通，以及 10-19 00:31:09 / 00:31:29。这和用户说的“我说话它收不到”对得上。但仅凭日志区分不了“唤醒词误触发、没人说话”和“说了但模型没听到”。
- 为什么没修：根因不确定。下一步需要两类观测（建议开后续任务）：①记录 xiaozhi 的 `listen` 事件（`detect` 唤醒、`start` 及模式、`stop`），不记录唤醒词文字以外的内容；②`device.call closed` 加上 `voicedMs`（RMS 超过阈值的累计时长）。有了这两项，就能把这 46 通拆开。必要时，再用现有的 `VOICE_DEVICE_DUMP_DIR` 在真机上录一次上行。

### R4 背景闲聊规则挂断：转写开始了却一直不出结果（部分归 continuity 线程，其余未修）

- 24 通：最后一次 `transcription.started` 之后 20–33 秒没有 final 转写，于是触发 `background-speech`。
- 其中 9 通在挂断前 60 秒内有工具调用或结果，属于“等工具时误挂”，交给 continuity 线程。最典型的一通是 10-20 10:55:13（931d7721）：`memory_search` 用了 27 秒；等待期间用户又开口（10:55:21 转写开始，一直没出结果）；10:55:40 结果回来，10:55:46 V 开口，**10:55:49 就以 background-speech 挂断**。
- 另外 15 通没有工具，例如 10-17 14:18:21（a3257e2c）：转写开始后 26 秒挂断。比较可能的原因是嘈杂环境下 seeduplex 的 VAD 一直判断不出说话结束。可调的旋钮是设备的 `noiseGateRms` / `noiseGateHoldMs`（目前 StackChan 没开，`gatedInputBytes` 基本是 0），但它会切掉轻声的尾音，必须在真机上调。所以本次没有改，也没有动 devices.json。continuity 线程在改的 `chatterSpeechGraceMs`（允许正在说的这一句说完）也能缓解一部分。

### R5 设备断开（未修，不在 v-voice）

- 24 通 `device-disconnected`，其中 17 通在 90 秒内重拨，8 通在接通后 2 秒内就断了（例如 10-17 14:20:57 → 14:21:13，随后 6 秒内重连）。
- 这是 xiaozhi 固件主动关闭了音频通道，可能是按键、固件状态机或 Wi‑Fi。服务端日志无法判断，需要机器人 / 固件线程在设备侧看串口日志。

### R6 `slow-playback`（已修）

- 8 通，全部发生在 10-18 12:38 部署 1dda663 之前（10-18 06:42–07:09 的 5 通是长故事测试）。1dda663 把播放队列上限改成 10 分钟，并且只在 20 秒完全不读 socket 时才判定 `slow-playback`，已经在 main 里。部署之后没有再出现。

### R7 等工具时被挂断 / 慢工具冷场（continuity 线程）

- `idle:tool-pending` 3 通（10-17 19:02:50、19:07:58、19:15:50）。另外 3 通设备断开、3 通背景闲聊挂断时还有工具没回来，加上 R4 里和工具有关的 9 通。
- `delegate_to_v` 有 3 次到通话结束都没有回结果，8 次失败。

### R8 本地飞书工具没配置，却照样交给模型（[#37](https://github.com/vegekyd-sys/v-voice/pull/37)）

- 上海节点没有 `LARKSUITE_CLI_*` 配置，也没有 `lark-cli`，但 `feishu_calendar` 和 `lark_read` 仍然声明给了模型。结果 `feishu_calendar` 7/7、`lark_read` 11/11 全部在 1 毫秒内失败，失败原因是“Voice 专用飞书 CLI 配置未就绪”。
- 这就是“要问好几句才回答”的一个来源：10-19 11:03:15（3bfca47c）用户问今天的工作安排，日历和飞书两个工具都失败，V 没有回答，12 秒后按闲置挂断；10-19 14:47:10（841d4687）问日历，同样没有得到回答。
- 修复：服务启动时检查本地飞书配置。没配好就不声明这两个工具，模型改用 `delegate_to_v`（后台 V 有飞书能力）。网页电话那边本地飞书已经配好，不受影响。

### R9 回声 / 误打断（机器人线程）

- 60 次 `audio.clear` 发生在 V 正在说话时，之后 12 秒内没有出现任何用户文字（StackChan 58 次、ReSpeaker 2 次），其中 17 次之后 12 秒内通话就结束了。只有 5 次伴随设备确认的 abort，其余都是 seeduplex 自己听到了“声音”，这符合回声或环境噪声触发的特征。
- ReSpeaker 的 4 通真实通话里，有 4 条“用户”转写其实是 V 自己的提示音被录回去了（例如“我上网查一下，明天上海大概…”），也就是自问自答。
- 这部分交给机器人回声线程，本次不改。

### R10 回复慢（V/OpenClaw 侧和看图线程）

| 类别 | 轮数 | 超过 4 秒 | 用户说完 → V 开口（中位） | 工具本身（中位 / 最大） |
|---|---:|---:|---:|---:|
| 不调工具 | 212 | 0 | 0.17 秒（p90 0.46 秒） | — |
| `web_search` | 25 | 21 | 4.7 秒 | 1.8 / 7.4 秒 |
| `memory_search` | 21 | 18 | 5.3 秒 | 2.1 / **48.3** 秒 |
| `look` | 12 | 12 | 7.1 秒 | 4.8 / 15.0 秒（超时） |
| `lark_read` / `feishu_calendar` | 14 | 10 | 4.3–6.6 秒 | 1 毫秒（全部失败，见 R8） |
| `delegate_to_v`（后台） | 28 | 11 | 3.8 秒（先口头确认） | 16.4 / 88.8 秒 |

- `memory_search` 有 3 次特别慢：10-17 13:29:37 用了 26.9 秒（这一轮用户没得到回答，V 就挂断了）、10-19 14:38:27 用了 48.3 秒、10-20 10:55:13 用了 27.0 秒。这是 V 侧的问题，交给 memory-search 线程。
- `look` 有 5 次在 15 秒拍照超时（10-18 13:09、13:13、18:24、22:03，10-19 00:29），1 次到通话结束都没有结果。固件上传照片没有到达，交给看图线程。
- `web_search` 本身只要 1.8 秒，但整轮要 4.7 秒，多出的约 3 秒是 seeduplex 收到工具结果后重新生成回答的时间。这在 v-voice 里改不了。

### R11 上行中断

- 203 次 `input-paused`（上行超过 2 秒没有音频）。其中 163 次发生在 V 播报期间或刚播报完，这是 xiaozhi 半双工的正常表现：说话时不发麦克风音频。
- 另有 40 次不在播报之后。其中 17 次直到通话结束都没有恢复（结束原因是 `idle` 11 次、`device-disconnected` 6 次）。单通最大上行间隔达到 48.7 秒。这和 R3 里上行在 3 秒内就停掉的 7 通是同一类现象，属于固件侧，需要在设备日志里查。

### R12 模型连接与服务端错误

- seeduplex `upstream-error` / `reconnecting` / `recovered` 都是 0 次，机器人没有一次以 `session`（模型或会话出错）结束。
- 上海这边看到的 Gateway 中断有 17 次爆发。在中断期间发起的设备通话，如果 `reserve` 失败，**一行日志都不会留下**（`call.id` 还没生成时不写审计），所以这类“拨不通”无法统计。见下面的观测盲区。

## 观测盲区（建议另开任务）

1. 设备通话启动失败（`start-failed`、Gateway 不可用）没有审计记录。
2. `tool.delivered` 只记 ok/error，不记失败类别。可以加一个固定枚举（例如未配置、超时、不可用、权限、其他），不记具体文字。
3. transcripts 白名单丢掉了 `device.look`、`device.vision`、`device.volume`、`call.connection-error`、`speaker.end-played`，只能保留数值和布尔字段。continuity 线程 #34 新增的 `device.tool-progress` / `device.tool-failure-notice` / `device.tool-result-prompt` / `device.unheard-turn` 也需要加进白名单，否则不会落盘。
4. xiaozhi 的 `listen` 事件（唤醒 / 开始 / 停止）没有记录，R3 因此无法定因。

### 补充观测（voice-device-observability，上线后生效）

上面 1–4 项都已补上，只增加数值、布尔和固定枚举字段，不落任何文字：

- `device.call` 新增阶段 `listen-detect` / `listen-start` / `listen-stop`（`latencyMs` 为距接通的毫秒数，`mode` 为 auto / manual / realtime）。唤醒词文字在 xiaozhi 适配层就被丢弃，不进入端点。每通最多记 20 条，`closed` 上的计数不受这个上限影响。
- `device.call closed` 新增：`voicedMs`（设备上行 RMS ≥ 450 的累计时长）；`droppedVoicedMs`（其中会话没有收到的部分）。会话要先加载工具和上下文才开始收音，这期间的上行由设备端点暂存，最多保留最新的 4 秒，会话开始收音后按顺序补发；补发成功的不算 dropped。超出 4 秒被挤掉的、通话结束时还在暂存里的、多人路由就绪前的上行，计入 dropped；xiaozhi 设备另有 `listenDetects` / `listenStarts` / `listenStops` / `mode`。
- 还没拿到 voiceSessionId 就结束的设备通话（`start-failed`、预约期间设备断开），用固定 id `device-start` 记一条 `closed`，带 `errorKind`。`device.ota` 用固定 id `ota` 落盘，只记 `deviceId` 和 `known`。
- `tool.delivered`、`device.look`、`device.vision`、`call.connection-error` 只记 `errorKind`（not-configured / timeout / unavailable / permission / other），按错误文字做正则分类，原文不落盘。
- `device.volume`、`device.tool-progress`、`device.tool-failure-notice`、`device.tool-result-prompt`、`device.unheard-turn`、`speaker.end-played` 加进白名单。

**R3 判读方法**：取 `userTurns=0` 的通话，按下面顺序判断：

| 现象 | 判为 |
|---|---|
| `listenDetects ≥ 1`，`voicedMs` 接近 0（低于约 300 ms），没有 `input-speech` 阶段 | 唤醒误触发，没人接着说话 |
| `listenStarts = 0`，或 `listen-stop` 出现得很早并且 `inputBytes` 很小 | 固件没有进入收音或提前停止收音（固件侧，归入 R11） |
| `voicedMs` 有 1 秒以上，`droppedVoicedMs` 接近 `voicedMs` | 说了，但都落在会话就绪前（启动阶段超过 4 秒，或在暂存期间挂断） |
| `voicedMs` 有 1 秒以上，`droppedVoicedMs` 远小于它，seeduplex 没有 `speech_started` / `transcription.started` | 说了，模型侧没听到（再用 `VOICE_DEVICE_DUMP_DIR` 录一次上行来定因） |

`voicedMs` 只看音量。电视等远处的声音也会被计入，需要结合 `gatedInputBytes` 一起看。

## PR 列表

| PR | 分支 | 修的根因 |
|---|---|---|
| [#36](https://github.com/vegekyd-sys/v-voice/pull/36)（含本报告） | `claude/voice-call-drop-audit` | R1 插话后被追问窗口误挂：回归测试（修复在 #34） |
| [#37](https://github.com/vegekyd-sys/v-voice/pull/37) | `claude/voice-lark-tools-gated` | R8 本地飞书未配置时不声明工具 |
| [#38](https://github.com/vegekyd-sys/v-voice/pull/38) | `claude/voice-gateway-startup-retry` | 一、Gateway 启动期瞬断导致崩溃重启；部署文档要求 `Wants=` |
| [#39](https://github.com/vegekyd-sys/v-voice/pull/39) | `claude/voice-device-follow-up-window` | R2 追问窗口可以按设备配置 |
| [#44](https://github.com/vegekyd-sys/v-voice/pull/44) | `claude/voice-device-early-uplink` | R3 候选原因之一：会话开始收音前的上行被丢弃，改为暂存后补发 |

## 没修的问题及原因

| 问题 | 原因 | 需要谁 |
|---|---|---|
| V 上 unit 的 `Requires=` | 生产运维配置，需要 sudo 和授权，而且 Gateway 重启时机由别人决定 | Tianyi 授权后改成 `Wants=` |
| R3 接通后一句也没识别 | 根因不确定，先补观测 | 后续任务（listen 事件、voicedMs） |
| R4 嘈杂环境下识别不收尾 | 需要在真机上调噪声门，不能盲改 devices.json | 机器人线程 / 真机验收 |
| R5 设备断开、R11 上行中断 | 固件 / Wi‑Fi | 机器人 / 固件线程 |
| R7 等工具误挂、慢工具冷场、工具失败后沉默 | continuity 线程正在修 | voice-call-continuity |
| R9 回声误打断、自问自答 | 机器人线程正在修 | 机器人线程 |
| R10 `memory_search` 27–48 秒 | V/OpenClaw 侧 | memory-search 线程 |
| R10 `look` 15 秒超时 | 固件上传或看图链路 | 看图线程 |
| 网页电话的转写层问题（误清空、没回答、慢） | 没有 transcripts 读取权限 | Tianyi 授权只读后补 |

## 方法

脚本按 `voiceSessionId` 归组事件（只看 final 转写），按以下规则细分结束方式：

- `device` 原因、`end_call`，或最后一句用户转写含道别语，算作用户主动结束。
- `idle` 再细分：结束时有工具还没回来；整通没有用户转写；用户说了话之后 V 没有开口；最后 20 秒内有转写开始但没有结果；或者纯粹的追问窗口超时。
- 判定“误清空”：`audio.clear` 时 25 秒内有 V 的 `output_audio.started`，并且之后 12 秒内没有用户文字。

延迟取用户 final 转写到下一个 `response.output_audio.started` 的时间。原始日志和脚本留在本机临时目录，不入库。
