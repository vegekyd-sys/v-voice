# Feishu session phone candidate — 2026-10-22

Candidate only; no production release or Gateway restart. Integrates main through 1a0063a (native duplex and current H5 UI) into the former PR #2 implementation.

A phone maps to an existing server-owned Feishu session. Browser input cannot select another session. History, direct Gateway tool calls, and backend delegation use that session key. Conversation calls omit the Voice service's personal Feishu shortcuts and personal-caller assumption. The page shows a safe conversation label and preserves its binding when returning home.

DM entry: top URL tab named `📞 打给 V`. `scripts/feishu-menu.mjs --surface tab` installs one idempotently, preserves other tabs, and reads back uncertain writes. Existing group menus remain supported without layout changes. Public links use Feishu OAuth and never contain a bearer token. Installation is per conversation; global auto-provisioning is not deployed.

The pilot still allows only the registered Tianyi identity and two existing VLab sessions. This does not establish arbitrary employee/family authorization parity: the current Gateway Voice connection has operator-admin scope. Existing entry guards remain in force; expansion needs the actual session caller identity path verified before enabling other users.

Local validation: 736 main tests and 95 Speaker tests pass; generated iOS H5 shell check passes.

The VLab pilot runs code commit `3faa1a03d5ef831006c71fc2643fa48655c2a536`, based on main `1a0063a`. Its package manifest verified 212 source files. The existing isolated Voice service was updated with a source/environment rollback copy; the shared Gateway and formal V production service were not restarted or changed.

VLab Feishu app 1.0.3 has a real DM top tab `📞 打给 V`; the former bottom floating menu is disabled. No app permissions or audience expansion were made. The group menu is preserved. Clicking the DM tab completed OAuth and opened the correctly labeled session page; the group OAuth route and home-link binding also passed browser checks.

Live synthetic-audio checks used the deployed modules through loopback HTTP/WebSocket, real Gateway and real providers. Public OAuth was verified separately, so these are not an end-to-end physical-phone microphone/speaker test.

| Check | Result |
| --- | --- |
| SeedDuplex: DM and group recognize input and return audio | Pass |
| Grok: DM and group recognize input and return audio | Pass |
| Separate histories and all keyed RPCs bound to registered sessions | Pass |
| SeedDuplex group delegates `123+456` and delivers `579` | Pass |
| SeedDuplex DM backend delegation | **Fail**: first attempt exceeded the 150-second delivery window; retry received Gateway task status `error` and delivered `V 后台任务未完成` |
| GPT Live reservation and close for both sessions | Pass; actual WebRTC media not exercised |
| Call cleanup after each test | No active/creating calls or tracked background tasks |

The DM failure followed a backend child run. Gateway logs show a completed child and announcement; `voice.product.task.read` on the retry returned an error. This narrows the unresolved problem to the existing backend task/child-result path, but does not establish a root cause or a fix. Do not label the candidate fully accepted or promote it based on passing unit tests. No shared Gateway patch/restart was made to mask this failure.

Human Feishu/mobile audio acceptance, GPT media acceptance, arbitrary-caller permission parity and automatic installation for every DM remain unverified or unenabled. This candidate is available for scoped user trial and remains a draft PR.

## Main replies synced to Feishu — follow-up

Runtime `d396b325817adc50460f23f19f58fe877e229577`, version `voice-session-replies.20261022.1`. Both existing VLab entries enable private `replySync`. The slim Voice connection config has no channels section, so the candidate uses a separate credential-free Feishu account mapping extracted from the actual Gateway config and supplied through `VOICE_FEISHU_ACCOUNTS_FILE`. Unknown/ambiguous account routes fail at startup rather than falling back to another bot.

Local: 746 main tests and 95 Speaker tests passed; iOS resource check passed. After the slim-config fix, 17 focused route/server tests passed.

Real synthetic audio connected the deployed modules to the existing Gateway and providers. SeedDuplex and Grok each ran one DM and one group call: all four recognized speech, returned audio, received exactly one confirmed Feishu send receipt, and found the reply in the bound session history. Native Feishu UI visibly showed two test messages in each conversation (one per model). No real microphone was recorded. Test calls ended with active/creating/background counts zero.

Main replies are merged on completed responses. Greeting/progress/partial/interrupted output is excluded. Full backend result delivery and hangup retention are covered by local tests; this round did not repeat the known failing DM backend-child acceptance. GPT output-event handling is covered by server fixtures, not real WebRTC media. The earlier backend failure and physical-device/GPT acceptance gaps remain.

The isolated Voice candidate was switched after idle verification with 213-file integrity checks and source/config rollback copies. Gateway invocation remained unchanged; no production merge or deployment.
