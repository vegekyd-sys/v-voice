# Voice entry and CLI — 2026-10-27

Version: `voice-entry-cli.20261027.1`. Status: release preparation; production cutover not yet claimed.

User explicitly approved merge/deployment of #158, #160, #163, #164 and #165, installation of the CLI and skill on V, and online verification. Research, native #161, private-chat #166 and other PRs are excluded.

The combined change belongs to Voice: existing Gateway protocols, actor checks and Public permissions remain. Reuse each PR's Candidate acceptance and run integrated HTTP/CLI/security/UI regression. Shared VLab is not needed for this scope. No paid voice calls or external messages are part of the verification.

Both Voice nodes receive one verified artifact through the guarded fleet release. The web node alone enables a private managed registry/socket; V runs the CLI as the existing openclaw service user. Preserve old artifacts, launcher, private environment and CLI install backups. No Gateway restart, iOS binary or firmware update.

Production verification will cover node hashes/readiness, unchanged Gateway identity, private configuration changes limited to CLI activation, HTTPS resource and cache behavior, production browser homepage/model/App entry, and the CLI create/readback/grant/HTTP/revoke flow. Actual phone audio and OS App installation are separate acceptance.

Integrated validation: 1002 Voice tests, 95 speaker tests, 11 release-controller tests, exact iOS shell check and the real-process CLI demo passed. The demo used fixture providers and made no model calls or external messages.
