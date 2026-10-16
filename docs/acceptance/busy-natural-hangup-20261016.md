# Busy natural hangup candidate — 2026-10-16

Status: partial real-model acceptance; **not release approval**. PR #27 is a draft. No production deployment, entry switch, shared configuration change or production/shared Gateway restart occurred.

## Implementation

SeedDuplex uses the existing host semantic call controller, independently of pending tools. Matching final ASR, a current decision revision and caller microphone silence are required before confirmation. Fresh caller audio invalidates the pending close. A dedicated farewell ownership record binds the host request to its actual provider response and audio frames. Late native text/output and cancellation acknowledgements cannot steal or revoke that ownership. The browser closes only after the matching terminal response and actual audio rendering drain. Existing admitted backend-task lifetime and bound-group delivery remain in place.

The decision model handles call control only. Task admission, cancellation, children and delivery policies are unchanged. No Gateway core changes are included. The Candidate explicitly enables `VOICE_HOST_CALL_CONTROL=1` and provides its existing decision-provider credential through the private environment; a release must verify this host-side configuration. No credential values or shared configuration are changed by this PR.

## Environment and evidence

Real GPT Live native WebRTC and SeedDuplex relay sessions ran against isolated VLab Candidates, using synthetic Mandarin microphone audio through the product browser UI. Model/provider transport was real. No Grok call was made. Raw user audio was not recorded. Private logs, credentials, session cookies, access-bearing URLs and recipient identifiers are excluded from Git.

The implementation under the final regression was `e020b73`. Local automated checks: **506 passed, 0 failed**. GitHub Actions did not start because account billing/spending limits rejected the job; this is not a passing CI check.

## Actual observations

| Scenario | GPT Live | SeedDuplex |
| --- | --- | --- |
| Ordinary natural goodbye → real farewell → rendered drain → idle | Passed on final source | Passed; repeated on final source after a revoked goodbye |
| Tool/backend work outstanding at goodbye | Passed real fast-tool overlap: persisted backend transcript shows web_search awaiting its result when final goodbye ASR arrived; 259 ms overlap, then actual farewell/drain/idle. This is a narrow overlap, not a long-delay stress test | Passed with a real web-search call and a controlled 16 s test delay; no tool result preceded close |
| Admitted backend task continues after hangup and reaches dedicated test group | Not repeated for GPT | Passed: same task/run completed after call close; final Feishu message independently read back |
| Final backend report is actively speaking when goodbye begins | Passed on final source: actual backend-final result → new assistant report turn → real rendered speech → synthetic microphone goodbye → farewell/drain/idle | Passed on final source: real backend result → identified report audio → synthetic microphone goodbye 303 ms later → farewell/drain/idle |
| New caller speech revokes pending hangup | Passed: second ASR and live response, call remained connected | Passed on final source; subsequent new goodbye also drained and closed |
| Discussion/quoted/conditional hangup is not a command | Passed one combined real-ASR negative example | Passed one combined real-ASR negative example |

Fixture tests and model statements are not counted as real-model acceptance. The table does not claim five completed acceptance scenarios per model.

## Causal timeline (Asia/Shanghai)

SeedDuplex admitted-task acceptance used source `362057b`, before the final additional farewell-ownership fix. It remains continuity evidence, and is not represented as a final-source repeat of every scenario.

- 12:05:55.212 — real backend task admitted with an assigned task ID and run ID.
- 12:06:35.695 — real final ASR requested hangup while preserving backend work and reporting to the bound test group.
- 12:06:37.092 — host ending accepted.
- 12:06:37.554 — identified farewell audio/caption began.
- 12:06:37.685 — corresponding audio response terminal.
- 12:06:40.218 — browser reported matching playback drain.
- 12:06:40.323 — call closed.
- 12:06:46.124 — the **same** task/run completed.
- 12:06:46.681 — final delivery receipt; independent Feishu readback confirmed the actual final message in the dedicated test group.

The tool's claimed “wait 40 seconds” is not used as proof that an actual sleep tool ran. Task admission, call close, later completion and independently observed delivery establish the continuity claim.

Final-source SeedDuplex regression:

- First goodbye was accepted, then fresh caller speech caused `end.cancelled`; the model answered the new ASR and the call remained connected.
- Second goodbye final ASR at 12:39:33.086; accepted 12:39:34.584; identified farewell 12:39:34.908; audio terminal 12:39:35.395; browser drain 12:39:37.634; call close 12:39:37.770.

Final-source GPT baseline: final user ASR 12:35:42.066; semantic selection 12:35:42.995; real assistant farewell terminal 12:35:47.512; native playback-drained diagnostic observed; server call close 12:35:48.654; UI idle.

Final-source SeedDuplex active-report acceptance: backend result at 12:57:39.913; actual injected report audio at 12:57:40.808; microphone goodbye began 12:57:41.111; final goodbye ASR 12:57:47.318; host accepted 12:57:48.721; own farewell audio 12:57:49.095; terminal 12:57:49.256; playback drain 12:57:51.617; UI idle. The result included the retained earlier report request as well as the current two-sentence test report; it was an actual backend result, not a progress acknowledgement.

GPT fast-tool trace: web_search call persisted at 12:40:35.792; goodbye final ASR 12:40:38.637; tool result persisted 12:40:38.896; farewell terminal 12:40:44.453; server close 12:40:45.419 with native playback-drained diagnostic and idle UI.

Final-source GPT active-report acceptance: backend-final tool result 13:01:04.088; new report assistant turn 13:01:04.842; rendered-speech marker and microphone goodbye 13:01:05.241; report turn interrupted 13:01:07.318; final user goodbye ASR 13:01:11.952; assistant farewell terminal 13:01:17.608; native playback-drained diagnostic recorded and UI idle. An earlier later-than-report goodbye was excluded; a separate no-ASR media-disconnection attempt was also excluded.

## Issues found during real testing

1. A delayed cancellation acknowledgement from old native output revoked an already accepted host farewell. Fixed by keeping response-cancelled acknowledgements separate from fresh caller speech.
2. A late native output boundary could overwrite the ordinary pending caption before dedicated farewell audio began. Fixed with independent farewell ownership and response identity.
3. SSH-carried audio tests had input backlog/overflow and no final ASR. Excluded, then replaced with protected hosted media transport.
4. A private empty-schema fixture omitted canonical FTS triggers and rejected task admission. This was a test environment problem, not accepted application behavior. A later report attempt reached the backend but exhausted the private 2048-token output cap; it was also excluded, and the isolated cap was increased to 8192 for the retry.
5. Starting a second call on the same conversation interrupted a report test. Excluded.

## Remaining release gates

Complete the missing real-model matrix rows; repeat busy/delivery acceptance against the exact final source; obtain required CI once account billing is restored; then let the owning release task review and decide merge/deployment. Keep `current.json` and shipped homepage notes on their verified baseline until actual delivery. Physical iPhone/Safari acoustics and real-user microphone behavior were not accepted here.

Cost receipts only cover the decision endpoint and are not a reconciled total provider bill. A complete paid-usage total must not be inferred from these receipts.
