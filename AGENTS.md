# V Voice

用中文交流。这里维护网页电话产品：Web/H5、GPT Live/小何/Grok 适配、音频、头像 Reaction、电话入口映射和通话日志。

- 在独立分支或 worktree 开发；报告 commit 和实际验证范围，由 Tianyi 决定合入及上线。不要自动合入平台 dev。
- Gateway RPC、Agent/工具策略、飞书会话核心及 Worker 改动在 `v-openclaw-platform` 独立 PR，不在此复制或热改 runtime。
- 生产只用 `ssh v`（Tailscale IPv6）。共享 VLab 写入/重启须遵循 `/Users/tianyicai/vlab-dev/lab/README.md` 和 integration lease，不能抢占他人业务。
- 按实际影响选择验收环境，共享 VLab 不是所有改动的必经步骤。Voice 内部且使用既有 Gateway 接口/权限的 UI、头像、Markdown、音频播放、模型适配与入口映射可在 Candidate 验证；涉及 Gateway/Worker、工具或身份权限、会话核心、共享配置/数据迁移或跨服务协议变更时走共享 VLab。混合改动按集成范围验收，先说明选择理由；Candidate 通过不自动授权合入或上线。
- Voice 发布不重启 Gateway。现有通话结束、原服务身份和产物校验通过后，才切换独立电话服务；保留原版本、启动参数、私有环境和回滚证据。
- 禁止提交凭据、个人入口配置、聊天正文、日志、数据库、浏览器资料、生产环境文件。共享工具凭据不进入浏览器。
- 电话入口由服务端映射到已有 Feishu session；不能相信浏览器传入的 sessionKey、callerId 或权限。新拨号创建新 voiceSessionId，历史 session 保持不变。
- 当前其他来电者未开放。Tianyi 工具身份不能通过换链接授予别人；多账号需 Gateway 确认的 actor-scoped 权限和对应工具账号。
- 头像 Decision 只用于 Reaction，不能参与工具授权或重新引入已放弃的任务决策路由。
- 测试/健康/文本 fixture 不代表真实音频、手机权限、打断或多账号验收。不要自动拨号或产生付费测试；按当前人类授权执行。
