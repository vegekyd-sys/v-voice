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

## What still forks (next steps)

These change what a model hears or says, so each needs a real-call check before release; they are not in the refactor that introduced the traits, which keeps every model's instructions and tools byte-identical.

1. **Result wording.** One function should turn a tool result into what the model is given. Today Doubao gets compacted JSON, Grok raw JSON, and GPT Live digests (`gptLiveResultText`: the search and memory digests, the "say it like a chat" line).
2. **Explaining in speech mode.** The "explain in your own words, the screen draws along" guidance exists twice: GPT Live's delegation policy and `PARALLEL_ROUTING` for function-tool models. `boardOpening` exists only on the GPT Live bridge. One shared text and one hook would let any model use speech mode.
3. **Policies GPT Live is not given.** The consent, calendar-service and task-control policies reach function-tool models in their instructions; GPT Live's early return in `directInstructions` skips them (its router and delegation policy cover part). Decide which belong to the router, which to the model.
4. **Tool guidance written three times.** A tool's "when to use" lives in its schema description, in the instruction catalog, and in the router prompt. Moving it into the capability entry and rendering it per `tools` trait makes one edit reach all models.
