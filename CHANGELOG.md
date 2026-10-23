## Unreleased — shared terminal behavior

- Share natural search acknowledgments, native dialogue policy, background progress and result recovery across Web, iOS, StackChan and speakers. Keep microphone routing, playback, display and physical-device capabilities in adapters.
- Add receiver-matrix regression coverage and include shared lookup recovery in the fleet artifact. Candidate only; real device and shared integration acceptance remain required.

## 2026-10-24 — Quiet iPhone call start

- Recognize verified iOS device grants on HTTP and fast-socket dialing. Skip the live Feishu status card for App calls, including Action Button, while preserving transcript storage and the hangup summary.
- Browser calls retain the live timer. No native App install, Gateway change, or chat notification setting change is required.

## 2026-10-24 — iPhone handoff dialog production release

- Ship PR #105 on the existing production baseline: a compact phone illustration, explicit destination conversation, and one primary “在 iPhone 上继续” action.
- Fold installation, manual link copy/regeneration and bound-device management into secondary disclosures. Keep explicit App verification and existing bindings unchanged.
- Native audio candidate PR #106 and the separate multiuser candidate are outside this server release.

## 2026-10-23 — Private-call status card repair

- Use the native Feishu chat ID for timer and hangup edits: take it from the exact send receipt, or resolve the canonical session and verify its agent, bot and direct-user identity when older adapters omit it. DM delivery still uses its original user ID, bot and canonical session. Missing or mismatched receipt targets fail closed; the transcript and summary remain available.
- Verify the actual DM send/edit contract, elapsed updates and final duration, and retain group behavior. This hotfix is based on production `594e3c5`; unrelated multiuser candidates and native audio changes are separate releases.

## 2026-10-23 — iOS guided binding and saved conversations · 2026-10-23

- Replace the binding form with a three-step native journey: connect a conversation, configure the Action button, then “替代 Siri 的第一步：enjoy”. Show the journey on first launch without a binding; existing users enter the phone directly. Prefilled handoffs use a focused confirmation state and fixed primary actions.
- Save multiple verified destinations in the device-only Keychain. Validate before switching, reuse saved grants without replaying a handoff, preserve other destinations on refresh/removal, and block changes during a live call. Existing single records import automatically; the selected record remains readable by build 25 for rollback.
- Keep conversation management in the top-right settings. The existing “和 V 通话” intent follows the selected conversation; Action button assignment remains the user's system setting. No automatic dialing during onboarding.
- Native build 29 combines this setup with build 28 fast dialing. Simulator validation, installation and physical acceptance are recorded separately.

## 2026-10-23 — One-connection native phone dial

- Add an authenticated, versioned WebSocket dial path that shares the existing exact-session check, admission lock, rate limits and per-conversation ownership with HTTP dialing. Reserve and attach on the same connection; cancellation releases only its own reservation.
- iOS build 28 remembers the advertised capability per binding, accepts the owned reservation before provider events, and waits for real provider readiness. Definite pre-reservation authorization/unsupported-endpoint failures can use the legacy refresh path; ambiguous failures do not automatically double-dial. GPT and older clients remain on their existing transport.
- Load the tool catalog and current conversation context concurrently. No idle provider prewarming, microphone recording or VPN changes.

## 2026-10-23 — Remove full-store reads from phone dialing

- Verify each configured conversation with the existing exact `sessions.describe` read, replacing `sessions.resolve` which reads the entire agent store. Live read-only comparison: resolve 5134 ms; describe 178 ms, then 8 ms with derived titles/last message disabled.
- Keep verification uncached and reject missing sessions, canonical-key mismatches and wrong/missing agent identity before creating media.

## 2026-10-23 — Background dial startup and Feishu entry latency

- iOS build 26 prepares SeedDuplex/Grok capture while the user-triggered recording intent is fresh, before waiting on network setup; pre-connect PCM is discarded and setup failure releases capture.
- Authenticated explicit Feishu phone links render the phone page and its initial status directly, preserving identity checks while removing one redirect.
- Persist bounded audio startup failure stage/error codes for device diagnosis.

## 2026-10-23 — Production binding and all-group rollout verified

- Release PR #95 to both Voice nodes at `8e8dc76`; verify writable private state in each running service namespace and preserve the prior call report. The same App now binds the designated production group successfully and retains it after relaunch. Physical-phone retry remains separate.
- Install and read back all 417 current group menus with unique URLs and exact canonical sessions; install the current-user DM tab and verify native Feishu UI. Future first-entry auto-tab handler activation still awaits an idle Gateway restart.

## 2026-10-23 — Repair production App binding persistence

- Return a storage-unavailable error when the device grant cannot be saved, instead of reporting an expired handoff. Failed persistence leaves the previous App session unchanged; retry after storage recovery is covered by the HTTP regression test.
- Store production App bindings and call reports in the service's private writable StateDirectory, preserving the read-only application and OpenClaw directories.

## 2026-10-23 — Make App session switching explicit

- Name the target conversation and the exact native “验证并绑定” action in the browser handoff. Opening the App alone keeps its previous binding; the page now makes that state visible before the user dials.
- Prepare per-group production entry expansion without changing native credentials, session authorization or existing bindings. Group installation and actual device acceptance are tracked separately from this UI change.

## 2026-10-23 — Session phone production release

- Publish the accepted PR #2 session phone path and PR #90 DM/status/summary fixes together. Each registered group has its own server-owned session and public login URL; V Backup is the acceptance group, never a shared fallback for other groups.
- Update the actual homepage release notes for session context, one live status card, first-person call summaries, durable Feishu login and build 25 binding. Existing native build 25 needs no reinstall; a candidate-bound device must bind the production entry separately.
- Roll out one verified artifact through the dual-node Voice release controller. The separate platform phone-tab event handler requires its own Gateway integration/restart; the Voice service switch itself does not.

## Candidate history — DM call lifecycle and summary reliability · 2026-10-23

- Apply the existing compact status/summary flow to explicit DM phone entries. Keep same-message elapsed/ended updates and suppress per-turn Q&A cards during calls.
- Use “V正在电话通话” and “V电话通话已结束” consistently.
- Set Grok 4.7 short-summary reasoning to low, retry transient/truncated responses once, and preserve safe failure diagnostics after the call ends. No native iOS change.

## Unreleased — Refined call status and summaries · 2026-10-23

## Unreleased — Session phone access and iOS handoff · 2026-10-23

- Keep Feishu browser identity in an authenticated encrypted 30-day cookie across service restarts; revalidate current allowed actors and entries on each request. Provider tokens remain transient.
- Align the iOS App link with the changelog; open native Settings with a validated Deep Link and prefilled handoff. Verify and reuse an existing same-session grant instead of replaying a consumed link.
- Configure real TestFlight/App Store download destinations when available; TestFlight distribution remains pending user acceptance.


- Update one compact Feishu status card in place from 正在通话 to 通话已结束, using small grey annotation text and the original message receipt. Show an elapsed clock while connected and retain the final duration after hangup; serialize updates and stop the timer before closing. Use the existing authenticated Gateway operator edit contract; no platform runtime or permission changes.
- Remove summary-card call statistics. Have V introduce and synthesize the conversation as a first-person assistant recap, preserving the distinction between suggestions, agreed decisions and completed work. Keep the full transcript link. Candidate only.

## Unreleased — Voice Q&A cards · 2026-10-23

- Present paired Voice questions and answers as native Feishu cards with a soft purple header, literal question, divider and rich answer. Preserve the existing delivery queue, session routing and duplicate protection. Oversized answers use the existing text delivery path without truncation.
- Decode mirrored cards into dialogue for subsequent Voice context. Candidate only.

## Unreleased — Paired voice questions and answers · 2026-10-23

- Combine the admitted final user question and completed substantive answer in one Feishu message across session and personal entries. Bind responses and background results to the originating question, suppress duplicate completions and retain detached task pairing after hangup. Candidate only.

## Unreleased — Unified personal/session replies · 2026-10-22

- Route the legacy personal entry through the same server-owned reply target and delivery queue as session phones, with an explicit bot-account opt-in. Preserve its fixed session, personal tools, authentication and default disabled setting.
- Remove the visible conversation/reply-sync banner. Candidate playback uses the release's assisted pause setting; the observed call had 23 pauses and zero recorded buffer underflows, so device listening acceptance is still required.

## Unreleased — Session replies in Feishu candidate · 2026-10-22

- Opt-in private conversation entries mirror completed substantive Voice replies and full backend results into their bound Feishu session through the existing Gateway send API. Resolve the configured bot account explicitly and retain the original session key for transcript mirroring.
- Keep audio independent of sends; deduplicate response segments and ambiguous retry keys, omit greetings/progress/interrupted text, and surface delivery failures. Only VLab pilot entries are enabled; production and arbitrary-caller permissions are unchanged.

## 2026-10-23 — Service-only query status update for installed build 24

- Use the shared Web task label 查询网页, so the call status reads 查询网页中. The runtime projects that service-owned label to installed build 24; existing native source and signing inputs remain unchanged. PR #83 / main c009c5b passed CI and was deployed to both nodes with public resource hashes verified. No second native install. Tianyi accepted the query test; phone readback confirms changed policy fingerprint, unchanged installed bundle identity, and the exact published 114-file Web archive confirmed good after an idle app relaunch.

## 2026-10-23 — iOS build 24 native capability bridge

- Delivery: PR #82 / main `b8b71ac` passed CI; both Voice nodes run the same verified 208-file artifact. Signed build 24 was cover-installed and read back, preserving signing/Keychain identity and original build 22/23 rollback packages. Tianyi accepted voice, interruption, Action Button, locked-screen voice and Island controls; phone readback confirms policy cb418111e71a187b and valid microphone input. Follow-up service-only phone proof also passed on the same installed bundle; see the release record for idle update timing.

- Move relay caption/speaker interpretation, notices, task/report presentation and bounded playback policy into the shared Voice service. Negotiate a versioned data-only runtime; native executes existing media and system primitives even without a WK page.
- Discover relay models by declared transport instead of adding a Swift enum case for each service model. Preserve old clients and the separate GPT WebRTC transport.
- Prepare build 24 for the authorized merge, dual-node release and private-device installation. Preserve signed build 22/23 rollback packages and Keychain identity. Bounded local diagnostics record only runtime policy fingerprints and numeric parameters so a later service-only update can be verified without reinstalling.
- Synthetic same-binary acceptance changes service policy between calls; physical installation/background/Action Button/Island acceptance is recorded separately. See `docs/ios/NATIVE-CAPABILITY-BRIDGE.md`.

## 2026-10-23 — Native search acknowledgment shared by web and iOS

- Enable contextual SeedDuplex acknowledgment for phone web_search and memory_search, followed by tool execution in the same turn. No cached start audio, injected TTS or additional model. Explicit VOICE_SEARCH_ACK=off retains the silent lookup rollback.
- Clarify that factual answers require records while a short acknowledgment can precede them. Keep native duplex/multi-person instructions, response ownership, native iOS audio and build 23 island changes.
- Remove strictly duplicate text/details search wrappers without dropping citations or other content; persist bounded numeric timing diagnostics only. Include the new module in release artifacts.
- Candidate evidence, failed iterations and timing limits: docs/acceptance/search-natural-ack-20261023/README.md. Production deployment is recorded separately in docs/releases.

- Delivery: PR #80 merged; main CI passed. Both server nodes run 08eaecf with matching artifacts, public assets and iOS UI distribution verified. Existing native build 23 retained; no reinstallation or post-release physical call. Release approved after the documented identity/TV limitations were disclosed. See docs/releases/voice-search-natural-ack-20261023/release.json.

## 2026-10-23 — iOS build 23 natural speech waveform

- Integrate the user-accepted build 22 baseline with waveform-only medium and large island cards. Keep the native interruption wait fix, Reaction, report entry, mute/end and background Action Button behavior.
- Display 24 measured speech-energy windows with fixed loudness mapping, fast attack and short release; silence settles to a quiet line. No decorative waveform loop or conversation text in either card.
- Tianyi confirmed build 22 acceptance. The missing initial medium card was traced by the user to Sleep Focus; the proposed connection timing change was withdrawn.
- Native private-device release; server deployment and new physical waveform acceptance are recorded separately in docs/ios/versions.json.

## 2026-10-23 — Keep interrupted playback paused while awaiting a reply

- Web and iOS build 22 keep a recognized utterance paused until native disposition or response replacement. The 1.8-second courtesy timer can no longer resume the old answer while a new one is pending.
- Distinguish nonempty completed recognition from empty/failed recognition without sending transcript content in control events. Acoustic-only probes remain bounded; explicit ignored speech resumes retained samples. A later failed probe cannot release an earlier pending recognized utterance.
- Preserve native identity/name context, response ownership, microphone capture, captions, island and farewell drain. No extra model, speaker chain or Gateway changes.
- Validation and release state are recorded in `docs/acceptance/duplex-wait-20261023/README.md`; synthetic fixtures do not establish physical speaker attribution or human listening acceptance.

- Delivery: PR #75 merged and main CI passed. Both Voice nodes run 8136b20 with matching artifact hashes; signed iOS build 22 installed, read back and normally launched on the requested iPhone. Public assets and homepage verified; physical listening remains pending.

## 2026-10-22 — Shared native duplex repair and iOS build 21

- Retire the previous native response when accepted replacement text or TTS starts; send a scoped playback clear before replacement PCM. Preserve listening-aside decisions, ongoing microphone capture, names and background tasks.
- Honor each PCM packet’s own response ID. Reject old/anonymous retired tails and late terminal events instead of relabeling them as the new response. Scope completion and clear events in both web and native playback.
- Remove fixed lookup-start and waiting speech from phone calls, including legacy notice configurations. Existing task UI, real backend progress/results/errors and household-device notices remain.
- Preserve build 20 ownership repair, build 19 captions and accepted island/Reaction behavior. An accepted farewell remains eligible to drain and hang up after response replacement.
- Local simulated-upstream acceptance reproduces failure on the pre-fix shared pipeline in both Chromium and native iOS. The repaired browser becomes silent 37 ms after replacement confirmation, rejects the delayed five-second old tone and hangs up; native shared pipeline passes with capture continuing. No real provider request or recording. Full native 67, core 29, Node 727, Speaker 95 and fleet 10 pass; physical speech-onset sensitivity and model judgment remain separate acceptance.

- Delivery: PR #72/#73 merged; main CI passed; both Voice nodes run 56cfc608 from one hash-verified artifact. Signed iOS build 21 installed and read back on the requested iPhone. Normal launch was blocked by the physical lock screen; human real-call acceptance remains pending. Gateway and original private settings unchanged. See `docs/releases/voice-duplex-shared-20261022/release.json`.

## 2026-10-22 — iOS build 20 playback ownership repair

- Keep native response ownership across host tool notices without a provider response ID, so a new reply replaces the old queued tail.
- Honor confirmed retiredResponseId on audio.clear so late frames cannot restart cancelled speech.
- Both cases fail against build 19 source and pass with the fix; 10 native playback/H5 regressions and 29 core checks pass. Real microphone interruption timing remains a physical acceptance boundary.
- Follow-up delivery to the authorized caption repair; preserve the signed build 19 rollback. See `docs/ios/INTERRUPTION-OWNERSHIP.md` for evidence and limits.

## 2026-10-22 — Caption continuity and iOS build 19

- Keep GPT captions in one stable message when fragments arrive before their native turn identity; attach late fragment finals to their original turn.
- Accumulate Xiaohe/Grok relay text deltas in iOS instead of replacing preceding words, then reconcile the full final caption.
- Preserve original message order across completion in the shared web/iOS UI, Reaction context and display receipts.
- Verified with synthetic native WebRTC, WKWebView and core/web regressions. Merged through PR #68, deployed to the production web entry with asset hashes verified, and installed as signed build 19 on the requested iPhone. Physical real-call caption acceptance remains pending. See `docs/ios/CAPTION-CONTINUITY.md`.

## 2026-10-22 — Accepted iOS build 18 integration

- Integrate the installed and human-accepted joint iPhone build: native background Action Button calls, medium/expanded measured waveform, report links, purple system portrait icons and default/live locked-screen Reaction, alongside native SeedDuplex duplex and GPT Live One WebRTC.
- Tianyi confirmed the three physical island/icon/Reaction checks, then explicitly accepted the version and authorized main integration. Keep the tested/signature-verified build18 artifact and rollback baseline; this merge does not replace the installed binary or deploy the web service.
- Update the owning homepage changelog and generated H5 history. GPT Live incremental-text presentation remains under diagnosis in the separate GPT session, with no fix commit included or claimed here.
- Validation: Core25, native/H5/island62 and service91 passed for the installed code; integration checks and merge identities are recorded separately.

## Unreleased — iOS build 18 joint candidate

- Integrate native SeedDuplex reversible pause/response replacement from main, GPT Live One native WebRTC, and the latest waveform/report island without replacing existing call ownership.
- Supply the exact purple portrait for all system icon roles and register it with the public alternate-icon API only while idle in foreground; refresh App Shortcuts after registration. No uninstall or binding reset.
- Show a default Reaction while connecting, including the shared lock-screen component. Continue semantic Reaction decisions in background using the existing H5 endpoint/catalog, carry forward actual foreground frames and approved continuations, and return control to H5 on foreground entry.
- Keep server Reaction revisions monotonic across H5 reloads while preserving each renderer's requested revision. Foreground and background loops do not run together; stale call/user responses remain rejected.
- Joint simulation and physical delivery are recorded separately in `docs/ios/joint-build18.json`. Physical cache/lock-screen/acoustic acceptance is pending; no automatic real model calls or online release.

## 2026-10-22 — iOS build 17 waveform candidate

- Reuse the medium card's measured waveform in expanded and lock-screen call controls; remove scrolling conversation captions, while unread reports retain the existing title and open-full-report affordance during speech.
- Publish bounded audio snapshots for both card layouts, preserving native capture, playback, Action Button ownership and background report attention.
- Move App Shortcuts icon colors into the documented primary-icon metadata for both iPhone and iPad; request registration again on idle foreground entry. Physical launch-icon cache refresh remains pending, with no uninstall or binding reset.
- Local candidate only; no automatic real calls, main integration or server deployment.

## Unreleased — iOS build 17 GPT Live One candidate

- Add GPT Live One to native/H5 model selection, using the existing authenticated GPT Live SDP and native input policy. One CallCoordinator owns the call; VoiceAudio selects mutually exclusive WebRTC or PCM audio engines. Action Button remembers the selected model.
- Bring GPT caption fragments, native turn ownership, semantic Reaction, backend tasks/results and background report attention into the existing island/H5 presentation. Preserve mute, manual hangup, owned cleanup/reconnect and bounded host-authorized end guards.
- Pin native WebRTC 154.0.0, retain its license/privacy manifest, and preserve the signed build 16 rollback. Local synthetic peer-to-peer audio, system audio backend switching and regression checks pass. Physical GPT/provider audio acceptance remains pending; no paid call, main merge, Gateway change or online web release.
- Public homepage changelog remains at the accepted shipped baseline. The candidate is not advertised as a shipped or human-accepted capability; the prepared release note is in `docs/ios/GPT-LIVE.md` for the approved release.

## Unreleased — iOS build 16 live caption and launch branding candidate

- Show the latest three wrapped lines of V’s current reply in the expanded and Lock Screen presentation while V speaks. Keep Reaction, mute/end and a stable report link; opening text continues the same native call.
- Sanitize URLs before taking the trailing caption window, keep speech captions scoped to the current exchange, and retain the caption privacy setting. This follows incoming transcript updates rather than claiming word-level audio alignment or a manually scrollable widget.
- Register the existing purple portrait under the distinct VVoiceAppIcon resource, set App Shortcut brand colors and use the same artwork in the app-owned connecting card. The system-owned Action Button launch hint and its cache still require physical verification.
- Local candidate only; retains the build 15 signed rollback and existing audio/Intent behavior. No production web deployment or automatic real call.

## Unreleased — SeedDuplex full-duplex phone candidate · 2026-10-22

## 2026-10-22 — Native duplex release and iOS build 16

- Promote the human-reviewed native SeedDuplex candidate: reversible listening pause, response-owned playback replacement, per-call name-binding instructions and accepted-hangup fallback.
- Advertise the preferred phone input policy; capable web/iOS clients explicitly opt in. Legacy clients retain Speaker routing until upgraded.
- Add iOS native reversible AVAudioPlayerNode pause without stopping microphone capture, response retirement and matching ignored-speech recovery. Preserve build 15 report/Live Activity and web-delivered H5 behavior.
- Continuous television and bystander audio can still cause long pauses or unwanted model replies; synthetic tests do not replace physical iPhone acoustic acceptance.


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

## 2026-10-22 — Unified four-client release

One verified main artifact now targets both the web/iOS and domestic robot/speaker services. Private Unix release control atomically holds new call admission only when calls, creation, delivery and device operations are idle; expiring holds, exact service/configuration checks and guarded rollback protect ongoing work. Legacy bootstrap refuses any existing client connection. The fleet command stages both nodes, retains pending targets, and records runtime hashes plus the iOS UI/client compatibility matrix. Native apps and firmware still require separate installation evidence. See [deployment contract](docs/unified-release.md); production delivery is verified on both nodes at `42ff625` and registered in `docs/releases/voice-unified-release-20261022/release.json`.


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
