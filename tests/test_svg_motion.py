import json
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import draft_content
import server
import svg_motion


class SvgMotionTests(unittest.TestCase):
    def test_deepseek_response_controls_each_shot_action(self):
        response = {
            "title": "出门怎么带药",
            "shots": [
                {"name": "药盒和说明书", "beats": [
                    {"line": "出门时把药品保存在各自的原包装里。", "action": "carton", "label": "原包装"},
                    {"line": "需要核对用法时，查看说明书。", "action": "leaflet", "label": "说明书"},
                ]},
                {"name": "检查药包", "beats": [
                    {"line": "按随身携带的清单检查自己带的药。", "action": "travel", "label": "随身药包"}
                ]},
                {"name": "有疑问问药师", "beats": [
                    {"line": "出门前有疑问，可以先咨询药师。", "action": "consult", "label": "咨询药师"}
                ]},
            ],
        }

        def deepseek(path, payload, **options):
            self.assertEqual(path, "/chat/completions")
            self.assertEqual(payload["model"], "deepseek-flash")
            self.assertIn("travel=把药盒和药瓶放进随身药包", payload["messages"][0]["content"])
            return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(response)}}]}

        draft = draft_content.svg_video_draft(deepseek, "deepseek-flash", {"topic": response["title"]}, 30)
        self.assertEqual([shot["action"] for shot in draft["shots"]], ["carton", "travel", "consult"])
        self.assertTrue(all(shot["seconds"] >= 4 for shot in draft["shots"]))
        self.assertEqual([part["action"] for part in draft["shots"][0]["beats"]], ["carton", "leaflet"])
        self.assertIn("需要核对用法时", draft["shots"][0]["line"])
        response["shots"][1]["beats"][0]["action"] = "missing-action"
        with self.assertRaisesRegex(ValueError, "第 2 幕 SVG 分镜无效"):
            draft_content.svg_video_draft(deepseek, "deepseek-flash", {"topic": response["title"]}, 30)

    def test_invalid_visual_is_replanned_with_feedback(self):
        title = "出门整理随身药品"
        wrong = {"action": "compare", "label": "原包装", "line": "不要拆掉原包装。"}
        carton = {**wrong, "action": "carton"}
        log = {"action": "log", "label": "清点药品", "line": "按清单核对。"}
        travel = {"action": "travel", "label": "装入药包", "line": "把原包装收进药包。"}
        consult = {"action": "consult", "label": "问药师", "line": "有问题可以咨询药师。"}
        def make(head):
            return {"title": title, "shots": [
                {"name": "保留包装", "beats": [head, travel]},
                {"name": "清点药品", "beats": [log]},
                {"name": "问药师", "beats": [consult]},
            ]}

        with patch.object(draft_content, "ask_json", side_effect=[make(wrong), make(carton)]) as ask:
            draft = draft_content.svg_video_draft(None, "deepseek-flash", {"topic": title}, 30)
            self.assertEqual(ask.call_count, 2)
            self.assertIn("警示画面与口播不符", ask.call_args.args[-2]["检查结果"])
            self.assertEqual([beat["action"] for beat in draft["shots"][0]["beats"]], ["carton", "travel"])
        with self.assertRaisesRegex(ValueError, "重复了同一个道具"):
            draft_content.parse_svg_motion_draft(make(travel), 4)

    def test_svg_draft_routes_without_a_seedance_model(self):
        draft_content.validate_request(
            {"type": "video", "topic": "怎样核对用药说明书", "videoMode": "svg"},
            {"duration": 30, "ratio": "16:9"},
            {},
        )

    def test_svg_render_reads_the_shared_template_profile(self):
        layout, avatar = server.svg_template_layout({"title": "药品说明书"})
        self.assertEqual((layout["theme"], layout["presenter"]), ("medical", "digital"))
        self.assertEqual(avatar.name, "template-doctor-digital.jpg")
        layout, avatar = server.svg_template_layout({
            "title": "药品说明书",
            "svgLayout": {"theme": "warm", "presenter": "cartoon", "pharmacist": {"name": "测试药师"}},
        })
        self.assertEqual(layout["pharmacist"]["name"], "测试药师")
        self.assertEqual(avatar.name, "template-doctor-cartoon.jpg")
        with self.assertRaises(ValueError):
            server.svg_template_layout({
                "title": "药品说明书",
                "svgLayout": {"pharmacist": {"avatarImage": "https://example.org/picture.jpg"}},
            })

    def test_caption_progress_uses_export_cue_boundaries(self):
        line = "先看清楚药品说明书上的用法用量。然后检查注意事项，有疑问就咨询药师。"
        duration = 7.2
        vtt_cues = list(server.shot_caption_intervals(line, 4.0, duration, "16:9"))
        preview = server.svg_caption_progress(line, duration)
        self.assertEqual([cue["text"] for cue in preview], [cue["text"] for cue in vtt_cues])
        for before, after in zip(preview, vtt_cues):
            self.assertAlmostEqual(4.0 + before["end"] * duration, after["end"])
        self.assertAlmostEqual(preview[-1]["end"], 1.0)

    def test_same_scene_beats_follow_the_narration_in_order(self):
        first = {"line": "翻开说明书。", "action": "leaflet", "label": "说明书"}
        second = {"line": "再看药盒。", "action": "carton", "label": "药盒"}
        line = first["line"] + second["line"]
        shot = {"name": "核对信息", "action": "leaflet", "line": line, "beats": [first, second], "seconds": 4}
        svg_motion.validate_shot(shot)
        timing = server.svg_caption_progress(line, 5.5, shot["beats"])
        self.assertEqual([cue["text"] for cue in timing], [first["line"], second["line"]])
        self.assertAlmostEqual(timing[0]["end"], len(first["line"]) / len(line))
        self.assertAlmostEqual(timing[1]["end"], 1.0)
        with self.assertRaisesRegex(ValueError, "动作片段必须"):
            svg_motion.validate_shot({**shot, "line": "口播与动作不一致。"})

    def test_audio_and_motion_share_the_frame_grid(self):
        frames, motion = svg_motion.timing(5.037, estimated=20)
        self.assertEqual((frames, motion), (131, 121))
        self.assertGreaterEqual(frames / svg_motion.FPS, 5.037 + 0.4)
        self.assertLess(abs(motion / svg_motion.FPS - 5.037), 1 / svg_motion.FPS)
        self.assertEqual(svg_motion.timing(0, estimated=4), (96, 95))

    def test_export_reuses_preview_audio_for_the_same_work(self):
        def narrate(line, speaker, audio, key):
            with wave.open(str(audio), "wb") as track:
                track.setparams((1, 2, server.SPEECH_SAMPLE_RATE, 0, "NONE", "not compressed"))
                track.writeframes(b"\0\0" * server.SPEECH_SAMPLE_RATE)
            return len(line)

        payload = {"settings": {"voice": next(iter(server.SPEAKERS))}, "workId": "preview-work"}
        shot = {"line": "核对说明书。"}
        rows = []
        with tempfile.TemporaryDirectory() as root, patch.object(server, "MEDIA", Path(root)), \
                patch.object(server, "narrate", side_effect=narrate) as speak:
            first = server.svg_shot_audio(payload, shot, 0, "test", lambda *row: rows.append(row))
            repeat = server.svg_shot_audio(payload, shot, 0, "test", lambda *row: rows.append(row))
            self.assertEqual(first, repeat)
            self.assertEqual(first[1], 1.0)
            self.assertEqual(speak.call_count, 1)
            self.assertEqual(len(rows), 1)
            second = server.svg_shot_audio({**payload, "workId": "another-work"}, shot, 0, "test", None)
            self.assertNotEqual(first[0], second[0])
            self.assertEqual(speak.call_count, 2)


if __name__ == "__main__":
    unittest.main()
