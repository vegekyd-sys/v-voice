# Entry, iOS binding and lifecycle correction

Version: `voice-entry-speed-status.20261024.1`.

The prior release suppressed iOS binding for every dynamic conversation. Installed native clients also accept only 8–64 lowercase phone IDs, so revealing the button alone would not restore the handoff. The new server alias is 44 characters; the private grant retains the original conversation, verified actor and fingerprint. Real Candidate browser issuance, device redemption without an OAuth cookie, status authorization, browser revocation and a subsequent 401 were verified. HTTP and native fast-socket fixtures cover the same actor and conversation; a stale device cookie cannot override a newly verified browser identity. No native source changes are required.

The reported production call was recorded and closed after 89.128 seconds. Its actor-scoped message edits returned `internal_error`; editing the exact owned receipt through the existing host contract succeeded. The change confines host edits to IDs obtained from this call's own send receipt and verifies the chat target. Caller sends, tool invocations and conversation lookups remain actor scoped. Tests include timer advancement, delayed edits, final duration, retries and conflicting receipt targets.

## Timing evidence and limits

- Production guest page, desktop in-app browser: TTFB 554.7 ms; dial ready 1335.4 ms. This excludes Feishu identification.
- Already authenticated Candidate page, same desktop Chrome tab: before 2663.1 ms; after 2669.3 ms. This path skips the client SDK and is not evidence of login speedup.
- Production read-only server probes: app-token retrieval 132–183 ms; Gateway admission 432–705 ms.
- The client identification path removes a redirect/document request, an external bootstrap module request, duplicate Gateway admission, user_info when the trusted token response already includes basic identity, and app-token fetches while the cached credential remains valid.
- Numeric profiling spans SDK load/readiness, client code, server exchange/admission and final dial readiness. Guest fallback is distinguished from confirmed identity. No codes, user identifiers, URLs or conversation content enter timing logs.
- Real mobile Feishu SDK end-to-end latency remains pending a phone opening. 2–3 seconds is a target, not an accepted measurement.

889 Voice tests, 95 speaker tests and 11 release-controller tests passed. The exact generated H5 shell was checked. No paid model call or microphone recording was started for this correction. Production deployment and exact running commit are recorded separately.

## Production receipt

Both web and device nodes were deployed on 2026-10-24 at 05:24 CST from commit `78fd43e035b82754f16cc49016d8e4648781606f`, artifact SHA-256 `91d7344affc6530af3296ff86cb0ed4ddc32a338a30cb730c26ddfc824001eb6`. Both returned ready with admission released. The exact merge commit passed CI before deployment. Gateway PID, invocation, start time and configuration hash were unchanged. Previous commit `04d1022370ff2caff99a65c81e5051b8bad59425` and its launch/environment material remain available for rollback.

Seven public files matched the packaged bytes, including the user-visible changelog and generated UI. The production browser showed the iOS App button. A fresh production binding was issued, redeemed and authorized without the browser OAuth cookie; status confirmed the verified actor and group. The test grant was then revoked through the browser, and its cookie subsequently returned 401. This verifies the server binding path, not a new physical iPhone call. Native Build 32 remains the accepted baseline.

In the same desktop Chrome browser, one observation of the OAuth callback navigation to dial readiness improved from 2471.0 ms to 1718.7 ms (30.4%). The updated already-authenticated page took 1534.1 ms. These are single samples and exclude the mobile Feishu SDK path and time spent by a person at consent. Full mobile entry-to-dial 2–3 second acceptance remains pending.

The previously stuck owned call card was updated through the verified message receipt to ended with 1 minute 29 seconds. The edit returned success; the message-read API exposed a fallback body, so a visual readback is not claimed. No new paid call was started.
