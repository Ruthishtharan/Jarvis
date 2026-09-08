import subprocess
from utils.logger import get_logger

logger = get_logger(__name__)


def search(query: str, limit: int = 10) -> list[str]:
    try:
        result = subprocess.run(
            ["mdfind", "-name", query],
            capture_output=True, text=True, timeout=5
        )
        lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
        return lines[:limit]
    except subprocess.TimeoutExpired:
        logger.warning("Spotlight search timed out")
        return []
    except Exception as e:
        logger.error(f"Spotlight search error: {e}")
        return []


def search_content(query: str, limit: int = 10) -> list[str]:
    try:
        result = subprocess.run(
            ["mdfind", query],
            capture_output=True, text=True, timeout=5
        )
        lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
        return lines[:limit]
    except Exception as e:
        logger.error(f"Spotlight content search error: {e}")
        return []


def open_spotlight(query: str = ""):
    import subprocess
    script = 'tell application "System Events" to keystroke space using {command down}'
    subprocess.run(["osascript", "-e", script])
    if query:
        import time
        time.sleep(0.5)
        script2 = f'tell application "System Events" to keystroke "{query}"'
        subprocess.run(["osascript", "-e", script2])


def find_app_path(app_name: str) -> str | None:
    candidates = [
        f"/Applications/{app_name}.app",
        f"/Applications/{app_name.title()}.app",
        f"/System/Applications/{app_name}.app",
    ]
    import os
    for path in candidates:
        if os.path.exists(path):
            return path

    results = search(app_name)
    for r in results:
        if r.endswith(".app"):
            return r
    return None
