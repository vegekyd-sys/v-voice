# Voice release log

## Unreleased — busy natural hangup candidate

SeedDuplex uses the existing host semantic call controller independently of tool completion. The relay confirms matching caller captions after microphone silence, receives an identified real farewell response, and closes only after its terminal audio and actual rendering drain. New caller speech revokes stale decisions. Accepted Agent work retains its existing lifetime and bound Feishu delivery.

Candidate only; no merge or production deployment. Real-model acceptance is partial: ordinary farewell/drain, active backend-report interruption and speech revocation passed on GPT Live and SeedDuplex; SeedDuplex admitted-task continuation and final Feishu delivery passed. The full per-model matrix and final-source continuity repeats remain open. See [acceptance report](docs/acceptance/busy-natural-hangup-20261016.md). Homepage shipped notes retain the #25 baseline until actual delivery.

## Unreleased — publication visibility and pending-work checks

Restore the missing October 16 homepage release notes and make product-facing notes a release preflight requirement. Authenticated status now exposes whether active calls, session creation, or pending backend delivery prevents an entry cutover. Persist only bounded causal event metadata and numeric playback counters to distinguish received speech, tool waits and missing output; no tool arguments, result bodies or audio are added.

This does not claim to fix the reported SeedDuplex silent replies. The companion platform PR changes only the Voice publication controller, with no Gateway runtime or systemd policy changes.

## 2026-10-16 — Voice #23 farewell wording

GPT Live may say “再见，下次再聊” after an accepted caller hangup request. The page now recognizes that equivalent variant alongside “再见，下次聊”, while retaining host authority, current-user ownership, a terminal assistant turn and actual audio drain.

Production entry commit: `bcb82987c7cc6c61e87ecc9f28c320df6bfb470b`. Gateway plugin stays at `a9ac516860a8856470262957ad6ea0cc2670cb0e`, byte-identical to the new package for plugin/lib/server files; only frontend app.js changed. No Gateway restart or config change.

Both GPT Live and SeedDuplex synthetic natural calls automatically returned to idle with reset transcript and no browser errors. The recorded alternate farewell passes exact replay; live GPT used canonical wording. Physical iPhone Safari and unrelated backend/media tasks were not retested. First entry activation was rolled back after a controller receipt failure; the second passed all original guards. See [registration](docs/releases/voice-bcb82987-20261016/manifest.json), [current version](docs/releases/current.json), and [PR #23](https://github.com/vegekyd-sys/v-voice/pull/23).

## 2026-10-16 — Task continuity baseline

The earlier accepted task-continuity baseline uses Voice `a9ac5168` and the platform core release `v2026.9.1-db91.6-voice-task-continuity-20261016-r3`. Its five core file changes, shared VLab and production child-task/Feishu delivery acceptance, full captures and Voice registration are recorded in [platform release #394](https://github.com/vegekyd-sys/v-openclaw-platform/pull/394).
