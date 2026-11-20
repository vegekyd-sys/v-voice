#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Copies the shelf's eye and its
# check to /tmp on V and runs the check there as an unprivileged user, handing
# it only the text-model settings the Voice service already holds. No voice
# call, no Gateway request, nothing installed or restarted: one model call per picture.
#
#   scripts/candidate/asset-look-on-v.sh https://…/a.png [https://…/b.jpg …]
set -euo pipefail
cd "$(dirname "$0")/../.."
tar czf - scripts/candidate/asset-look.mjs lab/gpt-live-h5/board-assets.mjs lab/gpt-live-h5/media-references.mjs lab/gpt-live-h5/board-director.mjs lab/gpt-live-h5/board-scene.mjs \
  | ssh v 'rm -rf /tmp/asset-look && mkdir -m 755 /tmp/asset-look && tar xzf - -C /tmp/asset-look'
ssh v sudo -n LOOK_PROMPT="${LOOK_PROMPT:-}" python3 - "$@" <<'PY'
import os, pathlib, subprocess, sys
pid = subprocess.check_output(['systemctl', 'show', 'openclaw-rtc-h5.service', '-p', 'MainPID', '--value'], text=True).strip()
source = dict(item.split('=', 1) for item in pathlib.Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in item)
env = {'PATH': '/opt/node-v22.23.1/bin:/usr/bin:/bin', 'HOME': '/tmp', 'LOOK_PROMPT': os.environ.get('LOOK_PROMPT', ''),
       **{key: source[key] for key in ['VOICE_BOARD_API_KEY', 'VOICE_BOARD_ENDPOINT', 'VOICE_BOARD_MODEL', 'OPENROUTER_API_KEY'] if key in source}}
sys.exit(subprocess.run(['/opt/node-v22.23.1/bin/node', '/tmp/asset-look/scripts/candidate/asset-look.mjs', *sys.argv[1:]],
                        env=env, user='nobody', group='nogroup', cwd='/tmp/asset-look').returncode)
PY
