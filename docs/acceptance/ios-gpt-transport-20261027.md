# iOS GPT Live One：共享会话传输字段候选修复

状态：Candidate，未合入、未部署、未上传 TestFlight。基线 `b4ed555cd3171534a9a57067b5bb8a1936ba0a34`，独立分支 `codex/ios-gpt-live-one-fix`。

## 当前事实与复现

2026-10-27 20:08–20:13（上海时间）只读核对：网页/iOS 节点运行 commit `b4ed555cd3171534a9a57067b5bb8a1936ba0a34`，release socket 报告 ready=true。已绑定入口 status 列出 GPT Live One（`gpt-live`、available=true、nativeTransport=webrtc）与小何（gateway-relay），默认小何，nativeDialVersion=1。设备节点本轮未重新读取；下午双节点回执不是本轮设备状态证明。

App Store Connect 实查最新为 1.0.0 (39)，VALID、未过期，内部和外部均 IN_BETA_TESTING。没有读取用户物理 iPhone 的安装版本。Build 32 仍是已接受的连续播放/打断基线。

GPT Live One 的服务器模型为 `gpt-live-1-codex`，声音 `sol`，由已有 `v-voice-gpt-live` provider 提供 WebRTC；不是根据 UI 名称推测。Public/身份未确认会话原有 GPT 禁用边界保留，本次不扩大权限。

确定缺陷在 `lab/gpt-live-h5/server.mjs`：服务验证 Gateway reservation.transport=webrtc 后，向客户端投影时只保留 voiceSessionId/model，遗漏 transport。Build 39 及当前 CallCoordinator 均先判断 webrtc，否则要求 gateway-relay + relayTicket；因此已创建的 GPT 会话被原生端以 protocolMismatch 拒绝并关闭，尚未进入 SDP、收音或播放。

新增测试使用真实 createLiveH5Server 返回结果，而非手写 session 响应。在未修的共享服务上，它确认 selector 能力存在、创建 1 个会话、关闭 1 次，但无法进入 offer；修复后同一测试通过。以前 fixture-server.mjs 手工返回 transport=webrtc，因此旧测试没有覆盖这个遗漏。

## 改动与边界

共享服务保留已验证的 transport 字段；返回体依旧不含 clientSecret、offerUrl、sessionKey 或工具身份。原生 CallCoordinator、GPTLiveTransport、VoiceAudio、豆包播放器/打断和 H5 bridge 源码实现均未改。补充候选首页日志导出；基线部分内嵌 Reader 产物落后于既有 H5 源码，已用现有脚本同步资源并重建浏览器/iOS bundle，未修改其界面源码。两项资源一致性检查通过，重建后 GPT 7 项和 H5Shell 9 项复验通过。Gateway/Worker、身份授权与跨服务协议没有变化，故在隔离 Candidate 验证，不占共享 VLab。

GPT 专项实现与 build 39 的 GPTLiveTransport、VoiceAudio、CallOptions、GPT 字幕及挂断核心逐文件相同；当前 CallCoordinator 相对 build 39 只增加入口展示/切换辅助方法。候选测试使用当前源码构建，未把当前模拟器构建当作 build 39 实机验收。服务端修复应可供现有 build 39 使用，仍需相应真机通话验收。

## 验证

- Node：`npm test` 1,002/1,002；最终服务/hosted 定向回归 52/52。
- Swift core：45/45。
- iOS NativeFlowTests：38/38，包括连续播放、响应退休、迟到旧音频、挂断/重拨、音频恢复和 H5 桥。
- H5ShellTests：9/9，包括可信 frame、凭据隔离、过期控制拒绝、模型选择、字幕和 H5 重载。
- GPTLiveTransportTests：7/7，包括真实共享 HTTP 服务 → 原生 owner → SDP → 两个真实 WebRTC peer；双向 440 Hz 合成 PCM 实际渲染、字幕、静音/恢复、关闭 owner；另覆盖 H5 reload/报告、取消迟到 offer、静默上下文确认和返回 PCM 后端。
- 新增测试首次批量运行因本地 fixture 残留旧 offer 失败；已在新建/关闭会话时清空 offer 并退休待答复请求，重启 fixture 后 GPT 全组 7/7 通过。未放宽断言。
- XcodeBuildMCP 构建、安装和启动成功。专用 iOS 26.5 模拟器 `E93DA989-926D-4F9C-A475-B251E4AD68AD`；serve-sim 在 Codex 右侧实际显示该模拟器画面。

原始测试产物保留本机 XcodeBuildMCP workspace `~/Library/Developer/XcodeBuildMCP/workspaces/v-voice-c87ed68b3d40/`。失败复现：`test_sim_2026-10-27T12-04-28-584Z_pid72171_6c19228f.xcresult`；修复后完整 GPT：`test_sim_2026-10-27T12-08-22-512Z_pid72171_82257d00.xcresult`。不提交日志或音频。

复跑：先启动专用模拟器，再执行 `VVOICE_SIMULATOR_ID=<UDID> ios/scripts/test-native.sh`。脚本启动本地普通、共享豆包和共享 GPT 三个 fixture，并传递端口。共享 GPT fixture 不接模型服务，只由本机测试提供 SDP 与合成音频。

## 待决定的发布方案与真人步骤

1. 审阅并合入本分支；将 `IOS_GPT_TRANSPORT_CANDIDATE_UPDATE` 中实际交付的修复整理进 VOICE_UPDATES，移除候选验收措辞；同步 CHANGELOG 与正式 release 登记并重建静态资源。
2. 按 unified-release.md 用同一份已校验 artifact 发布双节点，等待空闲再切换，保留现有私有配置、旧产物与回滚回执；不重启 Gateway。候选通过不构成上线授权。
3. 真人先确认手机实际 build，使用已有已绑定会话选择 GPT Live One；拨号后确认接通、首句、持续收音/播放、字幕、静音恢复、轻声打断后不续播旧句、锁屏/回前台、挂断/重拨；随后切小何验证连续播放和打断。权限仍按当前绑定账号核验。
4. 付费模型通话须另获当前人类授权；本轮没有连接真实模型、没有采集原始音频。未进行物理麦克风/扬声器、蓝牙、蜂窝网络、真实 GPT、物理 Action Button、锁屏音频或多账号验收。

本轮没有执行合入、线上切换、TestFlight 上传或 Gateway 重启。无需为这一个共享响应修复新增原生功能；是否重发 App 应结合其他已审阅原生改动单独决定。
