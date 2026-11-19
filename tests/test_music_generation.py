import tempfile
import unittest
from pathlib import Path
from unittest import mock

import music_gen
import server
import work_costs


def make_fake_mp3(size=2048):
    # Minimal ID3 header followed by MPEG frame sync bytes so format detection sees MP3.
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + (b"\x00" * max(0, size - 14))


class MusicGenerationTests(unittest.TestCase):
    def test_verify_minimax_key_switches_region_and_rejects_invalid(self):
        calls = []

        def fake_post(host, path, body, api_key, timeout=15):
            calls.append(host)
            if host == "https://api.minimaxi.com":
                return 200, {"base_resp": {"status_code": 1004, "status_msg": "login fail"}}
            return 200, {"base_resp": {"status_code": 2013, "status_msg": "invalid params"}}

        with mock.patch.object(music_gen, "_minimax_post", side_effect=fake_post):
            host = music_gen.verify_minimax_key("sk-test-global-key")
        self.assertEqual(host, "https://api.minimax.io")
        self.assertEqual(calls, ["https://api.minimaxi.com", "https://api.minimax.io"])

        def always_invalid(host, path, body, api_key, timeout=15):
            return 200, {"base_resp": {"status_code": 1004, "status_msg": "login fail"}}

        with mock.patch.object(music_gen, "_minimax_post", side_effect=always_invalid):
            with self.assertRaises(ValueError):
                music_gen.verify_minimax_key("bad-key")

    def test_plan_prompt_uses_deepseek_and_enforces_instrumental(self):
        captured = {}

        def fake_deepseek(path, body, **kwargs):
            captured["body"] = body
            return {
                "choices": [{
                    "message": {
                        "content": (
                            '{"title":"安心退热·暖色钢琴","mood":"温暖安心","styleLabel":"温暖原声钢琴",'
                            '"bpm":82,"prompt":"Warm felt piano with subtle strings, gentle 82 BPM",'
                            '"description":"贴合儿童退烧科普，温和安抚不抢口播。"}'
                        )
                    }
                }]
            }

        plan = music_gen.plan_music_prompt(
            {
                "title": "孩子发烧退烧药怎么吃",
                "topic": "儿童退烧药",
                "drug": "布洛芬混悬液",
                "lines": ["孩子发烧先别慌，按体重核对剂量更稳妥。"],
            },
            deepseek_fn=fake_deepseek,
            text_model="deepseek-flash",
        )
        self.assertEqual(plan["promptSource"], "deepseek")
        self.assertEqual(plan["title"], "安心退热·暖色钢琴")
        self.assertIn("instrumental", plan["prompt"].lower())
        self.assertIn("布洛芬混悬液", captured["body"]["messages"][1]["content"])

    def test_generate_music_saves_named_file_in_library_and_supports_reuse_rename_delete(self):
        fake_mp3 = make_fake_mp3(4096)
        captured = {}

        def fake_post(host, path, body, api_key, timeout=240):
            captured["host"] = host
            captured["path"] = path
            captured["body"] = body
            return 200, {
                "data": {"audio": fake_mp3.hex(), "status": 2},
                "extra_info": {"music_duration": 64200, "music_sample_rate": 44100},
                "trace_id": "trace-abc",
                "base_resp": {"status_code": 0, "status_msg": "success"},
            }

        with tempfile.TemporaryDirectory() as tmp:
            lib_dir = Path(tmp)
            with mock.patch.object(music_gen, "_minimax_post", side_effect=fake_post):
                out = music_gen.generate_music(
                    {
                        "title": "阿托伐他汀晚上吃还是早上吃",
                        "topic": "降脂药服用时间",
                        "drug": "阿托伐他汀",
                        "lines": ["阿托伐他汀半衰期较长，每天固定时间服用即可。"],
                        "variant": 1,
                    },
                    lib_dir,
                    "mm-test-key",
                    music_model="music-2.6",
                )
            self.assertEqual(captured["path"], "/v1/music_generation")
            self.assertEqual(captured["body"]["model"], "music-2.6")
            self.assertIs(captured["body"]["is_instrumental"], True)
            self.assertTrue(out["url"].startswith("/assets/music/generated/"))
            self.assertIn("阿托伐他汀", out["filename"])
            self.assertTrue(out["filename"].endswith(".mp3"))
            saved = lib_dir / out["filename"]
            self.assertTrue(saved.is_file())
            self.assertEqual(saved.read_bytes(), fake_mp3)
            self.assertEqual(out["duration"], 64.2)

            # Reuse from library works without MiniMax API Key!
            with mock.patch.object(server, "GENERATED_MUSIC_DIR", lib_dir), \
                 mock.patch.object(server, "current_minimax_key", return_value=""):
                lib_choice = "library:" + out["id"]
                server.validate_video_music_settings({"music": lib_choice})
                resolved_path = server.music_path(lib_choice)
                self.assertEqual(resolved_path, saved.resolve())

            # Rename updates both index title and actual filename on disk
            renamed, entries = music_gen.rename_library_track(lib_dir, out["id"], "降脂科普温柔版")
            self.assertEqual(renamed["title"], "降脂科普温柔版")
            self.assertIn("降脂科普温柔版", renamed["filename"])
            self.assertTrue((lib_dir / renamed["filename"]).is_file())
            self.assertFalse(saved.exists())
            self.assertEqual(len(entries), 1)

            # Delete removes file and index entry
            remaining = music_gen.delete_library_track(lib_dir, out["id"])
            self.assertEqual(remaining, [])
            self.assertFalse((lib_dir / renamed["filename"]).exists())

    def test_server_generate_music_request_requires_key_and_records_cost(self):
        fake_mp3 = make_fake_mp3(2048)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lib_dir = root / "generated"
            jobs_dir = root / "jobs"
            lib_dir.mkdir()
            jobs_dir.mkdir()
            work_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

            with mock.patch.object(server, "GENERATED_MUSIC_DIR", lib_dir), \
                 mock.patch.object(server, "JOBS", jobs_dir), \
                 mock.patch.object(server, "current_minimax_key", return_value=""):
                with self.assertRaises(ValueError):
                    server.generate_music_request({"title": "测试视频"})

            def fake_post(host, path, body, api_key, timeout=240):
                return 200, {
                    "data": {"audio": fake_mp3.hex(), "status": 2},
                    "extra_info": {"music_duration": 45000},
                    "base_resp": {"status_code": 0, "status_msg": "success"},
                }

            with mock.patch.object(server, "GENERATED_MUSIC_DIR", lib_dir), \
                 mock.patch.object(server, "JOBS", jobs_dir), \
                 mock.patch.object(server, "current_minimax_key", return_value="mm-key"), \
                 mock.patch.object(server, "current_deepseek_key", return_value=""), \
                 mock.patch.object(music_gen, "_minimax_post", side_effect=fake_post):
                out = server.generate_music_request({
                    "title": "慢病用药提醒",
                    "topic": "高血压",
                    "lines": ["规律服药很重要。"],
                    "musicModel": "music-2.6",
                    "workId": work_id,
                })
                self.assertTrue(out["filename"].endswith(".mp3"))
                self.assertEqual(len(out["library"]), 1)
                self.assertEqual(out["library"][0]["id"], out["id"])
                details = server.cost_details({"workId": work_id, "jobIds": [], "media": []})
                self.assertEqual(len(details["rows"]), 1)
                self.assertEqual(details["rows"][0]["model"], "music-2.6")
                self.assertEqual(details["rows"][0]["amount"], str(work_costs.MUSIC_RATES["music-2.6"]))
                self.assertEqual(details["minimaxPrice"], work_costs.MINIMAX_PRICE)

    def test_setting_valid_checks_minimax_key_for_auto_music(self):
        base_payload = {
            "id": "11111111-1111-4111-8111-111111111111",
            "mode": "ark",
            "kind": "video",
            "template": True,
            "settings": {"voice": "无配音", "music": "auto", "musicModel": "music-2.6", "ratio": "16:9"},
            "style": 0,
            "items": [],
        }
        with mock.patch.object(server, "current_minimax_key", return_value=""):
            with self.assertRaises(ValueError) as ctx:
                server.validate_video_music_settings(base_payload["settings"])
            self.assertIn("MiniMax", str(ctx.exception))

        with mock.patch.object(server, "current_minimax_key", return_value="mm-key"):
            server.validate_video_music_settings(base_payload["settings"])


if __name__ == "__main__":
    unittest.main()
