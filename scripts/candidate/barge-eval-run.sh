#!/usr/bin/env bash
# Run barge-eval.mjs on V itself, as the Candidate's service user, through the Candidate's launcher
# (its environment is not printed or copied): the real voice model decides, every tool is a stand-in.
#
#   scripts/candidate/barge-eval-run.sh cases.json scripts.json audio-dir out-dir [repeats] [git-ref] [candidate]
#
# git-ref: the code under test (default: this working tree); a commit runs that commit's code with
# this checkout's harness, which is how production and a variant are compared.
set -euo pipefail
cd "$(dirname "$0")/../.."
cases="$(realpath "$1")"; scripts="$(realpath "$2")"; audio="$(realpath "$3")"; out="$(realpath -m "$4")"; repeats="${5:-1}"; ref="${6:-}"; name="${7:-fixes-20261125}"
root=/var/lib/v-voice-candidates/$name; work="$(mktemp -d /tmp/barge-eval-XXXXXX)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/code" "$out"
if [ -n "$ref" ]; then git archive "$ref" -- lab lib package.json | tar xf - -C "$work/code"
else git ls-files -co --exclude-standard -- lab lib package.json | tar cf - -T - | tar xf - -C "$work/code"; fi
ln -s "$root/voice/node_modules" "$work/code/node_modules"
/opt/node-v22.23.1/bin/node "$root/launch.private.cjs" "$root/environment.private.json" /usr/bin/env \
  VOICE_EVAL_ROOT="$work/code" BARGE_ONLY="${BARGE_ONLY:-}" BARGE_LANES="${BARGE_LANES:-2}" BARGE_GAP_MS="${BARGE_GAP_MS:-4000}" BARGE_SERVICE_OPTIONS="${BARGE_SERVICE_OPTIONS:-}" BARGE_FLOOR_JUDGE="${BARGE_FLOOR_JUDGE:-}" \
  /opt/node-v22.23.1/bin/node "$PWD/scripts/candidate/barge-eval.mjs" "$cases" "$scripts" "$audio" "$out" "$repeats"
