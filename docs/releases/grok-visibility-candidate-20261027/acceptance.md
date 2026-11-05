# Grok 正式入口隐藏候选

版本 `voice-grok-visibility.20261027.1`，分支 `codex/grok-model-visibility-20261027`；基于 main `002313b`。仅候选，未合入、未部署。沿用服务端账号/actor/会话验证；无 Gateway、Worker、原生执行器或固件改动，因此使用本机隔离 Candidate，不占共享 VLab。

## 配置与入口盘点

现有 `VOICE_DEFAULT_MODEL` 控制首页默认选择，`GPT_LIVE_H5_PREVIEW` 控制预览/拨号，`VOICE_CANDIDATE_RELEASE_FILE` 只展示候选日志；三者均不是模型可见性开关。新增 `VOICE_ENABLE_GROK=1` 明确启用测试电话目录。未设置、`0` 或其他值均不启用；不根据 hostname、浏览器参数或 `NODE_ENV` 猜测。Provider 仍按原凭据配置，不删除或改写密钥。

| 入口 | 正式默认 | 显式测试与兼容 |
| --- | --- | --- |
| Web/H5 首页内联状态、`api/status`、身份确认后快照 | 服务端目录省略 Grok，网页不再把固定第三项补回来 | `VOICE_ENABLE_GROK=1` 后目录与音色选择恢复 |
| 已绑定 iOS / Public 的服务下发列表 | 共用同一目录；Public 仍不能使用 GPT | 原生 `refreshOptions()` 在空闲时同步目录与已有持久化偏好，无 Swift 生产代码变化 |
| iOS 共享 H5 | 原有 `H5Snapshot` 直接投影服务下发选项 | 定向模拟器测试确认旧 Grok 偏好刷新后变为小何，测试目录可重新出现 Grok |
| Web 旧收藏、`?model=grok`、fragment、App 绑定/结果深链 | URL 不控制模型目录或服务开关；入口身份仍走原核验 | App 绑定/结果深链负责绑定预填/回看，不授权模型、账号或新拨号 |
| 旧缓存 HTTP / iOS 快捷 WebSocket 拨号 | 隐藏的 Grok 请求在 reservation、close、Gateway 调用前拒绝 | HTTP 返回 `model_hidden` 与重新选择提示；旧原生 fast-dial 仍使用既有通用 409 提示，须返回前台刷新目录，不自动重拨或代选拨号 |
| 机器人/音响 `hello.models`、`call.start` | 沿用每设备私有 `model/models` 白名单，默认小何；没有公开三模型菜单 | 已有明确配置 Grok 的测试设备继续工作；不把电话开关套到设备白名单，不改设备配置、不刷机 |
| Grok provider / 对照脚本 / 静态试听 | 实现、上游版本 pin、工具及 relay 保留 | 对照脚本仍需显式付费运行授权；原认证下的直接试听路径保留，没有首页测试入口 |

设备白名单本身就是已有显式配置机制。若将某台测试设备改为正式用途，应单独检查其私有白名单并明确配置，不批量改写现有测试设备。

## 旧偏好与活动通话

- 旧 `VOICE_DEFAULT_MODEL=grok` 在关闭测试开关时优先下发可用的小何，否则为 GPT Live。网页在目录内选可用默认项/现有项/小何/GPT，绝不从缺失目录恢复 Grok。没有可用模型时不制造可用的第三项。
- 现有 iOS 空闲前台刷新会将保存的 Grok 偏好改为服务端可用默认项；`refreshOptions()` 已有 `!active` 保护。原生目录刷新、H5 快照及测试 Grok reservation 均在独立模拟器验证。
- 旧缓存客户端未刷新而直接拨 Grok：明确拒绝新 reservation，不会为了回退关闭当前通话，不会偷偷用别的模型接通。旧版原生对 409 的显示仍是其既有通用提示；专属原生错误文案需要另一个 binary 更新，本候选不冒充已经更新实体 App。
- 离线/旧 UI 缓存不能保证即时隐藏；正常连通后目录刷新才生效。已有媒体流、relay ticket、通话记录及设备测试通话不由目录开关撤销。

## 实际验证

- 本机正式/测试 Candidate：`http://127.0.0.1:29871` / `http://127.0.0.1:29872`。真实 H5 HTTP 与内置浏览器菜单交互，正式两项、测试三项与 Iris 音色可见。页面身份、非空内容、无错误遮罩、控制台无 error/warn、菜单交互和截图通过；未点击真实拨号。
- iOS 26.5 独立模拟器 `V Voice Grok Visibility 20261027`：2 项 XCTest 通过，覆盖旧 Grok 偏好恢复、H5 目录省略、无自动拨号、测试目录恢复与 Grok 音色 reservation。初次运行因新模拟器无麦克风权限导致原有 fixture 测试失败；授予本模拟器测试 App 权限后同组重跑通过。全部请求使用本机 fixture，没有上游调用。
- `serve-sim` 在 Codex 右侧内置浏览器显示 live 的真实模拟器电话首页，已核对帧；该展示不等于物理 iPhone 验收。
- `npm test`、`npm run test:speaker-native`、发布控制 Python 测试、`check:ios-shell` 均通过；最终数量见 `candidate.json`。原有 Grok 身份/工具/会话测试显式开启测试模式，断言保持。
- 机器人/音响按现有设备端点回归验证私有模型白名单、身份、会话及 relay；未连接或更新实体设备。
- 生产网页节点本轮只读回读：commit `7ce20a2`、ready、无 admission hold，与 #155 发布一致。设备节点本轮通用 SSH 别名连接失败，未读取私有配置定位其他连接；双节点既有版本证据仍引用上次发布回执，不能声称本轮重新验证两端。main `002313b` 是记录提交，不是运行提交。

没有生产部署、Gateway 重启、消息发送、真实日历操作、真实模型/付费通话、设备刷机或原生安装分发。真实手机、快捷拨号系统文案、设备听感与完整音频路径未验。

## 发布与回滚

候选日志单独导出 `GROK_VISIBILITY_CANDIDATE_UPDATE`，不加入正式 `VOICE_UPDATES`。批准正式发布时，再将本次实际交付内容写入首页正式日志、`CHANGELOG.md` 和发布登记，并从已合入 main 的干净源码使用统一双节点发布工具。默认环境无需新增变量即可隐藏 Grok；测试服务需显式开启。若回滚配置，仅恢复明确测试服务的开关；如回滚代码，沿原通话保护流程恢复保留的旧产物。任何配置/代码切换均不得强制结束活动通话。
