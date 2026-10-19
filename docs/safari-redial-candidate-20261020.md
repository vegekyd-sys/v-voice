# Safari repeat-call capture recovery candidate

This change addresses two verified lifecycle gaps in the browser relay: the resolved promise from the dial gesture was treated as proof that the AudioContext still runs after microphone/provider startup, and a cached `live` microphone track was reused even when the browser marked it system-muted. A foreground interruption only displayed a playback notice while both microphone and speaker worklets stopped. The candidate checks current context state before attaching worklets, attempts one resume per interruption while visible, retries on return to the foreground, and replaces a system-muted cached track on the next dial. Disposal removes context and page listeners.

The reported physical iPhone failure happened with Safari in the foreground and the display on. Backgrounding or screen lock is therefore not an explanation for that report. A second observed call had substantially less uploaded audio than elapsed time and stopped sending periodic client statistics before hangup. Existing metadata cannot establish whether the audio context, page execution or transport stalled. This is a repair of demonstrated failure modes and an observability candidate, not confirmation of the physical-device root cause.

## Validation

- Real Safari engine on an iPhone 17 Pro simulator, iOS 26.5. WebDriver supplies mock microphone media and explicitly allowed autoplay; this does not validate physical microphone permission, acoustic echo cancellation, or real user gestures.
- Rollback source `d37ac851487b8fd9023ad0c922bdb1cf485984ec`: three ordinary same-page calls, hangup and redial worked. The reported spontaneous physical-device failure was not reproduced.
- Controlled foreground AudioContext suspension during call two: rollback stopped its audio clock at roughly four seconds and uploaded only 196 frames during the ten-second call. The candidate resumed its audio clock and uploaded 500 frames (ten seconds); the previous call's context was closed and its WebSocket was released. Test media stayed local; no provider or paid call was used for these comparisons.
- Muted-cache regression: a track that remains `live` but becomes system-muted is retired on redial; a late disposer from the old call cannot mute its replacement.
- Main-branch unit/regression suite: 587 passed. Existing device playout timing assertion failed once by one millisecond under parallel load, then its isolated seven tests and the full suite passed without changing that code.
- Existing Speaker regression suite: 50 passed as compatibility coverage only. This PR adds no Speaker feature or production enablement.
- An independent rollback-source candidate applies only five runtime files (microphone capture/session, relay, client statistics validation and transcript statistics validation); its existing 479 relevant tests passed. It uses existing Gateway APIs; no Gateway/Worker, policy, identity or cross-service protocol change is required, so it is validated in Candidate rather than shared VLab.

## Acceptance still required

On the physical iPhone, use the candidate and the rollback entry for the same sequence: call, say one short question, wait for the spoken answer, hang up, redial in the same tab, and repeat. Keep Safari in the foreground with the screen on. Only bounded scalar counters and audio lifecycle states are added to diagnostics; no raw voice, labels, device identifiers or extra transcript content is retained.

Production remains the rollback source. Formal release requires PR merge, checks and a separate release decision; homepage release notes and version registration must be updated for the actual release. The private candidate is based on the rollback source and contains no multi-speaker runtime or other chat's unmerged changes.

## Delayed-input overflow follow-up

Physical-device feedback on the first candidate produced `Seeduplex pending input audio overflow` followed by a return to the dialing page. The added counters show that capture remained running in the foreground with live, enabled, unmuted input and a maximum worklet callback gap of 43 ms, while receipt of client statistics was delayed for roughly twenty seconds before a catch-up burst. This narrows this instance to the send/transport/receive path; it does not establish which intermediary caused the delay, and it does not justify attributing it to VPN or Speaker.

The provider deliberately paces input at 20 ms. A burst that exceeds its ten-second pending queue used to call the terminal error callback, which closes the host call. It now uses existing bounded session recovery, retains the provider dialog id, discards stale unsent input and audio arriving during reconnect, and notifies the caller that the delayed speech must be repeated. This is congestion recovery, not lossless delivery or a cure for the underlying transport delay. Repeated recovery can still reach the existing bounded failure limit. Queue size was not increased. The idle watcher no longer mutes input while a paced backlog remains, preventing the observed mute/unmute oscillation.

Added tests replay a twelve-second input burst without any live provider, verify that no terminal error/close occurs, resume the original dialog, and verify fresh audio delivery. A second test drains a stalled backlog without mute oscillation. The browser UI test uses generated local media and a local relay fixture; recovery stays on the connected page and explicitly asks for discarded speech again. The main suite now has 591 tests; the rollback-source candidate has 483 relevant tests. Existing Speaker compatibility coverage remains 50 tests. Physical iPhone long-call and repeated-call acceptance is still pending. No paid or real microphone test was initiated for this follow-up.

CI also reproduced the existing device playout assertion at 23088 versus 23040 bytes. Its exact 480 ms assertion was reading wall-clock time while the rest of that suite uses an injected clock. The test now injects a fixed clock; device playback runtime behavior is unchanged.
