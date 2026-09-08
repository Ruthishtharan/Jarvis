from datetime import datetime
from utils.helpers import get_current_time, get_current_date, clean_for_speech
from utils.logger import get_logger

logger = get_logger(__name__)


class ResponseGenerator:
    """Generates natural, conversational responses that sound human rather than robotic."""

    def action_success(self, action: str, detail: str = "") -> str:
        if detail:
            return f"All done — {action}. {detail}"
        return f"All done. {action}"

    def action_failed(self, action: str, reason: str = "") -> str:
        if reason:
            return f"Hmm, I couldn't {action}. {reason}"
        return f"Hmm, I couldn't {action}."

    def app_opened(self, app_name: str) -> str:
        return f"Sure thing, opening {app_name}."

    def app_closed(self, app_name: str) -> str:
        return f"{app_name} is closed."

    def app_not_found(self, app_name: str) -> str:
        return f"I'm not seeing {app_name} on your Mac. Might need to install it first."

    def whatsapp_sent(self, contact: str) -> str:
        return f"Done — message's on its way to {contact}."

    def whatsapp_failed(self, contact: str, reason: str = "") -> str:
        if reason:
            return f"Having trouble reaching {contact}. {reason}"
        return f"Couldn't send to {contact}. Might be a connection issue."

    def search_results(self, query: str, results: list[str]) -> str:
        if not results:
            return f"Nothing matching '{query}' on your Mac."
        count = len(results)
        first = results[0].split("/")[-1]
        if count == 1:
            return f"Found it: {first}"
        return f"Found {count} things. Best match is {first}."

    def web_search_done(self, query: str) -> str:
        return f"Got it — searching for '{query}'."

    def time_response(self) -> str:
        return f"It's {get_current_time()} right now."

    def date_response(self) -> str:
        return f"Today is {get_current_date()}."

    def volume_set(self, level: int) -> str:
        return f"Volume's at {level}."

    def screenshot_taken(self, path: str = "") -> str:
        if path:
            return f"Screenshot saved."
        return "Got your screenshot."

    def battery_response(self, percent: str, charging: bool) -> str:
        if charging:
            return f"You're at {percent} and charging."
        return f"Battery's at {percent}."

    def wifi_response(self, network: str) -> str:
        if network == "Not connected":
            return "You're not connected to WiFi right now."
        return f"You're on {network}."

    def goodbye(self) -> str:
        return "Alright, shutting down. Catch you later."

    def greeting(self) -> str:
        hour = datetime.now().hour
        if hour < 12:
            period = "morning"
        elif hour < 17:
            period = "afternoon"
        else:
            period = "evening"
        return f"Good {period}. I'm here and ready."
