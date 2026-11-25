# One capability, every voice model

A phone call can be spoken by Doubao (`seeduplex`), Grok or GPT Live 1.1. They take part in different ways — Doubao and Grok call function tools themselves; GPT Live hands over a sentence and a router picks the tool — but what a call can *do* should be written once and reach every model. This page is the rule for that and the list of what still forks.

## What is already shared

- **Running tools.** Every bridge reports a tool call through `onToolCall`; `session.mjs` validates, authorizes and runs it the same way for every model (Gateway tools, local Feishu reads, media CLI, background tasks, device actions).
- **The board.** `board-director.mjs`, `board-cue.mjs`, `board-lesson.mjs`, the photo finder and the asset shelf follow the call's transcript and the call's tool results, whatever model speaks.
- **Model traits** (`lab/realtime-direct-tools/capabilities.mjs`). Shared code asks a trait, never a model's name:

  | trait | seeduplex | grok | gpt-live-11 | what it decides |
  |---|---|---|---|---|
  | `tools` | function | function | delegation | schemas offered directly, or one sentence routed by `gpt-live-router.mjs` |
  | `explains` | lesson | lesson | speech | `explain_on_board` scripts, or the model explains in its own words and the board follows |
  | `hostToolSpeech` | yes | – | – | cached start/progress lines and the "say one line first" prompt |
  | `typedTurns` | – | yes | yes | whether a typed message can make the model act |
  | `compactResults` | yes | – | – | search results compacted by the service (GPT Live's bridge words results itself) |
  | `nativeDuplex` | yes | – | – | provider end-of-turn when no speaker routing is in front |

- **Tool briefs.** What each tool lets V do, in one line, for a model that never sees schemas, is `TOOL_BRIEFS`. GPT Live's "Backend tools" list is built from it.

`capabilities.test.mjs` keeps this true: every model in `DIRECT_MODELS` has traits; every tool a call can be offered is either briefed or listed in `UNBRIEFED` with its reason; and `session.mjs` compares a model's name only for its bridge, voices, connection or own persona.

## Adding something

- **A tool:** its schema in `tools.mjs`, its execution in `session.mjs` (shared), and one line in `TOOL_BRIEFS` — or its name in `UNBRIEFED` if delegation models must not be told. Function-tool models get it from the schema; GPT Live gets it from the brief and the router.
- **A behaviour that depends on how a model takes part:** add or reuse a trait; do not test `s.model`.
- **A model:** its bridge (transport, audio, persona), an entry in `DIRECT_MODELS`, and its traits. Everything above then applies to it.

## What has been unified since

- **Result wording (budget).** Every model is given a tool result whole up to `TOOL_RESULT_MAX_BYTES` (32 KB, `search-result.mjs`); GPT Live used to get 2,400 characters (#268, released 11-24). Doubao and Grok keep their JSON; GPT Live keeps plain text — the format follows the `tools` trait, the amount does not.
- **Tool-choice policy.** `toolChoicePolicy` in `session.mjs` (task routing and hand-off, task control, consent, calendar service) is what a function-tool model reads in its instructions *and* what GPT Live's router reads as notes (`routerNotes`, with `LESSON_ROUTING` when the call has the lesson tool). The router prompt keeps only its own job — one tool, its arguments — and is given each tool's whole description (it used to be cut at 320 characters).
- **Check.** `scripts/candidate/router-eval.mjs` runs the real routing model over invented cases (`router-cases.json`) for the production version and a candidate side by side; a router change ships only if it chooses at least as well.

## What still forks (next steps)

1. **Explaining.** Doubao reads a lesson script (researched, with pictures, the board prepared per sentence); GPT Live explains in its own words and the board follows. Reading a script sounds recited on GPT Live, and its own explanations are thinner.
   - Experiment, off by default, for every model: `VOICE_LESSON_RETELL=1` (`VOICE_GPT_LIVE_LESSON_NOTES=1` for GPT Live alone). The same lesson pipeline looks things up and draws the page, and the lesson comes back as *material* the model tells in its own words, never a script read out for it: Doubao and Grok get it as the explain tool's result (`LESSON_RETELL_TOOL`, `LESSON_RETELL_ROUTING`), so the reply is their own and they know they are explaining; GPT Live gets it as its delegation's answer (`retellLesson`), with the lesson started on the caller's words as soon as the router is sure. The page is hung on the names of its things (`hangOnNames`) and stays the lesson's page whatever words are used.
   - Tried and dropped (candidate, 11/25): GPT Live speaking first and the material continuing it — it opens fast, but GPT Live does not keep to "one or two sentences" and told much of it twice.
   - `boardOpening` exists only on the GPT Live bridge.
2. **GPT Live's own front prompt.** Its delegation policy (when to hand a sentence over at all) is still its own text; the choice of tool after that is shared.
