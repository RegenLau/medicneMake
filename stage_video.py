"""Validated workbench input for the shared video stage."""

import math
import re
import shutil
import subprocess
from urllib.parse import unquote

import asset_library
import draft_content
import motion_asset
import stage_forms
import svg_motion


CLASSIC_LAYOUT = "builtin:layout/info-classic"
CONTENT_KINDS = asset_library.LAYOUT_CONTENTS
LEGACY_KINDS = frozenset(("image", "card", "scene", "svg"))
FOCUSES = frozenset(("all", "0", "1", "2", "3", "top", "bottom", "question", "answer", "action", "outro"))
TRANSITIONS = ("fade", "wipe", "iris", "slide")
POINT_TYPES = frozenset(("cover", "explain", "compare", "steps", "warning", "summary", "timeline", "checklist"))
VERDICT_TONES = frozenset(("ok", "no", "warn"))
STICKER_ANCHORS = frozenset(("media-tl", "media-tr", "media-bl", "media-br", "headline-end", "item-0", "item-1", "item-2", "item-3"))
STICKER_SIZES = frozenset(("s", "m", "l"))
STICKER_ENTERS = frozenset(("pop", "bounce", "slide", "stamp", "float"))
STICKER_HOLDS = frozenset(("stay", "cue"))
CLIP_STYLES = frozenset(("demo", "mg"))
CLIP_SPEEDS = frozenset(("normal", "slow"))
SLIDE_FIELDS = frozenset(("type", "layoutMode", "headline", "lead", "accentPhrase", "question", "answer",
                          "verdictTone", "items", "points", "pills", "steps", "warnings", "columns", "checks",
                          "takeaway", "listTitle", "footerNote", "outroNote", "highlightWords", "leftTop"))
_NAMED_RATIOS = (
    ("16:9", 16 / 9),
    ("4:3", 4 / 3),
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("9:16", 9 / 16),
)
_ARK_RATIOS = (
    ("16:9", 16 / 9),
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("9:16", 9 / 16),
)


def format_ratio_label(w, h):
    ar = w / h if h else 16 / 9
    for label, target in _NAMED_RATIOS:
        if abs(ar - target) / target <= 0.025:
            return label
    return f"{ar:.2f}:1" if ar >= 1 else f"1:{(1 / ar):.2f}"


def nearest_ark_ratio(w, h):
    ar = w / h if h else 16 / 9
    return min(_ARK_RATIOS, key=lambda pair: abs(math.log(ar / pair[1])))[0]


def layout_media_spec(layout, layout_item=None, stage="explain"):
    """Describe the active layout's media region, art slot, and outer-frame regions."""
    layout = layout if isinstance(layout, dict) else {}
    canvas = layout.get("canvas") if isinstance(layout.get("canvas"), dict) else {}
    cw = float(canvas.get("w") or 1280)
    ch = float(canvas.get("h") or 720)
    stages = layout.get("stages") if isinstance(layout.get("stages"), dict) else {}
    stage_regions = stages.get(stage, {}).get("regions") if isinstance(stages.get(stage), dict) else None
    regions = stage_regions if isinstance(stage_regions, dict) else (layout.get("regions") if isinstance(layout.get("regions"), dict) else {})
    media = regions.get("media") if isinstance(regions.get("media"), dict) else None
    w = max(64, round(float(media["w"]) * cw / 100)) if media and "w" in media else 960
    h = max(64, round(float(media["h"]) * ch / 100)) if media and "h" in media else 540
    aspect = round(w / h, 4)

    if aspect < 0.85:
        shape = "portrait"
    elif aspect >= 2.2 and h <= 420:
        shape = "shallow-wide"
    elif aspect >= 2.2:
        shape = "ultrawide"
    elif w <= 720:
        shape = "narrow"
    elif h <= 420:
        shape = "shallow"
    elif w <= 860 or h <= 480:
        shape = "compact"
    else:
        shape = "standard"

    if w <= 720:
        art_placement = "top"
        art_w = max(120, w - 36)
        art_h = max(120, min(200, round(h * 0.39)))
    elif h <= 420:
        art_placement = "left"
        art_w = max(120, round((w - 40) * 0.36))
        art_h = max(120, h - 28)
    elif aspect >= 2.2:
        art_placement = "left"
        art_w = max(120, round((w - 56) * 0.38))
        art_h = max(120, h - 40)
    elif w <= 860 or h <= 480:
        art_placement = "left"
        art_w = max(120, round((w - 40) * 0.40))
        art_h = max(120, h - 32)
    else:
        art_placement = "left"
        art_w = max(120, round((w - 54) * 0.41))
        art_h = max(120, h - 48)

    art_aspect = round(art_w / art_h, 4)
    art_orientation = "landscape" if art_aspect > 1.15 else "portrait" if art_aspect < 0.87 else "square"

    return {
        "w": w,
        "h": h,
        "aspect": aspect,
        "ratioLabel": format_ratio_label(w, h),
        "arkRatio": nearest_ark_ratio(w, h),
        "shape": shape,
        "layoutName": (layout_item or {}).get("name") or "",
        "hasAnswer": "answer" in regions,
        "hasHeadline": "headline" in regions,
        "hasKeypoints": "keypoints" in regions,
        "isFlush": isinstance(media, dict) and media.get("variant") == "flush",
        "hasNavPanel": isinstance(regions.get("chapters"), dict) and regions["chapters"].get("variant") == "nav-panel",
        "art": {
            "w": art_w,
            "h": art_h,
            "aspect": art_aspect,
            "ratioLabel": format_ratio_label(art_w, art_h),
            "arkRatio": nearest_ark_ratio(art_w, art_h),
            "placement": art_placement,
            "orientation": art_orientation,
        },
    }


def mapping(value, message):
    if not isinstance(value, dict):
        raise ValueError(message)
    return value


def sound_settings(p, library):
    audio = mapping(p.get("audio", {}), "音轨设置格式无效。")
    settings = mapping(audio.get("sfx", {}), "音效设置格式无效。")
    pack = settings.get("pack", "off")
    gain = settings.get("gainDb", -14)
    if type(gain) not in (int, float) or not -30 <= gain <= -6:
        raise ValueError("音效音量应在 -30 到 -6 dB 之间。")
    sticker_sfx = settings.get("stickerSfx", True)
    if type(sticker_sfx) is not bool:
        raise ValueError("贴纸音效开关格式无效。")
    if pack == "off":
        return {}, gain
    selected = next((item for item in library.sound_packs() if item["id"] == pack), None)
    if selected is None:
        raise ValueError("请选择有效的音效风格包。")
    return selected["events"], gain


def sticker_sound_enabled(p):
    audio = p.get("audio")
    if not isinstance(audio, dict):
        return True
    settings = audio.get("sfx")
    if not isinstance(settings, dict):
        return True
    return settings.get("stickerSfx", True) is not False


def validate_stickers(raw_stickers, cue_count, library, used):
    if raw_stickers is None:
        return []
    if not isinstance(raw_stickers, list) or len(raw_stickers) > 2:
        raise ValueError("每幕最多添加 2 个贴纸。")
    out = []
    max_cue = max(1, cue_count)
    for row in raw_stickers:
        st = mapping(row, "贴纸格式无效。")
        aid = st.get("assetId")
        path, item = library.resolve(aid, ("image", "svg"))
        used.append((path, item))
        cue = st.get("cue", 0)
        if type(cue) is not int or not 0 <= cue < max_cue:
            raise ValueError("贴纸出现的字幕序号超出范围。")
        keyword = draft_content.string_field(st, "keyword", 20, optional=True)
        anchor = st.get("anchor", "media-tr")
        if anchor not in STICKER_ANCHORS:
            raise ValueError("贴纸位置锚点无效。")
        size = st.get("size", "m")
        if size not in STICKER_SIZES:
            raise ValueError("贴纸大小无效。")
        enter = st.get("enter", "pop")
        if enter not in STICKER_ENTERS:
            raise ValueError("贴纸入场动效无效。")
        hold = st.get("hold", "stay")
        if hold not in STICKER_HOLDS:
            raise ValueError("贴纸停留方式无效。")
        sfx = st.get("sfx", "auto")
        if not isinstance(sfx, str):
            raise ValueError("贴纸音效无效。")
        if sfx not in ("auto", "none"):
            library.resolve(sfx, ("sfx",))
        out.append({
            "assetId": aid,
            "url": path.as_uri(),
            "tags": item.get("tags", []),
            "cue": cue,
            "keyword": keyword,
            "anchor": anchor,
            "size": size,
            "enter": enter,
            "hold": hold,
            "sfx": sfx,
        })
    return out


def stage_input(p, library, media_path):
    layout_id = p.get("layoutId", CLASSIC_LAYOUT)
    layout, layout_item, layout_path = library.layout(layout_id)
    layout = {**layout, "supports": asset_library.layout_supports(layout, layout_item)}
    compatible = p.get("compatibility")
    if compatible is not None and (not isinstance(compatible, str) or compatible not in LEGACY_KINDS):
        raise ValueError("旧作品的呈现方式无效。")
    title = draft_content.string_field(p, "title", 40)
    short_title = draft_content.string_field(p, "shortTitle", 20, optional=True)
    disclaimer = draft_content.string_field(p, "disclaimer", 60, optional=True)
    drug = draft_content.string_field(p, "drug", 20, optional=True)
    raw_tags = p.get("drugTags")
    drug_tags = []
    if raw_tags is not None:
        if not isinstance(raw_tags, list) or len(raw_tags) > 2 or not all(
            isinstance(tag, str) and 1 <= len(tag.strip()) <= 6 for tag in raw_tags
        ):
            raise ValueError("药品标签最多 2 个，每个不超过 6 字。")
        drug_tags = [tag.strip() for tag in raw_tags]
    chapters = p.get("chapters", ["核心讲解", "要点总结"])
    if not isinstance(chapters, list) or not 2 <= len(chapters) <= 5 or not all(
        isinstance(chapter, str) and 1 <= len(chapter.strip()) <= 10 for chapter in chapters
    ):
        raise ValueError("顶部章节需要 2–5 个短标题。")
    items = p.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 12:
        raise ValueError("视频需要 1–12 幕分镜。")
    used = [(layout_path, layout_item)]
    pictures = {}
    shots = [validate_shot(item, layout, compatible, library, media_path, pictures, used) for item in items]
    deck = {"title": title, "shortTitle": short_title, "chapters": chapters}
    if "disclaimer" in p:
        deck["disclaimer"] = disclaimer
    if drug:
        deck["drug"] = drug
    if drug_tags:
        deck["drugTags"] = drug_tags
    return layout, deck, shots, pictures, used


def validate_shot_common(item, *, allow_incomplete_text=False):
    item = mapping(item, "分镜格式无效。")
    name = draft_content.string_field(item, "name", 60, optional=allow_incomplete_text)
    line = draft_content.string_field(item, "line", 450, optional=allow_incomplete_text)
    chapter = item.get("chapterIndex", 0)
    if type(chapter) is not int or not 0 <= chapter <= 4:
        raise ValueError("分镜章节无效。")
    seconds = item.get("seconds")
    if type(seconds) not in (int, float) or not 2 <= seconds <= 60:
        raise ValueError("单幕时长应在 2–60 秒之间。")
    points = mapping(item.get("points"), "请填写本幕要点。")
    if not isinstance(points.get("type"), str) or points["type"] not in POINT_TYPES:
        raise ValueError("分镜要点版式无效。")
    cue_list = item.get("cues", [])
    if not isinstance(cue_list, list) or len(cue_list) > 24:
        raise ValueError("每幕最多 24 个字幕节拍。")
    for cue in cue_list:
        mapping(cue, "字幕节拍格式无效。")
        focus = cue.get("focus", "all")
        if not isinstance(focus, str) or focus not in FOCUSES:
            raise ValueError("字幕节拍聚焦位置无效。")
        draft_content.string_field(cue, "text", 240, optional=True)
        weight = cue.get("weight", 1)
        if type(weight) not in (int, float) or not 0 < weight <= 500:
            raise ValueError("字幕节拍权重无效。")
        hl_words = cue.get("highlightWords")
        if hl_words is not None:
            if not isinstance(hl_words, list) or len(hl_words) > 24 or not all(
                isinstance(word, str) and len(word) <= 120 for word in hl_words
            ):
                raise ValueError("字幕高亮词格式无效。")
        if "highlightCustom" in cue and type(cue["highlightCustom"]) is not bool:
            raise ValueError("字幕高亮标记格式无效。")
    items = points.get("items", [])
    if not isinstance(items, list) or len(items) > 12 or not all(isinstance(item, dict) for item in items):
        raise ValueError("分镜要点条目格式无效。")
    return {"name": name, "line": line, "chapterIndex": chapter, "seconds": seconds, "cues": cue_list}


_CODE_FORBIDDEN_HTML_RE = re.compile(
    r"<\s*(?:script|iframe|object|embed|link|meta|base|img|video|audio|source|picture|portal|frame|frameset)\b",
    re.IGNORECASE,
)
_CODE_EVENT_HANDLER_RE = re.compile(r"\bon[a-z]{2,24}\s*=", re.IGNORECASE)
_CODE_ALLOWED_NS_RE = re.compile(r"https?://www\.w3\.org/(?:2000/svg|1999/xlink)\b", re.IGNORECASE)
_CODE_EXTERNAL_URL_RE = re.compile(r"(?:https?://|data\s*:\s*image/)", re.IGNORECASE)
_CODE_FORBIDDEN_JS_RE = re.compile(
    r"(?:"
    r"\bfetch\s*\("
    r"|\bXMLHttpRequest\b"
    r"|\bWebSocket\b"
    r"|\bEventSource\b"
    r"|\bimportScripts\b"
    r"|\beval\s*\("
    r"|\bFunction\s*\("
    r"|\bimport\s*\("
    r"|\bdocument\s*\.\s*(?:cookie|write|writeln)\b"
    r"|\b(?:localStorage|sessionStorage|indexedDB)\b"
    r"|\bwindow\s*\.\s*(?:parent|top|open|location)\b"
    r"|\bpostMessage\s*\("
    r"|\brequestAnimationFrame\b"
    r"|\bsetInterval\b"
    r"|\bsetTimeout\b"
    r")"
)


def validate_scene_code(code, *, check_syntax=True):
    """Validate pure HTML+CSS+SVG+JS animation code for a scene shot."""
    code = mapping(code, "代码动效数据格式无效。")
    if code.keys() - {"html", "css", "js"}:
        raise ValueError("代码动效只支持 html、css、js 字段。")
    html = code.get("html")
    css = code.get("css", "")
    js = code.get("js", "")
    if not isinstance(html, str) or not html.strip():
        raise ValueError("代码动效缺少 HTML 结构。")
    if len(html) > 24000:
        raise ValueError("代码动效 HTML 超过长度上限（24000 字符）。")
    if not isinstance(css, str) or len(css) > 16000:
        raise ValueError("代码动效 CSS 格式无效或超过长度上限（16000 字符）。")
    if not isinstance(js, str) or len(js) > 24000:
        raise ValueError("代码动效 JS 格式无效或超过长度上限（24000 字符）。")
    if _CODE_FORBIDDEN_HTML_RE.search(html):
        raise ValueError("代码动效须使用纯 HTML/CSS/SVG 实现，禁止包含 img、script、iframe 等标签。")
    if _CODE_EVENT_HANDLER_RE.search(html):
        raise ValueError("代码动效 HTML 禁止包含内联事件属性。")
    for label, text in (("HTML", html), ("CSS", css), ("JS", js)):
        cleaned = _CODE_ALLOWED_NS_RE.sub("", text)
        if _CODE_EXTERNAL_URL_RE.search(cleaned):
            raise ValueError(f"代码动效 {label} 禁止引用外部链接或内嵌位图，请使用纯代码与内联 SVG。")
    if js.strip():
        bad = _CODE_FORBIDDEN_JS_RE.search(js)
        if bad:
            token = bad.group(0)
            if token in ("requestAnimationFrame", "setInterval", "setTimeout"):
                raise ValueError("代码动效 JS 须由 t / api.progress 逐帧驱动，禁止使用 requestAnimationFrame 或定时器。")
            raise ValueError(f"代码动效 JS 包含受限调用：{token}")
        if check_syntax:
            node = shutil.which("node")
            if node:
                try:
                    proc = subprocess.run(
                        [node, "-e", 'const fs=require("fs"); new Function("root","t","duration","api", fs.readFileSync(0,"utf8"));'],
                        input=js.encode("utf-8"),
                        capture_output=True,
                        timeout=3,
                    )
                except subprocess.TimeoutExpired:
                    raise ValueError("代码动效 JS 语法校验超时。") from None
                if proc.returncode:
                    err = proc.stderr.decode("utf-8", "replace").strip().splitlines()
                    detail = err[-1] if err else "语法无效"
                    raise ValueError(f"代码动效 JS 语法错误：{detail[:180]}")
    return {"html": html.strip(), "css": css.strip(), "js": js.strip()}


def illustration(value, library, media_path, used):
    path = media_path(value)
    if path.suffix not in (".png", ".jpg", ".webp"):
        raise ValueError("请选择有效的本幕插画。")
    if value.startswith("/library/"):
        used.append(library.resolve(unquote(value.removeprefix("/library/")), ("image",)))
    return path.as_uri()


def validate_shot(item, layout, compatible, library, media_path, pictures, used):
    base = validate_shot_common(item)
    points = item["points"]
    items = points.get("items", [])
    content = mapping(item.get("content"), "请选择本幕制作方式。")
    kind = content.get("kind")
    if not isinstance(kind, str) or kind not in layout["supports"] or (compatible and kind != compatible):
        raise ValueError("所选布局不支持本幕制作方式。")
    transition = content.get("transition")
    if transition is not None:
        if transition not in TRANSITIONS:
            raise ValueError("请选择有效的幕间转场。")
        base["transition"] = transition
    base.update(kind=kind, tailPause=item.get("tailPause", 0.55))
    tone_val = points.get("verdictTone")
    if tone_val not in (None, "") and tone_val not in VERDICT_TONES:
        raise ValueError("结论语气只能是 ok、no 或 warn。")
    slide = {**{key: points[key] for key in SLIDE_FIELDS & points.keys()}, **base}
    default_points = [{"title": entry.get("title", ""), "desc": entry.get("detail", "")} for entry in items]
    for field in ("points", "steps", "warnings", "checks"):
        slide.setdefault(field, default_points)
    if "sfxId" in item:
        library.resolve(item["sfxId"], ("sfx",))
        base["sfxId"] = item["sfxId"]
    if item.get("stickers"):
        base["stickers"] = validate_stickers(item["stickers"], len(base["cues"]), library, used)
    if kind == "card" and content.get("art"):
        base["artUrl"] = illustration(content["art"], library, media_path, used)
    if kind in ("card", "scene") and content.get("form") and not (kind == "scene" and content.get("code")):
        form_id = content["form"]
        reg = stage_forms.load_registry()
        if not isinstance(form_id, str) or form_id not in reg["byId"]:
            raise ValueError("所选信息版式无效。")
        form_def = reg["byId"][form_id]
        variant = content.get("variant") or form_def["variants"][0]
        if variant not in form_def["variants"]:
            raise ValueError("版式视觉变体无效。")
        raw_data = content.get("formData")
        if raw_data is None:
            raw_data = stage_forms.derive_form_data(form_id, item)
        clean_data = stage_forms.validate_form_data(form_id, raw_data, item, check_facts=False)
        base.update(form=form_id, variant=variant, formData=clean_data)
    if kind == "image":
        for field, value in (("contentImage", content.get("image")), ("outroImage", content.get("outroImage"))):
            if not value:
                continue
            path = media_path(value)
            if path.suffix not in (".png", ".jpg", ".webp"):
                raise ValueError("请选择有效的分镜配图。")
            pictures[value] = path.as_uri()
            slide[field] = value
            if value.startswith("/library/"):
                used.append(library.resolve(unquote(value.removeprefix("/library/")), ("image",)))
        slide["focusRegions"] = content.get("focusRegions") or {}
    elif kind == "card":
        motion = content.get("motionStyle") or "auto"
        if motion != "auto" and motion not in draft_content.CODE_MOTION_MOTIONS:
            raise ValueError("信息图动效方式无效。")
        slide.update(layoutMode="explain", motionStyle=motion)
        if "artUrl" in base or "form" in base:
            base.update(items=items, takeaway=points.get("takeaway", ""), listTitle=points.get("listTitle", ""))
    elif kind == "scene":
        if content.get("code"):
            base["code"] = validate_scene_code(content["code"])
        for field, valid in (("visual", draft_content.CODE_MOTION_VISUALS), ("motion", draft_content.CODE_MOTION_MOTIONS),
                             ("motif", draft_content.CODE_MOTION_MOTIFS), ("tone", draft_content.CODE_MOTION_TONES)):
            value = content.get(field)
            if value is not None and (not isinstance(value, str) or value not in valid):
                raise ValueError("代码动效的版式、动效、图形或色调无效。")
            if value is not None:
                base[field] = value
        base.update(items=items, takeaway=points.get("takeaway", ""),
                    listTitle=points.get("listTitle", ""), beats=item.get("beats", []))
        base["labels"] = [entry.get("title", "") for entry in base["items"] if isinstance(entry, dict)]
        slide.update(type="explain", layoutMode="explain", highlightWords=base["labels"])
    elif kind == "svg":
        beats = content.get("beats")
        action = beats[0].get("action") if isinstance(beats, list) and beats and isinstance(beats[0], dict) else content.get("action")
        if compatible == "svg" and content.get("singleAction") is True:
            beats = None
        svg = {"action": action, **({"beats": beats} if beats is not None else {})}
        if compatible == "svg":
            svg_motion.validate_shot({**base, **svg})
        elif beats is not None:
            svg_motion.validate_beats(beats)
        elif not isinstance(action, str) or action not in svg_motion.ACTIONS:
            raise ValueError("请选择有效的 SVG 道具动作。")
        base.update(svg)
        slide.update(type="explain", layoutMode="explain", action=action, svgBeats=beats)
    elif kind == "mg":
        fit = content.get("fit", "auto")
        overlay = content.get("overlay", "points")
        if fit not in motion_asset.FIT_OPTIONS or overlay not in motion_asset.OVERLAY_OPTIONS:
            raise ValueError("MG 动画的时长或文字叠加设置无效。")
        motion, asset, path = library.motion(content.get("assetId"))
        used.append((path, asset))
        base.update(motionAsset=motion, overlay=overlay, fit=fit, items=items)
        slide.update(type="explain", layoutMode="explain", headline=points.get("headline") or base["name"])
    elif kind == "clip":
        clip_style = content.get("clipStyle", "demo")
        overlay = content.get("overlay", "points")
        clip_speed = content.get("clipSpeed", "normal")
        if clip_style not in CLIP_STYLES or overlay not in motion_asset.OVERLAY_OPTIONS or clip_speed not in CLIP_SPEEDS:
            raise ValueError("AI 视频的风格、文字叠加或时长适配设置无效。")
        clip_val = content.get("clip")
        if not isinstance(clip_val, str) or not clip_val.strip():
            raise ValueError("请先生成或选择本幕的 AI 视频片段。")
        clip_path = media_path(clip_val)
        if clip_path.suffix != ".mp4":
            raise ValueError("AI 视频片段必须是 MP4 文件。")
        if clip_val.startswith("/library/"):
            used.append(library.resolve(unquote(clip_val.removeprefix("/library/")), ("video",)))
        base.update(
            clip=clip_val,
            clipFile=str(clip_path),
            clipUrl=clip_path.as_uri(),
            clipStyle=clip_style,
            overlay=overlay,
            clipSpeed=clip_speed,
            items=items,
        )
        if content.get("clipDuration") and type(content["clipDuration"]) in (int, float) and content["clipDuration"] > 0:
            base["clipDuration"] = float(content["clipDuration"])
        if content.get("clipPoster"):
            poster_path = media_path(content["clipPoster"])
            if poster_path.suffix in (".png", ".jpg", ".webp"):
                base["clipPoster"] = poster_path.as_uri()
        slide.update(type="explain", layoutMode="explain", headline=points.get("headline") or base["name"])
    else:
        move = content.get("move", "still")
        if move not in ("still", "zoom", "pan"):
            raise ValueError("静态素材的移动方式无效。")
        item_id = content.get("assetId")
        asset = library.resolve(item_id, ("image", "svg"))
        base["assetUrl"] = asset[0].as_uri()
        used.append(asset)
        base["move"] = move
        slide["layoutMode"] = "explain"
    return {**base, "slide": slide}
