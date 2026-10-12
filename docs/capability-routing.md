# Voice capability routing and Gateway boundary

Voice owns the shared frontend capability policy, provider instructions, read-only Feishu adapter, model adapters and Web/H5 presentation. A direct tool restriction is not a restriction on V as a whole: explicit authorized writes and unavailable direct capabilities delegate to the backend. Claims of success require actual business results.

The server sends its own frozen `voiceInstructions` to `talk.client.create`; browser input cannot override it. This requires the platform `voice-host-instructions` extension. The platform keeps only session ownership, validation, native transport/lifecycle and backend control. Voice publishing itself does not restart Gateway; the first coordinated rollout must install the compatible platform contract before enabling the new Voice version. Do not release Voice alone against an older Gateway.

This branch is stacked on the standalone repository extraction branch (PR 1), not on the phone/session extension (PR 2). It refreshes deployed Voice files from platform commit `6a5805db59de9e98cbe11cb26dc5eb75e87ffee9`, including local read-only Feishu execution, SeedDuplex upstream recovery, media presentation and approved avatar assets, while retaining the standalone Gateway client and entry mapping. Original extraction provenance remains in migration-baseline.json; later deployed file hashes are recorded separately in deployed-baseline-updates.json.

Grok is not part of live acceptance for this round. Candidate tests do not authorize merge or release. Logs, configuration, caller conversations and credentials remain outside Git.
