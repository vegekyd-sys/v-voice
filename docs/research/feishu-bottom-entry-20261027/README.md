# 飞书电话入口统一到底部：可行性调研

2026-10-27；状态：调研完成，尚未实施。只读检查生产与官方资料，未修改菜单、发布飞书应用、重启服务或拨号。

**建议探索私信输入框上方的单个常驻「📞 打给 V」按钮，群聊沿用底部群菜单。飞书支持这一方向；两端使用不同的原生组件，可以统一操作含义和电话页，但不能承诺像素、容器与权限表现完全一致。** 先在独立测试应用验证私信悬浮菜单，保留现有顶部电话标签作兼容入口。外部联系人的实际菜单展示与身份确认必须单独验收。

这次不能只打开一个开关：私信机器人菜单是应用级配置，现有电话标签则逐会话绑定。必须先解决“同一菜单链接准确进入当前来电者和 V 的私信”，避免重新引入固定个人入口。下文的能力支持与项目实现状态分别说明。

## 1. 当前事实与证据边界

| 项目 | 本轮核对结果 | 证据性质 |
| --- | --- | --- |
| Voice 最新 main | fetch 后为 `002313bd66978dc188b5fea898cb0a1a633f8cc9`，PR #155、#156 均已合并 | Git / GitHub 只读 |
| Web/iOS Voice 服务 | `ssh v` 核对运行目录及 0600 发布控制 socket 的 `GET /status`；运行 `7ce20a2de22bedba1cc32086d5f832a44539cd8c`，ready，发布 hold 为 false，进程归属一致 | 当前运行证据，不把 #156 文档提交当运行版本 |
| 双节点与 GPT Live | 既有 [10/27 发布回执](../../releases/calendar-consent-20261027/verification.json) 记录两节点同产物；本轮只重新探测 Web 节点。GPT Live 插件激活状态沿用发布记录：源码合入，Gateway 旧产物，未另行激活 | 双节点旧回执与本轮单节点检查分开 |
| 实际应用 | 生产登录配置与开发者后台确认对应 **V - Makaron** 企业自建正式应用，后台显示当前修改均已发布 | 只读，不复制密钥 |
| 私信机器人菜单 | 后台展开设置时，“关闭”被选中；随后取消编辑，未点保存、未创建版本 | 当前配置；不是平台不支持 |
| 已有私信入口 | 对一个已登记内部私信 GET：`chat_mode=p2p`；一个「📞 打给 V」URL 标签，`is_built_in=true` | 抽样，未遍历全量旧私信 |
| 已有群入口 | 对一个已登记内部群 GET：`chat_mode=group`；一个电话菜单；`common_url` 为会话电话页，`pc_url` 包装 `sidebar-semi` | 抽样，未新建群或菜单 |
| 外部样本 | 本轮未启用测试机器人菜单、未执行外部账号点击 | 不能标记外部菜单、外部免登或真实音频通过 |

脱敏结果见 [evidence.json](evidence.json)。CLI 当前绑定的应用并非生产 V，未切换或改写其 profile；实际配置用既有 Chrome 登录态只读查看，两个真实会话 API 由 `ssh v` 上的既有应用凭据获取应用 token 后只读调用，凭据与原始响应留在主机内。认证 token 的 POST 只用于鉴权；未调用业务写接口。

### 实现来源与历史选择

- Voice [更新指南](../../UPDATE-GUIDE.md#5-身份会话与入口不可混用) 要求覆盖老群、老 DM、新群、新 DM，并保留 actor 权限与外部账号确认。旧文档中的 Tianyi-only 描述不能覆盖后续身份发布。
- [10/26 入口发布](../../releases/entry-release-20261026/release.md) 已交付：群底部菜单、桌面侧栏；私信内嵌顶部页签。477 个入口是当次迁移回执，不能当作本轮重新核对全量。
- [现有入口说明](../../conversation-entries.md#飞书会话入口) 明确记录私信关闭悬浮菜单、改顶部标签。这是此前产品取舍；本次用户重新偏好底部按钮，应重新探索。
- 实际自动入口实现在平台的 [`lab/feishu-phone-tabs.mjs`](https://github.com/vegekyd-sys/v-openclaw-platform/blob/d4486e724425da80adac335e8c2dd327cb5fd047/lab/feishu-phone-tabs.mjs#L110)：群走 `menu_tree`，私信走 `chat_tabs` 且 `is_built_in=true`。该源码模块 SHA256 与 10/26 发布登记的 `6c3b8c2adebf3ce1fd0f47a90cd2fb9d794f499609bae69539f7b610a57912d5` 一致；本轮未重新哈希生产 Gateway 加载模块。
- Voice 内旧手工工具 `lib/feishu-phone-tab.mjs` 仍使用 `is_built_in=false`，群工具也未配置侧栏。它们不是当前生产自动入口的权威实现，后续不要拿旧工具重跑覆盖生产布局。

## 2. 官方能力：私信与群聊分别确认

### 可行性矩阵

“支持”表示官方开放能力；“待验”表示当前项目尚无本轮真实客户端证据。移动端包含 iOS、Android，二者须分别验。

| 会话与账号 | 桌面端底部入口 | 手机端底部入口 | 限制及项目状态 | 来源 |
| --- | --- | --- | --- | --- |
| 企业内部用户 ↔ 应用机器人私信 | 支持机器人菜单；悬浮样式可常驻输入框上方 | 同一菜单能力支持移动端链接；分端展示待验 | 悬浮样式飞书 ≥7.22；当前生产菜单关闭，未实现面向各来电者的统一目标解析 | [机器人菜单指南][bot-menu] |
| 外部联系人 ↔ 对外共享机器人私信 | **有条件候选**：对外共享机器人允许外部单聊；菜单指南没有单列外部场景排除，也未单列展示保证 | 同左；首次建立外部单聊需满足客户端版本与确认条件 | 不能仅凭外部单聊支持推定菜单已对外展示。保留顶部/既有电话页确认；必须由实际外部账号验证 | [菜单指南][bot-menu]、[对外共享][external] |
| 内部群，内部成员 | 支持群菜单；可用 `pc_url` 配置侧栏 | 支持群菜单，可分别设 iOS/Android URL | 仅 `chat_mode=group`，机器人须在群内并有权限；本轮内部群读回通过，点击未重验 | [群菜单概述][group-overview]、[添加][group-create] |
| 外部群，内部成员 | 有条件支持群菜单与桌面链接 | 有条件支持 | 自建应用开启对外共享，机器人在群内；外部群菜单读写 scope 官方列为支持。还须满足群设置管理权 | [对外共享][external]、[添加][group-create] |
| 外部群，外部成员 | 菜单配置作用于该群；外部成员实际可见性与打开须验 | 同左 | 不能用“机器人在群”代替来电者身份/群成员准入；沿用外部确认，不把此表当跨租户工具授权 | [对外共享][external] |
| 普通人与人的私信 | 不能套用群菜单 API；没有证据可安装 V 的机器人菜单 | 同左 | 本方案范围是用户与 V 应用机器人的单聊，不改普通私信工具栏 | [群菜单添加][group-create]、[机器人菜单指南][bot-menu] |
| topic / p2p 等非 group 会话调用群菜单 API | 不支持该 API | 不支持该 API | 官方明确仅支持 `group`；私信须用机器人菜单。不能把 `chat_id` 替换后试写 | [群菜单添加][group-create]、[读取][group-get] |

### 样式、应用类型与权限

| 能力 | 官方约束 | 对本项目的含义 |
| --- | --- | --- |
| 私信悬浮菜单 | 单聊专用；≥7.22；最多 5 主菜单、各 10 子菜单 | 推荐单个直接跳转按钮，不增加二级菜单；官方允许常驻且不影响输入，键盘展开后的实际占位仍需验 |
| 私信可切换菜单 | ≥5.27；与输入框同位置，用户切换；最多 3 主菜单、各 5 子菜单 | 平台提供的另一方案，但多一步且会与输入框切换，不优先 |
| 群菜单 | 自建 / 商店应用；机器人入群；最多 3 一级、各 5 二级；API 仅 group | 当前 V 已实现。新建/修改仍受菜单容量与群内管理设置约束 |
| Webhook 自定义机器人 | 群专用，不能单聊、不能代替应用机器人权限 | 不能通过更换机器人类型统一入口 |
| 企业自建应用对外共享 | 官方支持外部群和外部单聊；外部用户须先主动建立并确认单聊 | 当前正式 V 是这一类型，保持已经上线的外部登录能力，不重走内部 OAuth 假设 |
| 商店应用外部共享 | 对外共享开关官方仅适用于企业自建应用 | 群菜单 API 支持商店应用，不等于商店应用拥有本项目同样的对外共享模式 |
| 私信菜单事件 | `application.bot.menu_v6`；事件文档列 Custom App，无订阅权限要求；操作人姓名、user ID 另有字段权限 | 直接链接路线无需为菜单额外订阅事件或读姓名；不能把事件权限误套到所有菜单动作/应用类型 |
| 群菜单读写 | GET 可用 `im:chat.menu_tree:read` / `im:chat:readonly` / `im:chat`；写可用 `im:chat.menu_tree:write_only` / `im:chat` | 仅为入口展示不新增日历、通讯录或个人工具权限；scope 支持不保证某个群有管理权 |

以上依据 [菜单指南][bot-menu]、[群菜单 API][group-create]、[机器人概述][bot-overview]、[对外共享][external]、[菜单事件][menu-event]。机器人菜单保存后还需创建应用版本并发布，官方要求等待约 5 分钟再查看；Aily 创建的机器人菜单由 Aily 管理，本项目不是按此方式管理。

对外单聊的官方最低条件：一般客户端 ≥7.22；iOS **申请开启单聊** ≥7.68。这不是悬浮菜单另一个版本门槛。外部单聊支持飞书个人版；外部企业关闭对外沟通时仍可能不可用。[官方说明][external]

## 3. 能统一到什么程度

| 层次 | 建议与判断 |
| --- | --- |
| 名称、位置感知、点击次数 | 私信悬浮菜单与群底部菜单均显示一个「📞 打给 V」，点击即打开电话页；不用“发送文字消息”动作，也不先发一张电话卡 |
| 飞书原生组件 | 无法使用同一群菜单 API 覆盖私信。可以使用两套官方组件获得相近底部入口，间距、键盘适配、排列由飞书客户端控制 |
| 桌面打开容器 | 群菜单官方直接支持 `pc_url` 的 `sidebar-semi` AppLink；私信机器人菜单允许桌面/移动分端 URL 和 AppLink。**据此推断可测试同一桌面侧栏方式，尚未点击验收**。顶部旧标签继续按既有内嵌方式打开 |
| 手机打开容器 | 两类菜单配置相同会话电话 HTTPS 页，使用飞书客户端的打开行为；不把 PC 的 `sidebar-semi` 强塞手机。电话页仍需适配并验证登录、麦克风、返回与重开 |
| Web 飞书/系统浏览器 | 群菜单另有 `web_url`；私信菜单指南未明确单列 Web 飞书支持。保持既有电话页和旧标签兼容，不承诺浏览器与原生客户端容器一致 |
| 账号与会话 | 群继续逐群 URL；私信菜单需解析为该来电者与当前机器人账号的 DM。匿名路径保持 Public 自己的上下文，不因来源链接读取原私信/群历史 |

侧栏能力依据 [群菜单字段][group-overview] 与 [机器人菜单动作][bot-menu]；顶部 `is_built_in` 的含义见 [标签页概述][tabs-overview]。入口能打开页面不证明 WebRTC、麦克风、打断、后台或真实通话可用。

## 4. 尚未实现的关键：应用级私信菜单如何定位本人 DM

现有每个顶部标签携带对应会话的公开 `phone` 标识。它不是权限凭证；实际来电者仍由 Voice 确认，Gateway 重新核验 actor 与会话。

机器人菜单在应用后台配置，官方说明提供桌面/移动静态跳转链接，未说明可插入每个来电者的 `chat_id` 模板。菜单事件有操作人但没有文档化的 `chat_id` 字段，不能凭空当作现有会话标识。[菜单指南][bot-menu]、[菜单事件][menu-event]

**现有 `/voice/feishu` 不带 phone 也不能直接当全员“我的私信”。** `lib/feishu-phone-login.mjs` 的无 phone 分支依赖已登记 actor 的 `defaultPhoneId`；动态会话路径需要合法 phone。`lib/feishu-conversation-directory.mjs` 和平台 actor 签名校验都要求明确 chatId。不能把历史本人默认电话入口推广给全员。

建议后续实现独立的“我的 V 私信”入口，具体 URL 待实现时确定，**本轮没有增加这个 endpoint**：

1. 用户点击菜单后留在同一电话页，沿用当前内部身份确认和外部联系人原页确认体验。
2. 服务端使用确认后的应用账号、tenant/openId，查询可信的原生 DM 映射；映射来自真实的飞书会话进入/首次建立事件或既有平台会话记录，必须是该人和该机器人账号的 p2p。进入事件官方包含 `chat_id`，当前客户端门槛 ≥7.18。[进入事件][entered]
3. 服务端把确切的原生 chatId 交给现有 Gateway actor-scoped 准入，成功后进入相同标准电话页；不拼接 sessionKey、不读取其他用户映射、不信任浏览器提供权限。
4. 缺失/多义映射时显示返回 V 私信重新进入的明确步骤，保留旧顶部标签；不默认落入 Tianyi 私信或任意最近会话。

入口解析如何安全地给外部账号首次确认提供目标，也是实现前必须解决的设计项。不能先信任浏览器账号再完成确认。若采用平台可信 DM 查询、事件映射存取或新的身份交接协议，需独立平台 PR 和共享 VLab lease；不能仅以“是按钮”归为纯 Voice UI Candidate。

备选是菜单“推送事件”后向本人回一张已绑定入口卡，可用可信操作人做路由；但它增加消息和一次点击，不符合本次最直接的目标。暂不推荐，更不在本轮发送卡片或新增订阅。

## 5. 兼容迁移与回滚

1. **先完成无生产影响的验证**：独立测试应用开启单个悬浮链接菜单。不要修改正被他人使用的 V - Lab/共享配置来做试验。验证直达布局、桌面侧栏和手机普通输入是否自然；未实现可信本人 DM 解析前，测试链接仅指向明确标注的隔离演示，不能指向固定个人生产入口。
2. **补齐解析与授权后再灰度**：Voice 只承担既有电话页/入口体验；平台负责必要的可信会话映射、事件或准入协议。涉及平台的部分独立 PR、VLab 验收。飞书菜单配置版本与 Voice / 平台版本分别登记。
3. **保留全部已有顶部标签与旧书签**：初期不删除、不更名，不批量覆盖。新菜单与旧标签必须解析至相同原 session；已安装 App 的会话绑定与历史报告不迁移。底部入口未通过外部/iOS/Android验收前，顶部继续提供兜底。
4. **老私信与新私信**：应用级菜单发布不等于每个客户端立即刷新。旧私信通过自然重新进入刷新并补齐可信映射；新私信沿用现有事件和确认。需覆盖“已有会话但从未被新事件捕获”“只有 openId 而没有 native chatId”的例外，不创建新会话冒充修复，不群发探测。
5. **老群与新群**：保留已发布的逐群底部入口、菜单 ID/顺序和其他菜单；新群继续现有自动路径。无需因私信菜单上线重写所有群。真正需要改的自有 URL 逐项 dry-run、备份、写后回读，冲突/容量/权限错误单独留账。
6. **后续收敛顶部入口另行决策**：跨账号与端侧覆盖稳定后，才评估停止新建顶部标签/移除自有旧标签。当前平台事件钩子会自动确保顶部标签，若先手工删除，后续事件可能补回；停止补建属于平台改动，必须先行设计并发布。用户手工标签及不明链接保持不动。
7. **回滚**：飞书应用回滚至原菜单关闭配置并重新发布（传播有延迟）；顶部标签与旧电话页始终可用。Voice/平台各自回滚所属已验证版本，不重置个人账号或会话、不为菜单配置重启 Gateway。若确需平台运行模块切换，单独遵循平台发布流程，不混成普通 Voice 服务更新。

## 6. 最小验证与风险

| 步骤 | 最小样本与通过条件 | 当前状态 |
| --- | --- | --- |
| 官方/代码/配置核对 | 两类菜单能力；生产开关；内部 DM 与群各一个 API 读回 | 本轮完成；全量入口未重验 |
| 飞书原生布局 | 测试应用：桌面、iOS、Android 各验证常驻按钮、键盘、长消息、单击打开与返回 | 未验；本轮不发布任何应用配置 |
| 自己的 DM 定位 | 两个内部账号、两个已有 DM；不带 phone 入口准确解析；交换浏览器/链接不能串 session | 尚未实现，需 Candidate + 涉及平台时 VLab |
| 外部联系人 | 已建立外部 DM、首次 DM（含需审核）、个人版；分别确认菜单展示、确认流程、映射和拒绝行为 | 未验；不能以内部样本推定通过 |
| 群兼容 | 内部群/外部群、不同成员；原菜单仍指原群，PC 侧栏/手机页面；不能继承别人的工具身份 | 官方能力与内部群配置确认；端侧未重验 |
| 存量与幂等 | 老顶部标签、旧收藏、App 绑定、缺映射、232024/解散会话/菜单满；只读或局部 dry-run 后逐项回读 | 迁移方案，未执行新迁移 |
| 真实音频 | 人类授权后分别验证麦克风、三个模型、挂断重拨、打断与身份/工具权限 | 未验；本轮 0 通话、0 付费模型请求 |

主要风险是应用级菜单误指个人会话、外部菜单和登录支持被混为一谈、侧栏打开被当作音频验收、批量删除顶部破坏兼容、旧事件自动补回，以及将应用配置发布与 Voice/平台运行版本混报。上述验证应分别留下客户端版本、应用配置版本、Voice/平台 commit、账号类别和动作结果；失败保留旧入口，不扩大授权。

本轮为文档调研，不部署 Candidate 或共享 VLab；不以模拟飞书的本地 HTML 代替真实菜单能力。下一步最小实验应使用独立测试应用的真实悬浮菜单。

## 7. 官方来源与只读 API 清单

资料于 2026-10-27 从官方 Markdown 原文读取。按 lark-openapi-explorer 从 `llms.txt` → 机器人/群组索引定位 API；机器人概述进一步链接到菜单指南。没有找到私信机器人菜单配置的已注册 CLI 命令，本轮未猜测内部控制台 API。

| API / 作用 | 方法与路径 | 关键参数、权限与本轮使用 |
| --- | --- | --- |
| 获取群菜单 | `GET /open-apis/im/v1/chats/:chat_id/menu_tree` | group chat_id；应用 token；`im:chat.menu_tree:read` / `im:chat:readonly` / `im:chat` 任一。内部群抽样使用 |
| 获取会话标签 | `GET /open-apis/im/v1/chats/:chat_id/chat_tabs/list_tabs` | group/p2p chat_id；应用或用户 token；`im:chat.tabs:read` / `im:chat:readonly` / `im:chat` 任一。内部私信抽样使用 |
| 添加群菜单 | `POST /open-apis/im/v1/chats/:chat_id/menu_tree` | group chat_id、menu_tree；应用 token；`im:chat.menu_tree:write_only` / `im:chat` 任一。**只读规范，未调用** |
| 添加标签 | `POST /open-apis/im/v1/chats/:chat_id/chat_tabs` | chat_tabs 中 doc/url；`im:chat.tabs:write_only` / `im:chat` 任一。**只读规范，未调用** |

在明确使用正确应用的 CLI profile 后，等价只读命令为：

```sh
lark-cli --profile EXISTING_V_PROFILE api GET \
  /open-apis/im/v1/chats/oc_EXAMPLE/menu_tree --as bot
lark-cli --profile EXISTING_V_PROFILE api GET \
  /open-apis/im/v1/chats/oc_EXAMPLE/chat_tabs/list_tabs --as bot
```

占位符不是生产目标；不要直接复制运行。CLI 原始输出含目标链接/会话标识，应只留私有回执，对外仅报告脱敏形状和结果。

- [机器人菜单使用指南][bot-menu]：样式、版本、单聊限制、动作、发布传播与 Aily 例外。
- [群菜单概述][group-overview]、[添加群菜单][group-create]、[获取群菜单][group-get]：group 限制、各端 URL、侧栏、容量和权限。
- [机器人支持外部群和外部用户单聊][external]：应用类型、外部确认、版本、支持的 scopes 与 API 限制。
- [机器人概述][bot-overview]、[机器人自定义菜单事件][menu-event]：机器人类型及事件字段。
- [会话标签页概述][tabs-overview]、[添加标签][tabs-create]、[获取标签][tabs-get]：顶部位置、p2p/group、内嵌打开。
- [用户进入与机器人的会话][entered]：可信进入事件中的 chatId 与客户端条件。

[bot-menu]: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu
[group-overview]: https://open.feishu.cn/document/server-docs/group/chat-menu_tree/overview
[group-create]: https://open.feishu.cn/document/server-docs/group/chat-menu_tree/create
[group-get]: https://open.feishu.cn/document/server-docs/group/chat-menu_tree/get
[external]: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/develop-robots/add-bot-to-external-group
[bot-overview]: https://open.feishu.cn/document/client-docs/bot-v3/bot-overview
[menu-event]: https://open.feishu.cn/document/client-docs/bot-v3/events/menu
[tabs-overview]: https://open.feishu.cn/document/group/chat-tab/chat-tab-overview
[tabs-create]: https://open.feishu.cn/document/server-docs/group/chat-tab/create
[tabs-get]: https://open.feishu.cn/document/server-docs/group/chat-tab/list_tabs
[entered]: https://open.feishu.cn/document/group/chat-member/event/bot_p2p_chat_entered
