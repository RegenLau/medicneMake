"""Reusable local assets. Saved media stays available after it is archived."""

import base64
import binascii
import hashlib
import json
import re
import subprocess
import threading
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote, urlparse

import motion_asset


SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
SVG_ELEMENTS = frozenset("svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc text tspan".split())
SVG_ATTRIBUTES = frozenset("id viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity fill-opacity stroke-opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits preserveAspectRatio font-size font-weight text-anchor dominant-baseline dx dy".split())
LOCAL_PAINT = re.compile(r"url\(#[A-Za-z_][\w.:-]*\)")
USER_ID = re.compile(r"user:[0-9a-f]{32}")
LIMITS = {"image": 8 * 1024 * 1024, "svg": 300 * 1024, "layout": 64 * 1024, "lottie": motion_asset.LOTTIE_LIMIT}
LAYOUT_VARIANTS = {
    "header": ("pill-title+chapter-rail",),
    "chapters": ("rail",),
    "presenter": ("column-card",),
    "media": ("hook", "outro"),
    "subtitle": ("band",),
    "disclaimer": ("note",),
    "progress": ("bar",),
}
LAYOUT_CONTENTS = frozenset(("image", "card", "scene", "svg", "asset", "mg"))
REGION_FIELDS = frozenset(("x", "y", "w", "h", "component"))


def _layout_number(value, lower, upper):
    return type(value) in (int, float) and lower <= value <= upper


def _layout_regions(regions):
    if (not isinstance(regions, dict) or not {"media", "subtitle"} <= regions.keys()
            or not regions.keys() <= LAYOUT_VARIANTS.keys()):
        raise ValueError("布局必须包含内容区和字幕区，并使用已知组件。")
    for name, region in regions.items():
        if (not isinstance(region, dict) or not REGION_FIELDS <= region.keys()
                or not region.keys() <= REGION_FIELDS | {"variant"}
                or region["component"] != name):
            raise ValueError("布局区域字段或组件无效。")
        if "variant" in region and region["variant"] not in LAYOUT_VARIANTS[name]:
            raise ValueError("布局组件样式无效。")
        if not all(_layout_number(region[key], 0, 100) for key in ("x", "y", "w", "h")):
            raise ValueError("布局坐标必须是 0 到 100 的数字。")
        if (not region["w"] or not region["h"] or region["x"] + region["w"] > 100 + 1e-9
                or region["y"] + region["h"] > 100 + 1e-9):
            raise ValueError("布局区域超出画布或大小为零。")
    media, subtitle = regions["media"], regions["subtitle"]
    if media["w"] * media["h"] < 3500:
        raise ValueError("内容区至少占画布的 35%。")
    if (min(media["x"] + media["w"], subtitle["x"] + subtitle["w"]) > max(media["x"], subtitle["x"]) + 1e-9
            and min(media["y"] + media["h"], subtitle["y"] + subtitle["h"]) > max(media["y"], subtitle["y"]) + 1e-9):
        raise ValueError("内容区不能和字幕区重叠。")


def validate_layout(definition):
    required = {"schemaVersion", "aspect", "canvas", "regions", "supports"}
    if (not isinstance(definition, dict) or not required <= definition.keys()
            or not definition.keys() <= required | {"stages", "slots"}):
        raise ValueError("布局定义包含缺失或未知字段。")
    if (type(definition["schemaVersion"]) is not int or definition["schemaVersion"] != 1
            or definition["aspect"] != "16:9" or definition["canvas"] != {"w": 1280, "h": 720}):
        raise ValueError("只支持 1280×720 的第 1 版布局。")
    supports = definition["supports"]
    if (not isinstance(supports, list) or not supports or not all(isinstance(item, str) and item in LAYOUT_CONTENTS for item in supports)
            or len(supports) != len(set(supports))):
        raise ValueError("布局的制作方式无效。")
    _layout_regions(definition["regions"])
    stages = definition.get("stages", {})
    if not isinstance(stages, dict) or not stages.keys() <= {"hook", "outro"}:
        raise ValueError("布局的开场或结尾配置无效。")
    for stage in stages.values():
        if not isinstance(stage, dict) or stage.keys() != {"regions"}:
            raise ValueError("开场或结尾只能定义已知布局区域。")
        _layout_regions(stage["regions"])
    slots = definition.get("slots", {})
    if (not isinstance(slots, dict) or not slots.keys() <= {"avatarSize"}
            or ("avatarSize" in slots and not _layout_number(slots["avatarSize"], 20, 540))):
        raise ValueError("布局头像大小无效。")
    return definition


def layout_supports(definition, item):
    return list(dict.fromkeys([*definition["supports"],
                               *(kind for kind in item.get("extraSupports", ()) if kind in LAYOUT_CONTENTS)]))


def clean_svg(data):
    try:
        xml = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("请上传 UTF-8 编码的 SVG。") from error
    if re.search(r"<!\s*(DOCTYPE|ENTITY)", xml, flags=re.IGNORECASE):
        raise ValueError("SVG 不能包含文档类型或实体声明。")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise ValueError("SVG 文件格式无效。") from error
    prefix = "{" + SVG_NS + "}"
    if root.tag not in ("svg", prefix + "svg"):
        raise ValueError("请选择 SVG 文件。")
    for node in root.iter():
        tag = node.tag.removeprefix(prefix)
        if tag not in SVG_ELEMENTS:
            raise ValueError("SVG 仅支持静态矢量图形。请移除脚本、动画、外链和嵌入内容。")
        node.tag = prefix + tag
        for key, value in node.attrib.items():
            if key not in SVG_ATTRIBUTES or ("(" in value and key in {"fill", "stroke", "clip-path", "mask"}
                                              and not LOCAL_PAINT.fullmatch(value) and not re.fullmatch(r"rgba?\([\d\s.,%]+\)", value)):
                raise ValueError("SVG 包含不支持的属性或外部引用。")
    return ET.tostring(root, encoding="utf-8")


def image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "png_pipe"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg", "jpeg_pipe"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp", "webp_pipe"
    raise ValueError("请选择 PNG、JPG 或 WebP 图片。")


def check_image(data, ffmpeg):
    ext, demuxer = image_type(data)
    if not ffmpeg:
        raise ValueError("导入图片需要工作台的 FFmpeg。")
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-loglevel", "error", "-xerror", "-max_pixels", "36000000",
             "-protocol_whitelist", "pipe", "-f", demuxer, "-i", "pipe:0", "-frames:v", "1", "-f", "null", "-"],
            input=data, capture_output=True, timeout=15,
        )
    except subprocess.TimeoutExpired as error:
        raise ValueError("图片读取超时，请换一张尺寸较小的图片。") from error
    if result.returncode:
        raise ValueError("无法读取这张图片，请检查文件格式和尺寸。")
    return ext


def text_field(fields, name, limit, required=False):
    value = fields.get(name, "")
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError(f"素材字段 {name} 无效。")
    return value.strip()


def asset_url(asset_id):
    return "/library/" + quote(asset_id, safe="")


def digest(path):
    with path.open("rb") as handle:
        result = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            result.update(chunk)
        return result.hexdigest()


class LocalLibrary:
    def __init__(self, root, builtin_root):
        self.root = Path(root)
        self.builtin_root = Path(builtin_root)
        self.lock = threading.Lock()

    def _read_user(self):
        index = self.root / "index.json"
        return json.loads(index.read_text(encoding="utf-8")) if index.is_file() else []

    def _write_user(self, entries):
        temp = self.root / "index.tmp"
        temp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self.root / "index.json")

    def _builtins(self):
        catalog = self.builtin_root / "catalog.json"
        return json.loads(catalog.read_text(encoding="utf-8")) if catalog.is_file() else []

    def items(self):
        return [self.public(item) for item in (*self._builtins(), *self._read_user())
                if item.get("file") and not item.get("archived")]

    def stage_catalog(self):
        return next(item["data"] for item in self._builtins() if item["id"] == "builtin:stage-config/v1")

    def sound_packs(self):
        return [{key: item[key] for key in ("id", "name", "gainDb", "events")}
                for item in self._builtins() if item["kind"] == "sfx-pack"]

    @staticmethod
    def public(item):
        row = {**{key: value for key, value in item.items() if key not in ("file", "previewDigest")}, "url": asset_url(item["id"])}
        if item.get("previewDigest"):
            prefix = "/library-preview/" + quote(item["id"], safe="")
            row.update(thumbnailUrl=prefix + "/poster.jpg", previewUrl=prefix + "/preview.mp4")
        return row

    def resolve(self, asset_id, kinds=()):
        if not isinstance(asset_id, str):
            raise ValueError("素材 ID 无效。")
        user = USER_ID.fullmatch(asset_id)
        entries = self._read_user() if user else self._builtins()
        item = next((item for item in entries if item["id"] == asset_id), None)
        if not item or not item.get("file") or (kinds and item["kind"] not in kinds):
            raise ValueError("找不到所选素材，或素材类型不匹配。")
        root = (self.root / "files" if user else self.builtin_root).resolve()
        path = (root / item["file"]).resolve()
        if root not in path.parents or not path.is_file():
            raise ValueError("素材文件不存在。")
        return path, self.public(item)

    def layout(self, asset_id):
        path, item = self.resolve(asset_id, ("layout",))
        return validate_layout(json.loads(path.read_text(encoding="utf-8"))), item, path

    def layout_items(self, items=None):
        entries = self.items() if items is None else items
        layouts = []
        for item in entries:
            if item["kind"] != "layout":
                continue
            definition, _, _ = self.layout(item["id"])
            layouts.append({**item, "aspect": definition["aspect"], "supports": layout_supports(definition, item),
                            "regions": definition["regions"]})
        return layouts

    def copy_layout(self, payload):
        _, origin, _ = self.layout(payload.get("originId"))
        fields = {"name": payload.get("name"), "tags": ", ".join(origin["tags"]),
                  "license": origin["license"], "credit": origin.get("credit") or f'来源布局：{origin["name"]}'}
        definition = validate_layout(payload.get("definition"))
        return self.add("layout", json.dumps(definition, ensure_ascii=False).encode("utf-8"),
                        fields, None, "copy", origin=origin)

    def motion(self, asset_id):
        path, item = self.resolve(asset_id, ("lottie",))
        return motion_asset.lottie_package(path.read_bytes(), item.get("palette", {})), item, path

    def motion_preview_file(self, asset_id, name):
        _, item = self.resolve(asset_id, ("lottie",))
        if name not in ("poster.jpg", "preview.mp4") or not item.get("previewUrl", "").startswith("/library-preview/"):
            raise ValueError("素材预览不存在。")
        key = self._read_user()
        entry = next((row for row in key if row["id"] == asset_id), {})
        path = self.root / "previews" / entry.get("previewDigest", "") / name
        if not path.is_file():
            raise ValueError("素材预览不存在。")
        return path

    def add_motion(self, kind, raw, fields, preview_renderer, source, origin_id=None):
        if kind != "lottie":
            raise ValueError("请选择 Lottie 动画文件。")
        asset = motion_asset.lottie_package(raw, fields.get("palette", {}))
        metadata = {key: text_field(fields, key, limit, required=required)
                    for key, limit, required in (("useFor", 180, True), ("sourceUrl", 400, False),
                                                  ("licenseText", 1600, False))}
        text_field(fields, "name", 80, required=True)
        text_field(fields, "license", 120, required=True)
        text_field(fields, "credit", 200, required=True)
        if metadata["sourceUrl"]:
            url = urlparse(metadata["sourceUrl"])
            if url.scheme != "https" or not url.hostname or url.username or not metadata["licenseText"]:
                raise ValueError("外部动画请填写 HTTPS 原始链接及页面授权原文。")
        cache_key = hashlib.sha256(json.dumps(asset, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
        folder = self.root / "previews" / cache_key
        if not all((folder / file).is_file() for file in ("poster.jpg", "preview.mp4")):
            preview_renderer(asset, folder)
        data = json.dumps(asset["animation"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        extra = {**{key: value for key, value in metadata.items() if value},
                 "palette": asset["palette"], "markers": asset["markers"], "previewDigest": cache_key}
        if origin_id:
            extra["originId"] = origin_id
        return self.add(kind, data, fields, None, source, extra=extra)

    def copy_motion_palette(self, payload, preview_renderer):
        path, item = self.resolve(payload.get("id"), ("lottie",))
        fields = {**item, "name": text_field(payload, "name", 80, required=True),
                  "tags": ", ".join(item.get("tags", [])), "palette": payload.get("palette"),
                  "credit": item.get("credit") or f'来源素材：{item["name"]}'}
        return self.add_motion("lottie", path.read_bytes(), fields, preview_renderer, "copy", item["id"])

    def upload(self, payload, ffmpeg, preview_renderer=None):
        kind = payload.get("kind")
        if kind not in LIMITS:
            raise ValueError("请选择图片、SVG 或布局 JSON。")
        try:
            raw = base64.b64decode(payload["data"], validate=True)
        except (KeyError, TypeError, ValueError, binascii.Error) as error:
            raise ValueError("文件数据无效。") from error
        if kind == "lottie":
            return self.add_motion(kind, raw, payload, preview_renderer, "upload")
        return self.add(kind, raw, payload, ffmpeg, "upload")

    def add(self, kind, data, fields, ffmpeg, source, origin=None, extra=None):
        if not 0 < len(data) <= LIMITS[kind]:
            raise ValueError("文件大小无效。图片上限 8 MB，SVG 上限 300 KB，布局上限 64 KB。")
        if kind == "svg":
            data, ext = clean_svg(data), ".svg"
        elif kind == "layout":
            try:
                definition = json.loads(data.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("请选择 UTF-8 编码的布局 JSON 文件。") from error
            data = json.dumps(validate_layout(definition), sort_keys=True, separators=(",", ":")).encode("utf-8")
            ext = ".json"
        elif kind == "lottie":
            ext = ".json"
        else:
            ext = check_image(data, ffmpeg)
        name = text_field(fields, "name", 80, required=True)
        rights = text_field(fields, "license", 120, required=True)
        credit = text_field(fields, "credit", 200)
        if kind == "layout" and not credit:
            raise ValueError("请填写布局的原始来源或署名。")
        if rights == "CC BY" and not credit:
            raise ValueError("CC BY 素材请填写署名。")
        tags = list(dict.fromkeys(tag.strip() for tag in re.split(r"[,，、]", text_field(fields, "tags", 180)) if tag.strip()))
        metadata = {key: text_field(fields, key, size) for key, size in
                    (("topic", 200), ("prompt", 5000), ("style", 48), ("ratio", 16), ("model", 100))}
        sha = hashlib.sha256(data).hexdigest()
        with self.lock:
            entries = self._read_user()
            for item in entries if kind not in ("layout", "lottie") else ():
                if item.get("sha256") == sha and item["kind"] == kind and not item.get("archived"):
                    return self.public(item)
            files = self.root / "files"
            files.mkdir(parents=True, exist_ok=True)
            filename = sha + ext
            path = files / filename
            if not path.is_file():
                temp = path.with_suffix(".tmp")
                temp.write_bytes(data)
                temp.replace(path)
            item = {"id": "user:" + uuid.uuid4().hex, "kind": kind, "name": name, "tags": tags,
                    "source": source, "license": rights, "credit": credit, "sha256": sha,
                    "file": filename, "meta": {key: value for key, value in metadata.items() if value}}
            if kind == "layout":
                item["aspect"] = definition["aspect"]
                if origin:
                    item["originId"] = origin["id"]
                    if origin.get("termsUrl"):
                        item["termsUrl"] = origin["termsUrl"]
            item.update(extra or {})
            entries.insert(0, item)
            self._write_user(entries)
            return self.public(item)

    def archive(self, asset_id):
        with self.lock:
            entries = self._read_user()
            item = next((item for item in entries if item["id"] == asset_id), None)
            if not item:
                raise ValueError("仅可下架自己收录的素材。")
            if not item.get("archived"):
                item["archived"] = True
                self._write_user(entries)
