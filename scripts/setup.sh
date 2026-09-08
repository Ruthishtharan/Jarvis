#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Jarvis AI — Setup ==="
echo "Project: $PROJECT_DIR"
echo ""

# Create data directories
mkdir -p "$PROJECT_DIR/data/logs"
mkdir -p "$PROJECT_DIR/data/memory_store"
mkdir -p "$PROJECT_DIR/data/cache"
mkdir -p "$PROJECT_DIR/data/models"
# (data/chrome_profile no longer needed — WhatsApp uses the native macOS app)

# Install dependencies
bash "$SCRIPT_DIR/install_dependencies.sh"

# Check .env — create from example on first run, then nudge for the Groq key
if [ ! -f "$PROJECT_DIR/.env" ] && [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "Created $PROJECT_DIR/.env from .env.example"
fi

if [ -f "$PROJECT_DIR/.env" ] && ! grep -qE '^GROQ_API_KEY=.+' "$PROJECT_DIR/.env"; then
    echo ""
    echo "⚠️  ACTION REQUIRED:"
    echo "   Edit $PROJECT_DIR/.env"
    echo "   Set GROQ_API_KEY=<your_key>"
    echo "   Get a free key at: https://console.groq.com"
    echo ""
    echo "   (Without a Groq key, Jarvis still runs — all offline system commands"
    echo "    work, but general AI conversation / fuzzy intent fallback are off.)"
    echo ""
fi

# Make run.py executable
chmod +x "$PROJECT_DIR/run.py"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start Jarvis now:"
echo "   python3 $PROJECT_DIR/run.py"
echo ""
echo "To enable auto-start on login:"
echo "   bash $SCRIPT_DIR/enable_startup_mac.sh"
echo ""
