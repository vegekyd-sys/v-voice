# Backend device assets and multiple Voice hosts

Candidate support only. Installing formal assets/configuration remains a deployment step. A helper path on a Voice host is not evidence that a V/Worker on another host can read or execute it.

## Immutable bundle

The Voice packager emits `backend-device-bundle.json` with source commit, path, bytes and SHA-256 for `scripts/device-call.mjs` and every tracked `skills/` asset. The overall Voice manifest also hashes this bundle manifest. The package includes `scripts/install-backend-device-bundle.mjs`.

On the actual backend execution host, as the user that will execute the helper, choose a new immutable destination and run:

```sh
node scripts/install-backend-device-bundle.mjs /path/to/verified/voice-artifact /path/to/new/backend-device-bundle
```

The installer checks source hashes and copies only the enumerated CLI/Skill assets and manifest; it does not copy credentials or overwrite an existing destination. Its result gives root and manifest SHA-256. Ensure the real backend runtime/Worker can read that root. A host shell check alone is insufficient.

## Trusted Voice configuration

- `VOICE_BACKEND_DEVICE_BUNDLE_ROOT`: absolute root on the **backend** execution filesystem.
- `VOICE_BACKEND_DEVICE_MANIFEST_SHA256`: SHA-256 of the exact backend bundle manifest bytes.
- `VOICE_BACKEND_DEVICE_NODE`: optional backend Node executable, default `node`.
- `VOICE_BACKEND_DEVICE_ENDPOINT`: optional actual Voice service endpoint reachable from the backend. Default is this service's configured origin/base path plus `/internal/device-request`, or loopback for a same-host private Candidate. A fleet proxy must route to the correct Voice process; another node cannot resolve its live lease. Remote public routes require HTTPS; loopback can use a private SSH tunnel.

No path, executable, endpoint or manifest override comes from the browser/model. Credentials remain on their existing servers.

Before the first backend task or steer uses the channel, the service invokes its existing authenticated actor-scoped `exec` capability. The backend helper verifies all local bundle hashes and performs an HTTP probe using this call's short-lived lease and challenge. The Voice server resolves the lease to the current call and returns the matching challenge; no device location or side effect is requested by this probe. Only this complete proof publishes the descriptor. Missing configuration, missing/corrupt assets, unavailable exec, unreachable endpoint, wrong service/call, closed owner or probe failure produces **no execution descriptor**. The model must not guess paths or download/run a replacement.

Verification is lazy at first delegation and cached for that call; ordinary voice startup does not wait on it. Descriptor node/CLI/Skill paths refer to the verified backend root. Subsequent device actions still enforce live owner, capability status, request ID, deadline and operation result proof. Configuring paths or passing the asset check never grants account tools or device permissions.

## Current evidence boundary

Unit integration launches the real helper against a real HTTP listener and validates manifest corruption, authenticated challenge and retired-call rejection. Service tests verify missing/failed configuration never advertises a lease/path. These tests are not yet the real remote V/Worker-to-another-Voice-host Candidate, and do not prove human speech, actual GPS or DiDi quotation. That Candidate evidence must be recorded separately before topology acceptance.
