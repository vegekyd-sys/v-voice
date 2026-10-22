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
