# TV startup first-paint correction — local candidate

The previously reviewed portrait candidate could paint the regular light H5 landing page before `app.js` selected TV layout. Delaying that module by 1200 ms reproduced a white rounded panel behind the avatar on FamilyTV_UI.

The server now emits TV layout/transparency in the initial HTML, alongside existing inline CSS. A new thin-shell presentation flag pauses entrance motion until the current owner/generation is ready. The Android host keeps its transparent WebView at alpha zero until a WebView visual-state callback confirms the frame; only then does it hide the native Home portrait. Older shells and regular Web pages retain their original presentation behavior. Presentation never initiates a call.

Validation:

- Shared full suite: 984 passed; final server/TV/changelog suite: 54 passed. Generated UI and iOS shell source freshness passed; no iOS binary release.
- Android JVM tests, lint and release build passed for 0.2.4-firstpaint-local (106).
- Named emulator FamilyTV_UI / emulator-5580, 1920×1080, density 320. Three cold starts with a 1200 ms module delay all connected through the local synthetic fixture.
- Actual recordings sampled at 60 fps. Safe background ROI x1340 y212 width70 height150 excludes the portrait and content cards. Mean RGB >210: old candidate 71/419 frames; corrected runs each 0/419. This measures the reproduced white panel, not arbitrary screen content.
- Twelve emulator call checks passed, including direct Doubao dial, output mute with microphone retained, same WebView across compact/full, hangup/redial and Home release.
- Recordings, captured frames and metrics: `/tmp/v-tv-firstpaint-20261027/`. Native frozen receipt: sibling `v-voice-tv-island/docs/releases/tv-firstpaint-20261027.json`.

This is a local candidate only. No physical TV, online candidate, Gateway or production service was modified; no household audio or paid model call was recorded. Physical acoustic and remote/STR acceptance remain separate.

## Subsequent authorized TV trial

On 2026-10-27 Tianyi explicitly requested “装到电视上我看下”. This exact shared artifact f025824 was installed on the isolated TV candidate (248 frozen file hashes verified); existing HTTPS tunnel and private entry were retained, default model is Doubao. Production Voice/Gateway remain unchanged. Desktop 0.4.14 / host 0.2.4 compatibility builds and 16 actual-device software checks passed; real audio and physical acceptance remain pending. See [installation receipt](../../../v-voice-tv-island/docs/releases/tv-firstpaint-installed-20261027/README.md). Candidate runtime release metadata contains the installed TV update notes; shipped global Voice notes are unchanged.
