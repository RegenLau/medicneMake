"""Load this fixture in an isolated copy of server.py for the phase D UI check."""

import json

from test_mix_plan import model_response, script_fixture


def fixture_deepseek(path, body=None, **kwargs):
    if path == "/models":
        return {"data": [{"id": "deepseek-flash"}]}
    assert path == "/chat/completions"
    payload = json.loads(body["messages"][1]["content"])
    if "targetIndices" not in payload:
        return model_response(script_fixture())
    choices = []
    for index in payload["targetIndices"]:
        shot = payload["shots"][index]
        kind, params = [
            ("image", {"imagePrompt": "药盒封面"}),
            ("svg", {"beats": [{"action": "travel", "line": shot["line"], "label": "药盒放进包"}]}),
            ("card", {"motionStyle": "reveal"}),
        ][index]
        if len(payload["targetIndices"]) == 1:
            kind, params = "scene", {"visual": "steps", "motion": "flow"}
        choices.append({"index": index, "kind": kind, "reason": f'「{shot["name"]}」直接展示{shot["line"]}',
                        "fallback": "scene", "params": params, "priority": 80})
    return model_response({"shots": choices})
