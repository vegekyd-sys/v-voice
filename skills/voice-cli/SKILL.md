---
name: voice-cli
description: Use the V Voice CLI to manage isolated conversation entries, Feishu login invitations, scoped guest links, expiry and revocation. Use when asked to operate V Voice; does not manage Gateway policy or deploy services.
---

Run `v-voice capabilities` to discover commands, arguments, limits and exit codes as JSON. `--help` / `-h` shows readable Chinese help at root, group and command levels; append `--json` for its structured schema. Operational stdout and errors remain one JSON envelope; check `ok` and the process exit code.

`V_VOICE_SOCKET` selects the existing Voice service's private Unix control socket. The OS identity with access to that socket manages only CLI-owned objects. There is no Gateway token, browser credential or account impersonation parameter. `v-voice doctor` reports the configured account and effective guest capability mode. If unavailable, inspect configuration; do not deploy, restart or change permissions unless authorized for the current task.

Choose `guest` for a new isolated context. Links for the same entry share that entry's guest context; separate people who should not share context need separate entries. Public tools follow the service's existing Public policy. No personal account tools or source-chat history are delegated.

Choose `feishu` for a login invitation to an exact chat under the account reported by doctor. The recipient authenticates through the existing Voice flow, and Gateway checks their own membership and tools. An active invitation does not mean the recipient has authenticated. Revoking it stops invitation use, not independent Feishu/device authorization.

Mutations need a stable `--request-id` (8–128 URL-safe characters). Retrying the same command and arguments returns the same object; changing arguments with that ID fails. Read back with `entries get`, `links get`, `auth check` or `sessions status`. An unknown transport/write outcome calls for readback and retry with the same ID.

Links require `--out` in an owned mode-0700 directory; the file is created exclusively with mode 0600. stdout contains its path and scope, never the bearer URL. Recover a lost output with `links export --id ID --out NEW_FILE`. Share the file's contents only when the current user request authorizes delivery to that recipient. Do not print credentials into logs, general memory or unrelated tools.

Use primitives in any order that satisfies their preconditions. A typical guest test is `entries create` → `links create` → `auth check` → recipient access → `links revoke` → `auth check`. Nothing dials automatically. `entries bind` is limited to unused Feishu entries; an issued destination cannot silently change accounts/chats. Temporary guest links cannot become long-lived iOS grants.

Report local/Candidate functionality, V OS-runtime execution, actual V Agent use, merge and production activation separately. Real audio, recipient identity and tool execution require their own evidence.
