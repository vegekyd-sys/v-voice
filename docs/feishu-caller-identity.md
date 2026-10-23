# 飞书群电话来电者身份

新动态群链接与私有配置中的旧群链接统一到 account/chat 对应的动态入口。只迁移服务端已登记、同账号、标准 Feishu group session 的链接；个人入口与私聊绑定保持原路径。旧 URL 片段中的个人 token 在重定向时清除，不用它推断来电者。

飞书客户端每次进入群电话时，用 `tt.requestAccess`（空 scopeList）获取当前账号的临时授权码；不支持时使用官方兼容接口 requestAuthCode。服务端绑定短时、一次性的浏览器 state，使用应用凭据换取基本用户信息，再调用现有 Gateway 原生会话准入。Provider token 仅在请求内使用，不写入 cookie、日志、浏览器或模型。认证 cookie 只保存账号标识与基本显示名。认证后的短时入口 handoff 仅可使用一次，避免刷新页面时沿用另一个已切换账号。

SDK 加载/授权失败、超时、用户选择访客或账号不属于会话时，进入独立访客会话并清除旧账号 cookie。旧账号不会在新账号识别失败时被悄悄复用。浏览器外仍支持已有 OAuth 登录；没有账号身份则可访客聊天。

姓名由服务端取得，作为独立 `callerIdentity` 传给小何与 Grok。GPT Live 的对应字段由 Gateway 校验带签名的 actor assertion 后作为 `voiceCallerIdentity` 转交 provider。姓名仅用于当前账号的称呼，不参与工具、owner、成员资格和会话路由决策；群历史、记忆及口头自述都不能替代账号身份。未返回姓名时如实说明，不猜测 Tianyi。

页面显示已连接的账号姓名，并保留切换账号入口。工具权限仍由 Gateway 的既有 Feishu sender/group/account 策略决定。个人入口、设备协议和 iOS 原生权限不变。

部署要求：保留现有 OAuth callback 白名单，飞书客户端免登还需已有 H5 可信域名配置覆盖当前服务域名。未配置时应降为访客，不能把 fixture 成功等同于真实免登成功。GPT 字段依赖平台分支的可信转交补丁；平台与 Voice 需配套验证。

官方依据：[端内免登](https://open.feishu.cn/document/client-docs/h5/development-guide/step-3)、[requestAccess](https://open.feishu.cn/document/uYjL24iN/uUzMuUzMuUzM/requestaccess)。
