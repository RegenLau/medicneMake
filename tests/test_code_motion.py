import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import wave

import draft_content
import server


def script():
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

    def test_draft_accepts_motion_without_video_model_and_passes_topic_to_deepseek(self):
        item = {"type": "video", "videoMode": "code-motion", "topic": "用药记录怎么写"}
        draft_content.validate_request(item, {"ratio": "16:9", "duration": 30}, {})
        expected = script()
        client = Mock(return_value={"choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps(expected, ensure_ascii=False)},
        }]})
        self.assertEqual(draft_content.code_motion_draft(client, "deepseek-flash", item), expected)
        payload = client.call_args.args[1]
        self.assertIn(item["topic"], payload["messages"][1]["content"])

    def test_composition_validates_five_scenes_and_required_labels(self):
        candidate = script()
        candidate["scenes"].pop()
        with self.assertRaisesRegex(ValueError, "五幕"):
            draft_content.code_motion_script(candidate)
        candidate = script()
        candidate["scenes"][2]["labels"] = ["药名"]
        with self.assertRaisesRegex(ValueError, "第 3 幕"):
            draft_content.code_motion_script(candidate)

    def test_local_render_requires_only_the_selected_speech_service(self):
        candidate = script()
        payload = {
            "mode": "ark", "kind": "video", "codeMotion": True, "title": candidate["title"],
            "items": candidate["scenes"], "settings": {"voice": "无配音", "ratio": "16:9", "music": "off"},
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
