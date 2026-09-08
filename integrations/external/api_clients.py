import requests
from utils.logger import get_logger

logger = get_logger(__name__)


def get_weather(city: str, api_key: str) -> dict:
    try:
        url = f"http://api.openweathermap.org/data/2.5/weather"
        params = {"q": city, "appid": api_key, "units": "metric"}
        resp = requests.get(url, params=params, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return {
            "city": data["name"],
            "temp": data["main"]["temp"],
            "description": data["weather"][0]["description"],
            "humidity": data["main"]["humidity"]
        }
    except Exception as e:
        logger.error(f"Weather API error: {e}")
        return {}


def get_public_ip() -> str:
    try:
        resp = requests.get("https://api.ipify.org", timeout=5)
        return resp.text.strip()
    except Exception:
        return "unknown"
