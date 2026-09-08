import subprocess
from utils.logger import get_logger

logger = get_logger(__name__)


def check_accessibility_permission() -> bool:
    script = 'tell application "System Events" to return UI elements enabled'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    return "true" in result.stdout.lower()


def request_accessibility_permission():
    logger.warning("Accessibility permission required. Opening System Preferences...")
    subprocess.run([
        "open",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    ])


def check_all_permissions() -> dict:
    return {
        "microphone": True,
        "accessibility": check_accessibility_permission(),
        "automation": True,
    }


def ensure_permissions():
    perms = check_all_permissions()
    if not perms.get("accessibility"):
        request_accessibility_permission()
        logger.warning(
            "Grant Accessibility permission to Terminal/Python in "
            "System Preferences > Privacy & Security > Accessibility, then restart Jarvis."
        )
