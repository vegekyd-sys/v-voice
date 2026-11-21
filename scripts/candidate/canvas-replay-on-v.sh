#!/usr/bin/env bash
# Runs scripts/candidate/canvas-replay.mjs on V as nobody with the canvas Candidate's own DeepSeek
# (and, with EYE=1, Brave) key. The cases are read from stdin and passed on by pipe: nothing of them
# is written on V or here. No call, Gateway or service is touched.
#   scripts/candidate/canvas-replay-on-v.sh [--json] < cases.json
set -euo pipefail
cd "$(dirname "$0")/../.."
tar czf - scripts/candidate/canvas-replay.mjs lab/gpt-live-h5/board-*.mjs \
  | ssh v 'rm -rf /tmp/canvas-replay && mkdir -m 755 -p /tmp/canvas-replay && tar xzf - -C /tmp/canvas-replay && chmod -R a+rX /tmp/canvas-replay'
ssh v "sudo -n ${EYE:+EYE=$EYE} python3 -c '
import json, os, subprocess, sys
source = json.load(open(\"/var/lib/v-voice-candidates/board-canvas-20261120/environment.private.json\"))
env = {\"PATH\": \"/opt/node-v22.23.1/bin:/usr/bin:/bin\", \"HOME\": \"/tmp\", \"VOICE_BOARD\": \"1\", \"DEEPSEEK_API_KEY\": source[\"DEEPSEEK_API_KEY\"]}
if os.environ.get(\"EYE\") == \"1\": env[\"VOICE_BOARD_BRAVE_KEY\"] = source[\"VOICE_BOARD_BRAVE_KEY\"]
sys.exit(subprocess.run([\"/opt/node-v22.23.1/bin/node\", \"scripts/candidate/canvas-replay.mjs\", *sys.argv[1:]], env=env, user=\"nobody\", group=\"nogroup\", cwd=\"/tmp/canvas-replay\", stdin=sys.stdin).returncode)
' $*"
