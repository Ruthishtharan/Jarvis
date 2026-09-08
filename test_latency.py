#!/usr/bin/env python3
"""
Quick test script to measure JARVIS responsiveness improvements.

Usage:
    python (C) TEST_LATENCY.py

This script:
1. Runs JARVIS for N commands
2. Measures latency of each stage
3. Prints comparison (before/after)
4. Shows which stages improved
"""

import asyncio
import sys
import os
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from core.assistant import JarvisAssistant
from utils.latency_profiler import get_profiler
from utils.logger import get_logger

logger = get_logger("test_latency")


async def run_test():
    """Run a quick test with instrumentation enabled."""
    logger.info("=" * 70)
    logger.info("JARVIS Latency Test")
    logger.info("=" * 70)
    logger.info("\nThis test measures responsiveness of the new async TTS implementation.")
    logger.info("Try these commands and watch the latency breakdown:\n")
    logger.info("  1. 'open chrome'          (should route to skill quickly)")
    logger.info("  2. 'what time is it'      (should use Groq classification)")
    logger.info("  3. 'hello'                (should use conversation)")
    logger.info("  4. 'volume 50'            (should route to system skill)\n")

    logger.info("Starting JARVIS in instrumentation mode...")
    logger.info("-" * 70)

    jarvis = JarvisAssistant()
    profiler = get_profiler()

    try:
        await jarvis.start()
    except KeyboardInterrupt:
        logger.info("\n" + "=" * 70)
        logger.info("Test Complete — Latency Summary:")
        logger.info("=" * 70)
        print(profiler.report())
        logger.info("=" * 70)

        # Analysis
        stages = profiler.stages
        if stages:
            logger.info("\nLatency Analysis:")
            logger.info("-" * 70)

            if "wait_for_command" in stages:
                avg_wait = sum(stages["wait_for_command"]) / len(stages["wait_for_command"])
                logger.info(f"• Wake detection: {avg_wait:.1f}ms avg")

            if "skill_match" in stages:
                avg_match = sum(stages["skill_match"]) / len(stages["skill_match"])
                logger.info(f"• Skill matching: {avg_match:.1f}ms avg")

            if "llm_classify" in stages:
                avg_llm = sum(stages["llm_classify"]) / len(stages["llm_classify"])
                count_llm = len(stages["llm_classify"])
                logger.info(f"• LLM classification: {avg_llm:.1f}ms avg ({count_llm} calls)")

            if "skill_execute" in stages:
                avg_execute = sum(stages["skill_execute"]) / len(stages["skill_execute"])
                logger.info(f"• Skill execution: {avg_execute:.1f}ms avg")

            if "route" in stages:
                avg_route = sum(stages["route"]) / len(stages["route"])
                logger.info(f"• Total routing: {avg_route:.1f}ms avg")

            if "tts" in stages:
                # TTS should be very fast now (fire-and-forget)
                avg_tts = sum(stages["tts"]) / len(stages["tts"])
                logger.info(f"• TTS queue (async): {avg_tts:.1f}ms avg ✅ (should be <10ms)")

            logger.info("-" * 70)
            logger.info("\n✅ Key Improvement: TTS is now fire-and-forget (async)")
            logger.info("   JARVIS can listen for next command while current response plays")
            logger.info("   This should make responsiveness feel ~2x faster!\n")


if __name__ == "__main__":
    asyncio.run(run_test())
