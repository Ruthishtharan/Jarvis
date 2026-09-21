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


def find_track_uri(query: str) -> str:
    """Resolve a song name to a `spotify:track:...` URI.

    Spotify's Web API would be cleaner but needs registered credentials. Track
    pages are public and indexed, so a web search for the open.spotify.com URL
    gets the same ID with nothing to configure.

    Uses `ddgs` — the same library research/engines.py searches with. The
    previous version POSTed to html.duckduckgo.com directly and had silently
    stopped working: DuckDuckGo now answers that endpoint with an anti-bot
    challenge page, and it returns **HTTP 202**. `raise_for_status()` treats
    202 as success, so the code happily regexed a page with no results in it
    and returned "" every single time. Every "play <song>" therefore fell
    through to merely opening the search pane.
    """
    import re as _re

    try:
        from ddgs import DDGS
    except ImportError:
        logger.debug("ddgs not installed — cannot resolve track URI")
        return ""

    pattern = _re.compile(r"open\.spotify\.com/track/([A-Za-z0-9]{22})")
    wanted = set(_re.findall(r"[a-z0-9]+", query.lower()))

    # Rank rather than taking result one. Searching "bohemian rhapsody"
    # returned a live recording of "Now I'm Here" first — same artist, wrong
    # song — because the first hit is whatever the engine ranked, not whatever
    # matches the title. Scoring on how much of the query appears in the
    # result title fixes that with no extra request.
    best, best_score = "", -1.0
    try:
        with DDGS() as d:
            for r in d.text(f"{query} site:open.spotify.com/track", max_results=8):
                m = (pattern.search(r.get("href", "") or "")
                     or pattern.search(r.get("body", "") or ""))
                if not m:
                    continue
                title = (r.get("title", "") or "").lower()
                # Spotify titles read "Song - song and lyrics by Artist | Spotify";
                # everything from the dash on is boilerplate, not the song name.
                head = set(_re.findall(r"[a-z0-9]+", title.split(" - ")[0]))
                score = len(wanted & head) / max(len(wanted), 1)
                if score > best_score:
                    best, best_score = f"spotify:track:{m.group(1)}", score
                if best_score == 1.0:      # every query word present — done
                    break
    except Exception as exc:
        logger.debug(f"track lookup failed: {exc}")
    return best


def _search_and_play(query: str) -> tuple[bool, str]:
    """Play a specific song.

    The previous version opened a search and fired blind arrow-key presses at
    the window, hoping row one was a track. That depends on Spotify's layout,
    on the window having focus, and on a fixed delay being long enough — so it
    reliably searched and unreliably played.

    Resolving the track URI first removes all of that: AppleScript plays an
    exact track, no UI scripting involved.
    """
    logger.info(f"Spotify: {query!r}")

    uri = find_track_uri(query)
    if uri:
        ok, _ = _run_as(f'tell application "Spotify" to play track "{uri}"')
        if ok:
            time.sleep(0.9)
            now = get_current_track()
            logger.info(f"Now playing: {now or uri}")
            return True, now or query

    # No URI, or AppleScript refused — fall back to showing the search so the
    # request is at least one click from done.
    logger.info("falling back to in-app search")
    subprocess.run(["open", f"spotify:search:{urllib.parse.quote(query)}"])
    time.sleep(1.5)
    now = get_current_track()
    if now:
        return True, now
    # Search is open but nothing is playing. This used to return True with the
    # apology packed into the message, so the caller dutifully wrapped it:
    # "Playing <song> - search is open in Spotify, but I couldn't start it on
    # Spotify." Success and failure have to be distinguishable by the flag, not
    # by reading the string — the caller cannot phrase it correctly otherwise.
    return False, query


def _run_as(script: str) -> tuple[bool, str]:
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True
    )
    return result.returncode == 0, result.stdout.strip()
