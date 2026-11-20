#!/usr/bin/env bash
# Runs scripts/candidate/canvas-today.mjs on V with the board Candidate's own DeepSeek and Brave keys
# (not production's), as nobody in /tmp. No call, Gateway or service is touched. Results and the
# pictures it found are copied back to artifacts/canvas-today/<stamp>/.
#   scripts/candidate/canvas-today-on-v.sh [topic ids…]
set -euo pipefail
cd "$(dirname "$0")/../.."
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p artifacts/canvas-today/$stamp
tar czf - scripts/candidate/canvas-today.mjs scripts/candidate/canvas-proto.mjs scripts/candidate/pointer-eval.mjs lab/gpt-live-h5/board-*.mjs \
  | ssh v 'rm -rf /tmp/pointer-eval/code && mkdir -m 755 -p /tmp/pointer-eval/code && tar xzf - -C /tmp/pointer-eval/code && chmod -R a+rX /tmp/pointer-eval/code && rm -rf /tmp/pointer-eval/today && install -d -m 777 /tmp/pointer-eval/today'
ssh v sudo -n python3 - "$@" <<'PY' 2>&1 | tee "artifacts/canvas-today/$stamp/run.txt"
import json, subprocess, sys
source = json.load(open('/var/lib/v-voice-candidates/board-20261112/environment.private.json'))
env = {'PATH': '/opt/node-v22.23.1/bin:/usr/bin:/bin', 'HOME': '/tmp', 'VOICE_BOARD': '1', 'DEEPSEEK_API_KEY': source['DEEPSEEK_API_KEY'], 'VOICE_BOARD_BRAVE_KEY': source['VOICE_BOARD_BRAVE_KEY']}
sys.exit(subprocess.run(['/opt/node-v22.23.1/bin/node', 'scripts/candidate/canvas-today.mjs', '/tmp/pointer-eval/today', *sys.argv[1:]],
                        env=env, user='nobody', group='nogroup', cwd='/tmp/pointer-eval/code').returncode)
PY
ssh v 'tar czf - -C /tmp/pointer-eval/today .' | tar xzf - -C artifacts/canvas-today/$stamp
echo "saved artifacts/canvas-today/$stamp"
