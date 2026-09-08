import difflib
from utils.file_utils import read_json, write_json
from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


class ContactResolver:
    def __init__(self):
        self._cache: dict[str, str] = {}
        self._load_cache()

    def resolve(self, name: str) -> str:
        name = name.strip()
        if not self._cache:
            return name

        lower_map = {k.lower(): v for k, v in self._cache.items()}
        if name.lower() in lower_map:
            return lower_map[name.lower()]

        matches = difflib.get_close_matches(name.lower(), lower_map.keys(), n=1, cutoff=0.6)
        if matches:
            resolved = lower_map[matches[0]]
            logger.debug(f"Resolved '{name}' -> '{resolved}'")
            return resolved

        return name

    def add_contact(self, display_name: str, whatsapp_name: str):
        self._cache[display_name] = whatsapp_name
        self._save_cache()

    def _load_cache(self):
        try:
            data = read_json(settings.CONTACTS_CACHE)
            if isinstance(data, dict):
                self._cache = data
        except Exception:
            self._cache = {}

    def _save_cache(self):
        try:
            write_json(settings.CONTACTS_CACHE, self._cache)
        except Exception as e:
            logger.warning(f"Could not save contacts cache: {e}")
