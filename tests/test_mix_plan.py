import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

import mix_plan


BASE = Path(__file__).resolve().parents[1]
CATALOG = json.loads((BASE / "public/assets/library/catalog.json").read_text())[-1]["data"]


def model_response(value):
    return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]}


def script_fixture():
    return {"title": "出门怎么带药", "shortTitle": "出门带药", "chapters": ["打包", "核对"], "shots": [
        {"name": name, "line": line, "seconds": 4, "chapterIndex": i % 2,
         "points": {"type": kind, "headline": name, "items": [{"title": name, "detail": "", "tag": ""}]},
         "cues": [{"text": line, "focus": "0", "weight": len(line)}]}
        for i, (name, line, kind) in enumerate([
            ("核对药盒", "出门前核对药盒上的用法。", "cover"),
            ("打包随身药", "把原包装药盒放进随身包。", "steps"),
            ("记录时间", "记下每次用药时间。", "checklist"),
        ])]}


def choice(script, index, kind, fallback="scene", **kwargs):
    return {"index": index, "kind": kind, "reason": f'「{script["shots"][index]["name"]}」适合展示药盒或记录对象。',
            "fallback": fallback, "params": {}, **kwargs}


class MixPlanningTests(unittest.TestCase):
    def setUp(self):
        self.item = {"topic": "出门怎么带药", "layoutId": "builtin:layout/info-classic", "presentation": "mix",
                     "imageBudget": 2}
        self.supports = ["image", "card", "scene", "svg", "asset"]
        self.library = Mock()
        self.library.layout.return_value = ({"supports": self.supports}, {}, None)
        self.library.stage_catalog.return_value = CATALOG
        self.library.items.return_value = [
            {"id": f"builtin:svg/{i}", "name": f"药盒 {i}", "kind": "svg", "tags": ["药盒"], "path": "internal"}
            for i in range(12)
        ] + [{"id": "font", "name": "药盒", "kind": "font", "tags": ["药盒"]}]
        self.script = script_fixture()

    def arrange(self, rows=None, client=None):
        if client is None:
            client = Mock(return_value=model_response({"shots": rows}))
        return mix_plan.arrange(client, "deepseek-flash", self.item, self.script, self.library), client

    def test_unsupported_kind_and_invalid_asset_use_fallback(self):
        self.supports.remove("svg")
        choices = [choice(self.script, 0, "svg", "card"),
                   choice(self.script, 1, "asset", params={"assetId": "outside-catalog"}),
                   choice(self.script, 2, "asset", params={"assetId": "builtin:svg/0", "move": "zoom"})]
        result, client = self.arrange(choices)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["card", "scene", "asset"], [entry["kind"] for entry in contents])
        self.assertIn("布局", contents[0]["adjusted"])
        self.assertIn("参数", contents[1]["adjusted"])
        self.assertEqual({"assetId": "builtin:svg/0", "assetName": "药盒 0", "move": "zoom"},
                         {key: contents[2][key] for key in ("assetId", "assetName", "move")})
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(self.supports, payload["supports"])
        self.assertEqual(2, payload["imageBudget"])
        self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in payload["shots"]])
        self.assertEqual(10, len(payload["candidateAssets"]))
        self.assertEqual({"id", "name", "tags"}, set(payload["candidateAssets"][0]))
        for details in payload["presenters"].values():
            self.assertEqual({"strengths", "avoid", "cost", "options"}, set(details))

    def test_budget_prioritizes_model_rank_and_zero_rejects_all(self):
        rows = [choice(self.script, i, "image", priority=priority) for i, priority in enumerate((25, 90, 75))]
        result, _ = self.arrange(rows)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["scene", "image", "image"], [c["kind"] for c in contents])
        self.assertIn("上限", contents[0]["adjusted"])
        self.item["imageBudget"] = 0
        result, _ = self.arrange(rows)
        self.assertEqual(["scene"] * 3, [row["content"]["kind"] for row in result["shots"]])

    def test_malformed_output_and_network_failure_continue(self):
        for client in (Mock(side_effect=OSError("offline")), Mock(return_value=model_response({"shots": []}))):
            with self.subTest(client=client):
                result, _ = self.arrange(client=client)
                self.assertEqual(mix_plan.FAILURE_NOTICE, result["notice"])
                self.assertEqual(["card", "scene", "card"], [row["content"]["kind"] for row in result["shots"]])
                self.assertTrue(all(row["content"]["adjusted"] for row in result["shots"]))
                self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in result["shots"]])

    def test_replan_preserves_user_rows_and_allocates_remaining_images(self):
        self.script["shots"][0]["content"] = {"kind": "image", "image": "/existing.jpg", "decidedBy": "user"}
        self.script["shots"][1]["content"] = {"kind": "scene", "decidedBy": "mix"}
        self.script["shots"][2]["content"] = {"kind": "card", "decidedBy": "mix"}
        self.item["script"] = self.script
        rows = [choice(self.script, 1, "image", priority=60), choice(self.script, 2, "image", priority=80)]
        result, client = self.arrange(rows)
        self.assertEqual([1, 2], result["plannedIndices"])
        self.assertEqual(self.script["shots"][0], result["shots"][0])
        self.assertEqual(["image", "scene", "image"], [row["content"]["kind"] for row in result["shots"]])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(1, payload["remainingImageBudget"])
        self.assertEqual(["image", "scene", "card"], [row["currentKind"] for row in payload["shots"]])
        self.item["targetIndex"] = 0
        result, _ = self.arrange([choice(self.script, 0, "card")])
        self.assertEqual([0], result["plannedIndices"])
        self.assertEqual("card", result["shots"][0]["content"]["kind"])
        self.assertEqual(self.script["shots"][1:], result["shots"][1:])

    def test_fixed_modes_force_kind_and_only_svg_requests_second_pass(self):
        beats = [[{"action": "carton", "line": row["line"], "label": row["name"]}] for row in self.script["shots"]]
        for mode in ("image", "card", "scene", "svg"):
            with self.subTest(mode=mode):
                self.item["presentation"] = mode
                result, client = self.arrange([{"index": i, "beats": b} for i, b in enumerate(beats)])
                self.assertEqual([mode] * 3, [row["content"]["kind"] for row in result["shots"]])
                self.assertEqual(int(mode == "svg"), client.call_count)
                if mode == "svg":
                    self.assertEqual(beats[0], result["shots"][0]["content"]["beats"])

    def test_script_request_ignores_presentation_and_normalizes_cues(self):
        raw = copy.deepcopy(self.script)
        raw["shots"][0]["cues"][0].update(focus=0, highlightWords=None)
        raw["shots"][1]["cues"][0]["focus"] = "layout-unsupported"
        client = Mock(return_value=model_response(raw))
        result = mix_plan.write_script(client, "deepseek-flash", self.item, 45, CATALOG)
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual({"topic", "drug", "referenceSeconds", "pointTypes"}, set(payload))
        self.assertEqual(["0", "all", "0"], [row["cues"][0]["focus"] for row in result["shots"]])
        self.assertTrue(all("content" not in row for row in result["shots"]))

    def test_mix_transition_accepts_supported_values_only(self):
        choices = [choice(self.script, i, "scene", transition=value)
                   for i, value in enumerate(("wipe", "iris", "unknown"))]
        result, client = self.arrange(choices)
        normalized = [row["content"].get("transition") for row in result["shots"]]
        self.assertEqual(["wipe", "iris", None], normalized)
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(CATALOG["transitions"], payload["transitions"])

    def test_invalid_non_image_fallback_uses_point_default(self):
        rows = [choice(self.script, i, "unavailable", fallback="image") for i in range(3)]
        result, _ = self.arrange(rows)
        self.assertEqual(["card", "scene", "card"], [row["content"]["kind"] for row in result["shots"]])
        self.assertTrue(all(row["content"]["adjusted"] for row in result["shots"]))


if __name__ == "__main__":
    unittest.main()
