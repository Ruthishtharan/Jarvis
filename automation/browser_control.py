import subprocess
import urllib.parse
from utils.logger import get_logger

logger = get_logger(__name__)


def open_url(url: str, browser: str = "default") -> bool:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        # `open` exits non-zero for a malformed URL or missing browser, but
        # the return code was previously ignored — so the caller was told the
        # page opened whenever the subprocess merely launched.
        if browser == "chrome":
            cmd = ["open", "-a", "Google Chrome", url]
        elif browser == "safari":
            cmd = ["open", "-a", "Safari", url]
        elif browser == "firefox":
            cmd = ["open", "-a", "Firefox", url]
        else:
            cmd = ["open", url]

        result = subprocess.run(cmd, capture_output=True, timeout=15)
        if result.returncode != 0:
            logger.warning(
                f"open failed for {url}: {result.stderr.decode(errors='replace')[:120]}"
            )
            return False
        logger.info(f"Opened URL: {url}")
        return True
    except Exception as e:
        logger.error(f"Failed to open URL: {e}")
        return False


def search_in_browser(query: str, engine: str = "google") -> bool:
    from integrations.external.web_search import open_web_search
    return open_web_search(query, engine)


def open_new_tab(url: str = ""):
    script = f'''
    tell application "Google Chrome"
        activate
        tell front window
            make new tab with properties {{URL:"{url or 'about:newtab'}"}}
        end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", script], capture_output=True)
