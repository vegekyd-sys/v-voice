# Voice entry and CLI — 2026-10-27

Version: `voice-entry-cli.20261027.1`. Status: deployed and verified.

User explicitly approved merge/deployment of #158, #160, #163, #164 and #165, installation of the CLI and skill on V, and online verification. Research, native #161, private-chat #166 and other PRs are excluded.

The combined change belongs to Voice: existing Gateway protocols, actor checks and Public permissions remain. Reuse each PR's Candidate acceptance and run integrated HTTP/CLI/security/UI regression. Shared VLab is not needed for this scope. No paid voice calls or external messages are part of the verification.

Both Voice nodes receive one verified artifact through the guarded fleet release. The web node alone enables a private managed registry/socket; V runs the CLI as the existing openclaw service user. Preserve old artifacts, launcher, private environment and CLI install backups. No Gateway restart, iOS binary or firmware update.

Production verification covers node hashes/readiness, unchanged Gateway identity, private configuration changes limited to CLI activation, HTTPS resource and cache behavior, production browser homepage/model/App entry, and the CLI create/readback/grant/HTTP/revoke flow. Actual phone audio and OS App installation are separate acceptance.

Integrated validation: 1002 Voice tests, 95 speaker tests, 11 release-controller tests, exact iOS shell check and the real-process CLI demo passed. The demo used fixture providers and made no model calls or external messages.

## Production receipt

- All five original PRs are merged through #167. Runtime commit `b4ed555cd3171534a9a57067b5bb8a1936ba0a34`; main CI 40468827160 passed. Both nodes switched at 2026-10-27T15:50:03+08:00. Artifact hash: `38e10cc813a685a3f648548325d0c0dd853b6ea5f034e55b3c90ced1f42339ab`.
- Both services are ready, admission released, and the old Gateway PID/invocation/config identity remains unchanged. Existing private files retained; only the web CLI activation drop-in and normal release launcher changed.
- V CLI 0.1.0 is installed under the existing openclaw user's PATH. Its managed `voice-cli` skill is eligible and model-visible for V's `makaron` agent. The existing Gateway PATH already resolves it; no Gateway restart was needed.
- The actual production CLI created a private guest grant, authorized it through public HTTPS (200), rejected personal access (401) and long-lived iOS binding (403), then revoked it and rejected the previous cookie (404). Test link revoked and entry disabled. Socket and registry are 0600 inside a 0700 directory.
- A separate Feishu invitation to the existing test conversation redirected to its original Feishu login path (302), then returned 410 after revocation. The test invitation/entry were revoked/disabled; no recipient login or message was performed.
- HTTPS homepage, changelog, iOS UI payload and browser bundle match the deployed artifact. Only the versioned code bundle is immutable-cacheable; HTML/API remain no-store. Live model catalog excludes Grok.
- In Codex's in-app browser, the existing logged-in Feishu entry returned to dial-ready state, its model menu contained GPT Live and SeedDuplex, the App sheet prepared the binding link, and the new homepage changelog was visible. No browser errors were observed. Screenshot retained with private release evidence.

## Limits and recovery

No actual model call, external message, audio capture, physical phone installation, autonomous V Agent task, native App update or firmware update was performed. Immediate hangup remains covered by the accepted Candidate UI evidence and integrated regression; the production artifact is verified, but production audio hangup was not exercised. App/TestFlight OS handoff was previously tested in Candidate; Safari's absent-app system prompt and actual iPhone installation still require device acceptance. The Gateway-loaded GPT plugin is unchanged by this Voice release.

Retain the previous `7ce20a2` artifact and fleet before/after receipts. CLI activation backup records were saved on V before adding configuration; the CLI has a versioned install. Revoke/disable managed grants before disabling the management plane, preserve the latest private registry, and use guarded Voice rollback. Never restore an older registry that could revive revoked links.
