import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import unittest
from unittest.mock import patch, MagicMock
from automation.app_control import _resolve_app_name
from utils.helpers import parse_volume


class TestAppControl(unittest.TestCase):
    def test_resolve_known_alias(self):
        self.assertEqual(_resolve_app_name("chrome"), "Google Chrome")
        self.assertEqual(_resolve_app_name("vscode"), "Visual Studio Code")
        self.assertEqual(_resolve_app_name("spotify"), "Spotify")

    def test_resolve_unknown_app(self):
        self.assertEqual(_resolve_app_name("MyCustomApp"), "Mycustomapp")

    @patch("subprocess.run")
    def test_open_app_calls_subprocess(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        from automation.app_control import open_app
        with patch("integrations.macos.apple_script.run", return_value=(True, "")):
            ok, name = open_app("Safari")
            self.assertTrue(ok)


class TestVolumeParser(unittest.TestCase):
    def test_parse_number(self):
        self.assertEqual(parse_volume("set volume to 75"), 75)
        self.assertEqual(parse_volume("volume 50"), 50)

    def test_parse_keyword(self):
        self.assertEqual(parse_volume("set volume to max"), 100)
        self.assertEqual(parse_volume("half volume"), 50)

    def test_parse_clamp(self):
        self.assertEqual(parse_volume("volume 150"), 100)
        self.assertEqual(parse_volume("volume -10"), 0)

    def test_no_match(self):
        self.assertIsNone(parse_volume("turn up the music"))


if __name__ == "__main__":
    from unittest.mock import MagicMock
    unittest.main()
