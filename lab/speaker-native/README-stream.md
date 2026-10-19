# 豆包流式多人 Candidate

当前 Linux 候选 `speaker-stream-linux.20261019.5`，独立分支 `codex/volc-speaker-modes`。复用 Voice 产品，不合入或替换线上；26320 保留为串行对照，26325 旧书签转到 Linux。GPT Live 直接使用原生能力。

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

产品 `?fixture=question` 可复验浏览器播放；正常入口不用 query。两者都需要点击拨号。每通最多30分钟、5人；每通独立限制300次 Decision/1800秒输入，不跨通话累计。人的 PCM 不落盘，内存最多保留20秒；声线原型仅当次通话有效，结束即清除。合成测试产物保存在忽略目录。

短句、相似声线、低音量、远场和重叠说话可能无法确认；自动模式下候选会尽量用原生语音请人重说；排他模式未确认声线仍不送入小何，不能宣称实现了声源分离。排他模式下无法凭被过滤者的声音解除专注。人物姓名是对话关联，不是现实身份认证；“十二”不是年龄。首次/切换轮次仍有重连和重放代价，且保留原生工具可能触发额外查网/重复补充。真实父子、手机麦克风/AEC、外放回声、长通话与听感仍需人体验。

Decision 偶发超时只拒绝当前句，不结束电话；下一句可以继续。ASR/本地声线服务断连等致命错误仍要求重拨，不自动绕过过滤。

实际结果见 [2026-10-17 验证记录](../../docs/experiments/speaker-stream-2026-10-17.md)。本轮没有发布生产，因此不在首页已发布更新列表中登记未验收能力。

## 独立 Linux 候选

`speaker-stream-linux.20261019.5` 已将同一声线模型与 Voice 产品服务放到 Linux。浏览器只采集和播放；不需要 WASM、Mac 进程或 SSH 转发。本轮独立产品 Gateway 使用 loopback26369，配套独立 Worker、Memory 索引与 Web Search；不会连生产 Gateway。运行时版本为 Node22.23.1、Python3.12、sherpa-onnx1.13.8、numpy2.5.4。

Linux 模式必须设置 `VOICE_STREAM_LINUX=1`、`VOICE_SPEAKER_GATEWAY_LOCAL_PORT=26369`，并配置 `VOICE_SPEAKER_GATEWAY_RECEIPT`、HTTPS `VOICE_STREAM_PUBLIC_ORIGIN`、`VOICE_STREAM_BASE_PATH=/voice`、`VOICE_STREAM_ACCESS_TOKEN_FILE`。入口令牌只保存在私有文件，经 URL fragment 换取 HttpOnly Cookie；API/音频通道仍复核访问资格，不能匿名拨号。只复制该试验所需的语音/ASR/Decision 凭据，不复制个人环境文件、生产聊天或 refresh token。

部署使用独立低权限系统用户与 systemd 单元，限制 CPU100%、内存1GiB、进程数128。正式服务、Nginx、既有 Cloudflare 隧道均不改动。新专属 Cloudflare Quick Tunnel 只代理本机候选端口26327；公网入口是临时测试地址，隧道重建后可能变化，需要同步 publicOrigin 与新试用链接，不能作为正式域名承诺。停用时仅停止该候选的 voice/tunnel 单元，不停止复用的私有 Gateway 或线上服务。

`VOICE_STREAM_COMPARE_SERIAL=1` 仅用于切到旧串行链路做基准，交付时必须删除该配置并重启本候选恢复流式。批量验证设置 `VOICE_VERIFY_ORIGIN=https://<candidate-host>/voice`、`VOICE_VERIFY_ACCESS_FILE` 和 `VOICE_VERIFY_COOKIE_FILE`；复用 Cookie 避免反复登录触发每十分钟六次的访问限制，不放宽服务端保护。

Linux 实际结果与 Mac 停转发的独立性验证见 [2026-10-19 验证记录](../../docs/experiments/speaker-stream-linux-2026-10-19.md)。候选版本说明通过现有首页更新日志展示，只影响注入候选元数据的入口。


## 第二版修复与诊断

新声线需要两个一致窗口（首次声线约1秒、不同新声线通常1.6秒），片段内固定身份，并为高置信已知声线保留最多3个参考样本。可减少短前缀反复建号；不能保证相似、重叠或真实家庭声线准确。连续讲话超过4秒暂不再检查声线切换，仍为限制。

Decision 仍是一次并行 typed questions 请求，补充“是否向V说”的判定；自动模式仅在高置信安静时直接抑制，强直接请求可覆盖矛盾静默。明确专注设置短确认；排他模式非目标声线仍在模型前拦截。该策略需要继续用真实旁聊验收，不等于永不误插话。

同人物连接尚在准备时等待同一准备 Promise，避免重复重连；ASR和Decision迟到的旧句不取消新句。已放行语音喂完后12秒无音频/工具，采用本轮一次性原生澄清；有工具活动仍按原工具链处理，不因网络慢额外重复发请求。

澄清使用原生 `speech_text_buffer.commit`，只播报固定重说提示；普通答案仍由小何听原音生成。`conversation.item.create` 只更新历史，不会触发回答，不能用于澄清播报。

可设置绝对路径 `VOICE_STREAM_DIAGNOSTICS_DIR`；记录限于阶段、匿名Speaker编号、决定/置信度、文本长度、首音频和播放状态，不保存正文/名字/参数/音频/声纹。单文件约4MiB轮转，最多保留当前和上一个文件，目录0700、文件0600。诊断与合成验证收据都不提交。


## 第三版：后台工作期间继续多人通话

首句 ASR JSON 可能省略值为零的 start_time；现在按零处理，避免第一句消失。ASR 短暂断连在原通话内最多重试两次，重放有界尾音并恢复绝对时间戳；持续失败立即关闭对应浏览器通道，后台任务保持原有归属，不留下仍在上传的死通道。UI 显示识别重连状态。

仅 Speaker 候选将五个20ms采集帧合并为100ms上传，样本顺序不变，消息数降至每秒10个；原生单人链路保持原有发送行为。诊断增加上传峰值、批次数及后台开始、完成、取消事件，不保存人声、正文或工具参数。

独立 Gateway 采用当前已安装的 core/Worker 与 DeepSeek 配置，建立私有记忆快照索引；未复制生产聊天历史，不同步修改线上记忆。启动后必须实际调用 memory_search、web_search 并检查结果，目录列出工具不算通过。

合成双声线长测：`node lab/speaker-native/background-fixture.mjs` 生成授权测试材料；`node lab/speaker-native/verify-background.mjs <label>` 检查真实原生语音、真实后台结果与人物归属。设置 `VOICE_VERIFY_DIAGNOSTICS_FILE` 可追加后台完成、未误取消及讲话覆盖真实执行期的断言。浏览器测试材料由 `background-browser-fixture.mjs` 生成，经产品 `?fixture=background` 输入，不采集麦克风。这些结果不能替代真人重叠、远场与回声验收。

旧本地26325可运行 `legacy-entry.mjs`，只将书签转向 Linux HTTPS 产品入口，不处理音频、凭据或推理。详情见 [后台卡住修复与验收](../../docs/experiments/speaker-background-2026-10-19.md)。


## 第四版：自然告别与通话稳定性

在同一次 Speaker Decision 中同时判断“最新完整话语是否向V说”和“是否现在结束整通电话”，两项达到门槛才接纳告别；该控制优先于普通静默。对身边人道别、引用、否定或告别后继续提问不触发结束。排他模式非目标Speaker仍不能通过告别结束电话。

流式多人模式不再向小何声明原生end_call工具；若模型仍提出挂断，会返回未确认的结果并继续当前问题，避免绕过主机判断。其他原生模式保留原挂断工具。接纳后准备独立的小何原生连接，播放固定短告别。主机只在真实音频和完成事件都到达、浏览器返回匹配的播放完成回执后关闭。新声音会撤销挂断；准备过程中还有后续语音或更新的ASR定稿也不结束。15秒仍无告别音频时保留电话并提示重试，不假装播过。普通挂断继续沿用既有后台任务生命周期，不取消已受理任务。

真实语义矩阵：`verify-end-decisions.mjs`；完整真实音频保护与告别：`verify-ending.mjs`，浏览器素材 `ending-fixture.mjs` / `?fixture=ending`。长时与重连：`verify-soak.mjs`，最多29分钟，真实时间发送PCM并周期换人发问。`verify-native-concurrency.mjs` 仅在指定私有Gateway内验证两路媒体并行及隔离，不改变产品每个人只允许一台设备通话的保护，也不代表开放多账号。`verify-overlap.mjs` 验证混音后恢复清晰多人问答，不代表声源分离。

所有声音材料都是合成测试资产。告别播放、页面回到可拨号以真实产品浏览器为准；接口脚本的播放回执只证明协议闭环。正式发布适配、真机声学条件与多人音源分离不由这些脚本代替。


第五版补充：在“后台仍在做、刚与孩子聊天”等历史上下文里，综合判定的告别分数可能被旧重心稀释。只有综合判定已经选中结束、但置信度不足的候选，才追加一次仅包含当前完整话语的电话控制确认；不携带旧重心和后台历史。仍须确认向V说且结束整通电话，不改变任务授权或取消后台工作。普通对话保持一次Decision请求；二次确认不可用时保持电话，不猜测挂断。两次请求的用量合计记录。
