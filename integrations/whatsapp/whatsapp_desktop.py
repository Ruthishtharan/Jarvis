"""
WhatsApp — native macOS app integration.

Replaces the old Selenium + WhatsApp Web flow.  Two send modes:

  • send_by_phone(phone, msg) — uses the `whatsapp://send?phone=…&text=…`
    deep-link scheme (no UI scripting, fastest, most reliable).  Works when
    you speak a number or when the ContactResolver returns a phone.

  • send_by_contact(name, msg) — launches WhatsApp, opens new-chat search
    (Cmd+N), types the contact name, presses Return to pick the first match,
    types the message, presses Return to send.  Uses AppleScript +
    System Events so macOS Accessibility permission is required for the
    controlling process (Terminal / Python).

All strings interpolated into AppleScript are escaped via `_escape_as()`
(quotes + backslashes) so malformed voice input can't break or inject into
the osascript payload.
"""

import subprocess
import time
import urllib.parse

from utils.logger import get_logger

logger = get_logger(__name__)


APP_NAME = "WhatsApp"
LAUNCH_TIMEOUT_SEC = 15
WAIT_AFTER_LAUNCH_SEC = 1.0


# ── AppleScript helpers ──────────────────────────────────────────────────────

def _escape_as(s: str) -> str:
    """Escape a string for safe embedding inside an AppleScript double-quoted literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _run_as(script: str) -> tuple[bool, str]:
    result = subprocess.run(
        ["osascript", "-e", script], capture_output=True, text=True
    )
    if result.returncode == 0:
        return True, result.stdout.strip()
    return False, result.stderr.strip()


def _clipboard_get() -> bytes:
    """Return the raw current clipboard contents (so we can restore later)."""
    try:
        return subprocess.run(["pbpaste"], capture_output=True, timeout=1).stdout
    except Exception:
        return b""


def _clipboard_set(data) -> None:
    """Put `data` (str or bytes) onto the system clipboard."""
    if isinstance(data, str):
        payload = data.encode("utf-8")
    elif isinstance(data, bytes):
        payload = data
    else:
        payload = str(data).encode("utf-8")
    try:
        subprocess.run(["pbcopy"], input=payload, timeout=1)
    except Exception as e:
        logger.debug(f"pbcopy failed: {e}")


def _accessibility_hint(err: str | None) -> str:
    """Return `err` unchanged, or augment it with a clear message when the
    failure smells like an Accessibility-permission issue."""
    base = err or "AppleScript failed"
    low = (err or "").lower()
    if ("not allowed" in low
            or "accessibility" in low
            or "1719" in low
            or "not authorised" in low
            or "not authorized" in low):
        return (
            base
            + " — grant Accessibility permission to the app running Python "
              "(Terminal / iTerm / VS Code) in "
              "System Settings > Privacy & Security > Accessibility, "
              "then restart Jarvis."
        )
    return base


def _is_whatsapp_running() -> bool:
    script = (
        'tell application "System Events" to return '
        '(name of processes) contains "WhatsApp"'
    )
    ok, out = _run_as(script)
    return ok and "true" in out.lower()


def _launch_and_wait() -> bool:
    """Start WhatsApp (if not already running) and wait until its process is up."""
    if _is_whatsapp_running():
        _run_as('tell application "WhatsApp" to activate')
        return True

    logger.info("Starting WhatsApp desktop app...")
    result = subprocess.run(["open", "-a", APP_NAME], capture_output=True)
    if result.returncode != 0:
        logger.error(
            "WhatsApp.app is not installed. "
            "Install it from the Mac App Store: https://apps.apple.com/app/whatsapp/id310633997"
        )
        return False

    deadline = time.time() + LAUNCH_TIMEOUT_SEC
    while time.time() < deadline:
        if _is_whatsapp_running():
            time.sleep(WAIT_AFTER_LAUNCH_SEC)  # settle
            _run_as('tell application "WhatsApp" to activate')
            return True
        time.sleep(0.4)
    logger.error("WhatsApp did not finish launching in time.")
    return False


# ── Public API ───────────────────────────────────────────────────────────────

class WhatsAppDesktop:
    def is_available(self) -> bool:
        result = subprocess.run(
            ["osascript", "-e", f'id of application "{APP_NAME}"'],
            capture_output=True, text=True
        )
        return result.returncode == 0

    def send_by_phone(self, phone: str, message: str) -> tuple[bool, str]:
        """Deep-link into WhatsApp's native composer with text pre-filled,
        then press Return to send."""
        if not self._ensure_ready():
            return False, "WhatsApp app not available"

        clean = "".join(c for c in phone if c.isdigit() or c == "+")
        if not clean:
            return False, "no digits in phone number"

        url = f"whatsapp://send?phone={clean}&text={urllib.parse.quote(message)}"
        logger.info(f"WhatsApp deep-link to {clean} ({len(message)} chars)")
        subprocess.run(["open", url], capture_output=True)
        time.sleep(1.6)  # let the composer load with prefilled text

        # Press Return to send
        ok, err = _run_as(_PRESS_RETURN_SCRIPT)
        if not ok:
            return False, _accessibility_hint(err)
        return True, clean

    def send_by_contact(self, contact: str, message: str) -> tuple[bool, str]:
        """Open WhatsApp's New-chat dialog (Cmd+N), paste the contact name
        (Cmd+V), Return to pick the top match, paste the message (Cmd+V),
        Return to send.

        We use CLIPBOARD PASTE rather than `keystroke "text"` because WhatsApp
        for macOS is a Catalyst (iOS-derived) app and raw character keystrokes
        often fail to land in its text fields — but Cmd+V is a menu shortcut
        (Edit > Paste) and always works.  The user's original clipboard is
        saved and restored.
        """
        if not self._ensure_ready():
            return False, "WhatsApp app not available"

        saved_clip = _clipboard_get()
        try:
            # ── Step 1: open New-chat search and paste the contact name ─────
            _clipboard_set(contact)
            time.sleep(0.15)
            script1 = '''
            tell application "WhatsApp" to activate
            delay 0.6
            tell application "System Events"
                tell process "WhatsApp"
                    -- Make sure no stray modal is open first
                    key code 53            -- Escape
                    delay 0.3
                    keystroke "n" using command down
                    delay 1.4
                    keystroke "a" using command down   -- select any stale text
                    delay 0.15
                    keystroke "v" using command down   -- paste contact name
                    delay 1.6
                    key code 36                        -- Return: pick top match
                    delay 1.4
                end tell
            end tell
            '''
            ok, err = _run_as(script1)
            if not ok:
                return False, _accessibility_hint(err)

            # ── Step 2: paste the message and press Return to send ──────────
            _clipboard_set(message)
            time.sleep(0.15)
            script2 = '''
            tell application "WhatsApp" to activate
            delay 0.3
            tell application "System Events"
                tell process "WhatsApp"
                    keystroke "v" using command down   -- paste message
                    delay 0.6
                    key code 36                        -- Return: send
                end tell
            end tell
            '''
            ok, err = _run_as(script2)
            if ok:
                logger.info(f"WhatsApp desktop: sent to contact '{contact}'")
                return True, contact
            logger.error(f"WhatsApp send_by_contact (step 2) failed: {err}")
            return False, _accessibility_hint(err)
        finally:
            # Restore whatever the user had on the clipboard before
            time.sleep(0.3)
            _clipboard_set(saved_clip)

    def close(self):
        """Quit the WhatsApp app (usually we leave it running)."""
        _run_as('tell application "WhatsApp" to quit')

    # ── Internal ─────────────────────────────────────────────────────────────

    def _ensure_ready(self) -> bool:
        if not self.is_available():
            logger.error("WhatsApp.app is not installed.")
            return False
        return _launch_and_wait()


# Press Return in the frontmost WhatsApp window — used by send_by_phone after
# the deep-link pre-fills the message.
_PRESS_RETURN_SCRIPT = '''
tell application "WhatsApp" to activate
delay 0.3
tell application "System Events"
    tell process "WhatsApp"
        key code 36
    end tell
end tell
'''
