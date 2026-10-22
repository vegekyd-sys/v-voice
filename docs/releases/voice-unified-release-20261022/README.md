# Unified Voice delivery

Tianyi authorized a single release mechanism for web, iOS, robot and speaker, correcting the device-node version gap while preserving ongoing calls. PR #67 introduces the mechanism; `release.json` records the verified production outcome separately from its implementation.

The web/iOS node and domestic robot/speaker node use the same immutable artifact. Devices previously ran `0ed43617fbcdd15e93fd63085afe61dc5231a118`; all 253 inspected source files matched that revision. The concurrent caption release updated web to `3fe9fcc25039c620e7745bf83a14b14c9d523f29` before this cutover; that change and its iOS build 19 delivery records are included in the unified source.

Daily authorized releases must use `scripts/release-fleet.py` with both nodes in the private inventory. It verifies main ancestry and CI, stages and hashes both artifacts, waits for idle admission, preserves each node's settings and records completion only when both running identities agree. Busy nodes remain pending; an already-current node is not restarted. See [the operating contract](../../unified-release.md).

## Acceptance boundary

Local verification covers 720 Voice tests, 95 Speaker tests, 10 release-controller tests and exact iOS shell freshness. Real HTTP/WebSocket tests exercise admission and in-flight work; mocked service failures cover rollback ownership. An isolated Linux service verifies the first-release network gate, including deferral for an existing connection and restoration of new connections after cleanup. That fixture never touched production ports.

This task makes no automatic model call and performs no firmware flash. Build 19 installation is established by the separate [caption delivery](../voice-caption-continuity-20261022/release.json); this release only supplies its compatible shared UI update. Device firmware remains unknown without a reliable report. Equal server artifacts do not constitute physical audio, echo, interruption or caption acceptance.

## Retained rollback evidence

Both old immutable release directories remain available. Private per-node receipts retain original launcher bytes, symlink target, service identity, configuration hashes and the web node's Gateway identity. The controller rolls back a failed candidate only while it owns the launcher and the candidate remains held and idle. Unknown or newly active work blocks rollback. Never restart Gateway or force-stop a call to undo a Voice release.

Full inventories, private configuration, service receipts and device identities stay outside Git. The checked-in registration contains only sanitized versions, hashes and verification outcomes.
