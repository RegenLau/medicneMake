from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import uuid

import asset_library
import mg_generation
import mix_plan
import motion_asset
import server
import stage_video
from test_mix_plan import choice, model_response, script_fixture


def example():
    return {"name":"药盒滑动","useFor":"演示移动药盒","spec":{"schemaVersion":1,"duration":3,
            "svg":'<svg viewBox="0 0 800 450"><rect data-part="box" x="300" y="200" width="150" height="90" fill="var(--v-primary)"/></svg>',
            "tracks":[{"part":"box","prop":"translateX","from":-70,"to":30,"start":0,"end":.7,"ease":"outCubic"}],
            "events":[{"type":"check","t":.7}]}}


class MGGenerationTests(unittest.TestCase):
    def setUp(self):
        self.item = {"description":"药盒滑动","theme":"medical"}

    def test_invalid_output_reports_error_then_repairs(self):
        bad = example()
        bad["spec"]["tracks"][0]["part"] = "missing"
        client = Mock(side_effect=[model_response(bad),model_response(example())])
        progress = Mock()
        result = mg_generation.generate(client,"deepseek-flash",self.item,progress)
        self.assertEqual(2,client.call_count)
        self.assertEqual(1,result["repairCount"])
        self.assertIn("data-part",result["repairReasons"][0])
        self.assertIn("data-part",json.loads(client.call_args.args[1]["messages"][1]["content"])["validationFeedback"])
        progress.assert_called_once_with(1)

    def test_after_two_repairs_stops_with_error(self):
        invalid = example()
        invalid["spec"]["tracks"][0]["end"] = 1.1
        client = Mock(return_value=model_response(invalid))
        with self.assertRaisesRegex(ValueError,"修正 2 次后"):
            mg_generation.generate(client,"deepseek-flash",self.item)
        self.assertEqual(3,client.call_count)

    def test_provider_errors_are_not_retried_as_validation_errors(self):
        client = Mock(side_effect=ValueError("DeepSeek 账户余额不足"))
        with self.assertRaisesRegex(mg_generation.ProviderFailure,"余额不足"):
            mg_generation.generate(client,"deepseek-flash",self.item)
        client.assert_called_once()

    def test_schema_accepts_only_theme_paint_parts_and_whitelisted_tracks(self):
        for field,replacement,reason in (
            ("svg",'<svg viewBox="0 0 800 450"><text>药品</text></svg>',"不能包含文字"),
            ("svg",'<svg viewBox="0 0 800 450"><g data-part="box" fill="#123456"/></svg>',"主题变量"),
            ("svg",'<svg viewBox="0 0 800 450"><g data-part="box" onload="x"/></svg>',"不支持的属性"),
            ("events",[{"type":"external","t":.4}],"音效事件"),
        ):
            draft = deepcopy(example()["spec"])
            draft[field] = replacement
            with self.subTest(field=field), self.assertRaisesRegex(ValueError,reason):
                motion_asset.mg_package(json.dumps(draft).encode(),asset_library.clean_svg)

    def test_pending_is_inaccessible_to_composition_and_mix_until_confirmed(self):
        generated = mg_generation.generate(Mock(return_value=model_response(example())),"deepseek-flash",self.item)
        with tempfile.TemporaryDirectory() as temporary:
            library = asset_library.LocalLibrary(Path(temporary),server.ASSETS.builtin_root)
            def preview(asset,path):
                self.assertEqual("mg",asset["kind"])
                path.mkdir(parents=True,exist_ok=True)
                for filename in ("poster.jpg","preview.mp4"):
                    (path/filename).write_bytes(b"local test fixture")
            draft_id = "pending:" + str(uuid.uuid4())
            pending = library.save_pending(draft_id,generated,"deepseek-flash",preview)
            self.assertEqual("pending",pending["status"])
            self.assertTrue(library.pending_preview_file(draft_id,"preview.mp4").is_file())
            self.assertNotIn(draft_id,[row["id"] for row in library.items()])
            script = script_fixture()
            item = {"topic":"药盒滑动演示","presentation":"mix","layoutId":stage_video.CLASSIC_LAYOUT,"imageBudget":0}
            shots = [choice(script,i,"mg",params={"assetId":draft_id},mgRequest="让药盒从左滑入") for i in range(3)]
            model = Mock(return_value=model_response({"shots":shots}))
            output = mix_plan.arrange(model,"deepseek-flash",item,script,library)
            self.assertEqual(["scene"]*3,[row["content"]["kind"] for row in output["shots"]])
            self.assertEqual("让药盒从左滑入",output["shots"][0]["content"]["mgRequest"])
            payload = {"title":script["title"],"items":[{**script["shots"][0],"content":{"kind":"mg","assetId":draft_id}}]}
            with self.assertRaises(ValueError):
                stage_video.stage_input(payload,library,server.media_path)
            confirmed = library.decide_pending(draft_id,True)
            self.assertEqual("mg",confirmed["kind"])
            self.assertEqual("ai",confirmed["source"])
            self.assertEqual(confirmed["id"],library.decide_pending(draft_id,True)["id"])
            self.assertEqual([],library.pending_items())
            self.assertTrue(library.motion_preview_file(confirmed["id"],"poster.jpg").is_file())
            with self.assertRaises(ValueError):
                library.pending_preview_file(draft_id,"preview.mp4")
            payload["items"][0]["content"]["assetId"] = confirmed["id"]
            _,_,rows,_,used = stage_video.stage_input(payload,library,server.media_path)
            self.assertEqual("mg",rows[0]["motionAsset"]["kind"])
            self.assertEqual(confirmed["id"],used[-1][1]["id"])
            for row in shots:
                row["params"]["assetId"] = confirmed["id"]
            model.return_value = model_response({"shots":shots})
            output = mix_plan.arrange(model,"deepseek-flash",item,script,library)
            self.assertEqual(["mg"]*3,[row["content"]["kind"] for row in output["shots"]])
            self.assertNotIn("mgRequest",output["shots"][0]["content"])

            discard_id = "pending:" + str(uuid.uuid4())
            discarded = library.save_pending(discard_id,generated,"deepseek-flash",preview,draft_id)
            self.assertEqual(draft_id,discarded["parentId"])
            library.decide_pending(discard_id,False)
            self.assertEqual([],library.pending_items())
            with self.assertRaises(ValueError):
                library.decide_pending(discard_id,True)
