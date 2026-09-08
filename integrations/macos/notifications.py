from integrations.macos.apple_script import show_notification
from utils.logger import get_logger

logger = get_logger(__name__)


def notify(title: str, message: str, subtitle: str = "Jarvis"):
    try:
        show_notification(title, message, subtitle)
    except Exception as e:
        logger.warning(f"Notification failed: {e}")


def notify_action_complete(action: str):
    notify("Jarvis", f"Completed: {action}")


def notify_error(error: str):
    notify("Jarvis — Error", error)


def notify_reminder(reminder_text: str):
    notify("Reminder", reminder_text, "Jarvis")
