#!/usr/bin/env python3
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.assistant import JarvisAssistant
from core.single_instance import AlreadyRunning, acquire, release
from utils.logger import get_logger

logger = get_logger("jarvis.main")


def main():
    logger.info("=" * 50)
    logger.info("Starting Jarvis AI Assistant")
    logger.info("=" * 50)

    # Refuse to start a second copy. Two instances fight over the microphone
    # and both speak, which looks like Jarvis talking after being shut down.
    try:
        acquire()
    except AlreadyRunning as e:
        logger.error(
            f"Jarvis is already running (pid {e.pid}). "
            f"Stop it first:  kill {e.pid}    or:  python3 stop.py"
        )
        sys.exit(1)

    jarvis = JarvisAssistant()

    try:
        asyncio.run(jarvis.start())
    except KeyboardInterrupt:
        logger.info("Jarvis stopped by user.")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        release()


if __name__ == "__main__":
    main()
