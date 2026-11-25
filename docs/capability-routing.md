# Voice capability routing and Gateway boundary

Voice owns the shared frontend capability policy, provider instructions, read-only Feishu adapter, model adapters and Web/H5 presentation. A direct tool restriction is not a restriction on V as a whole: explicit authorized writes and unavailable direct capabilities delegate to the backend. Claims of success require actual business results.

The server sends its own frozen `voiceInstructions` to `talk.client.create`; browser input cannot override it. This requires the platform `voice-host-instructions` extension. The platform keeps only session ownership, validation, native transport/lifecycle and backend control. Voice publishing itself does not restart Gateway; the first coordinated rollout must install the compatible platform contract before enabling the new Voice version. Do not release Voice alone against an older Gateway.

This branch is stacked on the standalone repository extraction branch (PR 1), not on the phone/session extension (PR 2). It refreshes deployed Voice files from platform commit `6a5805db59de9e98cbe11cb26dc5eb75e87ffee9`, including local read-only Feishu execution, SeedDuplex upstream recovery, media presentation and approved avatar assets, while retaining the standalone Gateway client and entry mapping. Original extraction provenance remains in migration-baseline.json; later deployed file hashes are recorded separately in deployed-baseline-updates.json.

Grok is not part of live acceptance for this round. Candidate tests do not authorize merge or release. Logs, configuration, caller conversations and credentials remain outside Git.

## Provider migration candidate (not accepted)

Voice GPT policy is packaged in plugins/v-voice-gpt-live; configure VOICE_GPT_PROVIDER=v-voice-gpt-live only after real-call acceptance. Install/activate the plugin through OpenClaw's plugin loader. The adapter preserves the base descriptor's opaque host capabilities and delegates authentication/teardown to OpenClaw, without importing hashed dist modules.

VOICE_HOST_CALL_CONTROL=1 enables experimental host semantic end-call control; it is default-off. Candidate connected and delegated a real task, and host end acceptance was observed, but farewell playback/closure and late-progress suppression are not accepted. Do not enable this flag in production. Platform PR #344 currently carries only one native final-delivery header replacement; its removal of the earlier control-lane patch remains pending end-to-end acceptance.

VOICE_LESSON_GUARD=1 (Doubao phone calls; default-off) keeps a board lesson playing through room talk: while it still plays, speech does not pause it, and only a stop word (等一下/停/不对/不是…) or speech addressing V (V/艾维/小V/阿V, or 维/B/LV opening the utterance) replaces it; other utterances are logged as `input.playback-echo` reason `lesson-guard`. Candidate-only until real-iPhone acceptance.
