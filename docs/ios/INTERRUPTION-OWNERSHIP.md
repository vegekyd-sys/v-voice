# Native playback ownership after host notices

Tianyi confirmed build 19 fixed captions but reported SeedDuplex finishing old speech before playing the next reply. The latest completed SeedDuplex call after that release contains three cached tool-start notices and distinct successive response IDs. Persisted logs do not contain the iPhone playback cursor, so they cannot prove the acoustic onset/stop time or reproduce the exact wire stream.

The build 18 and 19 audio coordinator/player paths are identical apart from caption presentation. A pre-existing native ownership bug is reproducible: old response audio queues five seconds; a cached host notice with no responseId overwrites responseID with nil; the next native response no longer sees the previous owner, so it appends instead of clearing old audio. A separate confirmed-clear path also ignored retiredResponseId, allowing late old audio to restart playback.

Preserve the native owner when metadata omits responseId. Keep legacy relay behavior unchanged. Retire the explicit confirmed ID when audio.clear arrives, then clear playback. Do not change microphone capture, speech thresholds, pause timeouts, model routing or caption assembly.

Two new simulator tests fail on the released code. With the fix they pass, including an actual scheduled five-second AVAudioPlayerNode queue replaced and drained within the two-second bound, old-response replay rejection and continuing capture. This is playback completion/state evidence, not a recorded physical speaker waveform or a live model call. The existing replacement/hangup test, reversible pause/capture test and six H5 tests also pass (10 total); Swift core passes 29. No paid calls or raw microphone recordings.

Failure result: test_sim_2026-10-22T14-28-46-698Z_pid57447_a99642c3.xcresult. Passing result: test_sim_2026-10-22T14-29-49-548Z_pid57447_29871777.xcresult. Both are in the local XcodeBuildMCP result directory. Physical onset sensitivity, speech ignored by the model and other interruption paths remain distinct from the reproduced queue ownership defect.
