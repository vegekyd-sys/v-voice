# 当前验证记录 · 2026-10-21

源基线：`origin/main 77fb188ccdc976126a6098b8d218957cc28bad82`，其中正式 Voice 运行登记为 `16932ca42f415c8b0e93c5886b61cb571de4a7d3`。本分支没有改动后端。原生代码提交：`5030248ad33c44c1bea24d95e4dd82f06ca6696e`。

环境：Xcode 27.1 / 27A9275；iPhone 17 Pro 模拟器 iOS 26.5。首轮核对时物理 iPhone 17 Pro 为 unavailable；后续已通过 USB 连接，实测系统为 iOS 27.0.1、开发者模式 enabled、配对和 tunnel 正常。用户已完成 Xcode Apple Account 登录，实际归档请求到达 Apple，但被团队最新版 Program License Agreement 尚未接受所阻塞；因此尚未安装或代做真机接受。Keychain 测试使用正常签名的模拟器包；禁用模拟器签名时的 Keychain 失败不被当作通过。

## 已通过

| 检查 | 结果与实际范围 |
|---|---|
| Swift 核心测试 | 3/3：个人 URL 不带入客户端身份参数；重复动作／晚到旧 generation；播放清空后旧 completion 不消耗新回答及 sequence 去重／溢出。 |
| 原生 App 集成 | 11/11：未绑定不能开麦；Keychain 重开及 DeviceOnly 属性；早到音频有界等待；建连中挂断；静音跨恢复；自然挂断；provider 恢复；真实 AVAudioEngine 采集、PCM WebSocket 上传、多轮播放、静音、重复动作、重拨；结果接收及清空；socket 恢复不重复欢迎语；合成系统打断恢复。 |
| 后端合同 | 79/79，原有 `hosted.test.mjs` + `session.test.mjs`，覆盖入口／cookie／会话归属／工具与既有生命周期；没有调用真实模型。 |
| 系统 UI 实操 | 在 Codex 内置浏览器镜像实际模拟器：App 呼叫、系统麦克风拒绝后的设置入口、后台收起灵动岛、长按展开、灵动岛静音、灵动岛结束；锁屏活动与结束。不是静态 SwiftUI Preview。 |
| 后台与锁屏音频 | 退出 App 后和锁屏期间，本地 fixture 的 inputBytes／heartbeat 持续增长；锁屏点结束后 active=null、音频输入计数停止。fixture 仅统计输入字节，不保存录音。 |
| Release 编译 | arm64 Release archive 成功，主 App 和 Activity 扩展齐全。正常 HTTPS/TLS、4 个系统 intents 元数据正确，AudioRecording 与 SessionStarting traits 存在；本地 Debug 入口与 fixture-cookie 不在 Release 可执行文件中。 |
| 签名导出 | 未完成。开发证书存在，用户已完成账号登录；最新实际归档返回 PLA Update available，要求团队 Account Holder 接受最新 Program License Agreement，两个新 bundle identifier 仍没有 provisioning profiles。未签名归档不能安装，也未包装成假可安装 IPA。 |

原生测试结果：XcodeBuildMCP `test_sim_2026-10-21T10-24-55-960Z`，11 passed / 0 failed / 0 skipped。结果保存在本机 XcodeBuildMCP result bundle，不将测试日志／数据库提交到 Git。

运行期间发现并修复：Swift 6 让未标 Sendable 的音频 tap 回调继承主线程隔离而崩溃；后续轮次播放状态不更新；旧回调干扰新播放；静音恢复前可能短暂上传输入；欢迎语早于音频初始化到达。真机 Voice Processing I/O 与模拟器 HAL 不同，模拟器明确绕过 VPIO，不伪装为已验证真机 AEC。

仍有 Xcode 运行时的短暂 QoS priority inversion 提示，出现在音频引擎启停路径，没有被当作零性能风险；需要在真机通话时检查连接／恢复是否有可感知卡顿。未发现本轮回归的功能失败。

## 实际画面

以下均是本地无模型协议服务，不能当作和真实 V 通话或真人音频听验的证明。

![原生通话页，本地协议测试](evidence/call-simulator.jpg)

![真实系统灵动岛展开并静音](evidence/dynamic-island-muted-simulator.jpg)

![模拟器锁屏活动](evidence/lock-screen-simulator.jpg)

## 尚未通过的门槛

1. 团队 Account Holder 接受最新 Apple Developer Program License Agreement，随后生成主 App 与扩展 profiles、签名导出并实际手机安装。
2. 完整的 [真机接受矩阵](ACCEPTANCE.md)，尤其操作按钮、锁屏冷启动、强退后恢复、真实音频／插话、耳机、系统来电和蜂窝切换。
3. 使用本人的真实入口走一次原生 App → 现有 V 服务 → 真实工具／后台任务的授权验收。

没有合并、没有部署 Voice、没有重启 Gateway、没有上架 App。网页首页与正式发布登记保持原版本事实。

最终签名接入复核：2026-10-21 18:26（Asia/Shanghai），执行实际 development 归档脚本仍返回 No Accounts / 缺少主 App 与扩展 profiles；物理 iPhone 仍为 unavailable。可重复检查的未签名产物位于本机 `ios/build/VVoice-5030248-unsigned.xcarchive`，其检查结果 signed=false、profilesPresent=false。未生成或宣称可安装 IPA。

真机接入后续：用户指定使用 Tianyi iPhone 17 Pro。设备现已连接（iOS 27.0.1），额外模拟器下载已跳过，用户已在构建所用 Xcode 27.1 完成 Apple Account 登录／验证；重新执行签名安装脚本后，Apple 返回 PLA Update available。当前必须由团队 Account Holder 在 Apple Developer 接受最新协议后才能继续生成 profiles。只记录设备型号和系统版本，不提交 UDID、账号或凭据。
