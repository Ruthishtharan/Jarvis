#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Jarvis AI — Installing Dependencies ==="

# Check for Homebrew
if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# PortAudio (required for PyAudio)
if ! brew list portaudio &>/dev/null; then
    echo "Installing portaudio..."
    brew install portaudio
fi

# ffmpeg (required by openai-whisper for audio decoding)
if ! command -v ffmpeg &>/dev/null; then
    echo "Installing ffmpeg (needed for Whisper offline STT)..."
    brew install ffmpeg
fi

# Python packages
echo "Installing Python packages..."
pip3 install --upgrade pip
pip3 install -r "$PROJECT_DIR/requirements.txt"

echo ""
echo "=== Dependencies installed successfully ==="
echo ""
echo "Whisper offline STT models (downloaded automatically on first use):"
echo "  tiny  — 39 MB  — fastest, good for wake word"
echo "  base  — 74 MB  — default, good balance"
echo "  small — 244 MB — most accurate offline"
echo ""
echo "To enable offline mode, set in .env:"
echo "  USE_OFFLINE_STT=true"
echo "  WHISPER_MODEL_SIZE=base"
