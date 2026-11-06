# 分享给 V（iOS Share Extension）

2026-11-06 CST，分支 `claude/ios-share-to-v-97a2af`，基于 main `1489710`。草稿，未发布、未上 TestFlight、未合入。

## 用户看到的

1. 在相册或任何 App 里选图片或视频（最多 9 个），系统分享面板里出现 V Voice。
2. 进入「分享给 V」。这一页是和 V 对话的开头：最上面是 V 的头像（倾听姿势，白边加柔光，和通话页同一套样式），旁边是她的一句“收到 3 张图片，想让我怎么用？”；下面是“你”的一轮，先是缩略图，排法和对话里的一样，再下面是一个可以直接输入的附言气泡。还有三个快捷附言（做成一段视频 / 帮我修得更好看 / 做成一张海报），点一下只是填进附言，不做任何判断。点右上角粉色的「交给 V」发送，扩展会打开 V Voice。配色取自共用 H5（#2a2030 / #eee7f4 / #d74970），固定为浅色。
3. **正在通话**：对话里出现一条“你”的消息，上方是缩略图，下方是附言。V 接着处理：
   - 附言写明了要做什么：直接开始，不再先问一句。豆包会先说“好，我按你说的处理这 2 张图片。”，任务进度照常显示，结果回到同一段对话。
   - 没写附言：V 问“收到你分享的 2 张图片了，想让我怎么用？”，不会生成。
4. **不在通话**：交给 V 的后台任务处理。首页拨号区下方出现「最近分享」：封面图、张数、附言和状态（正在交给 V / V 正在处理 / 已完成 · 结果已发到飞书 / 没有完成 / 结果未确认）。点开后，在 H5 阅读器里看 V 的处理结果。结果同时发到你绑定的飞书会话。
5. 交接失败（没绑定、网络、入口失效、类型不对）时，提示出现在 H5 已有的位置：首页的 home note，或通话中的状态提示。没有原生 banner。
   - App 只显示分享接口自己写的原因（回复带 `scope: "share"`）。如果连到还没有分享接口的旧服务，旧服务会把上传当成通话请求，回一句“这次连接没有完成，请重新开始通话。”。这句不能拿来当分享失败的原因，所以 App 改为显示“现在连接的 V 服务还不支持分享，这次分享没有发出去。”。这是 2026-11-06 build 42 真机上发现的问题。

## 链路与归属

| 环节 | 归属 | 说明 |
|---|---|---|
| 分享面板入口、选图、附言、App Group 交接 | iOS `VVoiceShare` 扩展 | 不持有 cookie，不发网络请求。图片重编码为 JPEG，最长边 2048，去掉定位等元数据。视频原样拷贝，上限 200 MB。每个素材另生成一张 240 px 的缩略 JPEG（视频取首帧） |
| 上传与交付 | 主 App `ShareDelivery` | 复用 `VoiceAPI` 的绑定 cookie 和不跟随重定向的会话。不发送 voiceSessionId，由服务端判断当前是否在通话。只负责数据，不画界面 |
| 收素材 | 共用 Voice 服务 `POST /api/share/media` | 只开放给已确认身份的入口。按字节嗅探 JPEG/PNG/MP4/MOV。素材归上传者所有，只能使用一次 |
| 素材链接 | `GET /share-media/<随机 token>` | 256 位随机能力链接，6 小时过期，`no-store`，供 Makaron 拉取参考图 |
| 对话里的消息 | 服务端 native-runtime 新事件 `user.share` → 已有的 `conversation.row` | 这一行带 `media`：张数，以及最多 4 张内联 JPEG 缩略图（data URL，每张不超过 24000 字符，不是 URL）。iOS 的 `ConversationMedia` 做同样的校验。网页和 App 共用 H5 的 `SharedMedia` 组件渲染 |
| 豆包直接开做 | `directVoice.share` → 同一个 `onToolCall('delegate_to_v')`，标记为 `hostInitiated` | 豆包不会回应注入的文字，所以由服务端启动同一个后台任务。这时没有原生函数调用需要回执（用 `adoptBackgroundTool`，不调用 `submitToolResult`）。手上已有任务时只做确认，不排队 |
| Grok 等 | 现有的 `bridge.sendUserMessage` | 模型收到分享后自己调用 Makaron |
| 最近分享 | `GET /api/shares`、`GET /api/shares/<id>`；服务端 `share-records` | 按入口记录（binding id + 会话），保存在服务端，重装 App 不丢。保留 7 天，最多 20 条。超过 20 分钟仍没有结果的记为“结果未确认”。列表不带结果正文，点开时单独读取 |
| 不在通话的执行 | 现有 `createBackendDelegation` + `createTaskDelivery` → `voice.product.task.start` | 目标是入口绑定的飞书会话，附言不能改目标或扩大权限 |
| 多图做成一段视频 | 通话内的 Makaron 执行器 | 一个视频最多带 4 个 `--image`，每张都要用 `<<<media_k>>>` 引用 |

没有新增 Gateway RPC、Agent 工具或权限。Swift 端没有新增模型、provider 或关键词分支。旧 App 不认识 `media` 字段，会直接忽略。

H5 的两处顺带修正：

- `native-h5` 原来在每次空闲快照时都会重置阅读器，现在只在通话结束时重置。否则在首页打开的阅读器会被打开本身引发的快照立即关掉。
- 首页有分享记录时，头像缩小一些，记录只显示最近 1 条，保证首页在一屏内。首页内容超出一屏时，WebView 会滚动，从首页打开的阅读器标题会被顶到状态栏下面。

## 开关

服务端默认关闭：设置 `VOICE_SHARE_TO_V=1` 才启用。目录默认是 `OPENCLAW_STATE_DIR/state/voice-share-media`（下设 `media/` 和 `records/`），可以用 `VOICE_SHARE_DIR` 改。

## 已在模拟器验证

本会话自建的独立模拟器（iPhone 18 Pro，iOS 27.0）+ 本地 fixture `ios/scripts/shared-duplex-fixture.mjs`：真实的 `server.mjs`、真实的 seeduplex 适配器，上游和 Gateway 都是模拟的，没有调用模型、Makaron、飞书，也没有付费请求。截图在 `docs/ios/evidence/share-to-v/`。

- `1-share-sheet.png`、`2-compose.png`：分享面板出现 V Voice；扩展页显示 V 的头像和她的一句话，下面是 3 张缩略图和附言气泡（点了快捷附言“做成一段视频”）。点「交给 V」后，扩展打开了 V Voice。
- `3-in-call-row.png`：通话中分享 2 张图并附言“做成视频”。对话里是“你”的一行：2 张缩略图加附言，状态显示“后台处理中”。fixture 收到 V 的开口句“好，我按你说的处理这 2 张图片。”，后台任务启动了 1 次。
- `4-home-recent-share.png`、`5-share-result.png`：不在通话时分享 3 张图，首页出现「最近分享」（封面图加数字 3，已完成）。点开后在阅读器里看到 V 的结果（这里是 fixture 文本）。
- XCTest：`ShareToVTests` 7/7，覆盖以下几点：
  - 深链只接受扩展生成的 UUID。
  - 图片重编码会去掉 GPS，并限制尺寸。
  - 只交付已提交、未过期、文件名合法的分享。
  - 后台分享：素材链接不带 cookie 也能拉到；记录从“处理中”变为“已完成”，结果能读出来。
  - 通话中分享：生成带缩略图的对话行，并出现在 H5 快照里；豆包有附言时直接开做。
  - 通话中没有附言时只问不做。
  - 415 直接丢弃，断网时保留重试。

  另外回归了 `SharedDuplexFlowTests` 5/5、`H5ShellTests` 12/12、`NativeFlowTests` 44/44。
- Core：`swift test` 48/48，新增分享行只接受内联缩略图的用例。
- Node：`npm test` 1161/1161。`share-inbox.test.mjs` 覆盖嗅探、所有权、单次使用、过期、缩略图校验、两条交付路径、记录的 20 条和 7 天上限、丢失任务变为未确认；`media-cli` 覆盖多图视频校验。另外重新构建了 `ui-bundle`、浏览器 bundle、TV bundle 和 iOS H5 包，bundle 新鲜度测试全部通过。
- 已知的 fixture 限制：模拟上游不会为 V 的开口句生成音频，会话一直不空闲，所以通话中的后台结果在 fixture 里停在“后台处理中”。真实豆包说完这句后，结果会按现有规则回到对话。这一段没有在模拟器上看到。

## 需要真机、TestFlight 或线上才能确认

- **App Group 签名**：已解决。2026-11-06 build 42 用开发签名装到 Tianyi 的 iPhone，`verify-release.py` 通过（signed、profilesPresent、shareExtension）；主 App 和扩展都带 `group.com.versa.vvoice`，描述文件分别是 `com.versa.vvoice` 和 `com.versa.vvoice.share` 的 Team Profile。分发证书、TestFlight 的签名还没验证。
- **扩展打开主 App**：走的是响应链里的 `openURL:options:completionHandler:`。模拟器上可行，App 审核是否接受还不确定。打不开时，下次打开 App 会自动交付。
- **真实的通话体验**：豆包开口确认后，后台结果能否完整回到对话；Grok 收到分享后是否直接调用 Makaron；GPT Live 通话（没有注入通道，分享会交给后台任务，界面同上）。
- **真实的 Makaron**：能否拉到公网的 `/share-media/` 链接，以及 fal-h3-max 多图参考的效果。
- **大视频、移动网络、锁屏中断**下的上传。

## 发布前要做（本分支没做）

- 在首页 `changelog.mjs`、`CHANGELOG.md`、`versions.json` 里登记。
- 线上节点设置 `VOICE_SHARE_TO_V=1`，确认目录权限和磁盘空间。用 `release-fleet.py` 正常发布，不重启 Gateway。
- 这次改了共用 H5（对话行缩略图、首页最近分享），网页发布和 App 内置 H5 包会一起更新。
- build 号已经是 42（开发签名已装到真机，见上）。真机上要按上面的清单逐项验收；服务端开关打开之前，点「交给 V」会失败。
