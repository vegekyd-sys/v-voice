#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Runs video-script-matrix.mjs on V as the board Candidate's
# own service user through the Candidate's own launcher (its environment is not printed or copied).
# "script": the director's pass only (model calls, no generation). "film": also one paid video for
# each case marked "film". No voice call; nothing is restarted.
#
#   scripts/candidate/video-script-matrix-on-v.sh cases.json [script|film] [candidate-name]
set -euo pipefail
cd "$(dirname "$0")/../.."
cases="$1"; mode="${2:-script}"; name="${3:-board-assets-20261121}"; root=/var/lib/v-voice-candidates/$name; stamp="$(date +%Y%m%d-%H%M%S)"; work=/tmp/video-script-matrix-$stamp
tar czf - scripts/candidate/video-script-matrix.mjs lab/gpt-live-h5/board-assets.mjs lab/gpt-live-h5/media-references.mjs lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs lab/realtime-direct-tools/media-script.mjs lab/realtime-direct-tools/media-cli.mjs \
  | ssh v "mkdir -m 755 $work && tar xzf - -C $work && mkdir -m 777 $work/out"
ssh v "cat > $work/cases.json" < "$cases"
ssh v "sudo -n -u openclaw /opt/node-v22.23.1/bin/node $root/launch.private.cjs $root/environment.private.json /opt/node-v22.23.1/bin/node $work/scripts/candidate/video-script-matrix.mjs $work/cases.json $work/out $mode"
mkdir -p "artifacts/video-script-matrix-$stamp"
ssh v "sudo -n cat $work/out/results.json" > "artifacts/video-script-matrix-$stamp/results.json"
echo "artifacts/video-script-matrix-$stamp/results.json"
