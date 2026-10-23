# 会话电话：通话纪要与 iOS 绑定候选验收

2026-10-23；候选版本 `voice-session-call.20261023.6`。运行源码 `aea116f7534ea2d47e6abf2d3b84c688a8fe7098`，主干已同步至 `5aa87088339f3c8604e666d4c2de3c204c28830f`（PR #86 / iOS build 24）。仅隔离 VLab 候选；未合入 main、未发布 TestFlight、未部署正式 V。

## 交付行为

- 群电话在语音提供方准备好后发一张「正在通话 · 00:00」状态卡，采用 12px 灰色注释文字、紧凑宽度和无标题设计。仅创建预约、未连接媒体的操作不会发通知。
- 通话中按实际接通时间持续更新计数；目标刷新间隔 1 秒，网络较慢时只保留一个在途更新、不累积排队。挂断时清除计时器、等待在途更新结束，再原地更新同一消息 ID 为「通话已结束 · 总时长」，不再新增结束通知；随后发简短总结卡片。总结卡去掉时长和提问次数，由 V 以“我把刚才电话里关于……的要点整理一下”自然开场，像助理纪要一样用第一人称归纳关键认识、结论与下一步，建议不冒充已确认决定。摘要与飞书网络操作不阻塞音频收尾。摘要使用服务端 xAI `grok-4.7`，无工具、无执行能力；45 秒超时会保留完整对话并明确说明未生成摘要。
- 卡片按钮打开受原会话登录保护的完整对话页，包含时间、时长、摘要和逐轮文字。被打断的输出标注为被打断；旁聊判定移除对应内容。不同入口无法读另一个入口的记录。
- 已核实并实测既有 Gateway 的 authenticated operator `tools.invoke` → `message.edit` 接口。状态卡编辑使用服务端创建的原始回执、固定账号和群目标；不接收模型或浏览器传入的 messageId，也不修改 Gateway 权限或运行代码。发送路径会规范化字体样式，因此先发送无标签的文字卡，再用同消息编辑应用完整样式；快速挂断时直接更新为结束态。完整对话仍由受保护网页承接，不宣称已实现卡内折叠。
- 群内通话不再逐条刷问答卡。私聊和旧个人入口保持既有问答同步；后台任务晚于挂断完成时，仍按原问题另行同步最终结果。
- 飞书电话网页新增「绑定 iOS App」指引、一次性链接、绑定设备列表及解除绑定。链接 5 分钟有效、一次使用；兑换后 App Keychain 保存该会话的 90 天设备授权，服务端只落盘哈希。会话配置、入口密钥或身份授权变化会使设备授权失效。
- iOS 设置显示绑定会话名称，兼容旧链接和旧 Keychain。换绑失败不覆盖旧绑定；绑定期间不会被 Action Button 并发拨号覆盖。修复了 SwiftUI Form 中粘贴和验证按钮互相触发的问题。

## 计时与纪要验证证据（.5；.6 增量验收见后文）

| 路径 | 验证结果与边界 |
| --- | --- |
| .5 源码自动化 | 本轮全量 `npm test`：802/802（`66c6e52`）；最后仅放宽后台摘要等待上限的 `c67957f` 通过受影响生命周期、回复与 HTTP 入口测试 35/35。iOS 内置页面一致性检查通过。新增同消息更新、延迟发送后立即挂断、编辑重试与失败、旧新总结上下文解码覆盖。 |
| iOS | Core 39 项、模拟器 XCTest 6 项、真实 HTTP 5 项通过。独立模拟器真实粘贴/输入候选链接后成功绑定群，App 重启后保留；重用已消费链接被拒绝，旧绑定保留。 |
| 同一 Keychain 授权 | 实际 HTTPS GPT session reserve → close 成功；服务端创建、关闭审计均指向预期群会话。没有麦克风申请、SDP 或媒体连接。 |
| 实际部署语音 | `88da220` 候选运行 Grok、SeedDuplex 各一通合成中文音频；均识别问题、输出音频、落盘逐轮对话、真实模型摘要并发送飞书卡片。挂断 HTTP 分别 8ms / 4ms；授权详情 200，未授权 401；收尾后活动/创建/后台任务均为 0。 |
| 最终摘要与卡片 | `c67957f` 用既有天气文字重放并实际运行 44.635 秒的状态生命周期（不是新音频通话）。31 次编辑均确认同一消息 ID，从 00:01 递增到 00:44，结束后保留 44 秒；零报告错误。真实 `grok-4.7` 9.293 秒完成带助理式开场的总结，共新增状态和总结两条消息。桌面客户端截图确认计时递增、结束时长与新总结。 |
| 实际用户入口 | 飞书桌面客户端看见卡片，点击按钮走真实 OAuth 回到原通话；右侧内置浏览器显示最终详情和绑定指引。 |
| .5 发布安全 | 当时产物 218 文件逐个校验，文件清单 SHA-256 `2e5286786987dbadb2358319ad79bebd3be19f8583b86794662182dafa882c70`；仅重启本任务候选 Voice 服务，Gateway InvocationID 不变。备份旧源码和私有配置，保留回滚。 |

真实 UI 验收发现并修复原生按钮串触发、网页绑定入口与更新日志重叠；关闭弹窗后过期的请求不会重新打开或覆盖后来的弹窗。早期摘要把建议写成结论，最终改用更明确的提示词和 `grok-4.7`，并把结束提示与较慢的摘要分开。最终重放脚本以 root 创建的单条测试记录最初无法被服务用户读取，已将该测试文件归属校正为候选服务用户；普通语音流程的记录本来就由服务用户创建，真实通话详情已验证可读。

本机证据目录：`/Users/tianyicai/Documents/Codex/2026-10-22/session-pr/outputs/`：`call-timer-replay-evidence.json`、`call-timer-deploy.json`、`call-timer-running.png`、`call-timer-ended.png`、`call-timer-summary.png`、`call-timer-changelog.png`、`call-refine-replay-evidence.json`、`call-refine-deploy.json`、`call-card-before.png`、`call-card-after.png`、`call-status-start.png`、`call-refine-changelog.png`、`call-live-evidence.json`、`call-final-replay-evidence.json`、`call-final-deploy.json`、`ios-reserve-close-audit.json`、`call-report-detail.png`、`ios-binding-web-guide.png` 与 `ios-session-binding/` 截图。证据不包含绑定 token 或设备密钥。

摘要评估中两次请求触及原 20 秒上限；成功请求耗时约 9–18 秒，延迟波动明显。后台摘要等待上限改为 45 秒，状态结束更新仍先执行，音频收尾不等待摘要。超时仍保留明确的摘要不可用提示与完整记录，不把超时视为成功。

## 个人入口与通用化结论

保留个人会话与原链接作为兼容入口，不删除已有历史或令现有设备失效。新用户路径统一为「从已授权的飞书/H5 会话生成链接 → App 绑定该会话」。原个人会话不是新 App 的特殊必选路径。当前候选仍只开放原有已授权试点身份；没有扩大同事、家人或其他群成员的权限，也没有替换既有会话工具权限。

## 后续验收边界

- 真实 iPhone 麦克风、连续多人对话和 TestFlight 分发不在本轮已完成证据内。
- 生产仍等待用户验收后另行安排；本轮不合并、不正式发布。

## 免重复授权、群消息并发与 iOS Deep Link · 2026-10-23 追加验收

- 候选源码 `aea116f7534ea2d47e6abf2d3b84c688a8fe7098`，218 文件 SHA `aaa488bc873d8accc67d9c01773d5a3fb9a664c9a5eae804db3ea52158be5277`。仅重启隔离电话服务；Gateway InvocationID 未变，切换前通话/任务均为零。保留 source-before-login-binding-20261023 回滚产物。
- 原登录 session 仅存于内存，更新服务后必然丢失。改为经认证加密的 30 天浏览器凭据，只保存身份与到期时间，每次请求重新核对服务端 actor/phone 配置；OAuth access/refresh token 不保存。真实浏览器首次刷新已有授权后，重启候选服务，再打开 `/voice/feishu?phone=...` 直接回到主页，无授权页。不同浏览器、清 Cookie、到期或密钥轮换仍需登录。
- Grok 实际媒体连接并发核验：`e5b4c721-3f8d-49df-a837-7df089ed8134`。在电话已连接时，以用户身份从真实飞书群发送测试消息；同一个 session 的历史收到用户消息及群内回复。电话期间没有新增群消息语音/字幕事件，继续发言后同一连接输出 91,680 字节语音，正常关闭 HTTP 200，心跳均 200，无错误。本轮通过真实 provider 的文字输入触发语音输出，未采集真人麦克风。
- 首次脚本遗漏客户端心跳，触发 45 秒无心跳回收并导致续聊超时，不能计为通过；补齐网页同款 15 秒心跳后重跑成功。失败证据保留。
- 共享 session 的含义：电话建立时读取最近历史；普通群消息仍走飞书消息链路，不会自动注入正在进行的语音上下文，也不等于 steer。后台事件按该电话拥有的 run 过滤；本次实测覆盖普通群文字回复并发，未声称覆盖后台长任务的所有排队场景。
- 网页右上角灰字 `iOS App` 与更新日志对齐，弹窗提供已安装/未安装两条路径；真实下载链接允许 TestFlight 或 App Store，当前未发布，明确显示下载即将开放。
- 网页生成的 `vvoice://settings/bind` 经 iOS 系统打开 App 设置，短期链接自动填入；用户确认后才验证。已绑定相同会话时用现有授权校验并复用，实际模拟器显示「已绑定这个会话，可以直接开始通话」，不重复消费一次性链接。设置页打开不会自动拨号；旧 Keychain 及手动绑定兼容。原生改动需要后续 App 升级，网页更新不能给旧 App 增加 Deep Link 能力。
- 验证：服务全套 804/804；登录/设备绑定 11/11；iOS SessionBindingTests 5/5；Swift Deep Link 解析 1/1；当前源码模拟器构建启动成功。Core 测试曾发现嵌套 URL fragment 被提前解码，修正后通过并完成真实系统跳转。
- 多用户：当前候选只有一个登记来电身份，Gateway 工具调用仍使用已认证服务连接；不把放开网页登录等同于接入同事的工具身份。用户明确「多用户可以先不验证」，本轮保持单用户，不将其计为开放或验收通过。
- 私信标签页：官方接口按 chat_id 添加，支持 group/p2p；当前实现是显式安装，未自动覆盖每个用户。未来自动补齐可由用户进入机器人私聊事件触发，幂等安装对应会话入口；必须同时正确处理来电身份，不能统一指向 Tianyi 私聊。
- TestFlight：用户要求本轮验收通过后发布；当前尚未上传/发布，不虚构邀请链接。

官方依据：[添加会话标签页](https://open.feishu.cn/document/server-docs/group/chat-tab/create)、[用户进入与机器人的会话](https://open.feishu.cn/document/group/chat-member/event/bot_p2p_chat_entered)、[网页应用免登](https://open.feishu.cn/document/client-docs/h5/development-guide/step-3)。2026-10-23 直接读取官方 Markdown。

本机证据：`outputs/login-binding-deploy.json`、`outputs/login-binding-home.png`、`outputs/login-binding-modal.png`、`outputs/ios-binding-existing.png`、`outputs/group-concurrency-evidence.json`、`outputs/group-concurrency-first-probe.json`。不提交聊天正文、账号配置或短期绑定凭据。
