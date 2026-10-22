#!/bin/bash
set -euo pipefail
VVOICE_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$VVOICE_REPO"
VVOICE_FIXTURE_PID=''
export VVOICE_FIXTURE_PORT="${VVOICE_FIXTURE_PORT:-29837}"
cleanup_vvoice_fixture() { if [[ -n "$VVOICE_FIXTURE_PID" ]]; then kill "$VVOICE_FIXTURE_PID" 2>/dev/null || true; fi; }
trap cleanup_vvoice_fixture EXIT INT TERM HUP
if [[ -z "${VVOICE_SIMULATOR_ID:-}" ]]; then
  VVOICE_SIMULATOR_ID="$(xcrun simctl list devices booted -j | python3 -c 'import sys,json; ds=[d["udid"] for a in json.load(sys.stdin)["devices"].values() for d in a if d["state"]=="Booted"]; print(ds[0] if len(ds)==1 else "")')"
fi
if [[ -z "$VVOICE_SIMULATOR_ID" ]]; then echo 'Set VVOICE_SIMULATOR_ID to an already booted iPhone simulator.' >&2; exit 1; fi
if [[ ! -d node_modules/ws ]]; then npm ci --ignore-scripts --no-audit --no-fund; fi
mkdir -p ios/build
if ! curl --silent --fail "http://127.0.0.1:$VVOICE_FIXTURE_PORT/fixture/state" >/dev/null; then
  node ios/scripts/fixture-server.mjs > ios/build/fixture.log 2>&1 &
  VVOICE_FIXTURE_PID=$!
  for VVOICE_WAIT in {1..50}; do
    if curl --silent --fail "http://127.0.0.1:$VVOICE_FIXTURE_PORT/fixture/state" >/dev/null; then break; fi
    sleep 0.1
  done
fi
swift test --package-path ios/VVoiceCore
xcodegen generate --spec ios/project.yml
xcodebuild -project ios/VVoice.xcodeproj -scheme VVoice -configuration Debug \
  -destination "id=$VVOICE_SIMULATOR_ID" -derivedDataPath ios/DerivedData build
xcrun simctl install "$VVOICE_SIMULATOR_ID" ios/DerivedData/Build/Products/Debug-iphonesimulator/VVoice.app
xcrun simctl privacy "$VVOICE_SIMULATOR_ID" grant microphone com.versa.vvoice
TEST_RUNNER_VVOICE_FIXTURE_PORT="$VVOICE_FIXTURE_PORT" xcodebuild -project ios/VVoice.xcodeproj -scheme VVoice -configuration Debug \
  -destination "id=$VVOICE_SIMULATOR_ID" -derivedDataPath ios/DerivedData -parallel-testing-enabled NO -collect-test-diagnostics never test
node --test lab/gpt-live-h5/hosted.test.mjs lab/realtime-direct-tools/session.test.mjs
