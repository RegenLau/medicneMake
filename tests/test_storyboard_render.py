import unittest

from server import caption_chunks, code_motion_shot_captions, shot_captions, storyboard_timing


class StoryboardRenderTests(unittest.TestCase):
    def test_automatic_timing_uses_measured_speech_and_reserves_the_tail(self):
        item = {"seconds": 11, "prompt": "镜头聚焦药盒", "autoDuration": True}
        measured = storyboard_timing(item, 5.82, 15, "/media/abc.png")
        self.assertEqual(measured["seconds"], 7)
        self.assertIn("到第 6 秒完成本幕动作", measured["prompt"])
        self.assertIn("剩下的时间平稳移到尾帧", measured["prompt"])
        self.assertEqual(item["seconds"], 11)

    def test_manual_timing_and_limits(self):
        manual = {"seconds": 11, "prompt": "镜头聚焦药盒", "autoDuration": False}
        self.assertEqual(storyboard_timing(manual, 5.82, 15, None)["seconds"], 11)
        auto = {**manual, "autoDuration": True}
        for spoken, seconds in ((0, 11), (1, 4), (14.9, 15)):
            with self.subTest(spoken=spoken):
                self.assertEqual(storyboard_timing(auto, spoken, 15, None)["seconds"], seconds)

    def test_portrait_subtitles_fit_and_end_with_the_speech(self):
        line = "准备越清楚，沟通越高效，用药也更安全。"
        cues = list(shot_captions(line, 14, 3.98, "9:16"))
        self.assertEqual([cue.splitlines()[1] for cue in cues], ["准备越清楚，沟通越高效", "用药也更安全"])
        self.assertTrue(all("position:50% size:84% align:center" in cue for cue in cues))
        self.assertIn("00:00:17.980", cues[-1])

    def test_subtitle_chunks_strip_trailing_punctuation_only(self):
        line = "孩子发烧喂退烧药，关键三点：按体重算剂量，看说明书和医嘱核对，别凭感觉喂。"
        self.assertEqual(
            list(caption_chunks(line, 22)),
            ["孩子发烧喂退烧药，关键三点：按体重算剂量", "看说明书和医嘱核对，别凭感觉喂"],
        )
        self.assertEqual(list(caption_chunks("孩子发烧，退烧药怎么吃才安全？", 22)), ["孩子发烧，退烧药怎么吃才安全"])
        self.assertEqual(list(caption_chunks("记住“按体重算剂量”。", 22)), ["记住“按体重算剂量”"])
        self.assertEqual(list(caption_chunks("体温超过38.5℃别硬扛！", 22)), ["体温超过38.5℃别硬扛"])
        self.assertEqual(list(caption_chunks("先观察……", 22)), ["先观察"])
        beat_cues = code_motion_shot_captions(
            {"line": line, "beats": [{"line": "孩子发烧喂退烧药，关键三点：按体重算剂量，", "focus": "0"}]},
            0.0,
            4.0,
        )
        self.assertEqual([cue["text"] for cue in beat_cues], ["孩子发烧喂退烧药，关键三点：按体重算剂量"])
