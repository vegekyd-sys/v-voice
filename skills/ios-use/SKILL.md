---
name: ios-use
description: 使用当前通话 iPhone 的苹果应用能力处理备忘录、系统日历和提醒事项；需要可信当前设备上下文与在线执行器。用于苹果应用操作，不用于飞书日历、邮箱或跨设备控制。
---

# iOS Use

先读本任务服务注入的当前端、能力状态及设备请求入口。仅使用当前通话绑定的 iPhone；能力声明不授予身份权限。没有可执行入口、已拒绝或设备离线时准确说明，不换账号、设备或委托绕过。

按本次任务读取对应参考，不一次加载全部：
- 苹果备忘录新建/追加：[references/notes.md](references/notes.md)。
- iPhone 系统日历新建/查询：[references/calendar.md](references/calendar.md)。
- 提醒事项新建/查询：[references/reminders.md](references/reminders.md)。

执行时使用任务 descriptor 提供的 cli 路径：`node /exact/server-provided/device-call.mjs <operation> '<payload JSON>'`，把完整服务端 descriptor JSON 作为 stdin 输入；不要自行拼接 endpoint 或 lease，不把 descriptor 输出、分享或记忆。通过此受限入口只传 operation 与动作参数。模型不得自行构造 actor/session/device/权限、快捷指令名或目标账户；请求身份与生命周期由服务验证。仅做用户明确要求的动作，保留用户已给授权，无需逐次重复确认。

系统需要前台/解锁/首次授权时等待同一请求继续，不重拨。收到真实完成证据才报告完成；系统交接、写入、读回和云同步分别表述。超时/断线/unknown 可能已写入，先检查，禁止自动重写。前端已执行的动作直接消费结果，不由后端再做一次。
