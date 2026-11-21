import copy
import json
import unittest
from unittest.mock import Mock

import mix_plan
import server
import stage_forms
import stage_video
from test_mix_plan import model_response


def fever_shot():
    return {
        "name": "退烧药按体重算",
        "line": "孩子体温超过三十八度五时，布洛芬混悬液按体重给药，两次至少间隔四到六小时，一天最多四次。",
        "seconds": 7,
        "chapterIndex": 0,
        "points": {
            "type": "steps",
            "headline": "儿童退烧药用量",
            "items": [
                {"title": "体温超过38.5℃", "detail": "先看精神状态", "tag": "阈值"},
                {"title": "间隔4到6小时", "detail": "一天最多4次", "tag": "间隔"},
                {"title": "用原配量器", "detail": "不拿汤匙估量", "tag": "量取"},
            ],
            "takeaway": "按体重核对说明书，一天最多四次",
        },
        "cues": [
            {"text": "孩子体温超过三十八度五时，", "focus": "0", "weight": 12},
            {"text": "布洛芬混悬液按体重给药，", "focus": "1", "weight": 12},
            {"text": "两次至少间隔四到六小时，一天最多四次。", "focus": "2", "weight": 18},
        ],
    }


class StageFormsTests(unittest.TestCase):
    def test_all_forms_derive_and_validate_cleanly(self):
        reg = stage_forms.load_registry()
        self.assertGreaterEqual(len(reg["forms"]), 24)
        shot = fever_shot()
        for form in reg["forms"]:
            with self.subTest(form=form["id"]):
                derived = stage_forms.derive_form_data(form["id"], shot)
                validated = stage_forms.validate_form_data(form["id"], derived, shot, check_facts=False)
                self.assertIsInstance(validated, dict)

    def test_schema_validation_rejects_bad_types_lengths_and_item_counts(self):
        shot = fever_shot()
        # Unknown field
        with self.assertRaises(ValueError):
            stage_forms.validate_form_data("dose-card", {"value": "4", "unit": "次", "condition": "一天最多", "extra": 1}, shot)
        # Missing required field
        with self.assertRaises(ValueError):
            stage_forms.validate_form_data("dose-card", {"value": "4", "unit": "次"}, shot)
        # Overlong title
        with self.assertRaises(ValueError):
            stage_forms.validate_form_data("dose-card", {"value": "4", "unit": "次", "condition": "超" * 25}, shot)
        # Out-of-range item count (do-dont allows 1-3 per side)
        with self.assertRaises(ValueError):
            stage_forms.validate_form_data("do-dont", {"do": [], "dont": ["别乱吃"]}, shot)
        with self.assertRaises(ValueError):
            stage_forms.validate_form_data("do-dont", {"do": ["一", "二", "三", "四"], "dont": ["别乱吃"]}, shot)

    def test_fact_grounding_accepts_spoken_chinese_numbers_and_rejects_invented_numbers_or_drugs(self):
        shot = fever_shot()
        # Spoken 三十八度五 -> 38.5, 四到六 -> 4, 6, 四次 -> 4
        ok_dose = stage_forms.validate_form_data(
            "dose-card",
            {"value": "38.5", "unit": "℃", "condition": "体温超过该值考虑用药", "note": "一天最多4次"},
            shot,
            drug="布洛芬混悬液",
        )
        self.assertEqual("38.5", ok_dose["value"])

        ok_interval = stage_forms.validate_form_data(
            "interval-bar",
            {"interval": "4-6小时", "startLabel": "第一次用药", "endLabel": "下一次用药"},
            shot,
        )
        self.assertEqual("4-6小时", ok_interval["interval"])

        # Hallucinated number (500 not in line/points) must fail
        with self.assertRaisesRegex(ValueError, "数字"):
            stage_forms.validate_form_data(
                "dose-card",
                {"value": "500", "unit": "mg", "condition": "每次口服"},
                shot,
            )

        # Hallucinated drug name not in line/points/drug must fail
        with self.assertRaisesRegex(ValueError, "药品"):
            stage_forms.validate_form_data(
                "big-answer",
                {"answer": "改吃阿莫西林胶囊", "note": "消炎更快"},
                shot,
                drug="布洛芬混悬液",
            )

    def test_diversity_prevents_adjacent_repeats_and_enforces_four_distinct_for_five_plus_shots(self):
        base_shot = fever_shot()
        shots = []
        for i in range(6):
            s = copy.deepcopy(base_shot)
            s["name"] = f"第{i + 1}幕要点"
            s["content"] = {
                "kind": "scene",
                "form": "flow-h",
                "variant": "solid",
                "formData": stage_forms.derive_form_data("flow-h", s),
            }
            shots.append(s)
        spec = stage_video.layout_media_spec(server.ASSETS.layout(stage_video.CLASSIC_LAYOUT)[0])
        stage_forms.enforce_form_diversity(shots, spec=spec, work_id="work-a")
        forms = [s["content"]["form"] for s in shots]
        for a, b in zip(forms, forms[1:]):
            self.assertNotEqual(a, b, f"Adjacent repeat found in {forms}")
        self.assertGreaterEqual(len(set(forms)), 4)

    def test_legacy_content_mapping_and_variant_rotation(self):
        shot = fever_shot()
        form_id, variant, data = stage_forms.map_legacy_content({"kind": "scene", "visual": "compare"}, shot)
        self.assertEqual("table-compare", form_id)
        self.assertIn(variant, ("solid", "outline", "split"))
        self.assertIn("rows", data)

        # Rotating across workIds / revisions yields varied variants
        seen = {stage_forms.pick_variant("dose-card", f"w-{i}", 0, r) for i in range(5) for r in range(3)}
        self.assertEqual({"solid", "outline", "split"}, seen)

    def test_card_arrange_produces_varied_forms_without_adjacent_repeats(self):
        script = {
            "title": "儿童退烧药怎么量",
            "shortTitle": "儿童退烧药",
            "chapters": ["判断", "量取"],
            "shots": [
                {**copy.deepcopy(fever_shot()), "name": f"第{i + 1}幕退烧要点"}
                for i in range(5)
            ],
        }
        results = []
        for run in range(3):
            item = {
                "topic": "儿童退烧药怎么量",
                "drug": "布洛芬混悬液",
                "layoutId": stage_video.CLASSIC_LAYOUT,
                "presentation": "card",
                "workId": f"run-{run}",
            }
            client = Mock()
            out = mix_plan.arrange(client, "deepseek-flash", item, script, server.ASSETS, allow_legacy=True)
            seq = tuple((s["content"]["form"], s["content"]["variant"]) for s in out["shots"])
            fseq = [s["content"]["form"] for s in out["shots"]]
            for a, b in zip(fseq, fseq[1:]):
                self.assertNotEqual(a, b)
            self.assertGreaterEqual(len(set(fseq)), 4)
            results.append(seq)
        self.assertGreater(len(set(results)), 1)


if __name__ == "__main__":
    unittest.main()
