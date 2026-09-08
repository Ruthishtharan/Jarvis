import json
from collections import deque
from pathlib import Path
from config import settings
from utils.file_utils import read_json, write_json
from utils.logger import get_logger

logger = get_logger(__name__)


class ConversationMemory:
    # Flush to disk every N appends instead of every single one — a chat turn
    # is 2 appends (user + assistant), so this writes once per ~3 turns.
    _FLUSH_EVERY = 6

    def __init__(self):
        self.max_messages = settings.MAX_CONVERSATION_HISTORY
        self._messages: deque = deque(maxlen=self.max_messages)
        self._dirty_count = 0
        self._load()

    def add(self, role: str, content: str):
        self._messages.append({"role": role, "content": content})
        self._dirty_count += 1
        if self._dirty_count >= self._FLUSH_EVERY:
            self._save()
            self._dirty_count = 0

    def flush(self):
        """Force a save — call on shutdown so we don't lose recent turns."""
        if self._dirty_count:
            self._save()
            self._dirty_count = 0

    def get_history(self) -> list[dict]:
        return list(self._messages)

    def clear(self):
        self._messages.clear()
        self._dirty_count = 0
        self._save()

    def _load(self):
        try:
            data = read_json(settings.MEMORY_FILE)
            messages = data.get("messages", []) if isinstance(data, dict) else []
            for msg in messages[-self.max_messages:]:
                self._messages.append(msg)
            logger.debug(f"Loaded {len(self._messages)} messages from memory.")
        except Exception as e:
            logger.warning(f"Could not load conversation memory: {e}")

    def _save(self):
        try:
            write_json(settings.MEMORY_FILE, {"messages": list(self._messages)})
        except Exception as e:
            logger.warning(f"Could not save conversation memory: {e}")
