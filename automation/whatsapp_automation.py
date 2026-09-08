"""
High-level WhatsApp send API for the command router.

Now backed by the *native macOS WhatsApp app* (via `whatsapp_desktop`),
not the old Selenium-driven WhatsApp Web page.  The ContactResolver can
return either a friendly display name OR a phone number — this module
picks the right send mode automatically.
"""

from integrations.whatsapp.whatsapp_desktop import WhatsAppDesktop
from integrations.whatsapp.contact_resolver import ContactResolver
from utils.logger import get_logger

logger = get_logger(__name__)

_whatsapp_instance: WhatsAppDesktop | None = None
_contact_resolver = ContactResolver()


def get_whatsapp() -> WhatsAppDesktop:
    global _whatsapp_instance
    if _whatsapp_instance is None:
        _whatsapp_instance = WhatsAppDesktop()
    return _whatsapp_instance


def _looks_like_phone(s: str) -> bool:
    cleaned = s.strip().replace(" ", "").replace("-", "")
    digits = sum(c.isdigit() for c in cleaned)
    # Heuristic: mostly digits, at least 7 of them (excluding the '+').
    return digits >= 7 and digits >= max(1, len(cleaned.lstrip("+"))) * 0.8


def send_whatsapp_message(contact: str, message: str) -> tuple[bool, str]:
    resolved = _contact_resolver.resolve(contact).strip()
    logger.info(f"WhatsApp (desktop): to '{resolved}' — {message[:60]}")

    wa = get_whatsapp()
    if not wa.is_available():
        return False, "WhatsApp.app is not installed. Get it from the Mac App Store."

    if _looks_like_phone(resolved):
        return wa.send_by_phone(resolved, message)
    return wa.send_by_contact(resolved, message)


def close_whatsapp():
    global _whatsapp_instance
    if _whatsapp_instance:
        _whatsapp_instance.close()
        _whatsapp_instance = None


def add_contact_alias(display_name: str, whatsapp_name_or_phone: str):
    """Teach the resolver: when the user says `display_name`, use
    `whatsapp_name_or_phone` (either a contact name in WhatsApp or a phone)."""
    _contact_resolver.add_contact(display_name, whatsapp_name_or_phone)
