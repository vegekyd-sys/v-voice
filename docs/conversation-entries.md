# 一个飞书会话，一个电话

电话沿用已有 Feishu 群/DM 的 Gateway session；拨号仅新建媒体连接与 voiceSessionId。不同 session 可并行，同一 session 的两个入口/两台设备不能替换彼此；SSE、relay、后台任务与头像日志仍按实际通话 owner 分流。

私有 `VOICE_ENTRIES_FILE` 为记录数组（此处全部是假数据）：

```json
[{
  "id": "phone-room-a",
  "agentId": "makaron",
  "sessionKey": "agent:makaron:feishu:group:oc_example",
  "accountId": "existing-feishu-account",
  "kind": "group",
  "callerId": "tianyi",
  "permissionProfile": "personal-tianyi",
  "accessToken": "replace-with-a-unique-server-side-random-token-at-least-32-chars",
  "disabled": false
}]
```

`accountId` 在本阶段用于记录映射来源，不会切换飞书 CLI 账号或授予权限。第一阶段限同一人的会话；配置其他 caller/agent/profile 会明确拒绝。sessionKey 由运营者从真实 Gateway 会话查询获得，不能从群 ID 猜 DM key。会话历史读取仍是最近上下文，不代表所有闲聊文字都自动写入 Feishu session，也不会自动向群发消息。

下一阶段的 Gateway 接口必须把以下事实一起确认：真实 session 的 Feishu account/chat/thread、来电者可访问的会话、可使用的工具账号及 redline。不得用此库的 `permissionProfile` 字符串替代 Gateway 授权。不同飞书账号的工具环境与记忆可见范围也要隔离。

验收顺序：本人原入口回归 → 同一人两个真实会话，三个模型路由/上下文/重拨/并发 → 独立他人账号与 DM/群隔离 → 飞书“打给 V”按钮。当前没有新增真实他人电话入口，也没有发送按钮/链接。
