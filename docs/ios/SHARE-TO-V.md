# 分享给 V（iOS Share Extension）

2026-11-06 CST，分支 `claude/ios-share-to-v-97a2af`，基于 main `1489710`。草稿，未发布、未上 TestFlight、未合入。

## 用户看到的

1. 在相册或任何 App 里选图片或视频（最多 9 个），系统分享面板里出现 V Voice。
2. 点进去是「分享给 V」：素材缩略图，加一句可选的话（比如“把这几张做成一段视频发到产品群”），然后点发送。
3. 扩展尝试打开 V Voice 主 App，由主 App 用已有绑定把素材交给 V，顶部提示交付结果：
   - 正在通话：素材进当前通话，提示“已把 N 张图片交给当前通话里的 V。”
   - 不在通话：交给 V 的后台任务，提示“V 会在后台处理 N 张图片，结果发到你绑定的飞书会话。”

## 链路与归属

| 环节 | 归属 | 说明 |
|---|---|---|
| 分享面板入口、选图、附言、App Group 交接 | iOS `VVoiceShare` 扩展 | 不持有 cookie、不发网络请求。图片重编码为 JPEG（最长边 2048），去掉定位等元数据；视频原样拷贝，上限 200 MB |
| 上传与交付 | 主 App `ShareDelivery` | 复用 `VoiceAPI` 的绑定 cookie 与不跟随重定向的会话；不发送 voiceSessionId，由服务端判断是否在通话 |
| 收素材 | 共用 Voice 服务 `POST /api/share/media` | 只有已确认身份的入口能用（`unidentified` 访客被现有白名单拒绝）；按字节嗅探 JPEG/PNG/MP4/MOV；图片 20 MB、视频 200 MB；每个访客上下文最多 24 个待用素材 |
| 素材链接 | `GET /share-media/<随机 token>.<ext>` | 256 位随机能力链接、6 小时过期、`no-store`、`noindex`，给 Makaron 拉取参考图。进程重启时清掉旧文件 |
| 进入通话 | `directVoice.share` → 现有 `bridge.sendUserMessage` | 素材作为来电者本人的一轮文字进入当前通话。豆包（Seeduplex）注入文字不会触发回答，所以 V 用固定句确认收到，并等来电者下一句开口再付费生成 |
| 不在通话 | 现有 `createBackendDelegation` + `createTaskDelivery` → `voice.product.task.start` | 目标是入口绑定的飞书会话（和通话一样）。附言里的群名不会改变目标，也不会扩大权限；Gateway 侧授权不变 |
| 出图出视频 | 现有 Makaron 执行器 / 后台 Agent 的 Makaron CLI | 通话内执行器现在允许一个视频最多带 4 个 `--image`，每张都要用 `<<<media_k>>>` 引用；改图仍是单张 |

整条链路没有新增 Gateway RPC、Agent 工具或权限。Swift 端没有新增模型、provider 或中文关键词分支。

## 开关

服务端默认关闭：设置 `VOICE_SHARE_TO_V=1` 才启用，素材目录默认在 `OPENCLAW_STATE_DIR/state/voice-share-media`，可用 `VOICE_SHARE_DIR` 改。没开时 `/api/share*` 返回 503，App 保留素材 24 小时并提示稍后重试。

## 已在模拟器验证

本会话自建的独立模拟器（iPhone 18 Pro，iOS 27.0）+ 本地 fixture（`ios/scripts/shared-duplex-fixture.mjs`：真实 `server.mjs`、真实 seeduplex 适配器、模拟上游、模拟 Gateway；没有模型、Makaron、飞书或付费请求）。

- 分享面板出现 V Voice，从相册多选 3 张图进入扩展，缩略图和附言正常（截图 `evidence/share-to-v/1-share-sheet.png`、`2-compose.png`）。
- 不在通话时发送：扩展打开主 App，3 张图上传，fixture 收到 1 个 `voice.product.task.start`。问题里带附言和 3 个素材链接，目标是入口绑定的飞书会话。模拟的飞书发送先发收到回执，再发结果（`3-background-banner.png`）。
- 通话中发送：素材以用户一轮进入当前通话上游（`conversation.item.create`），V 说了固定确认句，没有新建后台任务（`4-in-call-banner.png`）。
- XCTest `ShareToVTests` 6/6：深链只接受扩展自己的 UUID；图片重编码去掉 GPS、限制尺寸；只交付已提交、未过期、文件名合法的分享；后台任务的素材链接不带 cookie 也能拉到；通话中交付；415 直接丢弃、断网保留重试。`SharedDuplexFlowTests` 5/5（fixture 有改动，回归通过）。
- Node：`npm test` 1159/1159；新增 `share-inbox.test.mjs`（嗅探、所有权、单次使用、过期、两条交付路径）、`media-cli.test.mjs` 多图视频校验。`tests/fast-dial.test.mjs` 单独跑时约 1/3 概率超时，和本次改动无关。

## 需要真机、TestFlight 或线上才能确认

- **App Group 签名**：新增 `group.com.versa.vvoice`（主 App 与扩展的 entitlements），需要在开发者账号里注册，自动签名要能为两个 target 生成带 App Group 的描述文件。模拟器不校验这一项。
- **扩展打开主 App**：系统没有给分享扩展开放打开主 App 的 API，这里是经响应链调用 `UIApplication` 的 `openURL:options:completionHandler:`。模拟器上能打开；真机和 App 审核是否允许要在 TestFlight 上确认。打不开时，素材留在 App Group，下次打开 App 自动交付。
- **真实 Makaron 拉取**：Makaron 服务器能否从公网 `https://…/voice/share-media/…` 拉到素材，以及 fal-h3-max 多图参考的实际效果，都没有测（不产生付费请求）。
- **大视频与内存**：扩展只拷贝文件不读进内存，但 200 MB 视频的上传时长、移动网络、锁屏后上传中断都需要真机看。
- **真实模型行为**：GPT Live 通话不走注入，分享会进后台任务；Grok 注入后会自动回答；豆包只确认、等开口。三种模型的真实对话体验没有验收。
- **后台任务话术**：后台任务的提示沿用电话任务的规则（“用户正在电话那头等”）。分享场景下的进度句会发到飞书，措辞需要真实验收后再调。

## 发布前要做（本分支没做）

- 首页 `lab/gpt-live-h5/changelog.mjs`、`CHANGELOG.md`、`docs/ios/versions.json` 登记。
- 线上节点设置 `VOICE_SHARE_TO_V=1`，确认素材目录的权限和磁盘空间；用 `scripts/release-fleet.py` 正常发布，不重启 Gateway。
- 新 build 号（当前 41），真机安装后按上面的清单验收。
