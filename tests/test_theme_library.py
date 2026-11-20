import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path

import asset_library
import server


BUILTIN_THEMES = (
    "builtin:theme/medical",
    "builtin:theme/warm",
    "builtin:theme/mint",
    "builtin:theme/night",
    "builtin:theme/illus",
    "builtin:theme/photo",
)


class ThemeLibraryTests(unittest.TestCase):
    def sample_theme(self):
        return {
            "schemaVersion": 1,
            "base": "medical",
            "vars": {
                "--v-bg": "linear-gradient(155deg, #f2f8ff 0%, #e4f0fc 54%, #eef6fe 100%)",
                "--v-ink": "#122d4c",
                "--v-ink-soft": "rgb(68, 96, 125)",
                "--v-primary": "#1466cc",
                "--v-primary-deep": "#0d4fa3ff",
                "--v-primary-soft": "rgba(20, 102, 204, 0.12)",
                "--v-card-bg": "#fff",
                "--v-card-border": "#d2e4f6",
                "--v-card-border-w": "1.5px",
                "--v-card-shadow": "0 12px 28px rgba(0, 0, 0, .08)",
                "--v-card-radius": "22px",
                "--v-card-blur": "blur(14px) saturate(1.2)",
                "--v-band": "#0f2a4a",
                "--v-band-ink": "#fff",
                "--v-rail-bg": "rgba(255, 255, 255, 0.8)",
                "--v-rail-ink": "#122d4c",
                "--v-rail-line": "#d2e4f6",
            },
            "background": {"assetId": "builtin:image/bg-clinic-blur"},
            "glass": True,
            "fadeColor": "#edf6fe",
        }

    def test_all_six_builtin_themes_and_backgrounds_are_valid(self):
        items = {item["id"]: item for item in server.ASSETS.theme_items()}
        for theme_id in BUILTIN_THEMES:
            with self.subTest(theme_id=theme_id):
                definition, item, path = server.ASSETS.theme(theme_id)
                self.assertEqual(item["kind"], "theme")
                self.assertTrue(path.is_file())
                self.assertIn(theme_id, items)
                self.assertIn(definition["base"], ("medical", "warm"))
        self.assertEqual(server.ASSETS.theme("builtin:theme/illus")[0]["background"]["assetId"], "builtin:image/bg-illustration")
        self.assertEqual(server.ASSETS.theme("builtin:theme/photo")[0]["background"]["assetId"], "builtin:image/bg-clinic-blur")
        self.assertTrue(server.ASSETS.theme("builtin:theme/photo")[0]["glass"])
        for image_id in ("builtin:image/bg-illustration", "builtin:image/bg-clinic-blur"):
            path, item = server.ASSETS.resolve(image_id, ("image",))
            self.assertTrue(path.is_file())
            self.assertIn("背景", item["tags"])
            self.assertEqual(item["source"], "AI 生成")
            self.assertEqual(item["license"], "项目自制")

    def test_valid_theme_variants_pass_validation(self):
        valid = self.sample_theme()
        asset_library.validate_theme(valid, lambda aid: server.ASSETS.resolve(aid, ("image",)))
        for bg in (
            "#fdf5e7",
            "#fff",
            "rgb(250, 245, 230)",
            "rgba(100%, 95%, 90%, 0.9)",
            "radial-gradient(120% 90% at 85% 0%, #1d3a4c 0%, #12212c 55%, #0d1820 100%)",
            "radial-gradient(circle at 50% 0%, #1d3a4c 0%, #0d1820 100%)",
            "radial-gradient(ellipse at 10% 20%, rgba(29, 58, 76, 0.9) 0%, #0d1820 100%)",
        ):
            with self.subTest(bg=bg):
                case = copy.deepcopy(valid)
                case["vars"]["--v-bg"] = bg
                asset_library.validate_theme(case)
        for blur in ("none", "blur(10px)", "blur(14.5px) saturate(1.2)"):
            with self.subTest(blur=blur):
                case = copy.deepcopy(valid)
                case["vars"]["--v-card-blur"] = blur
                asset_library.validate_theme(case)
        for shadow in (
            "0 12px 28px rgba(0, 0, 0, 0.08)",
            "0 4px 12px rgba(0,0,0,.1), 0 1px 3px rgba(0,0,0,.06)",
            "rgba(16, 70, 58, .08) 0 12px 28px 2px",
        ):
            with self.subTest(shadow=shadow):
                case = copy.deepcopy(valid)
                case["vars"]["--v-card-shadow"] = shadow
                asset_library.validate_theme(case)

    def test_rejects_forbidden_tokens_and_invalid_values(self):
        base = self.sample_theme()
        forbidden_cases = [
            ("--v-bg", 'url("https://evil.invalid/a.jpg")'),
            ("--v-bg", "linear-gradient(155deg, url(a.png), #fff)"),
            ("--v-ink", "#122d4c; color: red"),
            ("--v-ink", "#122d4c { body: 1 }"),
            ("--v-ink", "#122d4c }"),
            ("--v-ink", "<script>alert(1)</script>"),
            ("--v-ink", "#122d4c /* comment */"),
            ("--v-ink", "expression(alert(1))"),
            ("--v-ink", "@import 'evil.css'"),
            ("--v-ink", "red"),
            ("--v-ink", "#12345"),
            ("--v-ink", "rgb(1, 2)"),
            ("--v-ink", "rgba(1, 2, 3, var(--x))"),
            ("--v-card-radius", "22rem"),
            ("--v-card-radius", "-10px"),
            ("--v-card-border-w", "2em"),
            ("--v-card-shadow", "0 12px 28px #000"),
            ("--v-card-shadow", "inset 0 2px 4px rgba(0,0,0,.1)"),
            ("--v-card-shadow", "0 12px 28px rgba(0,0,0,.08), " * 6 + "0 1px 2px rgba(0,0,0,.1)"),
            ("--v-card-blur", "blur(10px) brightness(2)"),
            ("--v-card-blur", "saturate(1.2)"),
            ("--v-bg", "linear-gradient(to right, #fff, #000)"),
            ("--v-bg", "repeating-linear-gradient(45deg, #fff, #000)"),
            ("--v-unknown", "#123456"),
        ]
        for var_name, value in forbidden_cases:
            with self.subTest(var_name=var_name, value=value), self.assertRaises(ValueError):
                broken = copy.deepcopy(base)
                broken["vars"][var_name] = value
                asset_library.validate_theme(broken)

    def test_rejects_invalid_schema_fields_and_non_image_backgrounds(self):
        base = self.sample_theme()
        invalid_docs = [
            {**base, "schemaVersion": 2},
            {**base, "base": "dark"},
            {**base, "css": "body { color: red }"},
            {**base, "vars": {}},
            {**base, "glass": "yes"},
            {**base, "fadeColor": "linear-gradient(0deg, #fff, #000)"},
            {**base, "background": {"url": "https://example.invalid/a.jpg"}},
            {**base, "background": {"assetId": "builtin:svg/reading-list"}},
            {**base, "background": {"assetId": "builtin:theme/medical"}},
        ]
        for doc in invalid_docs:
            with self.subTest(doc=doc), self.assertRaises(ValueError):
                asset_library.validate_theme(doc, lambda aid: server.ASSETS.resolve(aid, ("image",)))

    def test_copy_upload_size_limit_and_archive_theme(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = asset_library.LocalLibrary(Path(tmp), server.ASSETS.builtin_root)
            copied = library.copy_theme({
                "originId": "builtin:theme/photo",
                "name": "我的药房主题",
                "primary": "#1a7a5c",
                "backgroundAssetId": "builtin:image/bg-illustration",
            })
            self.assertTrue(copied["id"].startswith("user:"))
            self.assertEqual(copied["originId"], "builtin:theme/photo")
            copied_def, _, _ = library.theme(copied["id"])
            self.assertEqual(copied_def["vars"]["--v-primary"], "#1a7a5c")
            self.assertEqual(copied_def["background"]["assetId"], "builtin:image/bg-illustration")
            self.assertTrue(copied_def["glass"])

            with self.assertRaisesRegex(ValueError, "只允许修改"):
                library.copy_theme({
                    "originId": "builtin:theme/photo",
                    "name": "非法复制",
                    "vars": {"--v-ink": "#000"},
                })

            valid_payload = self.sample_theme()
            raw = json.dumps(valid_payload).encode("utf-8")
            uploaded = library.upload({
                "kind": "theme", "name": "上传主题", "license": "自制或已获授权",
                "credit": "测试团队", "tags": "自制,测试",
                "data": base64.b64encode(raw).decode(),
            }, None)
            self.assertEqual(uploaded["kind"], "theme")
            self.assertEqual(library.theme(uploaded["id"])[0], valid_payload)

            oversize = b" " * (asset_library.LIMITS["theme"] + 1)
            with self.assertRaisesRegex(ValueError, "16 KB"):
                library.upload({
                    "kind": "theme", "name": "超大主题", "license": "CC0", "credit": "测试",
                    "data": base64.b64encode(oversize).decode(),
                }, None)

            library.archive(copied["id"])
            self.assertNotIn(copied["id"], [item["id"] for item in library.theme_items()])
            self.assertEqual(library.theme(copied["id"])[0], copied_def)

    def test_stage_appearance_resolves_theme_and_keeps_legacy_validation_unchanged(self):
        legacy_payload = {"appearance": {"theme": "mint", "presenter": "digital"}}
        with self.assertRaises(ValueError):
            server.code_motion_appearance(legacy_payload)

        images, used = {}, []
        resolved = server.stage_appearance(
            {"appearance": {"theme": "medical", "presenter": "digital", "themeId": "builtin:theme/photo"}},
            images,
            used,
        )
        self.assertEqual(resolved["theme"], "medical")
        self.assertEqual(resolved["themeId"], "builtin:theme/photo")
        self.assertTrue(resolved["themeGlass"])
        self.assertEqual(resolved["themeFadeColor"], "#dbe9ee")
        bg_url = asset_library.asset_url("builtin:image/bg-clinic-blur")
        self.assertEqual(resolved["themeBackground"], bg_url)
        self.assertIn(bg_url, images)
        self.assertTrue(images[bg_url].startswith("file:"))
        self.assertEqual([item["id"] for _, item in used], ["builtin:theme/photo", "builtin:image/bg-clinic-blur"])

        plain = server.stage_appearance({"appearance": {"theme": "warm", "presenter": "none"}}, {}, [])
        self.assertEqual(plain, {"theme": "warm", "presenter": "none", "pharmacist": {}})


if __name__ == "__main__":
    unittest.main()
