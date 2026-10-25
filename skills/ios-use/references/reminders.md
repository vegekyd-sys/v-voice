# 提醒事项

reminders.create：payload title、可选body、可选due/timeZone；有due时必须同时给 IANA timeZone，due 为带显式时区的 ISO8601。写入用户默认可写列表。reminders.query：可选limit（1..20，默认20）、includeCompleted（默认false）。本轮不支持删除、修改、位置提醒或任意账户/列表选择。

EventKit 需要提醒事项 full access，权限必须来自系统；首次请求可能需前台，人类确认系统弹窗。denied/restricted 不循环申请或绕过。

create 必须 save 后按持久 ID fetch 并匹配正文/标题/到期时间，得到 eventkit_written_readback 才报告完成。query 使用 eventkit_query 实际结果。它们均不证明 iCloud 同步，unknown 不自动重写。
