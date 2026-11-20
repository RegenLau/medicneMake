import base64
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

import asset_library
import motion_asset
import server
from test_mix_plan import choice, model_response, script_fixture
from unittest.mock import Mock


CAPSULE = server.ASSETS.builtin_root / "lottie" / "capsule.json"


class LottieTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads(CAPSULE.read_text())

    def data(self, spec=None):
        return json.dumps(self.spec if spec is None else spec).encode()

    def test_validation_rejects_resource_types_and_limit(self):
        text = deepcopy(self.spec)
        text["layers"][0]["ty"] = 5
        linked = deepcopy(self.spec)
        linked["assets"] = [{"id": "external", "u": "https://example.invalid/", "p": "image.png"}]
        expr = deepcopy(self.spec)
        expr["layers"][0]["ks"]["p"]["x"] = "wiggle(2, 10)"
        layer_count = deepcopy(self.spec)
        layer_count["layers"] = layer_count["layers"] * 100
        bad_bitmap = deepcopy(self.spec)
        bad_bitmap["assets"] = [{"id": "bad", "e": 1, "p": "data:image/svg+xml;base64,AA=="}]
        for raw, reason in ((self.data(text), "文字图层"), (self.data(linked), "外链"),
                            (self.data(expr), "表达式"), (self.data(layer_count), "200 个图层"),
                            (self.data(bad_bitmap), "PNG 或 JPEG"), (b"x" * (1024 * 1024 + 1), "1 MB")):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                motion_asset.lottie(raw)

    def test_pack_has_time_markers_and_theme_mapping(self):
        pack = motion_asset.lottie_package(self.data(), {"#1A73E8": "--v-primary"})
        self.assertEqual({"#1a73e8":"--v-primary"}, pack["palette"])
        self.assertEqual(2.5, pack["duration"])
        self.assertIn({"name":"sfx:check","t":.875,"d":0}, pack["markers"])
        with self.assertRaisesRegex(ValueError, "主题色"):
            motion_asset.checked_palette({"#1a73e8":"url(http://example.invalid)"})

    def test_upload_and_palette_copy_produce_distinct_previews(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = asset_library.LocalLibrary(Path(tmp), server.ASSETS.builtin_root)
            def render(asset, path):
                path.mkdir(parents=True, exist_ok=True)
                for file in ("poster.jpg", "preview.mp4"):
                    (path/file).write_bytes(b"test fixture " + repr(asset["palette"]).encode())
            fields = {"kind": "lottie", "name": "胶囊", "credit": "自制测试", "license": "CC0", "useFor": "药片示意",
                      "data": base64.b64encode(self.data()).decode(), "palette": {"#1a73e8":"--v-primary"}}
            original = library.upload(fields, None, render)
            variant = library.copy_motion_palette({"id":original["id"],"name":"绿色胶囊","palette":{"#1a73e8":"--v-green"}}, render)
            self.assertNotEqual(original["id"], variant["id"])
            self.assertEqual(original["sha256"], variant["sha256"])
            self.assertNotEqual(library.motion_preview_file(original["id"],"poster.jpg").read_bytes(),
                                library.motion_preview_file(variant["id"],"poster.jpg").read_bytes())
            self.assertEqual(original["id"], variant["originId"])
            self.assertEqual({"#1a73e8":"--v-primary"}, library.motion(original["id"])[0]["palette"])
            with self.assertRaisesRegex(ValueError,"授权原文"):
                library.upload({**fields, "sourceUrl":"https://example.invalid/public"}, None, render)

    def test_mix_only_uses_matching_confirmed_motion_assets(self):
        import mix_plan

        script = script_fixture()
        item = {"topic": "随身药盒和药片", "layoutId": "builtin:layout/info-classic", "presentation": "mix", "imageBudget": 0}
        rows = [choice(script, 0, "mg", params={"assetId":"builtin:lottie/capsule"}),
                choice(script, 1, "asset", params={"assetId":"builtin:lottie/capsule"}),
                choice(script, 2, "mg", params={"assetId":"pending:not-confirmed"})]
        client = Mock(return_value=model_response({"shots": rows}))
        result = mix_plan.arrange(client, "deepseek-flash", item, script, server.ASSETS)
        self.assertEqual(["mg","scene","scene"], [shot["content"]["kind"] for shot in result["shots"]])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertIn("builtin:lottie/capsule", payload["availableByPresenter"]["mg"])
        self.assertNotIn("builtin:lottie/capsule", payload["availableByPresenter"]["asset"])
        matching = next(asset for asset in payload["candidateAssets"] if asset["id"] == "builtin:lottie/capsule")
        self.assertEqual({"id","name","tags","useFor"}, set(matching))
