# GPT Live One — integration in accepted joint build 18

The original GPT-only build17 candidate was not installed. Its transport was semantically integrated into joint build18, preserving the accepted waveform/icon/Reaction work and the main native-duplex adaptation.
It adds the existing GPT Live One (`gpt-live-1-codex`, `sol`) route to the native
app. No Gateway, Worker, server protocol, production runtime or H5 calling path
is changed.

## Ownership and transport

- `CallCoordinator` remains the sole call owner. The selected model persists for
  App and Action Button use; background `AudioRecordingIntent/LiveActivityIntent`
  startup is unchanged.
- GPT reserves with `model=gpt-live,inputPolicy=native`, exchanges SDP through
  authenticated `/api/offer`, and uses native WebRTC 154.0.0. The provider's native
  audio path handles duplex interruption. It does not emulate Speaker gating or
  claim external speaker identity support. Xiaohe/Grok keep their existing policy.
- `VoiceAudio` activates exactly one backend: native WebRTC Voice Processing I/O
  for GPT, or the existing AVAudioEngine PCM relay for Xiaohe/Grok. The engines
  are closed before switching. No WebView owns mic/audio/provider credentials.
- Readiness requires connected peer, open data channel, provider session-start,
  an audio receiver and progressing captured-sample statistics. Failed or
  cancelled SDP work cannot resurrect an old generation.
- Input/output energy comes from WebRTC audio stats, not generated animation.
  Output RMS uses differences in total decoded energy and sample duration; stale
  RTP `audioLevel` fields cannot keep an idle waveform speaking indefinitely.
  The island's existing smoothing and presentation controls remain in use.
- All reservation IDs, authenticated cookies and SDP stay in the native owner.
  The H5 bridge only receives the existing bounded presentation snapshot.

## Shared experience

GPT caption fragments accumulate within explicit native turn IDs; repeated item
finals replace their original fragment. Late finals update their original turn.
Reasoning/delegation bodies are not captions. Reports, tasks and Reaction reuse
existing authenticated endpoints and display layers. SSE reconnects while the
existing presentation polling recovers missed report/control events.

Host end proposals require current caller text, terminal caller turn and quiet
input before confirmation through `/api/call-control-confirm`. Backend end tools
require matching authenticated acceptance and actual native delegation identity.
A matching assistant terminal, audible output and one continuous second of quiet
progressing decoded audio are required before closing. Missing evidence leaves
manual hangup available. This is conservative buffering inference, not a claim
of word-level audio alignment or hardware playback-completion proof.

## Validation

- Core: 23 passing tests, including caption deduplication, bounded content, late
  turn ownership, rejecting ordinary acknowledgments/stale end proofs and
  requiring audible/terminal/continuous statistics before automatic close.
- Simulator: 41 distinct passing native/H5/island tests (5 GPT-specific): the original
  40-test run passed, then all 5 GPT tests passed after final mute/energy refinements.
- GPT tests negotiate two real native WebRTC peers using synthetic PCM only:
  nonzero received audio, incoming captions, control data, mute/unmute, cancelled
  offer, owned HTTP reservation/offer/close, report delivery to the large island,
  repeated trigger without redial and same-owner H5 reload and reopening the original Markdown/table reader.
- The default WebRTC system audio device captures in Simulator and exits cleanly
  before the original PCM engine starts/captures. Synthetic devices are confined
  to test targets, not the shipping binary.
- Muted Opus comfort noise and cached RTP levels initially failed a literal-zero
  energy assertion. The test now verifies absence of the known 440 Hz input tone
  in decoded PCM while muted, and its return after unmute. This also exposed the
  stale-level display risk, fixed by using progressing decoded energy statistics.
  Reconnect passes the muted state before publishing the local audio track.
- Core test first compilation failed because Swift Testing macros captured
  mutating state as immutable. Expressions were evaluated in closures; production
  behavior was not weakened to satisfy a test.
- `evidence/build17-gpt-selection.png` shows the real Simulator selecting GPT Live
  One through native settings, mirrored with serve-sim in Codex IAB.
- Physical GPT two-way voice, Action Button background operation, interruption,
  actual output sound, model greeting, natural hangup and provider reconnection
  remain human validation scopes. Local tests are not provider acceptance.

## Prepared homepage note for approved release

Title: iPhone 接入 GPT Live One

- 在 App 中选择 GPT Live One 后，操作按钮沿用这条线路开始通话。
- GPT 的对话文字、Reaction、后台任务和完整方案接入同一套通话界面与灵动岛。
- 原生音频接入需要升级 App；选择小何或 Grok 可继续使用原来的线路。

Do not publish this note as shipped until the candidate is accepted and the
corresponding source is merged and released. No public homepage change in this
private candidate delivery.

## Joint build18 acceptance and follow-up

Tianyi accepted the installed joint build18 and authorized main integration on 2026-10-22. See `joint-build18.json` for exact artifact and physical scopes. The later incremental-text/line-break feedback remains under diagnosis in the GPT session; there is no additional text fix included in this merge. No new physical acoustic measurements are inferred from the merge approval.
