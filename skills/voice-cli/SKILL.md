---
name: voice-cli
description: 用 V Voice CLI 管理对话入口、授权链接和会话状态。用户需要创建电话入口、生成或撤销链接、检查授权时使用。
---

# V Voice CLI

用现有服务管理电话入口和链接，按任务自由组合命令；不会自动拨号。

## 先看帮助

```sh
v-voice --help                 # 全部命令
v-voice links create --help    # 参数、限制和示例
v-voice capabilities           # 完整 JSON 能力说明
v-voice doctor                 # 服务配置和可用账号
```

通过已配置的 `V_VOICE_SOCKET` 连接服务，也可传 `--socket <绝对路径>`。无需获取 Gateway 密钥或冒用用户身份。

## 选哪种入口

- `guest`：独立访客对话，不带个人账号工具或来源群历史。同一入口的链接共享上下文；需要隔离的人分别建入口。
- `feishu`：指定 `doctor` 返回的 `--account` 和目标 `--chat`。收件人自行登录，Gateway 核验其会话与工具权限；链接有效不等于对方已获授权。

## 例子：生成访客链接

示例 ID 和请求 ID 按本次任务替换。需要复用已有对话时，先用 `entries list` / `entries get` 查询。

```sh
v-voice entries create --id demo-room --kind guest --request-id entry-demo-001
mkdir -m 700 ./voice-links
v-voice links create --entry demo-room --ttl 600 --out ./voice-links/demo.url --request-id link-demo-001
```

从返回值取 `result.link.id`，再用 `auth check --id LINK_ID` 核对范围和有效期。完整链接保存在 `result.link.linkFile` 指向的文件中，按用户指定的收件人交付，不写入普通日志。TTL 为 60–86400 秒，输出文件必须不存在。

不再需要时：

```sh
v-voice links revoke --id LINK_ID --request-id revoke-demo-001
v-voice auth check --id LINK_ID
```

访客链接撤销后原 cookie 也失效。飞书邀请的撤销只阻止继续使用邀请，不撤回对方已独立取得的账号或设备授权。

## 看结果与恢复

- 操作返回 JSON：检查退出码和 `ok`；失败按 `error.next` 处理。帮助加 `--json` 可供程序读取。
- 每次新操作使用新的 `--request-id`；同一次操作重试时保留原 ID 和参数。结果不确定先用 `entries get` / `links get` 回读，不盲目重复创建。
- 链接文件丢失，用 `links export --id LINK_ID --out 新文件` 恢复；查看会话活动用 `sessions status --entry 入口ID`。
