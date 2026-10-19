# 自动多人对话：Speaker + Decision + 原生语音候选

当前交付为独立 Linux 流式候选 `.20261019.3`；旧26325入口转向 Linux。开发仍可使用 `npm run start:speaker-stream`，默认端口 **26325**。下面的 26320 是保留的串行对照。GPT Live 保留原生，不继续定制多人门控。流式安装、机制、测量与已知边界见 [README-stream.md](README-stream.md)。

本候选直接复用 Voice H5 产品的拨号、模型选择、头像、字幕、补充内容、工具与结果展示。没有另一套 demo UI。默认自动多人对话，支持小何和 GPT Live，Grok 未接入本轮。

## 职责与路径

1. 麦克风音频并行进入火山流式 ASR，启用匿名 speaker 信息，不传 voiceprints，不要求注册或校准。
2. 会话内保留匿名 Speaker、实际发言、姓名原话证据、角色和当前主要对象。Decision API 只选择是否回应、回应对象组合、姓名候选、角色、专注约束，不生成回复。
3. 安静时不向原生语音模型提交这句话；明确“只跟某人聊”后，其他已识别声线在 Decision 前拦住。ASR 仍会听到这些声音。
4. 获准时注入紧凑的人物上下文，再以正常速度提交该句原始音频。小何仍使用原生 SeedDuplex 音频；GPT 仍使用产品的原生 GPT Live WebRTC。模型自行生成回答与声音。

保守输入门控会等待整句最终分人结果，并额外重放整句。这是当前明显的性能代价，不能因为 Decision 比文字生成快就称整条链路提速。没有混音源分离，重叠声音仍可能一起存在于获准片段里。

## 启动

要求已有隔离 Gateway 的私有 receipt，以及服务端 ASR、Decision、原生语音凭据。不要指向生产 Gateway。

```sh
VOICE_CREDENTIAL_ENV_FILE=/absolute/path/to/private.env \
VOICE_NATIVE_CREDENTIAL_FILE=/absolute/path/to/native-credentials.private.json \
VOICE_SPEAKER_GATEWAY_RECEIPT=/absolute/path/to/gateway-receipt.private.json \
npm run start:speaker-native
```

默认 `http://127.0.0.1:26320/`，可用 `VOICE_SPEAKER_PORT` 修改。Gateway 远端固定为本任务私有实例的 26367，SSH 本地端口可用 `VOICE_SPEAKER_GATEWAY_LOCAL_PORT` 设置。收据校验拒绝其他实例。私有 Gateway 初始化见 `provision-gateway.py`；需要先上传此仓库的插件源码至候选根目录 `voice/`，配置包含官方 codex/openai 插件。首次插件安装收敛后再启动一次私有实例。不要修改 pinned runtime 或生产配置。

本轮已运行的产品进程由 `com.versa.v-voice.speaker-native-product` 管理，专属 SSH 转发由 `com.versa.v-voice.speaker-native-tunnel` 管理；私有 V 单元为 `voice-speaker-native-gateway-01a13f2c-bubbles.service`。启动配置在忽略目录，不能提交。

## 复验

```sh
npm run test:speaker-native
npm test
# 下面实际调用收费服务，只在明确授权的测试会话中运行。
VOICE_CREDENTIAL_ENV_FILE=/absolute/path/to/private.env node --dns-result-order=ipv4first lab/speaker-native/fixtures.mjs
VOICE_CREDENTIAL_ENV_FILE=/absolute/path/to/private.env node --dns-result-order=ipv4first lab/speaker-native/verify-decision.mjs
node --dns-result-order=ipv4first lab/speaker-native/verify-relay.mjs speaker question trial-1
node --dns-result-order=ipv4first lab/speaker-native/verify-relay.mjs native question trial-1
node --dns-result-order=ipv4first lab/speaker-native/verify-relay.mjs text question trial-1
```

`text` 访问旧候选 26319。其他使用 `VOICE_VERIFY_ORIGIN`，默认 26320。长通话测试包含产品心跳。`passed` 只表示传输、路由服务无错误及收到实际语音；内容质量需要结合完整路由与实际字幕逐句审阅。

产品内部合成输入路径：`?fixture=question` 或 `?fixture=dialogue`。`&inputPolicy=native` 关闭门控用于同音频对照。正常入口没有 query，不读样本、不自动拨号。测试路径只在注入 candidate 能力时启用，常规启动不启用。

全部样本为合成音频，原始人的通话音频不落盘。运行时 PCM 只在内存里最多保留 20 秒；超长单句提示重说。Speaker/姓名只在当次通话有效，猜测显示“可能是”，不用于工具授权、账号切换或权限提升。每通限 180 秒，进程最多 160 次 Decision、1200 秒输入，用于限制本轮候选试用。

## 边界

- ASR 声线编号会错分、把同一人拆成两个 Speaker，也可能重编号；发现已确认编号被修订则停止该路由并要求重拨，不悄悄改绑。
- 只在已出现的 Speaker 中切换排他对象；“某人还没开口就先指定名字”等待绑定尚未实现。
- 非目标声线不会打断原生输出；选中的新句子才交给原生打断处理。候选不支持凭被过滤者的声音解除排他模式。
- Decision 服务超时不会绕过过滤直接把音频放行；正常后续句子仍可继续处理。错误不会替换成文字模型生成的回复。
- 尚需真人父子、抢话重叠、远场/电视、手机 AEC 和长期通话验收。单次合成测试不代表产品可上线。

本轮结果和版本边界见 `docs/experiments/speaker-native-2026-10-16.md`。线上服务未修改。
