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
