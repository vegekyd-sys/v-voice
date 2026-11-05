# V Voice CLI

`v-voice` 是可组合的产品管理客户端，Node >=22、零第三方依赖。通过 Voice 服务私有 Unix socket 管理自己的入口和链接；不访问 Gateway 凭据，不修改原有真人入口、App 绑定或设备。服务端保存对象、绑定、授权范围、期限、撤销及幂等日志。候选验证已完成；本次经用户授权随 `voice-entry-cli.20261027.1` 发布，实际生产状态见 [发布登记](releases/voice-release-20261027/release.md)。

## 能力盘点与归属

| 当前能力 | 已有来源 | 本次补齐 |
| --- | --- | --- |
| 固定私有电话 | `conversation-entries`、旧 `scripts/phone.mjs`；共享个人身份，启动时加载 | 保留原路径；CLI 不复制或向别人导出固定身份 |
| 群/DM 动态入口 | `feishu-conversation-directory` 编码 account/chat；`feishu-phone-login` 和现有 Gateway actor-scoped resolve | CLI 创建、查询及绑定邀请目的地；实际账号/成员准入仍由原路径核验 |
| 独立访客、Public 工具 | `createUnidentifiedPhoneDirectory`、`createPublicVoiceGateway` | CLI 新建隔离 guest 上下文，授予有期限、可撤销的浏览器访问 |
| 网页授权、状态、拨号 | `createVoiceAccess`、既有 H5 `#access`、HTTP/WS | 复用 cookie/签名与原电话页；每次请求检查 CLI 授权；不新增付费拨号命令 |
| iOS 设备绑定 | `ios-bindings`；已认证 principal 的设备凭据 | 原能力保留。临时 CLI guest 授权禁止转成独立长效设备凭据 |
| 管理操作 | 旧脚本只改本机私有静态 JSON | 新增私有 socket、持久化、命令自发现、幂等、JSON/退出码、作用域检查和回读 |

本轮不新增 Gateway RPC、actor 类型、账号工具权限、Worker 策略或 Feishu 核心逻辑，也不要求 App/音响升级。属于 Voice 内部、沿用现有准入接口和 Public 权限的入口管理，先在隔离 Candidate 验证；不占用共享 VLab、不合入平台 dev。未来若扩展到平台身份授权，必须独立平台 PR 和共享 VLab 验收，不能通过本 CLI 伪造 actor。

## 安装及服务身份

源码运行：

```sh
node bin/v-voice.mjs capabilities
node bin/v-voice.mjs --help
node bin/v-voice.mjs links --help
node bin/v-voice.mjs links create --help
```

独立包（只含 CLI、合同、使用说明和 Skill，不含服务、媒体或私有状态）：

```sh
node scripts/package-cli.mjs /absolute/new-private-package-directory
npm pack /absolute/new-private-package-directory --pack-destination /absolute/private-output
npm install --prefix /absolute/private-install /absolute/private-output/versa-v-voice-cli-0.1.0.tgz
/absolute/private-install/node_modules/.bin/v-voice capabilities
```

启用服务管理面需要一次正常 Voice 发布，以及明确的生产接入授权。运行用户创建持久目录和运行目录（均 mode 0700），然后为现有 Voice unit 配置以下环境：

```text
VOICE_CLI_REGISTRY=/absolute/private-state/voice-cli.json
VOICE_CLI_SOCKET=/absolute/private-run/voice-cli.sock
```

服务要求已配置 HTTPS origin/basePath；guest 必须是该服务已有且已启用的 Public 服务。管理面只监听 socket（mode 0600），不监听管理 TCP 端口，不接收网络 bearer 或浏览器身份。V 通过其**现有执行 OS 用户**访问；该用户必须与 Voice service 用户相同，或由现有受信任运维方式切换到该用户，不能把 socket chmod 为公共。`status` 返回 service UID 和 `cli-managed-entries-only` 权限说明。这是本地服务管理身份，不代表某个飞书用户。

注册表按 Voice 节点独立，`doctor` 返回实际 origin/basePath；V 的本机 socket 应指向 web/iOS Voice 服务。两节点发布同一产物不表示管理状态自动同步；不要将一份 registry 复制成两个在线写入者。未配置这两个环境变量的节点不启用管理面。`cli_` 是受管入口保留前缀，启用前发现原固定入口占用该前缀时会拒绝启动管理器，避免遮盖既有入口。

设置 `V_VOICE_SOCKET` 后 Agent 可自主组合命令，不需要逐步点击确认。精简使用说明位于 `skills/voice-cli/SKILL.md`；需按 V 自己的技能管理方式安装，开发请求不自动修改生产 V 技能目录或全局 PATH。

同一 registry 只允许一个服务写入；新版本/第二实例不得争抢 `.lock` 或 socket。启动崩溃留下锁时，先确认原进程及路径归属，按本次运维授权处理自己的残留，不盲删。注册表包含服务签名密钥，应作为私有环境数据备份，不能入 Git、共享记忆或发布 artifact。临时文件 fsync、原子 rename 成功后才发布内存状态；写入失败不授予新权限。

## 命令与完成凭证

`--help` / `-h` 默认显示中文可读帮助，包含命令表、用法、必填/可选参数、范围、示例和退出码。支持根级 `v-voice --help`、分组 `v-voice links --help`、单命令 `v-voice links create --help`；不带命令或仅输入分组时也显示对应帮助，无需网络/凭据。`--help --json` 保留结构化帮助，`capabilities` 始终返回完整 JSON 参数规范。

实际操作与错误始终输出一行 `{"schema":"v-voice-cli/v1","ok":true,"result":...}`；失败输出 `ok:false,error:{code,message,next,exitCode}`，错误也走 stdout，便于 Agent 直接消费。`--json` 可显式写出，但操作结果不依赖这个参数。帮助在连接前返回。

| 命令 | 用途 |
| --- | --- |
| `capabilities`, `status`, `doctor` | 自发现、服务 readiness、模型可用性、系统身份和配置诊断 |
| `entries list/create/get/bind/disable` | 管理 CLI 自己的对话入口和 account/chat 绑定 |
| `links create/list/get/export/revoke` | 授权/邀请、列表、期限、回读、恢复私有输出、撤销 |
| `auth check --id LINK_ID` | 服务端当前有效性、授权范围及撤销语义 |
| `sessions status --entry ENTRY_ID` | 绑定、惰性会话和该入口活动计数；不读取会话正文 |

每个副作用都需 `--request-id`；相同 ID + 相同命令/参数返回相同对象，响应标记 `replayed`。相同 ID + 不同参数返回冲突。`links create` 的 `--out` 是本地交付位置，不影响服务幂等键。响应包含 `result.entry` 或 `result.link` 的服务端回读快照：ID、时间戳、绑定、scope、state、active。已撤销/过期不会通过重放恢复。

退出码：0 成功；2 输入/本地路径错误；3 管理传输不可达（副作用可能已到达，先回读）；4 对象不存在；5 权限/可用模式拒绝；6 冲突/容量；7 服务/存储不可用；8 结果未知或副作用已完成但交付/清理待恢复。错误提供下一步，不打印原始网络异常、凭据或完整链接。

当前有界容量：256 个入口、1024 个链接、4096 个请求日志。TTL 60–86400 秒。达到容量明确失败，不淘汰仍有效授权或自动删除用户上下文。关闭入口不可再开启；需要新上下文时创建新 ID。需要持久大规模运营时另行设计审计/保留策略。

## 可组合示例

下列只展示 fixture 对象，不包含真实访问链接：

```sh
export V_VOICE_SOCKET=/absolute/private-run/voice-cli.sock
mkdir -m 700 /absolute/new-private-links
v-voice doctor
v-voice entries create --id test-conversation --kind guest --request-id entry-20261027-test
v-voice links create --entry test-conversation --ttl 600 --request-id link-20261027-test --out /absolute/new-private-links/test.url
# 从结果 JSON 取 result.link.id：
v-voice auth check --id LINK_ID
v-voice sessions status --entry test-conversation
v-voice links revoke --id LINK_ID --request-id revoke-20261027-test
v-voice auth check --id LINK_ID
```

同一 guest 入口的各授权共享该入口访客上下文；不同入口相互隔离。收件人不应该共享上下文时必须创建不同入口。持有链接者获得该访客上下文和现有 Public 能力；不是个人账号工具或来源群历史。Public 记忆/后台任务沿用原有服务政策，不在 CLI 重写策略。

```sh
v-voice entries create --id team-invitation --kind feishu --account CONFIGURED_ACCOUNT --chat oc_fixture --request-id team-entry-20261027
v-voice entries bind --id team-invitation --account CONFIGURED_ACCOUNT --chat oc_otherfixture --request-id team-bind-20261027
v-voice links create --entry team-invitation --ttl 3600 --request-id team-link-20261027 --out /absolute/new-private-links/team.url
```

Feishu 目的地只允许服务自身已配置 account。CLI 不从 chat ID 推断某人有权限，邀请链接跳转已有账号确认页；收件人以自己的身份通过 Gateway。已生成过链接的入口不能重新绑定，避免静默换会话。`actorVerified:false` 和 invitation `active:true` 可以同时出现；有效邀请不是账号授权成功凭证。

## 撤销、过期与回滚

guest grant 在 HTTP/WS 解析和工具调用时检查有效性；撤销/关闭立即拒绝后续请求及旧 cookie，结束该授权的活动通话；正在准备的 reservation 在返回前再检验并清理。过期立即阻止新请求；现有通话由 15 秒维护定时器结束。不会追溯撤销已完成的工具副作用、删除上下文或自动取消已被其他服务接受的后台任务。

Feishu 链接是**登录邀请**。撤销仅阻止此邀请继续跳转，不撤回通过独立官方登录/设备授权已经获得的权限。CLI 不签发“成为 Tianyi”或“继承别人工具账号”的 bearer。需要操作真人授权时使用对应已有授权产品路径，并另行验证 actor/account/session。

仅关闭 CLI socket 不等于撤销已签发链接。需要停用时先逐项 revoke/disable 回读，再走正常发布/回滚。回滚到不识别 `cli_` 的旧服务会拒绝 CLI 链接；原静态/Feishu/iOS 数据未修改。registry 应保留，防止后续恢复旧备份而意外恢复已撤销权限；恢复必须使用最新私有 registry。

## 验证入口和后续接入

```sh
node --test tests/voice-cli.test.mjs
node scripts/voice-cli-demo.mjs
```

演示实际启动隔离 Voice + 私有管理 socket，spawn 真实 CLI 新建入口/链接，通过 HTTP 授权并检查 scope，撤销后再次验证失败。Gateway/模型是禁止真实调用的 fixture；没有产生通话、消息或账单。服务进程重启、跨入口、ID 冲突、输出恢复、写失败和撤销竞态由回归覆盖。

V OS-runtime 安装/调用验证、浏览器 Candidate、实际 V Agent 使用、真人飞书确认、真实音频、合入 CI 和生产双节点启用分别记录在 Candidate 验收文档。正式接入仍须按 `docs/UPDATE-GUIDE.md` 从合入源码统一发布，并核对首页正式日志、CHANGELOG 和版本登记；本轮用户已明确授权安装 V CLI/skill 与生产发布，实际运行回执见上述登记。
