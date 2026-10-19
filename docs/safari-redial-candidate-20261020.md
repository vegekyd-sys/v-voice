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
