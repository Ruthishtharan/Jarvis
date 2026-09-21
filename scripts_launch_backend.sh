#!/bin/bash
# Launch the JARVIS backend. Used by the LaunchAgent and safe to run by hand:
# if something is already serving 8420 it exits rather than starting a second.
set -euo pipefail
ROOT="/Users/ruthish/Projects/Jarvis.ai"
cd "$ROOT"
if curl -sf -m 2 http://127.0.0.1:8420/api/status >/dev/null 2>&1; then
  echo "backend already running"; exit 0
fi
exec /usr/local/bin/python3 web/server.py --port 8420
