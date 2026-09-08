import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import unittest
from unittest.mock import patch, MagicMock
from ai.memory import ConversationMemory
from ai.response_generator import ResponseGenerator


class TestConversationMemory(unittest.TestCase):
    def setUp(self):
        # Patch at the ai.memory module level (where the names are bound after import)
        with patch("ai.memory.read_json", return_value={}):
            with patch("ai.memory.write_json"):
                self.memory = ConversationMemory()

    def test_add_and_retrieve(self):
        with patch("ai.memory.write_json"):
            self.memory.add("user", "hello")
            self.memory.add("assistant", "hi there")
        history = self.memory.get_history()
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["role"], "user")
        self.assertEqual(history[1]["role"], "assistant")

    def test_clear(self):
        with patch("ai.memory.write_json"):
            self.memory.add("user", "test")
            self.memory.clear()
        self.assertEqual(len(self.memory.get_history()), 0)

    def test_max_messages_respected(self):
        with patch("ai.memory.write_json"):
            for i in range(25):
                self.memory.add("user", f"message {i}")
        self.assertLessEqual(len(self.memory.get_history()), self.memory.max_messages)


class TestResponseGenerator(unittest.TestCase):
    def setUp(self):
        self.gen = ResponseGenerator()

    def test_app_opened(self):
        resp = self.gen.app_opened("Spotify")
        self.assertIn("Spotify", resp)

    def test_whatsapp_sent(self):
        resp = self.gen.whatsapp_sent("John")
        self.assertIn("John", resp)

    def test_battery_charging(self):
        resp = self.gen.battery_response("87%", True)
        self.assertIn("87%", resp)
        self.assertIn("charging", resp)

    def test_time_response(self):
        resp = self.gen.time_response()
        self.assertIn("It's", resp)

    def test_date_response(self):
        resp = self.gen.date_response()
        self.assertIn("Today is", resp)


class TestSkillRegistry(unittest.TestCase):
    """Behaviour of the new skills system — same voice utterances, new routing."""

    @classmethod
    def setUpClass(cls):
        from skills._registry import get_registry, reset_registry_for_tests
        reset_registry_for_tests()
        cls.registry = get_registry()

    def _matched(self, text):
        skill, match = self.registry.match(text)
        return (skill.name if skill else None, match)

    # ── App control ─────────────────────────────────────────────────────────
    def test_open_app(self):
        name, m = self._matched("open spotify")
        self.assertEqual(name, "open_app")
        self.assertEqual(m.entities["app_name"], "spotify")

    def test_close_app(self):
        name, _ = self._matched("close safari")
        self.assertEqual(name, "close_app")

    # ── System ──────────────────────────────────────────────────────────────
    def test_screenshot(self):
        self.assertEqual(self._matched("take a screenshot")[0], "screenshot")
        self.assertEqual(self._matched("screenshot")[0], "screenshot")

    def test_volume_up(self):
        name, m = self._matched("turn volume up")
        self.assertEqual(name, "volume")
        self.assertEqual(m.entities["action"], "up")

    def test_volume_number(self):
        name, m = self._matched("set volume to 60")
        self.assertEqual(name, "volume")
        self.assertEqual(m.entities["level"], 60)

    def test_mute(self):
        self.assertEqual(self._matched("mute")[0], "mute")
        self.assertEqual(self._matched("unmute")[1].entities["action"], "unmute")

    def test_lock(self):
        self.assertEqual(self._matched("lock the screen")[0], "lock_screen")

    def test_battery(self):
        self.assertEqual(self._matched("how much battery do i have")[0], "battery")

    def test_wifi(self):
        self.assertEqual(self._matched("what wifi am i on")[0], "wifi")

    # ── Time / Date ─────────────────────────────────────────────────────────
    def test_time(self):
        self.assertEqual(self._matched("what time is it")[0], "time_date")

    def test_date(self):
        name, m = self._matched("what day is it")
        self.assertEqual(name, "time_date")
        self.assertEqual(m.entities["kind"], "date")

    # ── WhatsApp ────────────────────────────────────────────────────────────
    def test_whatsapp_with_saying(self):
        name, m = self._matched("whatsapp john saying i'll be late")
        self.assertEqual(name, "whatsapp_send")
        self.assertIn("john", m.entities["contact"])
        self.assertIn("late", m.entities["message"])

    def test_whatsapp_message_to(self):
        name, _ = self._matched("send a message to sarah saying happy birthday")
        self.assertEqual(name, "whatsapp_send")

    # ── Web search ──────────────────────────────────────────────────────────
    def test_web_search(self):
        name, _ = self._matched("google the weather in london")
        self.assertEqual(name, "web_search")

    # ── Shutdown jarvis ─────────────────────────────────────────────────────
    def test_shutdown_jarvis(self):
        self.assertEqual(self._matched("goodbye jarvis")[0], "shutdown_jarvis")

    # ── Fallback: conversation always matches at low confidence ─────────────
    def test_conversation_fallback(self):
        name, m = self._matched("what is the meaning of life")
        self.assertEqual(name, "conversation")
        # Should NOT be high confidence — LLM will be consulted by the router
        self.assertLess(m.confidence, 0.85)

    def test_registry_has_expected_skills(self):
        names = {s.name for s in self.registry.all_skills()}
        expected = {
            "open_app", "close_app", "search_local", "web_search", "open_website",
            "whatsapp_send", "volume", "brightness", "screenshot", "music",
            "time_date", "mute", "battery", "wifi", "lock_screen", "empty_trash",
            "shutdown_system", "restart_system", "shutdown_jarvis", "conversation",
        }
        self.assertEqual(names, expected, f"missing: {expected - names}; extra: {names - expected}")


if __name__ == "__main__":
    unittest.main()
