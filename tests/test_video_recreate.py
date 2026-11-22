import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import server
import video_recreate


def _make_multi_scene_mp4(ffmpeg_bin, out_path, *, portrait=False):
    """Synthesize a real 6-second 3-scene MP4 (red -> green -> blue) using local FFmpeg."""
    size = "360x640" if portrait else "640x360"
    subprocess.run(
        [
            str(ffmpeg_bin),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f", "lavfi", "-i", f"color=c=red:s={size}:d=2:r=12",
            "-f", "lavfi", "-i", f"color=c=green:s={size}:d=2:r=12",
            "-f", "lavfi", "-i", f"color=c=blue:s={size}:d=2:r=12",
            "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
            "-map", "[v]",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(out_path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )


class VideoRecreateTests(unittest.TestCase):
    def test_detect_video_ext_validates_magic_headers(self):
        self.assertEqual(".mp4", video_recreate.detect_video_ext(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00", "demo.mp4"))
        self.assertEqual(".mov", video_recreate.detect_video_ext(b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00", "demo.mov"))
        self.assertEqual(".webm", video_recreate.detect_video_ext(b"\x1a\x45\xdf\xa3" + b"\x00" * 16, "clip.webm"))
        with self.assertRaisesRegex(ValueError, "MP4"):
            video_recreate.detect_video_ext(b"not a valid video file at all", "bad.mp4")

    def test_analyze_video_and_generate_blueprint_and_motion_md(self):
        self.assertTrue(server.FFMPEG, "FFmpeg should be available in test environment")
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "recreate"
            sample = Path(tmp) / "portrait_sample.mp4"
            _make_multi_scene_mp4(server.FFMPEG, sample, portrait=True)

            record = video_recreate.analyze_video_file(base, server.FFMPEG, sample.read_bytes(), "爆款退烧参考.mp4")
            self.assertEqual("爆款退烧参考", record["title"])
            self.assertEqual("9:16", record["meta"]["aspect"])
            self.assertEqual("portrait", record["meta"]["orientation"])
            self.assertGreaterEqual(record["meta"]["duration"], 5.5)
            self.assertGreaterEqual(len(record["shots"]), 2)
            for sh in record["shots"]:
                self.assertTrue(sh["frameUrl"].startswith(f"/recreate-media/{record['id']}/shot-"))
                fname = sh["frameUrl"].split("/")[-1]
                resolved = video_recreate.resolve_media_file(base, record["id"], fname)
                self.assertTrue(resolved.is_file())
            # Source video file should be cleaned up after extracting keyframes.
            self.assertFalse((base / record["id"] / "source.mp4").exists())

            # Path traversal must be rejected.
            with self.assertRaises(ValueError):
                video_recreate.resolve_media_file(base, record["id"], "../meta.json")
            with self.assertRaises(ValueError):
                video_recreate.resolve_media_file(base, "../../etc", "shot-00.jpg")

            # Generate blueprint via mocked DeepSeek client.
            mock_bp = {
                "title": "退烧误区反转三步法",
                "hookStrategy": "前 2 秒红字抛出常见误区并定调核心原则",
                "pacingSummary": "每幕约 2 秒快节奏推进，重点留停 1.2 秒",
                "visualStyle": "医疗网格底纹 + 精绘矢量图标 + 底部高对比药师提醒胶囊",
                "recommendedLayoutId": "builtin:layout/qa-chat",
                "recommendedTheme": "builtin:theme/medical",
                "styleTags": ["误区反转", "快节奏"],
                "shots": [
                    {
                        "name": "开场抛误区",
                        "seconds": 2,
                        "pointType": "cover",
                        "kind": "scene",
                        "transition": "fade",
                        "narrationRole": "提出孩子发烧用药最常见误区",
                        "choreography": "0.1s 标题入场 → 0.4s 徽章弹入",
                        "shotPrompt": "顶部警示胶囊与超大核心结论卡，配 shield 图标",
                        "sampleLine": "孩子发烧吃退烧药，先别急着按年龄估量。",
                        "icons": ["shield", "thermometer"],
                    },
                    {
                        "name": "核对说明书",
                        "seconds": 2,
                        "pointType": "checklist",
                        "kind": "scene",
                        "transition": "wipe",
                        "narrationRole": "列出剂型与剂量核对要点",
                        "choreography": "0.2s 双卡交错 → 0.7s 绿勾 DrawSVG 划出",
                        "shotPrompt": "左右核对清单卡，带 leaflet 与 check 图标",
                        "sampleLine": "看清剂型，按说明书和医嘱核对用量与间隔。",
                        "icons": ["leaflet", "check"],
                    },
                    {
                        "name": "问药师收口",
                        "seconds": 2,
                        "pointType": "summary",
                        "kind": "scene",
                        "transition": "slide",
                        "narrationRole": "安全收口提醒",
                        "choreography": "0.15s 收口胶囊弹入后稳定停留",
                        "shotPrompt": "底部居中高对比药师提醒胶囊，配 doctor 图标",
                        "sampleLine": "拿不准就先问医生或药师。",
                        "icons": ["doctor"],
                    },
                ],
            }
            fake_client = Mock(return_value={
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(mock_bp, ensure_ascii=False)}}]
            })
            updated = video_recreate.generate_blueprint(fake_client, "deepseek-flash", base, {
                "id": record["id"],
                "notes": "前 2 秒强反差提问",
                "targetTopic": "孩子发烧退烧药怎么吃",
                "targetDrug": "对乙酰氨基酚片",
                "shotNotes": {"0": "开场大字"},
            })
            self.assertEqual("退烧误区反转三步法", updated["blueprint"]["title"])
            self.assertEqual("builtin:layout/qa-chat", updated["blueprint"]["recommendedLayoutId"])
            self.assertIsNotNone(updated["blueprint"]["portraitLayoutDraft"])
            self.assertIn("recommended_layout: \"builtin:layout/qa-chat\"", updated["motionMd"])
            self.assertIn("## 9:16 竖屏安全区参考", updated["motionMd"])

            listed = video_recreate.list_records(base)
            self.assertEqual(1, len(listed))
            self.assertEqual(record["id"], listed[0]["id"])

            video_recreate.delete_record(base, record["id"])
            self.assertEqual([], video_recreate.list_records(base))


if __name__ == "__main__":
    unittest.main()
