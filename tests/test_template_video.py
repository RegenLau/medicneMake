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
                                "name": "发烧先稳住",
                                "chapterIndex": 0,
                                "headline": "孩子发烧退烧药怎么吃才安全",
                                "accentPhrase": "怎么吃才安全",
                                "lead": "按体重算剂量更稳妥",
                                "pills": ["按体重给药", "认准单一成分", "警惕危险信号"],
                                "imagePrompt": "儿童退烧封面信息图，画药瓶、量杯与三个核心要点标签",
                                "footerNote": "发热本身是免疫防御反应",
                                "highlightWords": ["退烧药"],
                                "line": "孩子发烧时先别慌，按体重和说明书核对退烧药更稳妥。"
                            },
                            {
                                "type": "compare",
                                "name": "认准成分",
                                "chapterIndex": 1,
                                "headline": "认准两种常见单一成分",
                                "accentPhrase": "单一成分",
                                "imagePrompt": "左右双栏对比信息图，对比对乙酰氨基酚与布洛芬",
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
                                "name": "药师提醒",
                                "chapterIndex": 3,
                                "headline": "记住三条用药原则",
                                "accentPhrase": "三条用药原则",
                                "imagePrompt": "三条总结口诀卡片信息图",
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
        self.assertEqual(out["disclaimer"], "科普内容仅供参考，具体诊疗与用药请遵医嘱")
        self.assertEqual(len(out["slides"]), 3)
        self.assertEqual(out["slides"][0]["type"], "cover")
        self.assertEqual(out["slides"][0]["name"], "发烧先稳住")
        self.assertIn("儿童退烧封面信息图", out["slides"][0]["imagePrompt"])
        self.assertIn("布洛芬混悬液", seen["body"]["messages"][0]["content"])

    def test_template_card_image_generation_demo_and_ark(self):
        png_bytes = make_tiny_png()
        b64_png = base64.b64encode(png_bytes).decode("ascii")
        demo_req = {
            "id": "22222222-2222-4222-8222-222222222222",
            "mode": "demo",
            "kind": "images",
            "template": True,
            "styleReference": False,
            "settings": {
                "imageModel": "doubao-seedream-5-5-261028",
                "imageSize": "2K",
                "ratio": "16:9",
                "watermark": True,
                "videoModel": "doubao-seedance-2-5-flash-261115",
                "resolution": "720p",
                "voice": "无配音",
            },
            "style": 0,
            "items": [
                {
                    "prompt": "测试模板科普卡片图",
                    "variant": 1,
                    "fallbackImage": "/assets/template-info-fever.jpg",
                }
            ],
        }
        server.setting_valid(demo_req)
        demo_img = server.image_item(demo_req, demo_req["items"][0], 0)
        self.assertEqual(demo_img, "/assets/template-info-fever.jpg")
        self.assertTrue(server.media_path(demo_img).is_file())

        ark_req = {**demo_req, "mode": "ark"}
        captured = {}
        recorded = []

        def fake_ark(path, body):
            captured["path"] = path
            captured["body"] = body
            return {"data": [{"b64_json": b64_png, "size": "2848x1600"}]}

        with tempfile.TemporaryDirectory() as tmp:
            media_dir = Path(tmp)
            with mock.patch.object(server, "MEDIA", media_dir), \
                 mock.patch.object(server, "current_ark_key", return_value="ark-test"), \
                 mock.patch.object(server, "ark", side_effect=fake_ark):
                server.setting_valid(ark_req)
                out_url = server.image_item(ark_req, ark_req["items"][0], 0, lambda k, row: recorded.append(row))
                self.assertTrue(out_url.startswith("/media/"))
                self.assertTrue((media_dir / out_url.split("/")[-1]).is_file())
                self.assertEqual(captured["path"], "/images/generations")
                self.assertEqual(captured["body"]["size"], "2848x1600")
                self.assertNotIn("image", captured["body"])
                self.assertEqual(len(recorded), 1)
                self.assertEqual(recorded[0]["amount"], "0.23")

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
