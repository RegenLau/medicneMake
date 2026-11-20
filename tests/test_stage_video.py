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

    def test_card_and_scene_illustration_resolves_local_file(self):
        for kind in ("card", "scene"):
            with self.subTest(kind=kind):
                p = self.payload(kind)
                p["items"][0]["points"]["items"] = [{"title": "找到栏目", "detail": "", "tag": ""}]
                p["items"][0]["points"]["takeaway"] = "拿不准问药师"
                p["items"][0]["content"].update(art="/assets/template-info-tablet.jpg", artPrompt="说明书")
                _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
                self.assertTrue(shots[0]["artUrl"].startswith("file:"))
                self.assertEqual("找到栏目", shots[0]["items"][0]["title"])
                self.assertEqual("拿不准问药师", shots[0]["takeaway"])
                for bad in ("https://example.invalid/art.png", "/media/captions.vtt"):
                    p["items"][0]["content"]["art"] = bad
                    with self.assertRaises(ValueError):
                        stage_video.stage_input(p, server.ASSETS, server.media_path)
        p = self.payload("card")
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertNotIn("artUrl", shots[0])

    def test_transition_field_is_optional_and_validated(self):
        p = self.payload()
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertNotIn("transition", shots[0])
        p["items"][0]["content"]["transition"] = "wipe"
        _, _, shots, _, _ = stage_video.stage_input(p, server.ASSETS, server.media_path)
        self.assertEqual("wipe", shots[0]["transition"])
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


if __name__ == "__main__":
    unittest.main()
