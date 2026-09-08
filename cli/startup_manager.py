"""
macOS Startup Manager — Register JARVIS to launch on system boot.

This creates a LaunchAgent plist that tells macOS to start JARVIS automatically
when the user logs in.

Usage:
    python cli/(C) startup_manager.py --enable
    python cli/(C) startup_manager.py --disable
    python cli/(C) startup_manager.py --status
"""

import os
import subprocess
import sys
from pathlib import Path
from utils.logger import get_logger

logger = get_logger(__name__)

LAUNCH_AGENT_LABEL = "com.jarvis.ai"
LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"
PLIST_FILE = LAUNCH_AGENTS_DIR / f"{LAUNCH_AGENT_LABEL}.plist"

# Path to JARVIS project
JARVIS_PROJECT = Path(__file__).parent.parent
JARVIS_RUN = JARVIS_PROJECT / "run.py"
JARVIS_LOG = JARVIS_PROJECT / "data" / "logs" / "startup.log"
JARVIS_ERR = JARVIS_PROJECT / "data" / "logs" / "error.log"

# Ensure log directory exists
JARVIS_LOG.parent.mkdir(parents=True, exist_ok=True)


PLIST_CONTENT = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>{JARVIS_RUN}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{JARVIS_LOG}</string>
    <key>StandardErrorPath</key>
    <string>{JARVIS_ERR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>'''


class StartupManager:
    """Manage JARVIS startup on macOS."""

    @staticmethod
    def enable():
        """Enable JARVIS to launch on startup."""
        logger.info("Enabling JARVIS startup on login...")

        # Create LaunchAgents directory if it doesn't exist
        LAUNCH_AGENTS_DIR.mkdir(parents=True, exist_ok=True)

        # Write plist file
        try:
            with open(PLIST_FILE, "w") as f:
                f.write(PLIST_CONTENT)
            logger.info(f"✓ Created plist: {PLIST_FILE}")
        except Exception as e:
            logger.error(f"✗ Failed to write plist: {e}")
            return False

        # Load the launch agent
        try:
            subprocess.run(
                ["launchctl", "load", str(PLIST_FILE)],
                check=True,
                capture_output=True,
            )
            logger.info("✓ Registered with launchctl")
            logger.info("🚀 JARVIS will now launch on next login!")
            return True
        except subprocess.CalledProcessError as e:
            # Might already be loaded
            if "already loaded" in e.stderr.decode():
                logger.info("✓ JARVIS already registered (already loaded)")
                return True
            logger.error(f"✗ Failed to load launch agent: {e}")
            return False

    @staticmethod
    def disable():
        """Disable JARVIS startup on login."""
        logger.info("Disabling JARVIS startup on login...")

        if not PLIST_FILE.exists():
            logger.info("✓ JARVIS startup not enabled")
            return True

        # Unload the launch agent
        try:
            subprocess.run(
                ["launchctl", "unload", str(PLIST_FILE)],
                check=True,
                capture_output=True,
            )
            logger.info("✓ Unregistered from launchctl")
        except subprocess.CalledProcessError as e:
            if "not loaded" in e.stderr.decode():
                logger.info("✓ JARVIS not currently loaded")
            else:
                logger.error(f"✗ Failed to unload: {e}")

        # Remove plist
        try:
            PLIST_FILE.unlink()
            logger.info(f"✓ Removed plist: {PLIST_FILE}")
            logger.info("🛑 JARVIS will NOT launch on next login")
            return True
        except Exception as e:
            logger.error(f"✗ Failed to remove plist: {e}")
            return False

    @staticmethod
    def status():
        """Check if JARVIS startup is enabled."""
        if not PLIST_FILE.exists():
            logger.info("❌ JARVIS startup is DISABLED")
            return False

        # Check if loaded
        try:
            result = subprocess.run(
                ["launchctl", "list"],
                capture_output=True,
                text=True,
            )
            if LAUNCH_AGENT_LABEL in result.stdout:
                logger.info("✅ JARVIS startup is ENABLED (will launch on login)")
                logger.info(f"   Plist: {PLIST_FILE}")
                logger.info(f"   Logs: {JARVIS_LOG}")
                return True
            else:
                logger.info("⚠️  Plist exists but not loaded (run enable again)")
                return False
        except Exception as e:
            logger.error(f"Failed to check status: {e}")
            return False


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print("Usage: python (C) startup_manager.py [--enable|--disable|--status]")
        print()
        print("Options:")
        print("  --enable   Launch JARVIS on system startup (macOS login)")
        print("  --disable  Don't launch JARVIS on startup")
        print("  --status   Check if startup is enabled")
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "--enable":
        success = StartupManager.enable()
        sys.exit(0 if success else 1)
    elif command == "--disable":
        success = StartupManager.disable()
        sys.exit(0 if success else 1)
    elif command == "--status":
        success = StartupManager.status()
        sys.exit(0 if success else 1)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
