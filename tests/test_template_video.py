import base64
import json
import shutil
import struct
import tempfile
import unittest
import wave
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


def make_cutout_rgba_png(width=128, height=72, hole_box=(8, 12, 32, 32), bg_rgb=(20, 90, 220)):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    hx, hy, hw, hh = hole_box
    cx, cy, r2 = hx + hw / 2.0, hy + hh / 2.0, (min(hw, hh) / 2.0) ** 2
    rows = bytearray()
    bg = bytes((*bg_rgb, 255))
    clear = b"\x00\x00\x00\x00"
    for y in range(height):
        rows.append(0)
        for x in range(width):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                rows.extend(clear)
            else:
                rows.extend(bg)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(rows)))
        + chunk(b"IEND", b"")
    )


def make_silent_wav(path, seconds=2.0, rate=server.SPEECH_SAMPLE_RATE):
    frames = round(seconds * rate)
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(b"\x00\x00" * frames)
    return path


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
        self.assertIn("40–60 秒", seen["body"]["messages"][0]["content"])
        self.assertIn("不要把每个主题都硬套", seen["body"]["messages"][0]["content"])

    def test_template_video_draft_respects_reference_duration(self):
        captured = []

        def fake_ds(path, body, **kwargs):
            captured.append(body["messages"][0]["content"])
            return {
                "model": body["model"],
                "choices": [{
                    "finish_reason": "stop",
                    "message": {
                        "content": """{
                            "title": "滴眼液怎么滴",
                            "chapters": ["先准备", "怎么滴", "记心里"],
                            "slides": [
                                {"type": "cover", "headline": "滴眼液怎么滴", "line": "滴眼液别直接往黑眼球上滴。"},
                                {"type": "explain", "headline": "正确滴入下结膜囊", "lead": "拉下眼皮形成小口袋更稳妥", "points": [{"title": "别滴黑眼球", "desc": "直接刺激角膜易眨眼流出", "tag": "常见误区"}, {"title": "滴入下眼睑", "desc": "轻轻拉开下眼皮滴一滴即可", "tag": "更稳妥"}], "line": "轻轻拉下眼皮滴进下结膜囊，别直接滴黑眼球。"},
                                {"type": "summary", "headline": "记住两点", "points": [{"title": "洗手", "desc": "先洗净双手"}, {"title": "闭眼", "desc": "轻按内眼角"}], "line": "先洗手再轻拉下眼皮滴药，闭眼按压内眼角。"}
                            ]
                        }"""
                    },
                }],
            }

        req = {
            "mode": "ark",
            "kind": "draft",
            "draft": {"type": "video", "videoMode": "template", "topic": "滴眼液怎么滴", "drug": ""},
            "settings": {"ratio": "16:9", "duration": 90, "textModel": "deepseek-flash"},
        }
        job = {"request": req}
        with mock.patch.object(server, "deepseek", side_effect=fake_ds):
            server.write_draft(req, job, lambda: None)
        self.assertEqual(len(captured), 1)
        self.assertIn("参考总时长为 90 秒", captured[0])
        self.assertIn("必须严格控制在 94 秒以内", captured[0])
        self.assertIn("265 到 330 字", captured[0])
        self.assertEqual(job["output"]["chapters"], ["先准备", "怎么滴", "记心里"])
        self.assertEqual(job["output"]["slides"][1]["type"], "explain")
        self.assertEqual(len(job["output"]["slides"][1]["points"]), 2)

    def test_template_video_draft_auto_tightens_overlong_60s_script_under_65s(self):
        prompts = []
        long_deck = {
            "title": "腿抽筋先别急着补钙",
            "shortTitle": "腿抽筋 · 别急着补钙",
            "chapters": ["先弄清楚", "怎么处理", "注意啥", "记心里"],
            "slides": [
                {
                    "type": "cover",
                    "headline": "腿抽筋，先别急着补钙",
                    "beats": [
                        {"label": "提问", "focus": "question", "line": "半夜腿抽筋，是不是就是缺钙了？"},
                        {"label": "给答案", "focus": "answer", "line": "不一定，先分清是偶尔抽筋，还是反复发作再决定。"},
                    ],
                },
                {
                    "type": "explain",
                    "headline": "常见诱因不止缺钙",
                    "points": [{"title": "劳累与受凉", "desc": "白天走多路或夜里吹风受凉更常见"}],
                    "beats": [
                        {"label": "常见原因", "focus": "0", "line": "很多人一抽筋就买钙片，觉得补钙能断根。其实偶尔腿抽筋更多和白天过度劳累、晚上小腿受凉或者出汗补水不够有关，盲目吃钙片往往解决不了问题。"},
                    ],
                },
                {
                    "type": "steps",
                    "headline": "抽筋当下这样缓",
                    "steps": [
                        {"title": "勾脚尖", "desc": "慢慢伸直腿把脚尖往身体方向轻勾"},
                        {"title": "热敷按摩", "desc": "轻揉小腿并注意保暖"},
                    ],
                    "beats": [
                        {"label": "第一步", "focus": "0", "line": "抽筋时先慢慢把腿伸直，脚尖往身体方向轻轻勾，不要猛地硬掰。"},
                        {"label": "第二步", "focus": "1", "line": "随后轻轻按摩小腿肌肉并注意保暖，平时记下发作时间和频率，方便医生判断。"},
                    ],
                },
                {
                    "type": "warning",
                    "headline": "这些情况尽快就医",
                    "warnings": [
                        {"title": "频繁反复发作", "desc": "一周多次或每晚都抽"},
                        {"title": "伴肿胀麻木", "desc": "小腿肿胀发凉或麻木无力"},
                    ],
                    "footerNote": "出现以上情况请立即就医评估。",
                    "beats": [
                        {"label": "警示", "focus": "0", "line": "如果一周抽筋很多次，或者小腿明显肿胀发凉、腿脚麻木没劲，又或者服药期间新出现抽筋，都要尽快就医评估查明原因。"},
                    ],
                },
                {
                    "type": "summary",
                    "headline": "记住两个重点",
                    "points": [
                        {"title": "先辨原因", "desc": "偶尔多为受凉疲劳，反复发作去查因"},
                        {"title": "当下先拉伸", "desc": "勾脚尖配合轻揉保暖"},
                    ],
                    "outroNote": "抽筋先分辨，别急着补钙",
                    "beats": [
                        {"label": "要点", "focus": "0", "line": "记住两点：偶尔抽筋多和疲劳受凉有关，当下先勾脚尖拉伸保暖；如果反复发作或伴肿麻，及时就医别自己长期大量补钙。"},
                        {"label": "收口", "focus": "outro", "line": "把这两点记住，腿抽筋处理起来更安心。"},
                    ],
                },
            ],
        }
        tight_deck = {
            "title": "腿抽筋先别急着补钙",
            "shortTitle": "腿抽筋 · 别急着补钙",
            "chapters": ["先弄清", "怎么缓", "何时就医"],
            "slides": [
                {
                    "type": "cover",
                    "headline": "腿抽筋，先别急着补钙",
                    "beats": [
                        {"label": "提问", "focus": "question", "line": "半夜腿抽筋就是缺钙吗？"},
                        {"label": "结论", "focus": "answer", "line": "不一定，偶尔多是疲劳受凉。"},
                    ],
                },
                {
                    "type": "explain",
                    "headline": "先分清诱因再处理",
                    "points": [
                        {"title": "偶尔发作", "desc": "多与劳累、受凉或补水不足有关"},
                        {"title": "反复发作", "desc": "别盲目吃钙片，先找医生查因"},
                    ],
                    "beats": [
                        {"label": "偶尔", "focus": "0", "line": "偶尔抽筋多和走路劳累、夜里受凉有关，不必急着吃钙片。"},
                        {"label": "反复", "focus": "1", "line": "频繁发作建议就医查原因。"},
                    ],
                },
                {
                    "type": "steps",
                    "headline": "抽筋当下两步缓解",
                    "steps": [
                        {"title": "勾脚尖", "desc": "伸直腿，脚尖朝身体轻勾"},
                        {"title": "轻揉保暖", "desc": "轻按小腿肚，盖好保暖"},
                    ],
                    "beats": [
                        {"label": "缓解", "focus": "0", "line": "发作时伸直腿轻勾脚尖，再轻揉小腿保暖，多数很快能缓过来。"},
                    ],
                },
                {
                    "type": "summary",
                    "headline": "有这些信号要就医",
                    "points": [
                        {"title": "频繁或伴肿麻", "desc": "小腿肿胀发凉、麻木无力尽快就医"},
                    ],
                    "outroNote": "抽筋先分辨，别盲目补钙",
                    "beats": [
                        {"label": "就医", "focus": "0", "line": "若一周多次发作，或伴腿肿发凉、麻木，或服药后新发，请尽快就医。"},
                        {"label": "收口", "focus": "outro", "line": "先分辨再处理，更安心。"},
                    ],
                },
            ],
        }
        responses = [long_deck, tight_deck]

        def fake_ds(path, body, **kwargs):
            prompts.append(body["messages"][0]["content"])
            payload = responses[min(len(prompts) - 1, len(responses) - 1)]
            return {
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(payload, ensure_ascii=False)},
                }],
            }

        out = draft_content.template_video_draft(
            fake_ds, "deepseek-flash", {"topic": "腿抽筋，先别急着补钙", "drug": ""}, reference_seconds=60,
        )
        self.assertEqual(len(prompts), 2)
        self.assertIn("已超出硬性上限（必须 ≤ 64 秒）", prompts[1])
        total_seconds = sum(s["seconds"] for s in out["slides"])
        self.assertLess(total_seconds, 65)
        self.assertEqual(len(out["slides"]), 4)
        self.assertEqual([s["type"] for s in out["slides"]], ["cover", "explain", "steps", "summary"])
        self.assertEqual(out["chapters"], ["先弄清", "怎么缓", "何时就医"])
        # line is synced directly from beats
        self.assertEqual(out["slides"][0]["line"], "半夜腿抽筋就是缺钙吗？不一定，偶尔多是疲劳受凉。")

    def test_template_video_draft_supports_flexible_counts_and_short_30s_deck(self):
        short_deck = {
            "title": "缓释片为什么不能掰开吃",
            "chapters": ["先看结论", "记住做法"],
            "slides": [
                {
                    "type": "cover",
                    "headline": "缓释片能掰开吃吗？",
                    "question": "药片太大，能掰开吃吗？",
                    "answer": "缓释片通常不能随意掰开或嚼碎。",
                    "pills": [],
                    "beats": [
                        {"label": "提问", "focus": "question", "line": "药片太大，能掰开吃吗？"},
                        {"label": "结论", "focus": "answer", "line": "缓释片通常不能随便掰。"},
                    ],
                },
                {
                    "type": "explain",
                    "headline": "掰开会破坏缓慢释放结构",
                    "lead": "药物一次全释放，既增风险又降疗效",
                    "points": [
                        {"title": "血药浓度骤升", "desc": "短时间释放过多易引起不良反应"},
                    ],
                    "beats": [
                        {"label": "原理", "focus": "0", "line": "掰开会破坏缓释结构，药效一次释放出来，既容易不舒服又撑不到下一次吃药。"},
                    ],
                },
                {
                    "type": "summary",
                    "headline": "吞服困难怎么办",
                    "points": [
                        {"title": "先查说明书或问药师", "desc": "看是否有刻痕或可换剂型"},
                    ],
                    "outroNote": "拿不准先看说明书或问药师",
                    "beats": [
                        {"label": "提醒", "focus": "0", "line": "吞不下先看说明书或问药师能不能换剂型。"},
                        {"label": "收口", "focus": "outro", "line": "别自己硬掰。"},
                    ],
                },
            ],
        }

        def fake_ds(path, body, **kwargs):
            return {
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(short_deck, ensure_ascii=False)},
                }],
            }

        out = draft_content.template_video_draft(
            fake_ds, "deepseek-flash", {"topic": "缓释片为什么不能掰开吃", "drug": ""}, reference_seconds=30,
        )
        self.assertEqual(len(out["slides"]), 3)
        self.assertEqual(len(out["chapters"]), 2)
        self.assertEqual(out["slides"][1]["type"], "explain")
        self.assertEqual(len(out["slides"][1]["points"]), 1)
        self.assertEqual(len(out["slides"][2]["points"]), 1)
        self.assertLess(sum(s["seconds"] for s in out["slides"]), 35)

    def test_template_card_image_generation_ark_and_rejects_demo(self):
        png_bytes = make_tiny_png()
        b64_png = base64.b64encode(png_bytes).decode("ascii")
        ark_req = {
            "id": "22222222-2222-4222-8222-222222222222",
            "mode": "ark",
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
                }
            ],
        }
        with self.assertRaises(ValueError):
            server.setting_valid({**ark_req, "mode": "demo"})

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
                    "mode": "ark",
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

    def test_dashscope_key_validation_and_multipart_upload(self):
        with self.assertRaises(ValueError):
            server.connect_dashscope("   ")
        fake_policy = {
            "upload_host": "https://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com",
            "upload_dir": "dashscope-instant/testdir",
            "oss_access_key_id": "ak-test",
            "policy": "policy-b64",
            "signature": "sig-b64",
            "x_oss_object_acl": "private",
            "x_oss_forbid_overwrite": "true",
        }
        with mock.patch.object(server, "dashscope_get_policy", return_value=fake_policy), \
             mock.patch.object(server, "persist_key") as mock_persist:
            old_key = server.PAGE_DASHSCOPE_KEY
            try:
                status = server.connect_dashscope("sk-valid-key-123")
                self.assertTrue(status["dashscopeKeyPresent"])
                self.assertEqual(status["dashscopeKeySource"], "page")
                mock_persist.assert_called_once_with("dashscope", "sk-valid-key-123")
            finally:
                server.PAGE_DASHSCOPE_KEY = old_key

        captured = {}

        class FakeResp:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["body"] = req.data
            captured["ct"] = req.headers.get("Content-type") or req.headers.get("Content-Type")
            return FakeResp()

        with tempfile.TemporaryDirectory() as tmp:
            sample_file = Path(tmp) / "portrait.png"
            sample_file.write_bytes(make_tiny_png())
            with mock.patch.object(server, "dashscope_get_policy", return_value=fake_policy), \
                 mock.patch.object(server, "urlopen", side_effect=fake_urlopen):
                oss_url = server.dashscope_upload_file(sample_file, "liveportrait", key="sk-test")
                self.assertTrue(oss_url.startswith("oss://dashscope-instant/testdir/"))
                self.assertTrue(oss_url.endswith(".png"))
                self.assertEqual(captured["url"], fake_policy["upload_host"])
                self.assertIn(b'name="OSSAccessKeyId"', captured["body"])
                self.assertIn(b'name="file"', captured["body"])
                # Aliyun OSS requires the file field to appear after policy/key fields.
                self.assertGreater(captured["body"].index(b'name="file"'), captured["body"].index(b'name="key"'))

    def test_partition_avatar_chunks_keeps_whole_video_under_limit_and_splits_long_decks(self):
        short_entries = [(None, 12.0)] * 5
        self.assertEqual(len(server.partition_avatar_chunks(short_entries, max_seconds=server.VIDEORETALK_MAX_CHUNK_SECONDS)), 1)
        long_entries = [(None, 40.0)] * 4  # 160s > 115s
        chunks = server.partition_avatar_chunks(long_entries, max_seconds=server.VIDEORETALK_MAX_CHUNK_SECONDS)
        self.assertEqual(len(chunks), 2)
        self.assertEqual(len(chunks[0]), 2)
        self.assertEqual(len(chunks[1]), 2)

        # Balanced sub-splitting guarantees a single 25s WAV splits evenly under 18s (12.5s + 12.5s).
        with tempfile.TemporaryDirectory() as tmp:
            long_wav = make_silent_wav(Path(tmp) / "long.wav", seconds=25.0)
            parts = server.split_wav_file_balanced(long_wav, 18.0, Path(tmp), "long")
            self.assertEqual(len(parts), 2)
            for p_wav, p_sec in parts:
                self.assertTrue(p_wav.is_file())
                self.assertAlmostEqual(p_sec, 12.5, places=1)

    def test_template_avatar_whole_video_composite_multi_layout_and_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            media_dir = root / "media"
            jobs_dir = root / "jobs"
            cache_dir = root / "avatar_cache"
            for d in (media_dir, jobs_dir, cache_dir):
                d.mkdir()

            # Build two RGBA cutout PNGs with holes at two different positions (simulating explain + outro layouts).
            cutout_1 = "data:image/png;base64," + base64.b64encode(
                make_cutout_rgba_png(128, 72, hole_box=(8, 12, 32, 32), bg_rgb=(20, 90, 220))
            ).decode("ascii")
            cutout_2 = "data:image/png;base64," + base64.b64encode(
                make_cutout_rgba_png(128, 72, hole_box=(48, 8, 24, 24), bg_rgb=(20, 90, 220))
            ).decode("ascii")
            avatar_png = "data:image/png;base64," + base64.b64encode(make_tiny_png(64, 64, (220, 40, 40))).decode("ascii")

            # Generate a real bright-red 256x256 8-second MP4 acting as Bailian output.
            mock_avatar_src = root / "red_avatar.mp4"
            server.run_ffmpeg(
                "-f", "lavfi", "-i", "color=c=0xee2222:s=256x256:r=24:d=8",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", mock_avatar_src,
            )

            with mock.patch.object(server, "MEDIA", media_dir), \
                 mock.patch.object(server, "JOBS", jobs_dir), \
                 mock.patch.object(server, "AVATAR_CACHE", cache_dir), \
                 mock.patch.object(server, "current_speech_key", return_value="speech-test"), \
                 mock.patch.object(server, "current_dashscope_key", return_value="dash-test"):
                u1 = server.save_uploaded_frame({"dataUrl": cutout_1})["url"]
                u2 = server.save_uploaded_frame({"dataUrl": cutout_2})["url"]
                u_avatar = server.save_uploaded_frame({"dataUrl": avatar_png})["url"]

                payload = {
                    "id": "33333333-3333-4333-8333-333333333333",
                    "mode": "ark",
                    "kind": "video",
                    "template": True,
                    "settings": {"voice": "流畅女声 2.0", "music": "off", "ratio": "16:9"},
                    "avatar": {
                        "enabled": True,
                        "model": "videoretalk",
                        "presenter": "digital",
                        "image": u_avatar,
                        "rect": {"x": 80, "y": 120, "size": 320},
                    },
                    "style": 0,
                    "items": [
                        {
                            "line": "第一页数字人测试口播。",
                            "seconds": 4,
                            "cues": [{"image": u1, "weight": 1, "avatarRect": {"x": 80, "y": 120, "size": 320}}],
                        },
                        {
                            "line": "第二页换版式继续连续口播。",
                            "seconds": 4,
                            "cues": [{"image": u2, "weight": 1, "avatarRect": {"x": 480, "y": 80, "size": 240}}],
                        },
                    ],
                }
                server.setting_valid(payload)

                # Retired liveportrait model must fail with clear guidance.
                with self.assertRaises(ValueError):
                    server.setting_valid({**payload, "avatar": {**payload["avatar"], "model": "liveportrait"}})

                # Missing dashscope key must fail validation when voiced & avatar enabled.
                with mock.patch.object(server, "current_dashscope_key", return_value=""):
                    with self.assertRaises(ValueError):
                        server.setting_valid(payload)

                avatar_calls = []

                def fake_shot_audio(settings, line, folder, speech_key, index=0, record=None):
                    wav_path = make_silent_wav(folder / f"speech-{index}.wav", seconds=3.0)
                    return wav_path, 3.0

                def fake_avatar_clip(model, source_path, audio_path, params, dest, key, state, save, **kwargs):
                    avatar_calls.append({"model": model, "source": source_path, "audio": audio_path, "params": params})
                    if model == "videoretalk":
                        # Must have built a real 640x640 MP4 base video and set video_extension=True.
                        self.assertEqual(source_path.suffix, ".mp4")
                        self.assertTrue(source_path.is_file())
                        self.assertTrue(params.get("video_extension"))
                    else:
                        self.assertEqual(source_path.suffix, ".png")
                        self.assertEqual(params.get("resolution"), "480P")
                    shutil.copyfile(mock_avatar_src, dest)
                    if kwargs.get("on_success"):
                        kwargs["on_success"]({"usage": {"video_duration": 7.1}})

                costs_1 = []
                with mock.patch.object(server, "shot_audio", side_effect=fake_shot_audio), \
                     mock.patch.object(server, "dashscope_detect_face", return_value={"check_pass": True}) as mock_detect, \
                     mock.patch.object(server, "dashscope_avatar_clip", side_effect=fake_avatar_clip):
                    job = {"id": payload["id"], "progress": "", "remote": {}}
                    out = server.render_video(payload, job, lambda: None, "speech-test", lambda k, r: costs_1.append((k, r)), "dash-test")
                    self.assertEqual(len(avatar_calls), 1)
                    self.assertEqual(mock_detect.call_count, 0)  # videoretalk does not call wan2.2-s2v-detect
                    self.assertTrue(any(r["model"] == "videoretalk" and r["amount"] == "0.5680" for _, r in costs_1))

                    mp4_file = media_dir / (payload["id"] + ".mp4")
                    self.assertTrue(mp4_file.is_file())
                    self.assertEqual(out["shotSeconds"], [4, 4])

                    # Sample frame at t=1.0s (slide 1) and verify red avatar shows through circle hole while outside stays blue.
                    raw_rgb = root / "frame1.rgb"
                    server.run_ffmpeg(
                        "-ss", "1.0", "-i", mp4_file, "-frames:v", 1,
                        "-f", "rawvideo", "-pix_fmt", "rgb24", raw_rgb,
                    )
                    frame_bytes = raw_rgb.read_bytes()
                    def px(x, y):
                        off = (y * 1280 + x) * 3
                        return frame_bytes[off], frame_bytes[off + 1], frame_bytes[off + 2]

                    inside_hole = px(240, 280)   # center of hole_box (80..400, 120..440)
                    outside_hole = px(1000, 360) # right infographic area
                    self.assertGreater(inside_hole[0], 180)
                    self.assertLess(inside_hole[2], 80)
                    self.assertGreater(outside_hole[2], 160)
                    self.assertLess(outside_hole[0], 80)

                    # Second run with identical audio + avatar must hit AVATAR_CACHE with 0 remote calls and ¥0 cost.
                    payload2 = {
                        **payload,
                        "id": "44444444-4444-4444-8444-444444444444",
                        "settings": {**payload["settings"], "music": "calm"},
                        "items": [
                            {**payload["items"][0]},
                            {**payload["items"][1], "cues": [{"image": u1, "weight": 1, "avatarRect": {"x": 80, "y": 120, "size": 320}}]},
                        ],
                    }
                    costs_2 = []
                    job2 = {"id": payload2["id"], "progress": "", "remote": {}}
                    server.render_video(payload2, job2, lambda: None, "speech-test", lambda k, r: costs_2.append((k, r)), "dash-test")
                    self.assertEqual(len(avatar_calls), 1)
                    self.assertTrue(any(r["model"] == "videoretalk" and r["amount"] == "0" for _, r in costs_2))
                    self.assertTrue((media_dir / (payload2["id"] + ".mp4")).is_file())

                    # Third run with wan2.2-s2v calls wan2.2-s2v-detect + wan2.2-s2v.
                    payload3 = {
                        **payload,
                        "id": "55555555-5555-4555-8555-555555555555",
                        "avatar": {**payload["avatar"], "model": "wan2.2-s2v", "resolution": "480P", "presenter": "cartoon"},
                    }
                    costs_3 = []
                    job3 = {"id": payload3["id"], "progress": "", "remote": {}}
                    server.render_video(payload3, job3, lambda: None, "speech-test", lambda k, r: costs_3.append((k, r)), "dash-test")
                    self.assertEqual(len(avatar_calls), 2)
                    self.assertEqual(mock_detect.call_count, 1)
                    self.assertTrue(any(r["model"] == "wan2.2-s2v" and r["amount"] == "3.5500" for _, r in costs_3))

    def test_template_video_draft_beats_chapters_and_safety_rules(self):
        five_slide_resp = {
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": """{
                        "title": "阿托伐他汀一定要晚上吃吗",
                        "shortTitle": "阿托伐他汀 · 服用时间",
                        "chapters": ["先弄清楚", "怎么吃", "注意啥", "记心里"],
                        "slides": [
                            {
                                "type": "cover",
                                "layoutMode": "hook",
                                "name": "一定要晚上吃吗",
                                "chapterIndex": 0,
                                "headline": "阿托伐他汀，一定要晚上吃吗？",
                                "question": "阿托伐他汀，一定要晚上吃吗？",
                                "answer": "一般任意时间均可服用，每天固定时间更关键",
                                "pills": ["任意时间均可", "每天固定时间"],
                                "beats": [
                                    {"label": "核心疑问", "focus": "question", "line": "阿托伐他汀，一定要晚上吃吗？", "highlightWords": ["晚上吃"]},
                                    {"label": "直接结论", "focus": "answer", "line": "一般一天中任意时间均可服用，每天固定更关键。", "highlightWords": ["任意时间"]}
                                ]
                            },
                            {
                                "type": "compare",
                                "name": "早晚区别",
                                "chapterIndex": 1,
                                "headline": "短效与长效他汀有区别",
                                "columns": [
                                    {"title": "短效他汀", "points": ["常建议晚间服"]},
                                    {"title": "长效他汀", "points": ["固定时间即可"]}
                                ],
                                "beats": [
                                    {"label": "短效", "focus": "0", "line": "短效他汀常建议晚间吃。"},
                                    {"label": "长效", "focus": "1", "line": "长效他汀固定时间吃即可。"}
                                ]
                            },
                            {
                                "type": "steps",
                                "name": "三步清单",
                                "chapterIndex": 2,
                                "headline": "按时服药三步清单",
                                "steps": [
                                    {"title": "固定时间", "desc": "绑定固定生活动作", "key": "每天同一时间"},
                                    {"title": "设好提醒", "desc": "用分药盒或闹钟", "key": "防遗忘漏服"},
                                    {"title": "复诊带清单", "desc": "合用新药先沟通", "key": "带齐用药清单"}
                                ],
                                "beats": [
                                    {"label": "第一步", "focus": "0", "line": "第一步，固定每天同一时间。"},
                                    {"label": "第二步", "focus": "1", "line": "第二步，设好闹钟和分药盒。"},
                                    {"label": "第三步", "focus": "2", "line": "第三步，复诊带齐用药清单。"}
                                ]
                            },
                            {
                                "type": "warning",
                                "name": "及时就医",
                                "chapterIndex": 3,
                                "headline": "出现这些情况尽快就医",
                                "warnings": [
                                    {"title": "肌肉酸痛无力", "desc": "持续酸痛或发软"},
                                    {"title": "尿色变深", "desc": "尿液呈浓茶色"},
                                    {"title": "持续恶心", "desc": "右上腹不适"},
                                    {"title": "皮肤发黄", "desc": "眼白或皮肤发黄"}
                                ],
                                "footerNote": "出现严重信号请立即就医评估。",
                                "beats": [
                                    {"label": "肌痛尿色", "focus": "top", "line": "如果肌肉酸痛无力或尿色变深。"},
                                    {"label": "肝功异常", "focus": "bottom", "line": "或持续恶心皮肤发黄。"},
                                    {"label": "立即就医", "focus": "action", "line": "请立即就医评估。"}
                                ]
                            },
                            {
                                "type": "summary",
                                "name": "三句口诀",
                                "chapterIndex": 3,
                                "headline": "三句口诀记住要点",
                                "points": [
                                    {"title": "时间看医嘱", "desc": "按说明书核对"},
                                    {"title": "每天固定吃", "desc": "减少漏服"},
                                    {"title": "异常早就医", "desc": "及时联系医生药师"}
                                ],
                                "outroNote": "固定时间服药，有异常及时就医问药师",
                                "outroImagePrompt": "温暖安心的16:9结尾收口卡片，居中大字展示固定时间服药提醒，配健康盾牌与药盒扁平插画",
                                "beats": [
                                    {"label": "第一句", "focus": "0", "line": "第一句，时间按医嘱来。"},
                                    {"label": "第二句", "focus": "1", "line": "第二句，每天固定时间吃。"},
                                    {"label": "第三句", "focus": "2", "line": "第三句，异常及时就医。"},
                                    {"label": "收尾", "focus": "outro", "line": "记住这三句，用药更安心。"}
                                ]
                            }
                        ]
                    }"""
                },
            }],
        }
        seen = {}

        def fake_ds(path, body, **kwargs):
            seen["prompt"] = body["messages"][0]["content"]
            return five_slide_resp

        out = draft_content.template_video_draft(
            fake_ds, "deepseek-flash", {"topic": "降脂药他汀，为什么常建议晚上吃？", "drug": "阿托伐他汀钙片"}
        )
        self.assertEqual(out["shortTitle"], "阿托伐他汀 · 服用时间")
        # Guardrail must normalize misaligned [0, 1, 2, 3, 3] into [0, 0, 1, 2, 3]
        self.assertEqual([s["chapterIndex"] for s in out["slides"]], [0, 0, 1, 2, 3])
        self.assertEqual(out["slides"][0]["layoutMode"], "hook")
        self.assertEqual(out["slides"][0]["question"], "阿托伐他汀，一定要晚上吃吗？")
        self.assertIn("任意时间", out["slides"][0]["answer"])
        self.assertEqual(len(out["slides"][2]["beats"]), 3)
        self.assertIn("第一步", out["slides"][2]["line"])
        self.assertEqual(out["slides"][4]["outroNote"], "固定时间服药，有异常及时就医问药师")
        self.assertIn("结尾收口卡片", out["slides"][4]["outroImagePrompt"])
        self.assertIn("outroImagePrompt", seen["prompt"])
        self.assertIn("黄金前 8 秒", seen["prompt"])
        self.assertIn("严禁在 warnings 或 footerNote 中写", seen["prompt"])

    def test_template_video_xfade_transitions_and_validation(self):
        png_a = "data:image/png;base64," + base64.b64encode(make_tiny_png(16, 16, (20, 102, 204))).decode("ascii")
        png_b = "data:image/png;base64," + base64.b64encode(make_tiny_png(16, 16, (230, 89, 45))).decode("ascii")
        png_c = "data:image/png;base64," + base64.b64encode(make_tiny_png(16, 16, (30, 142, 90))).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            media_dir = root / "media"
            jobs_dir = root / "jobs"
            media_dir.mkdir()
            jobs_dir.mkdir()
            with mock.patch.object(server, "MEDIA", media_dir), mock.patch.object(server, "JOBS", jobs_dir):
                ua = server.save_uploaded_frame({"dataUrl": png_a})["url"]
                ub = server.save_uploaded_frame({"dataUrl": png_b})["url"]
                uc = server.save_uploaded_frame({"dataUrl": png_c})["url"]

                payload = {
                    "id": "55555555-5555-4555-8555-555555555555",
                    "mode": "ark",
                    "kind": "video",
                    "template": True,
                    "settings": {"voice": "无配音", "music": "off", "ratio": "16:9"},
                    "style": 0,
                    "items": [
                        {
                            "line": "第一步，固定时间。第二步，设好提醒。第三步，复诊沟通。",
                            "seconds": 6,
                            "tailPause": 0.55,
                            "cues": [
                                {"image": ua, "weight": 8, "transition": "cut"},
                                {"image": ub, "weight": 8, "transition": "fade"},
                                {"image": uc, "weight": 8, "transition": "cut"},
                            ],
                        },
                        {
                            "line": "把这三句记住，用药更安心。",
                            "seconds": 4,
                            "tailPause": 1.15,
                            "cues": [
                                {"image": ub, "weight": 10, "transition": "cut"},
                                {"image": uc, "weight": 10, "transition": "outro"},
                            ],
                        },
                    ],
                }
                server.setting_valid(payload)

                # Invalid transition and tailPause must be rejected
                bad_trans = {
                    **payload,
                    "items": [{**payload["items"][0], "cues": [{"image": ua, "weight": 1, "transition": "zoom"}]}],
                }
                with self.assertRaises(ValueError):
                    server.setting_valid(bad_trans)
                bad_pause = {
                    **payload,
                    "items": [{**payload["items"][0], "tailPause": 9.0}],
                }
                with self.assertRaises(ValueError):
                    server.setting_valid(bad_pause)

                job = {"id": payload["id"], "progress": ""}
                out = server.render_video(payload, job, lambda: None, "")
                mp4_file = media_dir / (payload["id"] + ".mp4")
                self.assertTrue(mp4_file.is_file())
                self.assertGreater(mp4_file.stat().st_size, 5000)
                self.assertEqual(out["shotSeconds"], [6, 4])

    def test_render_template_mp4_with_progress_ring(self):
        png_bytes = make_tiny_png(16, 16, (237, 245, 253))
        data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            media_dir = root / "media"
            jobs_dir = root / "jobs"
            media_dir.mkdir()
            jobs_dir.mkdir()
            with mock.patch.object(server, "MEDIA", media_dir), mock.patch.object(server, "JOBS", jobs_dir):
                u = server.save_uploaded_frame({"dataUrl": data_url})["url"]
                ring_a = {"x": 60, "y": 160, "size": 176, "stroke": 6, "color": "#e67835"}
                ring_b = {"x": 82, "y": 140, "size": 104, "stroke": 4, "color": "#e67835"}
                payload = {
                    "id": "55555555-5555-4555-8555-555555555555",
                    "mode": "ark",
                    "kind": "video",
                    "template": True,
                    "settings": {"voice": "无配音", "music": "off", "ratio": "16:9"},
                    "style": 0,
                    "items": [
                        {
                            "line": "第一页测试。",
                            "seconds": 3,
                            "cues": [
                                {"image": u, "weight": 1, "transition": "cut", "progressRing": ring_a},
                                {"image": u, "weight": 1, "transition": "fade", "progressRing": ring_b},
                            ],
                        },
                        {
                            "line": "第二页测试。",
                            "seconds": 3,
                            "cues": [
                                {"image": u, "weight": 1, "transition": "cut", "progressRing": ring_a},
                            ],
                        },
                    ],
                }
                server.setting_valid(payload)
                job = {"id": payload["id"], "progress": ""}
                out = server.render_video(payload, job, lambda: None, "")
                mp4_file = media_dir / (payload["id"] + ".mp4")
                self.assertTrue(mp4_file.is_file())
                self.assertGreater(mp4_file.stat().st_size, 5000)
                self.assertEqual(out["shotSeconds"], [3, 3])


if __name__ == "__main__":
    unittest.main()
