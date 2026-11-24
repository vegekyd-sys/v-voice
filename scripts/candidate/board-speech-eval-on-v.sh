#!/usr/bin/env bash
# Runs scripts/candidate/board-speech-eval.mjs on V with the GPT Live 1.1 Candidate's own board
# key, as the service user inside that Candidate's private tmp directory. Only the illustrator's
# model is called: no call, Gateway, service or image search is touched, nothing is restarted.
# The result is saved under artifacts/ here (ignored by Git).
# PHOTOS=1 also hands over the Candidate's image-search key, for `--photos` (see the eval's header:
# every picture is a request against a monthly allowance).
#
#   [BOARD_SPEECH_EVAL_NAME=before] [PHOTOS=1] scripts/candidate/board-speech-eval-on-v.sh [--lesson-tool] [--photos] [case names…]
set -euo pipefail
cd "$(dirname "$0")/../.."
name="${BOARD_SPEECH_EVAL_NAME:-run}"
[[ "$name" =~ ^[A-Za-z0-9_-]{1,40}$ ]] || { echo "BOARD_SPEECH_EVAL_NAME: letters, digits, - and _ only" >&2; exit 2; }
root=/var/lib/v-voice-candidates/gpt-live-11-20261120
dir="$root/tmp/board-eval-$name"
out="artifacts/board-speech-eval/$name-$(date +%Y%m%d-%H%M%S).json"
mkdir -p artifacts/board-speech-eval
# (The link to V loses packets: a connection that stalls is given up and made again.)
link="ssh -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=4"
sent=
for _ in 1 2 3; do
  if tar czf - scripts/candidate/board-speech-eval.mjs scripts/candidate/fixtures/board-speech-cases.json \
    lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs lab/gpt-live-h5/board-clause.mjs lab/gpt-live-h5/board-cue.mjs \
    lab/gpt-live-h5/board-lesson.mjs lab/gpt-live-h5/board-assets.mjs lab/gpt-live-h5/media-references.mjs lab/gpt-live-h5/board-client.mjs \
    lab/gpt-live-h5/transcript-presentation.mjs lab/gpt-live-h5/events.mjs lab/gpt-live-h5/board-photo.mjs \
    | $link v "sudo -n -u openclaw sh -c 'rm -rf $dir && mkdir -m 700 -p $dir && tar xzf - -C $dir'"; then sent=1; break; fi
  sleep 3
done
[ -n "$sent" ] || { echo "could not copy the files to V" >&2; exit 1; }
# The key goes from the Candidate's private environment file to the child process and nowhere else.
# The run is started apart from this connection and asked after: the link to V drops sessions that
# last minutes, and a run cut off half way has still been paid for.
$link v "sudo -n -u openclaw python3 -c '
import json, shlex, subprocess, sys
source = json.load(open(\"$root/environment.private.json\"))
env = {\"PATH\": \"/opt/node-v22.23.1/bin:/usr/bin:/bin\", \"HOME\": \"$dir\", \"VOICE_BOARD\": \"1\",
       **{key: source[key] for key in [\"VOICE_BOARD_API_KEY\", \"DEEPSEEK_API_KEY\", \"VOICE_BOARD_ENDPOINT\", \"VOICE_BOARD_MODEL\"${PHOTOS:+, \"VOICE_BOARD_BRAVE_KEY\"}] if key in source}}
run = \"/opt/node-v22.23.1/bin/node scripts/candidate/board-speech-eval.mjs --json \" + \" \".join(shlex.quote(arg) for arg in sys.argv[1:])
subprocess.Popen([\"/bin/sh\", \"-c\", run + \" > result.json 2> run.log; echo \$? > done\"], env=env, cwd=\"$dir\",
                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
' $*"
for _ in $(seq 1 60); do
  sleep 10
  state=$($link v "sudo -n -u openclaw cat $dir/done" 2>/dev/null || true)
  [ -n "$state" ] && break
done
[ "${state:-}" = 0 ] || { echo "the run on V did not finish (${state:-no answer}); see $dir/run.log there" >&2; exit 1; }
for _ in 1 2 3 4 5 6; do $link v "sudo -n -u openclaw cat $dir/result.json" > "$out" && [ -s "$out" ] && break; sleep 5; done
[ -s "$out" ] || { echo "the result is on V in $dir/result.json but could not be fetched" >&2; exit 1; }
echo "saved $out" >&2
node -e '
const out = JSON.parse(require("node:fs").readFileSync(process.argv[1]));
for (const {name, kind, totals, turns, photos} of out) console.log(`${name.padEnd(11)} ${kind.padEnd(8)} items ${totals.items} pictured ${totals.pictured} prints ${totals.prints} sides ${totals.sides} | pictures ${totals.pictures} (most on a page ${totals.most}) galleries ${totals.galleries} searches ${totals.searches} | runs ${totals.modelRuns} | ` + turns.map(turn => `opening ${turn.openingPictures}🖼 first block ${turn.firstContentMs ?? "—"} first from speech ${turn.firstSpokenContentMs ?? "—"} longest still ${turn.stillestMs}`).join(" ; ") + (photos ? ` | photos found ${photos.filter(photo => photo.found).length}/${photos.length}` : ""));
' "$out"
