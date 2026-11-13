# Board benchmark

Real calls against a board candidate, measured from the candidate's own records.
Run it before a board change ships, and compare with the last round.

    ./voices.sh                                   # once: speak the questions into voice/*.wav
    ENTRY_LINK=… PLAYWRIGHT_MODULE=… ./run.sh <label> [group …]
    python3 report.py <label> [baseline-label]

`questions.json` has four groups, one call each:

| group  | what it is for |
|--------|----------------|
| lesson | requests to explain: the lesson tool, its script, its page |
| talk   | answers V gives in its own words, drawn as it speaks |
| follow | a topic, a follow-up on one thing in it, and going back: the canvas |
| legacy | what calls did before there was a board: small talk, a search, memory, a background task, hanging up |

## What is measured

Speed (seconds after the caller's words were final; median and worst):

- `reply`: V's first sound.
- `paint`: the first thing on the page (usually its title and a photograph).
- `content`: the first piece of content on the page.
- `lesson`: the lesson being spoken; `script`: how long its script took to write.

Effect:

- `kinds`, `kindsUsed`, `kindEvenness`: which kinds of picture the pages were made of, and how evenly (1 = all alike in number).
- `distinctShapes`, `commonestShapeShare`, `sameMainAsPrevious`: how alike the pages are. Lower shares are better.
- `turnsWithoutPicture`, `pagesWithPhoto`, `photosFound`, `marks`.

Old functions:

- `legacyToolAsBefore`: the legacy questions that still went to the tool they went to before (`tools` in `questions.json`; an empty list means none).
- `legacyReplyMs`: their reply time. Run the legacy group once with `VOICE_BOARD=0` on the candidate and pass that round as the baseline.
- `repliesCut`, `questionsNotHeard`.

Results are written to `artifacts/board-bench/<label>/` (not committed), with the screenshots of each call.
