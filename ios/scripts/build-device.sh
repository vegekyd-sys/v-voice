#!/bin/bash
# Development signing/export only. Never uploads or publishes an app.
set -euo pipefail
if [[ "${1:-}" == "--help" ]]; then
  echo 'Usage: VVOICE_TEAM_ID=<team> VVOICE_DEVICE_ID=<optional connected UDID> ios/scripts/build-device.sh'
  echo 'Requires Xcode Developer Account login and profiles for the app and activity extension.'
  exit 0
fi
VVOICE_IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VVOICE_TEAM_ID="${VVOICE_TEAM_ID:-E6YTL27QWA}"
VVOICE_ARCHIVE="$VVOICE_IOS_ROOT/build/VVoice.xcarchive"
# Fail before signing if either embedded H5 resource set is stale.
node "$VVOICE_IOS_ROOT/scripts/sync-h5-design.mjs" --check
node "$VVOICE_IOS_ROOT/scripts/sync-h5-shell.mjs" --check
mkdir -p "$VVOICE_IOS_ROOT/build"
if command -v xcodegen >/dev/null; then xcodegen generate --spec "$VVOICE_IOS_ROOT/project.yml"; fi
if [[ -d "$VVOICE_ARCHIVE" ]]; then mv "$VVOICE_ARCHIVE" "$VVOICE_ARCHIVE.previous-$(date +%Y%m%d-%H%M%S)"; fi
VVOICE_DESTINATION='generic/platform=iOS'
if [[ -n "${VVOICE_DEVICE_ID:-}" ]]; then VVOICE_DESTINATION="id=$VVOICE_DEVICE_ID"; fi
xcodebuild -project "$VVOICE_IOS_ROOT/VVoice.xcodeproj" -scheme VVoice -configuration Release \
  -destination "$VVOICE_DESTINATION" -archivePath "$VVOICE_ARCHIVE" \
  DEVELOPMENT_TEAM="$VVOICE_TEAM_ID" -allowProvisioningUpdates -allowProvisioningDeviceRegistration archive
python3 - "$VVOICE_IOS_ROOT/build/ExportOptions.plist" "$VVOICE_TEAM_ID" <<'PY'
import plistlib,sys
with open(sys.argv[1],'wb') as f:
    plistlib.dump({'method':'debugging','destination':'export','teamID':sys.argv[2],'signingStyle':'automatic'},f)
PY
xcodebuild -exportArchive -archivePath "$VVOICE_ARCHIVE" -exportOptionsPlist "$VVOICE_IOS_ROOT/build/ExportOptions.plist" \
  -exportPath "$VVOICE_IOS_ROOT/build/export" -allowProvisioningUpdates
VVOICE_APP="$VVOICE_ARCHIVE/Products/Applications/VVoice.app"
python3 "$VVOICE_IOS_ROOT/scripts/verify-release.py" "$VVOICE_APP"
if [[ -n "${VVOICE_DEVICE_ID:-}" ]]; then
  xcrun devicectl device install app --device "$VVOICE_DEVICE_ID" "$VVOICE_APP"
fi
