# 苹果应用协同候选

2026-10-25：当前路线扩展为一个 `ios-use` Skill 入口及 Notes / Calendar / Reminders 子模块。实现、公共接口、实际验证与待人类授权见 [ios-use/DELIVERY.md](ios-use/DELIVERY.md)。

历史 Notes 候选保留于 commit 3b33f9d（签名 build 26，未安装、未上线），当前工作基于 main ab8ad23 / build 33。不要沿用历史 build 号作为手机现状。

系统路径依据：

- [Shortcuts URL](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios) 与 [x-callback](https://support.apple.com/guide/shortcuts/use-x-callback-url-apdcd7f20a6f/ios)：系统交接不等于保存，必须从实际 Note 读回核对。
- [EventKit 权限](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) 与 [日历访问模式](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui)：本轮查询及写后核对需要 full access，真实状态来自系统。

没有全量 Notes/Mail 访问权限；没有独立 iCloud 同步证明。权限弹窗由用户确认，模拟器权限和测试不能替代真实 iPhone 授权或锁屏通话验收。
