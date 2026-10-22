# 小／中／大灵动岛 Candidate

2026-10-22。按 Tianyi 在灵动岛设计聊天最终确认的方案实现；与 App 内 H5 壳共用同一原生通话和本通话全文阅读，不重做 H5 UI。

## 交互

- 小：V＋一个明确状态图标。方案未读时为文档图标；点入本通话方案，长按由系统展开。
- 中：Reaction、真实声音能量快照、挂断。点波形区切到大。
- 呼叫中：小岛在 V 右侧明确显示「呼叫中」与电话图标；中卡显示「正在呼叫 V／接通后就能开口」和取消连接，准备收音成功后才变成音频卡。此处是首个 ActivityKit 内容，不把 iOS 自身在启动 AppIntent 前的过渡动画算作 App 可绘制区域。
- 中卡波形铺满头像与挂断之间的可用宽度：27 根细柱呈现原有 9 个真实能量采样的插值，柔化两端、保留中部高度，以 0.55 秒过渡衔接快照。没有提高后台发布频率，没有循环假波形；无声／过期／熄屏回到静态细线，减少动态效果时取消补间。
- 大：Reaction 陪着两行正文；有方案时明确「查看全文」，正文是现有 CallDestination 深链。左静音、右结束；正文行右侧折叠箭头回中。
- 小↔展开由 iOS 决定；中、大是 expanded 内的两个布局。没有强制常驻或三秒收起计时器。新方案将 expanded 内容切成大，后台首次到达请求一次系统提醒（标准系统提示音）；实际是否展开／响铃由 iOS 管理，不作必现承诺。
- 后续修复候选：首次后台接通在实际收音准备完成后请求一次系统提醒，默认 expanded 内容是中卡；前台接通消费此次事件，切后台或重连不会补发。已有方案时保留大卡，不由接通事件覆盖。`island.attention.requested` 仅记录 connected/document 类型，证明 API 请求，不能证明系统已展示。
- 锁屏仅通话状态／通用「有方案待查看」，不暴露原文或方案标题。stale 隐藏旧波形与语义表情。结束沿用现有 immediate 移除。

## 集成合同

`CallAttributes.ContentState.island: IslandSnapshot` 包括 `layout`、已允许的 `reactionID`、最多 9 个 0～100 能量值、`audioSource`、`sampledAt`。旧内容没有 island 字段时仍可解码。数据不包括图片字节、音频、cookie 或权限。

`CallCoordinator+Island.swift` 提供：

- `selectIslandLayout(_:callID:)`：仅当前 active presentationID 可切；不会启动或结束录音。
- `observeIslandAudio(_:outputRMS:)`：从现有 onInput 回调传入 RMS；输出使用 `VoiceAudio.playbackRMS` 的实际播放器样本位置。保留九个约 100 ms 能量峰，最多每秒请求一次更新。
- `islandSnapshot(documentID:)`：投影；新的未读方案默认大，用户手动折回中后不会被同一方案反复打开。
- `islandDidDisplayReaction(_:owner:)`：仅当前 owner 且 App 活跃时接受已知 catalog ID。原生头像已接实际 displayed 回调；H5 壳再接真正 onDisplayed 的白名单消息。
- `publishIslandActivity()`：仅刷新活动快照。

H5 新消息建议 `avatarDisplayed`，body 只需 `pictureID`（事件的 picture）。由 host 检查 trusted local main frame、foreground/visible、当前 owner 后调用 `call.islandDidDisplayReaction(id, owner: owner)`。不要为活动额外发模型请求，不把 pictureID 用作 actor／工具权限。后台复用最后仍有效的表情或确定性状态图；五秒或下一轮发言后回退。

现有 H5 的 `onOpenURL`／pending document 用 `CallDestination`，活动不用自己的 WKWebView。阅读实际发生后再 content-shown；过期或跨通话 ID 不得新拨号。

## 与 H5 分支的合入方式

基线 f1f0600，独立 `codex/voice-island-three-sizes` 开发。CallCoordinator 的展示挂点已包含在提交，但未写入 H5 聊天的工作目录。cherry-pick 如遇冲突，保留 H5 新方法与修订，再加入这些小挂点，不能把整个文件替换成旧版。

项目源 `ios/project.yml` 不需添加新路径：共享 SwiftUI 在 Shared，测试在 Tests，扩展图片 catalog 在 Widget，全部由既有 source 目录覆盖。主聊天保留自己的 H5 folder resource／build 9 配置，然后重新 `xcodegen generate --spec ios/project.yml`，不要拿本提交的旧版生成 project 覆盖 H5 成员。

DEBUG 视觉检查可在主 App 的 root 添加仅 Debug 的 `--island-preview` 分支显示 `IslandPreviewGallery()`，以 `--local-voice-fixture --island-preview` 启动。该预览使用真实共享 SwiftUI，owner 固定不匹配通话，按钮不能结束真实会话；它不是系统 ActivityKit 展开行为的证据。

## 资源与验证

52 张原图语义全部保留；`ios/scripts/sync-island-assets.py` 将既有原图缩到最多 192 px、供 56～64 pt 活动头像使用。`--check` 核对源图／产物散列、Core ID 白名单及源 catalog，一共 52 张。扩展 catalog 在 Widget 目标，主 App 继续用原图库。

- `swift test --package-path ios/VVoiceCore`：15 项通过，含 5 项新测试：新方案与手动折叠、旧 owner、表情 TTL／轮次、音量静音与过期／节流、实际播放游标／接通 cue／clear 归零。
- XcodeBuildMCP simulator build：通过，无警告。
- `xcodebuild … build-for-testing`：通过，仅编译，未占用另一聊天的模拟器 UI。
- 新增 3 项 App XCTest：旧快照兼容、完整静动态负载预算、允许的 ID。交给合成候选统一执行，不将编译通过当作已运行。
- 没有改 AudioRecordingIntent、audio session、engine 启停、原播放队列、打断或重连决策。VoiceAudio 仅加独立能量索引与只读 cursor 查询，在现有 clear 中清理索引；接通 cue 帧数跳过，不当成 V 的语音。
- 未拨真实电话、未调用付费模型、未改生产／Gateway。真机后台长通、ActivityKit 刷新、提醒时机、锁屏按钮认证、最终 H5 深链与双向对话仍需分别验收。

官方依据：[HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities)、[ActivityKit](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)、[活动交互](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)。

## H5 合成结果

最终合成 App 源码 `36f380f`，build 9 签名并覆盖安装。H5实际displayed白名单桥已接通，旧owner／遮盖页拒绝测试通过。系统大卡裁切在合成测试发现并修正：取消独立trailing区，正文52pt，折叠放入正文行，底部44pt控件完整。Core15／native36／service79通过；实际系统中→大不打开App、静音、方案→同一H5全文已用无模型fixture验证。完整系统层证据在 `evidence/build9-island-conversation-mirror.png`，不能以原生漏层截图替代；手机人工接受仍待定。

用户随后真机反馈只见小态、中大从未出现，进一步操作后确认「长按后能展开卡片」。代码核对确认 build 9 没有接通提醒；既有模拟器证据是手动长按岛本体后展开，不代表接通自动展开。另确认普通 assistant final 长回复虽然生成全文，却未走原来仅 backend.result 使用的提醒路径；修复候选已接入同一 resultID 去重提醒，不改变本地文档的回执权限。新修复候选与手机已安装 build 9 分开记录；中→大手动切换及新的自动提醒仍需真机确认。
## 后台报告自动大卡修复候选（build 15）

以已装机并接受的 build14（源码2adca2a，登记6282e32）为基线。用户明确报告生成时在桌面／其他App。只读设备生命周期能看到 document 提醒请求，不能据此声称系统已展示。

- inactive 过渡不消耗报告提醒，进入 background 后检查尚未读的报告再请求。
- 每份报告按实际内容去重；同一个任务的报告更新后重新切大。用户手动折叠后，同一内容的重复同步不会抢回大卡。
- 发出报告提醒后的六秒内暂停非必要 ActivityKit 快照；不展示波形的大卡不再随能量变化刷新。静音、手动折叠／展开、结束与异常状态立即生效，前台阅读释放保护。
- 通话在后台也从既有 presentation 接口同步报告，补足 relay 漏投递后的恢复，不新建语音会话／模型请求。
- 系统自动展示大卡后仍可收回。代码不会强行常驻，也不反复发相同报告提醒；长按小岛仍能查看最新报告大卡。

本地系统层已在没有长按操作的场景读到「查看全文／收起文字／静音／结束」，连续真实镜像帧捕获了自动大卡及随后系统收回，见 VALIDATION.md 与 report-island-build15.json。不是原生预览组件或设计图。

## build 16 当前回答字幕与启动品牌候选

- 大卡在V播放语音且存在当前轮assistant字幕时优先显示最后三行。使用CoreText按实际可用宽度取三行，随既有600ms字幕发布节流更新；Widget不提供原生ScrollView手势阅读，全文通过App继续阅读。接收的字幕可能先于播放，不宣称逐字音频同步。普通回答不主动改变用户已选中的音频／文字布局，也不增加自动展开提醒。
- 有未读方案时入口固定在底部中间；切换说话／听取状态时保持文字区最小高度，避免按钮位置跳动。左侧Reaction、静音、结束仍保留。锁屏样式允许V字幕，标记privacySensitive并沿用关闭灵动岛预览设置，系统决定实际隐私遮盖。
- AppIcon原图未重画，改以VVoiceAppIcon资源名声明，补充NSAppIconActionTintColorName／NSAppIconComplementingColorNames以及AppShortcutsProvider紫色tile。App自有connecting首帧用同一原图。用户确认使用V Voice自带「和V通话」入口；未改AudioRecordingIntent、权限、后台入口或perform逻辑。AppShortcuts公开接口的图标参数为SF Symbol，系统前置启动提示不能作为可任意绘制的App卡片；旧系统缓存是否刷新需真机验收，不能以包内图标正确代替。
