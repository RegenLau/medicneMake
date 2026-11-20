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


MG_LIMIT = 300 * 1024
MG_PROPS = {
    "opacity": (0, 1), "translateX": (-1600, 1600), "translateY": (-900, 900),
    "scale": (0, 5), "rotate": (-720, 720), "draw": (0, 1), "clip": (0, 1), "blur": (0, 24),
}
MG_EASES = ("linear", "outCubic", "outExpo", "outBack", "inOutCubic", "wobble")
MG_TRACK_FIELDS = {"part", "prop", "from", "to", "start", "end", "ease"}
PART_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,31}")


def mg_package(data, clean_svg):
    import xml.etree.ElementTree as ET

    if not 0 < len(data) <= MG_LIMIT:
        raise ValueError("MG 规格文件不能超过 300 KB。")
    value = json_bytes(data)
    if not isinstance(value, dict) or value.keys() != {"schemaVersion", "svg", "duration", "tracks", "events"}:
        raise ValueError("MG 规格需要 schemaVersion、svg、duration、tracks 和 events。")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("MG 规格版本必须为 1。")
    if not isinstance(value["svg"], str) or not value["svg"].strip():
        raise ValueError("请提供矢量 SVG 图形。")
    duration = value["duration"]
    if not number(duration, 1, 8):
        raise ValueError("素材参考时长应为 1 到 8 秒。")
    svg = clean_svg(value["svg"].encode("utf-8"), motion=True)
    root = ET.fromstring(svg)
    bounds = root.get("viewBox", "").replace(",", " ").split()
    try:
        canvas = [float(value) for value in bounds]
    except ValueError:
        canvas = []
    if (len(canvas) != 4 or not all(number(x, -4000, 4000) for x in canvas)
            or min(canvas[2:]) <= 0 or abs(canvas[2] / canvas[3] - 16 / 9) > .02):
        raise ValueError("MG 素材需要 16:9 的 SVG viewBox，例如 0 0 800 450。")
    nodes = list(root.iter())
    parts = [element.get("data-part") for element in nodes if element.get("data-part")]
    if not parts or len(parts) != len(set(parts)) or len(nodes) > 300:
        raise ValueError("MG 需要可动部件，data-part 不允许重复，SVG 最多 300 个节点。")
    part_names = set(parts)
    tracks = value["tracks"]
    if not isinstance(tracks, list) or not 1 <= len(tracks) <= 120:
        raise ValueError("MG 需要 1 到 120 条动作轨道。")
    for track in tracks:
        if not isinstance(track, dict) or not MG_TRACK_FIELDS <= track.keys() <= MG_TRACK_FIELDS | {"loop", "stagger", "index"}:
            raise ValueError("动作轨道字段无效。")
        part, prop = track["part"], track["prop"]
        if not isinstance(part, str) or not PART_NAME.fullmatch(part) or part not in part_names:
            raise ValueError("每条轨道的 part 必须对应 SVG 中的 data-part。")
        if not isinstance(prop, str) or prop not in MG_PROPS or track["ease"] not in MG_EASES:
            raise ValueError("轨道属性或缓动不在白名单中。")
        low, high = MG_PROPS[prop]
        if not number(track["from"], low, high) or not number(track["to"], low, high):
            raise ValueError(f"{prop} 的起止值超出范围。")
        if not number(track["start"], 0, 1) or not number(track["end"], 0, 1) or track["start"] >= track["end"]:
            raise ValueError("轨道起止时间必须在 0 到 1 之间，且起点小于终点。")
        shift, index = track.get("stagger", 0), track.get("index", 0)
        if (not number(shift, 0, 1) or type(index) is not int or not 0 <= index <= 50
                or track["end"] + shift * index > 1 + 1e-9
                or ("loop" in track and track["loop"] not in ("repeat", "pingpong"))):
            raise ValueError("轨道交错或循环设置无效。")
    events = value["events"]
    if not isinstance(events, list) or len(events) > 12 or not all(
        isinstance(row, dict) and row.keys() == {"type", "t"} and isinstance(row["type"], str)
        and row["type"] in KNOWN_EVENTS and number(row["t"], 0, 1) for row in events
    ):
        raise ValueError("MG 音效事件必须有有效的 type 和 0 到 1 的时间，最多 12 项。")
    return {"kind": "mg", "svg": svg.decode("utf-8"), "tracks": tracks, "events": events, "duration": duration,
            "markers": [{"name": "sfx:" + row["type"], "t": row["t"] * duration, "d": 0} for row in events]}
