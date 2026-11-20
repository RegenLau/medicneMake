import copy
import json
import unittest
from pathlib import Path

import asset_library
import server


CLASSIC = "builtin:layout/info-classic"


class StageLayoutTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "public/assets/library/layouts/info-classic.json"
        self.layout = json.loads(path.read_text(encoding="utf-8"))

    def test_classic_layout_is_readable_and_valid_in_library(self):
        definition, item, path = server.ASSETS.layout(CLASSIC)
        self.assertEqual(definition, self.layout)
        self.assertEqual(item["kind"], "layout")
        self.assertEqual(path.name, "info-classic.json")
        self.assertIn(item, server.ASSETS.items())

    def test_regions_use_known_components_variants_and_coordinates(self):
        for props in ({"component": "webview"}, {"variant": "custom"}, {"x": -1}, {"y": 101},
                      {"x": 99}, {"w": True}, {"h": float("nan")}):
            with self.subTest(props=props), self.assertRaises(ValueError):
                invalid = copy.deepcopy(self.layout)
                invalid["regions"]["media"].update(props)
                asset_library.validate_layout(invalid)

    def test_details_validate_both_default_and_special_regions(self):
        for variant in ("explain", "hook", "outro"):
            for props in ({"w": 10}, {"h": 100, "y": 0}):
                with self.subTest(variant=variant, props=props), self.assertRaises(ValueError):
                    invalid = copy.deepcopy(self.layout)
                    regions = invalid["regions"] if variant == "explain" else invalid["stages"][variant]["regions"]
                    regions["media"].update(props)
                    asset_library.validate_layout(invalid)

    def test_rejects_executable_or_markup_strings_in_layout_definition(self):
        for kind, value in (("html", "<script></script>"), ("css", "position: fixed"), ("js", "window.name")):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                invalid = copy.deepcopy(self.layout)
                invalid["stages"]["hook"]["regions"]["media"][kind] = value
                asset_library.validate_layout(invalid)
        invalid = copy.deepcopy(self.layout)
        invalid["regions"]["header"]["variant"] = "<script></script>"
        with self.assertRaises(ValueError):
            asset_library.validate_layout(invalid)


if __name__ == "__main__":
    unittest.main()
