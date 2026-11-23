#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Runs routing-eval.mjs on V as a board Candidate's own
# service user through that Candidate's launcher (its environment is not printed or copied): the
# real voice model decides, every tool is a stand-in, nothing is sent, made or handed to V's backend.
#
#   scripts/candidate/routing-eval-on-v.sh cases.json [repeats] [git-ref] [candidate-name]
#
# git-ref: the code under test (default the working tree); a commit runs that commit's code
# with this checkout's harness, which is how "before" and "after" are compared.
set -euo pipefail
cd "$(dirname "$0")/../.."
cases="$1"; repeats="${2:-1}"; ref="${3:-}"; name="${4:-board-assets-20261121}"; root=/var/lib/v-voice-candidates/$name; stamp="$(date +%Y%m%d-%H%M%S)"; work=/tmp/routing-eval-$stamp
ssh v "mkdir -m 755 $work $work/code && mkdir -m 777 $work/out"
# (The service's own source only: no iOS project, documents or built packages.)
if [ -n "$ref" ]; then git archive "$ref" -- . ':!ios' ':!docs' ':!tests' ':!lab/gpt-live-h5/assets' | gzip | ssh v "tar xzf - -C $work/code"
else git ls-files -- . ':!ios' ':!docs' ':!tests' ':!lab/gpt-live-h5/assets' | tar czf - -T - | ssh v "tar xzf - -C $work/code"; fi
tar cf - scripts/candidate/routing-eval.mjs scripts/candidate/routing-verdict.mjs scripts/candidate/fixtures/makaron-standin.mjs | ssh v "tar xf - -C $work/code && ln -s $root/voice/node_modules $work/code/node_modules"
# What is said, as speech (the voice model takes no typed turn): one 16 kHz PCM file a sentence, kept between runs.
mkdir -p artifacts/routing-audio
python3 - "$cases" <<'PY'
import hashlib, json, os, subprocess, sys
for item in json.load(open(sys.argv[1])):
    for text in (item['say'] if isinstance(item['say'], list) else [item['say']]):
        path = 'artifacts/routing-audio/' + hashlib.sha1(text.encode()).hexdigest() + '.pcm'
        if os.path.exists(path): continue
        subprocess.run(['say', '-v', 'Tingting', '--data-format=LEI16@16000', '-o', path + '.wav', text], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path + '.wav', '-f', 's16le', '-ac', '1', '-ar', '16000', path], check=True)
        os.remove(path + '.wav')
PY
ssh v "mkdir $work/audio"; tar cf - -C artifacts/routing-audio . | ssh v "tar xf - -C $work/audio"
ssh v "cat > $work/cases.json" < "$cases"
ssh v "sudo -n -u openclaw /opt/node-v22.23.1/bin/node $root/launch.private.cjs $root/environment.private.json /usr/bin/env ROUTING_DEBUG='${ROUTING_DEBUG:-}' ROUTING_ONLY='${ROUTING_ONLY:-}' ROUTING_LANES='${ROUTING_LANES:-2}' /opt/node-v22.23.1/bin/node $work/code/scripts/candidate/routing-eval.mjs $work/cases.json $work/out $repeats"
out="artifacts/routing-eval-$stamp${ref:+-${ref:0:8}}"; mkdir -p "$out"
ssh v "sudo -n cat $work/out/results.json" > "$out/results.json"
ssh v "rm -rf $work/code $work/cases.json $work/audio; sudo -n rm -rf $work" || true
echo "$out/results.json"
