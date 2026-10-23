# V Voice 首次 TestFlight 内测

2026-10-24：1.0.0 (33)，源码 `f2a495d`，PR #116/#118 与主线 CI `40001732925` 通过。Apple 后处理 COMPLETE、构建 VALID，内部状态 IN_BETA_TESTING。`V Voice Internal` 包含本构建和唯一内部测试员 Tianyi，Apple 回读邀请状态 INVITED。未提交外部测试审核或 App Store 正式发布；尚未观察用户从 TestFlight 实际安装。

稳定基线仍为 [build 32](../../ios/stable-baseline-build32.md)。150 个原生 App/Core/Shared/Widget 源文件逐文件与 af6c0da 一致；本次打包新增必需原因 API 声明、WebRTC 相机说明和构建号，并同步已合入主线的 H5 更新日志。相机说明不启用相机，当前版本仅使用音频。没有重新执行或宣称新的真人音频验收。

首次上传成功后被 Apple 后处理以 90683（缺少 WebRTC 相机用途说明）拒绝，修复后同一 build 33 重传，原失败包和日志保留。最终分发目录 `/Users/tianyicai/v-voice-releases/ios/build33-testflight-20261024-r2` 含 App Store 签名 IPA、Xcode archive、源码、原生逐文件一致性记录和回执。预编译 WebRTC 缺少 dSYM 导致符号上传警告；不阻止分发，但限制该框架崩溃定位。

加密问卷按 WebRTC 使用标准加密、当前不在法国分发填写；将来扩大分发地区须重新核对，不能把当前内测声明直接当作法国上架声明。本次内测不提供公开邀请链接。

首页用户可见日志已在 build 32 发布时核对，描述实际交付的连续播放和打断改善；本次仅调整分发与元数据，不新增音频能力。服务器运行版本与其他并行发布单独登记，本任务没有重启或重新部署服务器。

见 [机器可读回执](release.json)。
