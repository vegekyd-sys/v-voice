# StackChan 当前端能力 Candidate

本路负责独立 Candidate、固件安装和真人验收；总控负责正式合并、部署、发布。当前没有正式发布，共享 VLab 未改动。

## 提交与依赖

- Voice：`codex/stackchan-capabilities-20261025`，叠在位置线 PR #134 的 `b444956769767f4d950e38f5d02a8a06fce22b4c` 上。已包含 revisioned capabilities 和 artifact-owned Skill 增量，不能重复合入旧公共层。
- 固件：Draft PR https://github.com/vegekyd-sys/v-stackchan/pull/2 ，`35b827abf670f61a8c55a72d50f2dd224b5c55d8`，版本 `1.5.3-capabilities-rc1`。依赖 PR #1 的 `8d88b0b` / rc2 收音与清队列修复，不能回到默认分支旧音频行为。
- 当前现场仍为 `1.5.2-duplex-rc2`。历史用户确认仅覆盖 rc2、1 米、音量 75 / 增益 1.6 的播放与自然插话，不外推到本候选。

## 已实现

- 当前通话的可信 robot adapter 共用 `lib/device-requests.mjs`：前台 `look` / `robot_action`、后台 `robot-use` 都经同一 owner、deadline、取消、拒绝和回执路径。
- 后台描述符直接给出产物内 `skills/robot-use/SKILL.md` 和 CLI 路径，不依赖生产 workspace 安装。Skill 入口短，视觉、动作、Reaction 细节按需读取，不授予账号权限。
- `robot.observe` 只接受当前请求的真实 HTTP JPEG 上传；MCP 文本不能伪造照片成功。挂断、超时、重复上传、旧请求和晚到视觉结果拒绝生效。图片不写日志。
- `robot.move`、`robot.gesture`、`robot.cancel` 只启用固件实际探测到的 yaw/pitch 两轴；无 roll。命令不重试；完成需要同 owner/request、真实舵机反馈、目标角度及动作步数。反馈丢失撤销本通话的动作能力；新通话重新探测，不重放旧动作。
- 固件有界状态机、真实 `ReadPos/ReadMove` 反馈、限位、截止时间、断线取消；手控优先于 idle / Reaction 动作。相机忙时拒绝并发，不能退回音频主线程执行。
- Reaction 复用 H5 的 `createAvatarReactionSelector` 语义选择，仅映射到已有 35 种机器人表情。工具任务 badge 与情绪选择分离。

## 证据与边界

- 本地最新全套 **923/923** 通过，包含共同能力刷新增量。SeedDuplex / Grok fixture 验证动作等待回执期间 PCM 上行仍工作；不是实际模型音频或真人插话验收。
- 固件 ESP-IDF 5.5.4 完整构建通过，CMake/CTest 两个目标通过；依赖 patch 在原始依赖上 `git apply --check` 通过。
- 私有 Candidate 的实际 runtime Skill loader 已发现 `robot-use`，eligible=true，来源 openclaw-workspace。真实后端模型 → Skill → CLI → 当前通话模拟固件的测试仍在完善；模拟固件不能证明物理完成。
- 新固件真实拍照、可观察点头/摇头、播放中插话及后台动作全链路仍待本路 Candidate 验收。用户已表示机器人在手边，环境准备好后通知其测试。
- 私有证据在本机 `Documents/Codex/stackchan-capabilities-20261025/private`；凭据、个人入口、图片和日志不进 Git。

## 公共接入点

`session.mjs` / `tools.mjs` 只增加小型 robot 工具调用及按 terminal.kind 选择 Skill；`server.mjs` 注册 robot operations 和可信回调 URL。执行、拍照和 MCP 适配集中在 `lab/robot/`、`device-endpoint.mjs`、`xiaozhi-wire.mjs`。无 Gateway / Worker runtime 改动；正式集成若需平台改动另走平台 PR。

发布前由总控按实际交付更新首页 `changelog.mjs`、`CHANGELOG.md` 与版本登记；当前候选不提前写成已上线。
