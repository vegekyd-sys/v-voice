# Unified reply delivery follow-up — 2026-10-22

Candidate only; no main merge or production release. The visible conversation/reply-sync banner is removed. The legacy personal entry now resolves an explicitly configured Feishu account and uses the same final-reply delivery queue as session-bound entries; its fixed session, authentication and personal tools are preserved. Server configuration enables the feature, never a browser-supplied target.

## Runtime and real verification

- Public VLab candidate runs `1650d8c527ddbd7f85c7257bdf4044213dde1f83`, based on main `3fe9fcc`; 213 file hashes verified. DM and group reply sync remain enabled. Browser checks show the simplified group and DM page ready to dial.
- The VLab bot is not a member of the original personal group: two personal attempts were rejected with Feishu 230002. Personal sync is therefore disabled in that VLab instance; no bot was added to the group and no account permissions changed.
- An isolated, ephemeral loopback candidate on the original host used the same `1650d8c` artifact, existing personal Gateway/bot and synthetic audio. No historical conversation context was sent to the model. SeedDuplex and Grok each returned audio and one confirmed send receipt to the original personal group. Both messages were visually verified in Feishu and found in the original session history. The original Voice service's PID and invocation were unchanged; the probe was disposed after verification. This does not enable the feature on the original public production URL.
- An initial fixed-phrase history check missed Seed's paraphrase; a later short history window excluded both test messages. A 100-message read-only check found both actual replies. Do not interpret those narrow checks as lost delivery or claim exact prompt wording.

## Choppy playback investigation

The reported group call produced 56 client playback reports: maximum observed underflows 0, local pause count 23, resume count 21, maximum input frame gap 31 ms; no provider reconnect was observed. The candidate omitted `VOICE_NATIVE_PLAYBACK_POLICY` and therefore used `courtesy`. It now explicitly uses the release's `assisted` pause policy. A real personal reservation also returned `assisted`. This establishes the configuration correction, not physical acoustic acceptance. The candidate has no independent interruption-ASR key and that optional channel was not enabled. Human listening, background-noise and interruption acceptance remain pending.

## Validation and integration

The frozen runtime passed 751 Node tests and the iOS resource check. Subsequent integration with main `42ff625` preserves the new release admission gate, cleanup tracking and pending reply tracking, and regenerates the shared UI artifacts. That integration passed 756 Node tests, 10 release controller tests and the iOS resource check. The integration head is not deployed by this follow-up; public runtime remains the exact artifact above.

Earlier single-DM backend child-result failure is still unresolved. Native GPT reply events have fixture coverage, not real GPT WebRTC media acceptance for this feature. Other callers remain closed.
