#!/bin/bash
# Start the JARVIS persona LoRA server (the local fast path for social turns).
#
# Lives in its own Python 3.11 venv because MLX has no 3.14 wheels and JARVIS
# runs on 3.14. The process boundary is the point — JARVIS talks to it over
# HTTP and does not care what interpreter it uses.
set -euo pipefail
PROJ="/Users/ruthish/Projects/(C) JARVIS Finetune"
PY="/Users/ruthish/Projects/Soup/.venv/bin/python"

if curl -sf -m 2 http://127.0.0.1:8421/health >/dev/null 2>&1; then
  echo "✓ persona LoRA already running"; exit 0
fi
cd "$PROJ"
nohup "$PY" "(C) serve_jarvis.py" > /tmp/jarvis-lora.log 2>&1 &
until curl -sf -m 2 http://127.0.0.1:8421/health >/dev/null 2>&1; do sleep 1; done
echo "✓ persona LoRA up on :8421"
