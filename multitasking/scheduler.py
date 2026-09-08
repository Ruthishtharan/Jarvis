import asyncio
import threading
import time
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Callable
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class ScheduledTask:
    name: str
    callback: Callable
    run_at: datetime
    args: tuple = ()
    fired: bool = False


class Scheduler:
    def __init__(self):
        self._tasks: list[ScheduledTask] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("Scheduler started.")

    def stop(self):
        self._running = False

    def schedule_in(self, name: str, callback: Callable, seconds: float, *args):
        run_at = datetime.now() + timedelta(seconds=seconds)
        task = ScheduledTask(name=name, callback=callback, run_at=run_at, args=args)
        with self._lock:
            self._tasks.append(task)
        logger.info(f"Scheduled '{name}' in {seconds:.0f}s")

    def schedule_at(self, name: str, callback: Callable, run_at: datetime, *args):
        task = ScheduledTask(name=name, callback=callback, run_at=run_at, args=args)
        with self._lock:
            self._tasks.append(task)
        logger.info(f"Scheduled '{name}' at {run_at}")

    def _run_loop(self):
        while self._running:
            now = datetime.now()
            with self._lock:
                due = [t for t in self._tasks if not t.fired and t.run_at <= now]
                for task in due:
                    task.fired = True
                    threading.Thread(
                        target=self._fire, args=(task,), daemon=True
                    ).start()
                self._tasks = [t for t in self._tasks if not t.fired]
            time.sleep(0.5)

    def _fire(self, task: ScheduledTask):
        try:
            logger.info(f"Firing scheduled task: {task.name}")
            task.callback(*task.args)
        except Exception as e:
            logger.error(f"Scheduled task '{task.name}' failed: {e}")
