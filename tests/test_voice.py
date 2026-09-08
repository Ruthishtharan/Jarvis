import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import unittest
from unittest.mock import patch, MagicMock
from voice.text_to_speech import TextToSpeech
from utils.helpers import contains_wake_word, strip_wake_word


class TestTextToSpeech(unittest.TestCase):
    def setUp(self):
        self.tts = TextToSpeech()

    @patch("subprocess.Popen")
    def test_speak_calls_say(self, mock_popen):
        mock_proc = MagicMock()
        mock_proc.wait.return_value = 0
        mock_popen.return_value = mock_proc
        self.tts.speak("Hello world")
        mock_popen.assert_called_once()
        args = mock_popen.call_args[0][0]
        self.assertIn("say", args)

    def test_speak_empty_string_does_nothing(self):
        with patch("subprocess.Popen") as mock_popen:
            self.tts.speak("")
            mock_popen.assert_not_called()


class TestWakeWordDetection(unittest.TestCase):
    def test_contains_wake_word_true(self):
        self.assertTrue(contains_wake_word("hey jarvis open spotify"))
        self.assertTrue(contains_wake_word("Jarvis what time is it"))
        self.assertTrue(contains_wake_word("ok jarvis"))

    def test_contains_wake_word_false(self):
        self.assertFalse(contains_wake_word("open spotify"))
        self.assertFalse(contains_wake_word("what time is it"))

    def test_strip_wake_word(self):
        self.assertEqual(strip_wake_word("hey jarvis open spotify"), "open spotify")
        self.assertEqual(strip_wake_word("jarvis what time is it"), "what time is it")
        self.assertEqual(strip_wake_word("ok jarvis"), "")


if __name__ == "__main__":
    unittest.main()
