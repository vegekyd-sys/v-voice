# Unified Voice access contract and verification

Candidate only. Build 39 remains the released TestFlight version; build 32 remains the human-accepted audio baseline.

## Product contract

Two use modes: Public and connected accounts/conversations. Devices and permissions is a management surface. A fixed web entry is a valid server-owned mapping of account, caller and existing conversation; a speaker or robot uses the same mapping contract. Fixed entries are retained, not replaced by arbitrary current-browser identities. Dynamic Feishu conversation URLs continue to require authenticated actor admission. Every new call has its own voiceSessionId.

All enabled guest entry routes use Public search, the existing V memory index and existing backend task integration. They never adopt the source Feishu conversation or personal caller. Public's direct tool allowlist and prompt restrictions are preserved; no new independent memory store or claim of data isolation is introduced.

An invalid private credential stays rejected. Recovery offers a clearly labelled, separate Public entry; it never retries the private operation under another identity, forwards a pending task or silently redials. Active calls pin their original entry until ended.

## Verification matrix

| Entry | Positive path | Required negative/regression cases |
| --- | --- | --- |
| App Public | Fresh installation, retry, reopen, search/task/card | Wrong grant, revoked grant, origin rotation, no private reply target |
| Browser Public / Feishu guest | Same usable Public tool policy, own guest context | Foreign-origin request, wrong cookie, disabled feature, no source chat history/actor |
| Feishu current account | Signed actor + Gateway-admitted DM/group | Membership failure, account change, stale authorization; clear Public recovery |
| Fixed web entry | Configured caller/account/session preserved | Browser actor cannot replace configured caller; invalid token; old saved grants |
| Bound App | Add/select/reopen/remove, current entry drives Action Button | Wrong identity, expired grant, pending-call switch; keep other saved entries |
| Speaker / robot | Same fixed mapping via server entry reference or legacy config | Missing/disabled/conflicting mapping, invalid device token, fixed session call lifecycle |
| Device capabilities | Show current microphone/location/Live Activity status | Denied/unavailable are explicit; Public does not advertise private device tools |

## Evidence gates

1. Deterministic real HTTP/WebSocket fixture tests for authorization boundaries and all six entry paths; provider fixtures are labelled, not real model acceptance.
2. Full Voice service regression, speaker suite, fleet checks, generated iOS shell check; native call/binding/Action Button regression on the owned simulator.
3. Rendered web flow in Codex in-app browser, plus native settings and switching with a real simulator mirror. UI does not dial a paid call automatically.
4. Shared VLab integration under an available lease because guest tool admission changes. Keep Gateway/runtime unchanged; exercise the candidate Voice against existing Gateway interfaces with scoped read-only probes. Actual model/task/media checks remain separately labelled.
5. Report exact source, artifact and covered evidence in a PR. No production cutover, main merge, hardware reflash or TestFlight submission without the release decision.

## Fixed device configuration

Private operator configuration can use `phoneEntry` to reference the exact fixed phone ID in `VOICE_ENTRIES_FILE`. The device file retains its own ID, private token, model and hardware options. Account, caller, session, agent and permission profile come from the fixed entry; conflicting duplicate values reject startup. Optional `accountLabel` supplies a human-readable account name. Existing device records without `phoneEntry` keep their prior behavior.

This does not authorize arbitrary callers: the existing `personal-tianyi` admission constraint remains. Other actors still require Gateway-authorized actor-scoped tools. No production device configuration or firmware is changed by this candidate.

## Candidate evidence — 2026-10-25

- `npm test`: 938/938 passed, including fixed-vs-dynamic OAuth, old/new App grant compatibility, Public guest admission, explicit recovery, revoked alias rejection, and hardware hello/call/hangup with attempted mapping injection.
- `npm run test:speaker-native`: 95/95 passed. Fleet safety: 11/11 passed. Generated iOS shell check passed.
- Native simulator: 77/77 passed (binding, native call, H5 delivery, GPT transport and relay); fixture audio/transport only. Result bundle: `/tmp/vvoice-unified-access-final.xcresult`.
- Codex in-app browser: Public menu, configured fixed identity/session, invalid private credential → explicit Public → idle dial page; no automatic call. Native simulator mirror: saved fixed entries, Public selection with both fixed entries retained, and current-entry summary on the actual H5 home.
- Homepage candidate changelog was rendered and verified with `ACCESS_MODES_CANDIDATE_UPDATE`; published history was not relabelled as this candidate.
- Real VLab integration: `candidate-4fe41003-84a0-481a-8f6a-7821c4863ea8`, input SHA `a4f0646b63013e2e1653dc3d11b847ca2b1fa18ced779812e278316047a4d636`. Read `sessions.list`, `sessions.describe` and `tools.catalog` through the real Gateway. Verified two existing DM/group mappings and both browser guest routes. Provider reservations were fixtures. Zero paid calls, channel messages or shared-state writes. Shared PID/config unchanged, integration lease released.

The probe first exposed harness setup issues (missing package dependency, short fixture ID and per-IP fixture capacity), then caught that normalized hardware records dropped account metadata; the mapping now preserves it internally. A separate HTTP negative test reproduced browser-cookie fallback through an App alias before the fix and passed afterwards.

Physical iPhone permissions/background audio and speaker/robot firmware acceptance are not represented by these results. The current production service, TestFlight 39 and device configuration remain unchanged. Release requires approval of this candidate and a new native build for the changed settings/snapshot; it is not delivered by web shell sync alone.
