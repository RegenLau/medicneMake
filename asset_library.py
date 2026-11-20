"""Reusable local assets. Saved media stays available after it is archived."""

import base64
import binascii
import copy
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
LIMITS = {"image": 8 * 1024 * 1024, "svg": 300 * 1024, "layout": 64 * 1024, "theme": 16 * 1024,
          "lottie": motion_asset.LOTTIE_LIMIT, "mg": motion_asset.MG_LIMIT}
LAYOUT_VARIANTS = {
    "header": ("pill-title+chapter-rail", "breadcrumb", "ticker", "namecard", "question"),
    "chapters": ("rail", "nav-panel"),
    "presenter": ("column-card", "avatar"),
    "media": ("hook", "outro", "flush"),
    "subtitle": ("band", "card", "pill", "tab-band", "inline"),
    "disclaimer": ("note", "inline-right"),
    "progress": ("bar",),
    "keypoints": ("list",),
    "answer": ("bubble",),
    "headline": ("poster",),
}
LAYOUT_CONTENTS = frozenset(("image", "card", "scene", "svg", "asset", "mg"))
REGION_FIELDS = frozenset(("x", "y", "w", "h", "component"))
THEME_BASES = frozenset(("medical", "warm"))
THEME_LENGTH_VARS = frozenset(("--v-card-radius", "--v-card-border-w"))
THEME_COLOR_VARS = frozenset((
    "--v-ink", "--v-ink-soft", "--v-primary", "--v-primary-deep", "--v-primary-soft",
    "--v-coral", "--v-coral-soft", "--v-amber", "--v-amber-soft", "--v-green", "--v-green-soft",
    "--v-card-bg", "--v-card-border", "--v-ring-outer", "--v-ring-track", "--v-ring-inner",
    "--v-sub-hl", "--v-band", "--v-band-ink", "--v-rail-bg", "--v-rail-ink", "--v-rail-line",
))
THEME_VARS = THEME_COLOR_VARS | THEME_LENGTH_VARS | frozenset(("--v-bg", "--v-card-shadow", "--v-card-blur"))
_THEME_FORBIDDEN = re.compile(r"url\s*\(|;|[{}<>\"'\\]|/\*|expression|@|\r|\n", re.IGNORECASE)
_NUM = r"(?:\d+(?:\.\d+)?|\.\d+)"
_HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_RGB_FUNC = re.compile(rf"^rgb\(\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?\s*\)$")
_RGBA_FUNC = re.compile(rf"^rgba\(\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?\s*\)$")
_RGBA_INLINE = re.compile(rf"rgba\(\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?\s*\)")
_COLOR_INLINE = re.compile(rf"rgba?\(\s*{_NUM}%?\s*,\s*{_NUM}%?\s*,\s*{_NUM}%?(?:\s*,\s*{_NUM}%?)?\s*\)")
_THEME_LENGTH = re.compile(r"^\d+(?:\.\d+)?px$")
_THEME_SHADOW_LEN = re.compile(r"^(?:0|\d+(?:\.\d+)?px)$")
_THEME_BLUR = re.compile(r"^(?:none|blur\(\d+(?:\.\d+)?px\)(?:\s+saturate\(\d+(?:\.\d+)?\))?)$")
_THEME_GRADIENT = re.compile(r"^(?:linear|radial)-gradient\((.+)\)$")
_THEME_PCT = re.compile(rf"^{_NUM}%$")
_THEME_DEG = re.compile(rf"^-?{_NUM}deg$")


def _theme_clean_text(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or _THEME_FORBIDDEN.search(text):
        return None
    return text


def _is_theme_color(value):
    text = _theme_clean_text(value)
    return bool(text and (_HEX_COLOR.fullmatch(text) or _RGB_FUNC.fullmatch(text) or _RGBA_FUNC.fullmatch(text)))


def _is_theme_shadow(value):
    text = _theme_clean_text(value)
    if not text or len(text) > 120:
        return False
    scrubbed = _RGBA_INLINE.sub("RGBA", text)
    if "(" in scrubbed or ")" in scrubbed:
        return False
    layers = [part.strip() for part in scrubbed.split(",")]
    if not layers or any(not layer for layer in layers):
        return False
    for layer in layers:
        tokens = layer.split()
        if tokens.count("RGBA") != 1:
            return False
        if tokens[0] != "RGBA" and tokens[-1] != "RGBA":
            return False
        lengths = [tok for tok in tokens if tok != "RGBA"]
        if not 2 <= len(lengths) <= 4 or not all(_THEME_SHADOW_LEN.fullmatch(tok) for tok in lengths):
            return False
    return True


def _is_theme_bg(value):
    text = _theme_clean_text(value)
    if not text or len(text) > 300:
        return False
    if _is_theme_color(text):
        return True
    match = _THEME_GRADIENT.fullmatch(text)
    if not match:
        return False
    inner = match.group(1).strip()
    parts, buf, depth = [], [], 0
    for ch in inner:
        if ch == "(":
            depth += 1
            if depth > 1:
                return False
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if depth != 0:
        return False
    parts.append("".join(buf).strip())
    if len(parts) < 2 or any(not part for part in parts):
        return False
    color_stops = 0
    for part in parts:
        tokens = []
        pos = 0
        for found in _COLOR_INLINE.finditer(part):
            tokens.extend(part[pos:found.start()].split())
            tokens.append(found.group(0))
            pos = found.end()
        tokens.extend(part[pos:].split())
        if not tokens:
            return False
        has_color = False
        for token in tokens:
            if _is_theme_color(token):
                has_color = True
            elif not (_THEME_PCT.fullmatch(token) or _THEME_DEG.fullmatch(token) or token in ("at", "circle", "ellipse")):
                return False
        if has_color:
            color_stops += 1
    return color_stops >= 2


def validate_theme(definition, resolve_image=None):
    required = {"schemaVersion", "base", "vars"}
    allowed = required | {"background", "glass", "fadeColor"}
    if not isinstance(definition, dict) or not required <= definition.keys() or not definition.keys() <= allowed:
        raise ValueError("主题定义包含缺失或未知字段。")
    if type(definition["schemaVersion"]) is not int or definition["schemaVersion"] != 1:
        raise ValueError("只支持第 1 版主题定义。")
    if definition["base"] not in THEME_BASES:
        raise ValueError("主题基础风格只能是 medical 或 warm。")
    variables = definition["vars"]
    if not isinstance(variables, dict) or not variables or not variables.keys() <= THEME_VARS:
        raise ValueError("主题包含未知或空的样式变量。")
    for name, value in variables.items():
        if name in THEME_LENGTH_VARS:
            ok = bool(_theme_clean_text(value) and _THEME_LENGTH.fullmatch(value.strip()))
        elif name == "--v-card-shadow":
            ok = _is_theme_shadow(value)
        elif name == "--v-card-blur":
            ok = bool(_theme_clean_text(value) and _THEME_BLUR.fullmatch(value.strip()))
        elif name == "--v-bg":
            ok = _is_theme_bg(value)
        else:
            ok = _is_theme_color(value)
        if not ok:
            raise ValueError(f"主题变量 {name} 的取值不符合安全规范。")
    if "glass" in definition and type(definition["glass"]) is not bool:
        raise ValueError("主题毛玻璃选项无效。")
    if "fadeColor" in definition and not _is_theme_color(definition["fadeColor"]):
        raise ValueError("主题淡入底色无效。")
    if "background" in definition:
        bg = definition["background"]
        if not isinstance(bg, dict) or set(bg.keys()) != {"assetId"}:
            raise ValueError("主题背景图配置无效。")
        asset_id = _theme_clean_text(bg.get("assetId"))
        if not asset_id:
            raise ValueError("主题背景图素材 ID 无效。")
        if resolve_image is not None:
            resolve_image(asset_id)
    return definition


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


def clean_svg(data, *, motion=False):
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
        if motion and (tag in ("text", "tspan", "title", "desc") or (node.text or "").strip() or (node.tail or "").strip()):
            raise ValueError("MG 动画不能包含文字。请用工作台的文字叠加。")
        if tag not in SVG_ELEMENTS:
            raise ValueError("SVG 仅支持静态矢量图形。请移除脚本、动画、外链和嵌入内容。")
        node.tag = prefix + tag
        for key, value in node.attrib.items():
            if motion and key == "data-part":
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,31}", value):
                    raise ValueError("MG 部件 data-part 需使用 1–32 个英文字母、数字、短横线或下划线。")
                continue
            if motion and key in ("fill", "stroke", "stop-color"):
                if value == "none" or LOCAL_PAINT.fullmatch(value) or value in {f"var({token})" for token in motion_asset.THEME_PALETTE}:
                    continue
                raise ValueError("MG 图形颜色必须用指定主题变量。")
            if key not in SVG_ATTRIBUTES or ("(" in value and key in {"fill", "stroke", "clip-path", "mask"}
                                              and not LOCAL_PAINT.fullmatch(value) and not re.fullmatch(r"rgba?\([\d\s.,%]+\)", value)):
                raise ValueError("SVG 包含不支持的属性或外部引用。")
    if motion:
        root.attrib.setdefault("fill", "none")
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
        self.pending_lock = threading.Lock()

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

    def theme(self, asset_id):
        path, item = self.resolve(asset_id, ("theme",))
        definition = validate_theme(
            json.loads(path.read_text(encoding="utf-8")),
            lambda image_id: self.resolve(image_id, ("image",)),
        )
        return definition, item, path

    def theme_items(self, items=None):
        entries = self.items() if items is None else items
        themes = []
        for item in entries:
            if item["kind"] != "theme":
                continue
            definition, _, _ = self.theme(item["id"])
            bg_id = (definition.get("background") or {}).get("assetId")
            themes.append({
                **item,
                "base": definition["base"],
                "vars": definition["vars"],
                "glass": bool(definition.get("glass")),
                **({"fadeColor": definition["fadeColor"]} if "fadeColor" in definition else {}),
                **({"background": {"assetId": bg_id, "url": asset_url(bg_id)}} if bg_id else {}),
            })
        return themes

    def copy_theme(self, payload):
        allowed_fields = {"originId", "name", "backgroundAssetId", "primary"}
        if not isinstance(payload, dict) or payload.keys() - allowed_fields:
            raise ValueError("复制主题只允许修改名称、背景图和主色调。")
        origin_def, origin, _ = self.theme(payload.get("originId"))
        definition = copy.deepcopy(origin_def)
        if "primary" in payload and payload["primary"] is not None:
            if not isinstance(payload["primary"], str):
                raise ValueError("主题主色调格式无效。")
            definition["vars"]["--v-primary"] = payload["primary"].strip()
        if "backgroundAssetId" in payload:
            bg_id = payload["backgroundAssetId"]
            if bg_id in ("", None):
                definition.pop("background", None)
            elif isinstance(bg_id, str):
                definition["background"] = {"assetId": bg_id.strip()}
            else:
                raise ValueError("主题背景图素材 ID 无效。")
        validate_theme(definition, lambda image_id: self.resolve(image_id, ("image",)))
        fields = {"name": payload.get("name"), "tags": ", ".join(origin.get("tags", [])),
                  "license": origin["license"], "credit": origin.get("credit") or f'来源主题：{origin["name"]}'}
        return self.add("theme", json.dumps(definition, ensure_ascii=False).encode("utf-8"),
                        fields, None, "copy", origin=origin)

    def motion(self, asset_id):
        path, item = self.resolve(asset_id, ("lottie", "mg"))
        data = path.read_bytes()
        package = (motion_asset.lottie_package(data, item.get("palette", {})) if item["kind"] == "lottie"
                   else motion_asset.mg_package(data, clean_svg))
        return package, item, path

    def motion_preview_file(self, asset_id, name):
        _, item = self.resolve(asset_id, ("lottie", "mg"))
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

    def pending_folder(self, draft_id):
        if not isinstance(draft_id, str) or not re.fullmatch(r"pending:[a-f0-9-]{36}", draft_id):
            raise ValueError("MG 草稿 ID 无效。")
        return self.root / "pending" / str(uuid.UUID(draft_id.removeprefix("pending:")))

    def pending(self, draft_id):
        directory = self.pending_folder(draft_id)
        file = directory / "record.json"
        if not file.is_file():
            raise ValueError("找不到 MG 草稿。")
        return json.loads(file.read_text(encoding="utf-8"))

    def pending_items(self):
        rows = [json.loads(file.read_text(encoding="utf-8")) for file in
                sorted((self.root / "pending").glob("*/record.json"), key=lambda path: path.stat().st_mtime, reverse=True)]
        return [row for row in rows if row["status"] == "pending"]

    @staticmethod
    def write_pending(directory, record):
        temp = directory / "record.tmp"
        temp.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        temp.replace(directory / "record.json")

    def save_pending(self, draft_id, generated, model, preview_renderer, parent_id=None):
        directory = self.pending_folder(draft_id)
        if (directory / "record.json").is_file():
            return self.pending(draft_id)
        asset = motion_asset.mg_package(json.dumps(generated["spec"], ensure_ascii=False).encode("utf-8"), clean_svg)
        preview_renderer({**asset, "theme": generated["theme"]}, directory)
        record = {key: generated[key] for key in ("name", "useFor", "description", "revision", "theme", "repairCount", "repairReasons")}
        prefix = "/library-pending/" + quote(draft_id, safe="")
        record.update(id=draft_id, kind="mg", status="pending", model=model, duration=asset["duration"],
                      thumbnailUrl=prefix + "/poster.jpg", previewUrl=prefix + "/preview.mp4", parentId=parent_id)
        spec = directory / "motion.json"
        spec.write_text(json.dumps(generated["spec"], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        self.write_pending(directory, record)
        return record

    def pending_preview_file(self, draft_id, name):
        if self.pending(draft_id)["status"] != "pending" or name not in ("poster.jpg", "preview.mp4"):
            raise ValueError("MG 草稿预览不存在。")
        path = self.pending_folder(draft_id) / name
        if not path.is_file():
            raise ValueError("MG 草稿预览不存在。")
        return path

    def decide_pending(self, draft_id, adopt):
        with self.pending_lock:
            directory = self.pending_folder(draft_id)
            record = self.pending(draft_id)
            if record["status"] == "confirmed" and adopt:
                _, item = self.resolve(record["assetId"], ("mg",))
                return item
            if record["status"] == "discarded" and not adopt:
                return None
            if record["status"] != "pending":
                raise ValueError("这份 MG 草稿已处理。")
            item = None
            if adopt:
                raw = (directory / "motion.json").read_bytes()
                motion = motion_asset.mg_package(raw, clean_svg)
                item = next((self.public(row) for row in self._read_user() if row.get("originId") == draft_id), None)
                if item is None:
                    tag_titles = [record["name"], *re.findall(r"[一-鿿]{2,8}", record["description"])[:3]]
                    source = {"name":record["name"], "license":"AI 生成 · 已人工确认", "credit":"希息药事工作台",
                              "tags": ", ".join(dict.fromkeys(tag_titles)), "model":record["model"],
                              "prompt": record["description"] + ("\n" + record["revision"] if record["revision"] else "")}
                    cache_key = hashlib.sha256(draft_id.encode()).hexdigest()
                    preview = self.root / "previews" / cache_key
                    preview.mkdir(parents=True, exist_ok=True)
                    for filename in ("poster.jpg", "preview.mp4"):
                        temp = preview / (filename + ".tmp")
                        temp.write_bytes((directory / filename).read_bytes())
                        temp.replace(preview / filename)
                    item = self.add("mg", raw, source, None, "ai", extra={"originId":draft_id, "useFor":record["useFor"],
                                    "markers":motion["markers"], "previewDigest":cache_key, "palette":{}})
                record.update(status="confirmed", assetId=item["id"])
            else:
                record["status"] = "discarded"
            self.write_pending(directory, record)
            return item

    def upload(self, payload, ffmpeg, preview_renderer=None):
        kind = payload.get("kind")
        if kind not in ("image", "svg", "layout", "theme", "lottie"):
            raise ValueError("请选择图片、SVG、布局、主题或 Lottie JSON。")
        try:
            raw = base64.b64decode(payload["data"], validate=True)
        except (KeyError, TypeError, ValueError, binascii.Error) as error:
            raise ValueError("文件数据无效。") from error
        if kind == "lottie":
            return self.add_motion(kind, raw, payload, preview_renderer, "upload")
        return self.add(kind, raw, payload, ffmpeg, "upload")

    def add(self, kind, data, fields, ffmpeg, source, origin=None, extra=None):
        if not 0 < len(data) <= LIMITS[kind]:
            raise ValueError("文件大小无效。图片上限 8 MB，SVG 上限 300 KB，布局上限 64 KB，主题上限 16 KB。")
        if kind == "svg":
            data, ext = clean_svg(data), ".svg"
        elif kind == "layout":
            try:
                definition = json.loads(data.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("请选择 UTF-8 编码的布局 JSON 文件。") from error
            data = json.dumps(validate_layout(definition), sort_keys=True, separators=(",", ":")).encode("utf-8")
            ext = ".json"
        elif kind == "theme":
            try:
                definition = json.loads(data.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("请选择 UTF-8 编码的主题 JSON 文件。") from error
            validated = validate_theme(definition, lambda image_id: self.resolve(image_id, ("image",)))
            data = json.dumps(validated, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ext = ".json"
        elif kind in ("lottie", "mg"):
            ext = ".json"
        else:
            ext = check_image(data, ffmpeg)
        name = text_field(fields, "name", 80, required=True)
        rights = text_field(fields, "license", 120, required=True)
        credit = text_field(fields, "credit", 200)
        if kind == "layout" and not credit:
            raise ValueError("请填写布局的原始来源或署名。")
        if kind == "theme" and not credit:
            raise ValueError("请填写主题的原始来源或署名。")
        if rights == "CC BY" and not credit:
            raise ValueError("CC BY 素材请填写署名。")
        tags = list(dict.fromkeys(tag.strip() for tag in re.split(r"[,，、]", text_field(fields, "tags", 180)) if tag.strip()))
        metadata = {key: text_field(fields, key, size) for key, size in
                    (("topic", 200), ("prompt", 5000), ("style", 48), ("ratio", 16), ("model", 100))}
        sha = hashlib.sha256(data).hexdigest()
        with self.lock:
            entries = self._read_user()
            for item in entries if kind not in ("layout", "theme", "lottie", "mg") else ():
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
            if kind in ("layout", "theme") and origin:
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
