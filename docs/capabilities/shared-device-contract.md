# Shared terminal context and device requests — integration contract

2026-10-25, baseline main ab8ad23. Owner: location lane. Candidate only.

## Public files owned by this lane

- `lib/terminal-context.mjs`: normalize capability declarations; construct server-bound display context for both models.
- `lib/device-requests.mjs`: per-call bounded request/receipt lifecycle; operation adapters supply argument/result validators and side-effect policy.
- `lab/realtime-direct-tools/device-location.mjs`: location adapter, not a second request registry.
- Integration edits in `session.mjs`, `backend.mjs`, `server.mjs`, web `app.js`, native `CallCoordinator.swift` and `BindingStore.swift` are owned here; other lanes deliver adapters and list integration hooks.

## Negotiation / compatibility

Reuse **`nativeDeviceActions` version 1**, already introduced by the unreleased Notes candidate. New form:

```json
{"version":1,"capabilities":{"location.current":{"status":"prompt"},"notes.create":{"status":"available"}}}
```

Status is `available`, `prompt`, `denied`, `unavailable`, or `requires_foreground`. Only operation names explicitly implemented by the adapter may be advertised. Legacy `{version:1,appleNotes:true}` is normalized to notes.create/append; preserve the Notes nonce/digest/readback adapter until it migrates. There is no implication that old Notes frames and generic frames are interchangeable. Native executes only after server echo. Old clients without negotiation retain their original audio protocol.

Server injects `version`, `terminal.kind` (`web`,`ios`,`robot`,`speaker`), current call ID, and authenticated actor/session/device owner display metadata. Client capability/status claims describe execution availability, **never** grant account/tool identity. Guest retains the existing restricted tool set; delegation cannot bypass denial. No raw session keys, device credential, tool key, arbitrary URL or callable code enters model context.

## Wire envelope

```json
{"type":"device.request","version":1,"requestId":"uuid","voiceSessionId":"current-call","operation":"location.current","deadline":1800000025000,"arguments":{}}
```

```json
{"type":"device.result","version":1,"requestId":"same-uuid","voiceSessionId":"same-call","operation":"location.current","status":"ok","result":{}}
```

Terminal statuses: `ok`, `denied`, `failed`, `cancelled`, `unknown`. Progress statuses: `running`, `requires_foreground`, `waiting_user`. `unknown` is mandatory when a side effect may have executed but no matching completion proof exists; never auto-retry side effects. Optional `evidence` is validated by the operation adapter (Notes digest/nonce, camera/photo request ownership, motor acceptance versus completion). Expiry, call close, reconnect, actor/device owner change retire outstanding requests. Late/foreign/replayed/invalid receipts do not revive them.

## Module API

`createDeviceRequests({voiceSessionId,send,operations,now})`, where `operations` is a **small per-call adapter map**, not a global registry. Each adapter declares `timeoutMS`, `sideEffect`, `validateArguments`, `validateResult`; state is sourced from normalized current-device capabilities. API: `request(operation,args,{signal})`, `receive(frame)`, `close()`, `state(operation)`. Results retain requestId, operation, status and validated data. Operation adapters decide what proof counts as success.

Context is attached to the foreground voice model **and each backend task/steer request** using the same server-owned snapshot. Backend Skill execution needs a running, authenticated per-call return path; prompt-only capability text is not backend integration. The implemented path is described below; no other lane should invent a different backend bridge.

## Location semantics

`location.current` returns source, capturedAt, coordinateSystem, horizontalAccuracyM, accuracyAuthorization and approximate. Device point ≠ confirmed pickup. Only validated fresh data can enter V task context. No default long-term memory write. Real browser/system location and human speech acceptance remain distinct from fixture/seeded/synthetic-model tests.

## Reusable service integration

- `createDirectVoiceService({deviceOperations})` accepts an operation map or `({voiceSessionId}) => map` factory. `validateResult(result,{requestId,arguments,frame,now})` receives the validated original arguments; adapters need no mutable last-arguments closure.
- `reserve({nativeDeviceActions,terminalKind,backendDeviceURL,terminalAdapter?})` creates the per-call broker. `terminalAdapter` is server-owned: `{kind,capabilities(),execute(operation,args,{requestId,voiceSessionId,deadline,signal})}`. Without it, requests/results travel over the existing authenticated relay socket. The service always fixes receipt ownership fields itself.
- Reserve HTTP and native fast-dial query negotiate `nativeDeviceActions` as JSON. Native `BindingStore`/`CallCoordinator` currently build the location declaration; iOS Use must merge its operation statuses into that same declaration in **both** dial paths and dispatch its executor alongside location. Server echo is required. No changes to audio ownership.
- The trusted backend task gets `{version,endpoint,lease,voiceSessionId,cli}` only in its backend context. `POST /internal/device-request` accepts only `{lease,operation,args}`. The opaque 32-byte per-call lease resolves actor/device/session on the server; callers cannot select them. Origin-bearing browser calls are rejected; private HTTP is loopback-only, hosted access uses the configured HTTPS host and the lease. Close invalidates ownership. `scripts/device-call.mjs` consumes the descriptor on stdin; install `skills/device-use/SKILL.md` into the isolated backend workspace and ensure the supplied helper path exists on the backend execution host.
- `device.cancel` carries the same version/request/call/operation plus reason; local adapter cancellation aborts its signal. An aborted/timed-out side effect returns unknown and must not auto-retry.
- This changeset supplies the channel, not iOS Use tools or robot business logic. These adapters and their actual-completion validators remain lane-owned. Live permission changes use the revisioned device.capabilities frame below; a denial cannot be cleared by a new task or retry. Only a later available state from the authenticated current device clears its operation block, and does not retry the action. GPT WebRTC tool routing remains outside this direct-relay integration. These limitations must remain visible during Candidate acceptance.

## Permission refresh

The existing current-call relay accepts `{type:"device.capabilities",version:1,voiceSessionId,revision,capabilities:{operation:{status}}}`. Revisions start at 1 and increase within one call. A frame cannot add operations that were not negotiated at reservation, change actor/session/device, or revive another call. Status changes do not grant tool-account identity. Revocation retires pending reads (cancelled) and writes (unknown). A later explicit available state re-enables the operation without reissuing it.

Browser observes Geolocation PermissionStatus changes; iOS observes CoreLocation authorization and checks again on foreground. The broker builds one updated snapshot for subsequent backend task/steer and foreground provider context. Grok updates its session instructions without response.create; SeedDuplex uses its existing silent paired-history event and retains the latest instructions for reconnect. Speculative staged lanes are discarded on a capability change. Fixture assertions cover transport/context effects; actual provider response to permission changes and phone settings remain real acceptance items.

## Backend asset mapping update

The earlier artifact-local cli/skill paths are superseded by an explicit backend bundle mapping and per-call execution/network verification. See [deployment contract](backend-device-deployment.md). Missing configuration or a failed probe exposes no executable descriptor. The bundle includes all tracked Skill assets and CLI hashes, including Skills added by the iOS/robot lanes after integration. `VOICE_BACKEND_DEVICE_ENDPOINT` can select the actual service address in a multi-host deployment. No path guessing or automatic download is allowed.
