#!/usr/bin/env bash
# Run from a Mac that has the `v` SSH alias. Packages the committed source,
# copies it to V's private Candidate directory and starts the GPT Live 1.1
# Candidate there (scripts/candidate/start-gpt-live-11.py describes exactly
# what that does). Production Voice and the Gateway are not changed or restarted.
# The private ChatGPT login file must already be in the Candidate's state directory.
#
#   scripts/candidate/deploy-gpt-live-11.sh           # package, upload, start; the entry link stays in a private file on V
#   scripts/candidate/deploy-gpt-live-11.sh --stop    # save the unit files, then stop the Candidate
set -euo pipefail
cd "$(dirname "$0")/../.."
root=/var/lib/v-voice-candidates/gpt-live-11-20261120
if [ "${1:-}" = "--stop" ]; then ssh v sudo -n python3 - --stop < scripts/candidate/start-gpt-live-11.py; exit 0; fi
commit="$(git rev-parse HEAD)"
[ -d "artifacts/$commit" ] || npm run package
node scripts/verify-package.mjs "artifacts/$commit"
ssh v sudo -n python3 - --stop < scripts/candidate/start-gpt-live-11.py >/dev/null
tar czf - -C "artifacts/$commit" . | ssh v "sudo -n sh -c 'mkdir -p -m 700 $root && rm -rf $root/voice.next && mkdir $root/voice.next && tar xzf - -C $root/voice.next && { [ ! -d $root/voice/node_modules ] || mv $root/voice/node_modules $root/voice.next/node_modules; } && rm -rf $root/voice && mv $root/voice.next $root/voice'"
ssh v sudo -n python3 - < scripts/candidate/start-gpt-live-11.py
echo "Entry link is in $root/entry-link.private on V (keep private)."
