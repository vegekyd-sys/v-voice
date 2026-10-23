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
