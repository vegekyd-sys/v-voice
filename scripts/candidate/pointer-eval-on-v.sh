#!/usr/bin/env bash
# Runs scripts/candidate/pointer-eval.mjs on V with the board Candidate's own DeepSeek key
# (not production's), as nobody in /tmp. The photos are the Candidate's cached public search
# results, copied to /tmp/pointer-eval/photos beforehand. No call, Gateway or service is touched.
#
#   scripts/candidate/pointer-eval-on-v.sh [case ids…]
set -euo pipefail
cd "$(dirname "$0")/../.."
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p artifacts/pointer-eval
tar czf - scripts/candidate/pointer-eval.mjs lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-cue.mjs \
  lab/gpt-live-h5/board-lesson.mjs lab/gpt-live-h5/board-scene.mjs \
  | ssh v 'rm -rf /tmp/pointer-eval/code && mkdir -m 755 -p /tmp/pointer-eval/code && tar xzf - -C /tmp/pointer-eval/code && chmod -R a+rX /tmp/pointer-eval/code && install -d -m 777 /tmp/pointer-eval/out'
ssh v sudo -n VARIANTS="${VARIANTS:-see,where,blind,think}" python3 - "$@" <<'PY' 2>&1 | tee "artifacts/pointer-eval/$stamp.txt"
import json, os, subprocess, sys
source = json.load(open('/var/lib/v-voice-candidates/board-20261112/environment.private.json'))
env = {'PATH': '/opt/node-v22.23.1/bin:/usr/bin:/bin', 'HOME': '/tmp', 'VOICE_BOARD': '1', 'DEEPSEEK_API_KEY': source['DEEPSEEK_API_KEY'], 'VARIANTS': os.environ.get('VARIANTS', 'see,where,blind,think')}
sys.exit(subprocess.run(['/opt/node-v22.23.1/bin/node', 'scripts/candidate/pointer-eval.mjs', '/tmp/pointer-eval/photos', '/tmp/pointer-eval/out/result.json', *sys.argv[1:]],
                        env=env, user='nobody', group='nogroup', cwd='/tmp/pointer-eval/code').returncode)
PY
ssh v cat /tmp/pointer-eval/out/result.json > "artifacts/pointer-eval/$stamp.json"
echo "saved artifacts/pointer-eval/$stamp.json"
