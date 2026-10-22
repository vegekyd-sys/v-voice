## Unreleased — SeedDuplex full-duplex phone candidate · 2026-10-22

- Native Candidate: after successful end_call, request a native TTS farewell if no audio follows; wait for matching real playback, cancel ending on a continued question, and bound an unavailable farewell instead of waiting forever.
- 原生全双工 Candidate 完成 9 通合成音频整链复测：正常插话可快速停声，但背景误暂停、持续电视抢答、小声迟缓和姓名互换串信息仍未通过验收；未上线。

- Compare provider-owned playback without local pauses against assisted native playback with reversible foreground yielding. Keep a single continuous model session and retire superseded response audio without resetting speaker context. Pure provider playback remains a diagnostic option; measured interruption latency is not accepted yet.
- Tighten the existing opt-in control ASR: partial standalone stop words cannot cancel playback; explicit V-addressed or speech-targeted controls can act early. Final standalone controls settle briefly and are revoked by continuing dialogue, a changed response owner, disconnect or call closure. No new Speaker/Decision chain or account authority.
- Clarify per-call voice/name/fact binding, corrections and other-person addressees in the native phone instructions. Real interference and binding acceptance is tracked separately; no blanket success claim.
- Opt-in native continuous phone audio with `VOICE_PHONE_INPUT_POLICY=native`; keep the current multi-speaker path as the default configuration and explicit comparison mode. Gateway, Worker and tool/account permissions are unchanged.
- Yield browser playback reversibly on sustained speech, retain the exact unplayed queue for noise/acknowledgments, and retire old response IDs when the native replacement arrives. Track speech before the first output and across syllable gaps; bound acknowledgment pauses and recognize explicit stop commands with an opt-in independent streaming ASR while native recognition is behind generation. Keep background work running and discard late audio from the stopped response.
- Verify real SeedDuplex and actual Chromium/WebKit audio output with synthetic input; physical microphone/echo, real-room interference and human acceptance remain pending. Candidate homepage notes and version/evidence are registered under `docs/releases/seeduplex-duplex-candidate-20261022/`. No main merge or production release.
## 2026-10-22 — iOS build 15 background report island

- Present new background reports as the conversation island with a full-text link. Wait for the actual background scene instead of consuming the alert during the inactive transition; treat changed report content as a new delivery after a manual fold.
- Protect the report alert briefly from cosmetic caption/waveform refreshes; explicit mute, fold, end and safety states remain immediate. Recover missed relay deliveries through the existing presentation endpoint while the call runs in background.
- Preserve the build 14 native capture path, remote H5 update shell and original call owner. The system still controls the expanded island's duration; build 15 is installed on the requested iPhone, with physical report acceptance recorded separately.

## 2026-10-22 — iOS web delivery · build 14 physical acceptance

- Add a complete, versioned H5 presentation package to web release artifacts. The new native shell validates, caches and loads compatible updates without recompiling Swift for everyday shared H5 UI changes.
- Pin resources during calls/reading; retain native audio and call ownership across page reloads. Reject stale documents, incompatible/corrupt packages and redirects; fall back to the last ready cache or bundled UI.
- Tianyi authorized merge, production Voice release and a binding-preserving iPhone upgrade. PR #58 and main checks passed; the homepage entry and public UI package are deployed. Build 12 overwrite installation preserved binding and confirmed the published resource handshake. Physical voice acceptance failed (greeting audible, no microphone response); build 13 signal diagnostics reproduced zero input on Bluetooth and built-in routes. At the user’s request the phone was restored to the previously accepted signed build 10, with further repair isolated from that device baseline. See `docs/ios/WEB-DELIVERY.md`.
- With physical Device Hub sharing stopped, build 14 passed user acceptance of Action Button start, lock-screen two-way voice and Dynamic Island mute/resume/end. A cold public UI download reached ready with the published revision. Added bounded signal/upload diagnostics and nonzero conversion/relay tests; core 16, native 46 and service 80 checks passed. PR #59 main checks passed; the main-sourced signed build 14 was overwrite-installed with identical accepted native inputs and binding retained. Delivery hashes are recorded separately.


## 2026-10-22 — V Voice iOS milestone integration · build 11

- Integrate the iOS app into main after user acceptance of real iPhone connection and two-way conversation. Preserve the background Action Button audio path, original embedded H5 UI and current-call Dynamic Island content links.
- Replace the iOS AppIcon with Tianyi's supplied purple headset portrait, imported as an opaque 1024×1024 asset without re-generating the artwork.
- Add the user-visible homepage milestone entry, retaining explicit acceptance limits for new island details and system scenarios. Native capabilities still require binary updates; remotely synchronized H5 delivery is a separate follow-up task.

## 2026-10-22 — iOS build 10 local device candidate

- Package the existing H5 shell with background connection / long-reply attention requests, explicit calling state and wider measured waveform from the separate island candidate.
- Preserve build 9 signed rollback; keep native audio and background Action Button lifecycle unchanged. Device installation and human acceptance are tracked separately in docs/ios/versions.json.
- No web/server production release is included; the bundled H5 update history remains the owning web version.

## Unreleased — iOS island calling and waveform candidate

- Show “呼叫中” in the compact island and “正在呼叫 V” with a cancel action in the connecting card. Keep the existing background Action Button intent and audio lifecycle.
- Stretch the audio waveform across the card using 27 fine columns, real energy history interpolation, tapered edges and short update transitions. Silence, stale snapshots and Always-On stay calm; reduced motion disables transitions.
- Include the prior connection/long-reply attention fixes from `b858899`. Local source candidate only; the physical iPhone still has build 9.

## 2026-10-22 — iOS build 9 local candidate: embedded H5 and Dynamic Island

- Preserve native build 8 as tag `ios-native-build8-20261022`, with its signed archive and IPA retained for overwrite rollback.
- Run the actual bundled H5 DOM, CSS, conversation components, reader, Reaction and sample comparison inside WKWebView. Keep binding/settings and the existing native call/audio owner; page reloads and content navigation cannot dial another call.
- Integrate the separate Dynamic Island candidate: compact status, audio card with measured energy snapshots, conversation/Reaction card, inline mute/end/fold, and a current-call link to the original H5 report reader. Respect lock-screen privacy and stale state.
- Verify source hashes, all 52 compiled widget images, bounded payloads, trusted-frame/current-owner bridge checks and unchanged background recording intent metadata. GPT Live native transport and physical build 9 acceptance remain pending. No web/server release, merge or deployment.

## 2026-10-22 — iOS build 8 local candidate: H5 interaction parity audit

- Restore human captions for speaker-routed calls by consuming speaker.utterance / speaker.decision on the existing relay. Keep consecutive speakers in the current round, stable per-utterance rows, participant names, uncertain-name labels, five colors and listen-only state.
- Restore scroll pinning, compact-portrait latch, recognition recovery notices, bounded thinking hint, task steps and accurate queued-supplement feedback.
- Share the H5 GFM lexer between conversation and report views; give ordinary long replies and media a reader card, retain their Reaction context, resolve relative media and deduplicate assets. Only actual backend documents receive content-shown receipts.
- Add server-driven model availability, Grok voice selection and pre-generated sample comparison with blind listening. A live call takes audio ownership from sample playback. Bundle the owning H5 update history and verify source parity.
- Preserve the existing background Action Button intent, capture engine and PCM relay. GPT Live native transport, the new Dynamic Island Reaction/waveform design and physical multi-speaker acceptance remain incomplete; see docs/ios/H5-PARITY.md. No web/server release, merge or deployment is included.

## 2026-10-21 — Mobile pickup, latency and accepted-turn continuity

- Recheck the current AudioContext before attaching capture/playback worklets, resume a foreground interruption, and replace a system-muted cached microphone on redial.
- Preserve an admitted question, its output gate and recovery deadline until a later request is confirmed. Quiet or undecided acoustic segments cannot cancel its search or spoken reply.
- Wait for the ASR application initialization response before announcing readiness; an initial retry cannot expose an uninitialized listening call. Record bounded ASR response counters.
- Retain only bounded audio lifecycle counters and states for physical-phone diagnosis. No raw audio or device identifiers are added.
- Distinguish active telephone dialogue from far-field room speech. Topic reactions and elliptical task supplements can continue the admitted conversation; heard side speech remains separate from that context. No extra Decision request or tool authorization is introduced.
- Keep uncertain new finals from replacing an accepted reply or lookup. The permissive idle-conversation fallback does not authorize interruption when both addressing and action evidence remain weak; clear requests and confirmed farewells can still interrupt. Retain the bounded addressing probability and interruption state in decision diagnostics.
- Bounded opt-in lookahead (`VOICE_STREAM_LOOKAHEAD=1`): one bounded speculative native lane can hear a new phone turn while the accepted reply continues. Only confirmed semantic admission promotes it and releases queued captions, audio and tools; quiet, stale, expired or overflowing lanes are discarded. Incompatible child/adult treatment retains the conservative fallback. No Gateway or tool identity change.
- On phone pickup, acoustic onset and an unconfirmed identity no longer cancel the welcome. Confirmed caller speech (including farewell) supersedes it; a staged first request can be promoted without replay. Household-device onset behavior is unchanged.
- Physical iPhone acceptance of the preceding candidate confirmed successful conversation, three delivered searches and zero whole-sentence fallback. One mixed-speaker notice corresponded to actual television/background voices, as confirmed by the caller. Fast stop-on-interruption remains a known limitation; this release does not claim it fixed.
- Release scope and candidate/production evidence are tracked in `docs/releases/voice-mobile-turn-20261021/README.md`. Homepage updates are maintained in `lab/gpt-live-h5/changelog.mjs`.

## Candidate - Home entry guidance

- Present missing/expired personal-link guidance under the home portrait, with concise copy and no unusable dial controls.
- Give temporary connection failures a manual reconnect action; keep call-time status separate and preserve existing entry authorization.
- Source integration only; no production activation is included.

## Candidate - Compact multi-speaker status

- Keep the current person and active search/background work on one line; shorten Speaker notices and truncate long names without expanding the footer.
- Show recovery/errors in place of routine work text while preserving the task cancel control and full accessible text.
- Source integration only; this PR does not activate a production release.

## 2026-10-20 - Pickup greeting and retired call ownership

- Retain already streamed audio on a name-only update; speaker, role and addressee changes still prepare a new native persona.
- Correct the personal name to Tianyi / 天懿 in native voice prompts, greetings and tool descriptions; entry IDs and account permissions stay unchanged.
- Restore the native Seeduplex welcome without requiring a registered voice or first utterance; caller speech supersedes a pending greeting.
- Reconcile web entry ownership with the direct transport registry before admission, releasing fully closed calls while preserving live and cleanup-pending sessions.
- Safari latency/redial diagnosis remains separate in PR #33; this change does not claim a fix for it.

# Voice release log

## Voice · 20261020 phone stage UI, task progress and held results · source main

- 手机通话界面用 React 重做，V 为主体，一行状态，当轮对话跟在状态下；桌面保持左头像右聊天两栏（#49）。
- 后台任务进行中按真实阶段播报，不在已放行的提问和 V 的回答之间插话（#47）。
- 后台结果交给提问人；提问人不在场时上屏并扣住，他回来后补播，结果不丢（#46、#52）。
- 后台状态读取失败在 120 s 内重试，不再把进行中的任务取消（#52）。
- 手机外放漏回的 V 自己的声音不算另一个人，一次拜拜即可挂断（#51）。

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
