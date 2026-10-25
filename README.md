# V Voice

V 的独立 Web/H5 电话产品。GPT Live、豆包·小何、Grok 共用界面、头像 Reaction、通话控制和日志，继续通过既有 Gateway 使用 OpenClaw Agent/工具。

## 开发、更新与交接

先读 [更新与接手指南](docs/UPDATE-GUIDE.md)：UI 标准、共用 H5 / Voice 服务与原生硬件边界、四端行为、Candidate / VLab 验收、双节点发布和回滚，以及 Codex / V 交接模板。优先在 Voice 内完成产品更新，平台接口和终端执行器按实际需要独立修改。

当前服务版本看 [生产登记](docs/releases/current.json)，原生安装与接受状态看 [iOS 版本登记](docs/ios/versions.json)。源码 main、生产服务、iOS 安装包和固件可能不同；专题内的早期候选结论须结合后续发布记录阅读。

## iOS 客户端

`ios/` 使用共用 H5 页面与原生音频执行器，提供入口绑定、Action Button、连续通话、灵动岛／锁屏控制与恢复。页面和兼容的服务策略可独立更新；系统能力、音频驱动、Widget 结构等改动需要原生升级。构建与具体传输边界见 [iOS 说明](docs/ios/README.md) 和 [原生能力桥](docs/ios/NATIVE-CAPABILITY-BRIDGE.md)。音频回归保留 [build 32 稳定基线](docs/ios/stable-baseline-build32.md)，不把新包分发等同于重新完成所有真机验收。

## 独立开发

Node.js 22+：

```sh
npm ci --ignore-scripts
npm test
npm run preview
```

预览在 `http://127.0.0.1:26244/`，不会创建语音连接。正式运行用 `npm start`，需要服务端 `OPENCLAW_CONFIG_PATH`；其 Gateway token 可引用服务环境变量。新的连接器只使用 Gateway protocol 4 和本仓库的 `ws`，不加载 Gateway 安装目录或 SDK。既有 `RTC_H5_*` 环境继续兼容。

三个模型的实际凭据、头像 Decision 凭据、飞书 CLI 账号和日志目录继续放在服务器私有环境，不提交 Git。

Grok 默认使用固定版本 `grok-voice-3.0`，凭据沿用服务端 `XAI_API_KEY`。对照或回退时由服务端设置 `XAI_VOICE_MODEL=grok-voice-2.0`；页面会显示实际配置版本。真实 API 隔离评测与验收边界见 [Grok 3.0 接入与对照](docs/grok-voice-3.md)。

## 会话电话

群聊和私聊动态电话入口由服务端映射至现有 Feishu session，核验实际来电账号及 Gateway 授权。飞书内部免登与外部联系人原页确认分别处理；每次拨号创建新的 voiceSessionId。已登记旧链接、原有 App 绑定和通话记录保留原归属。见 [身份确认发布](docs/releases/feishu-confirm-20261025/release.md) 和 [旧入口迁移](docs/releases/entry-release-20261026/release.md)。

固定私有入口继续使用服务端配置，不能由浏览器账号或参数替换 caller/session。Public 和未确认访客使用受限能力，不继承来源群历史或个人工具身份。任何入口都不能通过换链接授予 Tianyi 的权限；多账号必须经过 actor-scoped 准入。早期固定入口设计保留在 [入口边界](docs/conversation-entries.md)，其第一阶段状态以较晚发布记录为准。

## 基线与发布

最初 114 个运行文件从平台 commit `52eefaab221ed8e1e20d439133875ee2cfcb4b19` 提取，[来源校验](docs/migration-baseline.json) 保留历史基线。现已使用独立 Voice 仓库与双节点发布，实际运行版本由生产登记维护。

正式发布先按授权通过 PR 合入 main、确认合入提交检查通过，再从干净源码打包：

```sh
npm run package
node scripts/verify-package.mjs artifacts/<完整commit>
```

包只包含运行文件和锁定依赖清单，不含配置、凭据、对话或 Gateway runtime。日常唯一发布入口为 `scripts/release-fleet.py`，同时覆盖网页/iOS 与上海机器人/音响节点，等待空闲并保留回滚材料；Voice 发布不重启 Gateway。完整命令见 [四端统一发布](docs/unified-release.md)，集成边界见 [发布流程](docs/deployment.md)。
