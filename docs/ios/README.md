# V Voice iOS · 一按通话

目标是完整做好一件事：首次绑定个人电话入口、授权麦克风并配置操作按钮后，长按即可开始或继续与 V 的连续语音对话。原生 SwiftUI App + AudioRecordingIntent / LiveActivityIntent / ControlWidget + ActivityKit / WidgetKit，最低 iOS 26。

## 当前交付边界

- 客户端源码、Xcode 工程、图标、绑定／设置／恢复界面、按键快捷指令、灵动岛与锁屏活动均已实现。
- 本分支复用当前小何／Grok 的 `gateway-relay` PCM 协议；默认小何，可在无通话时切换 Grok。GPT Live 的 WebRTC 传输未接入，App 不会悄悄把它的会话当作 PCM 连接。模型不可用时明确失败。
- 本轮没有修改或部署 Voice 后端、Gateway、Worker、工具权限或个人会话映射；不需要共享 VLab。使用独立客户端和本地无付费协议 Candidate 验证。
- 源码完成与真机接受分开。已开发签名并安装到本人 iPhone 17 Pro；build 2 基本真实双向通话由用户确认。用户补充 build 2 曾可在灵动岛对话；build 4 的 SiriKit 路径仍打开 App，未达标。build 5 恢复 build 2 的 AudioRecordingIntent 音频路径，移除动态解锁／前台继续和 SiriKit／CallKit 转交；build 5 从桌面长按操作按钮、全程留在灵动岛并双向对话，已获用户真机确认；锁屏冷启动等扩展场景仍待验。
- build 6 将主 App 对齐当前 H5：原头像／配色、原生对话／文字补充／任务、方案阅读，支持 iPhone 与 iPad 双栏；灵动岛增加最近一句对话及直达方案的入口。本版真实服务及灵动岛到方案的手机接受另行登记，不沿用 build 5 的结论。
- 正式后端、平台 main/dev、App Store/TestFlight 均未发布。代理未自动发起正式电话或付费模型测试；用户本人已进行真实对话验收。

## 日常用户路径

1. 打开「V Voice → 通话设置」，粘贴本人完整 HTTPS 电话入口（含 `#access`），验证并绑定。入口、授权 cookie 和中断通话归属存于 Keychain，`AfterFirstUnlockThisDeviceOnly`，不写 UserDefaults、日志或灵动岛。
2. 允许麦克风；确认实时活动开启。在 App 内完成一次真实通话。
3. 到 iPhone「设置 → 操作按钮 → 快捷指令」选择 V Voice 的「和 V 通话」。如果前版选了「灵动岛拨给 V」，请改回「和 V 通话」。
4. 长按操作按钮，通过后台 AudioRecordingIntent 开始通话，使用灵动岛显示状态与控制；代码不请求解锁／前台继续，也不调用打开 App 自动拨号。上游 ready 且原生采集实际产生音频后，显示「我在听」，播放 140 ms 接通提示并触觉反馈，再请求一次欢迎语。第一句话可直接说，不要求等欢迎语完成。
5. 再次触发会继续当前通话；静音时恢复麦克风；连接过程中不重复建连。灵动岛长按展开，可静音／恢复、返回、结束。结束立即停止采集播放，再有界关闭服务端所属会话。
6. 系统来电／Siri 会暂停音频；系统允许恢复时尝试恢复，不能恢复时显示明确的继续操作。拔掉耳机先暂停，防止隐私音频突然外放。网络恢复不重放缓存的用户输入或重复欢迎语。

## 实现与权限边界

| 部分 | 实现 |
|---|---|
| 系统入口 | `AudioRecordingIntent` + `LiveActivityIntent`，仅 `.background`，`.alwaysAllowed`。先启动实时活动，使用本机已绑定入口拨号；没有 `continueInForeground`、SiriKit 通话 handoff 或 CallKit。活动静音／结束也在后台执行。 |
| 原生音频 | 恢复 build 2 的录音引擎与启动顺序，保留输入／输出格式匹配及新 relay 播放序号重置。`AVAudioSession.playAndRecord` + `voiceChat` + HFP；真机启用 Voice Processing I/O，采集转换为单声道 PCM16LE / 24 kHz / 20 ms。模拟器 HAL 不代替真机 VPIO。 |
| 收音就绪 | 实际输入帧到达后才能进入倾听；采集 5 秒无帧或引擎停止便暂停。提前到达的欢迎语音频有界缓存，等待原生音频就绪后播放。 |
| 缓存与打断 | 主线程输入交接最多 64 帧（1.28 秒，约 61 KB），上传队列最多 96 KB，输出最多 180 秒；溢出明确停止，不继续假装接通。清空时递增播放 epoch，迟到完成回调不能消费新回答；按 sequence 去重。沿用服务端语义打断，固定后端播报增加 80 ms 声学起声清空。普通回答的实际插话听感仍需真机验收。 |
| 连续通话 | 切 App／锁屏依赖 App 已启动的合法后台录音，Live Activity 仅展示与控制。没有静音播放循环、假来电、后台轮询保活或 VoIP 推送伪装。 |
| 网络恢复 | 旧连接失效后丢弃临时输入，保留真实录音引擎进行最长 30 秒的重连；新 voiceSessionId、原服务端聊天上下文，原静音状态保留。失败关闭麦克风并提示继续。 |
| 模型恢复 | `provider.reconnecting/recovered` 驱动真实状态；恢复期间不继续发送输入，35 秒无恢复则进入客户端有界重连。 |
| 身份与协议 | HTTPS Origin、cookie、phone 路由和 relayTicket 沿用既有接口；不提交 sessionKey/callerId/工具凭据，不信任客户端扩大权限。拒绝携带能力的跨站重定向。 |
| 崩溃恢复 | 记录拥有的 voiceSessionId；下次拨号先有界清理旧归属，409 不能关闭新通话。旧活动在启动时结束；活动 stale 后显示连接状态未知，不把活动本身当作存活证据。 |
| 内容 | 正文、最多 80 段对话及 16 份方案仅在内存中，挂断清空。完整方案使用 H5 同一个 GFM lexer，在非主线程解析，由 SwiftUI 原生绘制标题、列表、表格、代码、图片及媒体；不在收音时创建 WebView。只有内容实际进入阅读视图且 App 活跃才发送 content-shown；并发打开去重。 |
| 灵动岛内容 | 状态仅含最多 84 字的短句、32 字方案标题、任务标签与本通话的不透明内容 ID；不包含原文、入口或 cookie。URL 从摘要移除，文本标记 privacySensitive，设置可关闭对话摘要。点方案深链仅允许本通话已有内容，不自动建连。 |

## Apple 官方约束

2026-10-21 核对了官方文档及本机 Xcode 27.1 SDK 声明：

- [AudioRecordingIntent](https://developer.apple.com/documentation/appintents/audiorecordingintent)：intent 发起录音时必须启动并保持 Live Activity。
- [LiveActivityIntent](https://developer.apple.com/documentation/appintents/liveactivityintent)：可由系统启动 App 进程执行活动动作，不能据此推断任意后台网络／录音权限。
- [playAndRecord](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord)：双向音频与锁屏／后台 audio 模式，必须获得录音授权。
- [Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)：活动本身不能访问网络；由 App 更新，需支持锁屏、收起、最小与展开形态。
- [App Intent supportedModes](https://developer.apple.com/documentation/appintents/appintent/supportedmodes)：本版只声明后台模式，不注册动态前台继续。

build 3／4 的 SiriKit 与 CallKit 尝试已撤回：用户实测仍会打开主 App。此前对普通后台 CallKit 的失败自检不能否定用户已观察到的 AudioRecordingIntent 灵动岛对话。build 5 按用户反馈恢复原路径，只去掉误判音频错误后请求解锁的动作；是否在各种锁屏／冷启动状态均可成功，仍须逐项真机验证。进程异常退出后的活动以 25 秒 stale 期限提示状态过期，不代表进程仍存活。

## 构建与验收

- H5 视觉源：`node ios/scripts/sync-h5-design.mjs` 同步原头像、CSS 与 Markdown lexer；`--check` 验证 H5 来源没有漂移。原生视觉参数在 `VoiceStyle.swift`，宽屏断点沿用 701 pt。
- 工程：`ios/VVoice.xcodeproj`，生成源：`ios/project.yml`（XcodeGen）。无需外部二进制包，核心逻辑为本地 Swift Package。
- 自动测试：启动一个 iPhone 模拟器，运行 `ios/scripts/test-native.sh`；多个模拟器时显式传 `VVOICE_SIMULATOR_ID`。脚本仅授权该测试 App 的模拟器麦克风，使用本地无模型服务。
- 签名／可安装导出：在 Xcode Accounts 登录有效开发者账号后运行 `VVOICE_TEAM_ID=<team> VVOICE_DEVICE_ID=<connected-device> ios/scripts/build-device.sh`。仅 development/debugging 签名导出；不上传 App Store。省略 device 参数只导出，不安装。
- Release 包检查：`python3 ios/scripts/verify-release.py <VVoice.app>`。检查 arm64、活动扩展、系统 intents 元数据、正常 TLS、无 Debug 本地入口；默认要求有效签名。`--allow-unsigned` 仅用于编译产物核查，绝不能据此声称可安装。
- 模拟器展示：`npx serve-sim@latest <UDID>`，在 Codex 右侧打开其实际输出 URL，必须确认真实帧。Debug 的 `--local-voice-fixture` 使用隔离测试 Keychain 服务、明确标示无真实模型；Release 不包含该入口。
- 真机接受：见 [ACCEPTANCE.md](ACCEPTANCE.md)。测试记录见 [VALIDATION.md](VALIDATION.md)。

没有公开发布本 App，因此未把未交付的原生能力加入网页首页 changelog，也未改写正式网页版本登记。未来任何 Voice 服务端适配发布仍须遵守仓库首页 changelog、CHANGELOG 和发布登记要求。
