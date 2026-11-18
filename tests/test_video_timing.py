import json
import unittest

from draft_content import time_video, validate_request, video_draft


VIDEO = {"type": "video", "topic": "去药房咨询前，准备好这3点"}
BEATS = [
    {"name": "说明准备要点", "line": "去药房咨询前，先准备好这3件事，能帮药师更快给你准确建议。", "scene": "药房柜台"},
    {"name": "症状与用药史", "line": "带好你的症状描述、正在服用的药品或药盒，以及有没有过敏史和基础病。", "scene": "资料清单"},
    {"name": "结尾总结", "line": "准备越清楚，沟通越高效，用药也更安全。", "scene": "药盒与记录本"},
]


class VideoTimingTests(unittest.TestCase):
    def test_reference_is_optional(self):
        for settings in ({}, {"duration": None}, {"duration": 30}):
            with self.subTest(settings=settings):
                validate_request(VIDEO, {**settings, "videoModel": "test"}, {"test": None})
        with self.assertRaisesRegex(ValueError, "参考时长"):
            validate_request(VIDEO, {"duration": 23, "videoModel": "test"}, {"test": None})

    def test_reference_guides_drafting_without_padding_shots(self):
        for reference in (None, 30, 120):
            with self.subTest(reference=reference):
                prompts = []

                def ark(path, body, **_):
                    prompts.append(body["messages"][0]["content"])
                    return {"choices": [{"finish_reason": "stop", "message": {
                        "content": json.dumps({"title": VIDEO["topic"], "beats": BEATS}),
                    }}]}

                draft = video_draft(ark, "test", VIDEO, reference, 15)
                self.assertEqual(len(prompts), 1)
                if reference:
                    self.assertIn(f"参考时长为 {reference} 秒", prompts[0])
                else:
                    self.assertNotIn("参考时长为", prompts[0])
                self.assertEqual([shot["seconds"] for shot in draft["shots"]], [8, 9, 6])
                self.assertEqual([shot["line"] for shot in draft["shots"]], [beat["line"] for beat in BEATS])

    def test_narration_may_run_past_the_reference(self):
        beat = {**BEATS[0], "line": "".join(b["line"] for b in BEATS)}
        beats = [beat, *BEATS[1:]]
        content = json.dumps({"title": VIDEO["topic"], "beats": beats})

        def ark(*args, **kwargs):
            return {"choices": [{"finish_reason": "stop", "message": {"content": content}}]}

        draft = video_draft(ark, "test", VIDEO, 30, 15)
        self.assertGreater(sum(shot["seconds"] for shot in draft["shots"]), 30)
        self.assertTrue(all(4 <= shot["seconds"] <= 15 for shot in draft["shots"]))
        self.assertEqual("".join(shot["line"] for shot in draft["shots"]), "".join(beat["line"] for beat in beats))

    def test_shot_limit_keeps_narration_in_order(self):
        beats = [{"name": str(i), "line": f"第{i}点。", "scene": "柜台"} for i in range(13)]
        shots = time_video(beats, 15)
        self.assertEqual(len(shots), 12)
        self.assertEqual("".join(shot["line"].replace(" ", "") for shot in shots),
                         "".join(beat["line"] for beat in beats))
