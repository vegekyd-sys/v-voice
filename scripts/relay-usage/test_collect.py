import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from collect import read

ENV = {
    "GROK_SUBSCRIPTION_OWNER_USER_ID": "owner",
    "GROK_SUBSCRIPTION_RELAY_SECRET": "fixture",
    "SCENE_GEMINI_ALLOWED_OWNER_IDS": "owner",
    "SCENE_GEMINI_RELAY_SECRET": "fixture",
    "SCENE_GEMINI_PORT": "1",
}


@patch.dict("os.environ", ENV, clear=True)
class CollectionTests(unittest.TestCase):
    @patch("collect.signed")
    def test_grok_billing_period(self, signed):
        signed.return_value = {"usage": {"usedPercent": 0, "resetsAt": 1800000000}}
        row = read("Grok")
        self.assertEqual(row["windows"], [{"label": "本期", "used": 0, "reset": 1800000000}])
        self.assertEqual(signed.call_args.args[:3], ("Grok", "GET", "/v1/usage"))
        signed.return_value = {"usage": None}
        self.assertEqual(read("Grok")["state"], "unavailable")
        signed.side_effect = TimeoutError()
        self.assertEqual(read("Grok")["state"], "unavailable")

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
