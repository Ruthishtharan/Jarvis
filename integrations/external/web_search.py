import subprocess
import urllib.parse
from utils.logger import get_logger

logger = get_logger(__name__)


def open_web_search(query: str, engine: str = "google"):
    engines = {
        "google": "https://www.google.com/search?q=",
        "duckduckgo": "https://duckduckgo.com/?q=",
        "bing": "https://www.bing.com/search?q=",
    }
    base = engines.get(engine.lower(), engines["google"])
    url = base + urllib.parse.quote_plus(query)
    try:
        subprocess.run(["open", url])
        logger.info(f"Opened web search: {query}")
        return True
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return False


def quick_search_results(query: str) -> list[str]:
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
            return [r.get("title", "") + ": " + r.get("href", "") for r in results]
    except ImportError:
        logger.debug("duckduckgo_search not installed, opening browser instead.")
        return []
    except Exception as e:
        logger.warning(f"Quick search failed: {e}")
        return []
