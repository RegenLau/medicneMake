import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import asset_library
import mix_plan
import server
import stage_video
from test_mix_plan import model_response, script_fixture


class StickersAndClipTests(unittest.TestCase):
    def test_fluent_sticker_library_has_at_least_30_tagged_stickers(self):
        stickers = [
            item for item in server.ASSETS.items()
            if item["kind"] == "image" and "贴纸" in (item.get("tags") or ())
        ]
        self.assertGreaterEqual(len(stickers), 30)
        for st in stickers:
            path, _ = server.ASSETS.resolve(st["id"], ("image",))
            self.assertTrue(path.is_file())
            self.assertTrue(path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_plan_stickers_validation_enforces_candidates_cue_keyword_anchor_and_limits(self):
        script = script_fixture()
        # Expand to 5 shots so we can test total <= 8 and same asset <= 2
        while len(script["shots"]) < 5:
            script["shots"].append({
                "name": f"第{len(script['shots'])+1}幕",
                "line": "记住按时吃药，千万别加倍。",
                "seconds": 4,
                "chapterIndex": 1,
                "points": {"type": "warning", "headline": "提醒", "items": [{"title": "别加倍", "detail": "", "tag": ""}]},
                "cues": [
                    {"text": "记住按时吃药，", "focus": "0", "weight": 7},
                    {"text": "千万别加倍。", "focus": "0", "weight": 6},
                ],
            })
        raw_reply = {"shots": [
            {"index": 0, "stickers": [
                {"assetId": "builtin:image/not-in-library", "cue": 0, "anchor": "media-tr"},
                {"assetId": "builtin:image/fluent-warning", "cue": 99, "anchor": "media-tr"},
                {"assetId": "builtin:image/fluent-warning", "cue": 0, "keyword": "不存在的词", "anchor": "media-tr"},
                {"assetId": "builtin:image/fluent-warning", "cue": 0, "keyword": "药盒", "anchor": "invalid-anchor"},
                {"assetId": "builtin:image/fluent-warning", "cue": 0, "keyword": "药盒", "anchor": "media-tr", "size": "m", "enter": "pop", "hold": "stay", "sfx": "auto"},
                {"assetId": "builtin:image/fluent-pill", "cue": 0, "keyword": "", "anchor": "media-br", "size": "s", "enter": "bounce", "hold": "cue", "sfx": "none"},
                # 3rd sticker on shot 0 must be dropped (max 2 per shot)
                {"assetId": "builtin:image/fluent-check", "cue": 0, "anchor": "media-tl"},
            ]},
            {"index": 1, "stickers": [
                {"assetId": "builtin:image/fluent-warning", "cue": 0, "anchor": "media-tr"},
            ]},
            # 3rd use of fluent-warning across video must be dropped (max 2 per video)
            {"index": 2, "stickers": [
                {"assetId": "builtin:image/fluent-warning", "cue": 0, "anchor": "media-tr"},
                {"assetId": "builtin:image/fluent-time", "cue": 0, "anchor": "media-bl"},
            ]},
        ]}
        client = Mock(return_value=model_response(raw_reply))
        planned = mix_plan.plan_stickers(client, "deepseek-flash", {"topic": "出门带药"}, script, server.ASSETS)
        self.assertEqual(2, len(planned[0]))
        self.assertEqual("builtin:image/fluent-warning", planned[0][0]["assetId"])
        self.assertEqual("药盒", planned[0][0]["keyword"])
        self.assertEqual(1, len(planned[1]))
        self.assertEqual(1, len(planned[2]))
        self.assertEqual("builtin:image/fluent-time", planned[2][0]["assetId"])

    def test_stage_input_and_sound_mix_handle_stickers_independently_of_scene_sfx_pack(self):
        payload = {
            "title": "核对药盒",
            "layoutId": stage_video.CLASSIC_LAYOUT,
            "items": [{
                "name": "核对药盒",
                "line": "出门前核对药盒。",
                "seconds": 5,
                "points": {"type": "explain", "items": [{"title": "核对药盒", "detail": "", "tag": ""}]},
                "cues": [{"text": "出门前核对药盒。", "weight": 8, "focus": "0"}],
                "content": {"kind": "card", "form": "big-answer", "variant": "solid", "formData": {"answer": "先核对药盒"}},
                "stickers": [
                    {"assetId": "builtin:image/fluent-warning", "cue": 0, "keyword": "核对", "anchor": "media-tr", "size": "m", "enter": "pop", "hold": "stay", "sfx": "builtin:sfx/check"},
                ],
            }],
        }
        _, _, shots, _, used = stage_video.stage_input(payload, server.ASSETS, server.media_path)
        self.assertEqual(1, len(shots[0]["stickers"]))
        self.assertTrue(shots[0]["stickers"][0]["url"].startswith("file:"))
        self.assertIn("builtin:image/fluent-warning", [item["id"] for _, item in used])

        # Sticker SFX plays even when scene sfx pack is off, and stops when stickerSfx is False
        events = [{"type": "sticker", "sfxId": "builtin:sfx/check", "t": 1.2, "shot": 0}]
        inputs_on, _, sounds_on = server.stage_sound_mix(
            {"audio": {"sfx": {"pack": "off", "gainDb": -14, "stickerSfx": True}}},
            [{"start": 0}], None, "off", 5, False, events,
        )
        self.assertEqual(2, len(inputs_on))
        self.assertEqual(["builtin:sfx/check"], [item["id"] for _, item in sounds_on])

        inputs_off, _, sounds_off = server.stage_sound_mix(
            {"audio": {"sfx": {"pack": "off", "gainDb": -14, "stickerSfx": False}}},
            [{"start": 0}], None, "off", 5, False, events,
        )
        self.assertEqual([], inputs_off)
        self.assertEqual([], sounds_off)

    def test_clip_validation_frame_size_and_video_asset_library(self):
        # Aspect-ratio-aware dimensions for Seedance
        self.assertEqual((1280, 720), server.clip_frame_size("720p", {"w": 960, "h": 540}))
        w_narrow, h_narrow = server.clip_frame_size("720p", {"w": 642, "h": 510})
        self.assertEqual(720, h_narrow)
        self.assertTrue(880 <= w_narrow <= 930 and w_narrow % 2 == 0)
        w_wide, h_wide = server.clip_frame_size("480p", {"w": 1120, "h": 388})
        self.assertEqual(480, h_wide)
        self.assertLessEqual(w_wide / h_wide, 2.21)

        # Create a tiny valid local MP4 via FFmpeg and test both asset_library video kind and stage_input clip validation
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            mp4 = tmp_path / "sample.mp4"
            subprocess.run([
                server.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(mp4),
            ], check=True)
            lib = asset_library.LocalLibrary(tmp_path / "lib", server.ASSETS.builtin_root)
            saved = lib.add("video", mp4.read_bytes(), {"name": "演示片段", "license": "自制或已获授权", "tags": "演示"}, server.FFMPEG, "project")
            self.assertEqual("video", saved["kind"])
            self.assertTrue(saved["thumbnailUrl"].endswith("/poster.jpg"))
            self.assertTrue(lib.motion_preview_file(saved["id"], "poster.jpg").is_file())

            # stage_input validates clip referencing /library/<id>
            from urllib.parse import unquote
            def local_media_path(value):
                if value.startswith("/library/"):
                    return lib.resolve(unquote(value.removeprefix("/library/")), ("video",))[0]
                return server.media_path(value)

            payload = {
                "title": "滴眼药演示",
                "layoutId": stage_video.CLASSIC_LAYOUT,
                "items": [{
                    "name": "轻轻滴入",
                    "line": "滴眼液滴入下眼睑小袋。",
                    "seconds": 4,
                    "points": {"type": "steps", "items": [{"title": "拉开下眼睑", "detail": "", "tag": ""}]},
                    "cues": [{"text": "滴眼液滴入下眼睑小袋。", "weight": 11, "focus": "0"}],
                    "content": {"kind": "clip", "clip": saved["url"], "clipStyle": "demo", "overlay": "points", "clipSpeed": "slow"},
                }],
            }
            _, _, shots, _, used = stage_video.stage_input(payload, lib, local_media_path)
            self.assertEqual("clip", shots[0]["kind"])
            self.assertEqual("demo", shots[0]["clipStyle"])
            self.assertEqual("slow", shots[0]["clipSpeed"])
            self.assertIn(saved["id"], [item["id"] for _, item in used])

            # Reject non-mp4 clip
            bad_payload = json.loads(json.dumps(payload))
            bad_payload["items"][0]["content"]["clip"] = "/assets/template-info-tablet.jpg"
            with self.assertRaisesRegex(ValueError, "MP4"):
                stage_video.stage_input(bad_payload, lib, local_media_path)

    def test_generate_stage_clip_with_mocked_seedance_records_cost_and_writes_poster(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            media_dir = tmp_path / "media"
            jobs_dir = tmp_path / "jobs"
            media_dir.mkdir()
            jobs_dir.mkdir()
            sample_mp4 = tmp_path / "fake_seedance.mp4"
            subprocess.run([
                server.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=teal:s=320x180:d=4",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(sample_mp4),
            ], check=True)

            def fake_source_clip(p, item, dest, state, save, tail_image=None, on_success=None, dimensions=None):
                self.assertEqual((1280, 720), dimensions)
                state["remote"] = "task-fake-1"
                save()
                if on_success:
                    on_success({"duration": 4, "usage": {"completion_tokens": 90000}})
                dest.write_bytes(sample_mp4.read_bytes())

            recorded = {}
            job = {"id": "11111111-1111-1111-1111-111111111111", "costs": {}}
            p = {
                "settings": {
                    "videoModel": "doubao-seedance-2-5-flash-261115",
                    "resolution": "720p",
                    "ratio": "16:9",
                    "targetSize": {"w": 960, "h": 540},
                },
                "clip": {
                    "shotIndex": 0,
                    "clipStyle": "demo",
                    "prompt": "近景柔和光线，手拿滴管量取液体。",
                    "image": "/assets/template-info-tablet.jpg",
                    "seconds": 4,
                },
            }
            with patch.object(server, "MEDIA", media_dir), patch.object(server, "JOBS", jobs_dir), \
                 patch.object(server, "source_clip", side_effect=fake_source_clip):
                out = server.generate_stage_clip(p, job, lambda: None, lambda k, v: recorded.__setitem__(k, v))
            self.assertEqual("/media/11111111-1111-1111-1111-111111111111.mp4", out["clip"])
            self.assertEqual("/media/11111111-1111-1111-1111-111111111111.jpg", out["clipPoster"])
            self.assertTrue((media_dir / "11111111-1111-1111-1111-111111111111.mp4").is_file())
            self.assertTrue((media_dir / "11111111-1111-1111-1111-111111111111.jpg").is_file())
            self.assertIn("stage-clip:0", recorded)
            self.assertIsNotNone(out["clipCost"])


if __name__ == "__main__":
    unittest.main()
