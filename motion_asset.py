"""Decode local motion assets and the data consumed by the offline renderer."""

import base64
import binascii
import json
import math
import re


LOTTIE_LIMIT = 1024 * 1024
BITMAP_LIMIT = 300 * 1024
THEME_PALETTE = ("--v-primary", "--v-primary-soft", "--v-ink", "--v-green", "--v-coral", "--v-card-bg")
KNOWN_EVENTS = frozenset(("scene-in", "item-focus", "beat-in", "check", "warning", "outro"))
FIT_OPTIONS = ("auto", "hold")
OVERLAY_OPTIONS = ("points", "title", "off")
HEX_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
VERSION = re.compile(r"\d{1,2}\.\d{1,2}\.\d{1,3}")
LINK = re.compile(r"^\s*(?:(?:https?|file|ftp|javascript):|//)", re.IGNORECASE)


def number(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def json_bytes(data):
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise ValueError("请选择 UTF-8 编码的动画 JSON 文件。") from error


def checked_palette(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError("配色映射必须是对象，最多 32 项。")
    shades = {}
    for key, token in value.items():
        if not isinstance(key, str) or not HEX_COLOR.fullmatch(key) or token not in THEME_PALETTE:
            raise ValueError("配色映射需要使用 #RRGGBB 和主题色变量。")
        shades[key.lower()] = token
    return shades


def validate_bitmap(asset):
    if asset.get("u") or asset.get("e") != 1:
        raise ValueError("Lottie 不能引用外链或相对路径资源。")
    header, sep, encoded = asset["p"].partition(",") if isinstance(asset["p"], str) else ("", "", "")
    try:
        raw = base64.b64decode(encoded, validate=True) if sep else b""
    except (ValueError, binascii.Error):
        raw = b""
    if header == "data:image/png;base64" and raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return len(raw)
    if header == "data:image/jpeg;base64" and raw.startswith(b"\xff\xd8\xff"):
        return len(raw)
    raise ValueError("Lottie 只支持内嵌的 PNG 或 JPEG 位图，不能引用外链资源。")


def walk_lottie(data):
    stack = [(data, 0)]
    while stack:
        value, depth = stack.pop()
        if depth > 70:
            raise ValueError("Lottie 的图层数据嵌套过深。")
        if isinstance(value, list):
            stack.extend((item, depth + 1) for item in value)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key in ("expression", "expressions", "xpr") or key == "x" and isinstance(item, str):
                    raise ValueError("Lottie 不能包含表达式，例如 wiggle 或 random。")
                if key in ("fonts", "chars"):
                    raise ValueError("Lottie 不能包含文字图层。请在工作台添加文字。")
                if isinstance(item, str) and LINK.match(item):
                    raise ValueError("Lottie 不能包含外链资源。")
                stack.append((item, depth + 1))


def lottie_markers(value, first, last, fps):
    if not isinstance(value, list) or len(value) > 200:
        raise ValueError("Lottie 标记点格式无效。")
    result = []
    for row in value:
        if not isinstance(row, dict) or not isinstance(row.get("cm"), str):
            raise ValueError("Lottie 标记点格式无效。")
        name = row["cm"].strip()
        if name not in ("intro", "loop", "outro") and not (
            name.startswith("sfx:") and name[4:] in KNOWN_EVENTS
        ):
            continue
        frame, duration = row.get("tm"), row.get("dr", 0)
        if not number(frame, first, last) or not number(duration, 0, last - frame):
            raise ValueError("Lottie 标记点超出时间范围。")
        result.append({"name": name, "t": (frame - first) / fps, "d": duration / fps})
    return result


def lottie(data):
    if not 0 < len(data) <= LOTTIE_LIMIT:
        raise ValueError("Lottie 文件不能超过 1 MB。")
    root = json_bytes(data)
    if not isinstance(root, dict) or not {"v", "fr", "ip", "op", "w", "h", "layers"} <= root.keys():
        raise ValueError("Lottie 缺少必填字段 v、fr、ip、op、w、h 或 layers。")
    if not isinstance(root["v"], str) or not VERSION.fullmatch(root["v"]):
        raise ValueError("Lottie 版本号无效。")
    fps, first, last = root["fr"], root["ip"], root["op"]
    if not (number(fps, 1, 120) and number(first, -100000, 100000) and number(last, first + 1, first + 120000)):
        raise ValueError("Lottie 帧率或时间范围无效。")
    if not all(number(root[key], 1, 4096) for key in ("w", "h")):
        raise ValueError("Lottie 画布宽高必须在 1 到 4096 像素之间。")
    walk_lottie(root)
    assets = root.get("assets", [])
    if not isinstance(assets, list) or len(assets) > 200:
        raise ValueError("Lottie 素材列表无效。")
    bitmaps, by_id, groups = 0, {}, {"": root["layers"]}
    for asset in assets:
        if not isinstance(asset, dict) or not isinstance(asset.get("id"), str) or not asset["id"] or asset["id"] in by_id:
            raise ValueError("Lottie 素材 ID 缺失或重复。")
        ident = asset["id"]
        by_id[ident] = asset
        if "p" in asset:
            bitmaps += validate_bitmap(asset)
        elif "layers" in asset and not asset.get("u"):
            groups[ident] = asset["layers"]
        else:
            raise ValueError("Lottie 不能包含外链资源。")
    if bitmaps > BITMAP_LIMIT:
        raise ValueError("Lottie 内嵌位图不能超过 300 KB。")
    if any(not isinstance(layers, list) for layers in groups.values()) or sum(map(len, groups.values())) > 200:
        raise ValueError("Lottie 不能超过 200 个图层。")
    if not root["layers"]:
        raise ValueError("Lottie 至少需要一个图层。")
    dependencies = {}
    for ident, layers in groups.items():
        children = set()
        for layer in layers:
            if not isinstance(layer, dict) or type(layer.get("ty")) is not int:
                raise ValueError("Lottie 图层格式无效。")
            if layer["ty"] == 5:
                raise ValueError("Lottie 不能包含文字图层。请在工作台添加文字。")
            if layer["ty"] not in (0, 1, 2, 3, 4):
                raise ValueError("Lottie 仅支持形状、固态、空对象、预合成及内嵌图片。")
            if layer["ty"] in (0, 2):
                ref = layer.get("refId")
                if not isinstance(ref, str) or ref not in by_id or (ref in groups) != (layer["ty"] == 0):
                    raise ValueError("Lottie 图层引用无效或指向外部素材。")
                if ref in groups:
                    children.add(ref)
            layer.pop("cl", None)
            layer.pop("ln", None)
        dependencies[ident] = children

    visited = set()

    def check_cycle(ident, chain):
        if ident in chain:
            raise ValueError("Lottie 预合成不能循环引用。")
        if ident in visited:
            return
        for child in dependencies[ident]:
            check_cycle(child, chain | {ident})
        visited.add(ident)

    for ident in groups:
        check_cycle(ident, set())
    markers = lottie_markers(root.get("markers", []), first, last, fps)
    return root, markers


def lottie_package(data, palette):
    spec, markers = lottie(data)
    return {"kind": "lottie", "animation": spec, "palette": checked_palette(palette),
            "markers": markers, "duration": (spec["op"] - spec["ip"]) / spec["fr"]}
