#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Copies the board director and its
# eval script to /tmp on V and runs the eval there as an unprivileged user,
# handing it only the text-model key the Voice service already holds. No voice
# call, no Gateway request, nothing is installed or restarted. Output is saved
# next to this repository so the result can be reviewed.
#
#   scripts/candidate/board-eval-on-v.sh [model ...]
set -euo pipefail
cd "$(dirname "$0")/../.."
out="artifacts/board-eval-$(date +%Y%m%d-%H%M%S).txt"
mkdir -p artifacts
tar czf - scripts/candidate/board-eval.mjs lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs \
  | ssh v 'rm -rf /tmp/board-eval && mkdir -m 755 /tmp/board-eval && tar xzf - -C /tmp/board-eval'
ssh v sudo -n BOARD_EVAL_VERBOSE="${BOARD_EVAL_VERBOSE:-1}" python3 - "$@" <<'PY' 2>&1 | tee "$out"
import os, pathlib, subprocess, sys
pid = subprocess.check_output(['systemctl', 'show', 'openclaw-rtc-h5.service', '-p', 'MainPID', '--value'], text=True).strip()
source = dict(item.split('=', 1) for item in pathlib.Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in item)
env = {'PATH': '/opt/node-v22.23.1/bin:/usr/bin:/bin', 'HOME': '/tmp', 'VOICE_BOARD': '1',
       'BOARD_EVAL_VERBOSE': os.environ.get('BOARD_EVAL_VERBOSE', '1'),
       **{key: source[key] for key in ['OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY'] if key in source}}
sys.exit(subprocess.run(['/opt/node-v22.23.1/bin/node', '/tmp/board-eval/scripts/candidate/board-eval.mjs', *sys.argv[1:]],
                        env=env, user='nobody', group='nogroup', cwd='/tmp/board-eval').returncode)
PY
echo "saved $out"
