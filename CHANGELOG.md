# Voice release log

## Unreleased — Late SeedDuplex tool delivery

Native tool results that arrive after a newer caller turn or host speech now use explicit host presentation instead of an orphaned native continuation. Results remain on screen; a short receipt waits for idle playback and is retired by a newer user turn or cancellation. The operation is never replayed. Normal uninterrupted tool calls retain native continuation.

Capture diagnostics now record frame counts/age, microphone track state and AudioContext state without retaining microphone audio. Candidate evidence and limitations are recorded in `docs/acceptance/20261016-late-tool-delivery.md`; production registration remains unchanged until the release owner deploys this PR.


## 2026-10-16 — Homepage notes and safe Voice entry publication

Restore the missing October 16 homepage release notes and make product-facing notes a release preflight requirement. Authenticated status now exposes whether active calls, session creation, or pending backend delivery prevents an entry cutover. Persist only bounded causal event metadata and numeric playback counters to distinguish received speech, tool waits and missing output; no tool arguments, result bodies or audio are added.

Production entry `d37ac851` is active, registered in [current.json](docs/releases/current.json). [Platform #396](https://github.com/vegekyd-sys/v-openclaw-platform/pull/396) adds the entry publication guard and verified legacy graceful-drain migration. The old H5 exited normally; no forced kill, Gateway restart or config change. All 177 package hashes and the unchanged plugin bytes match. Candidate checks: 80 Voice and 12 controller tests. The public homepage shows October 16 notes with no browser console errors. Late-result replies and busy natural hangup remain separate unresolved tasks; physical iPhone Safari was not retested.

## 2026-10-16 — Voice #23 farewell wording

GPT Live may say “再见，下次再聊” after an accepted caller hangup request. The page now recognizes that equivalent variant alongside “再见，下次聊”, while retaining host authority, current-user ownership, a terminal assistant turn and actual audio drain.

Production entry commit: `bcb82987c7cc6c61e87ecc9f28c320df6bfb470b`. Gateway plugin stays at `a9ac516860a8856470262957ad6ea0cc2670cb0e`, byte-identical to the new package for plugin/lib/server files; only frontend app.js changed. No Gateway restart or config change.

Both GPT Live and SeedDuplex synthetic natural calls automatically returned to idle with reset transcript and no browser errors. The recorded alternate farewell passes exact replay; live GPT used canonical wording. Physical iPhone Safari and unrelated backend/media tasks were not retested. First entry activation was rolled back after a controller receipt failure; the second passed all original guards. See [registration](docs/releases/voice-bcb82987-20261016/manifest.json), [current version](docs/releases/current.json), and [PR #23](https://github.com/vegekyd-sys/v-voice/pull/23).

## 2026-10-16 — Task continuity baseline

The earlier accepted task-continuity baseline uses Voice `a9ac5168` and the platform core release `v2026.9.1-db91.6-voice-task-continuity-20261016-r3`. Its five core file changes, shared VLab and production child-task/Feishu delivery acceptance, full captures and Voice registration are recorded in [platform release #394](https://github.com/vegekyd-sys/v-openclaw-platform/pull/394).
