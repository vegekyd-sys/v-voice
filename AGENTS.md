# V Voice

用中文交流。这里维护网页电话产品：Web/H5、GPT Live/小何/Grok 适配、音频、头像 Reaction、电话入口映射和通话日志。

- 后续更新与交接先读 [更新指南](docs/UPDATE-GUIDE.md)：优先在共用 H5 / Voice 服务解决，尽量少改平台、App 与固件；UI、四端行为、Candidate 分流、发布及记忆交接以该指南和最新实际回执核对。
- 在独立分支或 worktree 开发；报告 commit 和实际验证范围，由 Tianyi 决定合入及上线。不要自动合入平台 dev。
- 正式上线必须先通过 PR 合入 `v-voice/main`，确认合入提交的检查通过，再从已合入源码构建并发布；未合入分支不得上线。Candidate 验证不受此限制；发布与合入状态分别记录，保留实际运行提交和回滚基线。
- iOS 连续播放与打断的稳定基线固定为 build 32 / `af6c0da`；后续相关修改必须遵守 [稳定基线与回归要求](docs/ios/stable-baseline-build32.md)，保留回滚材料，不能只凭单测或提高门槛宣称体验未退化。
- iOS 产品改动先按 [原生能力桥边界](docs/ios/NATIVE-CAPABILITY-BRIDGE.md) 判断归属：页面在 H5，对话/插语内容、模型和说话人事件解释、任务/报告展示规则在共用 Voice 服务，iOS 保持有版本且有界的设备与系统能力执行器。新增既有传输上的模型或调整文案/策略不应再新增 Swift 的 provider/source/中文关键词分支；原生驱动、系统交互或执行器缺陷另行发版并做真机验收。
- Gateway RPC、Agent/工具策略、飞书会话核心及 Worker 改动在 `v-openclaw-platform` 独立 PR，不在此复制或热改 runtime。
- 生产只用 `ssh v`（Tailscale IPv6）。共享 VLab 写入/重启须遵循 `/Users/tianyicai/vlab-dev/lab/README.md` 和 integration lease，不能抢占他人业务。
- 按实际影响选择验收环境，共享 VLab 不是所有改动的必经步骤。Voice 内部且使用既有 Gateway 接口/权限的 UI、头像、Markdown、音频播放、模型适配与入口映射可在 Candidate 验证；涉及 Gateway/Worker、工具或身份权限、会话核心、共享配置/数据迁移或跨服务协议变更时走共享 VLab。混合改动按集成范围验收，先说明选择理由；Candidate 通过不自动授权合入或上线。
- 每次发布前核对并更新首页用户可见的 `lab/gpt-live-h5/changelog.mjs`，只记录本次实际交付的能力与修复；同时维护 `CHANGELOG.md` 和版本登记。不能只更新 Git 发布记录而遗漏首页日志。
- 正式 Voice 发布必须使用 `scripts/release-fleet.py` 同时覆盖网页/iOS 与上海机器人/音响节点，遵循 `docs/unified-release.md`。忙碌端延期且标记 pending；双节点产物一致后才记服务器同步完成。原生 App/固件变更必须另附客户端安装与验收证据，不能用服务升级替代。
- Voice 发布不重启 Gateway。现有通话结束、原服务身份和产物校验通过后，才切换独立电话服务；保留原版本、启动参数、私有环境和回滚证据。
- 禁止提交凭据、个人入口配置、聊天正文、日志、数据库、浏览器资料、生产环境文件。共享工具凭据不进入浏览器。
- 电话入口由服务端映射到已有 Feishu session；不能相信浏览器传入的 sessionKey、callerId 或权限。新拨号创建新 voiceSessionId，历史 session 保持不变。
- 已确认的飞书来电账号须经 Gateway 的 actor-scoped 准入与对应工具授权；Public/未确认访客保持受限能力，不继承来源群历史或 Tianyi 的个人工具身份。固定私有入口保留原映射；换链接、设备能力声明或网页参数均不能扩大权限。早期“其他来电者未开放”已由后续身份发布取代，实际范围见 [更新指南](docs/UPDATE-GUIDE.md) 与最新发布记录。
- 头像 Decision 只用于 Reaction，不能参与工具授权或重新引入已放弃的任务决策路由。
- 测试/健康/文本 fixture 不代表真实音频、手机权限、打断或多账号验收。不要自动拨号或产生付费测试；按当前人类授权执行。
