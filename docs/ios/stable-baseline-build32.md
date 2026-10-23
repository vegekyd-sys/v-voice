# iOS 稳定基线：1.0.0 (32)

2026-10-24，Tianyi 在真人使用后确认当前连续播放与打断体验良好，并明确要求将此版记为稳定基线、保留回滚包，后续改动不得损害当前打断体验。

- 固定源码：`af6c0da95fd21eacfba1a5a842cc5f7b7f492b4d`，标签 `ios-stable-build32-20261024`。
- 正式签名 IPA SHA256：`ee494eb0b728ad31f1643288639459e4739407eb385fb798ff51a57fa1152511`。
- 持久回滚目录：`/Users/tianyicai/v-voice-releases/ios/build32-stable-20261024`。包含 IPA、Xcode archive、源码 tar.gz、服务器产物、发布回执和逐文件 `SHA256SUMS`；378 个文件已回读校验。
- 当前开发签名 profile 有效期至 2027-10-21；之后可使用归档/源码重新签名，不把过期 IPA 当作仍可安装。
- 服务器对应双节点产物哈希：`4dd30ee38d2b92d97b47054b78bf94d4545040156c2abc84a04bff3d9e2b9963`。H5 revision：`a89662ddd8fa274af7ed60cdece1cf04d61f22b1077c8ceccc676fb530c76e93`。

## 后续改动的验收要求

涉及音频采集/播放、VPIO、打断策略、分类器、语音事件解释和传输调度的修改，必须与此基线比较。保留原包并在候选环境验证，不覆盖稳定基线标签或回滚目录。

1. 核心打断状态机及共享服务到原生集成回归通过，保留忽略后续播、识别后淘汰旧尾音和过期事件保护。
2. 真机运行 `testQuietShortSpeechClassifierOnPhysicalDevice`、`testPhysicalSpeakerPlaybackDoesNotSelfInterrupt`、`testLiveConfirmedInterruptionAndContinuousPhysicalPlayback`，分别覆盖短/轻声输入、物理回声、持续播放与完整打断改答。付费模型和录音边界按当前用户授权执行。
3. 使用相同输入、音量和实机条件报告暂停延迟、误暂停、排队音频游标停滞；禁止为了通过而放宽断言。基线受控记录为连续渲染 16.020 秒、0 次误暂停、0 ms 有缓存停滞、约 817 ms 本地暂停（轮询 837 ms）。这些观测不是所有网络/远场条件的保证。
4. 用户真人体验验收与自动测试分开登记；涉及体验变化，发布前取得相应实机验收。不能仅凭测试通过将新版本替换为已接受稳定基线。

仅打包/签名/元数据变更可用 App/Core/Shared/Widget 源码逐文件比较证明音频实现未改；build 33 TestFlight 分发不自动改变 build 32 稳定基线。

## 回滚

先在回滚目录执行 `shasum -a 256 -c SHA256SUMS`。客户端覆盖安装已保留的 build 32（不卸载，不清空绑定）；签名失效时从归档重新签名。服务如需回退，按 `docs/unified-release.md` 对双节点执行受控回滚，等待通话空闲并保留 Gateway、私有配置和绑定数据。客户端回滚与服务器回滚分别记录实际结果。

详见 [正式发布回执](../releases/ios-responsive-interruption-20261024/release.json) 和 [实机证据](responsive-interruption-build32.md)。
