---
name: robot-use
description: Use the current voice-call robot's camera or two-axis head when the user asks it to look, turn, nod, or shake. Requires a live server-issued terminal context and device execution descriptor.
---

Use the current task's trusted `terminal.kind=robot`, capability state and execution descriptor. They identify the current call device; they do not grant account permissions. No descriptor or unavailable capability means the operation cannot run here. Do not select another device, invent a lease/session, use remembered context, or bypass a refusal through exec, SSH, another backend or a legacy motor tool.

Read only the needed reference:

- [See a current camera image](references/vision.md)
- [Move, nod, shake, or stop the head](references/motion.md)
- [Reaction and result interpretation](references/reaction.md)

Invoke the descriptor's exact server-provided `cli` using `node`, with the operation and JSON arguments as argv; supply the current descriptor JSON through stdin. The helper returns the same bounded request/receipt used by the voice frontend. Never expose or save the lease, image, or descriptor in logs, responses or long-term memory.

Report the actual receipt. `running`, `waiting_user`, and `requires_foreground` are progress; `denied`, `cancelled`, `failed` and `unknown` are not success. A lost motion receipt may mean movement occurred: inspect/stop through this channel instead of replaying. Do not claim seeing a photo or physical completion from an accepted command. Continue answering in the current conversation.
