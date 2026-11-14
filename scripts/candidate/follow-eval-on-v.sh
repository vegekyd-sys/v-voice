#!/usr/bin/env bash
# Runs scripts/candidate/follow-eval.mjs on V with the board Candidate's own
# DeepSeek key (not production's), as an unprivileged user in /tmp. No call,
# Gateway or service is touched. The result is copied back to artifacts/.
#
#   scripts/candidate/follow-eval-on-v.sh [question ids…]
set -euo pipefail
cd "$(dirname "$0")/../.."
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p artifacts/follow-eval
tar czf - scripts/candidate/follow-eval.mjs scripts/candidate/follow-cue.mjs scripts/candidate/board-bench/questions.json \
  lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs lab/gpt-live-h5/board-lesson.mjs \
  | ssh v 'rm -rf /tmp/follow-eval && mkdir -m 755 /tmp/follow-eval && tar xzf - -C /tmp/follow-eval && chmod -R a+rX /tmp/follow-eval && install -d -m 777 /tmp/follow-eval/out'
ssh v sudo -n python3 - "$@" <<'PY' 2>&1 | tee "artifacts/follow-eval/$stamp.txt"
import json, subprocess, sys
source = json.load(open('/var/lib/v-voice-candidates/board-20261112/environment.private.json'))
env = {'PATH': '/opt/node-v22.23.1/bin:/usr/bin:/bin', 'HOME': '/tmp', 'VOICE_BOARD': '1', 'DEEPSEEK_API_KEY': source['DEEPSEEK_API_KEY']}
sys.exit(subprocess.run(['/opt/node-v22.23.1/bin/node', 'scripts/candidate/follow-eval.mjs', '/tmp/follow-eval/out/result.json', *sys.argv[1:]],
                        env=env, user='nobody', group='nogroup', cwd='/tmp/follow-eval').returncode)
PY
ssh v cat /tmp/follow-eval/out/result.json > "artifacts/follow-eval/$stamp.json"
echo "saved artifacts/follow-eval/$stamp.json"
