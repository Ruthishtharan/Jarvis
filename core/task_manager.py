import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class TaskRecord:
    task_id: str
    name: str
    status: str
    created_at: datetime = field(default_factory=datetime.now)
    result: Any = None
    error: str | None = None


class TaskManager:
    def __init__(self):
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = threading.Lock()
        self._counter = 0

    def create_task(self, name: str) -> str:
        with self._lock:
            self._counter += 1
            task_id = f"task_{self._counter}"
            self._tasks[task_id] = TaskRecord(
                task_id=task_id, name=name, status="pending"
            )
        logger.debug(f"Created task {task_id}: {name}")
        return task_id

    def start_task(self, task_id: str):
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "running"

    def complete_task(self, task_id: str, result: Any = None):
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "completed"
                self._tasks[task_id].result = result

    def fail_task(self, task_id: str, error: str):
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].status = "failed"
                self._tasks[task_id].error = error
                logger.warning(f"Task {task_id} failed: {error}")

    def get_task(self, task_id: str) -> TaskRecord | None:
        return self._tasks.get(task_id)

    def active_tasks(self) -> list[TaskRecord]:
        return [t for t in self._tasks.values() if t.status == "running"]

    def cleanup_old(self, keep_last: int = 50):
        with self._lock:
            completed = [t for t in self._tasks.values() if t.status in ("completed", "failed")]
            completed.sort(key=lambda t: t.created_at, reverse=True)
            to_remove = completed[keep_last:]
            for task in to_remove:
                del self._tasks[task.task_id]
