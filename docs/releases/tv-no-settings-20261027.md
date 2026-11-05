# 2026-10-27 — Remove idle Reaction call settings

User request: “reaction下的通话设置要去掉”. Shared UI commit 6884696527db848a2f2ae91cfddebe327d3d5cf1 removes that shortcut and omits the empty glass action group. Existing active speaker/hangup and document access remain. No native APK change.

24 focused tests, UI build and iOS shell freshness passed. Named emulator screenshot and right-side browser mirror confirmed no shortcut. Frozen artifact: 248 files, filesSha256 f3f859d8e027eb33676363690d9526de230a472aed364539aaf5efd8f70d3ba4.

Updated only the existing isolated TV candidate after confirming no active call/task. Actual server bundle hash matches; production Voice and tunnel PIDs unchanged. Runtime candidate homepage notes updated. The TV initially retained an already-mounted old page; an idle Home/reopen refreshed it, then actual TV UI hierarchy and screenshot confirmed the shortcut absent, default Doubao and no dial. Returned TV to Home.

Evidence: sibling v-voice-tv-island/evidence/remove-call-settings-20261027/tv-idle-no-settings.png and checks.json. The preceding artifact remains in the candidate root's voice/ directory; current artifact is voice-6884696/. Native 0.4.14/0.2.4 APKs, theme, private identity and formal Voice/Gateway are unchanged.
