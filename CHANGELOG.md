## Candidate - Compact multi-speaker status

- Keep the current person and active search/background work on one line; shorten Speaker notices and truncate long names without expanding the footer.
- Show recovery/errors in place of routine work text while preserving the task cancel control and full accessible text.
- Source integration only; this PR does not activate a production release.

## 2026-10-20 - Pickup greeting and retired call ownership

- Correct the personal name to Tianyi / 天懿 in native voice prompts, greetings and tool descriptions; entry IDs and account permissions stay unchanged.
- Restore the native Seeduplex welcome without requiring a registered voice or first utterance; caller speech supersedes a pending greeting.
- Reconcile web entry ownership with the direct transport registry before admission, releasing fully closed calls while preserving live and cleanup-pending sessions.
- Mobile latency remains under investigation; these repairs do not claim a fix for international media transport stalls.

# Voice release log

## Voice · 20261020 long calls and robot multi-speaker · source main

- 长通话：工具等待期间不挂断，结果回来后重新计时；慢查询播进度提示，查询失败、结果未播、识别卡住各说一次（#34）。
- 机器人/音箱接入流式多人识别，设备级开关；StackChan 使用固件近场门，服务端门关闭（#35）。
- 一周断线审计与插话回归测试（#36）；本地飞书未配置时不声明日历/飞书工具（#37）。
- Gateway 重启期间启动等待，不再崩溃重启（#38）；设备可配置追问窗口（#39）。
- 网页电话恢复 10-19 的豆包流式多人路由（10-20 02:44 曾回滚到 d37ac851）。

## Voice · 20261019 streaming multi-speaker · source 931c30e

- 豆包流式匿名 Speaker、对话关联姓名和角色、语义接话与原生语音并行；不改变工具身份。
- 主机确认自然告别并等待真实播放回执；挂断和后台任务分别管理。
- 保留正式入口记忆、搜索、Reaction、后台交付和发布空闲检查，GPT Live/Grok 不启用 Speaker 路由。
- 正式公网保留原生20ms上传；云端ASR独立聚合有界100ms，逐字节保持输入顺序及末尾数据。
- 首轮混合验收失败后实际回滚，修正版通过正式产品页混合恢复与后台取消、告别闭环。
- Linux 独立声线进程和模型 SHA256 校验；通过配置关闭，保留原正式产物及独立服务回滚。

## 2026-10-16 — Homepage notes and safe Voice entry publication

Restore the missing October 16 homepage release notes and make product-facing notes a release preflight requirement. Authenticated status now exposes whether active calls, session creation, or pending backend delivery prevents an entry cutover. Persist only bounded causal event metadata and numeric playback counters to distinguish received speech, tool waits and missing output; no tool arguments, result bodies or audio are added.

Production entry `d37ac851` is active, registered in [current.json](docs/releases/current.json). [Platform #396](https://github.com/vegekyd-sys/v-openclaw-platform/pull/396) adds the entry publication guard and verified legacy graceful-drain migration. The old H5 exited normally; no forced kill, Gateway restart or config change. All 177 package hashes and the unchanged plugin bytes match. Candidate checks: 80 Voice and 12 controller tests. The public homepage shows October 16 notes with no browser console errors. Late-result replies and busy natural hangup remain separate unresolved tasks; physical iPhone Safari was not retested.

## 2026-10-16 — Voice #23 farewell wording

GPT Live may say “再见，下次再聊” after an accepted caller hangup request. The page now recognizes that equivalent variant alongside “再见，下次聊”, while retaining host authority, current-user ownership, a terminal assistant turn and actual audio drain.

Production entry commit: `bcb82987c7cc6c61e87ecc9f28c320df6bfb470b`. Gateway plugin stays at `a9ac516860a8856470262957ad6ea0cc2670cb0e`, byte-identical to the new package for plugin/lib/server files; only frontend app.js changed. No Gateway restart or config change.

Both GPT Live and SeedDuplex synthetic natural calls automatically returned to idle with reset transcript and no browser errors. The recorded alternate farewell passes exact replay; live GPT used canonical wording. Physical iPhone Safari and unrelated backend/media tasks were not retested. First entry activation was rolled back after a controller receipt failure; the second passed all original guards. See [registration](docs/releases/voice-bcb82987-20261016/manifest.json), [current version](docs/releases/current.json), and [PR #23](https://github.com/vegekyd-sys/v-voice/pull/23).

## 2026-10-16 — Task continuity baseline

The earlier accepted task-continuity baseline uses Voice `a9ac5168` and the platform core release `v2026.9.1-db91.6-voice-task-continuity-20261016-r3`. Its five core file changes, shared VLab and production child-task/Feishu delivery acceptance, full captures and Voice registration are recorded in [platform release #394](https://github.com/vegekyd-sys/v-openclaw-platform/pull/394).

## Candidate development history

## Candidate · speaker-stream-linux.20261019.5

- 修复后台任务进行中、刚与孩子或另一人物聊天时，自然告别被旧对话重心压住的问题。
- 仅对已选中结束但不够确定的候选追加当前话语确认；普通对话仍为一次Decision请求。
- 告别确认不可用时保持通话；不改变工具权限或取消后台任务。
- 关闭流式多人模式中原生模型抢先挂断的旧路径，主机未确认时不能结束电话。
- 明确取消后台任务或切换话题仍可接话，不被静默门控拦截。

状态：独立 Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.4

- 自然告别优先于多人静默判断；小何原生告别音频实际播放完后才挂断。
- 对旁人道别、引用、否定挂断、告别后继续提问保持通话；新语音可撤销挂断。
- 防止提前、错误或过时的播放回执结束电话；无告别音频时保留电话并允许重试。
- 增加真实语义、浏览器告别、长时重连、媒体并发隔离和重叠后恢复的验证工具。

状态：独立 Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.3

- 修复 ASR 首句零时间戳被省略时漏句，短暂断连自动恢复并校正时间轴。
- Speaker 致命错误及时关闭音频通道，避免继续上传到失效路由；保留已受理后台任务。
- 候选音频按100ms合批，减少消息开销，并记录上传峰值及后台生命周期。
- 独立产品 Gateway/Worker 恢复 Memory Search、Web Search 和真实后台处理，使用私有记忆快照。
- 增加两声线在真实后台运行期间及完成后继续对话的端到端验证。

状态：独立 Candidate，未合入及未发布线上。验收见 `docs/experiments/speaker-background-2026-10-19.md`。

## Candidate · speaker-stream-linux.20261019.2

- 修正跨通话累计判断/音频预算和五分钟静默过期；每通独立限制，最长三十分钟。
- 不确定声线、混合语音和判断失败采用简短澄清；原生已获准问题增加无输出恢复。
- 自动多人静默增加置信度与明确向 V 发问的交叉检查，交接请求简短确认。
- 同人物连接准备复用；较早判断不再取消更新的已定稿问题。
- 新声线需要两个一致窗口，片段内身份不来回改号；已知声线使用有限高置信参考样本。
- 增加有界、无音频/声纹/聊天正文的分阶段诊断，仅用于独立 Candidate。

状态：Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.1

- 将豆包流式多人候选部署到独立 Linux 服务，服务端识人、ASR、Decision 和原生语音不依赖 Mac 或浏览器推理。
- 增加受保护的 HTTPS 候选入口，沿用既有入口鉴权与服务端会话绑定。
- 改善 ASR 漏掉被叫人姓名时，对人际生活实物协作的安静判断；明确向 V 询问能力仍可回应。
- 验证脚本复用授权 Cookie，并逐项检查多人对象、旁话、排他和真实原生音频；失败收据保留。
- 候选首页日志仅在该独立入口展示，正式已发布列表不加入实验能力。

状态：独立 Candidate 已部署，未合入、未发布生产。版本元数据见 `lab/speaker-native/linux-release.mjs`，实际验收见 `docs/experiments/speaker-stream-linux-2026-10-19.md`。
