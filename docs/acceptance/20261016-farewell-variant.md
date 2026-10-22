# GPT Live farewell wording regression

The production browser reached `ending` after the real provider said “好的，这就为你结束通话。嗯，再见，下次再聊。” The host had accepted the current caller request, and the assistant turn terminated, but the page only recognized the exact normalized phrase `再见下次聊`. It discarded the completed turn as a non-farewell.

The patch also accepts `再见下次再聊`. It retains current-call/current-user authority, host confirmation, actual farewell audio, terminal turn, and 750 ms playback drain. An ordinary acknowledgment still cannot close the line. There is no Gateway or provider-routing change.

## Validation

- Exact production transcript regression: original app fails, patched app passes. The negative acknowledgment case remains open. Existing app suite: 77 passing tests. Call-control and relay suites: 25 passing tests.
- Isolated browser candidate: only `/voice/app.js` was fulfilled from this worktree; all ASR, model, host controls and playback used the authorized real service. No production source or unit was changed. No Candidate process was installed on V. This is a frontend candidate, not a deployed VLab backend.
- GPT Live: synthetic natural farewell -> real ASR and host decision -> real assistant farewell -> playback-drained diagnostic -> idle. The actual live reply used the canonical wording, so the alternate wording is established by the exact production replay regression, not claimed as repeated live coverage.
- SeedDuplex: real report generated and rendered; 390 x 844 report scrolled to 1630 / 2278 px (648 px viewport), closed, pill x=32.156..357.844, avatar x=156..234, document width=390. Natural farewell then returned to idle. This patch changes only the GPT native path.
- The initial runner incorrectly expected the conversation container `innerText` to be empty after reset. That API includes the permanently present hidden “最后的片段” heading. Reviewed evidence confirms idle with only that placeholder and no transcript. The assertion was corrected; this was not a second product defect.
- Synthetic microphone only; no physical microphone or raw user audio recorded. Real iPhone Safari was not retested.

Status: candidate verified; not merged or deployed. Production remains the frozen a9ac5168 artifact. This follow-up requires Tianyi's merge decision.
