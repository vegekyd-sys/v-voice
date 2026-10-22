# Feishu session phone candidate — 2026-10-22

Candidate only; no production release or Gateway restart. Integrates main through 1a0063a (native duplex and current H5 UI) into the former PR #2 implementation.

A phone maps to an existing server-owned Feishu session. Browser input cannot select another session. History, direct Gateway tool calls, and backend delegation use that session key. Conversation calls omit the Voice service's personal Feishu shortcuts and personal-caller assumption. The page shows a safe conversation label and preserves its binding when returning home.

DM entry: top URL tab named `📞 打给 V`. `scripts/feishu-menu.mjs --surface tab` installs one idempotently, preserves other tabs, and reads back uncertain writes. Existing group menus remain supported without layout changes. Public links use Feishu OAuth and never contain a bearer token. Installation is per conversation; global auto-provisioning is not deployed.

The pilot still allows only the registered Tianyi identity and two existing VLab sessions. This does not establish arbitrary employee/family authorization parity: the current Gateway Voice connection has operator-admin scope. Existing entry guards remain in force; expansion needs the actual session caller identity path verified before enabling other users.

Local validation: 735 main tests, 95 Speaker tests, generated iOS H5 shell check. Live candidate and human acceptance are recorded separately after deployment.
