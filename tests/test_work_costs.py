import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import server
import work_costs


class WorkCostsTests(unittest.TestCase):
    def test_text_counts_cached_tokens_at_their_own_rate(self):
        usage = {"prompt_tokens": 1000, "completion_tokens": 100, "prompt_tokens_details": {"cached_tokens": 200}}
        row = work_costs.text_cost("文章正文", "doubao-seed-2-1-lite-260915", usage)
        self.assertEqual(row["amount"], "0.000942")
        self.assertIsNone(work_costs.text_cost("文章正文", "unknown", usage)["amount"])
        self.assertIsNone(work_costs.text_cost("文章正文", "doubao-seed-2-1-lite-260915", {})["amount"])

    def test_image_cost_includes_reference_images_and_pixel_tier(self):
        model = "doubao-seedream-5-5-261028"
        self.assertEqual(work_costs.image_cost(model, "1424x800", 0, 0)["amount"], "0.13")
        self.assertEqual(work_costs.image_cost(model, "2848x1600", 2, 0)["amount"], "0.33")
        lite = "doubao-seedream-5-0-260128"
        self.assertEqual(work_costs.image_cost(lite, "2848x1600", 2, 0)["amount"], "0.22")

    def test_video_and_voice_prefer_provider_usage(self):
        model = "doubao-seedance-2-5-flash-261115"
        row = work_costs.video_cost(model, "720p", 7, 100_000, 0, (720, 1280))
        self.assertEqual(float(row["amount"]), 4.6)
        self.assertIn("100,000 Token", row["usage"])
        missing = work_costs.video_cost(model, "720p", None, None, 0, (720, 1280))
        self.assertIsNone(missing["amount"])
        actual = work_costs.speech_cost(12, "示例台词", "流畅女声 2.0", 0)
        self.assertEqual(actual["amount"], "0.0036")
        self.assertEqual(work_costs.speech_cost(0, "示例", "女声", 0)["amount"], "0.0000")

    def test_work_total_includes_attempts_and_only_its_own_legacy_assets(self):
        work_id = str(uuid4())
        other = str(uuid4())
        model = "doubao-seedream-5-5-261028"
        settings = {"imageModel": model, "imageSize": "1K", "ratio": "9:16"}
        media = "/media/abcd.png"
        known = work_costs.image_cost(model, "800x1424", 0, 0)
        attempt = {"kind": "images", "settings": settings, "items": [{}], "mode": "ark", "workId": work_id}
        with tempfile.TemporaryDirectory() as folder, patch.object(server, "JOBS", Path(folder)):
            for request, rows, images, status in [
                (attempt, {"image:0:a": known}, [], "failed"),
                (attempt, {"image:0:b": known}, [], "done"),
                ({**attempt, "workId": other}, {"image:0:c": known}, [media], "done"),
                ({"kind": "images", "settings": settings, "items": [{}], "mode": "ark"}, {}, [media], "done"),
            ]:
                identifier = str(uuid4())
                job = {"id": identifier, "request": request, "costs": rows, "results": images, "status": status}
                (Path(folder) / (identifier + ".json")).write_text(json.dumps(job))
            result = server.cost_details({"workId": work_id, "media": [media, media]})
        self.assertEqual(len(result["rows"]), 3)
        self.assertAlmostEqual(result["total"], 0.39)
        self.assertTrue(result["unresolved"])
