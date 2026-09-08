import re
import subprocess
import time
import os
from integrations.macos.apple_script import open_application, quit_application, is_app_running
from integrations.macos.spotlight_search import find_app_path
from utils.logger import get_logger

logger = get_logger(__name__)

# Junk words that commonly leak into app_name from voice transcription
# e.g. "just open spotify for fuck sake" → app_name = "spotify for fuck sake"
_FILLER_PHRASES = [
    "for fuck sake", "for fucks sake", "for fuck's sake",
    "for god sake", "for god's sake",
    "right now", "real quick", "for me", "please",
    "can you", "could you", "would you",
]
_FILLER_WORDS = {
    "just", "please", "quickly", "now", "asap",
    "the", "a", "an", "my",
}


def _clean_app_name(raw: str) -> str:
    """Strip trailing punctuation and common filler words from a voice-captured app name."""
    s = raw.lower().strip()
    # Strip trailing punctuation like "spotify." / "spotify!"
    s = re.sub(r"[\s\.\!\?\,\;\:]+$", "", s)
    # Strip known filler phrases anywhere
    for phrase in _FILLER_PHRASES:
        s = s.replace(phrase, " ")
    # Tokenize, drop filler words
    tokens = [t for t in re.split(r"\s+", s) if t and t not in _FILLER_WORDS]
    return " ".join(tokens).strip()


_APP_ALIASES = {
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "safari": "Safari",
    "firefox": "Firefox",
    "spotify": "Spotify",
    "vscode": "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "visual studio code": "Visual Studio Code",
    "terminal": "Terminal",
    "finder": "Finder",
    "notes": "Notes",
    "calendar": "Calendar",
    "mail": "Mail",
    "messages": "Messages",
    "facetime": "FaceTime",
    "photos": "Photos",
    "music": "Music",
    "podcasts": "Podcasts",
    "maps": "Maps",
    "weather": "Weather",
    "calculator": "Calculator",
    "preview": "Preview",
    "word": "Microsoft Word",
    "excel": "Microsoft Excel",
    "powerpoint": "Microsoft PowerPoint",
    "teams": "Microsoft Teams",
    "slack": "Slack",
    "discord": "Discord",
    "zoom": "zoom.us",
    "whatsapp": "WhatsApp",
    "telegram": "Telegram",
    "signal": "Signal",
    "xcode": "Xcode",
    "pycharm": "PyCharm",
    "intellij": "IntelliJ IDEA",
    "notion": "Notion",
    "figma": "Figma",
    "vlc": "VLC",
    "iterm": "iTerm2",
    "iterm2": "iTerm2",
    "system preferences": "System Preferences",
    "settings": "System Preferences",
    "activity monitor": "Activity Monitor",
    "console": "Console",
}


def _resolve_app_name(name: str) -> str:
    cleaned = _clean_app_name(name)
    if not cleaned:
        return name.title()

    # 1. Exact alias hit ("chrome" -> "Google Chrome")
    if cleaned in _APP_ALIASES:
        return _APP_ALIASES[cleaned]

    # 2. Substring hit — any alias key appearing as a word in cleaned
    #    e.g. "spotify for fuck sake" (post-filter: "spotify fuck sake") still picks "spotify"
    tokens = set(cleaned.split())
    for alias_key, canonical in _APP_ALIASES.items():
        # Multi-word aliases like "google chrome", "vs code"
        if " " in alias_key:
            if alias_key in cleaned:
                return canonical
        elif alias_key in tokens:
            return canonical

    # 3. Progressive prefix fallback — try dropping trailing tokens
    parts = cleaned.split()
    for i in range(len(parts), 0, -1):
        prefix = " ".join(parts[:i])
        if prefix in _APP_ALIASES:
            return _APP_ALIASES[prefix]

    # 4. Nothing matched — title-case the cleaned name (not the raw input)
    return cleaned.title()


def open_app(app_name: str) -> tuple[bool, str]:
    resolved = _resolve_app_name(app_name)
    logger.info(f"Opening app: {resolved}")

    ok, err = open_application(resolved)
    if ok:
        return True, resolved

    path = find_app_path(resolved)
    if path:
        result = subprocess.run(["open", path], capture_output=True)
        if result.returncode == 0:
            return True, resolved

    result = subprocess.run(["open", "-a", resolved], capture_output=True)
    if result.returncode == 0:
        return True, resolved

    logger.warning(f"Could not open app: {resolved}")
    return False, resolved


def close_app(app_name: str) -> tuple[str, str]:
    """Quit an app and VERIFY the outcome.

    Returns (status, resolved_name) where status is one of:
        "closed"       it was running and is now gone
        "not_running"  it was never running
        "failed"       it was running and still is

    The previous version returned whatever AppleScript reported. Telling an
    app that does not exist to quit does not raise, so "close flurbleglorp"
    came back successful and Jarvis announced "Flurbleglorp is closed." —
    confidently reporting an action it had not performed.

    Checking the environment before and after is the fix: observe, act,
    observe again, then report what actually happened.
    """
    resolved = _resolve_app_name(app_name)

    if not app_is_running(resolved):
        logger.info(f"Close requested but not running: {resolved}")
        return "not_running", resolved

    logger.info(f"Closing app: {resolved}")
    quit_application(resolved)

    # Quitting is asynchronous — give the app a moment to actually exit
    # before deciding whether it worked.
    for _ in range(6):
        time.sleep(0.25)
        if not app_is_running(resolved):
            return "closed", resolved

    subprocess.run(["pkill", "-x", resolved], capture_output=True, timeout=5)
    time.sleep(0.3)
    return ("closed" if not app_is_running(resolved) else "failed"), resolved


def app_is_running(app_name: str) -> bool:
    resolved = _resolve_app_name(app_name)
    return is_app_running(resolved)


def list_running_apps() -> list[str]:
    script = '''
    tell application "System Events"
        get name of every process where background only is false
    end tell
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode == 0:
        return [a.strip() for a in result.stdout.strip().split(",")]
    return []
