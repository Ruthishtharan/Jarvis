import subprocess
import platform
from utils.logger import get_logger

logger = get_logger(__name__)


def is_macos() -> bool:
    return platform.system() == "Darwin"


def run_applescript(script: str, timeout: int = 12) -> tuple[bool, str]:
    """Run AppleScript with a bounded wait.

    Without a timeout this can block forever — osascript waits on the
    Automation permission dialog and hangs on unresponsive target apps.
    These calls run on a shared 4-worker thread pool, so an untimed hang
    permanently consumes a worker.
    """
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        logger.warning(f"AppleScript timed out after {timeout}s")
        return False, "timed out"
    except Exception as e:
        logger.error(f"AppleScript failed to launch: {e}")
        return False, str(e)

    if result.returncode != 0:
        logger.debug(f"AppleScript error: {result.stderr.strip()}")
        return False, result.stderr.strip()
    return True, result.stdout.strip()


def run_shell(cmd: list[str], timeout: int = 10) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        return result.returncode == 0, result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, str(e)


def get_mac_username() -> str:
    ok, out = run_shell(["whoami"])
    return out if ok else "user"


def get_battery_info() -> dict:
    ok, out = run_shell(["pmset", "-g", "batt"])
    if not ok:
        return {"percent": "unknown", "charging": False}
    import re
    pct = re.search(r"(\d+)%", out)
    charging = "charging" in out.lower() or "AC Power" in out
    return {
        "percent": pct.group(1) + "%" if pct else "unknown",
        "charging": charging
    }


def get_wifi_name() -> str:
    ok, out = run_shell([
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport",
        "-I"
    ])
    if ok:
        import re
        match = re.search(r"SSID: (.+)", out)
        if match:
            return match.group(1).strip()
    ok2, out2 = run_shell(["networksetup", "-getairportnetwork", "en0"])
    if ok2 and "Current Wi-Fi Network:" in out2:
        return out2.replace("Current Wi-Fi Network:", "").strip()
    return "Not connected"
