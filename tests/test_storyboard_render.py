import unittest

from server import shot_captions, storyboard_timing


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
        self.assertEqual("".join(cue.splitlines()[1] for cue in cues), line)
        self.assertEqual([cue.splitlines()[1] for cue in cues], ["准备越清楚，沟通越高效，", "用药也更安全。"])
        self.assertTrue(all("position:50% size:84% align:center" in cue for cue in cues))
        self.assertIn("00:00:17.980", cues[-1])
