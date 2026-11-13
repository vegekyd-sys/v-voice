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
root=/var/lib/v-voice-candidates/board-20261112
if [ "${1:-}" = "--stop" ]; then ssh v sudo -n python3 - --stop < scripts/candidate/start-board.py; exit 0; fi
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
  upload
  # The unit is transient: after a crash it no longer exists, so it is started
  # again from the Candidate's own launcher and private environment file.
  ssh v "sudo -n sh -c 'chown -R openclaw:openclaw $root/voice; systemctl stop voice-board-20261112 2>/dev/null; systemctl reset-failed voice-board-20261112 2>/dev/null; systemd-run --quiet --unit=voice-board-20261112 --property=User=openclaw --property=WorkingDirectory=$root/voice --property=UMask=0077 --property=KillMode=control-group --property=MemoryMax=1G --property=CPUQuota=100% --property=Nice=10 --property=Restart=on-failure --property=RestartSec=2 /opt/node-v22.23.1/bin/node $root/launch.private.cjs $root/environment.private.json /opt/node-v22.23.1/bin/node $root/voice/lab/gpt-live-h5/server.mjs && sleep 3 && systemctl is-active voice-board-20261112 voice-board-20261112-tunnel'"
  ssh v "sudo -n python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[\"commit\"])' $root/voice/manifest.json"
  exit 0
fi
ssh v sudo -n python3 - --stop < scripts/candidate/start-board.py >/dev/null
upload
ssh v sudo -n ${VOICE_BOARD_MODEL:+VOICE_BOARD_MODEL="$VOICE_BOARD_MODEL"} python3 - < scripts/candidate/start-board.py
echo
echo "Entry link (keep private):"
ssh v sudo -n cat "$root/entry-link.private"
