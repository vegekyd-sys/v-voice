# iOS 绑定同步飞书身份 — Candidate

旧绑定保存了飞书 tenant/open ID，但没有姓名。动态会话在 App 请求时从设备凭证恢复身份，缺失的姓名因此无法进入模型来电人上下文。另外，现有 App 会复用同一 URL 的已保存凭证；此前不同账号在同一会话生成相同 URL，重新绑定可能继续使用旧身份。

本次在已验证浏览器生成绑定时，为同账号、同会话的有效设备凭证补齐 `displayName` / `userId`。不修改 actor ID、授权范围、有效期或已撤销凭证。新 URL 按会话和已验证账号区分；同账号姓名变化不改变 URL。旧 URL、旧 Cookie 和旧凭证继续兼容。

此改动属于 Voice 设备绑定与来电人资料保存，继续调用既有 Gateway admission 和 actor-scoped 接口，不修改 Gateway 的身份判定、工具权限或跨服务协议。在本任务独立 Candidate 验证；不写共享 VLab 配置或重启 Gateway。生产和实体手机尚未验收。

验证：

- 全套 Voice 测试 898 项通过；包括真实 HTTP 和 WebSocket 接口的 mock 上游回归。
- 生产形状旧凭证在更新资料后，Grok / 小何 reserve 和 GPT caller context 均收到服务端验证的姓名；客户端伪造姓名/账号不被使用。
- 旧 Cookie、重启后持久化、有效期不延长、已撤销凭证不恢复、跨会话拒绝、旧入口映射保持有效。
- 访客 → 飞书、Alice → Bob 生成不同的原生目的地址，Cookie 名称与现有 App 的验证规则一致；各自恢复自己的身份。
- 网页构建及 iOS H5 shell 同步通过。没有修改 Swift、音频、打断或固件；没有真实付费拨号。

旧用户需在飞书页面打开一次「iOS App」生成绑定，再在 App「验证并绑定」。此前仅有账号 ID 的绑定无法凭空补出飞书未返回的姓名。
