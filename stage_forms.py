"""Shared registry, schema validation, fact grounding, and diversity rules for info forms."""

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re


FORMS_PATH = Path(__file__).resolve().parent / "public" / "assets" / "library" / "forms.json"
VALID_ICONS = frozenset((
    "pill", "capsule", "bottle", "dropper", "syringe", "thermometer", "clock", "calendar",
    "water", "meal", "sun", "moon", "bed", "baby", "elder", "pregnant", "heart", "stomach",
    "eye", "nose", "tooth", "shield", "warning", "ban", "check", "cross", "bulb", "search",
    "scale", "measure", "doctor", "leaflet", "carton", "virus", "arrow", "spark",
))
VALID_LEVELS = frozenset(("high", "mid"))

_CN_DIGIT = {
    "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "俩": 2, "三": 3,
    "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
}
_CN_UNIT = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_CN_NUM_RE = re.compile(r"[零〇一二两俩三四五六七八九十百千万点度半]+")
_ARABIC_RE = re.compile(r"\d+(?:\.\d+)?")
_DRUG_SUFFIX_RE = re.compile(
    r"[\u4e00-\u9fff]{2,8}(?:片|胶囊|滴剂|混悬液|颗粒|口服液|软膏|眼药水|滴眼液|喷雾剂|栓剂|注射液|霉素|洛芬|氨基酚|沙星|洛尔|地平|普利|沙坦|他汀|西林|头孢|拉唑)"
)


@lru_cache(maxsize=1)
def load_registry():
    data = json.loads(FORMS_PATH.read_text(encoding="utf-8"))
    by_id = {form["id"]: form for form in data["forms"]}
    by_relation = {}
    for form in data["forms"]:
        by_relation.setdefault(form["relation"], []).append(form)
    return {**data, "byId": by_id, "byRelation": by_relation}


def form_catalog_for(spec=None):
    """Return a compact, layout-filtered form list suitable for DeepSeek prompts."""
    reg = load_registry()
    out = []
    for form in reg["forms"]:
        if spec and not form_fits(form, spec):
            continue
        out.append({
            "id": form["id"],
            "relation": form["relation"],
            "label": form["label"],
            "preferredKind": form["preferredKind"],
            "when": form["when"],
            "schema": _compact_schema(form["schema"]),
        })
    return out


def _compact_schema(schema):
    compact = {}
    for key, rule in schema.items():
        t = rule["type"]
        if t == "string":
            compact[key] = f"≤{rule['maxLen']}字" + ("(必填)" if rule.get("required") else "")
        elif t in ("int", "number"):
            compact[key] = f"数字({rule['min']}-{rule['max']})"
        elif t == "enum":
            compact[key] = "/".join(rule["values"])
        elif t == "icon":
            compact[key] = "图标名"
        elif t == "stringList":
            compact[key] = [f"{rule['min']}-{rule['max']}条,每条≤{rule['maxLen']}字"]
        elif t == "array":
            item_desc = {}
            for ik, iv in rule["item"].items():
                if isinstance(iv, int):
                    item_desc[ik] = f"≤{iv}字"
                elif iv == "bool":
                    item_desc[ik] = "bool"
                elif iv == "hour":
                    item_desc[ik] = "0-23整数"
                elif iv == "level":
                    item_desc[ik] = "high/mid"
                else:
                    item_desc[ik] = str(iv)
            compact[key] = {"count": f"{rule['min']}-{rule['max']}", "item": item_desc}
    return compact


def form_fits(form_or_id, spec, data=None):
    reg = load_registry()
    form = reg["byId"].get(form_or_id) if isinstance(form_or_id, str) else form_or_id
    if not form:
        return False
    if not spec:
        return True
    shape = spec.get("shape", "standard")
    if shape not in form.get("shapes", ()):
        return False
    for flag in form.get("avoidOuter", ()):
        if spec.get(flag):
            return False
    if isinstance(data, dict):
        count = _primary_count(data)
        if shape == "narrow" and form.get("maxItemsNarrow") and count > form["maxItemsNarrow"]:
            return False
        if shape in ("shallow", "shallow-wide") and form.get("maxItemsShallow") and count > form["maxItemsShallow"]:
            return False
    return True


def _primary_count(data):
    for key in ("items", "steps", "nodes", "rows", "groups", "callouts", "times"):
        val = data.get(key)
        if isinstance(val, list):
            return len(val)
    return 0


def _parse_cn_int(token):
    if not token:
        return None
    if token == "半":
        return 0.5
    if all(ch in _CN_DIGIT for ch in token):
        # e.g., 二四 or 三八
        if len(token) == 1:
            return float(_CN_DIGIT[token])
        return None
    total = 0
    current = 0
    seen_unit = False
    for ch in token:
        if ch in _CN_DIGIT:
            current = _CN_DIGIT[ch]
        elif ch in _CN_UNIT:
            unit = _CN_UNIT[ch]
            seen_unit = True
            if current == 0:
                current = 1
            if unit == 10000:
                total = (total + current) * unit
            else:
                total += current * unit
            current = 0
        else:
            return None
    val = total + current
    if not seen_unit and len(token) > 1:
        return None
    return float(val)


def extract_numbers(text):
    """Extract normalized numeric values from Arabic and spoken Chinese numerals."""
    if not isinstance(text, str) or not text:
        return set()
    nums = set()
    # Handle clock forms like 8:00 or 08:30
    for match in re.finditer(r"\b(\d{1,2}):(\d{2})\b", text):
        nums.add(round(float(int(match.group(1))), 4))
        minute = int(match.group(2))
        if minute:
            nums.add(round(float(minute), 4))
    for match in _ARABIC_RE.finditer(text):
        try:
            nums.add(round(float(match.group(0)), 4))
        except ValueError:
            pass
    # Handle spoken Chinese decimals like 三十八度五, 三点五, 半小时
    for match in re.finditer(r"([零〇一二两三四五六七八九十百]+)[点度]([零〇一二三四五六七八九])", text):
        whole = _parse_cn_int(match.group(1))
        frac = _CN_DIGIT.get(match.group(2))
        if whole is not None and frac is not None:
            nums.add(round(whole + frac / 10.0, 4))
    if "半" in text:
        nums.add(0.5)
        if "半小时" in text or "半个钟" in text or "半个小时" in text:
            nums.add(30.0)
    # Spoken ranges like 四到六, 三至五
    for match in re.finditer(r"([一二两三四五六七八九十]+)[到至\-~]([一二两三四五六七八九十]+)", text):
        a = _parse_cn_int(match.group(1))
        b = _parse_cn_int(match.group(2))
        if a is not None:
            nums.add(round(a, 4))
        if b is not None:
            nums.add(round(b, 4))
    for match in _CN_NUM_RE.finditer(text):
        tok = match.group(0)
        if "点" in tok or "度" in tok or tok == "半":
            continue
        # Ignore standalone idiom tokens like 一下/一定/一般/一起/一点/一次 -> wait 一次 IS 1!
        val = _parse_cn_int(tok)
        if val is not None:
            nums.add(round(val, 4))
    return nums


def _source_text_for(shot, drug=""):
    parts = [shot.get("name", ""), shot.get("line", ""), drug or ""]
    points = shot.get("points") or {}
    for key in ("headline", "lead", "question", "answer", "takeaway", "listTitle", "footerNote", "outroNote"):
        if isinstance(points.get(key), str):
            parts.append(points[key])
    for item in points.get("items") or []:
        if isinstance(item, dict):
            parts.extend(str(item.get(k, "")) for k in ("title", "detail", "tag"))
        elif isinstance(item, str):
            parts.append(item)
    return "\n".join(parts)


def _collect_fact_strings(form, data):
    strings = []
    schema = form["schema"]
    for key, rule in schema.items():
        if key not in data or data[key] is None:
            continue
        val = data[key]
        t = rule["type"]
        if t == "string":
            if rule.get("fact", True):
                strings.append(str(val))
        elif t in ("int", "number"):
            if rule.get("fact", True):
                strings.append(str(val))
        elif t == "stringList":
            strings.extend(str(x) for x in val)
        elif t == "array":
            for row in val:
                if not isinstance(row, dict):
                    continue
                for ik, iv in rule["item"].items():
                    if ik in row and row[ik] is not None and iv not in ("bool", "icon", "level"):
                        strings.append(str(row[ik]))
    return strings


def check_fact_grounding(form_or_id, data, shot, drug=""):
    """Verify every number and drug name in formData appears in the shot's line/points."""
    reg = load_registry()
    form = reg["byId"].get(form_or_id) if isinstance(form_or_id, str) else form_or_id
    if not form:
        raise ValueError("未知版式")
    source = _source_text_for(shot, drug)
    source_nums = extract_numbers(source)
    # Also allow step indices 1..len(items) when referring to ordered steps/points
    fact_strings = _collect_fact_strings(form, data)
    for text in fact_strings:
        nums = extract_numbers(text)
        for num in nums:
            if num not in source_nums:
                # Special allowance: 24h clock hours when narration says 早上/中午/晚上/睡前?
                # No — keep strict fact grounding per spec: numeric values must be grounded in line/points!
                raise ValueError(f"版式数据中的数字 {num:g} 未出现在本幕口播或要点中")
        for drug_match in _DRUG_SUFFIX_RE.finditer(text):
            token = drug_match.group(0)
            if token not in source:
                raise ValueError(f"版式数据中的药品/剂型「{token}」未出现在本幕口播或要点中")


def validate_form_data(form_id, data, shot, *, drug="", spec=None, check_facts=True):
    """Validate and normalize formData against the form schema and fact-grounding rules."""
    reg = load_registry()
    form = reg["byId"].get(form_id)
    if not form:
        raise ValueError(f"版式无效：{form_id}")
    if not isinstance(data, dict):
        raise ValueError("版式数据必须为对象")
    schema = form["schema"]
    if data.keys() - schema.keys():
        raise ValueError("版式数据包含未知字段")
    clean = {}
    for key, rule in schema.items():
        val = data.get(key)
        t = rule["type"]
        if val is None or val == "":
            if rule.get("required"):
                raise ValueError(f"版式缺少必填字段：{key}")
            continue
        if t == "string":
            if not isinstance(val, str):
                raise ValueError(f"字段 {key} 必须为文字")
            text = val.strip()
            if not text:
                if rule.get("required"):
                    raise ValueError(f"字段 {key} 不能为空")
                continue
            if len(text) > rule["maxLen"]:
                raise ValueError(f"字段 {key} 超过长度上限 {rule['maxLen']}")
            if rule.get("numeric") and not extract_numbers(text):
                raise ValueError(f"字段 {key} 需要包含数字")
            clean[key] = text
        elif t == "int":
            if type(val) is not int or not rule["min"] <= val <= rule["max"]:
                raise ValueError(f"字段 {key} 必须为 {rule['min']}–{rule['max']} 整数")
            clean[key] = val
        elif t == "number":
            if type(val) not in (int, float) or not rule["min"] <= float(val) <= rule["max"]:
                raise ValueError(f"字段 {key} 数值超出范围")
            clean[key] = round(float(val), 2)
        elif t == "enum":
            if not isinstance(val, str) or val not in rule["values"]:
                raise ValueError(f"字段 {key} 取值无效")
            clean[key] = val
        elif t == "icon":
            if not isinstance(val, str) or val not in VALID_ICONS:
                clean[key] = "pill"
            else:
                clean[key] = val
        elif t == "stringList":
            if not isinstance(val, list) or not rule["min"] <= len(val) <= rule["max"]:
                raise ValueError(f"字段 {key} 条目数不在 {rule['min']}–{rule['max']} 之间")
            items = []
            for entry in val:
                if not isinstance(entry, str) or not entry.strip() or len(entry.strip()) > rule["maxLen"]:
                    raise ValueError(f"字段 {key} 包含无效或超长条目")
                items.append(entry.strip())
            clean[key] = items
        elif t == "array":
            if not isinstance(val, list) or not rule["min"] <= len(val) <= rule["max"]:
                raise ValueError(f"字段 {key} 条目数不在 {rule['min']}–{rule['max']} 之间")
            rows = []
            item_spec = rule["item"]
            for entry in val:
                if not isinstance(entry, dict) or entry.keys() - item_spec.keys():
                    raise ValueError(f"字段 {key} 条目结构无效")
                row = {}
                for ik, iv in item_spec.items():
                    ev = entry.get(ik)
                    if ev is None or ev == "":
                        continue
                    if isinstance(iv, int):
                        if not isinstance(ev, str) or len(ev.strip()) > iv:
                            raise ValueError(f"字段 {key}.{ik} 无效或超长")
                        if ev.strip():
                            row[ik] = ev.strip()
                    elif iv == "bool":
                        if type(ev) is not bool:
                            raise ValueError(f"字段 {key}.{ik} 必须为布尔值")
                        row[ik] = ev
                    elif iv == "hour":
                        if type(ev) is not int or not 0 <= ev <= 23:
                            raise ValueError(f"字段 {key}.{ik} 必须为 0–23 小时整数")
                        row[ik] = ev
                    elif iv == "icon":
                        row[ik] = ev if isinstance(ev, str) and ev in VALID_ICONS else "pill"
                    elif iv == "level":
                        row[ik] = ev if ev in VALID_LEVELS else "mid"
                # Require at least primary text/hour key in row
                primary_key = next(iter(item_spec))
                if primary_key not in row:
                    raise ValueError(f"字段 {key} 缺少主字段 {primary_key}")
                rows.append(row)
            clean[key] = rows
    if form_id == "measure-scale" and clean["value"] > clean["max"]:
        clean["max"] = max(clean["max"], round(clean["value"] * 1.5, 2))
    if spec and not form_fits(form, spec, clean):
        raise ValueError(f"版式 {form_id} 不适合当前布局尺寸")
    if check_facts:
        check_fact_grounding(form, clean, shot, drug=drug)
    return clean


def pick_variant(form_id, work_id="", shot_index=0, revision_count=0):
    reg = load_registry()
    form = reg["byId"].get(form_id)
    variants = form["variants"] if form else ["solid", "outline", "split"]
    digest = hashlib.sha256(f"{work_id}:{shot_index}:{revision_count}:{form_id}".encode("utf-8")).digest()
    return variants[digest[0] % len(variants)]


def _clip(text, limit):
    text = str(text or "").strip()
    return text[:limit]


def _shot_items(shot):
    points = shot.get("points") or {}
    raw = points.get("items") or []
    out = []
    for entry in raw:
        if isinstance(entry, str) and entry.strip():
            out.append({"title": entry.strip(), "detail": "", "tag": ""})
        elif isinstance(entry, dict) and str(entry.get("title") or "").strip():
            out.append({
                "title": str(entry.get("title") or "").strip(),
                "detail": str(entry.get("detail") or entry.get("desc") or "").strip(),
                "tag": str(entry.get("tag") or "").strip(),
            })
    return out


def _first_number_token(shot):
    source = _source_text_for(shot)
    m = re.search(r"(\d+(?:\.\d+)?)\s*([a-zA-Z%℃度毫克升次天小时分钟周月岁公斤kgml]+)?", source)
    if m:
        return m.group(1), (m.group(2) or "")[:8]
    nums = sorted(extract_numbers(source))
    if nums:
        val = nums[0]
        return (str(int(val)) if val == int(val) else f"{val:g}"), ""
    return "", ""


def derive_form_data(form_id, shot):
    """Deterministically build guaranteed-valid formData from a shot's script & points."""
    points = shot.get("points") or {}
    headline = _clip(points.get("headline") or shot.get("name") or "用药要点", 14)
    takeaway = _clip(points.get("takeaway") or points.get("answer") or points.get("lead") or shot.get("name") or "", 22)
    items = _shot_items(shot)
    if not items:
        items = [{"title": _clip(shot.get("name") or "核心要点", 12), "detail": _clip(takeaway, 16), "tag": ""}]

    if form_id == "big-answer":
        return {
            "headline": _clip(points.get("headline") or shot.get("name"), 18),
            "answer": _clip(points.get("answer") or takeaway or items[0]["title"], 20),
            **({"note": _clip(points.get("lead") or items[0]["detail"] or items[0]["title"], 28)} if (points.get("lead") or items[0]["detail"]) else {}),
            **({"tag": _clip(items[0]["tag"], 8)} if items[0]["tag"] else {}),
        }
    if form_id == "qa-flip":
        return {
            "question": _clip(points.get("question") or points.get("headline") or shot.get("name"), 24),
            "answer": _clip(points.get("answer") or takeaway or items[0]["title"], 20),
            **({"note": _clip(points.get("lead") or items[0]["detail"], 26)} if (points.get("lead") or items[0]["detail"]) else {}),
        }
    if form_id == "stat-hero":
        val, unit = _first_number_token(shot)
        return {
            "headline": headline,
            "value": _clip(val or "1", 10),
            "unit": _clip(unit or "项", 8),
            "label": _clip(items[0]["title"] or headline, 16),
            **({"note": _clip(takeaway, 24)} if takeaway else {}),
        }
    if form_id == "art-answer":
        return {
            "headline": _clip(points.get("headline") or shot.get("name"), 16),
            "answer": _clip(points.get("answer") or takeaway or items[0]["title"], 24),
            "items": [{"title": _clip(it["title"], 12), **({"detail": _clip(it["detail"], 18)} if it["detail"] else {})} for it in items[:3]],
        }
    if form_id == "dose-card":
        val, unit = _first_number_token(shot)
        return {
            "headline": headline,
            "value": _clip(val or "1", 10),
            "unit": _clip(unit or "次", 8),
            "condition": _clip(items[0]["title"] or headline, 18),
            **({"note": _clip(takeaway or items[0]["detail"], 24)} if (takeaway or items[0]["detail"]) else {}),
        }
    if form_id == "weight-table":
        rows = [{"a": _clip(it["title"], 12), "b": _clip(it["detail"] or it["tag"] or "按说明书", 14), "highlight": i == 0} for i, it in enumerate(items[:4])]
        while len(rows) < 2:
            rows.append({"a": "常规档", "b": _clip(takeaway or "按说明书", 14), "highlight": False})
        return {"headline": headline, "colA": "情形", "colB": "对应建议", "rows": rows}
    if form_id == "measure-scale":
        val_s, unit = _first_number_token(shot)
        try:
            val_f = max(0.1, min(1000.0, float(val_s))) if val_s else 1.0
        except ValueError:
            val_f = 1.0
        return {
            "headline": headline,
            "value": val_f,
            "max": round(max(val_f * 1.5, 10.0 if val_f <= 10 else val_f * 1.25), 2),
            "unit": _clip(unit or "ml", 8),
            "label": _clip(items[0]["title"] or headline, 16),
            **({"note": _clip(takeaway, 22)} if takeaway else {}),
        }
    if form_id == "count-icons":
        val_s, unit = _first_number_token(shot)
        try:
            cnt = int(round(float(val_s))) if val_s else min(4, max(1, len(items)))
        except ValueError:
            cnt = 1
        cnt = max(1, min(6, cnt))
        return {
            "headline": headline,
            "count": cnt,
            "max": max(cnt, min(6, cnt + 1)),
            "icon": "pill",
            "unit": _clip(f"{unit or '次'}", 12),
            **({"note": _clip(takeaway or items[0]["title"], 22)} if (takeaway or items[0]["title"]) else {}),
        }
    if form_id == "timeline-h":
        nodes = [{"time": _clip(it["tag"] or f"阶段{i+1}", 10), "title": _clip(it["title"], 12), **({"detail": _clip(it["detail"], 16)} if it["detail"] else {})} for i, it in enumerate(items[:4])]
        while len(nodes) < 2:
            nodes.append({"time": "下一步", "title": _clip(takeaway or "按医嘱核对", 12)})
        return {"headline": headline, "nodes": nodes}
    if form_id == "clock-24":
        times = [{"hour": h, "label": _clip(it["title"], 10)} for h, it in zip((8, 14, 20, 22), items[:4])]
        return {"headline": headline, "times": times or [{"hour": 8, "label": "按时服药"}], **({"note": _clip(takeaway, 22)} if takeaway else {})}
    if form_id == "interval-bar":
        val_s, unit = _first_number_token(shot)
        interval = _clip(f"{val_s}{unit}" if val_s else (items[0]["tag"] or items[0]["title"]), 12)
        return {
            "headline": headline,
            "interval": interval or "按间隔",
            "startLabel": _clip(items[0]["title"] if len(items) >= 2 else "前一次", 10),
            "endLabel": _clip(items[1]["title"] if len(items) >= 2 else "下一次", 10),
            **({"note": _clip(takeaway, 24)} if takeaway else {}),
        }
    if form_id == "meal-band":
        src = _source_text_for(shot)
        active = "before" if "饭前" in src or "空腹" in src else "during" if "饭中" in src or "随餐" in src else "bedtime" if "睡前" in src else "after"
        return {
            "headline": headline,
            "active": active,
            "label": _clip(items[0]["title"] or headline, 16),
            **({"note": _clip(takeaway or items[0]["detail"], 24)} if (takeaway or items[0]["detail"]) else {}),
        }
    if form_id in ("flow-h", "steps-v", "art-steps", "cycle"):
        min_n = 3 if form_id == "cycle" else (1 if form_id == "art-steps" else 2)
        t_len = 8 if form_id == "cycle" else (10 if form_id == "flow-h" else 12)
        d_len = 14 if form_id == "cycle" else (18 if form_id == "steps-v" else 16)
        steps = []
        for it in items[:4]:
            row = {"title": _clip(it["title"], t_len)}
            if it["detail"]:
                row["detail"] = _clip(it["detail"], d_len)
            if form_id == "steps-v" and it["tag"]:
                row["tag"] = _clip(it["tag"], 8)
            if form_id == "flow-h":
                row["icon"] = "check"
            steps.append(row)
        while len(steps) < min_n:
            steps.append({"title": _clip(takeaway or f"核对要点{len(steps)+1}", t_len)})
        res = {"headline": headline, "steps": steps}
        if form_id == "cycle":
            res["center"] = _clip(headline, 8)
        elif form_id == "art-steps" and takeaway:
            res["note"] = _clip(takeaway, 22)
        return res
    if form_id == "do-dont":
        do_list, dont_list = [], []
        for it in items:
            txt = _clip(it["title"], 16)
            if any(k in txt for k in ("别", "不要", "勿", "禁止", "不能", "误", "错", "忌")):
                dont_list.append(txt)
            else:
                do_list.append(txt)
        if not do_list:
            do_list = [_clip(takeaway or items[0]["title"], 16)]
        if not dont_list:
            dont_list = [_clip(items[-1]["title"] if len(items) > 1 else "避免自行加减量", 16)]
        return {"headline": headline, "do": do_list[:3], "dont": dont_list[:3]}
    if form_id == "table-compare":
        left_title = _clip(items[0]["title"], 10)
        right_title = _clip(items[1]["title"] if len(items) > 1 else "注意事项", 10)
        rows = []
        for i, it in enumerate(items[:4]):
            rows.append({
                "attr": _clip(it["tag"] or f"要点{i+1}", 6),
                "left": _clip(it["title"], 14),
                "right": _clip(it["detail"] or takeaway or "按医嘱", 14),
            })
        while len(rows) < 2:
            rows.append({"attr": "提醒", "left": _clip(takeaway or "按说明书", 14), "right": "拿不准问药师"})
        return {"headline": headline, "leftTitle": left_title, "rightTitle": right_title, "rows": rows[:4]}
    if form_id == "before-after":
        half = max(1, len(items) // 2)
        return {
            "headline": headline,
            "beforeTitle": "常见误区/之前",
            "beforeItems": [_clip(it["title"], 16) for it in items[:half]][:3],
            "afterTitle": "规范做法/之后",
            "afterItems": [_clip(it["title"], 16) for it in (items[half:] or items)][:3],
        }
    if form_id == "balance":
        left = items[0]
        right = items[1] if len(items) > 1 else {"title": "注意边界", "detail": takeaway or "遵循医嘱"}
        return {
            "headline": headline,
            "leftTitle": _clip(left["title"], 10),
            "leftDesc": _clip(left["detail"] or left["title"], 18),
            "rightTitle": _clip(right["title"], 10),
            "rightDesc": _clip(right["detail"] or right["title"], 18),
            "tilt": "even",
        }
    if form_id == "myth-fact":
        return {
            "headline": headline,
            "myth": _clip(items[0]["title"], 22),
            "fact": _clip(takeaway or (items[1]["title"] if len(items) > 1 else items[0]["detail"] or headline), 22),
            **({"note": _clip(items[0]["detail"], 24)} if items[0]["detail"] else {}),
        }
    if form_id == "alert-list":
        rows = [{"title": _clip(it["title"], 12), **({"detail": _clip(it["detail"], 18)} if it["detail"] else {}), "level": "high" if i == 0 else "mid"} for i, it in enumerate(items[:4])]
        return {"headline": headline, "items": rows}
    if form_id == "who-not":
        icon_cycle = ("baby", "pregnant", "elder", "heart")
        groups = [{"label": _clip(it["title"], 10), "icon": icon_cycle[i % len(icon_cycle)], **({"reason": _clip(it["detail"], 14)} if it["detail"] else {})} for i, it in enumerate(items[:4])]
        while len(groups) < 2:
            groups.append({"label": "特殊人群", "icon": "warning", "reason": "用药前咨询药师"})
        return {"headline": headline, "groups": groups}
    if form_id == "check-list":
        rows = [{"title": _clip(it["title"], 12), **({"detail": _clip(it["detail"], 16)} if it["detail"] else {}), **({"tag": _clip(it["tag"], 8)} if it["tag"] else {})} for it in items[:4]]
        while len(rows) < 2:
            rows.append({"title": _clip(takeaway or "核对说明书", 12)})
        return {"headline": headline, "items": rows}
    if form_id == "icon-grid":
        icon_cycle = ("pill", "clock", "shield", "check", "water", "bulb")
        rows = [{"title": _clip(it["title"], 10), **({"detail": _clip(it["detail"], 14)} if it["detail"] else {}), "icon": icon_cycle[i % len(icon_cycle)]} for i, it in enumerate(items[:6])]
        while len(rows) < 2:
            rows.append({"title": _clip(takeaway or "核心要点", 10), "icon": "check"})
        return {"headline": headline, "items": rows}
    if form_id == "label-locate":
        src = _source_text_for(shot)
        prop = "carton" if "药盒" in src or "包装" in src else "leaflet"
        return {
            "headline": headline,
            "prop": prop,
            "section": _clip(items[0]["tag"] or "用法用量", 10),
            "highlight": _clip(items[0]["title"] or takeaway or headline, 20),
            "items": [_clip(it["title"], 14) for it in items[1:4]],
        }
    if form_id == "cause-chain":
        icon_cycle = ("pill", "arrow", "shield", "check")
        nodes = [{"title": _clip(it["title"], 10), **({"detail": _clip(it["detail"], 16)} if it["detail"] else {}), "icon": icon_cycle[i % len(icon_cycle)]} for i, it in enumerate(items[:4])]
        while len(nodes) < 2:
            nodes.append({"title": _clip(takeaway or "产生效果", 10), "icon": "shield"})
        return {"headline": headline, "nodes": nodes}
    if form_id == "body-callout":
        src = _source_text_for(shot)
        organ = "stomach" if "胃" in src else "heart" if "心" in src or "血压" in src else "eye" if "眼" in src else "body" if "体" in src or "身" in src else "pill"
        callouts = [{"title": _clip(it["title"], 10), **({"detail": _clip(it["detail"], 16)} if it["detail"] else {})} for it in items[:3]]
        while len(callouts) < 2:
            callouts.append({"title": _clip(takeaway or "重点关注", 10)})
        return {"headline": headline, "organ": organ, "callouts": callouts}
    if form_id == "three-points":
        rows = [{"title": _clip(it["title"], 12), **({"detail": _clip(it["detail"], 16)} if it["detail"] else {})} for it in items[:3]]
        while len(rows) < 2:
            rows.append({"title": _clip(takeaway or "拿不准问药师", 12)})
        return {"headline": headline, "items": rows, **({"takeaway": _clip(takeaway, 22)} if takeaway else {})}
    # motto
    return {
        "headline": headline,
        "motto": _clip(takeaway or items[0]["title"] or headline, 22),
        **({"sub": _clip(points.get("lead") or items[0]["detail"], 24)} if (points.get("lead") or items[0]["detail"]) else {}),
    }


def default_form_for(shot, kind=None, spec=None, *, exclude=()):
    reg = load_registry()
    point_type = (shot.get("points") or {}).get("type", "explain")
    relation = reg["pointTypeRelations"].get(point_type, "mechanism")
    candidates = list(reg["byRelation"].get(relation, ()))
    # Prefer forms matching kind when specified, and avoid number/clock forms that require grounded numbers during fallback
    safe_order = sorted(
        candidates,
        key=lambda f: (
            f["id"] in exclude,
            bool(kind and f["preferredKind"] != kind),
            f["id"] in ("stat-hero", "dose-card", "measure-scale", "count-icons", "clock-24", "weight-table"),
        ),
    )
    for form in safe_order:
        if form_fits(form, spec):
            return form["id"]
    for form in reg["forms"]:
        if form["id"] not in exclude and form_fits(form, spec):
            return form["id"]
    return "big-answer"


def map_legacy_content(content, shot, spec=None):
    """Map legacy visual/motionStyle content to an equivalent info form."""
    reg = load_registry()
    if content.get("form") and content["form"] in reg["byId"]:
        return content["form"], content.get("variant") or pick_variant(content["form"]), content.get("formData") or derive_form_data(content["form"], shot)
    visual = content.get("visual")
    if visual and visual in reg["legacyVisualMap"]:
        form_id = reg["legacyVisualMap"][visual]
    else:
        form_id = default_form_for(shot, content.get("kind"), spec)
    if spec and not form_fits(form_id, spec):
        form_id = default_form_for(shot, content.get("kind"), spec)
    return form_id, pick_variant(form_id), derive_form_data(form_id, shot)


def _alternative_form(relation, current_form, used_forms, spec, kind=None, shot=None):
    reg = load_registry()
    same_rel = [f for f in reg["byRelation"].get(relation, ()) if f["id"] != current_form and form_fits(f, spec)]
    # Prefer forms not requiring strict numeric grounding when swapping automatically
    def score(f):
        needs_num = f["id"] in ("stat-hero", "dose-card", "measure-scale", "count-icons", "clock-24")
        return (
            f["id"] in used_forms,
            needs_num and not (shot and extract_numbers(_source_text_for(shot))),
            bool(kind and f["preferredKind"] != kind),
        )
    same_rel.sort(key=score)
    if same_rel:
        return same_rel[0]["id"]
    others = [f for f in reg["forms"] if f["id"] != current_form and form_fits(f, spec)]
    others.sort(key=score)
    return others[0]["id"] if others else current_form


def enforce_form_diversity(shots, spec=None, work_id=""):
    """Ensure adjacent card/scene shots do not share the same form, and >=5 shots use >=4 distinct forms."""
    reg = load_registry()
    form_indices = [i for i, s in enumerate(shots) if s.get("content", {}).get("kind") in ("card", "scene") and s["content"].get("form")]
    if len(form_indices) < 2:
        return shots
    used = set()
    prev_form = None
    for idx in form_indices:
        c = shots[idx]["content"]
        fid = c["form"]
        rel = reg["byId"].get(fid, {}).get("relation", "mechanism")
        if fid == prev_form:
            alt = _alternative_form(rel, fid, used | {fid}, spec, kind=c["kind"], shot=shots[idx])
            if alt != fid:
                c["form"] = alt
                c["formData"] = derive_form_data(alt, shots[idx])
                c["variant"] = pick_variant(alt, work_id, idx)
                fid = alt
        used.add(fid)
        prev_form = fid

    if len(form_indices) >= 5 and len(used) < 4:
        counts = {}
        for idx in form_indices:
            fid = shots[idx]["content"]["form"]
            counts[fid] = counts.get(fid, 0) + 1
        for idx in form_indices:
            if len(used) >= 4:
                break
            c = shots[idx]["content"]
            fid = c["form"]
            if counts.get(fid, 0) <= 1:
                continue
            rel = reg["byId"].get(fid, {}).get("relation", "mechanism")
            neighbors = set()
            if idx > 0:
                neighbors.add(shots[idx - 1].get("content", {}).get("form"))
            if idx + 1 < len(shots):
                neighbors.add(shots[idx + 1].get("content", {}).get("form"))
            alt = _alternative_form(rel, fid, used | neighbors, spec, kind=c["kind"], shot=shots[idx])
            if alt not in used and alt not in neighbors:
                counts[fid] -= 1
                c["form"] = alt
                c["formData"] = derive_form_data(alt, shots[idx])
                c["variant"] = pick_variant(alt, work_id, idx)
                used.add(alt)
                counts[alt] = counts.get(alt, 0) + 1
    return shots
