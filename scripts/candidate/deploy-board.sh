#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Packages the committed source,
# copies it to V's private Candidate directory and starts the call-board
# Candidate there (scripts/candidate/start-board.py describes exactly what
# that does). Production Voice and the Gateway are not changed or restarted.
#
#   scripts/candidate/deploy-board.sh           # package, upload, start, print the entry link
#   scripts/candidate/deploy-board.sh --update  # new code into the running Candidate; same link, same private environment
#   scripts/candidate/deploy-board.sh --stop    # stop the Candidate
set -euo pipefail
cd "$(dirname "$0")/../.."
# VOICE_BOARD_CANDIDATE=<name> VOICE_BOARD_CANDIDATE_PORT=<port>: a second board Candidate (its own directory, unit, tunnel and link).
# VOICE_BOARD_CANVAS=1: the canvas (docs/research/board-canvas) on in it.
# VOICE_BOARD_ASSETS=1: the shelf of made things (docs/candidates/board-assets-20261121.md) on in it.
name="${VOICE_BOARD_CANDIDATE:-board-20261112}"
root=/var/lib/v-voice-candidates/$name
pass="VOICE_BOARD_CANDIDATE=$name ${VOICE_BOARD_CANDIDATE_PORT:+VOICE_BOARD_CANDIDATE_PORT=$VOICE_BOARD_CANDIDATE_PORT} ${VOICE_BOARD_CANVAS:+VOICE_BOARD_CANVAS=$VOICE_BOARD_CANVAS} ${VOICE_BOARD_ASSETS:+VOICE_BOARD_ASSETS=$VOICE_BOARD_ASSETS}"
if [ "${1:-}" = "--stop" ]; then ssh v sudo -n $pass python3 - --stop < scripts/candidate/start-board.py; exit 0; fi
commit="$(git rev-parse HEAD)"
[ -d "artifacts/$commit" ] || npm run package
node scripts/verify-package.mjs "artifacts/$commit"
upload() {
  tar czf - -C "artifacts/$commit" . | ssh v "sudo -n sh -c 'mkdir -p -m 700 $root && rm -rf $root/voice.next && mkdir $root/voice.next && tar xzf - -C $root/voice.next && { [ ! -d $root/voice/node_modules ] || mv $root/voice/node_modules $root/voice.next/node_modules; } && rm -rf $root/voice && mv $root/voice.next $root/voice'"
}
if [ "${1:-}" = "--update" ]; then
  # Only this Candidate's own code and unit are touched; its environment file,
  # tunnel and entry link stay as they are. The unit must have no call in progress.
  ssh v "sudo -n test -f $root/environment.private.json"
  # VOICE_BOARD_FOLLOW=cue|word: how pieces follow the voice (docs/research/board-follow-by-model). Only that key is changed.
  if [ -n "${VOICE_BOARD_FOLLOW:-}" ]; then
    ssh v sudo -n python3 - "$root/environment.private.json" "$VOICE_BOARD_FOLLOW" <<'PY'
import json, os, sys
path, mode = sys.argv[1], sys.argv[2]
env = json.load(open(path))
if mode == 'cue': env['VOICE_BOARD_FOLLOW'] = 'cue'
else: env.pop('VOICE_BOARD_FOLLOW', None)
tmp = path + '.next'
with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as out: json.dump(env, out)
# (The Candidate reads it as its own user: keep the owner.)
stat = os.stat(path); os.chown(tmp, stat.st_uid, stat.st_gid)
os.replace(tmp, path)
print('VOICE_BOARD_FOLLOW', env.get('VOICE_BOARD_FOLLOW', '(word)'))
PY
  fi
  upload
  # The unit is transient: after a crash it no longer exists, so it is started
  # again from the Candidate's own launcher and private environment file.
  ssh v "sudo -n sh -c 'chown -R openclaw:openclaw $root/voice; systemctl stop voice-$name 2>/dev/null; systemctl reset-failed voice-$name 2>/dev/null; systemd-run --quiet --unit=voice-$name --property=User=openclaw --property=WorkingDirectory=$root/voice --property=UMask=0077 --property=KillMode=control-group --property=MemoryMax=1G --property=CPUQuota=100% --property=Nice=10 --property=Restart=on-failure --property=RestartSec=2 /opt/node-v22.23.1/bin/node $root/launch.private.cjs $root/environment.private.json /opt/node-v22.23.1/bin/node $root/voice/lab/gpt-live-h5/server.mjs && sleep 3 && systemctl is-active voice-$name voice-$name-tunnel'"
  ssh v "sudo -n python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[\"commit\"])' $root/voice/manifest.json"
  exit 0
fi
ssh v sudo -n $pass python3 - --stop < scripts/candidate/start-board.py >/dev/null
upload
ssh v sudo -n $pass ${VOICE_BOARD_MODEL:+VOICE_BOARD_MODEL="$VOICE_BOARD_MODEL"} python3 - < scripts/candidate/start-board.py
echo
echo "Entry link (keep private):"
ssh v sudo -n cat "$root/entry-link.private"
