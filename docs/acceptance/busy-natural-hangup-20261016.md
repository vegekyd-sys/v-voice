# Busy natural hangup acceptance — 2026-10-16

Status: requested real-model scenarios observed; **CI blocked, not release approval**. PR #27 remains a draft. No merge, production deployment, entry switch, shared configuration write, or production/shared Gateway restart occurred.

## Change

SeedDuplex shares the existing host semantic call controller, independently of pending tools. Matching final ASR, the current decision revision and caller microphone silence are required before confirmation. Fresh caller audio invalidates pending closure. Dedicated farewell ownership binds the host request to its actual provider response and audio frames. Late native output and cancellation acknowledgements cannot steal or revoke that ownership. Media closes only after the matching terminal response and actual browser playback drain.

Task admission, task/child cancellation policy and delivery routing are unchanged. Existing admitted work keeps its separate lifetime and bound-group delivery. No Gateway core changes are included.

The Candidate enables `VOICE_HOST_CALL_CONTROL=1` and supplies the existing decision-provider credential through its private environment. A release must verify this host configuration; this PR contains no credential values or shared configuration changes.

## Environment and validation

Real GPT Live native WebRTC and SeedDuplex relay calls ran through the product UI in the Codex in-app browser, against isolated VLab Candidates. Microphone input was synthetic Mandarin speech; models and backend execution were real. No Grok call or raw user-audio recording was made. Private evidence remains outside Git.

Implementation: `e020b7347150f1c8ecd72dc3fea788a9e84c0b40`. Four key runtime files were hash-matched between the worktree and final Candidates. Documentation commits do not change that implementation.

- Local automated checks: **506 passed, 0 failed**.
- Five requested scenarios per model, plus a combined discussion/quotation/negation example, were actually exercised below.
- GitHub Actions did not start: account payments/spending-limit rejection. This is not a passing CI check.
- Both final backend-continuity messages were independently read back from the dedicated approved test group, sent by V - Lab.
- Before shutdown, both final test entrances reported active calls 0, creating sessions 0 and background tasks 0.

## Real-model matrix

| Scenario | GPT Live | SeedDuplex |
| --- | --- | --- |
| Ordinary goodbye → real farewell → rendered drain → idle | Passed | Passed, including a fresh goodbye after revoked closure |
| Goodbye while a fast tool is pending | Passed: persisted real web_search result arrived 259 ms after goodbye final ASR. This is a narrow natural overlap, not a long-delay stress test | Passed on final source: real web_search path with an explicit controlled 16 s pre-RPC test delay; no tool result before media close |
| Admitted long work continues after hangup | Passed on final source: same native backend run executed a real sleep after close, then final Feishu message read back | Passed on final source: same task/run completed after close, then final Feishu message read back |
| Goodbye during actual final-report playback | Passed: backend-final result, new report turn, rendered speech, microphone goodbye, farewell and drain | Passed: backend result, identified injected report audio, microphone goodbye 303 ms later, farewell and drain |
| New speech revokes pending hangup | Passed: new final ASR and live answer; call remained connected | Passed: accepted ending was cancelled; new ASR answered; a later fresh goodbye completed normally |
| Discussion/quoted/conditional wording is not a hangup command | Passed one combined real-ASR negative example | Passed one combined real-ASR negative example |

Fixtures and model promises are not counted as real-model acceptance. The SeedDuplex fast-tool delay is a test condition, not claimed production/provider latency. An actual new nested-child completion after hangup was not separately retested; this change retains the existing child lifetime policy and its automated coverage.

## Causal timelines (Asia/Shanghai)

### GPT Live long work, final implementation

- 13:06:22.675 — native backend run accepted.
- 13:06:33.982 — final hangup ASR while the backend call remained pending.
- 13:06:39.225 — actual assistant farewell terminal.
- 13:06:40.541 — server media close, following native playback-drained evidence and idle UI.
- 13:06:42.309 — that same backend run issued an actual `exec` containing `sleep 40`, after media had already closed.
- 13:07:23.570 — successful exec tool result persisted.
- 13:07:27.690 — final Feishu delivery receipt; independent user-side readback confirmed the final test marker and date in the dedicated group.

### SeedDuplex long work, final implementation

- 13:09:27.746 — backend task admitted with its run ID; final task ID was retained on completion.
- 13:09:31.186 — actual exec containing `sleep 40` persisted.
- 13:09:39.433 — host ending accepted while the original backend task was still pending.
- 13:09:39.795 — identified real farewell audio/caption.
- 13:09:40.119 — corresponding audio response terminal.
- 13:09:42.255 — matching browser playback drain.
- 13:09:42.363 — media closed.
- 13:10:11.318 — successful sleep/exec result persisted after close.
- 13:10:14.198 — the same task/run completed.
- 13:10:14.740 — final Feishu delivery receipt, independently read back from the dedicated group.

### Report playback and fast-tool checks

GPT report: backend-final result 13:01:04.088; new report turn 13:01:04.842; rendered speech and microphone goodbye 13:01:05.241; report turn interrupted 13:01:07.318; goodbye final ASR 13:01:11.952; farewell terminal 13:01:17.608; native playback-drained diagnostic and idle UI.

SeedDuplex report: backend result 12:57:39.913; identified report audio 12:57:40.808; microphone goodbye 12:57:41.111; final ASR 12:57:47.318; host accepted 12:57:48.721; own farewell 12:57:49.095; terminal 12:57:49.256; drain 12:57:51.617; idle UI. The real result included a retained earlier report request and the current short test report; progress acknowledgements were excluded.

GPT fast tool: real web_search call 12:40:35.792; goodbye final ASR 12:40:38.637; tool result 12:40:38.896; farewell terminal 12:40:44.453; server close 12:40:45.419 with native playback-drained evidence.

Final SeedDuplex fast tool: tool call 13:12:08.626, controlled delay entered 13:12:08.627; goodbye final ASR 13:12:16.286; host accepted 13:12:17.673; own farewell terminal 13:12:18.190; drain 13:12:20.535; media close 13:12:20.684. The pending tool had not returned before close.

## Failures found and excluded

1. An old native response-cancelled acknowledgement revoked accepted host farewell. Fixed by separating that acknowledgement from fresh caller speech.
2. A late native output boundary overwrote the pending farewell caption/audio binding. Fixed with dedicated ownership and response identity.
3. SSH-carried audio tests had backlog/overflow without final ASR. Replaced with protected hosted media transport; excluded from acceptance.
4. An empty private database fixture omitted canonical FTS triggers. Repaired only in the Candidate. A private Worker output cap also caused report truncation; corrected in its separate test configuration and retried.
5. A second call on the same conversation interrupted one test; another goodbye started after report playback. Both were excluded. A later GPT media-disconnection attempt without ASR was excluded before a successful fresh repeat.
6. One earlier Candidate lifecycle receipt exited 1; its isolation receipt still reported sharedUnchanged=true. Subsequent completed Candidate receipt exited 0 with sharedUnchanged=true. Per-scenario results above come from causal media/task evidence, not runner exit codes.

## Release limits

Required CI must run successfully after account billing is restored, followed by owning-task review and its explicit merge/deployment decision. `current.json` and shipped homepage notes retain their verified #25 baseline until actual delivery. Physical iPhone/Safari acoustics and real-user microphone behavior were not accepted here.

Decision-endpoint usage receipts are preserved privately. Backend transcript cost fields contain zero placeholders and speech billing was not reconciled; neither is evidence of free calls or a complete provider total. No reconciled total spend is claimed.
