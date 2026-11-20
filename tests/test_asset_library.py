import base64
from copy import deepcopy
import json
import tempfile
import unittest
from pathlib import Path

import asset_library
import music_gen
import server


class AssetLibraryTests(unittest.TestCase):
    def test_archiving_asset_keeps_exact_file_for_previous_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = asset_library.LocalLibrary(Path(tmp) / "user", Path(tmp) / "builtin")
            data = b'<svg viewBox="0 0 20 20"><path d="M0 0h20" stroke="#123"/></svg>'
            fields = {"name": "示例", "license": "CC0", "tags": "清单,核对,清单"}
            item = library.add("svg", data, fields, None, "upload")
            self.assertEqual(item["tags"], ["清单", "核对"])
            self.assertEqual(library.add("svg", data, fields, None, "upload")["id"], item["id"])
            path, _ = library.resolve(item["id"], ("svg",))
            library.archive(item["id"])
            self.assertEqual(library.items(), [])
            reopened = asset_library.LocalLibrary(library.root, library.builtin_root)
            self.assertEqual(reopened.resolve(item["id"])[0], path)
            self.assertEqual(asset_library.digest(path), item["sha256"])
            with self.assertRaises(ValueError):
                reopened.resolve(item["id"], ("font",))

    def test_layout_copy_assigns_new_ids_and_archived_layout_stays_resolvable(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = asset_library.LocalLibrary(Path(tmp), server.ASSETS.builtin_root)
            classic, origin, path = library.layout("builtin:layout/info-classic")
            before = asset_library.digest(path)
            definition = deepcopy(classic)
            definition["regions"]["media"]["x"] = 21.5
            fields = {"originId": origin["id"], "definition": definition, "name": "左栏布局副本"}
            one = library.copy_layout(fields)
            two = library.copy_layout(fields)
            self.assertNotEqual(one["id"], two["id"])
            self.assertEqual(one["originId"], origin["id"])
            self.assertEqual(one["sha256"], two["sha256"])
            self.assertEqual(before, asset_library.digest(path))
            library.archive(one["id"])
            self.assertNotIn(one["id"], [item["id"] for item in library.layout_items()])
            self.assertEqual(library.layout(one["id"])[0], definition)
            self.assertIn(two["id"], [item["id"] for item in library.layout_items()])

    def test_layout_upload_requires_source_and_accepts_only_the_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            library = asset_library.LocalLibrary(Path(tmp), server.ASSETS.builtin_root)
            definition, _, _ = library.layout("builtin:layout/info-classic")
            def upload(spec, credit):
                return library.upload({"kind": "layout", "name": "新的布局", "license": "CC0", "credit": credit,
                                       "data": base64.b64encode(json.dumps(spec).encode()).decode()}, None)
            with self.assertRaisesRegex(ValueError, "来源"):
                upload(definition, "")
            with self.assertRaisesRegex(ValueError, "未知字段"):
                upload({**definition, "style": "<script>"}, "本机测试")
            broken = deepcopy(definition)
            broken["regions"]["media"]["component"] = "unknown"
            with self.assertRaisesRegex(ValueError, "组件无效"):
                upload(broken, "本机测试")
            item = upload(definition, "本机测试")
            self.assertEqual(item["aspect"], "16:9")
            self.assertEqual(item["license"], "CC0")
            self.assertEqual(library.layout(item["id"])[0], definition)

    def test_svg_static_allowlist_checks_embedded_content_and_attributes(self):
        for body in ('<script/>', '<foreignObject/>', '<image href="https://example.invalid/img"/>',
                     '<path onload="handler"/>', '<path fill="url(https://example.invalid/a)"/>'):
            with self.subTest(body=body), self.assertRaises(ValueError):
                asset_library.clean_svg(f'<svg>{body}</svg>'.encode())
        local = b'<svg><defs><linearGradient id="a"/></defs><path fill="url(#a)"/></svg>'
        self.assertIn(b'url(#a)', asset_library.clean_svg(local))

    def test_archived_track_remains_resolvable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            track = root / "test.mp3"
            track.write_bytes(b"demo")
            item, = music_gen.list_music_library(root)
            music_gen.archive_library_track(root, item["id"])
            self.assertEqual(music_gen.list_music_library(root), [])
            self.assertEqual(music_gen.resolve_library_track(root, item["id"])[0], track.resolve())

    def test_sound_effect_is_opt_in_and_uses_shot_start(self):
        none, legacy, used = server.library_sound_mix([{"start": 4.0}], True, "library:test", 8.0, True)
        self.assertEqual(none, [])
        self.assertEqual(used, [])
        self.assertEqual(legacy, ["-filter_complex", server.music_mix(8.0, True, is_generated=True), "-map", "[mix]"])
        inputs, flags, used = server.library_sound_mix(
            [{"start": 4.0, "sfxId": "builtin:sfx/check"}], False, "off", 8.0, False)
        self.assertIn("[2:a]volume=-12dB,adelay=4160:all=1", flags[1])
        self.assertEqual(inputs[1], used[0][0])


if __name__ == "__main__":
    unittest.main()
