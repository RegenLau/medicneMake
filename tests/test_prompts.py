import json
import unittest
from unittest.mock import patch

import server
from draft_content import article_draft, article_images, ask_json, validate_request, video_draft


def fake_ark(payload, prompts):
    def ark(path, body, **_):
        prompts.append(body["messages"][0]["content"])
        return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(payload, ensure_ascii=False)}}]}
    return ark


ARTICLE = {
    "title": "药盒上的有效期怎么看",
    "lead": "整理药箱时，先分清药盒上的几串日期。",
    "sections": [{"name": f"第{i}步", "line": "把药盒转到印有日期的一面，先读数字旁边的字段名称。" * 6} for i in range(4)],
}
BEATS = [
    {"name": "开场", "line": "药盒上几串数字，哪一个才是有效期？", "scene": "近景，木桌上的药盒", "motion": "一只手拿起药盒"},
    {"name": "找字段", "line": "先看数字旁的字段，认准有效期至，再读后面的日期。", "scene": "特写，药盒侧面", "motion": "手指指向日期区"},
]


class ArticlePromptTests(unittest.TestCase):
    def test_layout_and_drug_rules_reach_the_writer(self):
        for layout in ("通俗图解版", "临床深度版", "避坑问答版"):
            for drug in ("", "布洛芬缓释胶囊"):
                with self.subTest(layout=layout, drug=drug):
                    prompts = []
                    draft = article_draft(fake_ark(ARTICLE, prompts), "test",
                                          {"type": "article", "topic": "有效期", "layout": layout, "drug": drug})
                    self.assertEqual(draft["title"], ARTICLE["title"])
                    prompt = prompts[0]
                    self.assertIn("AI数智人药师", prompt)
                    self.assertIn(f"【排版：{layout}】", prompt)
                    self.assertIn("不写品牌、厂家、价格和购买渠道", prompt)
                    if drug:
                        self.assertIn(f"全文围绕「{drug}」展开", prompt)
                    else:
                        self.assertIn("未关联具体药品", prompt)
        prompts = []
        article_draft(fake_ark(ARTICLE, prompts), "test", {"type": "article", "topic": "有效期", "layout": "临床深度版"})
        self.assertIn("不写指南名称、发布年份、研究或统计数据", prompts[0])

    def test_image_plan_uses_layout_counts(self):
        prompts = []
        images = article_images(fake_ark({"images": [{"section": 2, "scene": " 近景，一只手转动药盒 "}]}, prompts),
                                "test", ARTICLE, "通俗图解版")
        self.assertEqual(images, [{"section": 2, "scene": "近景，一只手转动药盒"}])
        self.assertIn("本篇是「通俗图解版」，参考数量 2 到 4 张", prompts[0])
        self.assertIn("不画品牌标识和红十字", prompts[0])

    def test_custom_article_draft_and_image_prompts_override_and_validate(self):
        custom_body = '自定义文章正文提示词，必须返回 JSON：{"title":"","lead":"","sections":[]}'
        custom_img = '自定义配图规划提示词，必须返回 JSON：{"images":[{"section":1,"scene":""}]}'
        prompts = []
        draft = article_draft(
            fake_ark(ARTICLE, prompts),
            "test",
            {"type": "article", "topic": "有效期", "layout": "通俗图解版", "articlePrompt": custom_body},
        )
        self.assertEqual(draft["title"], ARTICLE["title"])
        self.assertEqual(prompts[0], custom_body)

        img_prompts = []
        imgs = article_images(
            fake_ark({"images": [{"section": 1, "scene": "药盒特写"}]}, img_prompts),
            "test",
            ARTICLE,
            "通俗图解版",
            custom_prompt=custom_img,
        )
        self.assertEqual(imgs, [{"section": 1, "scene": "药盒特写"}])
        self.assertEqual(img_prompts[0], custom_img)

        validate_request(
            {"type": "article", "topic": "有效期", "layout": "通俗图解版", "articlePrompt": custom_body, "articleImagePrompt": custom_img},
            {"ratio": "16:9"},
            {},
        )
        with self.assertRaisesRegex(ValueError, "JSON"):
            validate_request(
                {"type": "article", "topic": "有效期", "layout": "通俗图解版", "articlePrompt": "缺少格式关键字"},
                {"ratio": "16:9"},
                {},
            )
        with self.assertRaisesRegex(ValueError, "JSON"):
            validate_request(
                {"type": "article", "topic": "有效期", "layout": "通俗图解版", "articleImagePrompt": "缺少格式关键字"},
                {"ratio": "16:9"},
                {},
            )

    def test_server_default_prompt_template_supports_phase1_channels(self):
        art_draft = server.default_prompt_template({"kind": "article-draft", "layout": "临床深度版", "drug": "阿司匹林肠溶片"})
        self.assertIn("临床深度版", art_draft["prompt"])
        self.assertIn("阿司匹林肠溶片", art_draft["prompt"])
        self.assertIn("JSON", art_draft["prompt"])

        art_img = server.default_prompt_template({"kind": "article-images", "layout": "避坑问答版"})
        self.assertIn("避坑问答版", art_img["prompt"])
        self.assertIn("JSON", art_img["prompt"])

        arrange = server.default_prompt_template({"kind": "stage-arrange", "layoutId": "builtin:layout/qa-chat", "presentation": "mix"})
        self.assertIn("JSON", arrange["prompt"])
        self.assertIn("formCatalog", arrange["prompt"])

        produce = server.default_prompt_template({"kind": "stage-produce", "layoutId": "builtin:layout/info-classic", "presentation": "card"})
        self.assertIn("JSON", produce["prompt"])
        self.assertIn("plans", produce["prompt"])

        with self.assertRaisesRegex(ValueError, "提示词类型"):
            server.default_prompt_template({"kind": "unknown"})


class VideoPromptTests(unittest.TestCase):
    def run_draft(self, item, ratio="9:16"):
        prompts = []
        payload = {"title": "有效期怎么看", "setting": "家中木桌，白色药箱和浅蓝色药盒", "beats": BEATS}
        draft = video_draft(fake_ark(payload, prompts), "test", {"type": "video", "topic": "有效期", **item}, 30, 15, ratio)
        return draft, prompts[0]

    def test_setting_ratio_and_presenter(self):
        draft, prompt = self.run_draft({}, "16:9")
        self.assertEqual(draft["setting"], "家中木桌，白色药箱和浅蓝色药盒")
        self.assertEqual([shot["motion"] for shot in draft["shots"]], ["一只手拿起药盒", "手指指向日期区"])
        self.assertIn("横屏 16:9 用药科普短视频", prompt)
        self.assertIn("只让一双手入镜", prompt)
        self.assertIn("不写点赞、关注、收藏", prompt)
        _, prompt = self.run_draft({"pharmacist": True})
        self.assertIn("全片由同一位药师出镜", prompt)
        self.assertIn("竖屏 9:16", prompt)

    def test_setting_is_optional_and_ratio_is_checked(self):
        prompts = []
        draft = video_draft(fake_ark({"title": "有效期", "beats": BEATS}, prompts), "test",
                            {"type": "video", "topic": "有效期"}, None, 15)
        self.assertEqual(draft["setting"], "")
        with self.assertRaisesRegex(ValueError, "画幅"):
            validate_request({"type": "video", "topic": "有效期"}, {"ratio": "4:3", "videoModel": "m"}, {"m": None})

    def test_custom_script_prompt_override_and_validation(self):
        custom = "这是优化后的自定义提示词，请严格返回 JSON 格式：{\"title\":\"\",\"setting\":\"\",\"beats\":[]}"
        draft, prompt = self.run_draft({"scriptPrompt": custom}, "16:9")
        self.assertEqual(prompt, custom)
        self.assertEqual(draft["title"], "有效期怎么看")

        validate_request(
            {"type": "video", "topic": "有效期", "scriptPrompt": custom},
            {"ratio": "9:16", "videoModel": "m"},
            {"m": None},
        )
        with self.assertRaisesRegex(ValueError, "JSON"):
            validate_request(
                {"type": "video", "topic": "有效期", "scriptPrompt": "没有输出格式关键字的提示词"},
                {"ratio": "9:16", "videoModel": "m"},
                {"m": None},
            )
        with self.assertRaisesRegex(ValueError, "长度"):
            validate_request(
                {"type": "video", "topic": "有效期", "scriptPrompt": "JSON " + ("长" * 20001)},
                {"ratio": "9:16", "videoModel": "m"},
                {"m": None},
            )

    def test_server_default_video_script_prompt_reflects_mode_and_options(self):
        stage_classic = server.default_video_script_prompt({"videoMode": "stage"})
        self.assertEqual(stage_classic["mode"], "stage")
        self.assertIn("AI数智人药师", stage_classic["prompt"])
        self.assertIn("JSON", stage_classic["prompt"])
        self.assertNotIn("问答对话布局", stage_classic["prompt"])

        stage_qa = server.default_video_script_prompt({
            "videoMode": "stage",
            "layoutId": "builtin:layout/qa-chat",
            "drug": "阿托伐他汀钙片",
            "duration": 60,
        })
        self.assertIn("问答对话布局", stage_qa["prompt"])
        self.assertIn("阿托伐他汀钙片", stage_qa["prompt"])
        self.assertIn("60 秒", stage_qa["prompt"])

        sb = server.default_video_script_prompt({
            "videoMode": "storyboard",
            "ratio": "16:9",
            "duration": 45,
            "pharmacist": True,
        })
        self.assertEqual(sb["mode"], "storyboard")
        self.assertIn("横屏 16:9", sb["prompt"])
        self.assertIn("45 秒", sb["prompt"])
        self.assertIn("全片由同一位药师出镜", sb["prompt"])

        with self.assertRaisesRegex(ValueError, "模式"):
            server.default_video_script_prompt({"videoMode": "unknown"})


class DeepSeekDraftTests(unittest.TestCase):
    def test_ask_json_uses_max_tokens_and_thinking_disabled_for_deepseek(self):
        captured = []

        def fake_client(path, body, **_):
            captured.append((path, body))
            return {"choices": [{"finish_reason": "stop", "message": {"content": '{"ok": true}'}}]}

        result = ask_json(fake_client, "deepseek-flash", "sys", {"a": 1}, 2048)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(captured[0][0], "/chat/completions")
        self.assertEqual(captured[0][1]["max_tokens"], 2048)
        self.assertNotIn("max_completion_tokens", captured[0][1])
        self.assertEqual(captured[0][1]["thinking"], {"type": "disabled"})

        ask_json(fake_client, "deepseek-reasoner", "sys", {"a": 1}, 2048)
        self.assertNotIn("thinking", captured[1][1])

    def test_draft_validation_uses_deepseek_key_and_selected_model(self):
        req = {
            "mode": "ark",
            "kind": "draft",
            "draft": {"type": "video", "topic": "退烧药怎么吃"},
            "settings": {
                "ratio": "9:16",
                "videoModel": "doubao-seedance-2-5-flash-261115",
                "textModel": "deepseek-v4-pro",
            },
        }
        with patch.object(server, "current_deepseek_key", return_value=""):
            with self.assertRaisesRegex(ValueError, "DeepSeek"):
                server.setting_valid(req)
        with patch.object(server, "current_deepseek_key", return_value="sk-test"), \
             patch.object(server, "DEEPSEEK_REMOTE_MODELS", ["deepseek-flash", "deepseek-v4-pro"]):
            server.setting_valid(req)
            bad = {**req, "settings": {**req["settings"], "textModel": "not-a-model"}}
            with self.assertRaisesRegex(ValueError, "DeepSeek 文本模型"):
                server.setting_valid(bad)

    def test_write_draft_calls_deepseek_with_chosen_model(self):
        calls = []

        def fake_ds(path, body, **_):
            calls.append((path, body["model"]))
            return {
                "model": body["model"],
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(
                    {"title": "退烧药", "setting": "客厅", "beats": BEATS}, ensure_ascii=False,
                )}}],
                "usage": {"prompt_tokens": 500, "completion_tokens": 100, "prompt_cache_hit_tokens": 100},
            }

        req = {
            "mode": "ark",
            "kind": "draft",
            "draft": {"type": "video", "topic": "退烧药怎么吃"},
            "settings": {
                "ratio": "9:16",
                "videoModel": "doubao-seedance-2-5-flash-261115",
                "textModel": "deepseek-v4-pro",
            },
        }
        job = {"request": req}
        recorded = []
        with patch.object(server, "deepseek", side_effect=fake_ds):
            server.write_draft(req, job, lambda: None, lambda k, row: recorded.append(row))
        self.assertEqual(calls, [("/chat/completions", "deepseek-v4-pro")])
        self.assertEqual(len(recorded), 1)
        self.assertEqual(recorded[0]["model"], "deepseek-v4-pro")
        self.assertIsNotNone(recorded[0]["amount"])


if __name__ == "__main__":
    unittest.main()
