# 日程授权与服务选择发布

用户已批准 PR #155 合入上线，并要求上线后验证。版本 `voice-calendar-consent.20261027.1`。

发布范围为共用 Voice 提示与后台交接规则，沿用原 Gateway 接口和账号权限，无原生 App/固件更新。网页/iOS 和机器人/音响两个节点使用同一已合入、CI 通过的产物，通过统一发布工具等待空闲后切换，保留原服务、私有环境与回滚版本。首页更新日志同步发布。

候选验收见 [候选记录](../../acceptance/calendar-consent-20261027.md)。生产实际版本、双节点回执、Gateway 身份及首页验证在完成后登记。真实模型语音遵循和完成播报时机不由静态/fixture 检查代替；本次不修改完成后的播报时机。

运行范围：本次两个 Voice 服务切换使小何/SeedDuplex 和 Grok 使用新规则。GPT Live 的对应源码已随 PR 合入，但生产 Gateway 插件固定加载旧产物；本次按 Voice 发布不重启 Gateway 的边界保留，不能把产物中包含新文件当作 GPT Live 已加载。

## 上线结果

- 2026-10-27T12:31:59+08:00 两个 Voice 节点切换完成：`7ce20a2de22bedba1cc32086d5f832a44539cd8c`，240 个文件，filesSha256 `720fbf7a4960144a742c314465dd4d39e7aee86cf9b830efa9e2f4f751f5b1af`。
- 两节点 ready、无发布 hold，原私有配置保留，Gateway PID/Invocation/config hash 均未改变；旧版本 `ab8d078dd2937c303ab1eb0008b62fc5a4b8d309` 保留作回滚。
- 合入 main CI 通过。两个实际运行目录均通过小何/Grok × phone/speaker 四组规则组装检查，并核对后台请求与未确认身份边界；没有发起模型请求。
- 生产浏览器原会话可正常进入“可以拨号”，首页显示本次更新。公开入口初始化后 ready，线上 changelog 与 iOS UI revision 文件逐字匹配已发布 artifact。首次无入口 cookie 的资源请求被正常拒绝，未绕过鉴权。
- 无真实日程写入、确认卡发送、付费通话、新原生安装或刷机。真实语音遵循、物理设备听感及完成结果的播报时机仍未验收。
- GPT Live 对应源码已合入，但 Gateway 插件仍固定加载前一产物；此项不标记为运行生效。

![生产首页更新日志](homepage-updates.png)

脱敏验证见 [verification.json](verification.json)，正式登记见 [release.json](release.json)。原始运维回执仅保留于私有发布目录。
