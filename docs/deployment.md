# 独立发布边界

当前入口与 Gateway 插件版本分别登记在 [current.json](releases/current.json)。仅前端变更时两者提交可以不同；必须证明插件、lib 与 server 字节相同，不能只看目录名，也不要为改目录名重启 Gateway。历史完整平台发版记录仍在平台 CHANGELOG。

## 运行接口

Voice 使用 Gateway wire protocol 4：`talk.client.*`、`chat.history/send/abort`、`agent.wait`、`tools.catalog/invoke`、已有 `vlab.workers.voice.cancelProcesses`，以及当前 `talk.event/chat/agent` 事件。Gateways 的这些扩展需另行验收；protocol 4 握手成功不等于全部语音能力可用。

GPT Live 仍由 Gateway 原生实时接口承接；本次没有把其原生语音引擎搬进 Voice，也没有复制 Agent/工具执行器。小何/Grok 继续用本产品适配器和既有 Gateway 工具/Agent。SDK 目录依赖移除，Gateway 实现与版本仍是兼容依赖。

## 发布步骤

1. 按下表确定本次验收环境，在 Voice 分支完成本地及对应环境验证，提交精确版本并提 PR，由 Tianyi 决定合入。
2. `npm run package` 固化干净 commit 的 manifest，每个文件逐 hash 核验。服务器独立 release 目录安装 `npm ci --omit=dev --ignore-scripts` 的锁定依赖。
3. 用已存在的 H5-only controller 检查原 pointer/unit/环境 hash/Gateway PID+start+Invocation/config。不得为拆库改凭据或触发 Gateway 重启。
4. 如需共享 VLab 集成，取得 lease 后按本次授权范围部署并验证；仅 Voice 改动只切换自有电话服务，Gateway 保持原样，之后清理自己的临时服务并归还 lease。如 Candidate 已覆盖全部影响范围，记录其版本、产物和实际用户路径证据，可跳过共享 VLab。
5. 经授权上线时确认原电话的 GPT Live openVoices=0，直接模型 relayConnections=0；忙则延期，不能强关。保留原 release/pointer/启动配置/环境，只切换 `openclaw-rtc-h5.service`。出现异常恢复同一原服务与 pointer。
6. HTTPS 正式入口逐 hash 核验；真人测试音频流畅、后台任务、打断、挂断、重拨。保留部署和验收两个结论。

## 验收环境选择

共享 VLab 不是固定必经步骤。每个 PR 根据实际改动和依赖选择环境，并在验收报告说明理由。

| 改动范围 | 默认验收环境 | 必要证据 |
| --- | --- | --- |
| UI、头像 Reaction、图片资源、Markdown | Candidate | Web/H5 实际展示；Reaction 记录用户话、V 回复与实际应用头像时间线 |
| Voice 自身音频播放、打断、挂断、模型适配；Gateway 协议和权限未变 | Candidate | 涉及模型的真实通话；iOS 问题在 Safari 验证，不能用文本 fixture 代替 |
| 使用既有权限和接口的电话入口映射 | Candidate | 对应会话连续性、入口隔离、挂断和重拨；映射不授予新权限 |
| Gateway/Worker、工具或来电者身份权限、飞书会话核心 | 共享 VLab | 真实接收、派发、回复及对应权限/会话集成路径 |
| 共享配置、共享数据迁移、跨服务协议或兼容契约改变 | 共享 VLab | 实际版本组合、状态兼容与回滚验证 |

混合 PR 按集成范围验收；能独立发布的 Voice 部分可拆 PR。若只修改 Voice、沿用现有 Gateway 契约且 Candidate 覆盖全部影响范围，不因使用 Gateway 而额外要求共享 VLab。无法覆盖的兼容性问题仍需补集成验证。验收环境选择不等于合入或上线授权。

## 首次拆库尚未执行的迁移

原平台发布控制器目前按平台 Git 和 shared accepted artifact 生成产物。因此本仓库包不能直接冒充它的旧 plan。首次切换需要把 controller 的输入改为本仓库 manifest，同时保持原 CAS、空闲检查、Gateway baseline 与回滚逻辑，并在平台库提相应 PR。这里已实现独立源码、运行、测试、可校验打包；尚未自动化执行服务器安装/切换。不能称为已上线。

上线后各产品分支可独立发布。仅静态 UI/头像变化可以走静态资源切换；服务端变化仍需等通话结束后切换电话服务，不能承诺任意代码变更无重启。
