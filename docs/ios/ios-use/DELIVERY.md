# ios-use 候选交付（2026-10-25）

PR [#133](https://github.com/vegekyd-sys/v-voice/pull/133)，分支 `codex/ios-use-20261025`；依赖位置公共层 PR #134。未合入、未正式上线。签名 App 与独立服务产物源码为 `ac140707070af8a54c23ca6256c16c5b3acedb02`；后续 PR 补充 DEBUG/测试隔离、交付证据及产品文案/Skill 调整；后续内容未重建安装为 build36，也未替换正在运行的 ac140 服务产物。

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

Tianyi 明确回复手机“已空闲”后，2026-10-25 已安装 build 36，安装前后 devicectl 分别确认 build 34/36；没有卸载 App。现有 Keychain 绑定按原机制保留，随后用户回复“已解锁”，打开候选绑定页成功；Tianyi 确认“已绑定”，服务端收到同次新建的一条设备 grant。此安装不等于体验接受。

build 34 回退 IPA：`/Users/tianyicai/Documents/Codex/2026-10-25/vvoice-public-candidate/export/VVoice.ipa`，SHA256 `40c81cc83edcac6e33fb894a158bcc127129b05a38a821c7667082eeccc74641`。不在本候选覆盖正式已接受版本登记。

本轮主线待完成：日历/提醒事项真实系统授权、真实语音新建/查询及真机前后台/锁屏音频连续性。Notes 配置与真实新建/追加改为选配实验，不作为本轮主线接受门槛。尚未自动拨号。最初因 Locked 打开失败，解锁后重发单次链接并完成绑定；未绕过锁屏。系统可能要求解锁/切前台；不得把 fixture 或模拟器通过写成这些真机项已通过。总控决定最终合入和正式上线。

具体 hashes、检查和证据路径见 [validation.json](validation.json)。历史 Notes build 26、build 35 产物保留，均未安装到手机。

## 一次性快捷指令模板（待真机接受）

新增可复现生成器 `ios/scripts/make-apple-notes-shortcuts.py`，不把个人签名文件、输入正文、token 或设备信息放入源码。Mac 系统实际导出确认 Notes 创建 action 为 com.apple.mobilenotes.SharingExtension、文本读回为 detect.text；模板显式 OpenWhenRun=false，正文只能由实际 Note 输出进入读回核对，不直接回显输入。追加模板导入时要求固定一个本机 Note，不让模型传 note ID。

Apple 官方 CLI 的 people-who-know-me 签名成功；文件仅在私有 `/tmp/vvoice-ios-use-shortcuts36`。本机导入“V 新建备忘录”成功，字典/创建/读回/输出动作可见，但核对动作在 Mac 显示未知且带意外 WPS Office 标签，原因尚未确定，不能推定可用。已有“灵动岛拨给 V”在该 Mac 也提示需更新 V Voice，但这不足以解释新动作的标签。已请求在 build36 iPhone 打开编辑页，等待真实动作识别；尚未运行写入、未验证 iCloud 同步，追加模板也未接受。一次系统“任何人”导出报 NSURLErrorDomain 500，失败保留，不把 CLI 签名当功能验收。

## 产品方向纠正：原生能力与统一权限为主线

收到总控同步的用户纠正后，停止催促 Notes 导入/配置，也不新增按操作拆分的快捷指令。当前默认主线是已实现的 Calendar/Reminders EventKit 执行器和统一权限页：各能力首次完成系统授权，此后通话中直接新建/查询。已打开 iPhone V Voice，只请求用户确认这两项系统权限，尚未自动拨号。

本路亲自读取 [Apple DTS 2026年1月答复](https://developer.apple.com/forums/thread/813810)：iOS Notes 没有 CRUD API，App Intents 可让用户组合本 App 与 Notes 动作，不能直接调用其他 App 动作来绕过 API 缺失。[EventKit 官方文档](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)覆盖日历和提醒事项。Grok 原帖 https://x.com/bot/status/2113393684209176718 本路访问同为403，没有其原生直控 Apple Notes 的真机证据；不把 Reminders 混同 Notes，不据转引截图扩大实现范围。

后续源码已把权限页和 Skill 明确为 EventKit 主线/Notes 选配，quick_validate 通过；当前手机与服务器仍是已核验 ac140 产物，不能声称后续文案已在 build36 交付。所有 Notes 代码和本地签名实验材料保留，当前开关未启用、没有实际 Notes 写入。
