#!/bin/bash
# Build Neutron.app — a real macOS bundle, no electron-builder download.
#
# electron-builder would fetch platform binaries on every first run, which is
# slow on a poor connection. Everything needed is already in node_modules, so
# this assembles the bundle directly: copy Electron.app, rename the executable,
# rewrite Info.plist, drop the app source into Resources/app, ad-hoc sign.
#
# The bundle identifier matters more than the name. macOS keys microphone
# permission (TCC) to the identifier, so a fresh one means the OS asks again
# instead of remembering that "Electron" was denied.
set -euo pipefail
cd "$(dirname "$0")"

NAME="Neutron"
BUNDLE_ID="com.ruthish.neutron"
SRC="node_modules/electron/dist/Electron.app"
OUT="build/${NAME}.app"

[ -d "$SRC" ] || { echo "✗ $SRC missing — run npm install"; exit 1; }

rm -rf "$OUT"
mkdir -p build
cp -R "$SRC" "$OUT"

# Rename the executable and point the bundle at it.
mv "$OUT/Contents/MacOS/Electron" "$OUT/Contents/MacOS/${NAME}"

/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${NAME}"        "$OUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName ${NAME}"              "$OUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}"   "$OUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string ${NAME}" "$OUT/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${NAME}"       "$OUT/Contents/Info.plist"

# Required, or macOS kills the app on a mic request instead of prompting.
/usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Neutron listens for your voice commands.'" \
  "$OUT/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription 'Neutron listens for your voice commands.'" \
  "$OUT/Contents/Info.plist"

# The app source. Only Electron built-ins are used, so no node_modules needed.
APPDIR="$OUT/Contents/Resources/app"
mkdir -p "$APPDIR/shared"
cp main-jarvis.js "$APPDIR/"
cp shared/backend.js shared/media.js shared/preload.js "$APPDIR/shared/"

# The Python source stays in the project folder rather than being copied into
# the bundle, so the app has to be told where it lives. Without this the
# bundle resolves its root to Contents/Resources, finds no web/server.py, and
# fails to start the backend at all — see findRoot() in shared/backend.js.
PROJECT_ROOT="$(cd .. && pwd)"

cat > "$APPDIR/package.json" <<JSON
{
  "name": "neutron",
  "productName": "${NAME}",
  "version": "1.0.0",
  "main": "main-jarvis.js",
  "jarvisRoot": "${PROJECT_ROOT}"
}
JSON

# Ad-hoc sign so the TCC grant sticks to a stable identity across rebuilds.
codesign --force --deep --sign - --identifier "${BUNDLE_ID}" "$OUT" 2>/dev/null

echo "✓ built $(pwd)/${OUT}"
