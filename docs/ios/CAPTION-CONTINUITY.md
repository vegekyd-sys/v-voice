# Native caption continuity candidate

Baseline: installed joint build 18 (`793203b`), initially reproduced from its acceptance record `bee827c`, then integrated onto main `79a9d56` (functional merge `59a9b99`) after PRs 65/66. The intervening main changes are release notes/registration; accepted product behavior is retained. This repair is a separate candidate; it does not change the installed phone or the acceptance of build 18.

## Observation and evidence boundary

The requested last completed call on 2026-10-22 was 20:23:02–20:27:15 Asia/Shanghai, provider OpenAI, model `gpt-live-1-codex`. Read-only production inspection found call lifecycle records and 103 nonempty avatar dialogue snapshots. Those sampled snapshots contained 45 distinct message keys, many holding only one or two characters; 44 of their latest sampled states were unfinished, and none of their sampled text contained a newline. Avatar snapshots are sparse and hold only the latest user/assistant text: they do not reconstruct all packets, final messages or screen frames. No raw provider packet recording exists for this call, so exact upstream event ordering is not claimed. Private chat text is not copied into this document or fixtures.

## Reproduced defects and repair

- **GPT native:** when a caption precedes `turn.created`, build 18 creates an anonymous row, then a second row for the native identity. A terminal with a newly supplied identity can similarly create a duplicate. Preserve one presentation key while binding the provider ID later. Keep that provider ID for existing end-control checks. A late fragment final stays attached to its original row, and a fragment final replaces its own accumulated deltas.
- **Xiaohe/Grok native:** relay assistant partials are deltas (confirmed in both provider adapters), but iOS replaced the unfinished row with each delta. Append partials, replace with the final snapshot. Explicit snapshot callers retain their old semantics.
- **Shared H5:** concatenating completed history and unfinished current rows changes chronology. Sort by original row time for UI, Reaction input and display receipts. Missing timestamps retain legacy order. No provider text is invented, and no arbitrary typewriter delay is added.

Before the repair, new synthetic regressions failed for GPT provisional identity, terminal binding, late fragment ownership, relay delta accumulation and overlapping H5 completion ordering. These sequences match the failure classes visible in the sampled call, but are not a replay of unavailable original wire packets.

## Verification

Core 29/29; shared view/transcript/Reaction/telemetry 43/43 distinct tests (initial 42 plus one additional telemetry chronology regression); web app/content/UI bundle 90/90; final native run 7/7. H5 bundle parity and `git diff --check` pass.

Native result: `test_sim_2026-10-22T13-28-41-237Z_pid57447_cb2d0d21.xcresult` in the local XcodeBuildMCP result directory. The first native run exposed an existing test-harness dependency on the simulator's saved GPT model (relay fixtures waited for a GPT offer answer). Relay tests now explicitly choose SeedDuplex and restore the previous preference. A new test initially returned a DOM object across `evaluateJavaScript`, which WebKit rejected; it now stores the node without returning it. Both corrections are test-only; final combined native suite passes.

Actual simulator/H5 streaming screenshot: `evidence/caption-continuity-streaming.png`. The synthetic sentence remains one message while streaming and stays in place after finalization. Actual WKWebView checks exercise one growing paragraph, stable message DOM identity and correct overlapping speech order; native WebRTC loopback checks late identity binding, final text and existing report/reload behavior. All inputs are local fixtures/synthetic PCM, with no paid or real model call.

No push, merge, web deployment, service restart, signing or physical-phone installation by this task. The native parser/relay changes require a new app build; a remote H5 update alone cannot deliver the complete fix.

## Prepared user-facing release note

“通话文字更连贯：GPT Live One 不再因话轮标识晚到而拆成短消息；小何/Grok 的字幕会持续累加，交替说话时消息顺序保持稳定。” Apply this to the homepage changelog when this candidate is actually accepted for release, together with the next app build registration.
