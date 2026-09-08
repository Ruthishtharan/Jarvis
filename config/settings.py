import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")

# ── LLM provider selection ───────────────────────────────────────────────────
# "groq" (default — fast, free tier, cloud) or "ollama" (local, private, free)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()

# ── Groq AI ──────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
# NOTE (2026-09): Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant.
# Both returned HTTP 404 and every LLM call in the project was failing silently
# behind an error message. Replacements chosen by measuring on this account:
#
#   chat  openai/gpt-oss-120b   920ms, best prose quality
#   fast  qwen/qwen3.8-27b      303ms, and the only candidate that returned a
#                               VALID skill name for intent JSON — gpt-oss-20b
#                               hallucinated one that was not in the list,
#                               which would break routing outright.
#
# Verify the list for your account with:
#   curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
GROQ_CHAT_MODEL = os.getenv("GROQ_CHAT_MODEL", "openai/gpt-oss-120b")
GROQ_FAST_MODEL = os.getenv("GROQ_FAST_MODEL", "qwen/qwen3.8-27b")

# ── Ollama (local LLM) ───────────────────────────────────────────────────────
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

# ── Voice ─────────────────────────────────────────────────────────────────────
WAKE_WORD = os.getenv("JARVIS_WAKE_WORD", "jarvis")
# Use "Samantha" for standard voice, "Alice" for more natural sound (if available)
TTS_VOICE = os.getenv("TTS_VOICE", "Samantha")
# Lower rate = slower, more natural speech. 155-165 sounds more human than robotic 175+
TTS_RATE = int(os.getenv("TTS_RATE", "160"))

# ── Text-to-speech engine ────────────────────────────────────────────────────
# "say"        — macOS built-in. Instant, offline, robotic.
# "elevenlabs" — streaming neural TTS. Far better voice; needs a key + network.
#                Falls back to `say` automatically on any failure.
TTS_ENGINE = os.getenv("TTS_ENGINE", "say").lower()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
# Flash v2.5 is their lowest-latency model (~75ms) and about half the credits
# of the multilingual model. Turbo is equivalent but slower on average.
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")

GOOGLE_STT_LANGUAGE = os.getenv("STT_LANGUAGE", "en-US")
USE_OFFLINE_STT = os.getenv("USE_OFFLINE_STT", "false").lower() == "true"

# Speech-to-text backend. Measured on this machine over six known phrases:
#   local Whisper base            1118ms   accuracy 0.951
#   Groq whisper-large-v3-turbo    229ms   accuracy 0.951
# A 4.9x speedup at identical accuracy, using a strictly larger model.
#
#   "auto"    Groq first, local Whisper behind it (default)
#   "groq"    force Groq primary
#   "whisper" force local primary — fully offline
#   "google"  force Google primary
# Whatever the choice, the others remain as fallbacks: losing the network
# should cost latency, not the assistant.
STT_ENGINE = os.getenv("STT_ENGINE", "auto").lower()
GROQ_STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")  # tiny | base | small | medium

# ── WhatsApp ─────────────────────────────────────────────────────────────────
# Native macOS WhatsApp app — no Chrome or Selenium required.
WHATSAPP_APP_NAME = os.getenv("WHATSAPP_APP_NAME", "WhatsApp")

# ── Storage / Logging ─────────────────────────────────────────────────────────
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE = str(BASE_DIR / "data" / "logs" / "jarvis.log")
MEMORY_FILE = str(BASE_DIR / "data" / "memory_store" / "conversation_history.json")
CONTACTS_CACHE = str(BASE_DIR / "data" / "cache" / "contacts.json")

MAX_CONVERSATION_HISTORY = int(os.getenv("MAX_HISTORY", "20"))
USER_NAME = os.getenv("USER_NAME", "Boss")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"


def has_ai() -> bool:
    """True if *some* LLM provider is usable.  Ollama doesn't require a key."""
    if LLM_PROVIDER == "ollama":
        return True
    return bool(GROQ_API_KEY)


def validate():
    from utils.logger import get_logger
    log = get_logger("config")
    if LLM_PROVIDER == "groq" and not GROQ_API_KEY:
        log.warning(
            "GROQ_API_KEY is not set — AI conversation and smart intent fallback disabled. "
            "All system commands (open apps, volume, WhatsApp, etc.) still work offline. "
            "(Or switch to local LLM with LLM_PROVIDER=ollama in .env)"
        )
    elif LLM_PROVIDER == "ollama":
        log.info(
            f"LLM provider: ollama @ {OLLAMA_HOST} (model: {OLLAMA_MODEL}). "
            "Make sure `ollama serve` is running."
        )
    elif LLM_PROVIDER not in ("groq", "ollama"):
        log.warning(f"Unknown LLM_PROVIDER={LLM_PROVIDER!r} — defaulting to groq.")
