import tempfile
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

import server
import stage_video


class StageVideoTests(unittest.TestCase):
    def payload(self, kind="image"):
        return {"title": "核对资料", "layoutId": stage_video.CLASSIC_LAYOUT, "stage": True,
                "id": str(uuid.uuid4()), "workId": str(uuid.uuid4()), "kind": "video", "mode": "ark",
                "settings": {"ratio": "16:9", "voice": "无配音", "music": "off"},
                "items": [{"name": "确认栏目", "line": "查看说明书。", "seconds": 5, "points": {"type": "explain"},
                           "cues": [{"text": "查看说明书。", "weight": 1, "focus": "all"},
                                    {"text": "核对记录。", "weight": 1, "focus": "0", "holdSeconds": 1}],
                           "content": {"kind": kind}}]}

    def test_stage_reuses_existing_audio_and_both_cues_share_timeline(self):
        p = self.payload()
        p["settings"]["voice"] = next(iter(server.SPEAKERS))
        p["items"][0]["tailPause"] = 1.15
        with tempfile.TemporaryDirectory() as temp, patch.object(server, "JOBS", Path(temp)):
            folder = Path(temp) / p["id"]
            audio = folder / "0" / server.speech_cache_name(p["settings"], p["items"][0]["line"])
            audio.parent.mkdir(parents=True)
            with wave.open(str(audio), "wb") as pcm:
                pcm.setparams((1, 2, 8000, 0, "NONE", ""))
                pcm.writeframes(b"\0\0" * 32000)
            _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
            with patch.object(server, "narrate", side_effect=AssertionError("audio should be cached")):
                timeline = server.build_timeline(p, shots, folder, "")
            self.assertEqual(timeline["entries"], [(audio, 5.15)])
            self.assertEqual(timeline["shots"][0]["captions"][1]["start"], 4.15)
            self.assertEqual(timeline["shots"][0]["captions"][1]["end"], 5.15)
            self.assertEqual(timeline["frames"], 124)

    def test_legacy_payload_dispatch_remains_available(self):
        p = self.payload()
        with patch.object(server, "render_stage_video", return_value="stage") as modern, \
             patch.object(server, "render_template_video", return_value="template") as legacy:
            self.assertEqual(server.render_video(p, {}, lambda: None, ""), "stage")
            del p["stage"]
            p["template"] = True
            self.assertEqual(server.render_video(p, {}, lambda: None, ""), "template")
            modern.assert_called_once()
            legacy.assert_called_once()

    def test_stage_does_not_resolve_remote_render_assets(self):
        p = self.payload()
        p["items"][0]["content"]["image"] = "https://example.invalid/frame.png"
        with self.assertRaises(ValueError):
            stage_video.stage_input(p, server.ASSETS, server.media_path)

    def test_asset_mode_selects_a_versioned_local_svg(self):
        p = self.payload("asset")
        p["items"][0]["content"].update(assetId="builtin:svg/reading-list", move="pan")
        _, _, shots, _, used = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertTrue(shots[0]["assetUrl"].startswith("file:"))
        self.assertEqual(shots[0]["move"], "pan")
        self.assertEqual([item["kind"] for _, item in used], ["layout", "svg"])

    def test_visual_beats_do_not_truncate_shared_svg_narration(self):
        p = self.payload("svg")
        long_line = "核对本幕的信息和记录。" * 12
        p["items"][0]["line"] = long_line
        p["items"][0]["content"]["beats"] = [{"action": "log", "label": "核对日期", "line": "核对本幕的记录。"}]
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertEqual(shots[0]["line"], long_line)


if __name__ == "__main__":
    unittest.main()
