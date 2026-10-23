# 飞书自动会话电话：候选实现

日期：2026-10-23。状态：本地候选，尚未合并或部署；不代表双真人、飞书客户端或真实音频验收。

## 交付范围

会话入口编码只包含 bot account 与 chat ID，不包含 caller、sessionKey、权限或访问凭据。OAuth 保留 PKCE/S256，服务器只保留加密身份 cookie；用户令牌不持久化。

`conversations:true` 时，Voice 将已确认身份交给 Gateway，由 Gateway 按现有飞书文字聊天 ingress、成员资格、路由、owner、群和 sender 工具策略决定可用会话。静态旧入口保持原配置。动态入口的 caller、访问 cookie、通话记录按真人与会话分开。

每通电话拥有自己的 Gateway 包装器。历史、原生/直接语音、工具、后台任务、飞书同步与通话报告通过该包装器执行。个人日历、飞书 CLI 快捷读和个人工具环境不会注入动态会话电话。权限判断在 Gateway，浏览器与模型不能提供身份或权限。

Gateway 改动在 `v-openclaw-platform` 的同名独立分支，不在本仓复制 runtime。必须同时具备 actor 协议 v1 的平台候选才能启用；旧 Gateway 拒绝未知请求时不会回落到个人连接。

全新会话尚无 transcript 时，以 Gateway 原生飞书路由再次确认精确 session/account/agent，允许现有原生通话处理器创建该会话；不接受浏览器 key，也不使用任意 `allowMissing`。如果文字配置仍将不同人的 DM 路由到共享 main/其他 peer alias，则拒绝开放动态电话，避免扩散个人上下文。

## 配置契约

现有私有 `VOICE_FEISHU_LOGIN_FILE` 增加 `conversations:true` 和精确 `accountId`。`appId/appSecret` 必须对应这一个飞书账号及 OAuth 应用；可继续保留旧 `actors`。实际值只保留在私有配置中，本文不提供真实标识或凭据。

动态会话当前使用飞书 Web/H5，不展示或签发原生 App 绑定。topic/ACP 以及无法明确确认的路由拒绝接入，避免静默采用另一个上下文。GPT 原生委派要求支持可信 actor 的语音 provider；旧内部 `chat.send` 兜底会拒绝动态 caller。

## 已验证

- 本地 HTTP fixture 覆盖两个 OAuth subject、两个群，检查签名 RPC、浏览器传入身份/会话无效、跨账号/跨群 cookie 拒绝。OAuth provider 使用 fixture，不是第二个真人。
- 目录测试覆盖四个 actor×group 组合的 caller/访问密钥隔离、重启后的加密 cookie 与权限撤销。
- 原生后台任务测试确认可信 senderId、senderIsOwner 和飞书账号上下文传给现有 consult SDK，另一个 actor 无权读取任务。
- 接入事故修复 PR97/98 后，最终 Voice 全部 Node 测试通过 **818 项**（18.15 秒）；代码提交 `abdb43d765c11ecfd3a822cfa7ec03732a4ed081`。本次仅追加本文的最终验收记录。
- 平台提交 `50e31d6861275604c869a07119a76daf263f0193` 的 10 个产物 hash 与最终 Candidate receipt 完全一致。`candidate-347d99c1-c0b2-47cf-a53a-726ab34b8da7`：**23/23**，实际测试 12.56 秒、服务器总耗时含独立快照约 54 秒；共享 PID 前后均为 `1958174`，`sharedUnchanged:true`。

## 尚未验收

第二个真人账号尚未提供。双真人 OAuth、两个真实群与两个私聊的原生事件、实时权限撤销、三种模型真实音频/打断/重拨、手机麦克风及真实工具账号边界均未验收。没有自动拨号、付费模型请求、飞书发信或生产修改。

涉及 Gateway 身份/工具协议，因此最终需要共享 VLab 集成验收。当前仅使用可丢弃 Candidate，不占共享 lease、不重启共享 Gateway。合并由 Tianyi 决定；共享集成结束后按 VLab 规则回滚或经另行授权推广，不能将未完成候选留作新基线。

已 rebase 到包含 PR97/98 的 main，保留显式已登录入口直接渲染、原生麦克风提前准备及静态电话的 `sessions.describe({key,...})` 快速严格检查。没有恢复每次拨号全表 `sessions.resolve`。

本候选尚未发布，因此未将能力写入首页已发布 changelog。正式发布前必须同时更新首页 `changelog.mjs`、`CHANGELOG.md` 与版本登记。
