#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PYTHON=$(which python3)
PLIST_LABEL="com.jarvis.ai"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCH_AGENTS/$PLIST_LABEL.plist"

mkdir -p "$LAUNCH_AGENTS"
mkdir -p "$PROJECT_DIR/data/logs"

echo "=== Registering Jarvis as a Login Item ==="

# Unload existing if present
if launchctl list | grep -q "$PLIST_LABEL"; then
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
fi

# Write plist
cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON}</string>
        <string>${PROJECT_DIR}/run.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${PROJECT_DIR}/data/logs/jarvis_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_DIR}/data/logs/jarvis_stderr.log</string>
    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

# Load it
launchctl load "$PLIST_FILE"

echo ""
echo "✅  Jarvis will now start automatically when you log in."
echo ""
echo "    Plist: $PLIST_FILE"
echo ""
echo "To disable:"
echo "    launchctl unload $PLIST_FILE && rm $PLIST_FILE"
echo ""
