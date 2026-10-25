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

Context is attached to the foreground voice model **and each backend task/steer request** using the same server-owned snapshot. Backend Skill execution needs a running, authenticated per-call return path; prompt-only capability text is not backend integration. Location lane is implementing that path and will report its precise endpoint/auth before integration; no other lane should invent a different backend bridge.

## Location semantics

`location.current` returns source, capturedAt, coordinateSystem, horizontalAccuracyM, accuracyAuthorization and approximate. Device point ≠ confirmed pickup. Only validated fresh data can enter V task context. No default long-term memory write. Real browser/system location and human speech acceptance remain distinct from fixture/seeded/synthetic-model tests.
