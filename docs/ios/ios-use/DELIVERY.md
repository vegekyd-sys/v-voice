# ios-use 候选交付（2026-10-25）

PR [#133](https://github.com/vegekyd-sys/v-voice/pull/133)，分支 `codex/ios-use-20261025`；依赖位置公共层 PR #134。未合入、未正式上线。签名 App 与独立服务产物源码为 `ac140707070af8a54c23ca6256c16c5b3acedb02`；后续 PR 提交仅补 DEBUG/测试隔离与交付证据。

## 产品与执行边界

通话中的明确指令由 V 整理成有界参数，经当前认证通话发送给这部 iPhone 执行。一个 `ios-use` Skill 按需读取 Notes / Calendar / Reminders 参考；前端只有一个 `ios_use` 工具。身份、设备、入口与 lease 来自服务，不由模型传入。

操作限定为 notes.create/append、calendar.create/query、reminders.create/query。Notes 走一次配置的系统快捷指令；Calendar/Reminders 走 EventKit。没有全量 Notes/Mail 读取权限，不支持任意账户、任意 note ID、删除或修改既有日历事件。

公共 wire 为 device.request/device.result version=1，含 requestId、voiceSessionId、operation、deadline、arguments。统一协调器检查 owner、期限与重放，Notes 子模块保留本地 token 验证；退出 owner 后原请求失效。需要前台时保留原请求，恢复后继续；未知写入不自动重试。

Notes 只有从实际 Note 读回、匹配本次正文摘要与标记的 user_configured_shortcut_readback 才报告快捷指令已保存并读回；交接或输入回显不算。EventKit 保存后按持久化 ID 读回并核对字段才报告完成。两者都不是 iCloud 同步证明。

## 当前验证

- Node 全量 925/925，相关公共服务 127/127；Swift Core 6 XCTest +48 Swift Testing。
- 原生 11/11，完整 xcresult Passed：真实 HTTP reservation、production provider adapter（mock upstream）、认证 relay、模拟器 EventKit 保存/持久化 ID 读回；包括 Calendar/Reminders 新建查询、Notes 生命周期 fixture。raw device.context 回归已进入同组测试。
- 实际系统授权 UI 1/1：后台查询等前台，选择 TCC“允许完全访问”，原请求继续、无新增拨号。
- 最终撤权 UI 1/1：iOS 以 TCC 终止 App 后原 socket 结束，重开不自动重拨。早期“撤权仍保活”错误断言的失败保留在 `/tmp/vvoice-ios-use-refresh-ui.xcresult`；不据此承诺撤权后连续通话。
- DEBUG fixture 按每轮 UUID 隔离 Keychain，并只自动启动一次，避免测试重开造成误判；Release 不包含这些路径。
- 私有后端 Candidate `candidate-99daae26-fec3-4d08-8d37-5aa70c9dcf1a`：实际 OpenClaw embedded +配置的 DeepSeek，发现并读取 ios-use/Notes 参考后发出一次 notes.create；设备 fixture 故意 unknown，后端如实报告未知。sharedUnchanged=true，关闭 channels/cron/worker，不证明生产 Worker 或真机写入。

协商过的 ios_use 操作目录稳定，权限快照在同一通话按 revision 刷新；每次执行仍检查当前系统权限与 owner。首次授权可继续原任务，恢复授权不重放旧请求。公共 device.context 解码保护为独立 `bbb07cd`。

## build 36 与独立 HTTPS Candidate

IPA `ios/build/export/VVoice.ipa`，SHA256 `fa9206fdda3cac08fecc273e9317e5eeb776bca1028b49a1f92226f79f6f7391`；archive `ios/build/VVoice.xcarchive`。独立解包核验 arm64、签名/profiles、正常 TLS、原 7 个通话 Intent + VerifyAppleNoteIntent（需设备认证）、无 DEBUG fixture。包含既有 GPT WebRTC 运行库不代表支持 GPT 设备动作；当前 GPT 设备动作未接通。

服务包 `/tmp/vvoice-ios-use-server36`，237 文件，filesSha256 `a934eb312f57744b99e1d106e7621cb84ae8490ecfa80dc9ba723eb99b230625`。V 上独立路径 `/var/lib/v-voice-candidates/ios-use-20261025`，端口 29485，独立 service/tunnel。TLS、release 资产一致性、ready/空闲以及服务用户读取 artifact Skill/helper 均已核对。没有切换生产、重启 Gateway 或写共享 VLab。

同机 artifact 路径可读不证明跨主机 Worker 可读；正式跨主机部署仍须核对后端对应版本资产。日志不保存备忘录正文或通用 function_call_arguments，私有绑定与令牌不进仓库。

## 真机现状与未完成项

Tianyi 明确回复手机“已空闲”后，2026-10-25 已安装 build 36，安装前后 devicectl 分别确认 build 34/36；没有卸载 App。现有 Keychain 绑定按原机制保留，候选服务一次性绑定仍需真实确认。此安装不等于体验接受。

build 34 回退 IPA：`/Users/tianyicai/Documents/Codex/2026-10-25/vvoice-public-candidate/export/VVoice.ipa`，SHA256 `40c81cc83edcac6e33fb894a158bcc127129b05a38a821c7667082eeccc74641`。不在本候选覆盖正式已接受版本登记。

待完成：候选绑定确认、一次性 Notes 快捷指令配置与系统授权、真实 Notes 新建/追加、真实语音、真机前后台/锁屏音频连续性。尚未自动拨号。候选绑定页的实际打开被 iOS 因 Locked 拒绝，正等待用户解锁；未绕过或视为绑定成功。系统可能要求解锁/切前台；不得把 fixture 或模拟器通过写成这些真机项已通过。总控决定最终合入和正式上线。

具体 hashes、检查和证据路径见 [validation.json](validation.json)。历史 Notes build 26、build 35 产物保留，均未安装到手机。
