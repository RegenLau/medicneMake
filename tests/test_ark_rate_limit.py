import base64
import io
import json
import tempfile
import threading
import unittest
from email.message import Message
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

import server


PNG_1X1 = base64.b64encode(
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
).decode("ascii")


def make_http_error(code, body_dict, headers=None):
    hdrs = Message()
    for k, v in (headers or {}).items():
        hdrs[k] = v
    raw = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")
    return HTTPError("https://ark.cn-beijing.volces.com/api/v3/images/generations", code, "err", hdrs, io.BytesIO(raw))


class FakeResponse:
    def __init__(self, payload):
        self._buf = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def read(self, *args):
        return self._buf.read(*args)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ArkRateLimitTests(unittest.TestCase):
    def test_ark_retries_on_429_and_succeeds_with_progress_callback(self):
        burst = {
            "error": {
                "code": "RequestBurstTooFast",
                "message": "System protection triggered by request burst.",
            }
        }
        calls = []
        sleeps = []
        events = []

        def fake_urlopen(req, timeout=0):
            calls.append(req.full_url)
            if len(calls) <= 2:
                raise make_http_error(429, burst)
            return FakeResponse({"data": [{"b64_json": PNG_1X1}]})

        with (
            patch.object(server, "urlopen", side_effect=fake_urlopen),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(s)),
            patch.object(server.random, "uniform", return_value=0.5),
            patch.object(server, "ARK_RETRY_DELAYS", (3.0, 6.0, 12.0)),
        ):
            res = server.ark(
                "/images/generations",
                {"model": "doubao-seedream-5-5-261028"},
                key="secret-key-123",
                on_retry=lambda a, t, d, m: events.append((a, t, d, m)),
            )

        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [3.5, 6.5])
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0][:3], (1, 3, 3.5))
        self.assertEqual(events[1][:3], (2, 3, 6.5))
        self.assertEqual(res["data"][0]["b64_json"], PNG_1X1)

    def test_ark_respects_retry_after_header_with_clamping(self):
        burst = {"error": {"message": "rate limited"}}
        sleeps = []
        attempts = [0]

        def fake_urlopen(req, timeout=0):
            attempts[0] += 1
            if attempts[0] == 1:
                raise make_http_error(429, burst, headers={"Retry-After": "9"})
            if attempts[0] == 2:
                raise make_http_error(429, burst, headers={"Retry-After": "120"})
            return FakeResponse({"ok": True})

        with (
            patch.object(server, "urlopen", side_effect=fake_urlopen),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(s)),
            patch.object(server, "ARK_MAX_RETRY_AFTER", 30.0),
        ):
            res = server.ark("/images/generations", {}, key="k", max_retries=3)

        self.assertEqual(res, {"ok": True})
        self.assertEqual(sleeps, [9.0, 30.0])

    def test_ark_exhausted_429_reports_retry_count_and_masks_key(self):
        burst = {"error": {"message": "burst for secret-xyz"}}
        sleeps = []

        def fake_urlopen(req, timeout=0):
            raise make_http_error(429, burst)

        with (
            patch.object(server, "urlopen", side_effect=fake_urlopen),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(s)),
            patch.object(server, "ARK_RETRY_DELAYS", (2.0, 4.0)),
            patch.object(server.random, "uniform", return_value=0.0),
        ):
            with self.assertRaises(ValueError) as ctx:
                server.ark("/images/generations", {}, key="secret-xyz")

        msg = str(ctx.exception)
        self.assertEqual(sleeps, [2.0, 4.0])
        self.assertIn("429", msg)
        self.assertIn("已自动重试 2 次", msg)
        self.assertNotIn("secret-xyz", msg)
        self.assertIn("[已隐藏]", msg)

    def test_ark_does_not_retry_non_429_or_models_verify(self):
        sleeps = []
        calls = [0]

        def fake_bad_req(req, timeout=0):
            calls[0] += 1
            raise make_http_error(400, {"error": {"message": "bad prompt"}})

        with (
            patch.object(server, "urlopen", side_effect=fake_bad_req),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(s)),
        ):
            with self.assertRaises(ValueError):
                server.ark("/images/generations", {}, key="k")

        self.assertEqual(calls[0], 1)
        self.assertEqual(sleeps, [])

        calls[0] = 0

        def fake_models_429(req, timeout=0):
            calls[0] += 1
            raise make_http_error(429, {"error": {"message": "too many"}})

        with (
            patch.object(server, "urlopen", side_effect=fake_models_429),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(s)),
        ):
            with self.assertRaises(ValueError) as ctx:
                server.ark("/models", key="k")

        self.assertEqual(calls[0], 1)
        self.assertEqual(sleeps, [])
        self.assertIn("429", str(ctx.exception))

    def test_ark_404_model_access_gives_actionable_chinese_hint(self):
        not_enabled = {
            "error": {
                "code": "InvalidEndpointOrModel.NotFound",
                "message": "The model or endpoint doubao-seedream-5-0-260128 does not exist or you do not have access to it.",
            }
        }
        with patch.object(server, "urlopen", side_effect=make_http_error(404, not_enabled)):
            with self.assertRaises(ValueError) as ctx:
                server.ark("/images/generations", {}, key="k")
        msg = str(ctx.exception)
        self.assertIn("404", msg)
        self.assertIn("未开通该模型权限", msg)

    def test_image_pacing_enforces_minimum_interval(self):
        sleeps = []
        clock = iter([100.0, 100.4, 102.0])

        with (
            patch.object(server, "ARK_IMAGE_MIN_INTERVAL", 1.5),
            patch.object(server, "ARK_LAST_IMAGE_AT", None),
            patch.object(server.time, "monotonic", side_effect=lambda: next(clock)),
            patch.object(server.time, "sleep", side_effect=lambda s: sleeps.append(round(s, 2))),
            patch.object(server, "ark", return_value={"data": [{"b64_json": PNG_1X1, "size": "2848x1600"}]}),
            tempfile.TemporaryDirectory() as folder,
            patch.object(server, "MEDIA", Path(folder)),
        ):
            req = {
                "settings": {
                    "imageModel": "doubao-seedream-5-5-261028",
                    "imageSize": "2K",
                    "ratio": "16:9",
                    "watermark": True,
                },
                "style": 0,
            }
            server.image_item(req, {"prompt": "p1"}, 0)
            server.image_item(req, {"prompt": "p2"}, 1)

        self.assertEqual(sleeps, [1.1])

    def test_compatible_resumed_request_allows_image_model_switch_only(self):
        base = {
            "id": str(uuid4()),
            "mode": "ark",
            "kind": "images",
            "style": 0,
            "settings": {
                "mode": "ark",
                "imageModel": "doubao-seedream-5-5-261028",
                "imageSize": "1K",
                "ratio": "16:9",
                "watermark": True,
            },
            "items": [{"prompt": "a"}, {"prompt": "b"}],
        }
        switched = json.loads(json.dumps(base))
        switched["settings"]["imageModel"] = "doubao-seedream-5-0-260128"
        switched["settings"]["imageSize"] = "2K"
        self.assertTrue(server.compatible_resumed_request(base, switched))

        prompt_changed = json.loads(json.dumps(switched))
        prompt_changed["items"][1]["prompt"] = "c"
        self.assertFalse(server.compatible_resumed_request(base, prompt_changed))

        video_req = json.loads(json.dumps(base))
        video_req["kind"] = "video"
        video_switched = json.loads(json.dumps(switched))
        video_switched["kind"] = "video"
        self.assertFalse(server.compatible_resumed_request(video_req, video_switched))

    def test_work_resumes_from_partial_results_after_switching_image_model(self):
        job_id = str(uuid4())
        req_v1 = {
            "id": job_id,
            "mode": "ark",
            "kind": "images",
            "style": 0,
            "workId": str(uuid4()),
            "settings": {
                "mode": "ark",
                "imageModel": "doubao-seedream-5-5-261028",
                "imageSize": "2K",
                "ratio": "16:9",
                "watermark": True,
            },
            "items": [{"prompt": "shot 1"}, {"prompt": "shot 2"}],
        }
        req_v2 = json.loads(json.dumps(req_v1))
        req_v2["settings"]["imageModel"] = "doubao-seedream-5-0-260128"

        seen_models = []

        def fake_ark(path, body=None, **kwargs):
            seen_models.append(body["model"])
            if body["model"] == "doubao-seedream-5-5-261028" and len(seen_models) == 2:
                raise ValueError("方舟返回 429（已自动重试 4 次仍限流）")
            return {"data": [{"b64_json": PNG_1X1, "size": "2848x1600"}]}

        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(server, "JOBS", Path(folder) / "jobs"),
            patch.object(server, "MEDIA", Path(folder) / "media"),
            patch.object(server, "ARK_IMAGE_MIN_INTERVAL", 0.0),
            patch.object(server, "ark", side_effect=fake_ark),
        ):
            server.JOBS.mkdir()
            server.MEDIA.mkdir()
            job = {"id": job_id, "request": req_v1, "remote": {}, "results": []}
            server.work(job, key="k")
            self.assertEqual(job["status"], "failed")
            self.assertEqual(len(job["results"]), 1)
            first_image = job["results"][0]

            # Resume with fallback model, keeping first image and cost entry intact.
            self.assertTrue(server.compatible_resumed_request(job["request"], req_v2))
            job["request"] = req_v2
            server.work(job, key="k")

            self.assertEqual(job["status"], "done")
            self.assertEqual(len(job["results"]), 2)
            self.assertEqual(job["results"][0], first_image)
            self.assertEqual(
                seen_models,
                [
                    "doubao-seedream-5-5-261028",
                    "doubao-seedream-5-5-261028",
                    "doubao-seedream-5-0-260128",
                ],
            )
            cost_models = sorted(row["model"] for row in job["costs"].values())
            self.assertEqual(
                cost_models,
                ["doubao-seedream-5-0-260128", "doubao-seedream-5-5-261028"],
            )

    def test_post_api_jobs_allows_fallback_image_model_on_failed_job_and_rejects_done_or_prompt_change(self):
        job_id = str(uuid4())
        req_v1 = {
            "id": job_id,
            "mode": "ark",
            "kind": "images",
            "style": 0,
            "workId": str(uuid4()),
            "settings": {
                "mode": "ark",
                "imageModel": "doubao-seedream-5-5-261028",
                "imageSize": "1K",
                "videoModel": "doubao-seedance-2-5-flash-261115",
                "resolution": "720p",
                "ratio": "16:9",
                "watermark": True,
                "voice": "无配音",
            },
            "items": [{"prompt": "shot 1"}, {"prompt": "shot 2"}],
        }
        req_v2 = json.loads(json.dumps(req_v1))
        req_v2["settings"]["imageModel"] = "doubao-seedream-5-0-260128"
        req_v2["settings"]["imageSize"] = "2K"

        req_bad = json.loads(json.dumps(req_v2))
        req_bad["items"][1]["prompt"] = "tampered"

        with tempfile.TemporaryDirectory() as folder:
            jobs_dir = Path(folder) / "jobs"
            jobs_dir.mkdir()
            job_file = jobs_dir / f"{job_id}.json"
            job_file.write_text(
                json.dumps(
                    {
                        "id": job_id,
                        "status": "failed",
                        "progress": "生成配图 2 / 2",
                        "error": "方舟返回 429",
                        "request": req_v1,
                        "remote": {},
                        "results": ["/media/already-done.png"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            port = httpd.server_address[1]
            origin = f"http://127.0.0.1:{port}"
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()

            def post_job(payload):
                req = Request(
                    origin + "/api/jobs",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json", "Origin": origin},
                )
                return urlopen(req, timeout=5)

            started = []
            try:
                with (
                    patch.object(server, "JOBS", jobs_dir),
                    patch.object(server, "PORT", port),
                    patch.object(server, "ORIGIN", origin),
                    patch.object(server, "ACTIVE", set()),
                    patch.object(server, "work", side_effect=lambda job, *a: started.append(job["request"]["settings"]["imageModel"])),
                ):
                    # Changing prompt on same job id must still be rejected.
                    with self.assertRaises(HTTPError) as bad_ctx:
                        post_job(req_bad)
                    self.assertEqual(bad_ctx.exception.code, 400)

                    # Switching imageModel + compatible imageSize on failed job succeeds and keeps partial results.
                    with post_job(req_v2) as resp:
                        self.assertEqual(resp.status, 202)
                    saved = json.loads(job_file.read_text(encoding="utf-8"))
                    self.assertEqual(saved["request"]["settings"]["imageModel"], "doubao-seedream-5-0-260128")
                    self.assertEqual(saved["request"]["settings"]["imageSize"], "2K")
                    self.assertEqual(saved["results"], ["/media/already-done.png"])
                    self.assertEqual(started, ["doubao-seedream-5-0-260128"])

                    # Once marked done, changing imageModel on same id is rejected.
                    saved["status"] = "done"
                    job_file.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
                    server.ACTIVE.clear()
                    with self.assertRaises(HTTPError) as done_ctx:
                        post_job(req_v1)
                    self.assertEqual(done_ctx.exception.code, 400)
            finally:
                httpd.shutdown()
                httpd.server_close()


if __name__ == "__main__":
    unittest.main()
