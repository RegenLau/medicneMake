import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave

import draft_content
import server


def dynamic_script(scene_count=4):
    base_scenes = [
        {
            "name": "降压药忘吃怎么办",
            "chapterIndex": 0,
            "visual": "hook",
            "motion": "focus-zoom",
            "motif": "clock",
            "tone": "primary",
            "takeaway": "按距下次服药时间判断，绝不补吃双倍",
            "items": [
                {"title": "不补吃双倍", "detail": "", "tag": ""},
                {"title": "看间隔时间", "detail": "", "tag": ""},
            ],
            "beats": [
                {"focus": "question", "line": "早上忘吃降压药，晚上要不要吃两片？", "highlightWords": ["忘吃"]},
                {"focus": "answer", "line": "千万别补吃双倍，先看离下次吃药还有多久。", "highlightWords": ["双倍"]},
            ],
            "line": "早上忘吃降压药，晚上要不要吃两片？千万别补吃双倍，先看离下次吃药还有多久。",
        },
        {
            "name": "分两种情况处理",
            "chapterIndex": 0,
            "visual": "timeline",
            "motion": "flow",
            "motif": "clock",
            "tone": "warm",
            "takeaway": "具体漏服处理以所购药品说明书为准",
            "items": [
                {"title": "尽快补服一次", "detail": "按常规剂量服用", "tag": "刚忘不久"},
                {"title": "跳过本次不补", "detail": "下次仍吃原剂量", "tag": "临近下次"},
            ],
            "beats": [
                {"focus": "0", "line": "刚过服药时间不久，一般可尽快补服常规一次。", "highlightWords": ["常规一次"]},
                {"focus": "1", "line": "如果快到下次服药时间，直接跳过这一次。", "highlightWords": ["跳过"]},
            ],
            "line": "刚过服药时间不久，一般可尽快补服常规一次。如果快到下次服药时间，直接跳过这一次。",
        },
        {
            "name": "防漏服核对清单",
            "chapterIndex": 1,
            "visual": "checklist",
            "motion": "spotlight",
            "motif": "checklist",
            "tone": "safe",
            "listTitle": "少漏服三招",
            "takeaway": "规律服药比临时补救更稳妥",
            "items": [
                {"title": "绑定早餐或洗漱", "detail": "固定动作提醒服药", "tag": ""},
                {"title": "使用周分格药盒", "detail": "吃没吃一眼可见", "tag": ""},
                {"title": "设闹钟记血压", "detail": "复诊时带给医生看", "tag": ""},
            ],
            "beats": [
                {"focus": "0", "line": "平时可以把吃药和早餐绑定在一起。", "highlightWords": ["绑定"]},
                {"focus": "1", "line": "再用周分格药盒配合手机闹钟提醒。", "highlightWords": ["分格药盒"]},
            ],
            "line": "平时可以把吃药和早餐绑定在一起。再用周分格药盒配合手机闹钟提醒。",
        },
        {
            "name": "这些情况尽快就医",
            "chapterIndex": 2,
            "visual": "warning",
            "motion": "pulse",
            "motif": "alert",
            "tone": "caution",
            "takeaway": "出现头晕胸闷请立即坐下并尽快就医评估",
            "items": [
                {"title": "误服双倍后头晕心慌", "detail": "先坐下防跌倒并测血压", "tag": "重点"},
                {"title": "血压骤升伴剧烈头痛", "detail": "伴胸闷或麻木立即急诊", "tag": "急诊"},
            ],
            "beats": [
                {"focus": "0", "line": "如果误服双倍后头晕心慌，先坐下测血压。", "highlightWords": ["头晕心慌"]},
                {"focus": "action", "line": "出现剧烈头痛或胸闷，请尽快就医评估。", "highlightWords": ["就医"]},
            ],
            "line": "如果误服双倍后头晕心慌，先坐下测血压。出现剧烈头痛或胸闷，请尽快就医评估。",
        },
        {
            "name": "长效短效有差别",
            "chapterIndex": 1,
            "visual": "compare",
            "motion": "contrast",
            "motif": "none",
            "tone": "primary",
            "takeaway": "翻看药盒说明书确认漏服处理条款",
            "items": [
                {"title": "长效降压药", "detail": "作用平稳持久；漏服补服窗口相对宽", "tag": "每日一次"},
                {"title": "短效降压药", "detail": "作用时间较短；更需按时按间隔服用", "tag": "每日多次"},
            ],
            "line": "长效和短效降压药作用时间不同，具体漏服处理先看说明书。",
        },
        {
            "name": "稳压安心口诀",
            "chapterIndex": 2,
            "visual": "summary",
            "motion": "focus-zoom",
            "motif": "shield",
            "tone": "safe",
            "takeaway": "刚忘早补、临近跳过、绝不补双倍",
            "items": [],
            "line": "记住刚忘早补、临近跳过、绝不吃双倍，稳压更安心。",
        },
    ]
    chosen = base_scenes[:scene_count]
    chapters = ["看时间", "防漏服", "就医提醒"] if scene_count >= 4 else ["看时间", "防漏服"]
    for scene in chosen:
        scene["chapterIndex"] = min(scene["chapterIndex"], len(chapters) - 1)
    return {
        "title": "降压药忘吃了要不要补吃双倍",
        "shortTitle": "降压药 · 漏服处理",
        "chapters": chapters,
        "scenes": chosen,
    }


def legacy_five_script():
    return {
        "title": "用药记录怎么写",
        "scenes": [
            {"name": "记录用药", "line": "先把正在用的药记下来。", "takeaway": "用药记录", "labels": labels}
            for labels in ([], ["药盒", "处方"], ["药品名称", "使用时间"], ["核对药名", "记录时间"], [])
        ],
    }


class CodeMotionTests(unittest.TestCase):
    def test_switching_templates_reuses_matching_wav_from_prior_job(self):
        work_id = "7feb94f9-a697-4527-a114-b7402323e18e"
        prior_id = "57607ade-0344-4095-9d1f-c53a716b1882"
        url = f"/media/{prior_id}.mp4"
        line = "先把正在用的药记下来。"
        settings = {"voice": "流畅女声 2.0"}
        p = {"workId": work_id, "settings": settings, "previousVideo": url, "items": [{"line": line}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(server, "JOBS", Path(folder)):
            previous = Path(folder) / prior_id / "0"
            previous.mkdir(parents=True)
            server.write_json(Path(folder) / f"{prior_id}.json", {
                "request": {"workId": work_id}, "output": {"url": url},
            })
            path = previous / server.speech_cache_name(settings, line)
            with wave.open(str(path), "wb") as wav:
                wav.setparams((1, 2, server.SPEECH_SAMPLE_RATE, 0, "NONE", "not compressed"))
                wav.writeframes(bytes(server.SPEECH_SAMPLE_RATE * 2))
            with patch.object(server, "narrate", side_effect=AssertionError("must not synthesize")):
                duplicate = previous.parent / "1" / path.name
                duplicate.parent.mkdir()
                with wave.open(str(duplicate), "wb") as wav:
                    wav.setparams((1, 2, server.SPEECH_SAMPLE_RATE, 0, "NONE", "not compressed"))
                    wav.writeframes(bytes(server.SPEECH_SAMPLE_RATE * 4))
                cached = server.cached_template_speech(p)
                self.assertTrue(server.has_template_speech(p))
                self.assertEqual(server.template_shot_audio(settings, line, None, "", 0, None, cached), (path, 1))
                self.assertEqual(server.template_shot_audio(settings, line, None, "", 1, None, cached), (duplicate, 2))
            self.assertFalse(server.has_template_speech({**p, "workId": "different-work"}))
            self.assertFalse(server.has_template_speech({**p, "settings": {"voice": "男声"}}))

    def test_draft_accepts_motion_without_video_model_and_adapts_to_topic_and_duration(self):
        item = {"type": "video", "videoMode": "code-motion", "topic": "降压药忘吃了要不要补吃双倍"}
        draft_content.validate_request(item, {"ratio": "16:9", "duration": 60}, {})
        raw = dynamic_script(4)
        client = Mock(return_value={"choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps(raw, ensure_ascii=False)},
        }]})
        result = draft_content.code_motion_draft(client, "deepseek-flash", item, reference_seconds=60)
        self.assertEqual(len(result["scenes"]), 4)
        self.assertEqual([s["visual"] for s in result["scenes"]], ["hook", "timeline", "checklist", "warning"])
        self.assertEqual([s["motion"] for s in result["scenes"]], ["focus-zoom", "flow", "spotlight", "pulse"])
        self.assertEqual(result["chapters"], ["看时间", "防漏服", "就医提醒"])
        payload = client.call_args.args[1]
        sys_prompt = payload["messages"][0]["content"]
        self.assertIn("严禁固定套模板", sys_prompt)
        self.assertIn("参考时长（60 秒）", sys_prompt)
        self.assertIn(item["topic"], payload["messages"][1]["content"])

    def test_draft_auto_repairs_invalid_visual_and_tightens_overlong_script(self):
        invalid = dynamic_script(3)
        invalid["scenes"][1]["visual"] = "unknown-layout"
        overlong = dynamic_script(6)
        for scene in overlong["scenes"]:
            scene["line"] = "这是一段用来测试超长口播自动压缩逻辑的完整中文讲解语句。" * 4
            scene.pop("beats", None)
        tight = dynamic_script(3)
        responses = [invalid, overlong, tight]
        calls = []

        def fake_client(path, body, **_):
            idx = len(calls)
            calls.append(body)
            return {"choices": [{
                "finish_reason": "stop",
                "message": {"content": json.dumps(responses[min(idx, len(responses) - 1)], ensure_ascii=False)},
            }]}

        item = {"type": "video", "videoMode": "code-motion", "topic": "降压药忘吃了怎么办"}
        result = draft_content.code_motion_draft(fake_client, "deepseek-flash", item, reference_seconds=30)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result["scenes"]), 3)
        self.assertLessEqual(sum(s["seconds"] for s in result["scenes"]), 34)

    def test_composition_supports_flexible_scene_counts_and_validates_visual_constraints(self):
        for count in (2, 3, 4, 6):
            parsed = draft_content.code_motion_script(dynamic_script(count))
            self.assertEqual(len(parsed["scenes"]), count)

        legacy = draft_content.code_motion_script(legacy_five_script())
        self.assertEqual(len(legacy["scenes"]), 5)
        self.assertEqual([s["visual"] for s in legacy["scenes"]], ["hook", "mechanism", "compare", "checklist", "summary"])
        self.assertEqual(legacy["scenes"][1]["labels"], ["药盒", "处方"])

        too_few = dynamic_script(2)
        too_few["scenes"].pop()
        with self.assertRaisesRegex(ValueError, "2–12 幕"):
            draft_content.code_motion_script(too_few)

        bad_compare = dynamic_script(5)
        bad_compare["scenes"][4]["items"] = [{"title": "只有一栏", "detail": "", "tag": ""}]
        with self.assertRaisesRegex(ValueError, "compare"):
            draft_content.code_motion_script(bad_compare)

        bad_motion = dynamic_script(3)
        bad_motion["scenes"][0]["motion"] = "spin-wildly"
        with self.assertRaisesRegex(ValueError, "动效方式无效"):
            draft_content.code_motion_script(bad_motion)

    def test_local_render_requires_only_the_selected_speech_service(self):
        candidate = dynamic_script(3)
        payload = {
            "mode": "ark",
            "kind": "video",
            "codeMotion": True,
            "title": candidate["title"],
            "shortTitle": candidate["shortTitle"],
            "chapters": candidate["chapters"],
            "items": candidate["scenes"],
            "settings": {"voice": "无配音", "ratio": "16:9", "music": "off"},
        }
        with (
            patch.object(server, "code_motion_ready", return_value=True),
            patch.object(server, "current_ark_key", return_value=None) as ark,
            patch.object(server, "current_speech_key", return_value=None) as speech,
        ):
            server.setting_valid(payload)
            speech.assert_not_called()
            payload["settings"]["voice"] = "流畅女声 2.0"
            with self.assertRaisesRegex(ValueError, "请先配置火山语音"):
                server.setting_valid(payload)
            ark.assert_not_called()

    def test_code_motion_shot_captions_preserves_beat_focus_and_highlights(self):
        scene = dynamic_script(3)["scenes"][0]
        cues = server.code_motion_shot_captions(scene, 0.0, 8.0)
        self.assertGreaterEqual(len(cues), 2)
        self.assertEqual(cues[0]["focus"], "question")
        self.assertEqual(cues[-1]["focus"], "answer")
        self.assertIn("忘吃", cues[0]["highlightWords"])
        self.assertAlmostEqual(cues[-1]["end"], 8.0, places=3)

    def test_appearance_accepts_legacy_defaults_and_validates_portrait(self):
        self.assertEqual(server.code_motion_appearance({}), {
            "theme": "medical", "presenter": "digital", "pharmacist": {},
        })
        appearance = {
            "theme": "warm", "presenter": "digital",
            "pharmacist": {"name": "测试药师", "avatarImage": "/assets/template-doctor-digital.jpg"},
        }
        self.assertEqual(server.code_motion_appearance({"appearance": appearance}), appearance)
        appearance["pharmacist"]["avatarImage"] = "/assets/music/calm.flac"
        with self.assertRaises(ValueError):
            server.code_motion_appearance({"appearance": appearance})
