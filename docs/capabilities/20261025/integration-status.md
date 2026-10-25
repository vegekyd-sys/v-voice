# Location lane — current integration state

Baseline ab8ad23. This is implementation progress, not acceptance or deployment.

- Public contract: `docs/capabilities/shared-device-contract.md` (bbd959e).
- Thin core: `lib/terminal-context.mjs`, `lib/device-requests.mjs` (first commit 0fa055c; follow-up service integration in this changeset).
- Compatibility: `nativeDeviceActions` v1; legacy Notes declarations normalize to notes.create/append, but Notes must keep its original nonce/digest adapter until migrated. Notes candidate has never been released, so no old production action frames are silently reinterpreted.
- Generic per-call factory option on `createDirectVoiceService`: `deviceOperations` may be an adapter map or `({voiceSessionId}) => map`. Core injects requestId/call ID/deadline; validator receives `{requestId,arguments,frame,now}` and must establish actual completion evidence. Unknown/unimplemented operations report unavailable. Location adapter is the first implementation.
- Voice-owned integration files: session.mjs/backend context attachment; server.mjs negotiation / fast dial / bounded endpoint; web app.js + relay-audio.mjs; native CallCoordinator.swift + BindingStore.swift. Native location dispatcher handles only location.current and its cancellation; iOS Use plugs its executor ahead of the unknown-operation fallback. No provider/source keyword logic added.
- Backend return path is **implemented in this candidate**: server-issued per-call opaque lease, backend-only descriptor (`endpoint`, `lease`, `voiceSessionId`, installed `cli`), `scripts/device-call.mjs` reads descriptor stdin and calls POST `/internal/device-request`. The service resolves the lease to its existing active call; caller cannot supply actor/session/device. Endpoint is same Voice host over configured HTTPS, or loopback in a private Candidate. No shared Gateway change or global device registry. The descriptor is never in frontend reservation/context. No origin-bearing browser call is allowed. Hangup/reconnect retires lease; denial is shared by frontend and backend request paths. Do not copy the descriptor into screenshots/Git/long-term memory.
- Skill source: `skills/device-use/SKILL.md`. Candidate must install it into its own backend workspace and preserve the exact server-provided descriptor. Prompt text without a live lease/execution route does not count as backend acceptance.
- Real existing DiDi Skill found on V: `didi-ride-skill-official`; it uses the existing server-side DIDI_MCP_KEY and mcporter. No credential contents have been printed or copied to browser/source. Its references do not state an explicit WGS84 conversion contract, so raw device coordinates must not be relabelled as map coordinates; real POI lookup and coordinate provenance remain acceptance gates.
- Web + Seed/Grok generic adapter implemented. iOS fast and HTTP negotiation migrated; simulator Debug build succeeded. Native runtime tests and physical-device acceptance remain pending. GPT WebRTC uses Gateway-owned tool declarations and callbacks, so it is **not yet a location-capable path**. It must not be marked all-model accepted; any Gateway tool protocol change requires a separate platform PR. Existing GPT behavior is preserved in this Voice candidate.
- Shared VLab lease/pending belongs to monitor-v-production; no shared write/restart/stage was performed. Private Candidate only. Physical phone permission/location/lock screen and human speech remain required acceptance, not fixture claims.

- This reusable changeset does not install the iOS Use operations/tool/executor or robot operations/UI. Each lane supplies its adapters; no implementation of an advertised operation means unavailable. Revisioned current-call device.capabilities refresh is implemented for browser/iOS and Seed/Grok model context; physical permission-change acceptance remains pending. Backend snapshots are rebuilt for each new task/steer, and current-call denial stays blocked. GPT support and real-device/provider acceptance of live permission-refresh remain explicitly unfinished.

## Reusable bridge validation (2026-10-25)

- Targeted device core / service / server / location / web-adapter tests: 158 passed, 0 failed. Includes launching the actual helper process against the HTTP endpoint with a fixture executor; this is transport validation, not real iPhone/robot execution.
- Complete `npm test`: 915 passed, 0 failed. Includes the server-local adapter ownership-field check.
- `npm run check:ios-shell`: exact shell sources and bundle verified.
- Simulator Debug `xcodebuild` using this lane's explicit project, simulator and DerivedData: BUILD SUCCEEDED. No native runtime-test or physical-phone acceptance claimed for this changeset.
- No merge, deployment, shared VLab stage/restart, physical-device installation, DiDi dispatch or payment.

## Permission-refresh follow-up (2026-10-25)

- Added revisioned current-call permission updates, no operation expansion, pending-request cancellation on revocation, explicit available-state recovery without replay, same backend/foreground snapshot.
- Web PermissionStatus observer, iOS CoreLocation callback / foreground refresh. Grok session instruction update and SeedDuplex silent paired history; no injected audio and no automatic new response.
- Complete npm test: 917 passed; core/browser adapter: 9 passed; simulator Debug BUILD SUCCEEDED. A first new cross-provider fixture used Grok-style call frames on SeedDuplex and failed; corrected to the provider's actual items envelope, then the test and complete suite passed. These remain fixture and build evidence, not live provider or physical-phone permission acceptance.
