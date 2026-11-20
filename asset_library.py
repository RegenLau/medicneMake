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
from urllib.parse import quote


SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
SVG_ELEMENTS = frozenset("svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask title desc text tspan".split())
SVG_ATTRIBUTES = frozenset("id viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity fill-opacity stroke-opacity transform gradientTransform gradientUnits spreadMethod offset stop-color stop-opacity clip-path clip-rule clipPathUnits mask maskUnits maskContentUnits preserveAspectRatio font-size font-weight text-anchor dominant-baseline dx dy".split())
LOCAL_PAINT = re.compile(r"url\(#[A-Za-z_][\w.:-]*\)")
USER_ID = re.compile(r"user:[0-9a-f]{32}")
LIMITS = {"image": 8 * 1024 * 1024, "svg": 300 * 1024}


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
        return [self.public(item) for item in (*self._builtins(), *self._read_user()) if not item.get("archived")]

    @staticmethod
    def public(item):
        return {**{key: value for key, value in item.items() if key != "file"}, "url": asset_url(item["id"])}

    def resolve(self, asset_id, kinds=()):
        if not isinstance(asset_id, str):
            raise ValueError("素材 ID 无效。")
        user = USER_ID.fullmatch(asset_id)
        entries = self._read_user() if user else self._builtins()
        item = next((item for item in entries if item["id"] == asset_id), None)
        if not item or (kinds and item["kind"] not in kinds):
            raise ValueError("找不到所选素材，或素材类型不匹配。")
        root = (self.root / "files" if user else self.builtin_root).resolve()
        path = (root / item["file"]).resolve()
        if root not in path.parents or not path.is_file():
            raise ValueError("素材文件不存在。")
        return path, self.public(item)

    def upload(self, payload, ffmpeg):
        kind = payload.get("kind")
        if kind not in LIMITS:
            raise ValueError("请选择图片或 SVG。")
        try:
            raw = base64.b64decode(payload["data"], validate=True)
        except (KeyError, TypeError, ValueError, binascii.Error) as error:
            raise ValueError("文件数据无效。") from error
        return self.add(kind, raw, payload, ffmpeg, "upload")

    def add(self, kind, data, fields, ffmpeg, source):
        if not 0 < len(data) <= LIMITS[kind]:
            raise ValueError("文件过大。图片上限 8 MB，SVG 上限 300 KB。")
        if kind == "svg":
            data, ext = clean_svg(data), ".svg"
        else:
            ext = check_image(data, ffmpeg)
        name = text_field(fields, "name", 80, required=True)
        rights = text_field(fields, "license", 120, required=True)
        credit = text_field(fields, "credit", 200)
        if rights == "CC BY" and not credit:
            raise ValueError("CC BY 素材请填写署名。")
        tags = list(dict.fromkeys(tag.strip() for tag in re.split(r"[,，、]", text_field(fields, "tags", 180)) if tag.strip()))
        metadata = {key: text_field(fields, key, size) for key, size in
                    (("topic", 200), ("prompt", 5000), ("style", 48), ("ratio", 16), ("model", 100))}
        sha = hashlib.sha256(data).hexdigest()
        with self.lock:
            entries = self._read_user()
            for item in entries:
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
