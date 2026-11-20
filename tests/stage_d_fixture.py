"""Load this fixture in an isolated copy of server.py for the phase D UI check."""

import json

from test_mix_plan import model_response, script_fixture


def fixture_deepseek(path, body=None, **kwargs):
    if path == "/models":
        return {"data": [{"id": "deepseek-flash"}]}
    assert path == "/chat/completions"
    payload = json.loads(body["messages"][1]["content"])
    if "candidateStickers" in payload:
        return model_response({"shots": [
            {"index": i, "stickers": (
                [{"assetId": "builtin:image/fluent-warning", "cue": 0, "keyword": "", "anchor": "media-tr", "size": "m", "enter": "pop", "hold": "stay", "sfx": "auto", "reason": "关键提醒"}]
                if i == 0 else []
            )}
            for i in payload.get("targetIndices", [])
        ]})
    if "clipStyle" in payload and "shot" in payload:
        return model_response({"clipPrompt": "柔和自然光线，近景展示双手核对药盒外包装并放入随身收纳包，画面干净无文字。"})
    if "previousParams" in payload:
        kind = payload["kind"]
        previous = payload["previousParams"]
        revision = payload["revision"]
        if revision == "测试重复画面":
            params = previous
        elif kind == "svg":
            params = {"beats": [{"action": "carton" if revision else "travel",
                                 "line": payload["shot"]["line"][:55], "label": "核对药盒"}]}
        elif kind == "scene":
            return model_response({"plans": [
                {"params": {**previous, "tone": "warm"}, "reason": "用暖色标记药盒。"},
                {"params": {"visual": "mechanism", "motion": "reveal", "motif": "bottle"},
                 "reason": "用药盒图配合文字展示收纳要点。"},
            ]})
        else:
            params = {"motionStyle": "flow"}
        return model_response({"plans": [{"params": params, "reason": "把本幕要点集中在画面中。"}]})
    if "targetIndices" not in payload:
        return model_response(script_fixture())
    choices = []
    for index in payload["targetIndices"]:
        shot = payload["shots"][index]
        kind, params = [
            ("scene", {"visual": "hook", "motion": "focus-zoom"}),
            ("scene", {"visual": "steps", "motion": "flow"}),
            ("card", {"motionStyle": "reveal"}),
        ][index]
        if len(payload["targetIndices"]) == 1:
            kind, params = "scene", {"visual": "steps", "motion": "flow"}
        choices.append({"index": index, "kind": kind, "reason": f'「{shot["name"]}」直接展示{shot["line"]}',
                        "fallback": "scene", "params": params})
    return model_response({"shots": choices})
