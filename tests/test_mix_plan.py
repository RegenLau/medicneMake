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
        self.item = {"topic": "出门怎么带药", "layoutId": "builtin:layout/info-classic", "presentation": "mix",
                     "imageBudget": 2}
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

    def test_unsupported_kind_and_invalid_asset_use_fallback(self):
        self.supports.remove("svg")
        choices = [choice(self.script, 0, "svg", "card"),
                   choice(self.script, 1, "asset", params={"assetId": "outside-catalog"}),
                   choice(self.script, 2, "asset", params={"assetId": "builtin:svg/0", "move": "zoom"})]
        result, client = self.arrange(choices)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["card", "scene", "asset"], [entry["kind"] for entry in contents])
        self.assertIn("布局", contents[0]["adjusted"])
        self.assertIn("参数", contents[1]["adjusted"])
        self.assertEqual({"assetId": "builtin:svg/0", "assetName": "药盒 0", "move": "zoom"},
                         {key: contents[2][key] for key in ("assetId", "assetName", "move")})
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(self.supports, payload["supports"])
        self.assertEqual(2, payload["imageBudget"])
        self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in payload["shots"]])
        self.assertEqual(10, len(payload["candidateAssets"]))
        self.assertEqual({"id", "name", "tags"}, set(payload["candidateAssets"][0]))
        for details in payload["presenters"].values():
            self.assertEqual({"strengths", "avoid", "cost", "options"}, set(details))

    def test_budget_prioritizes_model_rank_and_zero_rejects_all(self):
        rows = [choice(self.script, i, "image", priority=priority) for i, priority in enumerate((25, 90, 75))]
        result, _ = self.arrange(rows)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual(["scene", "image", "image"], [c["kind"] for c in contents])
        self.assertIn("上限", contents[0]["adjusted"])
        self.item["imageBudget"] = 0
        result, _ = self.arrange(rows)
        self.assertEqual(["scene"] * 3, [row["content"]["kind"] for row in result["shots"]])

    def test_malformed_output_and_network_failure_continue(self):
        for client in (Mock(side_effect=OSError("offline")), Mock(return_value=model_response({"shots": []}))):
            with self.subTest(client=client):
                result, _ = self.arrange(client=client)
                self.assertEqual(mix_plan.FAILURE_NOTICE, result["notice"])
                self.assertEqual(["card", "scene", "card"], [row["content"]["kind"] for row in result["shots"]])
                self.assertTrue(all(row["content"]["adjusted"] for row in result["shots"]))
                self.assertEqual([shot["line"] for shot in self.script["shots"]], [shot["line"] for shot in result["shots"]])

    def test_replan_preserves_user_rows_and_allocates_remaining_images(self):
        self.script["shots"][0]["content"] = {"kind": "image", "image": "/existing.jpg", "decidedBy": "user"}
        self.script["shots"][1]["content"] = {"kind": "scene", "decidedBy": "mix"}
        self.script["shots"][2]["content"] = {"kind": "card", "decidedBy": "mix"}
        self.item["script"] = self.script
        rows = [choice(self.script, 1, "image", priority=60), choice(self.script, 2, "image", priority=80)]
        result, client = self.arrange(rows)
        self.assertEqual([1, 2], result["plannedIndices"])
        self.assertEqual(self.script["shots"][0], result["shots"][0])
        self.assertEqual(["image", "scene", "image"], [row["content"]["kind"] for row in result["shots"]])
        payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual(1, payload["remainingImageBudget"])
        self.assertEqual(["image", "scene", "card"], [row["currentKind"] for row in payload["shots"]])
        self.item["targetIndex"] = 0
        result, _ = self.arrange([choice(self.script, 0, "card")])
        self.assertEqual([0], result["plannedIndices"])
        self.assertEqual("card", result["shots"][0]["content"]["kind"])
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
        self.assertEqual(1, payload["remainingImageBudget"])
        self.assertEqual("", payload["shots"][0]["line"])
        for target in (None, 0, 2):
            with self.subTest(target=target), self.assertRaises(ValueError):
                mix_plan.validate_setup({**self.item, "targetIndex": target}, self.library)

    def test_produce_shot_uses_selected_kind_and_only_passes_target_script(self):
        shot = self.script["shots"][1]
        examples = [
            ("card", {"motionStyle": "auto"}, {"motionStyle": "spotlight"}),
            ("scene", {"visual": "steps"}, {"visual": "mechanism", "motif": "pill"}),
            ("svg", {"beats": [{"action": "carton", "line": "原包装药盒", "label": "药盒"}]},
             {"beats": [{"action": "travel", "line": "放进随身包", "label": "放进随身包"}]}),
        ]
        original = copy.deepcopy(shot)
        for kind, previous, params in examples:
            with self.subTest(kind=kind):
                reason = "把动作拆成观众容易看懂的画面。"
                client = Mock(return_value=model_response({"plans": [{"params": params, "reason": reason}]}))
                item = {**self.item, "presentation": kind, "produceShot": {
                    "shot": shot, "previousParams": previous, "revision": "突出手边要核对的对象",
                }}
                result = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
                self.assertEqual(kind, result["kind"])
                self.assertEqual("user", result["decidedBy"])
                self.assertEqual(reason, result["reason"])
                self.assertEqual(params, {key: result[key] for key in params})
                client.assert_called_once()
                payload = json.loads(client.call_args.args[1]["messages"][1]["content"])
                self.assertEqual(shot, payload["shot"])
                self.assertEqual(previous, payload["previousParams"])
                self.assertEqual("突出手边要核对的对象", payload["revision"])
                self.assertEqual(original, shot)

    def test_produce_scene_skips_color_only_and_uses_content_based_plan_in_one_request(self):
        shot = self.script["shots"][1]
        item = {**self.item, "presentation": "scene", "produceShot": {"shot": shot, "previousParams": {"visual": "steps"}}}
        plans = [
            {"params": {"visual": "steps", "tone": "warm"}, "reason": "使用暖色强调药盒。"},
            {"params": {"visual": "compare"}, "reason": "并排比较两个对象。"},
            {"params": {"visual": "mechanism", "motif": "bottle"}, "reason": "用药盒图形连接随身收纳要点。"},
        ]
        client = Mock(return_value=model_response({"plans": plans}))
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual(("mechanism", "bottle"), (content["visual"], content["motif"]))
        self.assertEqual(plans[2]["reason"], content["reason"])
        client.assert_called_once()
        request = json.loads(client.call_args.args[1]["messages"][1]["content"])
        self.assertEqual("flow", request["currentPlan"]["motion"])
        client.return_value = model_response({"plans": plans[:2]})
        with self.assertRaisesRegex(ValueError, "保留原画面"):
            mix_plan.produce_shot(client, "deepseek-flash", item, self.library)

    def test_produce_card_and_scene_carry_illustration_prompt(self):
        for kind in ("card", "scene"):
            self.assertIn("artPrompt", CATALOG["presenters"][kind]["options"])
        shot = self.script["shots"][1]
        art = "一只手把原包装药盒放进敞开的随身包内层。"
        item = {**self.item, "presentation": "scene", "produceShot": {
            "shot": shot, "previousParams": {"visual": "steps", "motion": "flow"},
        }}
        client = Mock(return_value=model_response({"plans": [
            {"params": {"visual": "steps", "motion": "flow", "artPrompt": "  " + art + " "}, "reason": "插画展示收纳动作。"},
        ]}))
        content = mix_plan.produce_shot(client, "deepseek-flash", item, self.library)
        self.assertEqual(art, content["artPrompt"])
        instruction = client.call_args.args[1]["messages"][0]["content"]
        self.assertIn("artPrompt", instruction)
        item["produceShot"]["previousParams"] = {"visual": "steps", "motion": "flow", "artPrompt": art}
        for params in ({"visual": "steps", "motion": "flow", "artPrompt": art},
                       {"visual": "steps", "motion": "flow", "artPrompt": "长" * 301}):
            with self.subTest(params=params), self.assertRaisesRegex(ValueError, "保留原画面"):
                client = Mock(return_value=model_response({"plans": [{"params": params, "reason": "重新呈现本幕。"}]}))
                mix_plan.produce_shot(client, "deepseek-flash", item, self.library)

    def test_mix_keeps_illustration_prompt_for_card(self):
        rows = [choice(self.script, 0, "card", params={"motionStyle": "reveal", "artPrompt": "药盒侧面的标签被放大镜照亮。"}),
                choice(self.script, 1, "scene"), choice(self.script, 2, "card")]
        result, client = self.arrange(rows)
        contents = [row["content"] for row in result["shots"]]
        self.assertEqual("药盒侧面的标签被放大镜照亮。", contents[0]["artPrompt"])
        self.assertNotIn("artPrompt", contents[2])
        self.assertIn("artPrompt", client.call_args.args[1]["messages"][0]["content"])

    def test_produce_rejects_cosmetic_or_equivalent_changes(self):
        self.supports.append("mg")
        asset = {"id": "builtin:lottie/box", "kind": "lottie", "name": "药盒", "tags": ["药盒"]}
        self.library.items.return_value = [asset]
        shot = self.script["shots"][1]
        for kind, old, new in (
            ("card", {"motionStyle": "auto"}, {"motionStyle": "flow"}),
            ("scene", {"visual": "steps"}, {"visual": "steps", "motif": "pill"}),
            ("svg", {"beats": [{"action": "travel", "line": shot["line"], "label": "装药"}]},
             {"beats": [{"action": "travel", "line": shot["line"], "label": "随身装药"}]}),
            ("mg", {"assetId": asset["id"]}, {"assetId": asset["id"], "fit": "hold", "overlay": "off"}),
        ):
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "相同的画面结构"):
                item = {**self.item, "presentation": kind, "produceShot": {"shot": shot, "previousParams": old}}
                client = Mock(return_value=model_response({"plans": [{"params": new, "reason": "重新呈现本幕。"}]}))
                mix_plan.produce_shot(client, "deepseek-flash", item, self.library)

    def test_produce_shot_rejects_same_or_invalid_parameters(self):
        shot = self.script["shots"][1]
        item = {**self.item, "presentation": "scene", "produceShot": {
            "shot": shot, "previousParams": {"visual": "steps"},
        }}
        reason = "用流程解释本幕。"
        for params, error in [({"visual": "steps"}, "相同"), ({"visual": []}, "无效"),
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
        result, client = self.arrange([
            {"index": 0, "params": {}, "mgRequest": suggestion, "reason": "突出标签。"},
            {"index": 1, "params": {"assetId": asset["id"]}, "reason": "误选其他幕的动画。"},
            {"index": 2, "params": {"assetId": asset["id"], "overlay": "title", "fit": "hold"}, "reason": "时钟突出记录时间。"},
        ])
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

    def test_fixed_modes_force_kind_and_only_svg_requests_second_pass(self):
        beats = [[{"action": "carton", "line": row["line"], "label": row["name"]}] for row in self.script["shots"]]
        for mode in ("image", "card", "scene", "svg"):
            with self.subTest(mode=mode):
                self.item["presentation"] = mode
                result, client = self.arrange([{"index": i, "beats": b} for i, b in enumerate(beats)])
                self.assertEqual([mode] * 3, [row["content"]["kind"] for row in result["shots"]])
                self.assertEqual(int(mode == "svg"), client.call_count)
                if mode == "svg":
                    self.assertEqual(beats[0], result["shots"][0]["content"]["beats"])

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
        self.assertEqual(["card", "scene", "card"], [row["content"]["kind"] for row in result["shots"]])
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
                    self.assertEqual("top", arrange_payload["layoutMedia"]["art"]["placement"])
                    self.assertIn("顶部横向插画区", arrange_sys)

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


if __name__ == "__main__":
    unittest.main()
