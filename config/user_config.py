"""
User Configuration System — Customize JARVIS without touching code.

This loads user settings from ~/.jarvis/config.json

Example config.json:
{
    "voice": "Samantha",
    "tts_rate": 160,
    "wake_word": "jarvis",
    "auto_start": true,
    "skills": {
        "web_search": true,
        "coding_assistant": true,
        "conversation": true
    }
}

Usage:
    config = UserConfig()
    voice = config.get("voice", "Samantha")  # Returns "Samantha" or value from config
"""

import json
from pathlib import Path
from typing import Any, Optional

from utils.logger import get_logger

logger = get_logger(__name__)


class UserConfig:
    """Manage user configuration."""

    CONFIG_DIR = Path.home() / ".jarvis"
    CONFIG_FILE = CONFIG_DIR / "config.json"

    # Default configuration
    DEFAULTS = {
        "voice": "Samantha",
        "tts_rate": 160,
        "wake_word": "jarvis",
        "auto_start": True,
        "timezone": "Asia/Kolkata",
        "user_name": "Boss",
        "theme": "dark",
        # Seconds after Jarvis stops speaking during which a follow-up needs
        # no wake word. 0 disables the conversation window entirely.
        "followup_window_sec": 8,
        # Interrupting Jarvis mid-sentence.
        #   "off"  — never listen while the speakers are playing
        #   "wake" — interrupt on the wake word or a stop phrase (default)
        #   "any"  — any speech interrupts (closest to the films, riskiest)
        "bargein_mode": "wake",
        "skills": {
            "web_search": True,
            "coding_assistant": True,
            "conversation": True,
            "system_control": True,
            "music": True,
            "news": False,  # Coming in V2
            "weather": False,  # Coming in V2
        },
        "api": {
            "groq_enabled": True,
            "web_search_enabled": True,
        },
    }

    def __init__(self):
        """Initialize config system."""
        self.config = self.DEFAULTS.copy()
        self.load()

    def load(self):
        """Load configuration from file."""
        if not self.CONFIG_FILE.exists():
            logger.info(f"No config found at {self.CONFIG_FILE}, using defaults")
            self.save()  # Create default config file
            return

        try:
            with open(self.CONFIG_FILE, "r") as f:
                user_config = json.load(f)
            self.config.update(user_config)
            logger.info(f"Loaded config from {self.CONFIG_FILE}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid config JSON: {e}, using defaults")
            self.save()
        except Exception as e:
            logger.error(f"Failed to load config: {e}, using defaults")

    def save(self):
        """Save configuration to file."""
        try:
            self.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(self.CONFIG_FILE, "w") as f:
                json.dump(self.config, f, indent=2)
            logger.info(f"Saved config to {self.CONFIG_FILE}")
        except Exception as e:
            logger.error(f"Failed to save config: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        """Get a config value with dot notation support.

        Examples:
            config.get("voice") → "Samantha"
            config.get("skills.web_search") → True
            config.get("unknown", "default") → "default"
        """
        if "." in key:
            keys = key.split(".")
            value = self.config
            for k in keys:
                if isinstance(value, dict):
                    value = value.get(k)
                else:
                    return default
            return value if value is not None else default

        return self.config.get(key, default)

    def set(self, key: str, value: Any):
        """Set a config value with dot notation support.

        Examples:
            config.set("voice", "Alex")
            config.set("skills.web_search", False)
        """
        if "." in key:
            keys = key.split(".")
            config = self.config
            for k in keys[:-1]:
                if k not in config:
                    config[k] = {}
                config = config[k]
            config[keys[-1]] = value
        else:
            self.config[key] = value
        self.save()

    def is_skill_enabled(self, skill_name: str) -> bool:
        """Check if a skill is enabled."""
        return self.get(f"skills.{skill_name}", True)

    def get_voice(self) -> str:
        """Get TTS voice setting."""
        return self.get("voice", "Samantha")

    def get_tts_rate(self) -> int:
        """Get TTS rate (speed) setting."""
        return self.get("tts_rate", 160)

    def get_wake_word(self) -> str:
        """Get wake word setting."""
        return self.get("wake_word", "jarvis")

    def should_auto_start(self) -> bool:
        """Check if should auto-start on login."""
        return self.get("auto_start", True)

    def get_user_name(self) -> str:
        """Get user's name."""
        return self.get("user_name", "Boss")


# Global singleton
_user_config: Optional[UserConfig] = None


def get_user_config() -> UserConfig:
    """Get the global user config instance."""
    global _user_config
    if _user_config is None:
        _user_config = UserConfig()
    return _user_config
