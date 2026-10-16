# Speaker device candidate — 2026-10-16

Tianyi approved replacing the speaker's model-direct media path with the Voice
server relay, with SeedDuplex as default. Test in a separate existing session;
the eventual Twelve Home binding and three-model selection remain product
requirements. Household access to Tianyi's tools is not opened by this work.

## Recovered baseline

- Production Voice entry: d37ac851487b8fd9023ad0c922bdb1cf485984ec (#25).
- Existing device commits: 05678e3 (device endpoint), 92398f1 (backpressure/uplink
  diagnostics), eb8cf4f (bounded follow-up window).
- Existing independent candidate service: v-voice-speaker-candidate, port 26250.
  Production Voice remains on its original process. No Gateway patch/restart.
- Device protocol: authenticated `/device/voice-candidate` WebSocket; 16 kHz
  mono PCM16 uplink, 24 kHz mono PCM16 downlink. This is deliberately asymmetric:
  hardware records 16 kHz and the existing providers emit 24 kHz.
- Server owns model session, tools, task continuation, transcripts and endings.
  Firmware owns wake, microphone, playback, local volume and status light.

## Takeover fixes

Device tokens are validated against their actual header format. A pending call
reserves the bound session against a second device as well as browser clients.
A blocked speaker's server-side WebSocket output is capped at 4 MiB; exceeding
it closes that device call and its provider rather than growing without bound.
The release package includes the dynamically imported device endpoint.
The no-screen prompt limits the current device to Tianyi's personal test.

## Validation and limits

514 Voice tests passed, including real local WebSocket authentication, unchanged
16 kHz input through the SeedDuplex adapter, PCM downlink, two-device contention,
bounded output, Grok selection, natural idle and provider shutdown. These are
protocol/provider fixtures, not paid model or physical acoustic acceptance.

The candidate is isolated with Nice=5, CPUQuota=60%, MemoryHigh=200M and
MemoryMax=300M. Production readiness was true with no active call, session
creation or backend task at takeover. This establishes process isolation,
not a measured production first-word latency guarantee.

Hardware/audio evidence and exact final commits will be appended after tests.
GPT Live relay is not implemented by the recovered candidate (only SeedDuplex
and Grok); do not advertise all three models on hardware yet. The recovered
firmware is half duplex; do not label it as verified interruption support.
Raw audio, transcripts, device mappings, credentials and images remain private.
