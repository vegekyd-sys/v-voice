---
name: device-use
description: Use the current authenticated voice terminal's declared device capabilities, including on-demand location. Only when a live task includes a server-issued device execution descriptor.
---

Use only the **current task's** server-issued `terminal` context and `device execution descriptor`. These do not grant account permissions. Never discover other devices, guess a lease/session, inherit Tianyi's tools for a guest, or use another tool/backend after a denial.

For location, call `location.current` with `{}` only when the user asks to use their current position. If a validated fresh device point is already attached to this task, use that exact data; don't refetch or replace it with IP/history/account address. A stale point must be refreshed. `source`, `capturedAt`, `coordinateSystem`, accuracy and approximate status must stay attached. Do not write location or the descriptor to long-term memory.

Execution uses the descriptor's server-installed `cli` helper:

```sh
# Supply the current server descriptor JSON via stdin, not an invented URL/key.
node /exact/server-provided/cli/path/device-call.mjs location.current '{}'
```

Only a matching `ok` receipt/result proves a read succeeded. Denied/cancelled/failed is not success. `requires_foreground` or `waiting_user` is progress, not completion. `unknown` on a write may mean it executed: never blindly retry. No descriptor means this task cannot directly operate a device; ask the user for needed input.

For rides, use the existing `didi-ride-skill-official` and read its references. Device location is not a confirmed pickup. Verify the map's required coordinate system, resolve a real pickup POI through its map tools, and keep transformation provenance. Confirm ambiguous pickup/destination. Query/quote/link are separate from ordering. Do not order or pay without the specific authorized trip and confirmation.
