# iPhone 位置 → 当前 V 后台任务（候选）

2026-10-23，基于 `origin/main` `5aa8708`，分支 `codex/voice-ios-location`。这是未合入、未部署、未安装真机的本地原型。用户已明确 V 有滴滴 MCP，本候选只负责提供位置，后续出行对话复用原 V 后台任务。没有安装或替换滴滴能力，没有真实叫车或付费模型测试。

## 已实现的路径

1. iOS 继续使用现有个人绑定认证的 `/api/session`，额外声明 `nativeLocationVersion: 1`。仅现有 PCM relay 路径（SeedDuplex / Grok）协商该能力；旧客户端、网页、音箱和 GPT WebRTC 不声明这个工具。
2. 当前用户明确要求使用当前位置时，语音模型调用 `get_current_location({})`。Voice 服务通过已经绑定当前 call 的 relay 发 `device.location.request`，包含独立 UUID、当前 `voiceSessionId` 和 25 秒截止时间。位置不是身份凭据，不能增加 Gateway 或工具权限。
3. 原生唯一 `CallCoordinator` 执行 Core Location 的一次请求，最长 20 秒。系统首次授权只申请 When In Use；后台且尚未授权返回 `needs_foreground`，没有强行唤 App、申请 Always 或持续追踪。
4. 原生返回 `latitude`、`longitude`、`capturedAt`（Unix 毫秒）、`horizontalAccuracyM`、`coordinateSystem: WGS84`、`accuracyAuthorization: full/reduced`。原生与服务都拒绝非法坐标、负精度、超过 30 秒或未来超过 5 秒的采样；reduced 或误差大于 100 米标为 approximate。
5. 新任务用 `delegate_to_v({question, use_current_location:true})`；已有 V 任务用 `openclaw_agent_control({mode:"steer"|"followup", text, use_current_location:true})`。服务端将自己持有的新鲜位置附入现有任务的 context 或 text，沿用已有 `voice.product.task.start/control`，不让模型抄写坐标，也不重建任务/会话核心。
6. 任务控制的 `queued:true` 仍只表示原任务接受了条件，`applied:false` 不冒充已应用或已打车。位置缺失/过期时拒绝带位置的委派；无关任务不自动携带位置。

原生只做设备执行，不添加 Swift 的打车关键词、provider 路由或工具授权判断。H5、远程资源更新、音频 owner、Action Button Intent、Live Activity / 波纹 / Reaction 保留原路径。

## 边界

- requestId、call ID、版本、截止时间及 native call generation 必须同时匹配；重复请求不再次取点。挂断、失败、暂停或重连会取消原生请求；服务关通话清理 broker。其他通话和迟到回执不能进入新通话。
- 位置是当前认证通话设备的**报告值**，不是硬件防伪证明。此候选没有新增设备认证或多账号权限。客户端自报 native 能力也不授予身份。
- broker 只在当前 call 内存中保留最多 30 秒的有效位置；新定位失败会清掉前一个有效值。没有位置数据库、持久缓存或自动长期记忆写入；`get_current_location` 的交付审计不记录原始坐标。
- 为执行用户要求的位置任务，模型工具上下文以及 V 后台任务文本会包含位置；它们仍经过已有模型/任务系统及既有记录机制。因此“没有新增长期记忆写入”不等于“全链路零留存”，也不承诺能阻止模型从用户原话中复述位置。
- 设备坐标不等于实际上车点；近似位置仅适合附近查询。WGS84 必须由 V 按现有地图/滴滴工具的实际坐标要求处理，不能改标签当作 GCJ-02，也不能凭定位直接下单。车型、报价、上车点、目的地和下单确认仍由 V 现有对话处理。
- 失败区分 denied、restricted、services_disabled、needs_foreground、no_live_activity、timeout、unavailable、stale、cancelled。失败时不借历史位置补全。

## 验证与未完成项

- Node 全量：749 项通过，含位置到当前语音工具、现有 V 后台任务的 start / steer 接口与真实接受回执合同（mock Gateway / mock 模型，不是生产 V）。
- Swift Core：37 项通过。
- 原生全量：78 项执行，77 通过，1 项实际后台测试按显式 opt-in 跳过。随后位置专项复验见 `location-validation.json`。
- 系统定位：独立 iOS 26.5 模拟器，预先授予该候选 When In Use，并通过系统 API 注入非个人测试点。真实 Core Location 返回新鲜采样，经过真实 native relay / Voice broker；共用 H5 可见回执断言通过。见 [定位回执截图](location-evidence/foreground-receipt.png)。这不是实体 iPhone GPS 或真实 V 业务结果。
- 无 WK 页面、逻辑 background 的原生请求与挂断取消通过；外部脚本再尝试把 App 切到系统设置时，UIKit 只报告 `inactive` 而不是要求的 `background`，因此该实际后台断言失败。没有将这次尝试记录成后台通过，也没有据此判定 iOS 必须打开 App。
- 尚未验证：首次系统授权弹窗、真实 reduced accuracy 开关、物理 iPhone 后台/锁屏按需定位、长通话、真实语音模型选择此工具、真实 V 收点与出行对话。没有覆盖安装手机，避免覆盖“苹果应用协同”候选或打断现有通话。

Apple 提供 [后台位置说明](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)；[WWDC23 Core Location](https://developer.apple.com/videos/play/wwdc2023/10180/) 说明 Live Activity / background activity 与 When In Use 的关系。这些是平台路径依据，不替代当前实现的真机验收；当前仍采用一次 `CLLocationManager.requestLocation()`，并以实际结果与超时为准。

## 环境选择与后续验收

本次只改变 Voice 内部的 native ↔ Voice 协议，沿用既有绑定认证和 Gateway task start/control 参数，没有 Gateway、Worker、actor 权限或会话核心改动，因此在独立 Candidate 验证。若需要 V 在后台主动反向索取设备位置、或扩展 GPT Gateway 工具协议，另开平台 PR 并遵循共享 VLab lease。

复现使用独立模拟器、fixture 端口 29957/29967，不占 29837/29847。普通自动测试不打开真实或付费通话。源码文件与测试分别是 `DeviceLocation.swift`、`DeviceLocationTests.swift`、`device-location.mjs` 和 `session.test.mjs`。

下一步是真机候选窗口：先核对当前安装版本、其他 chat 的候选和现有通话，再由用户发起定位任务，逐项检查首次授权、前台取点、已授权后退后台/锁屏新取点、拒绝/近似位置和取消；随后确认 V 的真实任务收点回执。不需要先实现新的滴滴对接。生产与安装版本登记 `versions.json` 继续保留实际 build 24；本候选不占新发布号。正式发布前再更新首页 `changelog.mjs`、版本登记并走主线发布流程。
