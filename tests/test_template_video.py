import base64
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

import draft_content
import server


def make_tiny_png(width=4, height=4, rgb=(24, 119, 232)):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgb) * width
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


class TemplateVideoTests(unittest.TestCase):
    def test_template_video_draft_validates_structured_slides(self):
        sample_response = {
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": """{
                        "title": "孩子发烧退烧药怎么吃",
                        "chapters": ["看温度", "选对药", "算剂量", "何时就医"],
                        "slides": [
                            {
                                "type": "cover",
                                "chapterIndex": 0,
                                "leftTop": "发烧先稳住",
                                "leftBottom": "退烧核心是舒服",
                                "headline": "孩子发烧退烧药怎么吃才安全",
                                "accentPhrase": "怎么吃才安全",
                                "lead": "按体重算剂量更稳妥",
                                "pills": ["按体重给药", "认准单一成分", "警惕危险信号"],
                                "spotPrompt": "儿童药瓶和量杯并排放在纯白底面上",
                                "footerNote": "发热本身是免疫防御反应",
                                "highlightWords": ["退烧药"],
                                "line": "孩子发烧时先别慌，按体重和说明书核对退烧药更稳妥。"
                            },
                            {
                                "type": "compare",
                                "chapterIndex": 1,
                                "leftTop": "认准成分",
                                "leftBottom": "不常规交替",
                                "headline": "认准两种常见单一成分",
                                "accentPhrase": "单一成分",
                                "columns": [
                                    {"title": "对乙酰氨基酚", "badge": "三个月以上", "points": ["间隔四到六小时"], "footLabel": "剂型", "footValue": "滴剂或混悬液"},
                                    {"title": "布洛芬", "badge": "六个月以上", "points": ["间隔六到八小时"], "footLabel": "剂型", "footValue": "混悬液"}
                                ],
                                "footerNote": "具体按说明书与医嘱核对",
                                "highlightWords": ["布洛芬"],
                                "line": "常见单一成分是对乙酰氨基酚和布洛芬，不建议常规交替。"
                            },
                            {
                                "type": "summary",
                                "chapterIndex": 3,
                                "leftTop": "药师提醒",
                                "leftBottom": "有疑问问药师",
                                "headline": "记住三条用药原则",
                                "accentPhrase": "三条用药原则",
                                "points": [
                                    {"title": "看精神", "desc": "关注孩子状态"},
                                    {"title": "按体重", "desc": "对照说明书核对"}
                                ],
                                "footerNote": "科普内容仅供参考，具体诊疗与用药请遵医嘱",
                                "highlightWords": ["遵医嘱"],
                                "line": "记住看精神、按体重核对说明书，拿不准及时遵医嘱。"
                            }
                        ]
                    }"""
                },
            }],
        }
        seen = {}

        def fake_ark(path, body, **kwargs):
            seen["body"] = body
            return sample_response

        out = draft_content.template_video_draft(
            fake_ark, "doubao-seed-test", {"topic": "孩子发烧退烧药怎么吃", "drug": "布洛芬混悬液"}
        )
        self.assertEqual(out["title"], "孩子发烧退烧药怎么吃")
        self.assertEqual(len(out["chapters"]), 4)
        self.assertEqual(len(out["slides"]), 3)
        self.assertEqual(out["slides"][0]["type"], "cover")
        self.assertIn("布洛芬混悬液", seen["body"]["messages"][0]["content"])

    def test_upload_frame_and_render_template_mp4(self):
        png_bytes = make_tiny_png()
        data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            media_dir = root / "media"
            jobs_dir = root / "jobs"
            media_dir.mkdir()
            jobs_dir.mkdir()
            with mock.patch.object(server, "MEDIA", media_dir), mock.patch.object(server, "JOBS", jobs_dir):
                uploaded = server.save_uploaded_frame({"dataUrl": data_url})
                self.assertTrue(uploaded["url"].startswith("/media/"))
                self.assertTrue(uploaded["url"].endswith(".png"))

                # Reject invalid magic bytes
                bad = "data:image/png;base64," + base64.b64encode(b"not-a-png").decode("ascii")
                with self.assertRaises(ValueError):
                    server.save_uploaded_frame({"dataUrl": bad})

                payload = {
                    "id": "11111111-1111-4111-8111-111111111111",
                    "mode": "demo",
                    "kind": "video",
                    "template": True,
                    "settings": {"voice": "无配音", "music": "calm", "ratio": "16:9"},
                    "style": 0,
                    "items": [
                        {
                            "line": "第一页口播测试。",
                            "seconds": 3,
                            "cues": [{"image": uploaded["url"], "weight": 1}],
                        },
                        {
                            "line": "第二页口播测试。",
                            "seconds": 3,
                            "cues": [{"image": uploaded["url"], "weight": 1}],
                        },
                    ],
                }
                server.setting_valid(payload)
                job = {"id": payload["id"], "progress": ""}
                out = server.render_video(payload, job, lambda: None, "")
                mp4_file = media_dir / (payload["id"] + ".mp4")
                vtt_file = media_dir / (payload["id"] + ".vtt")
                self.assertTrue(mp4_file.is_file())
                self.assertGreater(mp4_file.stat().st_size, 5000)
                self.assertTrue(vtt_file.is_file())
                self.assertEqual(out["shotSeconds"], [3, 3])


if __name__ == "__main__":
    unittest.main()
