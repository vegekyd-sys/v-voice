# 小／中／大灵动岛 Candidate

2026-10-22。按 Tianyi 在灵动岛设计聊天最终确认的方案实现；与 App 内 H5 壳共用同一原生通话和本通话全文阅读，不重做 H5 UI。

## 交互

- 小：V＋一个明确状态图标。方案未读时为文档图标；点入本通话方案，长按由系统展开。
- 中：Reaction、真实声音能量快照、挂断。点波形区切到大。
- 大：Reaction 陪着两行正文；有方案时明确「查看全文」，正文是现有 CallDestination 深链。左静音、右结束；上方折叠箭头回中。
- 小↔展开由 iOS 决定；中、大是 expanded 内的两个布局。没有强制常驻或三秒收起计时器。新方案将 expanded 内容切成大，后台首次到达请求一次系统提醒（标准系统提示音）；实际是否展开／响铃由 iOS 管理，不作必现承诺。
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
