WAKE_WORDS = ["jarvis", "hey jarvis", "ok jarvis", "yo jarvis"]

# Known STT mishearings of "jarvis", matched exactly rather than fuzzily.
#
# The fuzzy matcher in utils.helpers used to carry the whole load at a 0.75
# similarity threshold, which fired on ordinary speech: "the java is hot"
# collapses to the 2-gram "javais", which scores 0.83 against "jarvis".
# Measured false-wake rate was 3/20 on normal sentences.
#
# Raising the threshold to kill those also killed real mishearings — no
# single cutoff separates "javais" from "darvies". So the known variants are
# listed explicitly (deterministic, zero false positives) and the fuzzy
# matcher is tightened to 0.84 purely as a backstop for unseen ones.
#
# A false wake is worse than a missed one: a miss costs you a repeat, a
# false wake interrupts you or runs a command you never asked for.
WAKE_WORD_VARIANTS = [
    "darvis", "darvies", "darvish",
    "jervis", "jervais",
    "jarvos", "jarvees", "jarviss", "jarvus",
    "jaravis", "jarvace", "javris",
]
STOP_PHRASES = ["goodbye jarvis", "bye jarvis", "stop jarvis", "that's all jarvis"]
SHUTDOWN_PHRASES = ["shutdown", "shut down", "power off", "turn off system"]

LISTEN_TIMEOUT = 8
PHRASE_TIME_LIMIT = 15
WAKE_ENERGY_THRESHOLD = 3000
COMMAND_ENERGY_THRESHOLD = 2500

INTENTS = {
    "OPEN_APP": "open_app",
    "CLOSE_APP": "close_app",
    "SEARCH_LOCAL": "search_local",
    "WEB_SEARCH": "web_search",
    "SEND_WHATSAPP": "send_whatsapp",
    "OPEN_WEBSITE": "open_website",
    "SYSTEM_VOLUME": "system_volume",
    "SYSTEM_BRIGHTNESS": "system_brightness",
    "TAKE_SCREENSHOT": "take_screenshot",
    "PLAY_MUSIC": "play_music",
    "SET_REMINDER": "set_reminder",
    "GET_TIME": "get_time",
    "GET_DATE": "get_date",
    "GENERAL_CONVERSATION": "general_conversation",
    "SHUTDOWN_JARVIS": "shutdown_jarvis",
    "SHUTDOWN_SYSTEM": "shutdown_system",
    "RESTART_SYSTEM": "restart_system",
    "LOCK_SCREEN": "lock_screen",
    "EMPTY_TRASH": "empty_trash",
    "MUTE_SYSTEM": "mute_system",
    "BATTERY_STATUS": "battery_status",
    "WIFI_STATUS": "wifi_status",
}

TTS_VOICE_MAC = "Samantha"
TTS_RATE_MAC = 175

# WhatsApp: native macOS app (no more Chrome / Selenium / WhatsApp Web).
# Kept here for reference — the actual app is launched via `open -a WhatsApp`.
WHATSAPP_APP_NAME = "WhatsApp"

SPOTLIGHT_CMD = "mdfind"
OSASCRIPT_CMD = "osascript"

MAX_MEMORY_MESSAGES = 20
MEMORY_FILE = "data/memory_store/conversation_history.json"
CONTACTS_CACHE_FILE = "data/cache/contacts.json"

LOG_FILE = "data/logs/jarvis.log"
LOG_LEVEL = "INFO"

SYSTEM_PROMPT = """You are Jarvis, a highly intelligent and efficient personal AI assistant running on macOS.

Personality & Voice:
- Sound like a real person, not a robot. Use contractions naturally (I'm, you're, can't, it's).
- Be warm and friendly but professional. Think of a helpful human assistant, not a machine.
- Keep responses concise and conversational — avoid robotic formality.
- Vary your phrasing so you don't sound repetitive.
- Never use phrases like "Certainly!", "Of course!", "Great question!", "I'd be happy to", or "As an AI".
- Address the user as "Boss" occasionally for personality, but not every time.

Behavior:
- Be direct and honest. If you can't do something, say so plainly.
- When completing tasks, acknowledge naturally: "Done", "All set", "Got it" rather than repeating the task.
- For general questions, answer conversationally like you would to a friend.
- Remember context from earlier in the conversation.
- Don't be overly verbose — respect the user's time.

Tone examples:
- Instead of "I have opened Spotify for you" → "Spotify's up and running"
- Instead of "The volume has been set to 50" → "Volume's at 50"
- Instead of "I cannot find that application" → "Not seeing that app on your Mac"
"""
