# 飞书内外部成员点击确认身份 — Candidate 验收

日期：2026-10-25。状态：开发与候选实测完成；未合入、未部署生产，未提交新的 TestFlight。

## 行为与授权边界

内部成员、外部联系人打开同一群电话链接，在网页主动发送确认卡片，再由本人在原群核对页面标记并点击。身份取自飞书 SDK 验证后的卡片回调 operator；浏览器不能指定 actor、tenant、群、消息或权限。组织 OAuth 仍可作为替代路径。

请求有 5 分钟时限、独立浏览器 HttpOnly/Secure/SameSite cookie、单次领取、群消息精确匹配及发送限流。平台用应用私钥 HMAC 转发回调，Voice 校验应用、账号、签名、时间、群和消息，再经过真实 Gateway 准入及飞书成员查询。领取前再次准入。iOS 复用既有 principal/device grant，不新增 Swift 协议或用户凭据透传。

此路径授予本人在当前群已有的访问，不获得另一个成员的个人工具账号。外部用户的个人飞书 API OAuth 授权仍受飞书平台限制。

## 实际验收

| 场景 | 结果 |
| --- | --- |
| 外部账号在真实飞书群点击卡片 | 通过，网页显示外部账号名和原群 |
| 内部账号使用相同 phone 群链接 | 通过，显示内部账号名；群和 session 与外部账号一致 |
| 真实 Gateway 身份与目录复核 | 两个不同 operator/tenant，19 次准入与工具目录记录；同群同 session |
| actor 工具区分 | 外部 113 项、内部 126 项；目录差异来自现有平台策略，不代表逐项工具执行验收 |
| 外部身份绑定 iOS Simulator | 通过，显示外部姓名与“群聊” |
| 内部身份绑定同一 iOS Simulator | 通过，保留两份独立设备授权；切回外部账号后姓名正确 |

测试账号是同一使用者的两个真实飞书身份，并非两位独立自然人。使用已安装的 Debug build 39（前序入口/权限候选），模拟器 iOS 26.5；右侧内置浏览器显示真实模拟器画面。没有拨号、麦克风录制或真实声音验收。

Voice 实测运行 `6a05aa8efa67f591c8b66de8dc161cfe89ed92e6`。平台使用真实 native webhook/SDK 加密验签和真实注册处理函数；仅增加测试导出以启动隔离接收器，未替代认证逻辑。Gateway 准入复用已有隔离测试 Gateway。此证据不等于共享 VLab 最后集成验收。

## 自动化与产物

- Voice 完整测试 947/947（主功能提交）；随后诊断/限流改动的针对性测试 8/8。既有 caller/login 20/20。
- HTTP 端到端 fixture 覆盖签名回调→浏览器身份→iOS issue/redeem/access→带 actor 的预约与工具目录；包含身份伪造、跨浏览器、过期、重复点击、权限撤销与设备撤销拒绝。fixture 不调用付费语音。
- 平台正式 Candidate 6/6：`candidate-cfb0a98e-c895-4300-ae1e-649b0cf05d02`，输入 SHA `b8d566a439c53025116fec2944df7a383173ce24dcc77e75261d4a527e94f79a`。
- 真实接收器 Candidate：`candidate-e33b60b1-5eb7-41a2-87f4-881979ce702e`，主动正常关闭，退出码 0。
- Monitor SHA：`535841d0219848a266d146094ee3441bbf48ed7a8aa28f04d111afb330247fef`；转发模块 SHA：`6eba4d8dc140be24901ae0836a27a64ad6fbca863fd3cd8078bbfe88f2d9ee53`。

## 调试问题与收尾

第一次点击发生在 VLab 应用新回调配置发布前，被旧通用卡片路由当作普通请求，触发了一次模型/后台检查任务；任务结束，回复称未找到待确认请求。此阶段成本未单独查账，不能声称全程零模型调用或零费用。新回调发布后的成功验收走专用处理器，不进入模型。另一次验收脚本错误是读取目录漏传 agentId，已补正；产品准入当时已成功。

只对 VLab 测试应用临时发布了回调版本 1.0.6，验收后发布 1.0.7 恢复原长连接回调。原 HTTP 事件地址、权限、成员可用范围、外部群/单聊审核设置均保持原样。生产应用未改。

本次三个临时服务均已停止，integration lease 已释放。共享 Gateway PID 2229086、配置 SHA `d2511d0b51aac69bb3ef4506bcac96789ca2453660cd5e2807ef1549fe1a881a` 不变，原隔离测试 Gateway/Voice 未停。测试卡片请求已过期；外部群消息历史 API 返回 230027，未能按消息 ID 更新按钮，未删除群消息。不要重用这些过期卡片。

本机原始截图与脱敏回执保存在 `/Users/tianyicai/v-voice-releases/audits/20261025-feishu-card-confirm/`，不提交个人聊天、绑定令牌或生产配置。

## 集成前提

Voice 分支基于入口/权限 PR #144；需与独立 `v-openclaw-platform` 卡片回调 PR 协同评审。合入获准后，在共享 VLab 对实际服务重新执行一次卡片确认及 iOS 绑定门禁；再按生产授权发布匹配的两侧版本、启用私有配置 `cardConfirmation: true`，并将候选首页日志纳入实际发布。不能只部署网页而让平台仍运行旧通用卡片处理器。


## 19:20 UX refinement — same-page confirmation (Candidate .2)

The phone page now automatically prepares and sends a confirmation card when a Feishu conversation entry remains unidentified after the existing SDK flow. The page shows its marker and waiting/error state, with retry and skip controls. Successful polling returns the server-verified entry snapshot and updates the current page; no standalone confirmation document or confirmation-success navigation remains. The registered SDK callback is still the phone document itself. Explicit organization OAuth remains available through its existing route.

The former confirmation URL now serves the phone app. New prepare/cancel POSTs preserve same-origin protection, browser ownership, expiry, membership checks and one-time redemption. Cancellation waits for an outstanding response, invalidates the pending request, then refreshes the entry before enabling dialing. An already redeemed response cannot leave the UI showing a different account than its browser cookie. No platform protocol, permissions or Gateway changes were made for this refinement.

Web and native home show account and conversation as separate lines. Web top-right **iOS 绑定** opens binding directly. The in-page account sheet has a current-identity header and compact actions. Native Settings lists account first, conversation second, with a quieter selection treatment.

Validation:
- Full Node suite 952/952; final client/app targeted suite 83/83 after cancellation-state tightening. New tests cover duplicate start, prepare cancellation, late poll, retry, same-origin prepare, legacy phone rendering, server cancel and inline redemption. Existing current-account SDK switching remains unchanged and covered.
- XcodeBuildMCP Debug build/run succeeded on iPhone 17 Pro, iOS 26.5. Viewed actual frames through Codex IAB serve-sim. Native Settings reviewed with prior saved test identities; new bundled H5 home and account switching verified using the separate settings-preview Keychain fixture.
- Codex IAB tested automatic send, same-page verified identity, direct iOS binding sheet, account sheet, explicit guest/no auto-send, reconnect and cancel. A callback after cancellation was rejected. 390×640 responsive layout was visually checked. No microphone or call was started.
- Browser harness uses the real Voice HTTP handlers with simulated Feishu/Gateway responses and signed callback. Its loopback-only HTTP proxy strips Secure on fixture cookies for visual testing; production cookie behavior is unchanged and covered by HTTP tests. This is UI/flow evidence, not a new real Feishu SDK run or physical iPhone acceptance.
- The installed normal iOS app can still load the currently published remote H5 shell; the new shell remains Candidate until released. Fixture verification explicitly used the new bundled shell. No production, Gateway, TestFlight or shared VLab changes in this refinement.

Local evidence: `v-voice-releases/audits/20261025-inline-identity/` contains Web home/settings/binding, mobile confirmation and native home/settings screenshots. The prior real two-identity audit above remains the identity-chain evidence.


## Dial-first refinement — Candidate .3 (supersedes .2 entry trigger)

Opening the page preserves the original portrait and phone button and sends no card. Only clicking the phone button starts confirmation for an unidentified Feishu entry. Before requesting a microphone, audio context or call session, the page shows the existing approved `reaction-1` (open-palm guidance), retains the phone button, and presents a compact “回飞书，点一下确认” instruction below it. The marker is a small text line instead of a separate authentication card. Confirming or skipping restores the normal portrait. Confirmation does not automatically place a call.

- Full Node suite: 955/955; targeted app/avatar/client checks: 100/100. New checks cover no startup send, dial-to-confirm without microphone/peer/audio/session creation, explicit guest dialing, and actual Reaction image switching/reset without a Decision anchor.
- Codex IAB 390×640 browser: initial state had zero cards; real phone-button activation produced one fixture card, retained the button and displayed the guidance Reaction. A signed fixture callback restored the same document to verified identity and normal portrait; zero audio calls. The fixture uses real Voice HTTP handlers and simulated Feishu/Gateway as described above.
- This refinement changes only Web confirmation presentation/trigger and shared avatar rendering. Bundled iOS H5 resources were regenerated and checked; prior native build evidence remains separate, and no new native binary or TestFlight release is claimed.
- Local screenshots: `v-voice-releases/audits/20261025-dial-first-confirm/{before,after-dial,after-confirm}.png`.
- No new real Feishu messages, paid model calls, shared VLab changes or production release.


## Quiet confirmation UI — Candidate .4

Reduce the waiting state to one sentence (“回飞书确认，就能通话”), one quiet comparison marker and a secondary “访客通话” action. Remove the repeated card-sent/come-back paragraphs, reduce heading weight and marker emphasis, and retain 44px action targets. The original portrait size, phone button, dial-first trigger and identity protocol are unchanged. Errors retain their actionable detail only when needed.

Validated through a real phone-button activation in Codex IAB at 390×640 with the same local HTTP/signed callback fixture; app/avatar/client checks 100/100 and generated iOS shell consistency passed. No new real messages, microphone usage, calls, platform changes or deployment. Screenshot: `v-voice-releases/audits/20261025-quiet-confirm/after-dial.png`.

Platform scope assessment (read-only production check): current V uses the Feishu WebSocket channel and its monitor lacks the dedicated Voice confirmation handler. PR #473 adds authenticated card-action routing and a signed forward to Voice; it does not change the conversation model or tool policy. UI-only changes do not require it. Enabling this card identity flow with the current implementation requires matching platform code; no restart-free deployment of this PR has been validated. Plugin reload and an independent callback receiver are distinct alternatives requiring integration validation; neither is claimed as a completed no-impact release path. Production was not changed or restarted.
