from collections import deque
from datetime import datetime
from utils.logger import get_logger

logger = get_logger(__name__)


class ContextManager:
    def __init__(self, max_turns: int = 10):
        self._turns: deque = deque(maxlen=max_turns)
        self._current_intent: str | None = None
        self._current_entities: dict = {}
        self._last_activity: datetime = datetime.now()
        self._session_data: dict = {}

    def add_turn(self, user_text: str, intent: str, response: str):
        self._turns.append({
            "user": user_text,
            "intent": intent,
            "response": response,
            "timestamp": datetime.now().isoformat()
        })
        self._current_intent = intent
        self._last_activity = datetime.now()

    def set_entities(self, entities: dict):
        self._current_entities = entities

    def get_entities(self) -> dict:
        return self._current_entities

    def get_last_intent(self) -> str | None:
        return self._current_intent

    def get_recent_turns(self, n: int = 3) -> list[dict]:
        return list(self._turns)[-n:]

    def set_session(self, key: str, value):
        self._session_data[key] = value

    def get_session(self, key: str, default=None):
        return self._session_data.get(key, default)

    def is_idle(self, timeout_seconds: float = 300) -> bool:
        elapsed = (datetime.now() - self._last_activity).total_seconds()
        return elapsed > timeout_seconds

    def clear(self):
        self._turns.clear()
        self._current_intent = None
        self._current_entities = {}
        self._session_data = {}
        self._last_activity = datetime.now()
