# 飞书群电话来电者身份

新动态群链接与私有配置中的旧群链接统一到 account/chat 对应的动态入口。只迁移服务端已登记、同账号、标准 Feishu group session 的链接；个人入口与私聊绑定保持原路径。旧 URL 片段中的个人 token 在重定向时清除，不用它推断来电者。

飞书客户端每次进入群电话时，用 `tt.requestAccess`（空 scopeList）获取当前账号的临时授权码；不支持时使用官方兼容接口 requestAuthCode。服务端绑定短时、一次性的浏览器 state，使用应用凭据换取基本用户信息，再调用现有 Gateway 原生会话准入。Provider token 仅在请求内使用，不写入 cookie、日志、浏览器或模型。认证 cookie 只保存账号标识与基本显示名。认证后的短时入口 handoff 仅可使用一次，避免刷新页面时沿用另一个已切换账号。

SDK 加载/授权失败、超时、用户选择访客或账号不属于会话时，进入独立访客会话并清除旧账号 cookie。旧账号不会在新账号识别失败时被悄悄复用。浏览器外仍支持已有 OAuth 登录；没有账号身份则可访客聊天。

姓名由服务端取得，作为独立 `callerIdentity` 传给小何与 Grok。GPT Live 使用已存在的 WebRTC `session.context.append` developer 通道：Voice 的已认证拨号响应返回仅属于本通电话的账号说明，H5 在模型 session.started 后发送，收到上下文确认后才放行麦克风和接通问候。没有新增 Gateway 字段、RPC 或 provider 补丁。浏览器不向服务端提交身份上下文，服务端也不会把客户端显示上下文用于授权。姓名仅用于当前账号的称呼，不参与工具、owner、成员资格和会话路由决策；群历史、记忆及口头自述都不能替代账号身份。未返回姓名时如实说明，不猜测 Tianyi。

页面不展示账号姓名或“切换账号”。右上角保留原 iOS App 按钮及可用性逻辑；未登录时“连接飞书账号”位于拨号区下方。工具权限仍由 Gateway 的既有 Feishu sender/group/account 策略决定。个人入口、设备协议和 iOS 原生权限不变。

部署要求：保留现有 OAuth callback 白名单，飞书客户端免登还需已有 H5 可信域名配置覆盖当前服务域名。未配置时应降为访客，不能把 fixture 成功等同于真实免登成功。本版只修改 Voice，按使用既有 Gateway 接口的范围在独立 Candidate 验证。

官方依据：[端内免登](https://open.feishu.cn/document/client-docs/h5/development-guide/step-3)、[requestAccess](https://open.feishu.cn/document/uYjL24iN/uUzMuUzMuUzM/requestaccess)。

## 2026-10-24 首轮验收（方案已被 Voice-only 版替代）

- Voice 代码 `cad5d603a71ebadc844f681cca5145eb4e020578`，平台配套代码 `74dbaff30a175e3ecca9dec165c9c9e5c19241bb`；独立 Candidate 实际运行，两服务只重启各自实例。225 个 Voice 产物与 2 个平台替换模块逐项校验通过。
- 真实桌面飞书内打开：官方 SDK 免登成功，电话页直接显示当前登录账号的名称，无聊天验证码，未拨号。系统浏览器 OAuth 同样通过，确认页面仅续接既有基本身份权限。
- 无账号的浏览器/主动访客入口可进入电话页，页面提供“连接飞书账号”。HTTP 集成测试验证认证失败清除旧账号、访客不访问群会话工具，以及旧群别名与新群编码入口统一；Candidate 私有配置没有旧群别名，因此旧别名行为的证据来自 HTTP 集成测试。
- Voice 全量 885 项通过；后续入口及身份改动相关 128 项、最终入口 21 项通过，UI 构建和 iOS H5 资源一致性检查通过。平台原生运行时 Candidate 29 项通过，覆盖非 owner 工具能力、会话隔离、签名篡改及姓名不能提升 owner 权限；12 个候选运行时文件与已提交源码哈希一致。
- 当前桌面群菜单默认在系统浏览器打开；飞书内免登使用官方 AppLink 打开同一页面验证。未改变用户的默认浏览器设置或群菜单打开方式。
- 未执行真实音频、手机端免登、真人双账号切换或生产验收。共享 VLab 最终集成须在获准合入后执行；以上候选验收不代表已上线。

## Voice-only 验收

平台 PR #467 已撤回，GPT provider 和 actor assertion 恢复原实现；仅保留 Voice Web/服务端改动。全量 887 项测试通过，覆盖 GPT 上下文先于问候/输入、结束后不复用、上下文确认失败不放行输入，及新旧群账号和访客隔离。实际三模型验收记录随后补齐。
