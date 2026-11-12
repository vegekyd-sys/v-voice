import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from collect import read

ENV = {
    "SCENE_GEMINI_ALLOWED_OWNER_IDS": "owner",
    "SCENE_GEMINI_RELAY_SECRET": "fixture",
    "SCENE_GEMINI_PORT": "1",
}


@patch.dict("os.environ", ENV, clear=True)
class CollectionTests(unittest.TestCase):
    def test_grok_uses_v_weekly_window_and_converts_milliseconds(self):
        def gateway():
            return {"xai": {"windows": [{"label": "Weekly", "usedPercent": 37, "resetAt": 1800000000123}]}}

        self.assertEqual(read("Grok", gateway)["windows"],
                         [{"label": "周", "used": 37, "reset": 1800000000.123}])
        self.assertEqual(read("Grok", lambda: {})["state"], "unavailable")
        self.assertEqual(read("Grok", lambda: {"xai": {"windows": []}})["state"], "unavailable")

    @patch("collect.signed")
    def test_gemini_converts_remaining_to_used_and_preserves_utc_reset(self, signed):
        reset = "2026-11-13T09:30:00+08:00"
        signed.return_value = {"available": True, "quota": {"buckets": [
            {"id": "gemini-weekly", "remaining_fraction": 0.25, "reset_time": reset}]}}
        item = read("Gemini")["windows"][0]
        self.assertEqual(item["used"], 75)
        self.assertEqual(item["reset"], datetime(2026, 11, 13, 1, 30, tzinfo=timezone.utc).timestamp())
        signed.return_value["available"] = False
        self.assertEqual(read("Gemini")["state"], "unavailable")
