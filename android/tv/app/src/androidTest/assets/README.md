# Playback diagnostic fixtures

Test APK only; never shipped in the application APK.

- `relay-worklet.js`: shared `relayWorkletSource()` snapshot used by the 2026-10-29 television renderer comparison.
- `buffered-speaker.js`: initial `createBufferedPcmSpeaker` scheduler snapshot used by the 12-context clock probe; later pause/resume diagnostics were revised in shared Voice. The complete call test uses the deployed shared bundle, not this snapshot.
- `synthetic-story-request.pcm`: macOS Tingting TTS, 24 kHz mono signed 16-bit little-endian; generated request “V，请给我讲一个一分钟的小故事，一直讲到结束。” No recorded human audio. Generated using `say -v Tingting -r 190`, then ffmpeg `-ar 24000 -ac 1 -f s16le`.

`CallPlaybackIntegrationTest` starts an explicitly owned idle call, substitutes this generated speech for a bounded input interval, restores microphone forwarding, and checks connection while sampling output clocks. It logs timings and counters only. Check model output volume and samples with queued output separately; a passing connection assertion alone does not prove sustained model speech. Requires explicit live-device/call authorization, correct signing, and external device identity/idle guards.

`PlaybackClockIntegrationTest` plays silent synthetic buffers without microphone/network; `NativePlaybackClockIntegrationTest` is an exploratory native-output comparison exercised only on the local emulator, not an installed production audio path.
