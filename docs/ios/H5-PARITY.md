# H5 → iOS 功能与交互迁移核对

核对日期：2026-10-22。本轮候选 build 8；基线是 build 7 / `1916868`。核对对象是本分支 `lab/gpt-live-h5` 的实际实现，不把“颜色相似”“图库齐全”当成完整迁移。当前结论：**尚不能称全部 H5 能力迁移完成**。原生 GPT Live 音频未接入；灵动岛 Reaction／真实波形／完整卡片状态在独立设计任务中，未随本轮交付。

本次只改 iOS 客户端、离线资源同步及本地协议 fixture，使用既有 Voice API，无 Gateway、权限、会话路由或服务端协议改动；适用本地 Candidate 验收。未合入、未推送、未部署电话服务。

## 查到并修复的遗漏

1. **人类的条子消失**：多人路由时服务端刻意抑制 provider 的用户 `transcript`，改发 `speaker.utterance` / `speaker.decision`。build 7 的 `CallCoordinator.handle` 没消费后两者，导致人类文字和多人内容没有进入原生会话。build 8 接通相同 relay 后消费真实事件，未修改输入策略、PCM 或后台录音 Intent。
2. **连续多人发言只剩最后一人**：原生 current 从最后一条 user 开始，H5 `splitTurns` 会回溯所有相邻 user。现在按 H5 保留同一轮连续人类发言，decision 更新原 ASR 时间段对应的行，不新造重复气泡。
3. **身份、颜色、旁聊与识别提示**：补齐服务端说话人姓名、建议姓名“可能是”、Speaker A/B、五种颜色、仅倾听、在听谁、识别重连／恢复、声音重叠、道别失败的操作提示。身份只用于展示，不能授予工具权限。
4. **阅读位置与空间**：补齐滚动钉住底部的行为；用户上翻时新字幕不抢走位置。头像因内容溢出缩小后保持到下一轮；之前三条发言带身份淡化显示。“在想”提示最多 12 秒，避免永久显示。
5. **普通回复的交付物**：完整方案不只来自 `backend.result`。长回复、带标题长文和媒体现在也有可展开卡片，并保留原文；不会拿本地卡片 ID 冒充后台 `content-shown` 回执。长回复仍进入 Reaction 上下文。
6. **富文本与媒体**：对话行与阅读器共用 H5 的 GFM lexer；补齐标题、列表、任务清单、表格、代码、引用。媒体支持相对链接、裸 URL、重复去重和图片失败重试。HTML 作为文字，不能执行。
7. **模型与声音 UI**：读取服务端模型可用性、名称、Grok 声音列表与语速／表达提示；所选声音进入 session 请求。已有样本的场景选择、实时／独立合成、盲听、偏好与输入／返回台词已迁移为原生试听页。播放样本不创建实时通话、不触发合成；Action Button 开始通话后停止试听，让正式通话接管音频。
8. **其他交互**：任务步数、多个任务计数、挂断后任务继续提示、文字补充排队回执、App 前台通话常亮、同源 H5 历史更新日志。排队回执只说明已交给后台，不能显示成任务已应用或完成。

## 完整清单

“已实现”是代码／本地协议状态；“真机待验”不会因 fixture 通过变成真实模型验收。

| H5 功能／交互 | H5 所有源 | 原生对应与状态 | 验证与剩余限制 |
| --- | --- | --- | --- |
| 个人入口、权限、身份映射 | `app.js`、`server.mjs` | 钥匙串绑定、mic / Live Activity 授权；沿用服务器身份 | 既有绑定保持；无新权限路由 |
| 首屏、连接／取消、挂断回首页 | `ui/call-ui.jsx`、`styles.css` | `CallView`，同头像、调色与 Avenir 字体 | 原生系统菜单／sheet 为平台适配，不称逐像素相同 |
| 手机／宽屏、键盘布局 | 同上 | 701pt 分界，iPad 双栏，键盘安全区与头像收缩 | iPhone 和 iPad 模拟器；无实体 iPad 验收 |
| 小何／Grok 实时音频 | `relay-audio.mjs`、`app.js` | `VoiceAudio` / `RelayTransport` | 既有真机通话已验收；本轮本地 capture／playback／mute／redial 回归 |
| **GPT Live 实时音频** | `app.js` WebRTC / data channel | **未迁移**；菜单显示不可选及原因 | 需要独立原生音频传输接入；不能用网页嵌套或其他模型冒充 |
| 服务端模型可用性 | `initializeEntry` | `refreshOptions` / `VoiceModelMenu` | 本地配置与拨号请求测试；真机服务端展示待验 |
| Grok 声音／语速提示 | `GrokPicker` | 原生 picker，带 voice 请求 | 本地请求已核对；声音听感须人工验收 |
| 已有声音试听／盲听／台词 | `comparison.mjs`、`listening.mjs` | `VoiceComparison` / `ComparisonPlayback` | 本地 WAV 与通话接管测试；未试听真实服务样本 |
| 用户／V 部分与终稿字幕 | `transcript-presentation.mjs` | 有界原生行，partial 更新、final 不覆盖下段 | 普通 relay 及 speaker 两类输入均测 |
| 多人 ASR、decision、身份更新 | 同上、`call-view.mjs` | `SpeakerPresentation`、ASR 时间段归属与每流去重 | 真实协议 fixture；**实际多人识别质量真机待验** |
| 建议姓名、五种颜色、仅倾听 | `Turn`、`speakerDisplay`、CSS | 原生姓名／颜色／状态，听的人物光晕 | 代码、事件链路和渲染核对；不做本机声纹推测 |
| 当前／全部／淡化之前发言 | `Conversation`、`splitTurns` | 连续 user 同轮，之前三条含身份，全部展开 | 原生展示；上翻不被新字幕拉走 |
| 文字补充、成功／排队／失败 | `sendSteer`、`Controls` | 原生输入与既有 steer；排队回执不夸大 | 本地 steer；发送成功收起键盘，失败保留文字 |
| 静音／结束／系统暂停恢复 | `Controls`、`relay-audio.mjs` | 原生控制条、Intent | 本地真实录音引擎；物理锁屏与按键需本轮人工复验 |
| 自然道别、播完再结束、撤销 | `app.js`、relay end events | 既有 end.after-playback / end.cancelled | 原生协议回归；不是仅看文本就算真实语音通过 |
| 任务状态／进度／步数／时间 | `TaskSheet`、`resolveStatus` | `CallTask`、任务面板与多任务计数 | 本地事件／presentation；任务执行结果由后端决定 |
| 取消后台任务 | `cancelTasks` | 既有 steer cancel，等待后端确认 | 不直接宣布已取消完成；挂断不取消已接纳任务 |
| 方案下发与丢事件恢复 | `startPresentationRecovery` | 后台 result relay + 前台 presentation poll | 既有恢复测试；后台不为 UI 定时唤醒额外录音 |
| 完整报告卡片／长回复／媒体 | `contentItems` | 后台及普通长回复共用 `CallDocument` | 本地长文／表格／代码／媒体解析；卡片与详情保留原文 |
| 自动展示后台长方案 | `createContentView.render` | 仅 App 已在前台且未覆盖时展开 | 灵动岛后台结果不会强制打开 App；每份只自动展开一次 |
| 方案读后回执 | `documentShown` | 原生首块可见且前台后 ack，防旧 owner | 本地真实 HTTP 回执；本地长回复卡片不发伪回执 |
| GFM / 安全链接 / 原样 HTML | `markdown.mjs` | 同 lexer、原生 blocks，白名单链接 | 本地表格／代码／HTML 不执行测试 |
| 图片／视频／混排／重试 | `media-references.mjs`、`content-view.mjs` | 原生 image / AVPlayer，去重、相对 URL、图片重试 | 解析测试与 UI 核对；**实体手机媒体播放与通话共存待验** |
| 收起方案／保留通话控制 | `content-view.mjs` | 原生 reader 及底部控制条，音频实例不换 | 已有 reader / capture 测试；系统 sheet 动效为原生适配 |
| 保存结果 | `readerDownload` | iOS ShareLink 分享／保存正文 | 平台适配；不是浏览器同名 .md 下载器 |
| Reaction 全图库／语义／后续姿态 | `avatar*.mjs` | 52 图／15 情绪、语义接口、continuations、dwell／fade | build 7 已补齐；本轮新增人类文字、长回复进入上下文 |
| Reaction 可见性与观测 | `avatar-telemetry.mjs` | 仅可见时选择，显示后事件、队列／批次有界 | **观测重试策略未逐项等同 H5**：native 失败批次可丢，H5 有 gap／重试。非展示或授权路径，未称完全等价 |
| 更新日志 | `changelog.mjs` | 同源 JSON 自动同步，另列本机候选交付 | sync --check 与 Release 包核对；历史注明网页／服务范围 |
| 常亮、减少动态效果、无障碍 | wake lock、CSS、ARIA | 前台通话 idle timer、Reduce Motion、原生 labels / selection | 原生适配；长通话电量、VoiceOver 全流程未人工验收 |
| 错误、断线、重拨、429／409 | `app.js`、`speakerDisplay` | 有限恢复、明确 busy/rate-limit、识别异常操作 | 本地录音／网络恢复测试；不自动付费拨号 |
| 灵动岛文字／方案／静音／结束 | H5 无系统表面 | 既有 ActivityKit + Intent；本轮姓名摘要补齐 | 旧版物理按键通话通过；本轮不改 Intent 或录音入口 |
| **灵动岛 Reaction／真波形／卡片状态** | H5 内容的系统表面映射 | **独立设计任务中，未实现／未安装** | 另一个聊天只读稳定路径，独立原型，不替换后台通话 |

## 验收边界与容量

- 自动测试只连接 `127.0.0.1` 的协议 fixture，不调用真实模型、拨号或工具，不证明真实 speaker 识别／听感质量。
- 当前文字为内存暂存：最多 80 行、合计 64k 字符；单段转写 8k，交付文档 60k、最多 16 份；说话人名册最多 32 人。无永久转写历史。H5 本身也非永久历史库，但原生额外有上述容量限制。
- 物理手机更新前只读核对 activeCalls、creatingSessions、backgroundTasks；有活动就不覆盖正在通话的 App。既有绑定与数据通过覆盖安装保留。
- 稳定后台能力的基线是 build 5 的用户确认：桌面长按操作按钮、留在灵动岛、正常双向对话。构建／包元数据验证只能证明本轮没改成打开 App，不能替代本轮真实按键验收。
