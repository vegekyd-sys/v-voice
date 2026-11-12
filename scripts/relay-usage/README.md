# iOS 主屏「Relay 用量」

打开 V Voice 一次，保存个人入口后，在主屏添加 V Voice 的「Relay 用量」。中号每个订阅显示已用比例最高的有效窗口，大号显示各来源返回的全部受支持窗口。时间使用手机所在时区。窗口重置后等下一次采样，快照满一小时后显示「待更新」。WidgetKit 决定实际刷新时机。

V 的独立定时任务每 15 分钟写入一个权限为 0600 的原子快照。Voice 只读取快照。来源如下。

| 来源 | 读取方式 |
| --- | --- |
| Codex | 现有 Codex Relay 的签名 POST /v1/usage，按其实际窗口时长显示 |
| Claude Code | 以 V 上已登录的 Claude Code 运行只读 get_usage 控制请求，读取五小时和周限额。已在 2.1.280 验证，CLI 接口为实验性 |
| Grok | 现有 Grok Relay 的签名 GET /v1/usage，使用 billing period 的已用百分比和期末时间。Relay 登录失效时此行暂不可用 |
| Gemini | 可选 Scene Gemini Relay 的签名 GET /v1/status，将剩余比例换算为已用比例。未配置显示「待接入」 |
| DeepSeek | 采集器若配置 DEEPSEEK_API_KEY，读取官方 GET /user/balance，否则读取 V Gateway usage.status 的 balance 项。显示账户原币种余额。两个接口都没有今日实际扣费字段 |

服务端仅接受从默认个人入口凭据派生的只读用量令牌。设备授权仍检查到期、撤销和入口变更。App 将令牌与目标地址写入 App 和扩展专用的 Keychain group，删除个人绑定时清理。绑定仍保存在 App 原先的 Keychain group。真机分发时两个 target 均需在 provisioning profile 中启用对应的 Keychain Sharing。

### V 节点配置

正式发布时，在运行个人 Voice 服务的节点从同一发布产物安装采集器及 timer。示例以现有运行用户 openclaw 为准。若安装布局不同，可用 systemd override 调整 EnvironmentFile 和 CLI 路径。

```sh
sudo install -D -m 0755 scripts/relay-usage/collect.py /usr/local/lib/v-voice-usage/collect.py
sudo install -m 0644 scripts/relay-usage/v-voice-usage.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now v-voice-usage.timer
sudo systemctl start v-voice-usage.service
```

unit 使用现有 Codex、Grok、Gemini Relay 的私有 EnvironmentFile，仅向回环地址签名请求。若本机端口不同，可在 root 私有的 /etc/v-voice-usage.env 中配置 VOICE_USAGE_CODEX_PORT、VOICE_USAGE_GROK_PORT。DeepSeek 可在同一文件配置其账户 key。可用 VOICE_RELAY_USAGE_FILE 覆盖 Voice 服务的快照路径，默认 /var/lib/v-voice-usage/snapshot.json。新客户端、Voice 服务和采集器均部署后即可显示真实数值。

停用采集时停止 v-voice-usage.timer。数据停止更新后组件会显示待更新。回滚原生包不影响原有的个人绑定。
