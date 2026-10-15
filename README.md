# V Voice

V 的独立 Web/H5 电话产品。GPT Live、豆包·小何、Grok 共用界面、头像 Reaction、通话控制和日志，继续通过既有 Gateway 使用 OpenClaw Agent/工具。

## 独立开发

Node.js 22+：

```sh
npm ci --ignore-scripts
npm test
npm run preview
```

预览在 `http://127.0.0.1:26244/`，不会创建语音连接。正式运行用 `npm start`，需要服务端 `OPENCLAW_CONFIG_PATH`；其 Gateway token 可引用服务环境变量。新的连接器只使用 Gateway protocol 4 和本仓库的 `ws`，不加载 Gateway 安装目录或 SDK。既有 `RTC_H5_*` 环境继续兼容。

三个模型的实际凭据、头像 Decision 凭据、飞书 CLI 账号和日志目录继续放在服务器私有环境，不提交 Git。

## 会话电话

正式 `/voice/` 保留当前 Tianyi 本人入口。新增电话格式 `/voice/?phone=<入口编号>#access=<私有入口凭据>`：凭据换成按入口隔离的 HttpOnly cookie 后清除 fragment。通过 `VOICE_ENTRIES_FILE` 指定服务器私有映射 JSON；入口的 session 必须来自 Gateway 现有会话，不能根据姓名或浏览器请求编造。

当前第一阶段只允许 `callerId=tianyi`、`permissionProfile=personal-tianyi`，用于验证本人多个群/DM 的电话承接。**其他人的电话仍未开放**：现有直接工具和 GPT Live 后端使用个人权限，必须先在 Gateway 增加经过验证的来电者身份与工具权限隔离。详见 [入口边界](docs/conversation-entries.md)。

## 基线与发布

114 个运行文件从线上平台 commit `52eefaab221ed8e1e20d439133875ee2cfcb4b19` 原字节提取，保留 [来源校验](docs/migration-baseline.json)。原平台库没有删文件、没有合入变更；当前生产尚未切换新仓库。

提交并测试后运行：

```sh
npm run package
node scripts/verify-package.mjs artifacts/<完整commit>
```

包只包含运行文件和锁定依赖清单，不含配置、凭据、对话或 Gateway runtime。部署方式与上线边界见 [发布流程](docs/deployment.md)。
