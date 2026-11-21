import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

import mix_plan


BASE = Path(__file__).resolve().parents[1]
CATALOG = json.loads((BASE / "public/assets/library/catalog.json").read_text())[-1]["data"]


def model_response(value):
    return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]}


def script_fixture():
    return {"title": "出门怎么带药", "shortTitle": "出门带药", "chapters": ["打包", "核对"], "shots": [
        {"name": name, "line": line, "seconds": 4, "chapterIndex": i % 2,
         "points": {"type": kind, "headline": name, "items": [{"title": name, "detail": "", "tag": ""}]},
         "cues": [{"text": line, "focus": "0", "weight": len(line)}]}
        for i, (name, line, kind) in enumerate([
            ("核对药盒", "出门前核对药盒上的用法。", "cover"),
            ("打包随身药", "把原包装药盒放进随身包。", "steps"),
            ("记录时间", "记下每次用药时间。", "checklist"),
        ])]}


def choice(script, index, kind, fallback="scene", **kwargs):
    return {"index": index, "kind": kind, "reason": f'「{script["shots"][index]["name"]}」适合展示药盒或记录对象。',
            "fallback": fallback, "params": {}, **kwargs}


class MixPlanningTests(unittest.TestCase):
    def setUp(self):
        self.item = {"topic": "出门怎么带药", "layoutId": "builtin:layout/info-classic", "presentation": "mix"}
        self.supports = ["image", "card", "scene", "svg", "asset"]
        self.library = Mock()
        self.library.layout.return_value = ({"supports": self.supports}, {}, None)
        self.library.stage_catalog.return_value = CATALOG
        self.library.items.return_value = [
            {"id": f"builtin:svg/{i}", "name": f"药盒 {i}", "kind": "svg", "tags": ["药盒"], "path": "internal"}
            for i in range(12)
        ] + [{"id": "font", "name": "药盒", "kind": "font", "tags": ["药盒"]}]
        self.script = script_fixture()

    def arrange(self, rows=None, client=None):
        if client is None:
            client = Mock(return_value=model_response({"shots": rows}))
        return mix_plan.arrange(client, "deepseek-flash", self.item, self.script, self.library), client

    def test_unsupported_kind_and_invalid_params_use_fallback(self):
        choices = [choice(self.script, 0, "card", "scene"),
                   choice(self.script, 1, "scene", params={"unknownField": "x"}),
                   choice(self.script, 2, "svg", params={"beats": [{"action": "log", "line": "记下每次用药时间。", "label": "记录时间"}]})]
        result, client = self.arrange(choices)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["scene", "scene", "svg"], [entry["kind"] for entry in contents])
        self.assertIn("布局", contents[0]["adjusted"])
        self.assertIn("参数", contents[1]["adjusted"])
        self.assertEqual("log", contents[2]["beats"][0]["action"])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(["image", "scene", "svg"], payload["supports"])
        self.assertEqual({"image", "scene", "svg"}, set(payload["presenters"]))
        self.assertNotIn("imageBudget", payload)
        self.assertNotIn("remainingImageBudget", payload)
        self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in payload["shots"]])
        for details in payload["presenters"].values():
            self.assertEqual({"strengths", "avoid", "cost", "options"}, set(details))

    def test_mix_allows_unlimited_images_without_priority_and_ignores_legacy_budget(self):
        extra = [
            {"name": f"补充第{i}幕", "line": f"第{i}幕核对用药说明。", "seconds": 4, "chapterIndex": 1,
             "points": {"type": "explain", "headline": f"补充第{i}幕", "items": [{"title": "核对说明", "detail": "", "tag": ""}]},
             "cues": [{"text": f"第{i}幕核对用药说明。", "focus": "0", "weight": 10}]}
            for i in (4, 5)
        ]
        self.script["shots"].extend(extra)
        rows = [choice(self.script, i, "image", params={"imagePrompt": f"第 {i + 1} 幕药盒示意"}) for i in range(5)]
        result, _ = self.arrange(rows)
        self.assertEqual(["image"] * 5, [row["content"]["kind"] for row in result["shots"]])
        self.assertTrue(all("adjusted" not in row["content"] for row in result["shots"]))
        # Legacy callers passing imageBudget=0 or >4 are ignored without error or capping.
        for legacy in (0, 99):
            with self.subTest(legacy=legacy):
                self.item["imageBudget"] = legacy
                result, _ = self.arrange(rows)
                self.assertEqual(["image"] * 5, [row["content"]["kind"] for row in result["shots"]])
        # Invalid image params still fall back safely.
        bad_rows = [choice(self.script, 0, "image", params={"unexpected": "x"}), *rows[1:]]
        result, _ = self.arrange(bad_rows)
        self.assertEqual(["scene", "image", "image", "image", "image"], [row["content"]["kind"] for row in result["shots"]])
        self.assertIn("参数", result["shots"][0]["content"]["adjusted"])

    def test_malformed_output_and_network_failure_continue(self):
        for client in (Mock(side_effect=OSError("offline")), Mock(return_value=model_response({"shots": []}))):
            with self.subTest(client=client):
                result, _ = self.arrange(client=client)
                self.assertEqual(mix_plan.FAILURE_NOTICE, result["notice"])
                self.assertEqual(["scene", "svg", "svg"], [row["content"]["kind"] for row in result["shots"]])
                self.assertTrue(all(row["content"]["adjusted"] for row in result["shots"]))
                self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in result["shots"]])

    def test_replan_preserves_user_rows_and_allows_unbounded_images(self):
        self.script["shots"][0]["content"] = {"kind": "image", "image": "/existing.jpg", "decidedBy": "user"}
        self.script["shots"][1]["content"] = {"kind": "scene", "decidedBy": "mix"}
        self.script["shots"][2]["content"] = {"kind": "svg", "decidedBy": "mix"}
        self.item["script"] = self.script
        rows = [choice(self.script, 1, "image"), choice(self.script, 2, "image")]
        result, client = self.arrange(rows)
        self.assertEqual([1, 2], result["plannedIndices"])
        self.assertEqual(self.script["shots"][0], result["shots"][0])
        self.assertEqual(["image", "image", "image"], [row["content"]["kind"] for row in result["shots"]])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertNotIn("remainingImageBudget", payload)
        self.assertEqual(["image", "scene", "svg"], [row["currentKind"] for row in payload["shots"]])
        self.item["targetIndex"] = 0
        result, _ = self.arrange([choice(self.script, 0, "svg")])
        self.assertEqual([0], result["plannedIndices"])
        self.assertEqual("svg", result["shots"][0]["content"]["kind"])
        self.assertEqual(self.script["shots"][1:], result["shots"][1:])

    def test_single_replan_accepts_unfinished_neighbors_without_changing_them(self):
        for row, kind in zip(self.script["shots"], ("image", "scene", "card")):
            row["content"] = {"kind": kind, "decidedBy": "user"}
        self.script["shots"][0]["line"] = ""
        self.script["shots"][2]["name"] = ""
        self.item.update(script=self.script, targetIndex=1)
        result, client = self.arrange([choice(self.script, 1, "svg")])
        self.assertEqual([1], result["plannedIndices"])
        self.assertEqual(self.script["shots"][::2], result["shots"][::2])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertNotIn("remainingImageBudget", payload)
        self.assertEqual("", payload["shots"][0]["line"])
        for target in (None, 0, 2):
            with self.subTest(target=target), self.assertRaises(ValueError):
                mix_plan.validate_setup({**self.item, "targetIndex": target}, self.library)

    def test_produce_shot_uses_selected_kind_and_only_passes_target_script(self):
        shot = self.script["shots"][1]
        original = copy.deepcopy(shot)
        reason = "把动作拆成观众容易看懂的画面。"
        params = {"motionStyle": "spotlight"}
        client = Mock(return_value=model_response({"plans": [{"params": params, "reason": reason}]}))
        item = {**self.item, "presentation": "card", "produceShot": {
            "shot": shot, "previousParams": {"motionStyle": "auto"}, "revision": "突出手边要核对的对象",
        }}
        result = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual("card", result["kind"])
        self.assertEqual("user", result["decidedBy"])
        self.assertEqual(reason, result["reason"])
        self.assertEqual(params, {key: result[key] for key in params})
        client.assert_called_once()
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(shot, payload["shot"])
        self.assertEqual({"motionStyle": "auto"}, payload["previousParams"])
        self.assertEqual("突出手边要核对的对象", payload["revision"])
        self.assertEqual(original, shot)

    def test_produce_svg_generates_pure_svg_and_auto_repairs_invalid_output(self):
        shot = self.script["shots"][1]
        bad_reply = {
            "reason": "非法包含 foreignObject。",
            "svgCode": {"svg": '<svg viewBox="0 0 800 450"><foreignObject>x</foreignObject></svg>', "css": "", "js": ""},
        }
        valid_reply = {
            "reason": "用扁平矢量药盒与随身药包演示原包装收纳。",
            "svgCode": {
                "svg": '<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg"><rect id="box" x="120" y="140" width="160" height="120" rx="16" fill="var(--v-primary)"/></svg>',
                "css": "",
                "js": "const b = root.querySelector('#box'); if (b) b.setAttribute('x', String(120 + 180 * api.progress));",
            },
        }
        client = Mock(side_effect=[model_response(bad_reply), model_response(valid_reply)])
        item = {**self.item, "presentation": "svg", "produceShot": {
            "shot": shot,
            "prompt": "画一只扁平矢量药盒滑进随身药包，不要位图插画",
            "revision": "放大药盒",
        }}
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual("svg", content["kind"])
        self.assertEqual("user", content["decidedBy"])
        self.assertEqual(valid_reply["reason"], content["reason"])
        self.assertEqual("画一只扁平矢量药盒滑进随身药包，不要位图插画", content["customSvgPrompt"])
        self.assertIn("<svg", content["svgCode"]["svg"])
        self.assertEqual(2, client.call_count)
        retry_payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertIn("validationFeedback", retry_payload)
        self.assertIn("foreignObject", retry_payload["validationFeedback"])

    def test_produce_svg_batch_generates_multiple_shots(self):
        valid = lambda label: model_response({
            "reason": f"纯矢量 SVG：{label}",
            "svgCode": {"svg": f'<svg viewBox="0 0 800 450"><text x="40" y="80">{label}</text></svg>', "css": "", "js": "const p = api.progress;"},
        })
        client = Mock(side_effect=[valid("核对药盒"), valid("记录时间")])
        item = {
            **self.item,
            "presentation": "svg",
            "produceSvgBatch": [
                {"index": 0, "shot": self.script["shots"][0], "prompt": "矢量药盒标注有效期"},
                {"index": 2, "shot": self.script["shots"][2], "prompt": "矢量时钟记录服药时间"},
            ],
        }
        out = mix_plan.produce_svg_batch(client, "deepseek-flash", item, self.library)
        self.assertEqual({"0", "2"}, set(out["contents"]))
        self.assertEqual({}, out["errors"])
        self.assertEqual("svg", out["contents"]["0"]["kind"])
        self.assertIn("核对药盒", out["contents"]["0"]["svgCode"]["svg"])

    def test_produce_scene_generates_pure_code_and_auto_repairs_invalid_output(self):
        shot = self.script["shots"][1]
        valid_reply = {
            "reason": "用纯 SVG 药包与渐进要点呈现随身收纳步骤。",
            "code": {
                "html": '<div class="sc-stage"><svg viewBox="0 0 200 120"><rect x="20" y="20" width="160" height="80" rx="12" fill="var(--v-primary-soft)"/></svg><h3 class="t">打包随身药</h3></div>',
                "css": ".sc-stage{display:flex;align-items:center;justify-content:center;width:100%;height:100%;}",
                "js": "const el = root.querySelector('.t'); if (el) el.style.opacity = String(api.ease.outCubic(api.progress));",
            },
        }
        bad_reply = {
            "reason": "包含禁用 img 标签。",
            "code": {"html": '<div><img src="https://example.com/a.png"/></div>', "css": "", "js": ""},
        }
        client = Mock(side_effect=[model_response(bad_reply), model_response(valid_reply)])
        item = {**self.item, "presentation": "scene", "produceShot": {
            "shot": shot,
            "codePrompt": "左侧画随身药包矢量图，右侧展示原包装要点",
            "revision": "节奏更紧凑",
        }}
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual("scene", content["kind"])
        self.assertEqual("user", content["decidedBy"])
        self.assertEqual(valid_reply["reason"], content["reason"])
        self.assertEqual("左侧画随身药包矢量图，右侧展示原包装要点", content["codePrompt"])
        self.assertIn("sc-stage", content["code"]["html"])
        self.assertEqual(2, client.call_count)
        retry_payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertIn("validationFeedback", retry_payload)
        self.assertIn("img", retry_payload["validationFeedback"])

    def test_produce_scene_batch_generates_multiple_shots(self):
        valid = lambda label: model_response({
            "reason": f"纯代码渲染{label}。",
            "code": {"html": f"<div>{label}</div>", "css": "div{color:var(--v-ink);}", "js": "const p = api.progress;"},
        })
        client = Mock(side_effect=[valid("第一幕"), valid("第二幕")])
        item = {
            **self.item,
            "presentation": "scene",
            "produceSceneBatch": [
                {"index": 0, "shot": self.script["shots"][0], "codePrompt": "展示药盒有效期"},
                {"index": 2, "shot": self.script["shots"][2], "codePrompt": "展示服药时间轴"},
            ],
        }
        out = mix_plan.produce_scene_batch(client, "deepseek-flash", item, self.library)
        self.assertEqual({"0", "2"}, set(out["contents"]))
        self.assertEqual({}, out["errors"])
        self.assertEqual("scene", out["contents"]["0"]["kind"])
        self.assertIn("第一幕", out["contents"]["0"]["code"]["html"])

    def test_scene_and_card_do_not_expose_illustration_art_prompt(self):
        for kind in ("card", "scene"):
            self.assertNotIn("artPrompt", CATALOG["presenters"][kind]["options"])
        self.assertIn("code", CATALOG["presenters"]["scene"]["options"])
        self.assertIn("codePrompt", CATALOG["presenters"]["scene"]["options"])
        scene_prompt = mix_plan.build_produce_shot_prompt(self.item, self.library, kind="scene")
        self.assertNotIn("artPrompt", scene_prompt)
        self.assertIn("纯代码", scene_prompt)
        self.assertIn("严禁使用任何外部图片", scene_prompt)

    def test_produce_rejects_cosmetic_or_equivalent_changes(self):
        self.supports.append("mg")
        asset = {"id": "builtin:lottie/box", "kind": "lottie", "name": "药盒", "tags": ["药盒"]}
        self.library.items.return_value = [asset]
        shot = self.script["shots"][1]
        for kind, old, new in (
            ("card", {"motionStyle": "auto"}, {"motionStyle": "flow"}),
            ("mg", {"assetId": asset["id"]}, {"assetId": asset["id"], "fit": "hold", "overlay": "off"}),
        ):
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "相同的画面结构"):
                item = {**self.item, "presentation": kind, "produceShot": {"shot": shot, "previousParams": old}}
                client = Mock(return_value=model_response({"plans": [{"params": new, "reason": "重新呈现本幕。"}]}))
                mix_plan.produce_shot(client, "deepseek-flash", item, self.library)

    def test_produce_shot_rejects_same_or_invalid_parameters(self):
        shot = self.script["shots"][1]
        item = {**self.item, "presentation": "card", "produceShot": {
            "shot": shot, "previousParams": {"motionStyle": "flow"},
        }}
        reason = "用卡片解释本幕。"
        for params, error in [({"motionStyle": "flow"}, "相同"), ({"motionStyle": []}, "无效"),
                              ({"kind": "image"}, "无效"), ({}, "无效")]:
            with self.subTest(params=params), self.assertRaisesRegex(ValueError, error):
                client = Mock(return_value=model_response({"params": params, "reason": reason}))
                mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        item["produceShot"]["shot"] = {**shot, "line": ""}
        client = Mock()
        with self.assertRaises(ValueError):
            mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        client.assert_not_called()

    def test_produce_asset_can_change_motion_and_rejects_unknown_ids(self):
        shot = self.script["shots"][0]
        current = "builtin:svg/11"
        item = {**self.item, "presentation": "asset", "produceShot": {
            "shot": shot, "previousParams": {"assetId": current, "move": "still"},
        }}
        reply = {"params": {"assetId": current, "move": "zoom"}, "reason": "推近以突出药盒标签。"}
        client = Mock(return_value=model_response(reply))
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual((current, "zoom"), (content["assetId"], content["move"]))
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(current, payload["candidateAssets"][0]["id"])
        reply["params"]["assetId"] = "unlisted"
        client.return_value = model_response(reply)
        with self.assertRaisesRegex(ValueError, "保留原画面"):
            mix_plan.produce_shot(client, "deepseek-flash", item, self.library)

    def test_produce_mg_suggestion_retains_the_current_animation(self):
        self.supports.append("mg")
        asset = {"id": "builtin:lottie/box", "kind": "lottie", "name": "药盒", "tags": ["药盒"]}
        self.library.items.return_value = [asset]
        item = {**self.item, "presentation": "mg", "produceShot": {
            "shot": self.script["shots"][1], "previousParams": {"assetId": asset["id"], "fit": "hold", "overlay": "title"},
        }}
        suggestion = "药盒从左侧滑入，移进敞开的随身包，合上包口后停留。"
        client = Mock(return_value=model_response({"params": {}, "mgRequest": suggestion, "reason": "展示收纳动作。"}))
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual((asset["id"], "hold", "title", suggestion),
                         (content["assetId"], content["fit"], content["overlay"], content["mgRequest"]))

    def test_fixed_mg_uses_shot_candidates_or_an_unassigned_draft_suggestion(self):
        self.supports.append("mg")
        self.item["presentation"] = "mg"
        asset = {"id": "builtin:lottie/clock", "kind": "lottie", "name": "时间动画", "tags": ["时间"]}
        self.library.items.return_value = [asset, {"id": "pending:clock", "kind": "pending", "name": "时间", "tags": []}]
        suggestion = "药盒标签在画面中央停住，框出需要查看的区域。"
        with self.assertRaises(ValueError):
            mix_plan.validate_setup(self.item, self.library)
        client = Mock(return_value=model_response({"shots": [
            {"index": 0, "params": {}, "mgRequest": suggestion, "reason": "突出标签。"},
            {"index": 1, "params": {"assetId": asset["id"]}, "reason": "误选其他幕的动画。"},
            {"index": 2, "params": {"assetId": asset["id"], "overlay": "title", "fit": "hold"}, "reason": "时钟突出记录时间。"},
        ]}))
        result = mix_plan.arrange(client, "deepseek-flash", self.item, self.script, self.library, allow_legacy=True)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["mg"] * 3, [content["kind"] for content in contents])
        self.assertEqual(suggestion, contents[0]["mgRequest"])
        self.assertNotIn("assetId", contents[0])
        self.assertNotIn("assetId", contents[1])
        self.assertIn("请选择", contents[1]["adjusted"])
        self.assertEqual((asset["id"], "title", "hold"), (contents[2]["assetId"], contents[2]["overlay"], contents[2]["fit"]))
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual([[], [], [asset]], [shot["candidateAssets"] for shot in payload["shots"]])
        self.assertEqual([row["line"] for row in self.script["shots"]], [row["line"] for row in result["shots"]])

    def test_fixed_modes_force_kind_and_reject_retired_draft_modes(self):
        for retired in ("card", "mg", "asset"):
            with self.subTest(retired=retired), self.assertRaises(ValueError):
                mix_plan.validate_setup({**self.item, "presentation": retired}, self.library)
        for mode in ("image", "scene"):
            with self.subTest(mode=mode):
                self.item["presentation"] = mode
                result, client = self.arrange([])
                self.assertEqual([mode] * 3, [row["content"]["kind"] for row in result["shots"]])
                self.assertEqual(0, client.call_count)
                if mode == "scene":
                    self.assertTrue(all("form" not in row["content"] for row in result["shots"]))
        # SVG animation is a first-class fixed draft mode without needing allow_legacy.
        self.item["presentation"] = "svg"
        beats = [[{"action": "carton", "line": row["line"], "label": row["name"]}] for row in self.script["shots"]]
        svg_client = Mock(return_value=model_response({"shots": [{"index": i, "beats": b} for i, b in enumerate(beats)]}))
        svg_result = mix_plan.arrange(svg_client, "deepseek-flash", self.item, self.script, self.library)
        self.assertEqual(["svg"] * 3, [row["content"]["kind"] for row in svg_result["shots"]])
        self.assertEqual(beats[0], svg_result["shots"][0]["content"]["beats"])

    def test_script_request_ignores_presentation_and_normalizes_cues(self):
        raw = copy.deepcopy(self.script)
        raw["shots"][0]["cues"][0].update(focus=0, highlightWords=None)
        raw["shots"][1]["cues"][0]["focus"] = "layout-unsupported"
        client = Mock(return_value=model_response(raw))
        result = mix_plan.write_script(client, "deepseek-flash", self.item, 45, CATALOG)
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual({"topic", "drug", "referenceSeconds", "pointTypes"}, set(payload))
        self.assertEqual(["0", "all", "0"], [row["cues"][0]["focus"] for row in result["shots"]])
        self.assertTrue(all("content" not in row for row in result["shots"]))

    def test_mix_transition_accepts_supported_values_only(self):
        choices = [choice(self.script, i, "scene", transition=value)
                   for i, value in enumerate(("wipe", "iris", "unknown"))]
        result, client = self.arrange(choices)
        normalized = [row["content"].get("transition") for row in result["shots"]]
        self.assertEqual(["wipe", "iris", None], normalized)
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(CATALOG["transitions"], payload["transitions"])

    def test_invalid_non_image_fallback_uses_point_default(self):
        rows = [choice(self.script, i, "unavailable", fallback="image") for i in range(3)]
        result, _ = self.arrange(rows)
        self.assertEqual(["scene", "svg", "svg"], [row["content"]["kind"] for row in result["shots"]])
        self.assertTrue(all(row["content"]["adjusted"] for row in result["shots"]))

    def test_write_script_prompt_adds_qa_requirements_only_for_qa_layout(self):
        raw = copy.deepcopy(self.script)
        client = Mock(return_value=model_response(raw))
        mix_plan.write_script(client, "deepseek-flash", {**self.item, "layoutId": "builtin:layout/qa-chat"}, 45, CATALOG)
        qa_prompt = client.call_args.args[1]["messages"][0]["content"]
        self.assertIn("问答对话布局", qa_prompt)
        self.assertIn("points 都必须提供 question", qa_prompt)
        self.assertIn("verdictTone", qa_prompt)

        for other in ("builtin:layout/info-classic", "builtin:layout/headline", "builtin:layout/broadcast"):
            with self.subTest(layout=other):
                client.reset_mock()
                mix_plan.write_script(client, "deepseek-flash", {**self.item, "layoutId": other}, 45, CATALOG)
                prompt = client.call_args.args[1]["messages"][0]["content"]
                self.assertNotIn("问答对话布局", prompt)
                self.assertNotIn("verdictTone", prompt)
                self.assertIn("accentPhrase", prompt)
                self.assertIn("lead", prompt)

    def test_write_script_sanitizes_and_truncates_layout_data_fields(self):
        raw = copy.deepcopy(self.script)
        raw["drugTags"] = [" 缓释片制剂太长 ", "处方药", "第三个标签"]
        raw["shots"][0]["points"].update(
            headline="漏服了，也只吃一次",
            accentPhrase="也只吃一次",
            lead="这是一句非常详细的补充解释文字超过三十个字需要被系统自动截断保留前三十个字",
            question="昨天忘吃降压药今天能不能直接吃两片补回来请问医生这样安全吗会不会有危险",
            answer="不行一次只能吃常规剂量绝对不能吃双倍哦",
            verdictTone="no",
        )
        raw["shots"][1]["points"].update(
            headline="整片吞服别掰开",
            accentPhrase="不在标题里",
            lead="   ",
            question="缓释片能掰开吗？",
            answer="不能掰开",
            verdictTone="invalid-tone",
        )
        raw["shots"][2]["points"].update(
            headline="记住规律服药九个字超长短语",
            accentPhrase="记住规律服药九个字",
            verdictTone="warn",
        )
        client = Mock(return_value=model_response(raw))
        item = {**self.item, "layoutId": "builtin:layout/qa-chat", "drug": "硝苯地平缓释片"}
        result = mix_plan.write_script(client, "deepseek-flash", item, 45, CATALOG)
        prompt = client.call_args.args[1]["messages"][0]["content"]
        self.assertIn("drugTags", prompt)

        self.assertEqual(["缓释片制剂太", "处方药"], result["drugTags"])

        p0 = result["shots"][0]["points"]
        self.assertEqual("也只吃一次", p0["accentPhrase"])
        self.assertEqual(30, len(p0["lead"]))
        self.assertEqual(30, len(p0["question"]))
        self.assertEqual(16, len(p0["answer"]))
        self.assertEqual("no", p0["verdictTone"])

        p1 = result["shots"][1]["points"]
        self.assertNotIn("accentPhrase", p1)
        self.assertNotIn("lead", p1)
        self.assertEqual("缓释片能掰开吗？", p1["question"])
        self.assertEqual("不能掰开", p1["answer"])
        self.assertNotIn("verdictTone", p1)

        p2 = result["shots"][2]["points"]
        self.assertNotIn("accentPhrase", p2)  # > 8 chars dropped
        self.assertEqual("warn", p2["verdictTone"])

    def test_prompts_and_payloads_include_layout_media_dimensions(self):
        import server

        for lid, expected_size, expected_shape in (
            ("builtin:layout/broadcast", "1280×504", "ultrawide"),
            ("builtin:layout/qa-chat", "1120×388", "shallow-wide"),
            ("builtin:layout/headline", "642×510", "narrow"),
            ("builtin:layout/takeaway", "820×460", "compact"),
        ):
            with self.subTest(layout=lid):
                raw = copy.deepcopy(self.script)
                client = Mock(return_value=model_response(raw))
                mix_plan.write_script(client, "deepseek-flash", {**self.item, "layoutId": lid}, 45, CATALOG, library=server.ASSETS)
                script_prompt = client.call_args.args[1]["messages"][0]["content"]
                self.assertIn(expected_size, script_prompt)

                rows = [choice(self.script, i, "scene") for i in range(3)]
                arrange_client = Mock(return_value=model_response({"shots": rows}))
                mix_plan.arrange(arrange_client, "deepseek-flash", {**self.item, "layoutId": lid}, self.script, server.ASSETS)
                arrange_sys = arrange_client.call_args.args[1]["messages"][0]["content"]
                arrange_payload = json.loads(arrange_client.call_args.args[1]["messages"][1]["content"])
                self.assertIn(expected_size, arrange_sys)
                self.assertEqual(expected_shape, arrange_payload["layoutMedia"]["shape"])
                if lid == "builtin:layout/headline":
                    self.assertEqual("narrow", arrange_payload["layoutMedia"]["shape"])
                    self.assertNotIn("artPrompt", arrange_sys)

    def test_write_script_auto_tightens_overlong_script(self):
        overlong = copy.deepcopy(self.script)
        for shot in overlong["shots"]:
            shot["line"] = "孩子发烧时退烧药一定要按体重计算用量并且注意间隔时间不能随意叠加服用。" * 3
            shot["cues"] = [{"text": shot["line"], "focus": "0", "weight": len(shot["line"])}]
        tightened = copy.deepcopy(self.script)
        client = Mock(side_effect=[model_response(overlong), model_response(tightened)])
        result = mix_plan.write_script(client, "deepseek-flash", self.item, 30, CATALOG)
        self.assertEqual(2, client.call_count)
        self.assertLessEqual(sum(s["seconds"] for s in result["shots"]), 34)
        self.assertEqual(tightened["shots"][0]["line"], result["shots"][0]["line"])

    def test_write_script_returns_best_effort_after_tighten_attempts(self):
        overlong = copy.deepcopy(self.script)
        for shot in overlong["shots"]:
            shot["line"] = "孩子发烧时退烧药一定要按体重计算用量并且注意间隔时间不能随意叠加服用。" * 3
            shot["cues"] = [{"text": shot["line"], "focus": "0", "weight": len(shot["line"])}]
        shorter_still_over = copy.deepcopy(self.script)
        for shot in shorter_still_over["shots"]:
            shot["line"] = "孩子发烧时退烧药一定要按体重计算用量并且注意间隔时间。" * 2
            shot["cues"] = [{"text": shot["line"], "focus": "0", "weight": len(shot["line"])}]
        client = Mock(side_effect=[
            model_response(overlong),
            model_response(shorter_still_over),
            model_response(shorter_still_over),
        ])
        result = mix_plan.write_script(client, "deepseek-flash", self.item, 30, CATALOG)
        self.assertEqual(3, client.call_count)
        self.assertEqual(shorter_still_over["shots"][0]["line"], result["shots"][0]["line"])

    def test_script_prompt_lets_model_plan_scenes_with_opening_and_closing(self):
        for reference, scenes, chars in ((30, "3–5 幕", "不超过 112 字"), (60, "3–7 幕", "不超过 220 字")):
            with self.subTest(reference=reference):
                prompt = mix_plan.build_script_prompt(self.item, reference)
                self.assertIn(scenes, prompt)
                self.assertIn(chars, prompt)
                self.assertIn("第一幕是开头，最后一幕是收尾", prompt)
                self.assertIn("开头幕用 cover，收尾幕用 summary", prompt)
                self.assertNotIn('"type":"结构"', prompt)
                self.assertNotIn("每幕 1–2 拍", prompt)
        open_prompt = mix_plan.build_script_prompt(self.item, None)
        self.assertIn("未指定参考时长", open_prompt)
        self.assertIn("3–7 幕", open_prompt)

    def test_tighten_prompt_keeps_opening_and_closing(self):
        overlong = copy.deepcopy(self.script)
        for shot in overlong["shots"]:
            shot["line"] = "孩子发烧时退烧药一定要按体重计算用量并且注意间隔时间不能随意叠加服用。" * 3
            shot["cues"] = [{"text": shot["line"], "focus": "0", "weight": len(shot["line"])}]
        client = Mock(side_effect=[model_response(overlong), model_response(copy.deepcopy(self.script))])
        mix_plan.write_script(client, "deepseek-flash", self.item, 30, CATALOG)
        tighten_prompt = client.call_args.args[1]["messages"][0]["content"]
        self.assertIn("保留第一幕开头和最后一幕收尾", tighten_prompt)
        self.assertIn("全片保留 3–5 幕", tighten_prompt)

    def test_write_script_uses_custom_script_prompt_when_provided(self):
        raw = copy.deepcopy(self.script)
        custom_prompt = "自定义医院科普短视频提示词：第一句必须抛痛点，返回 JSON 格式。"
        client = Mock(return_value=model_response(raw))
        result = mix_plan.write_script(
            client, "deepseek-flash", {**self.item, "scriptPrompt": custom_prompt}, 45, CATALOG,
        )
        self.assertEqual(custom_prompt, client.call_args.args[1]["messages"][0]["content"])
        self.assertEqual(raw["title"], result["title"])

        default_built = mix_plan.build_script_prompt(self.item, 45)
        client.reset_mock()
        mix_plan.write_script(client, "deepseek-flash", self.item, 45, CATALOG)
        self.assertEqual(default_built, client.call_args.args[1]["messages"][0]["content"])

    def test_arrange_and_produce_shot_use_custom_prompts_when_provided(self):
        custom_arrange = '自定义编排提示词，只返回 JSON：{"shots":[{"index":0,"kind":"card","reason":"...","fallback":"card","params":{}}]}'
        reply = {"shots": [
            {"index": i, "kind": "card", "reason": f'「{row["name"]}」使用卡片讲解', "fallback": "card", "params": {"motionStyle": "flow"}}
            for i, row in enumerate(self.script["shots"])
        ]}
        client = Mock(return_value=model_response(reply))
        mix_plan.arrange(
            client, "deepseek-flash",
            {**self.item, "presentation": "mix", "arrangePrompt": custom_arrange},
            copy.deepcopy(self.script), self.library,
        )
        self.assertEqual(custom_arrange, client.call_args.args[1]["messages"][0]["content"])

        custom_produce = '自定义单幕制作提示词，只返回 JSON：{"plans":[{"params":{},"reason":"..."}]}'
        prod_reply = {"plans": [{"params": {"motionStyle": "pulse"}, "reason": "突出提醒节奏"}]}
        p_client = Mock(return_value=model_response(prod_reply))
        mix_plan.produce_shot(
            p_client, "deepseek-flash",
            {
                **self.item,
                "presentation": "card",
                "produceShot": {"shot": copy.deepcopy(self.script["shots"][0]), "previousParams": {"motionStyle": "flow"}},
                "produceShotPrompt": custom_produce,
            },
            self.library,
        )
        self.assertEqual(custom_produce, p_client.call_args.args[1]["messages"][0]["content"])

        with self.assertRaisesRegex(ValueError, "JSON"):
            mix_plan.validate_setup({**self.item, "presentation": "mix", "arrangePrompt": "没有格式关键字"}, self.library)
        with self.assertRaisesRegex(ValueError, "JSON"):
            mix_plan.validate_setup(
                {**self.item, "presentation": "card", "produceShot": {"shot": copy.deepcopy(self.script["shots"][0])}, "produceShotPrompt": "没有格式关键字"},
                self.library,
            )


if __name__ == "__main__":
    unittest.main()
