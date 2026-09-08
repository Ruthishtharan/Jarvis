import asyncio
from dataclasses import dataclass, field
from typing import Callable, Any
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass(order=True)
class Task:
    priority: int
    name: str = field(compare=False)
    coro: Any = field(compare=False)


class QueueManager:
    def __init__(self, max_concurrent: int = 3):
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._running: set[asyncio.Task] = set()
        self._max_concurrent = max_concurrent
        self._semaphore: asyncio.Semaphore | None = None

    async def start(self):
        self._semaphore = asyncio.Semaphore(self._max_concurrent)
        asyncio.create_task(self._process_loop())

    async def enqueue(self, name: str, coro, priority: int = 5):
        task = Task(priority=priority, name=name, coro=coro)
        await self._queue.put(task)
        logger.debug(f"Queued task: {name} (priority {priority})")

    async def _process_loop(self):
        while True:
            task = await self._queue.get()
            asyncio.create_task(self._run_task(task))

    async def _run_task(self, task: Task):
        async with self._semaphore:
            logger.debug(f"Running task: {task.name}")
            try:
                await task.coro
            except Exception as e:
                logger.error(f"Task '{task.name}' failed: {e}")
            finally:
                self._queue.task_done()

    def pending_count(self) -> int:
        return self._queue.qsize()
