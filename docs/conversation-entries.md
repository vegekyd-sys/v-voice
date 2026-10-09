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

## 配置独立电话

管理员在自己的私有目录保存注册表；不放进 Git，不把个人入口凭据写入终端输出。下面的名称和会话均为示例，不代表已上线的第二个入口：

```sh
npm run phone -- add \
  --entries /private/path/voice-entries.json \
  --id phone-room-a \
  --session agent:makaron:feishu:group:oc_example \
  --account existing-feishu-account --kind group \
  --gateway-config /private/path/openclaw.json

npm run phone -- list --entries /private/path/voice-entries.json

npm run phone -- link \
  --entries /private/path/voice-entries.json --id phone-room-a \
  --origin https://openclaw.tianyi.live \
  --out /private/path/phone-room-a-link.txt
```

`add` 只用 operator.read 连接 Gateway，执行 `sessions.resolve` 核对完整 key，不创建聊天或通话、不发送消息、不调用工具。不存在、被重定向或无法确认的会话拒绝写入。已有注册表须为 0600 的普通文件；使用排他锁和原子写入，锁冲突不抢占，外部修改不覆盖。`link` 只写新的 0600 私有文件，终端仅返回路径，不显示访问凭据。可指定 `--gateway-url` 为已有本机转发或 TLS Gateway；生产转发仍只用 `ssh v`。

注册表文件里的来源账号仍是元数据，`sessions.resolve` 验证存在性与精确 key，不证明其他来电者有权调用个人工具。添加入口也不会自动发布它：服务启动时加载 `VOICE_ENTRIES_FILE`，运行中的映射不热替换，切换服务须等现有通话空闲。配置新入口后，每次拨号在创建媒体前重新确认对应真实 session；保持旧 `/voice/` 本人入口的启动路径不变。

## 独立工作区与验收

本任务分支为 `codex/session-phone-binding`，只负责入口映射、配置工具及通话 owner 生命周期。头像和 UI 展示分别由其他任务维护，不修改图片、样式或头像选择策略。

Candidate 需用两个真实、已授权的飞书群/DM 验证：背景上下文不同且不串话；三个模型承接相同服务端 key；两个不同会话可并行；同会话第二台设备不能夺取 owner；挂断重拨仍回到原历史 session；旧 SDP、旧后台结果不能进入新通话。HTTP/WebSocket fixture 通过与真实通话验收分别记录，不将配置工具的 read-only 验证当作真人验收。
