import tempfile
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

import server
import stage_video


class StageVideoTests(unittest.TestCase):
    def payload(self, kind="image"):
        return {"title": "核对资料", "layoutId": stage_video.CLASSIC_LAYOUT, "stage": True,
                "id": str(uuid.uuid4()), "workId": str(uuid.uuid4()), "kind": "video", "mode": "ark",
                "settings": {"ratio": "16:9", "voice": "无配音", "music": "off"},
                "items": [{"name": "确认栏目", "line": "查看说明书。", "seconds": 5, "points": {"type": "explain"},
                           "cues": [{"text": "查看说明书。", "weight": 1, "focus": "all"},
                                    {"text": "核对记录。", "weight": 1, "focus": "0", "holdSeconds": 1}],
                           "content": {"kind": kind}}]}

    def test_stage_reuses_existing_audio_and_both_cues_share_timeline(self):
        p = self.payload()
        p["settings"]["voice"] = next(iter(server.SPEAKERS))
        p["items"][0]["tailPause"] = 1.15
        with tempfile.TemporaryDirectory() as temp, patch.object(server, "JOBS", Path(temp)):
            folder = Path(temp) / p["id"]
            audio = folder / "0" / server.speech_cache_name(p["settings"], p["items"][0]["line"])
            audio.parent.mkdir(parents=True)
            with wave.open(str(audio), "wb") as pcm:
                pcm.setparams((1, 2, 8000, 0, "NONE", ""))
                pcm.writeframes(b"\0\0" * 32000)
            _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
            with patch.object(server, "narrate", side_effect=AssertionError("audio should be cached")):
                timeline = server.build_timeline(p, shots, folder, "")
            self.assertEqual(timeline["entries"], [(audio, 5.15)])
            self.assertEqual(timeline["shots"][0]["captions"][1]["start"], 4.15)
            self.assertEqual(timeline["shots"][0]["captions"][1]["end"], 5.15)
            self.assertEqual(timeline["frames"], 124)

    def test_legacy_payload_dispatch_remains_available(self):
        p = self.payload()
        with patch.object(server, "render_stage_video", return_value="stage") as modern, \
             patch.object(server, "render_template_video", return_value="template") as legacy:
            self.assertEqual(server.render_video(p, {}, lambda: None, ""), "stage")
            del p["stage"]
            p["template"] = True
            self.assertEqual(server.render_video(p, {}, lambda: None, ""), "template")
            modern.assert_called_once()
            legacy.assert_called_once()

    def test_stage_does_not_resolve_remote_render_assets(self):
        p = self.payload()
        p["items"][0]["content"]["image"] = "https://example.invalid/frame.png"
        with self.assertRaises(ValueError):
            stage_video.stage_input(p, server.ASSETS, server.media_path)

    def test_asset_mode_selects_a_versioned_local_svg(self):
        p = self.payload("asset")
        p["items"][0]["content"].update(assetId="builtin:svg/reading-list", move="pan")
        _, _, shots, _, used = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertTrue(shots[0]["assetUrl"].startswith("file:"))
        self.assertEqual(shots[0]["move"], "pan")
        self.assertEqual([item["kind"] for _, item in used], ["layout", "svg"])

    def test_visual_beats_do_not_truncate_shared_svg_narration(self):
        p = self.payload("svg")
        long_line = "核对本幕的信息和记录。" * 12
        p["items"][0]["line"] = long_line
        p["items"][0]["content"]["beats"] = [{"action": "log", "label": "核对日期", "line": "核对本幕的记录。"}]
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertEqual(shots[0]["line"], long_line)

    def test_scene_pure_code_validation_and_no_illustration(self):
        p = self.payload("scene")
        p["items"][0]["content"].update(
            art="/assets/template-info-tablet.jpg",
            code={
                "html": '<div class="sc"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="var(--v-primary)"/></svg></div>',
                "css": ".sc{width:100%;height:100%;}",
                "js": "const c = root.querySelector('circle'); if (c) c.setAttribute('r', String(20 + 10 * api.progress));",
            },
        )
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertNotIn("artUrl", shots[0])
        self.assertIn("code", shots[0])
        self.assertIn("viewBox", shots[0]["code"]["html"])

        for bad_code in (
            {"html": ""},
            {"html": '<img src="/a.png">'},
            {"html": '<div onclick="alert(1)">x</div>'},
            {"html": "<div>x</div>", "css": "div{background:url(https://evil.example/a.png);}"},
            {"html": "<div>x</div>", "js": "requestAnimationFrame(() => {});"},
            {"html": "<div>x</div>", "js": "gsap.ticker.add(() => {});"},
            {"html": "<div>x</div>", "js": "gsap.delayedCall(1, () => {});"},
            {"html": "<div>x</div>", "js": "fetch('/api/config');"},
            {"html": "<div>x</div>", "js": "const broken = (;"},
        ):
            with self.subTest(bad_code=bad_code), self.assertRaises(ValueError):
                stage_video.validate_scene_code(bad_code)

        gsap_code = stage_video.validate_scene_code({
            "html": '<div class="sc"><h2 class="t">缓释片</h2><svg viewBox="0 0 100 100"><path class="p" d="M10 50 L90 50"/></svg></div>',
            "css": ".sc{width:100%;height:100%;}",
            "js": 'api.setup((tl, gsap) => { tl.from(".t", { y: 20, opacity: 0, duration: 0.4 }, 0).fromTo(".p", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.6 }, 0.2); });',
        })
        self.assertIn("api.setup", gsap_code["js"])

        # Prompt-driven pure SVG animation validates cleanly and rejects non-SVG / foreignObject / timers.
        svg_p = self.payload("svg")
        svg_p["items"][0]["content"]["svgCode"] = {
            "svg": '<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg"><circle cx="400" cy="225" r="50" fill="var(--v-primary)"/></svg>',
            "css": "",
            "js": 'api.setup((tl) => { tl.from("circle", { scale: 0.5, opacity: 0, transformOrigin: "50% 50%", duration: 0.5 }, 0); });',
        }
        _, _, svg_shots, _, _ = stage_video.stage_input(svg_p, server.ASSETS, server.media_path)
        self.assertIn("svgCode", svg_shots[0])
        for bad_svg in (
            {"svg": "<div>not svg</div>"},
            {"svg": '<svg viewBox="0 0 100 100"><foreignObject>x</foreignObject></svg>'},
            {"svg": '<svg viewBox="0 0 100 100"><img src="/a.png"/></svg>'},
            {"svg": '<svg viewBox="0 0 100 100"></svg>', "js": "setInterval(() => {}, 10);"},
            {"svg": '<svg viewBox="0 0 100 100"></svg>', "js": "gsap.ticker.add(() => {});"},
            {"svg": '<svg viewBox="0 0 100 100"></svg>', "js": "gsap.delayedCall(0.5, () => {});"},
        ):
            with self.subTest(bad_svg=bad_svg), self.assertRaises(ValueError):
                stage_video.validate_svg_code(bad_svg)

        # Legacy card shots still resolve local art if present.
        legacy = self.payload("card")
        legacy["items"][0]["points"]["items"] = [{"title": "找到栏目", "detail": "", "tag": ""}]
        legacy["items"][0]["points"]["takeaway"] = "拿不准问药师"
        legacy["items"][0]["content"].update(art="/assets/template-info-tablet.jpg")
        _, _, legacy_shots, _, _ = stage_video.stage_input(legacy, server.ASSETS, server.media_path)
        self.assertTrue(legacy_shots[0]["artUrl"].startswith("file:"))

    def test_transition_field_is_optional_and_validated(self):
        p = self.payload()
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertNotIn("transition", shots[0])
        p["items"][0]["content"]["transition"] = "wipe"
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertEqual("wipe", shots[0]["transition"])
        for kind in stage_video.TRANSITIONS:
            p["items"][0]["content"]["transition"] = kind
            _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
            self.assertEqual(kind, shots[0]["transition"])
        p["items"][0]["content"]["transition"] = "<style>"
        with self.assertRaisesRegex(ValueError, "幕间转场"):
            stage_video.stage_input(p, server.ASSETS, server.media_path)

    def test_drug_drug_tags_and_verdict_tone_validation(self):
        p = self.payload("card")
        p["drug"] = "硝苯地平缓释片"
        p["drugTags"] = ["缓释片", "处方药"]
        p["items"][0]["points"]["verdictTone"] = "no"
        _, deck, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertEqual("硝苯地平缓释片", deck["drug"])
        self.assertEqual(["缓释片", "处方药"], deck["drugTags"])
        self.assertEqual("no", shots[0]["slide"]["verdictTone"])

        for bad_tags in (["a", "b", "c"], ["超过六个字的标签"], [123]):
            with self.subTest(bad_tags=bad_tags):
                bad = {**p, "drugTags": bad_tags}
                with self.assertRaisesRegex(ValueError, "药品标签"):
                    stage_video.stage_input(bad, server.ASSETS, server.media_path)

        bad_tone = self.payload("card")
        bad_tone["items"][0]["points"]["verdictTone"] = "bad"
        with self.assertRaisesRegex(ValueError, "结论语气"):
            stage_video.stage_input(bad_tone, server.ASSETS, server.media_path)

    def test_layout_media_spec_and_resolve_image_size_cover_all_layouts(self):
        import work_costs

        expected = {
            "builtin:layout/info-classic": (960, 540, "16:9", "standard", "left"),
            "builtin:layout/corner-presenter": (960, 540, "16:9", "standard", "left"),
            "builtin:layout/chapter-nav": (944, 512, "1.84:1", "standard", "left"),
            "builtin:layout/broadcast": (1280, 504, "2.54:1", "ultrawide", "left"),
            "builtin:layout/takeaway": (820, 460, "16:9", "compact", "left"),
            "builtin:layout/qa-chat": (1120, 388, "2.89:1", "shallow-wide", "left"),
            "builtin:layout/headline": (642, 510, "1.26:1", "narrow", "top"),
        }
        items_by_id = {row["id"]: row for row in server.ASSETS.layout_items()}
        for lid, (w, h, ratio_label, shape, art_place) in expected.items():
            with self.subTest(layout=lid):
                self.assertIn("canvas", items_by_id[lid])
                layout_def, layout_item, _ = server.ASSETS.layout(lid)
                spec = stage_video.layout_media_spec(layout_def, layout_item)
                self.assertEqual((w, h, ratio_label, shape), (spec["w"], spec["h"], spec["ratioLabel"], spec["shape"]))
                self.assertEqual(art_place, spec["art"]["placement"])
                for tier, (min_px, max_px) in (("1K", (921_600, 2_610_000)),
                                               ("2K", (3_686_400, 4_624_220)),
                                               ("4K", (10_000_000, 16_777_216))):
                    resolved = server.resolve_image_size({
                        "imageSize": tier, "ratio": spec["arkRatio"], "targetSize": {"w": w, "h": h},
                    })
                    pw, ph = (int(part) for part in resolved.split("x"))
                    self.assertEqual(0, pw % 16)
                    self.assertEqual(0, ph % 16)
                    self.assertTrue(min_px <= pw * ph <= max_px, f"{lid} {tier} -> {resolved}")
                    ar_err = abs((pw / ph) - (w / h)) / (w / h)
                    self.assertLess(ar_err, 0.02, f"{lid} {tier} -> {resolved}")
                    # Verify cost calculation accepts every resolved custom pixel size.
                    model = "doubao-seedream-5-5-261028" if tier in ("1K", "2K") else "doubao-seedream-5-0-260128"
                    cost = work_costs.image_cost(model, resolved, 0, 0)
                    self.assertIsNotNone(cost["amount"], f"unbilled size {resolved} for {model}")

        # Without targetSize, resolve_image_size preserves exact preset SIZES.
        self.assertEqual(server.SIZES["2K"]["16:9"], server.resolve_image_size({"imageSize": "2K", "ratio": "16:9"}))
        # Invalid targetSize values are rejected.
        for bad in ({"w": 10, "h": 10}, {"w": 1000, "h": 100}, {"w": "1280", "h": 504}, "1280x504"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                server.parse_target_size(bad)

    def test_render_subprocess_env_replaces_missing_or_ephemeral_tmpdir(self):
        env = server.render_subprocess_env({
            "PATH": "/usr/bin",
            "TMPDIR": "/nonexistent/antigravity-tmp/run-deadbeef",
        })
        self.assertEqual(env["TMPDIR"], "/tmp")
        env_ephemeral = server.render_subprocess_env({
            "PATH": "/usr/bin",
            "TMPDIR": "/Users/test/.t3/userdata/antigravity-tmp/abc/run-123456",
        })
        self.assertEqual(env_ephemeral["TMPDIR"], "/tmp")

    def test_extract_render_error_preserves_playwright_launch_errors(self):
        stderr = (
            "node:internal/modules/run_main:107\n"
            "    triggerUncaughtException(\n"
            "    ^\n\n"
            "browserType.launch: ENOENT: no such file or directory, mkdtemp '/tmp/dead/playwright-abc'\n"
            "    at /app/scripts/render-stage.mjs:11:32\n"
        ).encode("utf-8")
        with patch("sys.stderr"):
            msg = server.extract_render_error(stderr)
        self.assertIn("browserType.launch: ENOENT", msg)
        with patch("sys.stderr"):
            self.assertEqual(server.extract_render_error(b"Error: \xe5\x88\x86\xe9\x95\x9c\xe7\xb4\xa0\xe6\x9d\x90\xe6\x9c\xaa\xe5\x8a\xa0\xe8\xbd\xbd\xe3\x80\x82\n"), "分镜素材未加载。")
            self.assertEqual(server.extract_render_error(b""), "请核对 Chrome 和 Playwright 安装。")

    def test_speech_resource_routes_cloned_voices_to_seed_icl(self):
        self.assertEqual(server.speech_resource_for("S_5yB2w6uk2"), "seed-icl-2.0")
        self.assertEqual(server.speech_resource_for("zh_male_liufei_uranus_bigtts"), "seed-tts-2.0")
        self.assertNotEqual(
            server.speech_cache_name({"voice": "医生音色"}, "测试"),
            server.speech_cache_name({"voice": "刘飞 2.0"}, "测试"),
        )

    def test_stage_speech_preview_validation_and_cache_reuse(self):
        import tempfile
        import uuid
        import wave

        work_id = str(uuid.uuid4())
        long_line = "腿抽筋，先别急着补钙。\n" + ("多数抽筋和缺钙没直接关系，先排查受凉疲劳和电解质。" * 5)
        payload = {
            "id": str(uuid.uuid4()),
            "mode": "ark",
            "kind": "svg-speech",
            "stage": True,
            "workId": work_id,
            "settings": {"voice": "刘飞 2.0"},
            "items": [{"line": long_line, "index": 0}],
        }
        with patch.object(server, "current_speech_key", return_value="k"):
            server.setting_valid(payload)
        with patch.object(server, "current_speech_key", return_value="k"), self.assertRaises(ValueError):
            server.setting_valid({**payload, "settings": {"voice": "无配音"}})
        with patch.object(server, "current_speech_key", return_value="k"), self.assertRaises(ValueError):
            server.setting_valid({**payload, "items": [{"line": "字" * 451, "index": 0}]})

        # Verify build_timeline reuses cached stage preview speech for non-svg (e.g. image) shots without calling narrate.
        with tempfile.TemporaryDirectory() as tmp:
            media_dir = Path(tmp) / "media"
            jobs_dir = Path(tmp) / "jobs"
            media_dir.mkdir()
            jobs_dir.mkdir()
            with patch.object(server, "MEDIA", media_dir), patch.object(server, "JOBS", jobs_dir):
                speaker = server.SPEAKERS["刘飞 2.0"]
                cached_wav = server.svg_speech_cache_path({"workId": work_id}, long_line.strip(), speaker)
                with wave.open(str(cached_wav), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(24000)
                    wav.writeframes(b"\x00\x00" * 24000 * 3)
                compose_payload = {
                    "workId": work_id,
                    "settings": {"voice": "刘飞 2.0"},
                    "items": [{"line": long_line}],
                }
                self.assertTrue(server.has_template_speech(compose_payload))
                shots = [{
                    "kind": "image",
                    "name": "开头",
                    "line": long_line,
                    "seconds": 5,
                    "cues": [{"text": "腿抽筋，先别急着补钙", "weight": 10, "focus": "all"}],
                    "tailPause": 0.55,
                }]
                with patch.object(server, "template_shot_audio", side_effect=AssertionError("should reuse cached wav")):
                    timeline = server.build_timeline(compose_payload, shots, jobs_dir, "")
                self.assertEqual(timeline["entries"][0][0], cached_wav)
                self.assertGreaterEqual(timeline["entries"][0][1], 3.0)

    def test_cue_custom_highlight_words_validated_and_preserved_in_timeline(self):
        p = self.payload("card")
        p["items"][0]["points"]["highlightWords"] = ["说明书"]
        p["items"][0]["cues"] = [
            {"text": "腿抽筋，先别急着补钙", "weight": 10, "focus": "all", "highlightWords": [], "highlightCustom": True},
            {"text": "多数抽筋和缺钙没直接关系", "weight": 12, "focus": "all", "highlightWords": ["缺钙", "没直接关系"], "highlightCustom": True},
        ]
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        with tempfile.TemporaryDirectory() as temp:
            timeline = server.build_timeline(p, shots, Path(temp), "")
        captions = timeline["shots"][0]["captions"]
        self.assertEqual(captions[0]["highlightWords"], [])
        self.assertTrue(captions[0]["highlightCustom"])
        self.assertEqual(captions[1]["highlightWords"], ["缺钙", "没直接关系"])
        self.assertTrue(captions[1]["highlightCustom"])

        bad = self.payload("card")
        bad["items"][0]["cues"][0]["highlightWords"] = "不是数组"
        with self.assertRaisesRegex(ValueError, "字幕高亮词"):
            stage_video.stage_input(bad, server.ASSETS, server.media_path)

        bad_flag = self.payload("card")
        bad_flag["items"][0]["cues"][0]["highlightCustom"] = "yes"
        with self.assertRaisesRegex(ValueError, "字幕高亮标记"):
            stage_video.stage_input(bad_flag, server.ASSETS, server.media_path)


if __name__ == "__main__":
    unittest.main()
