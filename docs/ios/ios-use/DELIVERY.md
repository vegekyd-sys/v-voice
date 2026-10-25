# ios-use 候选交付（2026-10-25，进行中）

基线：origin/main ab8ad23；分支 codex/ios-use-20261025。保留历史 Notes 候选 3b33f9d，历史 build 26 不安装到手机。当前主线 build 33，本路独立准备新 Candidate；实际安装后单独登记证据，不合入、不上线。

## 建议模块接口（位置线公共薄层接入点）

- 统一 wire envelope 使用位置线负责的 version=1、requestId、voiceSessionId、operation、deadline；本模块参数放 payload，回执使用 status 与 evidence。actor/session/device 由已认证服务端注入，模型不传身份、设备或权限。
- 建议操作名：notes.create、notes.append、calendar.create、calendar.query、reminders.create、reminders.query。
- JS 模块导出 validateIOSOperation(operation,payload)、iosUseCapabilities(snapshot)、createIOSUseAdapter({request,capabilities})；request({operation,payload},callId,signal) 由公共层提供，模块不另设设备注册中心。
- iOS IOSActionsCoordinator 接收有界设备请求，复用 AppleNotesCoordinator 作为 Notes 子模块，EventKit 子模块负责 Calendar / Reminders；退出 owner 时全部失效。
- 后端 ios-use Skill 仅一个顶级入口，按 Notes / Calendar / Reminders 加载 references。公共层提供当前通话的受限请求入口，Skill 脚本只调用此入口，拒绝/离线/超时不换身份、不换设备、不自动重写。
- Notes 历史 requestID/nonce/expiresAtMS 是模块内部快捷指令关联字段；对外公共 envelope 转换使用 requestId/deadline，不要求公共层复制 Notes 协议。

## 公共文件影响

CallCoordinator.swift（挂载执行器、接收帧、能力状态、owner 清理）、CallSettings.swift（本机授权设置入口）、H5CallView.swift（Notes 系统回调）、Info.plist / DebugInfo.plist（EventKit 用途说明）、project.yml / 生成工程、session.mjs / server.mjs（仅公共模块接入）、scripts/package.mjs（模块与 Skill 产物）。不修改音频 owner、灵动岛实现、H5 表现策略或平台 Gateway 核心。

## 完成证据约定

- Notes：system_handoff 不是成功；只有用户配置快捷指令从实际 Note 读回并验证，才 reported_written_readback。不是独立 Notes 数据库或 iCloud 同步证明。
- Calendar / Reminders：系统授权状态来自 EventKit；save 返回后按持久化 ID fetch，核对实际字段，才 written_readback。不给 iCloud 同步结论。
- unknown 不自动重试；权限 denied/restricted 明确返回，不委托绕过；需要前台只挂起原任务，恢复后继续，不重拨。

## 待补验收

真实后端 Candidate 加载 Skill 与设备请求；模拟器 EventKit 实际写读；本路自行准备并安装独立真机 Candidate，负责 Notes、锁屏/音频连续性和系统授权验收（安装前核对其他线路/通话避免并发覆盖）。总控负责最后合入及上线。

## 已对齐位置线（首轮）

读取 `docs/capabilities/shared-device-contract.md` 后采用 `device.request` / `device.result`、`arguments`、公共终态 `ok/denied/failed/cancelled/unknown`。模块内部 completed 在 wire 上转换为 ok。nativeDeviceActions 为 `{version:1,capabilities:{operation:{status}}}`；Notes disabled -> unavailable，EventKit not_determined/write_only -> prompt，full_access -> available，denied/restricted -> denied。

JS 导出 `iosUseOperations()` 适配公共 `operations` map：validateArguments / validateResult / timeoutMS / sideEffect。公共层已按建议传本次 arguments；本模块 adapter 为无状态，可对本次写后字段与 Notes digest 核对。

iOS `IOSActionsCoordinator.receiveFrame(frame, voiceID, owner, foreground, protectedData, isCurrent, send)` 对接公共 envelope；对非本模块操作由位置线分派。`capabilities` 返回本路操作状态字典；位置线与定位合并。`resume` 在 scene/protected-data 恢复时继续；`invalidate` 在 owner 结束时调用。位置线拥有 server/session/backend/fast-dial 公共接入，本路暂不复制其公共文件。

公共 helper 已采用位置线的 `scripts/device-call.mjs`：服务注入 endpoint/lease/cli 的 descriptor，stdin 传 descriptor，argv 仅 operation/args。不添加本路 broker。复用了位置线提交 0fa055c 的三个公共模块（本分支 cherry-pick 为86c9bba；总控集成时应去重），后续公共服务接入以位置线提交为准。

模拟器第一轮：EventKit 实际 calendar create/query 与 reminders create/query 均已通过，按 ID 读回并核对，测试最后删除自身创建的合成条目。权限由本路隔离 simulator 的 simctl grant 设置，仅证明模拟器系统权限已给，不是 iPhone 人类授权。旧 Notes 专用 wire fixture 测试与新公共协议不兼容，正在迁移，不把该失败记为完成。


## 服务接入还需保留的约束

- 前端只声明一个 `ios_use` 工具，操作枚举来自本通话已声明且未拒绝的 iOS 能力；后端 Skill 共用公共请求入口。`iosUseTool` 接受标准 operation->status 字典。
- `iosUseOperations()` 现在为无状态 map；本次 arguments 由公共层传入 validateResult，不保留跨通话闭包。
- common session 的 `deviceOperations` 已由位置线支持 factory；本路采用无状态 map 或每通话 factory 均可。
- tool.call 审计对 ios_use 的 title/body 只记录操作名与字节数，避免将备忘录正文放入通用工具日志；不回传快捷指令本地 token。
- 本机 `capabilities` 在前台恢复时读取系统状态；公共层需把新的状态刷新给双方模型。执行前仍重新检查系统授权，不以旧声明代替权限。
- 旧 AppleNotesFlowTests 的手动 supplemental 路径仅作历史回归；语音设备请求回执直接返回公共工具通道，不能再作为用户 steer 重复交给后端。
