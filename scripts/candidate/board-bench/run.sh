#!/usr/bin/env bash
# One benchmark round against a board candidate: a real call per group of
# questions (spoken into the page as the microphone), then that call's timings
# and pictures read back from the candidate's own records on V.
#
#   ENTRY_LINK=https://…/voice/#access=… scripts/candidate/board-bench/run.sh <label> [group …]
#
# Needs: the `v` SSH alias, Playwright (PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs), and
# voice/*.wav (voices.sh). Results: artifacts/board-bench/<label>/<group>.json, screenshots beside them.
# VIEW=390x844 runs it as a phone. CANDIDATE names the candidate directory on V.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here/../../.."
label="$1"; shift
groups=("$@"); [ ${#groups[@]} -gt 0 ] || groups=(lesson talk follow legacy)
candidate="${CANDIDATE:-board-20261112}"
for group in "${groups[@]}"; do
  out="artifacts/board-bench/$label/$group"; mkdir -p "$out"
  ids=$(python3 -c "import json,sys;print(' '.join(json.load(open('$here/questions.json'))['groups']['$group']))")
  OUT="$out" VOICE_DIR="$here/voice" VIEW="${VIEW:-1440x900}" node "$here/call.mjs" $ids || echo "call failed: $group"
  sleep 3
  ssh v sudo python3 - "$candidate" 1 < "$here/measure.py" | python3 -c "
import json,sys
call=json.load(sys.stdin)[0]; ids=[i.split('@')[0] for i in '$ids'.split()]
call['group']='$group'; call['ids']=ids; call['matched']=len(call['turns'])==len(ids)
json.dump(call,open('$out.json','w'),ensure_ascii=False,indent=1)
print('$group',call['call'],'turns',len(call['turns']),'of',len(ids))"
done
python3 "$here/report.py" "$label"
