# 苹果备忘录

仅 notes.create / notes.append，payload 为 title、body（title <=240 UTF-8 bytes，body 非空且 <=8000 bytes）。用户说“记下刚才的想法”时按对话整理正文；无须让用户打开 App 选内容或点写入。

需要当前 iPhone 的 Notes 快捷指令一次性配置并启用。append 目标由用户在快捷指令固定或系统选择，不能传任意 note ID、快捷指令或账户。没有全量 Notes 查询 API，也不宣称得到 Notes/Mail 全部访问权限。

执行路径：设备 → 系统 Shortcuts → 实际创建/追加 Note → 从实际 Note 获取文本 → V Voice 核对动作 → 系统回调 → 原请求回执。打开 Shortcuts 只算 system_handoff。只有匹配本次标记的 user_configured_shortcut_readback 才能说“快捷指令报告已保存并读回”。该依据依赖用户配置正确，不是独立 Notes 数据库或 iCloud 同步证明；把输入回显给核对动作不能验证真实写入。

返回 denied/failed/cancelled/unknown 均不得说已保存，也不自动重写。需要 foreground 时让用户解锁并回到当前 V 通话，已有请求自动继续。
