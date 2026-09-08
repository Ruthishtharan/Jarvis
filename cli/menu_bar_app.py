"""
JARVIS Menu Bar App — Toggle JARVIS on/off from the macOS status bar.

This creates a native macOS status bar app that lets you:
- See JARVIS status (🟢 On / 🔴 Off)
- Toggle JARVIS on/off with one click
- Restart JARVIS
- Quit JARVIS

Installation:
    python -m pip install pyobjc-framework-Cocoa pyobjc-framework-AppKit

Usage:
    python cli/(C) menu_bar_app.py

The menu bar icon will appear in the top-right corner of your screen.
"""

import asyncio
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path

try:
    from AppKit import NSApp, NSStatusBar, NSMenu, NSMenuItem, NSVariableStatusItemLength
    from Foundation import NSObject, NSString
except ImportError:
    print("ERROR: PyObjC not installed. Run:")
    print("  pip install pyobjc-framework-Cocoa pyobjc-framework-AppKit")
    sys.exit(1)

from utils.logger import get_logger

logger = get_logger("jarvis.menu_bar")

# JARVIS daemon process
JARVIS_RUN = Path(__file__).parent.parent / "run.py"


class JARVISMenuBar(NSObject):
    """Native macOS menu bar application for JARVIS control."""

    def init(self):
        self = super(JARVISMenuBar, self).init()
        self.status_item = None
        self.jarvis_process = None
        self.is_running = False
        return self

    def setup(self):
        """Initialize the menu bar item."""
        status_bar = NSStatusBar.systemStatusBar()
        self.status_item = status_bar.statusItemWithLength_(NSVariableStatusItemLength)

        # Create menu
        menu = NSMenu.alloc().init()

        # Status item
        self.update_status_display()

        # Menu items
        start_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Start JARVIS", "startJARVIS:", ""
        )
        start_item.setTarget_(self)
        menu.addItem_(start_item)

        stop_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Stop JARVIS", "stopJARVIS:", ""
        )
        stop_item.setTarget_(self)
        menu.addItem_(stop_item)

        menu.addItem_(NSMenuItem.separatorItem())

        restart_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Restart JARVIS", "restartJARVIS:", ""
        )
        restart_item.setTarget_(self)
        menu.addItem_(restart_item)

        menu.addItem_(NSMenuItem.separatorItem())

        open_logs_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "View Logs", "openLogs:", ""
        )
        open_logs_item.setTarget_(self)
        menu.addItem_(open_logs_item)

        menu.addItem_(NSMenuItem.separatorItem())

        quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
            "Quit JARVIS", "quitApp:", ""
        )
        quit_item.setTarget_(self)
        menu.addItem_(quit_item)

        self.status_item.setMenu_(menu)
        logger.info("Menu bar app initialized")

    def update_status_display(self):
        """Update the menu bar icon and title."""
        if self.is_running:
            title = "🟢 JARVIS"
            self.status_item.setTitle_(title)
        else:
            title = "🔴 JARVIS"
            self.status_item.setTitle_(title)

    def startJARVIS_(self, _):
        """Start JARVIS."""
        if self.is_running:
            logger.info("JARVIS is already running")
            return

        logger.info("Starting JARVIS...")
        try:
            # Start JARVIS in background
            self.jarvis_process = subprocess.Popen(
                ["/usr/bin/python3", str(JARVIS_RUN)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.is_running = True
            self.update_status_display()
            logger.info(f"✓ JARVIS started (PID: {self.jarvis_process.pid})")
        except Exception as e:
            logger.error(f"✗ Failed to start JARVIS: {e}")

    def stopJARVIS_(self, _):
        """Stop JARVIS."""
        if not self.is_running or not self.jarvis_process:
            logger.info("JARVIS is not running")
            return

        logger.info("Stopping JARVIS...")
        try:
            self.jarvis_process.terminate()
            self.jarvis_process.wait(timeout=5)
            self.is_running = False
            self.update_status_display()
            logger.info("✓ JARVIS stopped")
        except subprocess.TimeoutExpired:
            self.jarvis_process.kill()
            self.is_running = False
            self.update_status_display()
            logger.info("✓ JARVIS killed (force)")
        except Exception as e:
            logger.error(f"✗ Failed to stop JARVIS: {e}")

    def restartJARVIS_(self, _):
        """Restart JARVIS."""
        self.stopJARVIS_(None)
        import time
        time.sleep(1)
        self.startJARVIS_(None)

    def openLogs_(self, _):
        """Open JARVIS logs in default app."""
        log_dir = Path(__file__).parent.parent / "data" / "logs"
        if log_dir.exists():
            subprocess.run(["open", str(log_dir)])
            logger.info(f"Opened logs: {log_dir}")

    def quitApp_(self, _):
        """Quit the menu bar app (stops JARVIS too)."""
        logger.info("Quitting...")
        self.stopJARVIS_(None)
        NSApp.terminate_(self)


def main():
    """Entry point."""
    logger.info("=" * 60)
    logger.info("JARVIS Menu Bar App")
    logger.info("=" * 60)

    app = NSApp.sharedApplication()

    # Create and setup menu bar item
    menu_bar = JARVISMenuBar.alloc().init()
    menu_bar.setup()

    # Auto-start JARVIS when menu bar app launches
    logger.info("Auto-starting JARVIS...")
    menu_bar.startJARVIS_(None)

    # Run the app
    logger.info("Menu bar app running (press Ctrl+C to quit)")
    logger.info("Look for 🟢/🔴 JARVIS icon in top-right corner of screen")
    app.run()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Menu bar app stopped by user")
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        sys.exit(1)
