"""Validated workbench input for the shared video stage."""

from urllib.parse import unquote

import asset_library
import draft_content
import motion_asset
import svg_motion


CLASSIC_LAYOUT = "builtin:layout/info-classic"
CONTENT_KINDS = asset_library.LAYOUT_CONTENTS
LEGACY_KINDS = frozenset(("image", "card", "scene", "svg"))
FOCUSES = frozenset(("all", "0", "1", "2", "3", "top", "bottom", "question", "answer", "action", "outro"))
TRANSITIONS = ("fade", "wipe", "iris", "slide")
POINT_TYPES = frozenset(("cover", "explain", "compare", "steps", "warning", "summary", "timeline", "checklist"))
VERDICT_TONES = frozenset(("ok", "no", "warn"))
SLIDE_FIELDS = frozenset(("type", "layoutMode", "headline", "lead", "accentPhrase", "question", "answer",
                          "verdictTone", "items", "points", "pills", "steps", "warnings", "columns", "checks",
                          "takeaway", "listTitle", "footerNote", "outroNote", "highlightWords", "leftTop"))


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
    if pack == "off":
        return {}, gain
    selected = next((item for item in library.sound_packs() if item["id"] == pack), None)
    if selected is None:
        raise ValueError("请选择有效的音效风格包。")
    return selected["events"], gain


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
    items = points.get("items", [])
    if not isinstance(items, list) or len(items) > 12 or not all(isinstance(item, dict) for item in items):
        raise ValueError("分镜要点条目格式无效。")
    return {"name": name, "line": line, "chapterIndex": chapter, "seconds": seconds, "cues": cue_list}


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
    elif kind == "scene":
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
        if content.get("libraryArtId"):
            asset = library.resolve(content["libraryArtId"], ("image", "svg"))
            base["libraryArtUrl"] = asset[0].as_uri()
            used.append(asset)
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
