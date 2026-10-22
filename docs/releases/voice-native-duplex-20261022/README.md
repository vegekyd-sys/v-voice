# Native duplex release, 2026-10-22

Tianyi accepted the Candidate experience except automatic hangup; the accepted-end/no-farewell fallback was subsequently fixed and verified in real Candidate calls plus a service fault simulation. Tianyi explicitly authorized merge and production release.

This is Voice-only: existing Gateway interfaces, identity and tool permissions are unchanged. Candidate covers the release integration boundary; no shared VLab or Gateway restart is needed.

## Delivery

- Capable web clients explicitly request the advertised native phone policy. Older clients retain Speaker routing.
- Native SeedDuplex receives continuous audio. A reversible local pause preserves unconsumed samples; provider response identity owns irreversible replacement. No added Speaker/Decision chain for native calls.
- iOS build 16 implements reversible player pause while capture continues, old-response retirement and matching ignored-speech recovery. Build 15 report island and remotely delivered H5 are preserved. Native audio requires an app update.
- An accepted end_call with no farewell audio triggers a delayed farewell request; if that also fails, the already accepted hangup finishes. Normal closing waits for matching output and actual playback drain.

## Evidence and limits

Earlier evidence: [native integrated](../seeduplex-duplex-candidate-20261022/NATIVE-INTEGRATED.md), [farewell](../seeduplex-duplex-candidate-20261022/NATIVE-FAREWELL.md). These retain all failures, including long pauses from television/bystander speech, continuous-TV unwanted replies, quiet interruptions and imperfect name/fact binding.

Current release checks: Node 713/713, existing Speaker 95/95, Swift core 20/20. Native simulator suite 51/51. Exact-artifact Candidate smoke: native/assisted reservation, actual output silent 171 ms after interruption, no old audio replay, answer 5, automatic farewell/hangup. One HTTP 409 during hangup remains an observed network error. Production main artifact `eaa920e64b7eb8b1b034b8a03d1bfff636d65e42` was deployed with 205 hashes verified, main CI passed, original private settings preserved and three native policy flags added. Gateway PID and invocation stayed unchanged. Public HTTPS app, relay, homepage notes and iOS H5 archive hashes match the frozen artifact. Real production synthetic audio smoke stopped actual playback at 163 ms, answered 2+3=5 without replaying old audio, then played farewell and automatically returned to dial. One hangup HTTP 409 was again observed. See [release.json](release.json). A simulator, synthetic input and human web acceptance do not establish physical iPhone acoustic acceptance for build 16.

## Rollback

Use the established H5-only CAS controller and its private plan/install receipts. Preserve the original pointer, unit launcher, private environment and Gateway identity. Require known zero active calls, creating sessions, pending background tasks, Gateway open voices and relay sockets before either switching or rolling back. Only openclaw-rtc-h5.service may restart.

## Concurrent iOS delivery

The connected iPhone currently reports private candidate build 17 from the separate iOS/Live Activity work. This task signed and verified its main-based native duplex build 16 but did not overwrite the newer device candidate or modify that task's worktree. The merged native changes must be included in its subsequent combined app update. Native audio is not delivered by H5 hot update; the installed older-native path keeps Speaker compatibility.
