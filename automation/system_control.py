import subprocess
from integrations.macos.apple_script import (
    set_volume, get_volume, mute_volume, unmute_volume,
    take_screenshot, lock_screen, empty_trash
)
from utils.os_utils import get_battery_info, get_wifi_name
from utils.logger import get_logger

logger = get_logger(__name__)


def change_volume(level: int | None = None, action: str | None = None) -> tuple[bool, str]:
    if action:
        action = action.lower()
        if action in ("mute", "silence"):
            ok, _ = mute_volume()
            return ok, "muted"
        if action in ("unmute", "unsilence"):
            ok, _ = unmute_volume()
            return ok, "unmuted"
        current = get_volume()
        if current < 0:
            current = 50
        if action == "up":
            level = min(100, current + 20)
        elif action == "down":
            level = max(0, current - 20)

    if level is not None:
        ok, _ = set_volume(level)
        return ok, str(level)

    return False, "unknown action"


def mute_audio() -> bool:
    ok, _ = mute_volume()
    return ok


def unmute_audio() -> bool:
    ok, _ = unmute_volume()
    return ok


def set_brightness(level: int | None = None, action: str | None = None) -> tuple[bool, str]:
    try:
        if action:
            action = action.lower()
            if action == "up":
                subprocess.run(
                    ["osascript", "-e", 'tell application "System Events" to key code 144'],
                    capture_output=True
                )
                return True, "increased"
            elif action == "down":
                subprocess.run(
                    ["osascript", "-e", 'tell application "System Events" to key code 145'],
                    capture_output=True
                )
                return True, "decreased"

        if level is not None:
            normalized = level / 100.0
            script = f"set brightness of screen 0 to {normalized}"
            result = subprocess.run(
                ["osascript", "-e", script], capture_output=True
            )
            return result.returncode == 0, str(level)
    except Exception as e:
        logger.error(f"Brightness control error: {e}")
    return False, "failed"


def capture_screenshot(path: str | None = None) -> tuple[bool, str]:
    import os
    from datetime import datetime
    if not path:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = os.path.expanduser(f"~/Desktop/jarvis_screenshot_{timestamp}.png")
    ok, saved_path = take_screenshot(path)
    return ok, saved_path


def lock_mac() -> bool:
    ok, _ = lock_screen()
    return ok


def clear_trash() -> bool:
    ok, _ = empty_trash()
    return ok


def shutdown_mac():
    subprocess.run(["osascript", "-e", 'tell app "System Events" to shut down'])


def restart_mac():
    subprocess.run(["osascript", "-e", 'tell app "System Events" to restart'])


def get_battery() -> dict:
    return get_battery_info()


def get_wifi() -> str:
    return get_wifi_name()
