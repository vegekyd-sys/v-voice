# 豆包流式多人 Candidate

版本 `speaker-stream-candidate.20261017`，独立分支 `codex/volc-speaker-modes`。复用 Voice 产品，不合入或替换线上；26320 保留为串行对照，26325 为本候选。GPT Live 直接使用原生能力。

## 数据路径

麦克风并行进入云端流式 ASR 与本地 WeSpeaker。匿名声线在当次通话内自动建立，无注册和手动校准。通常积累约 1 秒声音后，启动带当前人物信息的小何原生连接，并从短缓冲按 1 倍速持续送音频。CPU 声线推理不生成回复。

ASR 最终文本交给现有 typed Decision API，判断是否接话、回复哪些人、人物姓名/角色、是否进入排他专注；不撰写答案、不授予工具权限、不执行任务路由。Decision 与头像 Reaction 是独立用途，账号/工具权限仍由已有服务端入口决定。

Decision 前，原生生成的音频、字幕、工具调用、工具提示和清除事件全部暂存；放行才可见或执行，拒绝则一起丢弃。已确认“只跟某人聊”后，其他已知声线不送小何，云端 ASR 和本地声线仍处理声音。普通自动模式下，为加速会先把短暂未确认的音频送给小何，因此这不是所有旁话都在输入前删除的方案。

同一人/相同表达方式复用原生连接。首次获知姓名、孩子角色或回答对象组合改变时，丢弃旧的待播答复，以正确人物信息建立新会话，再保守送这句音频。当前真实接口探测中，`session.update`/上下文注入获得 ACK 仍出现人物表达滞后一轮，不能据此保证当前回答已改对。这个回退保留了人物效果，但切换轮次仍慢。只携带最近获准的有限文本历史；不会恢复模型内部隐藏状态。

人物切换时后台任务保留原 native owner，迟到结果留在屏幕，不进入新人物语音会话。既有 Gateway 协议和授权未改动。

## 本地依赖与启动

要求 Python、Node >=22、现有私有 Gateway receipt 和服务端凭据。仅本地专用 venv 安装，不改全局 Python。模型来源为 sherpa-onnx 官方 release 的 WeSpeaker Chinese：

```sh
python3 -m venv artifacts/speaker-native/embedding-venv
artifacts/speaker-native/embedding-venv/bin/python -m pip install -r lab/speaker-native/requirements-stream.txt
curl -fL https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_zh_cnceleb_resnet34.onnx -o artifacts/speaker-native/speaker-embedding.onnx
shasum -a 256 artifacts/speaker-native/speaker-embedding.onnx
```

本次模型 SHA256：`f86cd6c509f331f0e20b07bd48d1b2eb7de54202643401c4e84695ac861a0e5a`。模型、venv、凭据、收据、日志均在忽略目录，不提交。官方说明：https://k2-fsa.github.io/sherpa/onnx/speaker-identification/

```sh
VOICE_CREDENTIAL_ENV_FILE=/absolute/path/to/private.env \
VOICE_NATIVE_CREDENTIAL_FILE=/absolute/path/to/native-credentials.private.json \
npm run start:speaker-stream
```

默认读取本任务忽略目录下的 `gateway-receipt.private.json`，校验私有根目录和远端端口26367，不能指向生产。专用 SSH 转发复用本地26368；`VOICE_STREAM_PORT` 默认26325，`VOICE_SPEAKER_PYTHON`/`VOICE_SPEAKER_MODEL` 可指定本地依赖。`VOICE_STREAM_SYNTHETIC_TRACE=1` 仅在合成测试输出 ASR 边界与文本长度，不记录原始音频/声纹向量。

## 复验与限制

```sh
npm test
npm run test:speaker-native
# 真实收费 API，须有当前测试授权；fixture 全部为合成音频。
VOICE_VERIFY_ORIGIN=http://127.0.0.1:26325 node lab/speaker-native/verify-relay.mjs speaker question trial
VOICE_VERIFY_ORIGIN=http://127.0.0.1:26325 node lab/speaker-native/verify-relay.mjs speaker dialogue trial
VOICE_VERIFY_ORIGIN=http://127.0.0.1:26325 node lab/speaker-native/verify-relay.mjs speaker steady trial
```

产品 `?fixture=question` 可复验浏览器播放；正常入口不用 query。两者都需要点击拨号。每通最多5分钟、5人；进程最多160次 Decision/1800秒输入，重启只清理本候选额度。人的 PCM 不落盘，内存最多保留20秒；声线原型仅当次通话有效，结束即清除。合成测试产物保存在忽略目录。

短句、相似声线、低音量、远场和重叠说话可能无法确认；候选会提示重说或丢弃该轮，不能宣称实现了声源分离。排他模式下无法凭被过滤者的声音解除专注。人物姓名是对话关联，不是现实身份认证；“十二”不是年龄。首次/切换轮次仍有重连和重放代价，且保留原生工具可能触发额外查网/重复补充。真实父子、手机麦克风/AEC、外放回声、长通话与听感仍需人体验。

Decision 偶发超时只拒绝当前句，不结束电话；下一句可以继续。ASR/本地声线服务断连等致命错误仍要求重拨，不自动绕过过滤。

实际结果见 [2026-10-17 验证记录](../../docs/experiments/speaker-stream-2026-10-17.md)。本轮没有发布生产，因此不在首页已发布更新列表中登记未验收能力。
