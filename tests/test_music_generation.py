import tempfile
import unittest
from pathlib import Path
from unittest import mock

import music_gen
import server
import work_costs


def make_fake_mp3(size=2048):
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + (b"\x00" * max(0, size - 14))


class MusicGenerationTests(unittest.TestCase):
    def test_verify_mureka_key_switches_region_and_rejects_invalid(self):
        calls = []

        def fake_req(host, path, api_key, body=None, timeout=15):
            calls.append((host, path))
            if host == "https://api.mureka.cn":
                return 401, {"error": {"message": "Invalid Authentication"}}
            return 200, {"account_id": 123, "balance": 500, "total_spending": 100}

        with mock.patch.object(music_gen, "_mureka_request", side_effect=fake_req):
            host, billing = music_gen.verify_mureka_key("mk-global-key")
        self.assertEqual(host, "https://api.mureka.ai")
        self.assertEqual(billing["balance"], 500)
        self.assertEqual(calls, [("https://api.mureka.cn", "/v1/account/billing"), ("https://api.mureka.ai", "/v1/account/billing")])

        with mock.patch.object(
            music_gen,
            "_mureka_request",
            return_value=(401, {"error": {"message": "Invalid Authentication"}}),
        ):
            with self.assertRaises(ValueError):
                music_gen.verify_mureka_key("bad-key")

    def test_plan_prompt_uses_deepseek_and_enforces_instrumental(self):
        captured = {}

        def fake_deepseek(path, body, **kwargs):
            captured["body"] = body
            return {
                "choices": [{
                    "message": {
                        "content": (
                            '{"title":"安心退热·暖色钢琴","mood":"温暖安心","styleLabel":"温暖原声钢琴",'
                            '"bpm":82,"prompt":"warm felt acoustic piano, soft strings, 82 bpm, soothing medical mood",'
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

    def test_generate_music_polls_mureka_and_supports_library_reuse_rename_delete(self):
        fake_mp3 = make_fake_mp3(4096)
        calls = []
        billing_seq = iter([1000, 1020])  # +20 cents = ¥0.20

        def fake_req(host, path, api_key, body=None, timeout=45):
            calls.append((host, path, body))
            if path == "/v1/account/billing":
                return 200, {"account_id": 1, "balance": 900, "total_spending": next(billing_seq)}
            if path == "/v1/instrumental/generate":
                return 200, {"id": "task-999", "status": "preparing"}
            if path == "/v1/instrumental/query/task-999":
                if sum(1 for _, p, _ in calls if p == path) == 1:
                    return 200, {"id": "task-999", "status": "running"}
                return 200, {
                    "id": "task-999",
                    "model": "mureka-9",
                    "status": "succeeded",
                    "choices": [
                        {"id": "task-999-0", "url": "https://cdn.mureka.cn/audio/test.mp3", "duration": 78}
                    ],
                }
            raise AssertionError(f"Unexpected path: {path}")

        progress_stages = []
        with tempfile.TemporaryDirectory() as tmp:
            lib_dir = Path(tmp)
            with mock.patch.object(music_gen, "_mureka_request", side_effect=fake_req), \
                 mock.patch.object(music_gen, "_download_audio_bytes", return_value=fake_mp3), \
                 mock.patch.object(music_gen.time, "sleep", return_value=None):
                out = music_gen.generate_music(
                    {
                        "title": "阿托伐他汀晚上吃还是早上吃",
                        "topic": "降脂药服用时间",
                        "drug": "阿托伐他汀",
                        "lines": ["阿托伐他汀半衰期较长，每天固定时间服用即可。"],
                        "variant": 1,
                    },
                    lib_dir,
                    "mk-test-key",
                    music_model="auto",
                    on_progress=progress_stages.append,
                )
            self.assertIn("编曲生成中", progress_stages)
            self.assertEqual(out["model"], "mureka-9")
            self.assertEqual(out["provider"], "mureka")
            self.assertEqual(out["duration"], 78.0)
            self.assertEqual(out["spentCny"], 0.2)
            self.assertTrue(out["url"].startswith("/assets/music/generated/"))
            self.assertIn("阿托伐他汀", out["filename"])
            saved = lib_dir / out["filename"]
            self.assertTrue(saved.is_file())
            self.assertEqual(saved.read_bytes(), fake_mp3)

            # Reuse from project library works with ZERO keys
            with mock.patch.object(server, "GENERATED_MUSIC_DIR", lib_dir), \
                 mock.patch.object(server, "current_mureka_key", return_value=""):
                lib_choice = "library:" + out["id"]
                server.validate_video_music_settings({"music": lib_choice})
                self.assertEqual(server.music_path(lib_choice), saved.resolve())

            # Rename updates index + file on disk
            renamed, entries = music_gen.rename_library_track(lib_dir, out["id"], "降脂科普温柔版")
            self.assertEqual(renamed["title"], "降脂科普温柔版")
            self.assertIn("降脂科普温柔版", renamed["filename"])
            self.assertTrue((lib_dir / renamed["filename"]).is_file())
            self.assertFalse(saved.exists())
            self.assertEqual(len(entries), 1)

            # Delete removes file + index entry
            remaining = music_gen.delete_library_track(lib_dir, out["id"])
            self.assertEqual(remaining, [])
            self.assertFalse((lib_dir / renamed["filename"]).exists())

    def test_server_generate_music_request_checks_mureka_key_and_records_cost(self):
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
                 mock.patch.object(server, "current_mureka_key", return_value=""):
                with self.assertRaises(ValueError) as ctx:
                    server.generate_music_request({"title": "测试视频"})
                self.assertIn("Mureka", str(ctx.exception))

            billing_seq = iter([500, 515])

            def fake_req(host, path, api_key, body=None, timeout=45):
                if path == "/v1/account/billing":
                    return 200, {"account_id": 1, "balance": 1000, "total_spending": next(billing_seq)}
                if path == "/v1/instrumental/generate":
                    return 200, {"id": "task-100", "status": "queued"}
                return 200, {
                    "id": "task-100",
                    "model": "mureka-9",
                    "status": "succeeded",
                    "choices": [{"id": "task-100-0", "url": "https://cdn.mureka.cn/a.mp3", "duration": 62000}],
                }

            with mock.patch.object(server, "GENERATED_MUSIC_DIR", lib_dir), \
                 mock.patch.object(server, "JOBS", jobs_dir), \
                 mock.patch.object(server, "current_mureka_key", return_value="mk-key"), \
                 mock.patch.object(server, "current_deepseek_key", return_value=""), \
                 mock.patch.object(music_gen, "_mureka_request", side_effect=fake_req), \
                 mock.patch.object(music_gen, "_download_audio_bytes", return_value=fake_mp3), \
                 mock.patch.object(music_gen.time, "sleep", return_value=None):
                out = server.generate_music_request({
                    "title": "慢病用药提醒",
                    "topic": "高血压",
                    "lines": ["规律服药很重要。"],
                    "musicModel": "auto",
                    "workId": work_id,
                })
                self.assertEqual(out["duration"], 62.0)
                self.assertEqual(len(out["library"]), 1)
                details = server.cost_details({"workId": work_id, "jobIds": [], "media": []})
                self.assertEqual(len(details["rows"]), 1)
                self.assertEqual(details["rows"][0]["model"], "mureka-9")
                self.assertEqual(details["rows"][0]["amount"], "0.15")
                self.assertEqual(details["murekaPrice"], work_costs.MUREKA_PRICE)


if __name__ == "__main__":
    unittest.main()
