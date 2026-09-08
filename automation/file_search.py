import subprocess
import os
from integrations.macos.spotlight_search import search, search_content
from utils.logger import get_logger

logger = get_logger(__name__)


def search_local(query: str, limit: int = 10) -> list[str]:
    logger.info(f"Searching locally for: {query}")
    results = search(query, limit)
    if not results:
        results = search_content(query, limit)
    return results


def open_file(path: str) -> bool:
    try:
        result = subprocess.run(["open", path], capture_output=True)
        return result.returncode == 0
    except Exception as e:
        logger.error(f"Failed to open file: {e}")
        return False


def open_folder(path: str) -> bool:
    try:
        result = subprocess.run(["open", path], capture_output=True)
        return result.returncode == 0
    except Exception as e:
        logger.error(f"Failed to open folder: {e}")
        return False


def reveal_in_finder(path: str) -> bool:
    try:
        result = subprocess.run(["open", "-R", path], capture_output=True)
        return result.returncode == 0
    except Exception as e:
        logger.error(f"Failed to reveal in Finder: {e}")
        return False


def search_and_open_first(query: str) -> tuple[bool, str]:
    results = search_local(query, limit=5)
    if results:
        path = results[0]
        ok = open_file(path)
        return ok, path
    return False, ""
