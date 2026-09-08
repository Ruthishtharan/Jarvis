"""
Spotify controller for macOS.

Uses three layers:
  1. Spotify AppleScript dictionary  — play/pause/next/previous (always works)
  2. Spotify URI scheme              — search by song name (opens results in Spotify)
  3. System Events keyboard nav      — best-effort auto-play of first search result

No Spotify API credentials required for any of this.
"""

import subprocess
import time
import urllib.parse
from utils.logger import get_logger

logger = get_logger(__name__)


# ── Public API ────────────────────────────────────────────────────────────────

def play_spotify(query: str = "") -> tuple[bool, str]:
    """Open Spotify and play. With a query, searches and tries to auto-play."""
    _ensure_spotify_running()

    if not query:
        return _resume_spotify()

    return _search_and_play(query)


def pause_spotify() -> bool:
    ok, _ = _run_as('tell application "Spotify" to pause')
    return ok


def resume_spotify() -> bool:
    ok, _ = _run_as('tell application "Spotify" to play')
    return ok


def next_track() -> bool:
    ok, _ = _run_as('tell application "Spotify" to next track')
    return ok


def previous_track() -> bool:
    ok, _ = _run_as('tell application "Spotify" to previous track')
    return ok


def get_current_track() -> str:
    script = '''
    tell application "Spotify"
        if player state is playing then
            return (name of current track) & " by " & (artist of current track)
        else
            return ""
        end if
    end tell
    '''
    ok, out = _run_as(script)
    return out if ok else ""


# ── Internal ──────────────────────────────────────────────────────────────────

def _ensure_spotify_running():
    running_script = 'tell application "System Events" to return (name of processes) contains "Spotify"'
    ok, out = _run_as(running_script)
    if ok and "true" in out.lower():
        _run_as('tell application "Spotify" to activate')
        time.sleep(0.4)
    else:
        logger.info("Spotify not running — opening it.")
        subprocess.run(["open", "-a", "Spotify"], capture_output=True)
        time.sleep(2.5)


def _resume_spotify() -> tuple[bool, str]:
    ok, _ = _run_as('tell application "Spotify" to play')
    logger.info(f"Spotify resume: {'ok' if ok else 'failed'}")
    return ok, ""


def _search_and_play(query: str) -> tuple[bool, str]:
    logger.info(f"Spotify search: {query!r}")

    # Open Spotify's built-in search via URI scheme
    encoded = urllib.parse.quote(query)
    subprocess.run(["open", f"spotify:search:{encoded}"])
    time.sleep(2.5)

    # Best-effort: navigate to first result with keyboard and press Enter
    nav_script = '''
    tell application "Spotify" to activate
    delay 0.6
    tell application "System Events"
        tell process "Spotify"
            -- Down arrow highlights the first song row; Return plays it
            key code 125
            delay 0.25
            key code 36
        end tell
    end tell
    '''
    _run_as(nav_script)

    # Verify something is actually playing
    time.sleep(1.0)
    now_playing = get_current_track()
    if now_playing:
        logger.info(f"Now playing: {now_playing}")
        return True, now_playing

    # Search results are at least visible in Spotify even if auto-play failed
    logger.info("Auto-play attempt done — Spotify is showing results.")
    return True, query


def _run_as(script: str) -> tuple[bool, str]:
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True
    )
    return result.returncode == 0, result.stdout.strip()
