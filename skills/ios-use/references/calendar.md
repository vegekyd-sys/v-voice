# iPhone 系统日历

calendar.create：payload title、body（可省略）、start、end、timeZone。起止用带 Z 或显式偏移的 ISO8601；timeZone 为 IANA 时区（例如 Asia/Shanghai）。结束晚于开始、最多31天。直接写入用户系统默认可写日历；不接受模型指定账户、邀请人或任意日历 ID。

calendar.query：payload start、end、可选limit（1..20，默认20）；最多31天，读取系统授权可见日历，返回 truncated 提示。它与飞书日历不同；用户说“日历”但目的不明确时结合当前上下文，必要时澄清。

本轮请求 EventKit full access，因为包含查询与写后读回。设备真实状态可能为 not_determined、write_only、full_access、denied、restricted。需要首次授权/升级且后台时等待用户回到前台；系统弹窗由人类确认。denied/restricted 不循环申请，不换工具绕过；可告知到系统设置更改。

create 只有 eventkit_written_readback（保存成功、按 ID 重新读取、核对标题/正文/起止）才算完成。query 需要 eventkit_query 与实际条目。两者都不证明 iCloud 同步；未知结果不自动重新创建。本轮不支持删除、修改、参会邀请、重复规则。
