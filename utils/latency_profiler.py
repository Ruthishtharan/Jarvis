"""
Latency profiler for JARVIS — instruments each stage of command processing.

Usage:
    python -c "from utils.latency_profiler import LatencyProfiler; p = LatencyProfiler(); p.start_stage('stt'); ...; p.end_stage('stt'); print(p.report())"

Or wrap it in tests.
"""

import time
from collections import defaultdict
from typing import Dict, List
from utils.logger import get_logger

logger = get_logger(__name__)


class LatencyProfiler:
    """Track latency of each stage in JARVIS pipeline."""

    def __init__(self):
        self.stages: Dict[str, List[float]] = defaultdict(list)  # stage_name → [durations]
        self._current_stage: Dict[str, float] = {}  # stage_name → start_time

    def start_stage(self, stage_name: str):
        """Mark the start of a stage."""
        self._current_stage[stage_name] = time.perf_counter()

    def end_stage(self, stage_name: str) -> float:
        """Mark the end of a stage. Returns duration in ms."""
        if stage_name not in self._current_stage:
            logger.warning(f"end_stage called for '{stage_name}' without start_stage")
            return 0.0

        duration_sec = time.perf_counter() - self._current_stage[stage_name]
        duration_ms = duration_sec * 1000
        self.stages[stage_name].append(duration_ms)
        del self._current_stage[stage_name]
        return duration_ms

    def report(self) -> str:
        """Return a formatted report of latencies."""
        if not self.stages:
            return "No stages recorded."

        lines = ["=" * 70]
        lines.append("JARVIS Latency Report")
        lines.append("=" * 70)

        total_ms = 0
        for stage, durations in sorted(self.stages.items()):
            avg = sum(durations) / len(durations)
            min_d = min(durations)
            max_d = max(durations)
            count = len(durations)
            total_ms += avg  # Add average to total

            lines.append(
                f"{stage:20s} | avg: {avg:7.1f}ms | min: {min_d:7.1f}ms | max: {max_d:7.1f}ms | n={count}"
            )

        lines.append("=" * 70)
        lines.append(f"{'TOTAL (E2E)':20s} | {total_ms:7.1f}ms")
        lines.append("=" * 70)

        return "\n".join(lines)

    def reset(self):
        """Clear all recorded stages."""
        self.stages.clear()
        self._current_stage.clear()


# Global singleton
_profiler: LatencyProfiler | None = None


def get_profiler() -> LatencyProfiler:
    """Get the global profiler instance."""
    global _profiler
    if _profiler is None:
        _profiler = LatencyProfiler()
    return _profiler
