import subprocess
import os
from pathlib import Path
from utils.logger import get_logger

logger = get_logger(__name__)

PLIST_LABEL = "com.jarvis.ai"
LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
PLIST_PATH = LAUNCH_AGENTS_DIR / f"{PLIST_LABEL}.plist"
BASE_DIR = Path(__file__).parent.parent


def _get_python_path() -> str:
    import sys
    return sys.executable


def _build_plist() -> str:
    python = _get_python_path()
    run_script = str(BASE_DIR / "run.py")
    log_out = str(BASE_DIR / "data" / "logs" / "jarvis_stdout.log")
    log_err = str(BASE_DIR / "data" / "logs" / "jarvis_stderr.log")

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{python}</string>
        <string>{run_script}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{log_out}</string>
    <key>StandardErrorPath</key>
    <string>{log_err}</string>
    <key>WorkingDirectory</key>
    <string>{str(BASE_DIR)}</string>
</dict>
</plist>
"""


def install_startup():
    LAUNCH_AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    plist_content = _build_plist()
    PLIST_PATH.write_text(plist_content)

    result = subprocess.run(
        ["launchctl", "load", str(PLIST_PATH)],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        logger.info(f"Jarvis registered as startup service: {PLIST_PATH}")
        return True
    else:
        logger.error(f"launchctl load failed: {result.stderr}")
        return False


def uninstall_startup():
    if PLIST_PATH.exists():
        subprocess.run(["launchctl", "unload", str(PLIST_PATH)], capture_output=True)
        PLIST_PATH.unlink()
        logger.info("Jarvis removed from startup.")
        return True
    logger.warning("No startup service found to remove.")
    return False


def is_startup_installed() -> bool:
    return PLIST_PATH.exists()


def startup_status() -> str:
    result = subprocess.run(
        ["launchctl", "list", PLIST_LABEL],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        return "running"
    return "not loaded"
