#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Copies the script writer and its comparison to /tmp on V
# and runs it there as the board Candidate's own service user, through the Candidate's own launcher
# (which hands it the Candidate's environment; nothing of it is printed or copied). Each case and way
# is one paid video generation on the account the Candidate uses. No voice call; nothing is restarted.
#
#   scripts/candidate/video-script-compare-on-v.sh cases.json [candidate-name]   # results in artifacts/video-script-compare-<time>/
set -euo pipefail
cd "$(dirname "$0")/../.."
cases="$1"; name="${2:-board-assets-20261121}"; root=/var/lib/v-voice-candidates/$name; stamp="$(date +%Y%m%d-%H%M%S)"; work=/tmp/video-script-compare-$stamp
tar czf - scripts/candidate/video-script-compare.mjs lab/gpt-live-h5/board-assets.mjs lab/gpt-live-h5/media-references.mjs lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs lab/realtime-direct-tools/media-script.mjs \
  | ssh v "mkdir -m 755 $work && tar xzf - -C $work && mkdir -m 777 $work/out"
ssh v "cat > $work/cases.json" < "$cases"
ssh v "sudo -n -u openclaw /opt/node-v22.23.1/bin/node $root/launch.private.cjs $root/environment.private.json /opt/node-v22.23.1/bin/node $work/scripts/candidate/video-script-compare.mjs $work/cases.json $work/out '${WAYS:-draft,text,vision}' '${SCRIPT_MODEL:-}'"
mkdir -p "artifacts/video-script-compare-$stamp"
ssh v "sudo -n cat $work/out/results.json" > "artifacts/video-script-compare-$stamp/results.json"
echo "artifacts/video-script-compare-$stamp/results.json"
