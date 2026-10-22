# Shared SeedDuplex playback repair

The reported behavior affects web and native iOS. The referenced multi-account/reply-sync task remained in its isolated Candidate; its code was not in the production release. Production already had native phone input and assisted playback configured. Persisted audit metadata lacks an iPhone playback cursor and cannot establish the exact acoustic stop time. There is no evidence that the multi-account Candidate caused this production failure.

## Cause and change

The provider adapter used the latest TTS owner before a PCM packet's explicit response ID. Delayed old PCM could therefore be relabeled as new, making both clients append an old five-second tail. The adapter also waited until replacement audio to establish a boundary, even after replacement text had arrived. Both behaviors reproduce against the main baseline c1d854c, on top of the already-merged native build 20 patch.

An accepted, non-aside replacement text/TTS response now retires the previous response and emits audio.clear with retiredResponseId before new PCM. Explicit packet identity wins; anonymous PCM belongs to the last actual TTS start, so an early text response cannot adopt an anonymous old tail. Late old start/PCM/done and anonymous usage/cancel acknowledgements cannot finish, resurrect or clear a newer playback. Web and native clients reject stale scoped clears/completions. Accepted end_call still drains its farewell after a replacement.

No VAD threshold or speaker policy changes. Existing native aside buffering/classification runs before accepting replacement text, so a quiet-listening aside cannot retire the active story. Per-call name instructions, input capture and actual task ownership remain. Phone fixed lookup-start and waiting clips are disabled independent of legacy notice mode; task UI, actual backend progress/results/errors and existing household notices remain.

## Reproduction and evidence

The local-only fixture uses the production H5 HTTP/WebSocket service, actual direct-tool service and actual SeedDuplex adapter, with an in-memory simulated provider and fake tool gateway. It binds loopback, generates 440/880/660 Hz test tones, never opens a model connection, never records audio and normalizes the native debug binding's omitted Origin port only inside this local fixture. Production origin checks are unchanged.

- Before source: c1d854c. Browser kept playing after replacement confirmation and replayed the old tail. Native shared pipeline failed because playback stayed busy during the pre-PCM gap.
- After: browser became silent 37 ms after replacement confirmation; gap peak RMS 0; old tail samples 0; only the replacement tone played and accepted farewell automatically hung up. See browser.json and browser.png.
- Native shared pipeline: same five-second old queue, early replacement text, delayed old PCM, anonymous usage completion and valid new response. Queue clears before new PCM, capture frame count grows, the replacement drains within two seconds and farewell ends the call.
- Full native suite 67, Swift core 29, Node 727, Speaker 95, release-controller tests 10. Generated H5 freshness passes. iOS suite retains existing QoS diagnostics; all tests pass.
- Before native result: test_sim_2026-10-22T15-01-37-872Z_pid5287_2ef1052f.xcresult (expected playback assertion failure). After targeted: test_sim_2026-10-22T15-02-33-363Z_pid5287_fd718c42.xcresult. Full suite: test_sim_2026-10-22T15-03-41-037Z_pid5287_8af226a6.xcresult. Local XcodeBuildMCP result directory retains these bundles.

Start `VVOICE_SHARED_FIXTURE_PORT=29847 node ios/scripts/shared-duplex-fixture.mjs`. Run `node ios/scripts/shared-duplex-browser.mjs 29847` with Playwright available (or PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE pointing at an installed runtime). Output defaults to /tmp/voice-shared-browser. The browser runner permits only loopback fixture ports 29847/29848. The iOS native test script starts both local fixtures and passes their ports to the test runner. Instrumented Chromium is used because the in-app browser cannot replace microphone capture with deterministic synthetic input; the candidate UI and real simulator mirror are separately displayed in the in-app browser.

This measures playback after a replacement decision. It does not measure human speech-onset-to-stop latency, prove real Doubao decisions in TV/bystander audio or replace physical iPhone acceptance. No new live model call or raw recording occurred. Server release, native installation and human real-call acceptance are registered separately.
