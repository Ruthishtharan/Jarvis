import json
import os
from pathlib import Path
from utils.logger import get_logger

logger = get_logger(__name__)


def read_json(path: str) -> dict | list:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_json(path: str, data: dict | list):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def ensure_dir(path: str):
    Path(path).mkdir(parents=True, exist_ok=True)


def file_exists(path: str) -> bool:
    return Path(path).exists()


def get_base_dir() -> Path:
    return Path(__file__).parent.parent
