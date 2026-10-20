# 设备链路接入流式多人（StackChan / ReSpeaker）

PR #32 的豆包流式多人链路（并行 ASR、通话内匿名 Speaker、换人隔离上下文、主机控制挂断）原来只服务网页电话。本改动让 xiaozhi 机器人（StackChan）和原生协议音箱（ReSpeaker）的通话也能走这条链路，由 `devices.json` 的设备级开关 `multiSpeaker` 控制，默认关闭。

## 方案选择：在上海节点本地跑

设备的 Voice 服务（`v-voice-speaker`）跑在上海节点，进程就是 `lab/gpt-live-h5/server.mjs`，和 V 上的网页电话是同一份代码。网页电话的多人链路在 V 上由同一个进程在 `VOICE_STREAM_SPEAKER=1` 时启用：`production.mjs` 启动一个 Python 子进程 `embedding-worker.py`（sherpa-onnx + WeSpeaker Chinese 模型），`stream-service.mjs` 在进程内负责豆包流式 ASR、Decision 和原生连接门控。

所以设备链路选择**在上海节点本地启用同一套服务**，不把设备音频转发给 V：

- 转发到 V 要多一跳跨机音频（上海 → V → 豆包），还要给设备单独开一条到 V 的媒体通道和鉴权；设备服务放在上海本来就是为了让音频留在国内、离豆包近。
- 本地启用只多一个常驻 Python 子进程（约 120 MB），其余逻辑在已有 Node 进程内。
- 上海节点的设备会话、工具和 Gateway 隧道完全不变；多人链路只换"谁的声音送进豆包"这一层。

## 设备音频怎么流

```
设备 (xiaozhi Opus 16 kHz / 原生 PCM 16 kHz)
  └─ device-endpoint.mjs：解码、增益、噪声门；multiSpeaker 时：
       · 会话 ready 之前的上行丢弃（识人服务还没绑定）
       · 上行停顿超过 300 ms 时补 100 ms 静音（设备在 V 说话时停上行）
  └─ session.mjs：surface=speaker 且 inputPolicy=speaker → speakerRouting.reserve(surface:'speaker', 16 kHz)
  └─ stream-service.mjs（每通一个 s，farField=true）
       ├─ 16 kHz PCM 原样进入：AudioWindow（20 s 环形缓冲）
       ├─ 豆包流式 ASR（Volcengine，国内）
       ├─ OnlineSpeakerTracker → embedding-worker.py（本机 CPU）
       ├─ ASR 定稿 → 回声过滤 → Decision（OpenRouter，文本）
       └─ 放行的人声以 16 kHz、20 ms 帧送入豆包原生连接（seeduplex，不重采样）
  ← 豆包输出（音频、字幕、工具调用）先经 TurnOutputGate，Decision 放行后才到设备
```

设备特有功能都保留：

| 功能 | 多人模式下的行为 |
|---|---|
| 表情反应 | `speaker.admitted`（已放行的用户话）转成用户字幕喂给 robot driver；V 的字幕和工具事件照旧 |
| 任务状态徽章 | 工具调用经门控放行后照常发 `tool.call`/`tool.result` |
| 音量 / 看图 look | 仍是会话工具，按门控放行后执行 |
| 设备 abort 打断 | 仍转发给当前原生连接；`deviceBargeIn:true` 时生成中的回答立即取消 |
| 长回答播放 | 门控放行后直通，不受待确认 1 MB 上限影响；playout 队列不变 |
| 说完原因再挂断 | `你们先聊，需要我再叫我` 改走 `hostSpeech`：替换待定输入、直接放行，不经 Decision |
| 告别挂断 | 由主机 Decision 判断（同网页电话），原生 `end_call` 不再声明 |
| 空闲策略 | 只有放行的话算用户轮次；被追踪到的任何声音（电视、旁人）只算"房间里有人说话"。V 说完后 10 秒没人出声就结束；房间里一直有声音但 30 秒内没人对 V 说话，先说原因再离开（阈值沿用现有设备默认值） |

## 嘈杂环境：电视、孩子、回声

**电视和旁人的话怎么不被当成指令**

1. 任何 ASR 定稿都要经 Decision 判断"是否在对 V 说"才放行；被拒绝的话连同豆包已经生成的音频、字幕和工具调用一起丢弃，不会执行工具。
2. 设备上 V 不再对"听不清"主动开口：短句（<400 ms）、无法归属声线、多人重叠的定稿，在网页电话上会让 V 说"没听清请再说一次"，在设备上改为静默丢弃（`speaker.recovery-suppressed`），否则电视每隔几秒就会引出一句。只有已放行却没得到回答的话（`native-no-output`）仍会提示重说。
3. 声线名额回收：一通电话最多 5 个匿名声线。电视里的主持人、广告会很快占满名额，之后家里人就再也建不了声线、每句都会被判为无法归属。设备模式下，名额满时会回收**从没对 V 说过话**且 20 秒没出现过的声线（`speaker.evicted`）；对 V 说过话的人（被放行过）会被固定，不会被回收。Decision 的人物表同步移除。
4. 想彻底屏蔽旁人时，可以说"只跟我聊"进入排他模式：非目标声线根本不送进豆包。代价是这时十二也叫不动 V，要说"大家一起聊"解除。
5. 孩子"十二"：Decision 按对话关联姓名和角色，回答孩子时用简单直观的说法。名字只是对话关联，不是身份认证，不授予任何账号或工具权限；工具身份仍是设备绑定的 Feishu 会话。

**机器人自己的回声**

- 第一道：设备在 V 说话时停上行，大部分回声在源头就没有。
- 第二道：设备模式对 ASR 定稿做回声过滤（`echoOf`）。和 V 最近 4 段回答对比，去掉标点后整句被包含，或字符二元组有 70% 以上出现在 V 的回答里，就当作回声丢掉（`speaker.echo-dropped`），不调用 Decision，并撤销这段声音触发的推测输入。少于 4 个字的短句不过滤，交给 Decision。
- V 的声线本身可能被追踪成一个匿名 Speaker；它从不被放行，会在名额紧张时被回收。

**仍然存在的限制**

- 设备端的 abort 由固件自己的 VAD/AEC 触发；电视声音大时可能误打断 V（与是否开启多人无关）。
- 自动模式为了降低延迟，会先把刚识别出的声线音频送给豆包（结果在门控里等待 Decision），所以电视声音也会让豆包白算；被拒后下一轮要重建原生连接，延迟会高一些。
- 第一个被听到的声音默认是对话重心（可能是电视）；自动模式下只影响默认称呼对象，排他模式只能由明确指令设定。
- 不是声源分离：两人同时说话时只能请大家轮流说（设备上默认静默）。
- 每一句电视定稿都会调一次 Decision。电视一直开着大约每分钟 10–20 次，20 分钟 200–400 次，单通上限 3000 次。

## 开关怎么开

1. 服务端启用识人服务（见下方部署）：`VOICE_STREAM_SPEAKER=1`。
2. `devices.json` 里给设备加 `"multiSpeaker": true`（只能是布尔值）。只有 seeduplex 通话会走多人；同一设备选 grok 时仍走原生。
3. 设备配置在启动时读取，改完要在空闲时重启服务。
4. 审计里 `device.call stage:"start"` 带 `multiSpeaker:true` 表示这通确实走了多人；如果服务端没启用或识人进程已退出，会是 `false` 并自动按原生链路通话。

## 资源评估（上海节点，2026-10-20 只读查看）

| 项 | 现状 | 启用后 |
|---|---|---|
| CPU | 2 vCPU（AMD EPYC 7K62 2.0 GHz），负载约 0.1–0.3 | embedding 推理按需进行：有人说话时每 0.6 s 一个 1–4 s 窗口；Mac 合成样本中位 19 ms，这台机器估计 50–150 ms/窗口，即说话期间约占一个核的 10–25%。worker 用 2 线程 |
| 内存 | 总 1967 MB，可用约 976 MB，swap 已用约 475 MB；服务 MemoryMax 400M、实际约 70–130 MB | V 上同一模型的 worker 空闲常驻约 117 MB。服务合计约 250–300 MB，建议 MemoryMax 改为 768M |
| 网络 | 豆包实时语音、Volc ASR 在国内 | Decision 走 OpenRouter：上海实测 TLS+首字节 0.45–0.67 s（V 上 0.04 s），每轮放行约多 0.4 s |
| 并发 | 设备共享同一个 Feishu 会话，同时只有一通 | 一个 worker 足够；推理排队上限 8，单次超时 2 s |

**需要决定的一点**：上海服务描述为"音频留在国内"。启用后音频仍只去 Volc ASR 和本机 worker，但 ASR 文本（包括房间里电视、家人的话）和匿名人物表会发到 OpenRouter 做 Decision。审计日志也会记录 `speaker.utterance` 的文本（和 V 上的网页电话一致）。

## 部署步骤（上海节点，由发布会话执行）

前提：本 PR 已合入 `v-voice/main`，从合入后的提交构建；按仓库 AGENTS.md 更新首页 `changelog.mjs`、`CHANGELOG.md` 和版本登记；重启前确认没有进行中的通话。

1. **Python 运行时**（系统缺 `ensurepip`，需要先装 venv 包）：
   ```sh
   apt-get install -y python3.12-venv
   install -d -m 755 /opt/v-voice-speaker/speaker-runtime
   python3 -m venv /opt/v-voice-speaker/speaker-runtime/embedding-venv
   /opt/v-voice-speaker/speaker-runtime/embedding-venv/bin/pip install \
     -i https://mirrors.cloud.tencent.com/pypi/simple \
     -r /opt/v-voice-speaker/releases/<sha>/lab/speaker-native/requirements-stream.txt
   ```
   pypi.org 在这台机器上会超时，用腾讯云镜像。
2. **模型**：从 sherpa-onnx 官方 release 下载（GitHub 在该节点可达），或从 V 上已校验的运行时目录复制，然后校验：
   ```sh
   curl -fL https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_zh_cnceleb_resnet34.onnx \
     -o /opt/v-voice-speaker/speaker-runtime/speaker-embedding.onnx
   sha256sum /opt/v-voice-speaker/speaker-runtime/speaker-embedding.onnx
   # 必须是 f86cd6c509f331f0e20b07bd48d1b2eb7de54202643401c4e84695ac861a0e5a
   chmod -R a+rX /opt/v-voice-speaker/speaker-runtime
   ```
3. **预检**（以服务用户运行，确认模型能加载，并测推理耗时和内存）：
   ```sh
   sudo -u vvoice /usr/bin/time -v /opt/v-voice-speaker/speaker-runtime/embedding-venv/bin/python -c '
   import sys,time,base64,json,numpy as np,subprocess
   p=subprocess.Popen([sys.executable,"/opt/v-voice-speaker/releases/<sha>/lab/speaker-native/embedding-worker.py","/opt/v-voice-speaker/speaker-runtime/speaker-embedding.onnx"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
   print(p.stdout.readline().strip())
   pcm=(np.random.randn(64000)*3000).astype("<i2").tobytes()
   for i in range(5):
     p.stdin.write(json.dumps({"id":i,"audio":base64.b64encode(pcm).decode()})+"\n");p.stdin.flush()
     print(json.loads(p.stdout.readline()).get("inferenceMs"),"ms")
   p.terminate()'
   ```
   期望先输出 `{"ready": true}`，4 秒窗口的 `inferenceMs` 在几百毫秒以内（超过 1 s 就不要启用：worker 超时是 2 s）。
4. **发布目录**：`git archive` 合入后的提交到 `/opt/v-voice-speaker/releases/<sha>`；依赖（opusscript、ws）与 c19b8b7 相同，可以复制它的 `node_modules`。在发布目录跑 `npm test` 和 `npm run test:speaker-native`。
5. **环境变量**：先备份 `/etc/v-voice-speaker/voice.env`（例如 `voice.env.before-<sha>`），再追加：
   ```
   VOICE_STREAM_SPEAKER=1
   VOICE_STREAM_SPEAKER_OPTIONAL=1
   VOICE_SPEAKER_PYTHON=/opt/v-voice-speaker/speaker-runtime/embedding-venv/bin/python
   VOICE_SPEAKER_MODEL=/opt/v-voice-speaker/speaker-runtime/speaker-embedding.onnx
   VOLCENGINE_ASR_API_KEY=<从 V 正式环境复制，不进 Git>
   OPENROUTER_API_KEY=<或 VOICE_JEV_API_KEY，从 V 正式环境复制>
   VOICE_SPEAKER_DIAGNOSTICS_DIR=/var/lib/v-voice-speaker/speaker-diagnostics   # 可选
   ```
   `VOICE_STREAM_SPEAKER_OPTIONAL=1` 让识人进程起不来时只记 `speaker.unavailable` 并继续服务原生通话，避免设备服务启动失败、反复重启。注意：启用后上海节点自带的 H5 页面（如果有人用）也会默认走多人，与 V 上的网页电话一致。
6. **systemd**：备份 unit（`v-voice-speaker.service.before-<sha>`），把 `WorkingDirectory`/`ExecStart` 指向新发布目录，`MemoryMax=400M` 改为 `MemoryMax=768M`（Python worker 是服务的子进程，在同一个 cgroup 里）。`ProtectSystem=strict` 下 `/opt` 只读即可，诊断目录在已有的 `ReadWritePaths=/var/lib/v-voice-speaker` 下。`systemctl daemon-reload`。
7. **分两步打开**：
   - 先保持 `devices.json` 不变，空闲时重启。检查日志里没有 `speaker.unavailable`，`ps` 能看到 `embedding-worker.py` 子进程，服务内存在预期内；真机拨一通确认原生链路（`multiSpeaker` 未开）行为不变。
   - 再备份 `devices.json`（`devices.json.before-multispeaker`），给 `stackchan` 加 `"multiSpeaker": true`（ReSpeaker 的 `speaker-test` 视情况再开），空闲时再重启。
8. **真机验收看什么**：`device.call stage:"start" multiSpeaker:true`；transcripts 里用户话是 `source:"speaker-asr"`；有 `speaker.decision`、`speaker.admitted`；电视开着时出现 `speaker.recovery-suppressed`/`speaker.evicted` 而 V 不开口；V 说完后的残余出现 `speaker.echo-dropped`；结束原因不是 `asr-disconnected`/`embedding-*`。

## 回滚

- **只关设备开关**：`cp devices.json.before-multispeaker devices.json`（或把 `multiSpeaker` 改为 false），空闲时重启。识人进程仍常驻但设备不用。
- **完全回滚**：unit 恢复为 `.before-<sha>`（指回 c19b8b7）、`voice.env` 恢复备份，`daemon-reload` 后空闲时重启。不设 `VOICE_STREAM_SPEAKER` 就不会启动 Python 进程。venv 和模型留在 `/opt/v-voice-speaker/speaker-runtime` 不影响任何服务，可以之后再删。
- Gateway 和隧道不需要动。

## 测试

- `npm test`：设备端点含多人链路的端到端用例（真实 stream-service，假 ASR/声线）：16 kHz 不重采样、只计放行轮次、上行停顿补静音、无识人服务时回退原生、电视话不放行时仍说完原因再挂断。
- `npm run test:speaker-native`：16 kHz 帧、回声过滤、设备静默恢复、host speech、名额回收、Decision 人物表移除、可选启动、worker 退出后回退原生。
- 现有 `verify-*.mjs`（`verify-relay`、`verify-soak`、`verify-ending` 等）都走网页的 `/api/speaker-stream` 通道并调用真实收费接口，不覆盖设备 WebSocket / xiaozhi Opus 链路，不能代替设备验收。设备链路以真机长测为准：3、10、20 分钟，电视开着、十二在旁边，观察上面第 8 步列出的审计事件和结束原因。
