"""希息药事本地工作台。Python 3.10+，仅监听回环地址。"""

import base64
import hashlib
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import uuid
import wave
from html import escape
from http.client import HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen

import draft_content
import asset_library
import svg_motion
import stage_video
import mix_plan
import motion_asset
import mg_generation
import music_gen
import work_costs

ROOT = Path(__file__).resolve().parent
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/vtt", ".vtt")
mimetypes.add_type("audio/flac", ".flac")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/wav", ".wav")
PUBLIC = ROOT / "public"
DATA = ROOT / ".studio"
MEDIA = DATA / "media"
JOBS = DATA / "jobs"
AVATAR_CACHE = DATA / "avatar_cache"
GENERATED_MUSIC_DIR = PUBLIC / "assets" / "music" / "generated"
ASSETS = asset_library.LocalLibrary(DATA / "library", PUBLIC / "assets" / "library")
KEY_STORAGE = "mac-keychain" if sys.platform == "darwin" else "windows-dpapi" if os.name == "nt" else "session"
if sys.platform == "darwin":
    import mac_keychain
for directory in (MEDIA, JOBS, AVATAR_CACHE, GENERATED_MUSIC_DIR):
    directory.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("STUDIO_PORT", "8765"))
ORIGIN = f"http://127.0.0.1:{PORT}"
STAGE_RENDER = os.environ.get("STUDIO_STAGE_RENDER", "1") != "0"
ARK = "https://ark.cn-beijing.volces.com/api/v3"
DEEPSEEK = "https://api.deepseek.com"
DASHSCOPE = "https://dashscope.aliyuncs.com"
AVATAR_MODELS = {
    "videoretalk": ("声动人像 VideoRetalk", "0.08"),
    "wan2.2-s2v": ("万相数字人 Wan2.2-S2V", "0.50"),
}
AVATAR_RESOLUTIONS = ("480P", "720P")
AVATAR_MOTIONS = {
    "calm": "沉稳播报",
    "normal": "自然讲解",
    "active": "活泼表达",
}
VIDEORETALK_MAX_CHUNK_SECONDS = 115.0
WAN_S2V_MAX_CHUNK_SECONDS = 18.0
AVATAR_MAX_CHUNK_SECONDS = VIDEORETALK_MAX_CHUNK_SECONDS
TEXT_MODEL_LABELS = {
    "deepseek-flash": "DeepSeek-V4.1-Flash",
    "deepseek-v4-pro": "DeepSeek-V4-Pro",
    "deepseek-chat": "DeepSeek Chat",
    "deepseek-reasoner": "DeepSeek Reasoner",
}
DEFAULT_TEXT_MODELS = ("deepseek-flash", "deepseek-v4-pro")
TEXT_MODEL = os.environ.get("DEEPSEEK_TEXT_MODEL", "").strip() or "deepseek-flash"
MUSIC_TRACKS = {name: PUBLIC / "assets" / "music" / (name + ".flac") for name in ("calm", "light")}
SPEECH_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
SPEECH_RESOURCE = "seed-tts-2.0"
SPEECH_SAMPLE_RATE = 24000
SPEAKERS = {
    "流畅女声 2.0": "zh_female_liuchangnv_uranus_bigtts",
    "女声": "zh_female_xiaohe_uranus_bigtts",
    "男声": "zh_male_m191_uranus_bigtts",
}
IMAGE_MODELS = {
    "doubao-seedream-5-5-261028": ("Seedream 5.5", ["1K", "2K"]),
    "doubao-seedream-5-0-260128": ("Seedream 5.0 Lite", ["2K", "4K"]),
    "doubao-seedream-4-5-251128": ("Seedream 4.5", ["2K", "4K"]),
}
VIDEO_MODELS = {
    "doubao-seedance-2-5-260628": ("Seedance 2.5", ["480p", "720p", "1080p"], 30),
    "doubao-seedance-2-5-flash-261115": ("Seedance 2.5 Flash", ["480p", "720p"], 30),
    "doubao-seedance-2-0-260128": ("Seedance 2.0", ["480p", "720p", "1080p"], 15),
}
SIZES = {
    "1K": {
        "16:9": "1424x800",
        "9:16": "800x1424",
        "3:4": "864x1152",
        "1:1": "1024x1024",
    },
    "2K": {
        "16:9": "2848x1600",
        "9:16": "1600x2848",
        "3:4": "1728x2304",
        "1:1": "2048x2048",
    },
    "4K": {
        "16:9": "5504x3040",
        "9:16": "3040x5504",
        "3:4": "3520x4704",
        "1:1": "4096x4096",
    },
}
STYLE = [
    "手绘动画风",
    "清新写实风",
    "科技数据风",
    "气泡讲解风",
    "玻璃拟态风",
    "3D质感风",
]
FFMPEG = shutil.which("ffmpeg") or next(
    (
        str(p)
        for p in (ROOT / ".runtime/imageio_ffmpeg/binaries").glob("ffmpeg*")
        if p.is_file()
    ),
    None,
)
CACHE_LOCK = threading.RLock()
ACTIVE = set()
SLOTS = threading.Semaphore(2)
SVG_SPEECH_LOCKS = tuple(threading.Lock() for _ in range(16))
JOB_CREDENTIALS = threading.local()


def protect_windows_key(value, *, decrypt=False):
    # Windows DPAPI binds the saved ciphertext to this Windows user.
    command = (
        "$bytes=[Convert]::FromBase64String($value); "
        "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,$scope))"
        if decrypt
        else "$bytes=[Text.Encoding]::UTF8.GetBytes($value); "
        "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope))"
    )
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; "
            "$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser; "
            "$value=[Console]::In.ReadToEnd(); " + command,
        ],
        input=value,
        text=True,
        capture_output=True,
        timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode or not result.stdout.strip():
        raise OSError("Windows 无法处理加密凭据")
    return result.stdout.strip()


# Only the two fixed account names below are used for credential storage.
credential_warnings = {}


def load_saved_key(account):
    try:
        if KEY_STORAGE == "mac-keychain":
            return mac_keychain.read_password(account)
        if KEY_STORAGE == "windows-dpapi":
            path = DATA / (account + "-key.dpapi")
            if path.is_file():
                return protect_windows_key(path.read_text(encoding="ascii"), decrypt=True)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        credential_warnings[account] = "读取本机凭据失败，请检查系统访问权限，再重启工作台。"
    return ""


def persist_key(account, key):
    try:
        if KEY_STORAGE == "mac-keychain":
            mac_keychain.write_password(account, key)
        elif KEY_STORAGE == "windows-dpapi":
            encrypted = protect_windows_key(key)
            path = DATA / (account + "-key.dpapi")
            tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
            try:
                tmp.write_text(encrypted, encoding="ascii")
                tmp.replace(path)
            finally:
                tmp.unlink(missing_ok=True)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise ValueError("本机安全存储写入失败，请检查系统访问权限后重试。") from None
    credential_warnings.pop(account, None)


PAGE_ARK_KEY = load_saved_key("ark")
PAGE_DEEPSEEK_KEY = load_saved_key("deepseek")
PAGE_SPEECH_KEY = load_saved_key("speech")
PAGE_DASHSCOPE_KEY = load_saved_key("dashscope")
PAGE_MUREKA_KEY = load_saved_key("mureka")
MUREKA_HOST = ""
DEEPSEEK_REMOTE_MODELS = []


def current_ark_key():
    return PAGE_ARK_KEY or os.environ.get("ARK_API_KEY", "").strip()


def current_deepseek_key():
    return PAGE_DEEPSEEK_KEY or os.environ.get("DEEPSEEK_API_KEY", "").strip()


def current_speech_key():
    return PAGE_SPEECH_KEY or os.environ.get("VOLC_SPEECH_API_KEY", "").strip()


def current_dashscope_key():
    return PAGE_DASHSCOPE_KEY or os.environ.get("DASHSCOPE_API_KEY", "").strip()


def current_mureka_key():
    return PAGE_MUREKA_KEY or os.environ.get("MUREKA_API_KEY", "").strip()


def text_models():
    with CACHE_LOCK:
        ids = list(DEEPSEEK_REMOTE_MODELS) if DEEPSEEK_REMOTE_MODELS else list(DEFAULT_TEXT_MODELS)
    if TEXT_MODEL and TEXT_MODEL not in ids:
        ids.insert(0, TEXT_MODEL)
    return {model_id: TEXT_MODEL_LABELS.get(model_id, model_id) for model_id in ids}


def default_text_model():
    models = text_models()
    if TEXT_MODEL in models:
        return TEXT_MODEL
    return next(iter(models))


def deepseek_connection():
    return {
        "deepseekKeyPresent": bool(current_deepseek_key()),
        "deepseekKeySource": "page"
        if PAGE_DEEPSEEK_KEY
        else "environment"
        if current_deepseek_key()
        else "",
        "deepseekKeySaved": bool(PAGE_DEEPSEEK_KEY and KEY_STORAGE != "session"),
        "deepseekKeyWarning": credential_warnings.get("deepseek", ""),
    }


def refresh_deepseek_models(key=None):
    response = deepseek("/models", key=key, timeout=12)
    if not isinstance(response, dict) or not isinstance(response.get("data"), list):
        raise ValueError("DeepSeek 返回的模型列表异常，请稍后重试")
    ids = []
    for item in response["data"]:
        model_id = item.get("id") if isinstance(item, dict) else None
        if isinstance(model_id, str) and model_id.strip() and model_id not in ids:
            ids.append(model_id.strip())
    if ids:
        with CACHE_LOCK:
            DEEPSEEK_REMOTE_MODELS[:] = ids
    return ids


def connect_deepseek(key):
    global PAGE_DEEPSEEK_KEY
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,512}", key.strip()):
        raise ValueError("请输入有效的 DeepSeek API Key")
    key = key.strip()
    refresh_deepseek_models(key=key)
    with CACHE_LOCK:
        persist_key("deepseek", key)
        PAGE_DEEPSEEK_KEY = key
        return {
            **deepseek_connection(),
            "textModels": text_models(),
            "textModel": default_text_model(),
        }


def configure_speech(key):
    global PAGE_SPEECH_KEY
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,512}", key.strip()):
        raise ValueError("请输入有效的豆包语音 API Key")
    with CACHE_LOCK:
        persist_key("speech", key.strip())
        PAGE_SPEECH_KEY = key.strip()
        return speech_connection()


def speech_connection():
    return {
        "speechKeyPresent": bool(current_speech_key()),
        "speechKeySaved": bool(PAGE_SPEECH_KEY and KEY_STORAGE != "session"),
        "speechKeyWarning": credential_warnings.get("speech", ""),
    }


def ark_connection():
    return {
        "keyPresent": bool(current_ark_key()),
        "keySource": "page"
        if PAGE_ARK_KEY
        else "environment"
        if current_ark_key()
        else "",
        "keySaved": bool(PAGE_ARK_KEY and KEY_STORAGE != "session"),
        "keyWarning": credential_warnings.get("ark", ""),
    }


def connect_ark(key):
    global PAGE_ARK_KEY
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,512}", key.strip()):
        raise ValueError("请输入有效的火山方舟 API Key")
    key = key.strip()
    response = ark("/models", key=key, timeout=12)
    if not isinstance(response, dict) or not isinstance(response.get("data"), list):
        raise ValueError("方舟返回的验证结果异常，请稍后重试")
    with CACHE_LOCK:
        persist_key("ark", key)
        PAGE_ARK_KEY = key
        return ark_connection()


def dashscope_connection():
    return {
        "dashscopeKeyPresent": bool(current_dashscope_key()),
        "dashscopeKeySource": "page"
        if PAGE_DASHSCOPE_KEY
        else "environment"
        if current_dashscope_key()
        else "",
        "dashscopeKeySaved": bool(PAGE_DASHSCOPE_KEY and KEY_STORAGE != "session"),
        "dashscopeKeyWarning": credential_warnings.get("dashscope", ""),
    }


def connect_dashscope(key):
    global PAGE_DASHSCOPE_KEY
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,512}", key.strip()):
        raise ValueError("请输入有效的阿里云百炼 API Key")
    key = key.strip()
    policy = dashscope_get_policy("wan2.2-s2v", key=key, timeout=15)
    if not isinstance(policy, dict) or not policy.get("upload_host"):
        raise ValueError("阿里云百炼返回的验证结果异常，请稍后重试")
    with CACHE_LOCK:
        persist_key("dashscope", key)
        PAGE_DASHSCOPE_KEY = key
        return dashscope_connection()


def mureka_connection():
    return {
        "murekaKeyPresent": bool(current_mureka_key()),
        "murekaKeySource": "page"
        if PAGE_MUREKA_KEY
        else "environment"
        if current_mureka_key()
        else "",
        "murekaKeySaved": bool(PAGE_MUREKA_KEY and KEY_STORAGE != "session"),
        "murekaKeyWarning": credential_warnings.get("mureka", ""),
    }


def connect_mureka(key):
    global PAGE_MUREKA_KEY, MUREKA_HOST
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,512}", key.strip()):
        raise ValueError("请输入有效的 Mureka API Key")
    key = key.strip()
    verified_host, _billing = music_gen.verify_mureka_key(key, timeout=15)
    with CACHE_LOCK:
        persist_key("mureka", key)
        PAGE_MUREKA_KEY = key
        MUREKA_HOST = verified_host
        return mureka_connection()


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def ark(path, body=None, *, key=None, timeout=240):
    if key is None:
        key = getattr(JOB_CREDENTIALS, "key", None)
    if key is None:
        key = current_ark_key()
    if not key:
        raise ValueError("请在页面顶部连接火山方舟，再重试生成。")
    request = Request(
        ARK + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if path == "/models":
            message = {
                401: "火山方舟未接受此 Key，请检查是否复制完整或已失效。",
                403: "此 Key 无权查询方舟模型，请检查所属项目与权限。",
            }.get(error.code, f"方舟验证失败（HTTP {error.code}），请稍后重试。")
            raise ValueError(message) from None
        try:
            info = json.load(error).get("error", {})
            message = str(info.get("message") or info.get("code") or "")
        except (ValueError, AttributeError):
            message = ""
        raise ValueError(
            f"方舟返回 {error.code}。{message.replace(key, '[已隐藏]')[:450]}"
        ) from None
    except (URLError, TimeoutError):
        if path == "/models":
            raise ValueError("暂时连不上火山方舟，请检查网络后重试。") from None
        raise


def deepseek(path, body=None, *, key=None, timeout=120):
    if key is None:
        key = getattr(JOB_CREDENTIALS, "deepseek_key", None)
    if key is None:
        key = current_deepseek_key()
    if not key:
        raise ValueError("请在页面顶部连接 DeepSeek，再重试生成。")
    request = Request(
        DEEPSEEK + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if path == "/models":
            message = {
                401: "DeepSeek 未接受此 Key，请检查是否复制完整或已失效。",
                402: "DeepSeek 账户余额不足，请先充值后再试。",
                403: "此 Key 无权查询 DeepSeek 模型列表，请检查权限。",
            }.get(error.code, f"DeepSeek 验证失败（HTTP {error.code}），请稍后重试。")
            raise ValueError(message) from None
        try:
            info = json.load(error).get("error", {})
            message = str(info.get("message") or info.get("code") or "")
        except (ValueError, AttributeError):
            message = ""
        if error.code == 402:
            raise ValueError("DeepSeek 账户余额不足，请充值后重试。") from None
        raise ValueError(
            f"DeepSeek 返回 {error.code}。{message.replace(key, '[已隐藏]')[:450]}"
        ) from None
    except (URLError, TimeoutError):
        if path == "/models":
            raise ValueError("暂时连不上 DeepSeek，请检查网络后重试。") from None
        raise


def dashscope_json(path, body=None, *, key=None, extra_headers=None, timeout=120):
    if key is None:
        key = getattr(JOB_CREDENTIALS, "dashscope_key", None)
    if key is None:
        key = current_dashscope_key()
    if not key:
        raise ValueError("请先在「模型配置 → 数字人服务」填写阿里云百炼 API Key。")
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    request = Request(
        DASHSCOPE + path,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None,
        headers=headers,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        is_verify = path.startswith("/api/v1/uploads?")
        try:
            raw_err = error.read().decode("utf-8", "replace")
            info = json.loads(raw_err)
            if isinstance(info, dict):
                nested = info.get("error") if isinstance(info.get("error"), dict) else {}
                message = str(info.get("message") or nested.get("message") or info.get("code") or "")
            else:
                message = ""
        except (ValueError, AttributeError):
            message = ""
        if error.code in (401, 403):
            hint = "阿里云百炼未接受此 Key，请检查是否复制完整、是否已开通百炼（华北2北京地域）或已失效。"
            raise ValueError(hint) from None
        if error.code == 429:
            raise ValueError(
                "阿里云百炼当前并发或配额受限（HTTP 429），请稍后继续此任务重试。"
                + (f" {message.replace(key, '[已隐藏]')[:200]}" if message else "")
            ) from None
        if is_verify:
            raise ValueError(
                f"阿里云百炼验证失败（HTTP {error.code}）。{message.replace(key, '[已隐藏]')[:300]}"
            ) from None
        raise ValueError(
            f"阿里云百炼返回 {error.code}。{message.replace(key, '[已隐藏]')[:450]}"
        ) from None
    except (URLError, TimeoutError, HTTPException):
        if path.startswith("/api/v1/uploads?"):
            raise ValueError("暂时连不上阿里云百炼，请检查网络后重试。") from None
        raise ValueError("阿里云百炼连接中断，请检查网络后继续此任务。") from None


def dashscope_get_policy(model, *, key=None, timeout=20):
    query = urlencode({"action": "getPolicy", "model": model})
    response = dashscope_json(f"/api/v1/uploads?{query}", key=key, timeout=timeout)
    data = response.get("data") if isinstance(response, dict) else None
    if not isinstance(data, dict) or not data.get("upload_host") or not data.get("upload_dir"):
        raise ValueError("阿里云百炼未返回有效的临时上传凭证，请稍后重试。")
    return data


def dashscope_upload_file(file_path, model, *, key=None, timeout=120):
    policy = dashscope_get_policy(model, key=key, timeout=20)
    upload_host = str(policy["upload_host"])
    upload_dir = str(policy["upload_dir"]).strip("/")
    ext = file_path.suffix.lower() or ".bin"
    safe_name = f"{uuid.uuid4().hex}{ext}"
    object_key = f"{upload_dir}/{safe_name}" if upload_dir else safe_name
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    boundary = "----XiXiDashScope" + uuid.uuid4().hex
    parts = []
    fields = [
        ("OSSAccessKeyId", policy.get("oss_access_key_id", "")),
        ("Signature", policy.get("signature", "")),
        ("policy", policy.get("policy", "")),
    ]
    if policy.get("x_oss_object_acl") is not None:
        fields.append(("x-oss-object-acl", str(policy["x_oss_object_acl"])))
    if policy.get("x_oss_forbid_overwrite") is not None:
        fields.append(("x-oss-forbid-overwrite", str(policy["x_oss_forbid_overwrite"])))
    fields.append(("key", object_key))
    fields.append(("success_action_status", "200"))
    for name, value in fields:
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode("utf-8")
    )
    parts.append(file_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    payload = b"".join(parts)
    request = Request(
        upload_host,
        data=payload,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(payload)),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status not in (200, 204):
                raise ValueError(f"上传素材到阿里云百炼临时空间失败（HTTP {response.status}）。")
    except HTTPError as error:
        try:
            detail = error.read().decode("utf-8", "replace")[:260]
        except OSError:
            detail = ""
        raise ValueError(f"上传素材到阿里云百炼临时空间失败（HTTP {error.code}）。{detail}") from None
    except (URLError, TimeoutError, HTTPException):
        raise ValueError("上传素材到阿里云百炼临时空间中断，请检查网络后重试。") from None
    return f"oss://{object_key}"


def dashscope_detect_face(image_path, key):
    img_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
    AVATAR_CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = AVATAR_CACHE / f"detect-wan22-{img_hash}.json"
    if cache_file.is_file():
        try:
            cached = read_json(cache_file)
            if cached.get("check_pass") is True:
                return cached
        except (OSError, ValueError):
            pass
    oss_img = dashscope_upload_file(image_path, "wan2.2-s2v-detect", key=key)
    response = dashscope_json(
        "/api/v1/services/aigc/image2video/face-detect",
        {"model": "wan2.2-s2v-detect", "input": {"image_url": oss_img}},
        key=key,
        extra_headers={"X-DashScope-OssResourceResolve": "enable"},
        timeout=60,
    )
    output = response.get("output") if isinstance(response, dict) else None
    if not isinstance(output, dict):
        raise ValueError("阿里云百炼人脸检测返回异常，请稍后重试。")
    if output.get("check_pass") is not True:
        reason = str(output.get("message") or "").strip()
        extra = f"（{reason[:180]}）" if reason else ""
        raise ValueError(
            "人物肖像未通过阿里云百炼人脸检测，请更换正面清晰、五官无遮挡的半身图" + extra + "。"
        )
    write_json(cache_file, {"check_pass": True})
    return output


def build_avatar_base_video(image_path, target_mp4, duration=3.0):
    if target_mp4.is_file() and target_mp4.stat().st_size > 1024:
        return target_mp4
    target_mp4.parent.mkdir(parents=True, exist_ok=True)
    frames = max(48, round(float(duration) * 24))
    temp = target_mp4.with_suffix(".tmp.mp4")
    try:
        run_ffmpeg(
            "-i",
            image_path,
            "-vf",
            f"scale=1280:1280:force_original_aspect_ratio=increase,"
            f"crop=1280:1280:(iw-ow)/2:min(ih-oh\\,(ih-oh)*0.2),"
            f"zoompan=z='1+0.01*sin(PI*on/{frames})':d={frames}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=640x640:fps=24,"
            f"setsar=1",
            "-t",
            f"{float(duration):.2f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            18,
            "-pix_fmt",
            "yuv420p",
            "-an",
            temp,
        )
        temp.replace(target_mp4)
    finally:
        temp.unlink(missing_ok=True)
    return target_mp4


def dashscope_avatar_clip(
    model,
    source_path,
    audio_path,
    params,
    dest,
    key,
    state,
    save,
    *,
    job=None,
    label="",
    presenter="digital",
    on_success=None,
):
    if not state.get("remote"):
        if state.get("submitting"):
            raise ValueError("上一次数字人任务提交结果未知，请先到阿里云百炼控制台确认任务，以免重复计费。")
        if job is not None:
            job["progress"] = f"上传人物素材与配音至阿里云百炼{label}"
            save()
        oss_src = dashscope_upload_file(source_path, model, key=key)
        oss_audio = dashscope_upload_file(audio_path, model, key=key)
        input_payload = (
            {"video_url": oss_src, "audio_url": oss_audio}
            if model == "videoretalk"
            else {"image_url": oss_src, "audio_url": oss_audio}
        )
        state["submitting"] = True
        save()
        try:
            response = dashscope_json(
                "/api/v1/services/aigc/image2video/video-synthesis",
                {
                    "model": model,
                    "input": input_payload,
                    "parameters": params,
                },
                key=key,
                extra_headers={
                    "X-DashScope-Async": "enable",
                    "X-DashScope-OssResourceResolve": "enable",
                },
                timeout=90,
            )
        except ValueError:
            state.pop("submitting", None)
            save()
            raise
        output = response.get("output") if isinstance(response, dict) else None
        task_id = output.get("task_id") if isinstance(output, dict) else None
        if not task_id:
            state.pop("submitting", None)
            save()
            raise ValueError("阿里云百炼未返回数字人任务 ID，请稍后重试。")
        state["remote"] = task_id
        save()
    task_id = state["remote"]
    status_labels = {"PENDING": "排队中", "RUNNING": "生成中"}
    model_name = AVATAR_MODELS.get(model, (model,))[0]
    for _ in range(360):
        response = dashscope_json(f"/api/v1/tasks/{task_id}", key=key, timeout=60)
        output = response.get("output") if isinstance(response, dict) else None
        status = str((output or {}).get("task_status") or "").upper()
        if status == "SUCCEEDED":
            results = output.get("results") if isinstance(output.get("results"), dict) else {}
            video_url = results.get("video_url") or output.get("video_url")
            if not video_url:
                raise ValueError("阿里云百炼任务已完成，但未返回视频下载地址。")
            if on_success:
                on_success(response)
            temp = dest.with_suffix(".tmp.mp4")
            try:
                with urlopen(video_url, timeout=180) as remote, temp.open("wb") as local:
                    shutil.copyfileobj(remote, local)
                temp.replace(dest)
            finally:
                temp.unlink(missing_ok=True)
            return
        if status in ("FAILED", "CANCELED", "UNKNOWN"):
            state.clear()
            save()
            detail = str((output or {}).get("message") or (output or {}).get("code") or status)
            hint = ""
            if model == "videoretalk" and presenter == "cartoon":
                hint = "（提示：声动人像主要面向写实人像，卡通形象请在「模型配置 → 数字人服务」切换为「万相数字人 Wan2.2-S2V」后重试）"
            raise ValueError(f"阿里云百炼数字人生成未完成：{detail[:400]}{hint}")
        if job is not None:
            job["progress"] = f"阿里云百炼 {model_name} 正在生成对口型视频{label}（{status_labels.get(status, '处理中')}…）"
            save()
        time.sleep(4)
    raise ValueError("数字人视频仍在阿里云百炼队列中，可稍后继续本任务查询结果。")


def media_path(url):
    if not isinstance(url, str):
        raise ValueError("缺少分镜图")
    if re.fullmatch(r"/media/(?:bgm-)?[a-f0-9-]+\.(jpg|png|webp|mp4|vtt|flac|mp3|wav)", url):
        path = MEDIA / url.split("/")[-1]
    elif re.fullmatch(r"/assets/style-[0-5]\.webp", url):
        path = PUBLIC / url.lstrip("/")
    elif re.fullmatch(r"/assets/template-[a-z0-9-]+\.(jpg|png|webp)", url):
        path = PUBLIC / url.lstrip("/")
    elif url.startswith("/library/"):
        path, _ = ASSETS.resolve(unquote(url.removeprefix("/library/")), ("image",))
    else:
        raise ValueError("请选择本作品的本地素材")
    if not path.is_file():
        raise ValueError("缺少本地素材，请重新生成该图")
    return path


def run_ffmpeg(*args):
    if not FFMPEG:
        raise ValueError("未找到 FFmpeg，请按使用说明安装项目内的视频依赖。")
    result = subprocess.run(
        [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            *map(str, args),
        ],
        capture_output=True,
        timeout=900,
    )
    if result.returncode:
        raise ValueError(
            "本地视频合成失败：" + result.stderr.decode("utf-8", "replace")[-420:]
        )


def save_uploaded_frame(p):
    data_url = p.get("dataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        raise ValueError("请提供有效的图片数据。")
    match = re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)", data_url)
    if not match:
        raise ValueError("仅支持 PNG、JPEG 或 WebP 图片。")
    raw = base64.b64decode(match[2], validate=True)
    if not 0 < len(raw) <= 6_000_000:
        raise ValueError("图片大小超出限制。")
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        ext = ".png"
    elif raw.startswith(b"\xff\xd8\xff"):
        ext = ".jpg"
    elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        ext = ".webp"
    else:
        raise ValueError("图片内容格式无法识别。")
    digest = hashlib.sha256(raw).hexdigest()[:32]
    target = MEDIA / f"{digest}{ext}"
    if not target.is_file():
        temp = target.with_suffix(".tmp")
        temp.write_bytes(raw)
        temp.replace(target)
    return {"url": f"/media/{target.name}"}


def validate_video_music_settings(s):
    music_path(s.get("music", "off"))


CODE_MOTION_FPS = 25


def code_motion_ready():
    return bool(FFMPEG and shutil.which("node") and (ROOT / "node_modules/playwright/package.json").is_file())


def validate_template_avatar(avatar, voiced, *, check_key=True):
    model = avatar.get("model") or "videoretalk"
    if model == "liveportrait":
        raise ValueError("阿里云百炼已于 2026-10-10 下线 liveportrait，请返回分镜编辑重新点击合成（将自动改用在线数字人模型）。")
    if model not in AVATAR_MODELS:
        raise ValueError("未知数字人模型")
    if avatar.get("resolution") and avatar["resolution"] not in AVATAR_RESOLUTIONS:
        raise ValueError("数字人清晰度无效")
    if avatar.get("motion") and avatar["motion"] not in AVATAR_MOTIONS:
        raise ValueError("未知数字人动作风格")
    if (avatar.get("presenter") or "digital") not in ("digital", "cartoon"):
        raise ValueError("未知数字人形象类型")
    if media_path(avatar.get("image", "")).suffix not in (".jpg", ".png", ".webp"):
        raise ValueError("数字人形象必须是图片素材。")
    if voiced and check_key and not current_dashscope_key():
        raise ValueError("请先在「模型配置 → 数字人服务」填写阿里云百炼 API Key，再合成动态对口型视频。")


def code_motion_appearance(p):
    appearance = p.get("appearance", {})
    if not isinstance(appearance, dict):
        raise ValueError("信息图模板外观格式无效。")
    theme = appearance.get("theme", "medical")
    presenter = appearance.get("presenter", "digital")
    profile = appearance.get("pharmacist", {})
    if theme not in ("medical", "warm") or presenter not in ("digital", "cartoon", "none") or not isinstance(profile, dict):
        raise ValueError("信息图模板风格或主讲人无效。")
    profile = {
        key: draft_content.string_field(profile, key, limit, optional=True)
        for key, limit in (("name", 16), ("role", 16), ("hospital", 24), ("avatarImage", 140))
        if key in profile
    }
    if presenter == "digital" and profile.get("avatarImage") and media_path(profile["avatarImage"]).suffix not in (".jpg", ".png", ".webp"):
        raise ValueError("主讲人肖像必须是图片素材。")
    return {"theme": theme, "presenter": presenter, "pharmacist": profile}


def validate_motion_template(p):
    info = p["templateInfo"]
    items = p.get("items")
    if not isinstance(info, dict) or not isinstance(items, list) or not 1 <= len(items) <= 12:
        raise ValueError("信息图模板需要 1–12 页分镜。")
    draft_content.string_field(p, "title", 40)
    draft_content.string_field(info, "shortTitle", 20)
    draft_content.string_field(info, "disclaimer", 60, optional=True)
    chapters = info.get("chapters")
    if (not isinstance(chapters, list) or not 2 <= len(chapters) <= 5
            or any(not isinstance(text, str) or len(text) > 10 for text in chapters)):
        raise ValueError("信息图模板章节格式无效。")
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("visual"), dict):
            raise ValueError("信息图分镜格式无效。")
        motion_style = item["visual"].get("motionStyle")
        if motion_style is not None and motion_style != "auto" and motion_style not in draft_content.CODE_MOTION_MOTIONS:
            raise ValueError("信息图动效方式无效。")
        draft_content.string_field(item, "line", 450)
        seconds = item.get("seconds")
        if type(seconds) not in (int, float) or not 2 <= seconds <= 60:
            raise ValueError("单页时长应在 2–60 秒之间。")
        cues = item.get("cues")
        if not isinstance(cues, list) or not 1 <= len(cues) <= 24:
            raise ValueError("每页字幕节拍数应在 1–24 之间。")
        for cue in cues:
            if not isinstance(cue, dict) or type(cue.get("weight")) not in (int, float) or not 0 < cue["weight"] <= 500:
                raise ValueError("字幕节拍格式无效。")
            draft_content.string_field(cue, "text", 180)


def code_motion_payload_script(p):
    raw = {"title": p.get("title"), "scenes": p.get("items")}
    for key in ("shortTitle", "chapters", "disclaimer"):
        if key in p and p[key] is not None:
            raw[key] = p[key]
    script = draft_content.code_motion_script(raw)
    for scene, item in zip(script["scenes"], p["items"]):
        for key, kinds in (("libraryArtId", ("image", "svg")), ("sfxId", ("sfx",))):
            if key in item:
                ASSETS.resolve(item[key], kinds)
                scene[key] = item[key]
    return script


def code_motion_shot_captions(scene, start, audible):
    beats = scene.get("beats") or []
    if beats:
        entries = []
        for beat_idx, beat in enumerate(beats):
            text = str(beat.get("line") or "").strip()
            if not text:
                continue
            chunks = list(_caption_chunk_entries(text, 22))
            focus = str(beat.get("focus") or "all")
            hl = beat.get("highlightWords") or []
            for chunk, raw in chunks:
                weight = sum(0.35 if unicodedata.category(c).startswith("P") else 1 for c in raw if not c.isspace())
                entries.append({
                    "text": chunk,
                    "weight": max(1.0, weight),
                    "focus": focus,
                    "beatIndex": beat_idx,
                    "highlightWords": hl,
                })
        if entries:
            total = sum(entry["weight"] for entry in entries)
            elapsed = 0.0
            cues = []
            for entry in entries:
                begin = start + audible * elapsed / total
                elapsed += entry["weight"]
                end = start + audible * elapsed / total
                cues.append({
                    "start": begin,
                    "end": end,
                    "text": entry["text"],
                    "focus": entry["focus"],
                    "beatIndex": entry["beatIndex"],
                    "highlightWords": entry["highlightWords"],
                })
            return cues
    return list(shot_caption_intervals(scene["line"].strip(), start, audible, "16:9"))


def setting_valid(p):
    if p.get("mode") != "ark" or p.get("kind") not in ("images", "video", "draft", "svg-speech", "mg-draft"):
        raise ValueError("未知的生成方式")
    if p["kind"] == "mg-draft":
        if not current_deepseek_key():
            raise ValueError("请先连接 DeepSeek，再制作 MG 动画。")
        model = p["settings"].get("textModel") or default_text_model()
        if model not in text_models():
            raise ValueError("请选择有效的 DeepSeek 文本模型。")
        description, _, _ = mg_generation.validate_request(p.get("mg"))
        parent_id = p["mg"].get("parentId")
        if parent_id:
            parent = ASSETS.pending(parent_id)
            if parent["status"] != "pending" or description != parent["description"]:
                raise ValueError("请从仍待确认的原草稿重新生成。")
        if not code_motion_ready():
            raise ValueError("制作 MG 预览需要 Node.js、Chrome、Playwright 和 FFmpeg。")
        return
    if p["kind"] == "draft":
        if not current_deepseek_key():
            raise ValueError("请先连接 DeepSeek，再生成自定义内容。")
        selected_text_model = p["settings"].get("textModel") or default_text_model()
        if selected_text_model not in text_models():
            raise ValueError("请选择有效的 DeepSeek 文本模型。")
        draft_content.validate_request(p["draft"], p["settings"], VIDEO_MODELS)
        if p["draft"].get("videoMode") == "stage":
            mix_plan.validate_setup(p["draft"], ASSETS)
        return
    if p["kind"] == "video" and p.get("stage") is True:
        validate_stage_video(p)
        return
    if p["kind"] == "video" and p.get("codeMotion") is True:
        settings = p.get("settings")
        if not isinstance(settings, dict) or settings.get("voice") not in (*SPEAKERS, "无配音"):
            raise ValueError("未知配音")
        if settings.get("ratio") != "16:9":
            raise ValueError("代码动效模板固定输出 16:9。")
        if "templateInfo" in p:
            validate_motion_template(p)
        else:
            code_motion_payload_script(p)
            if "fontId" in settings:
                ASSETS.resolve(settings["fontId"], ("font",))
        appearance = code_motion_appearance(p)
        if not code_motion_ready():
            raise ValueError("代码动效需要 Node.js、Playwright 和 FFmpeg。请按使用说明安装。")
        if settings["voice"] in SPEAKERS and not current_speech_key() and not has_template_speech(p):
            raise ValueError("请先配置火山语音，再合成带配音的代码动效。")
        if p.get("avatar") is not None:
            avatar = p["avatar"]
            if (not isinstance(avatar, dict) or avatar.get("enabled") is not True
                    or settings["voice"] not in SPEAKERS or appearance["presenter"] == "none"
                    or avatar.get("presenter") != appearance["presenter"]):
                raise ValueError("数字人参数与信息图模板主讲人不匹配。")
            validate_template_avatar(avatar, True, check_key=not p.get("previousVideo"))
        validate_video_music_settings(settings)
        return
    if p["kind"] == "svg-speech" or (p["kind"] == "video" and p.get("svg") is True):
        settings = p.get("settings")
        if not isinstance(settings, dict) or settings.get("voice") not in (*SPEAKERS, "无配音"):
            raise ValueError("未知配音")
        try:
            uuid.UUID(p.get("workId", ""))
        except (AttributeError, TypeError, ValueError):
            raise ValueError("SVG 作品 ID 无效") from None
        items = p.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 12:
            raise ValueError("SVG 视频需要 1–12 幕分镜")
        for item in items:
            svg_motion.validate_shot(item)
        if settings["voice"] in SPEAKERS and not current_speech_key():
            raise ValueError("请先配置火山语音，再使用 SVG 口播。")
        if p["kind"] == "svg-speech":
            index = items[0].get("index")
            if len(items) != 1 or type(index) is not int or not 0 <= index < 12 or settings["voice"] not in SPEAKERS:
                raise ValueError("逐幕试听需要一幕分镜和配音音色。")
            return
        draft_content.string_field(p, "title", 300)
        svg_template_layout(p)
        if not svg_motion.ready(FFMPEG):
            raise ValueError("SVG 导出需要 Chrome、Node.js 和 FFmpeg。详见使用说明。")
        validate_video_music_settings(settings)
        return
    if p["kind"] == "video" and p.get("template") is True:
        s = p["settings"]
        if s.get("voice") != "无配音" and s.get("voice") not in SPEAKERS:
            raise ValueError("未知配音")
        validate_video_music_settings(s)
        items = p.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 12:
            raise ValueError("模板页数应在 1–12 之间")
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("模板页数据无效")
            if type(item.get("seconds")) not in (int, float) or not 2 <= float(item["seconds"]) <= 60:
                raise ValueError("单页时长应在 2–60 秒之间")
            if not isinstance(item.get("line", ""), str) or len(item.get("line", "")) > 450:
                raise ValueError("每页口播最多 450 字")
            if "tailPause" in item and (
                type(item.get("tailPause")) not in (int, float) or not 0.2 <= float(item["tailPause"]) <= 3.0
            ):
                raise ValueError("单页收尾停顿应在 0.2–3.0 秒之间")
            cues = item.get("cues")
            if not isinstance(cues, list) or not 1 <= len(cues) <= 24:
                raise ValueError("每页渲染帧数应在 1–24 之间")
            for cue in cues:
                if not isinstance(cue, dict):
                    raise ValueError("渲染帧数据无效")
                media_path(cue.get("image", ""))
                if type(cue.get("weight", 1)) not in (int, float) or float(cue.get("weight", 1)) <= 0:
                    raise ValueError("字幕权重无效")
                if "transition" in cue and cue["transition"] not in ("cut", "fade", "outro"):
                    raise ValueError("渲染帧转场类型无效")
                if "holdSeconds" in cue and (
                    type(cue["holdSeconds"]) not in (int, float) or not 0 <= float(cue["holdSeconds"]) <= 5.0
                ):
                    raise ValueError("静止停留时长应在 0–5 秒之间")
        voiced = s.get("voice") in SPEAKERS and any(item.get("line", "").strip() for item in items)
        if voiced and not current_speech_key() and not has_template_speech(p):
            raise ValueError("请先配置火山语音，再继续合成带配音的模板视频。")
        avatar = p.get("avatar")
        if avatar is not None:
            if not isinstance(avatar, dict):
                raise ValueError("数字人参数无效")
            if avatar.get("enabled") is True:
                validate_template_avatar(avatar, voiced, check_key=not p.get("previousVideo"))
                rect = avatar.get("rect")
                if rect is not None:
                    if not isinstance(rect, dict):
                        raise ValueError("数字人圆框坐标无效")
                    for key_name in ("x", "y", "size"):
                        if type(rect.get(key_name)) not in (int, float):
                            raise ValueError("数字人圆框坐标无效")
                    if not (0 <= float(rect["x"]) <= 1280 and 0 <= float(rect["y"]) <= 720 and 24 <= float(rect["size"]) <= 720):
                        raise ValueError("数字人圆框尺寸超出画面范围")
                has_cue_rect = False
                for item in items:
                    for cue in item["cues"]:
                        crect = cue.get("avatarRect")
                        if crect is None:
                            continue
                        if not isinstance(crect, dict):
                            raise ValueError("分镜数字人圆框坐标无效")
                        for key_name in ("x", "y", "size"):
                            if type(crect.get(key_name)) not in (int, float):
                                raise ValueError("分镜数字人圆框坐标无效")
                        if not (0 <= float(crect["x"]) <= 1280 and 0 <= float(crect["y"]) <= 720 and 24 <= float(crect["size"]) <= 720):
                            raise ValueError("分镜数字人圆框尺寸超出画面范围")
                        has_cue_rect = True
                if rect is None and not has_cue_rect:
                    raise ValueError("缺少数字人圆框坐标")
        return
    if not current_ark_key():
        raise ValueError("请先连接火山方舟")
    s = p["settings"]
    if (
        s["imageModel"] not in IMAGE_MODELS
        or s["imageSize"] not in IMAGE_MODELS[s["imageModel"]][1]
    ):
        raise ValueError("图片模型或清晰度无效")
    if s["ratio"] not in SIZES["2K"] or not isinstance(s["watermark"], bool):
        raise ValueError("画幅或水印参数无效")
    if (
        s["videoModel"] not in VIDEO_MODELS
        or s["resolution"] not in VIDEO_MODELS[s["videoModel"]][1]
    ):
        raise ValueError("视频模型或分辨率无效")
    if s["voice"] != "无配音" and s["voice"] not in SPEAKERS:
        raise ValueError("未知配音")
    if p["kind"] == "video":
        validate_video_music_settings(s)
    items = p["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 12:
        raise ValueError("素材数量应在 1–12 之间")
    for item in items:
        if (
            not isinstance(item.get("prompt"), str)
            or not 1 <= len(item["prompt"].strip()) <= 2200
        ):
            raise ValueError("请填写画面提示词，最多 2200 字")
        if p["kind"] == "images" and p.get("styleReference") is True and "reference" in item:
            reference = media_path(item["reference"])
            if reference.suffix not in (".jpg", ".png", ".webp"):
                raise ValueError("配图参考素材必须是图片。")
        if p["kind"] == "video":
            if (
                type(item["seconds"]) is not int
                or not 4 <= item["seconds"] <= VIDEO_MODELS[s["videoModel"]][2]
            ):
                raise ValueError("单镜时长超出当前模型范围")
            if not isinstance(item["line"], str) or len(item["line"]) > 450:
                raise ValueError("每幕口播最多 450 字")
            media_path(item["image"])
    if (
        p["kind"] == "video"
        and s["voice"] in SPEAKERS
        and any(item["line"].strip() for item in items)
        and not current_speech_key()
    ):
        raise ValueError("请先配置火山语音，再继续生成视频。")
    if type(p.get("style")) is not int or not 0 <= p["style"] < len(STYLE):
        raise ValueError("未知画面风格")


def image_references(p, item):
    if p.get("styleReference") is not True:
        return []
    references = [] if p.get("storyboard") is True else [f"/assets/style-{p['style']}.webp"]
    if item.get("reference") and item["reference"] not in references:
        references.append(item["reference"])
    return references


def image_item(p, item, index, record=None):
    s = p["settings"]
    size = SIZES[s["imageSize"]][s["ratio"]]
    body = {
        "model": s["imageModel"],
        "prompt": item["prompt"],
        "size": size,
        "response_format": "b64_json",
        "watermark": s["watermark"],
    }
    references = image_references(p, item)
    if references:
        images = [image_data_url(media_path(ref)) for ref in references]
        body["image"] = images if len(images) > 1 else images[0]
    if s["imageModel"] != "doubao-seedream-5-5-261028":
        body["sequential_image_generation"] = "disabled"
    data = ark("/images/generations", body)
    row = (data.get("data") or [{}])[0]
    if not row.get("b64_json"):
        raise ValueError(str(row.get("error", {}).get("message", "方舟未返回图片")))
    if record:
        actual_size = row.get("size")
        if not isinstance(actual_size, str) or not re.fullmatch(r"[0-9]{1,5}x[0-9]{1,5}", actual_size):
            actual_size = size
        record(f"image:{index}:{uuid.uuid4()}", work_costs.image_cost(s["imageModel"], actual_size, len(references), index))
    raw = base64.b64decode(row["b64_json"])
    ext = ".png" if raw.startswith(b"\x89PNG") else ".jpg"
    path = MEDIA / (uuid.uuid4().hex + ext)
    path.write_bytes(raw)
    return "/media/" + path.name


def image_data_url(path):
    media_type = mimetypes.guess_type(path.name)[0]
    if media_type not in ("image/jpeg", "image/png", "image/webp"):
        raise ValueError("配图参考素材必须是图片。")
    return f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def seedance_frame(image, role, folder, width, height):
    frame = folder / (role + ".jpg")
    run_ffmpeg(
        "-i", media_path(image), "-vf",
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1",
        "-frames:v", 1, "-q:v", 2, frame,
    )
    raw = base64.b64encode(frame.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{raw}"}, "role": role}


def source_clip(p, item, dest, state, save, tail_image=None, on_success=None):
    s = p["settings"]
    if not state.get("remote"):
        if state.get("submitting"):
            raise ValueError(
                "上一次提交结果未知。请先到方舟控制台确认任务，以免重复计费。"
            )
        # 首帧决定方舟视频的画幅。重新选画幅时，先把现有分镜裁成目标尺寸。
        width, height = frame_size(s)
        content = [
            {"type": "text", "text": item["prompt"]},
            seedance_frame(item["image"], "first_frame", dest.parent, width, height),
        ]
        if tail_image:
            content.append(seedance_frame(tail_image, "last_frame", dest.parent, width, height))
        state["submitting"] = True
        save()
        try:
            response = ark(
                "/contents/generations/tasks",
                {
                    "model": s["videoModel"],
                    "content": content,
                    "ratio": "adaptive",
                    "duration": item["seconds"],
                    "resolution": s["resolution"],
                    "generate_audio": False,
                    "watermark": s["watermark"],
                },
            )
        except ValueError:
            state.pop("submitting", None)
            save()
            raise
        state["remote"] = response["id"]
        save()
    for _ in range(720):
        response = ark("/contents/generations/tasks/" + state["remote"])
        if response["status"] == "succeeded":
            if on_success:
                on_success(response)
            with (
                urlopen(response["content"]["video_url"], timeout=180) as remote,
                dest.open("wb") as local,
            ):
                shutil.copyfileobj(remote, local)
            return
        if response["status"] in ("failed", "cancelled", "expired"):
            state.clear()
            save()
            raise ValueError(
                "方舟视频任务未完成："
                + str(response.get("error") or response["status"])[:450]
            )
        time.sleep(5)
    raise ValueError("视频仍在方舟队列中，可稍后继续查询本任务。")


def frame_size(s):
    short = int(s["resolution"][:-1])
    a, b = map(int, s["ratio"].split(":"))
    return tuple(round(short * x / min(a, b) / 2) * 2 for x in (a, b))


def narrate(line, speaker, target, key):
    body = {
        "user": {"uid": "xixi-studio"},
        "req_params": {
            "text": line,
            "speaker": speaker,
            "audio_params": {"format": "pcm", "sample_rate": SPEECH_SAMPLE_RATE},
        },
    }
    request = Request(
        SPEECH_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Api-Resource-Id": SPEECH_RESOURCE,
            "X-Api-Request-Id": str(uuid.uuid4()),
            "X-Control-Require-Usage-Tokens-Return": "text_words",
        },
    )
    request.add_unredirected_header("X-Api-Key", key)
    audio = bytearray()
    try:
        with urlopen(request, timeout=90) as response:
            for packet in response:
                if not packet.strip():
                    continue
                try:
                    chunk = json.loads(packet)
                    code = chunk["code"]
                    if type(code) is not int:
                        raise ValueError
                    if code == 0 and chunk.get("data"):
                        audio.extend(base64.b64decode(chunk["data"], validate=True))
                except (ValueError, TypeError, KeyError):
                    raise ValueError("火山语音返回了无法读取的音频数据。") from None
                if code == 20000000:
                    characters = work_costs.usage_value(chunk.get("usage"), "text_words")
                    break
                if code != 0:
                    raise ValueError(f"火山语音合成失败（{code}），请检查服务权限或额度。")
            else:
                raise ValueError("火山语音返回中断，请继续此任务重试配音。")
    except HTTPError as error:
        if error.code in (401, 403):
            raise ValueError("火山语音鉴权失败，请检查豆包语音 API Key 和语音合成 2.0 权限。") from None
        raise ValueError(f"火山语音请求失败（HTTP {error.code}）。") from None
    except (URLError, TimeoutError, HTTPException):
        raise ValueError("火山语音连接中断，请检查网络后继续此任务。") from None

    if not audio or len(audio) % 2:
        raise ValueError("火山语音未返回完整配音，请继续此任务重试。")
    temp = target.with_suffix(".tmp")
    with wave.open(str(temp), "wb") as wav:
        wav.setparams((1, 2, SPEECH_SAMPLE_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(audio)
    temp.replace(target)
    return characters


def speech_cache_name(settings, line):
    speaker = SPEAKERS.get(settings.get("voice"))
    if not speaker or not line:
        return None
    fingerprint = json.dumps([SPEECH_RESOURCE, SPEECH_SAMPLE_RATE, speaker, line])
    digest = hashlib.sha256(fingerprint.encode()).hexdigest()
    return "speech-" + digest + ".wav"


def cached_template_speech(p):
    needed = {speech_cache_name(p["settings"], item.get("line", "").strip()) for item in p["items"]} - {None}
    if not needed:
        return {}
    previous = p.get("previousVideo")
    source = re.fullmatch(r"/media/([0-9a-f-]{36})\.mp4", previous) if isinstance(previous, str) else None
    candidates = []
    if p.get("id"):
        candidates.append(JOBS / p["id"])
    if source:
        prior_id = source[1]
        try:
            prior = read_json(JOBS / (prior_id + ".json"))
        except (OSError, ValueError):
            prior = {}
        prior_work = prior.get("request", {}).get("workId")
        if (prior.get("output") or {}).get("url") == previous and (not prior_work or prior_work == p.get("workId")):
            candidates.append(JOBS / prior_id)
    cached = {}

    def collect(folder, match_index=False):
        for path in folder.glob("*/speech-*.wav"):
            index_key = (path.parent.name, path.name)
            if path.name in needed and (path.name not in cached or (match_index and index_key not in cached)):
                try:
                    with wave.open(str(path), "rb") as wav:
                        if wav.getnframes() > 0:
                            entry = (path, wav.getnframes() / wav.getframerate())
                            cached.setdefault(path.name, entry)
                            if match_index:
                                cached[index_key] = entry
                except (OSError, EOFError, wave.Error):
                    continue

    for folder in candidates:
        collect(folder, match_index=True)
    if p.get("workId") and not needed.issubset(cached):
        for path in JOBS.glob("*.json"):
            try:
                old = read_json(path)
            except (OSError, ValueError):
                continue
            if old.get("request", {}).get("workId") == p["workId"]:
                collect(path.with_suffix(""))
                if needed.issubset(cached):
                    break
    return cached


def has_template_speech(p):
    cached = cached_template_speech(p)
    return all(not name or name in cached for name in (
        speech_cache_name(p["settings"], item.get("line", "").strip()) for item in p["items"]
    ))


def template_shot_audio(settings, line, folder, speech_key, index, record, cached):
    name = speech_cache_name(settings, line)
    if name in cached:
        return cached.get((str(index), name), cached[name])
    return shot_audio(settings, line, folder, speech_key, index, record)


def shot_audio(settings, line, folder, speech_key, index=0, record=None):
    name = speech_cache_name(settings, line)
    if not name:
        return None, 0
    audio = folder / name
    if not audio.is_file():
        characters = narrate(line, SPEAKERS[settings["voice"]], audio, speech_key)
        if record:
            record(f"speech:{index}", work_costs.speech_cost(characters, line, settings["voice"], index))
    with wave.open(str(audio)) as wav:
        return audio, wav.getnframes() / wav.getframerate()


def timed_clip(p, item, source, folder, audio, spoken_seconds):
    settings = p["settings"]
    width, height = frame_size(settings)
    seconds = item["seconds"]
    speed = max(1, spoken_seconds / max(1, seconds - 0.15))
    inputs = ["-i", audio] if audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
    dest = folder / "clip.mp4"
    run_ffmpeg(
        "-i",
        source,
        *inputs,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        seconds,
        "-vf",
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=1",
        "-af",
        f"atempo={speed:.4f},apad",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-threads",
        2,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        44100,
        "-ac",
        1,
        dest,
    )
    return dest


def stamp(value):
    ms = round(value * 1000)
    return f"00:{ms // 60000:02}:{ms // 1000 % 60:02}.{ms % 1000:03}"


SUBTITLE_STOPS = "，。！？；、：,.!?;:…—～~"
TRAILING_SUBTITLE_PUNCT_RE = re.compile(r"[，。！？；、：,.!?;:…—～~\s]+$")


def strip_trailing_subtitle_punctuation(text):
    return TRAILING_SUBTITLE_PUNCT_RE.sub("", str(text or "").strip())


def _is_subtitle_stop(text, index):
    ch = text[index]
    if ch not in SUBTITLE_STOPS:
        return False
    if ch in ".," and index > 0 and index + 1 < len(text) and text[index - 1].isdigit() and text[index + 1].isdigit():
        return False
    return True


def _caption_chunk_entries(line, limit):
    text = " ".join(str(line or "").split())
    while len(strip_trailing_subtitle_punctuation(text)) > limit:
        cut = next(
            (i for i in range(limit, limit // 2, -1) if _is_subtitle_stop(text, i - 1) or text[i - 1] == " "),
            limit,
        )
        while cut < len(text) and _is_subtitle_stop(text, cut):
            cut += 1
        raw = text[:cut].strip()
        display = strip_trailing_subtitle_punctuation(raw)
        if display:
            yield display, raw
        text = text[cut:].lstrip()
    if text:
        display = strip_trailing_subtitle_punctuation(text)
        if display:
            yield display, text


def caption_chunks(line, limit):
    for display, _ in _caption_chunk_entries(line, limit):
        yield display


def shot_caption_intervals(line, start, seconds, ratio):
    limit = {"9:16": 12, "3:4": 15, "1:1": 17, "16:9": 23}[ratio]
    entries = list(_caption_chunk_entries(line, limit))
    # Use audible length for the whole line, and estimate the cue boundaries within it.
    weights = [sum(0.35 if unicodedata.category(c).startswith("P") else 1 for c in raw if not c.isspace())
               for _, raw in entries]
    total = sum(weights)
    elapsed = 0
    for (chunk, _), weight in zip(entries, weights):
        begin = start + seconds * elapsed / total
        elapsed += weight
        end = start + seconds * elapsed / total
        yield {"start": begin, "end": end, "text": chunk}


def caption_vtt(cue):
    text = strip_trailing_subtitle_punctuation(cue["text"])
    return (
        f"{stamp(cue['start'])} --> {stamp(cue['end'])} position:50% size:84% align:center\n"
        f"{escape(text, quote=False)}\n"
    )


def shot_captions(line, start, seconds, ratio):
    return (caption_vtt(cue) for cue in shot_caption_intervals(line, start, seconds, ratio))


def storyboard_timing(item, spoken_seconds, max_seconds, tail_image):
    seconds = item["seconds"]
    if item.get("autoDuration") is True and spoken_seconds:
        seconds = min(max_seconds, max(4, math.ceil(spoken_seconds + draft_content.SHOT_PAUSE)))
    # Finish the spoken action before asking the model to reach the next shot's frame.
    action_end = min(math.ceil(spoken_seconds) if spoken_seconds else seconds, seconds - bool(tail_image))
    timing = f"按口播的顺序，从起镜到第 {action_end} 秒完成本幕动作。"
    if tail_image:
        timing += "剩下的时间平稳移到尾帧。"
    return {**item, "seconds": seconds, "prompt": f"{item['prompt']}\n{timing}"}


def music_path(track):
    if track in ("off", "auto"):
        return None
    if isinstance(track, str) and track.startswith("library:"):
        path, _ = music_gen.resolve_library_track(GENERATED_MUSIC_DIR, track.split(":", 1)[1])
        return path
    if not isinstance(track, str) or track not in MUSIC_TRACKS:
        raise ValueError("请选择有效的背景音乐。")
    path = MUSIC_TRACKS[track]
    if not path.is_file():
        raise ValueError("缺少内置背景音乐文件，请补齐工作台素材后重试。")
    return path


def _make_tracked_deepseek(key, record=None, label="专属背景音乐提示词规划"):
    if not key:
        return None

    def request(path, body, **kwargs):
        result = deepseek(path, body, key=key, **kwargs)
        if record:
            record(
                f"music-text:{uuid.uuid4()}",
                work_costs.text_cost(label, result.get("model") or body["model"], result.get("usage") or {}),
            )
        return result

    return request


def resolve_video_music(p):
    track = p["settings"].get("music", "off")
    if track == "auto":
        # Older clients send the mode instead of the resolved library selection.
        context = p.get("musicContext")
        context = context if isinstance(context, dict) else {}
        topic = next(
            (value.strip() for value in (context.get("topic"), context.get("title"))
             if isinstance(value, str) and value.strip()),
            "",
        )
        library_ids = {item["id"] for item in music_gen.list_music_library(GENERATED_MUSIC_DIR)}
        rules = read_json(PUBLIC / "assets" / "music" / "auto-music.json")
        available = [rule for rule in rules if rule["trackId"] in library_ids]
        if available:
            selected = next(
                (rule for rule in available if any(word in topic for word in rule["keywords"])),
                available[-1],
            )
            track = "library:" + selected["trackId"]
        else:
            track = "off"
    if isinstance(track, str) and track.startswith("library:"):
        path, entry = music_gen.resolve_library_track(GENERATED_MUSIC_DIR, track.split(":", 1)[1])
        return path, track, entry["url"], entry
    return music_path(track), track, None, None


def generate_music_request(p):
    global MUREKA_HOST
    if not isinstance(p, dict):
        raise ValueError("请求格式无效")
    mk_key = current_mureka_key()
    if not mk_key:
        raise ValueError("请先在「模型配置 → 背景音乐」填写 Mureka API Key，再生成专属背景音乐。")
    work_id = p.get("workId")
    if work_id is not None:
        if not isinstance(work_id, str):
            raise ValueError("作品 ID 无效")
        work_id = str(uuid.UUID(work_id))
    hint = p.get("hint", "")
    if hint is not None and (not isinstance(hint, str) or len(hint) > 160):
        raise ValueError("音乐风格偏好最多 160 字")
    lines = p.get("lines", [])
    if lines is not None and (not isinstance(lines, list) or len(lines) > 20 or not all(isinstance(x, str) for x in lines)):
        raise ValueError("口播台词列表格式无效")
    music_model = p.get("musicModel") or music_gen.DEFAULT_MUSIC_MODEL
    if music_model not in music_gen.MUSIC_MODELS:
        raise ValueError("请选择有效的 Mureka 音乐模型。")
    model = p.get("textModel") or default_text_model()
    if model not in text_models():
        model = default_text_model()

    costs = {}

    def record_cost(k, row):
        costs[k] = row

    ds_key = current_deepseek_key()
    generated = music_gen.generate_music(
        p,
        GENERATED_MUSIC_DIR,
        mk_key,
        music_model=music_model,
        mureka_host=MUREKA_HOST or None,
        deepseek_fn=_make_tracked_deepseek(ds_key, record=record_cost),
        text_model=model,
    )
    if generated.get("host"):
        with CACHE_LOCK:
            MUREKA_HOST = generated["host"]
    record_cost(
        f"music:{uuid.uuid4()}",
        work_costs.music_cost(generated["model"], generated.get("duration"), generated.get("spentCny")),
    )

    if work_id and costs:
        job_id = str(uuid.uuid4())
        with CACHE_LOCK:
            write_json(
                JOBS / (job_id + ".json"),
                {
                    "id": job_id,
                    "request": {"kind": "music", "workId": work_id, "settings": {}},
                    "status": "done",
                    "progress": "已生成专属背景音乐",
                    "error": "",
                    "costs": costs,
                    "output": generated,
                },
            )
    return {**generated, "library": music_gen.list_music_library(GENERATED_MUSIC_DIR, include_archived=True)}


def music_mix(duration, voiced, music_index=2, is_generated=False, voice_index=0):
    if is_generated:
        # AI-generated studio tracks are mastered louder (~-13 LUFS) than built-in quiet beds (-21 dB).
        gain = -18 if voiced else -9
    else:
        gain = -12 if voiced else -6
    bed = (
        f"[{music_index}:a]atrim=duration={duration},asetpts=PTS-STARTPTS,"
        f"volume={gain}dB,afade=t=in:d=0.7,afade=t=out:st={duration - 1.4:.3f}:d=1.4"
    )
    if not voiced:
        return bed + "[mix]"
    # Keep a continuous stereo bed. Lower it only where the narration is audible.
    return (
        bed + "[bed];"
        f"[{voice_index}:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[voice][detector];"
        "[bed][detector]sidechaincompress=threshold=0.055:ratio=4:attack=25:release=550[ducked];"
        "[voice][ducked]amix=inputs=2:duration=first:normalize=0,"
        "alimiter=limit=0.95:level=false:latency=1[mix]"
    )


def library_sound_mix(shots, music, track, duration, voiced, events=()):
    placements = [(shot["sfxId"], shot["start"] + 0.16, -12) for shot in shots if "sfxId" in shot]
    sound_inputs, delays, used = [], [], []
    for asset_id, time, gain in (*placements, *events):
        path, item = ASSETS.resolve(asset_id, ("sfx",))
        index = 2 + bool(music) + len(delays)
        delay = round(time * 1000)
        sound_inputs.extend(["-i", path])
        delays.append(f"[{index}:a]volume={gain}dB,adelay={delay}:all=1[sfx{len(delays)}]")
        used.append((path, item))
    base = music_mix(duration, voiced, is_generated=track.startswith("library:")) if music else ""
    if not delays:
        return [], ["-filter_complex", base, "-map", "[mix]"] if base else ["-map", "0:a:0"], used
    source = base.removesuffix("[mix]") + "[base]" if base else "[0:a]anull[base]"
    parts = "[base]" + "".join(f"[sfx{index}]" for index in range(len(delays)))
    # Preserve legacy mix levels. Leave extra headroom for AAC inter-sample peaks with automatic effects.
    limit = "0.79" if events else "0.89"
    mix = ";".join([source, *delays,
                    f"{parts}amix=inputs={len(delays) + 1}:duration=first:normalize=0,"
                    f"alimiter=limit={limit}:level=false:latency=1[mix]"])
    return sound_inputs, ["-filter_complex", mix, "-map", "[mix]"], used


def stage_sound_mix(p, shots, music, track, duration, voiced, event_rows):
    pack, gain = stage_video.sound_settings(p, ASSETS)
    events = [(pack[row["type"]], row["t"], gain)
              for row in event_rows if row["type"] in pack and 0 <= row["t"] < duration]
    return library_sound_mix(shots, music, track, duration, voiced, events)


def asset_versions(assets):
    unique = {item["id"]: (path, item) for path, item in assets}
    return [
        {**{key: item[key] for key in ("id", "kind", "name", "license", "credit", "termsUrl") if item.get(key)},
         "sha256": item.get("sha256") or asset_library.digest(path)}
        for path, item in unique.values()
    ]


def build_template_speech_wav(entries, target_wav, scratch_dir):
    pcm_chunks = []
    for idx, (audio_path, seconds) in enumerate(entries):
        target_frames = max(1, round(float(seconds) * SPEECH_SAMPLE_RATE))
        raw = b""
        if audio_path and Path(audio_path).is_file():
            source_wav = Path(audio_path)
            with wave.open(str(source_wav), "rb") as wav:
                ch, sw, fr = wav.getnchannels(), wav.getsampwidth(), wav.getframerate()
                if (ch, sw, fr) == (1, 2, SPEECH_SAMPLE_RATE):
                    raw = wav.readframes(target_frames)
            if not raw and source_wav.stat().st_size > 44:
                norm_wav = scratch_dir / f"norm-{idx}.wav"
                run_ffmpeg(
                    "-i",
                    source_wav,
                    "-ar",
                    SPEECH_SAMPLE_RATE,
                    "-ac",
                    1,
                    "-c:a",
                    "pcm_s16le",
                    norm_wav,
                )
                with wave.open(str(norm_wav), "rb") as wav:
                    raw = wav.readframes(target_frames)
        actual_frames = len(raw) // 2
        if actual_frames > target_frames:
            raw = raw[: target_frames * 2]
        elif actual_frames < target_frames:
            raw += b"\x00\x00" * (target_frames - actual_frames)
        pcm_chunks.append(raw)
    temp = target_wav.with_suffix(".tmp.wav")
    with wave.open(str(temp), "wb") as wav:
        wav.setparams((1, 2, SPEECH_SAMPLE_RATE, 0, "NONE", "not compressed"))
        for chunk in pcm_chunks:
            wav.writeframes(chunk)
    temp.replace(target_wav)
    return target_wav


def partition_avatar_chunks(entries, max_seconds=AVATAR_MAX_CHUNK_SECONDS):
    chunks = []
    current = []
    acc = 0.0
    for entry in entries:
        sec = float(entry[1])
        if current and acc + sec > max_seconds:
            chunks.append(current)
            current = [entry]
            acc = sec
        else:
            current.append(entry)
            acc += sec
    if current:
        chunks.append(current)
    return chunks


def split_wav_file_balanced(wav_path, max_seconds, out_dir, prefix):
    with wave.open(str(wav_path), "rb") as wav:
        params = wav.getparams()
        total_frames = wav.getnframes()
        rate = wav.getframerate()
        total_sec = total_frames / rate
        if total_sec <= max_seconds:
            return [(wav_path, total_sec)]
        parts = max(2, math.ceil(total_sec / max_seconds))
        per_frames = total_frames // parts
        out = []
        for pi in range(parts):
            frames_to_read = total_frames - pi * per_frames if pi == parts - 1 else per_frames
            pcm = wav.readframes(frames_to_read)
            part_path = out_dir / f"{prefix}-p{pi}.wav"
            with wave.open(str(part_path), "wb") as dst:
                dst.setparams((params.nchannels, params.sampwidth, params.framerate, 0, "NONE", "not compressed"))
                dst.writeframes(pcm)
            out.append((part_path, frames_to_read / rate))
        return out


def generate_template_avatar_video(avatar_cfg, slide_entries, job_dir, job, save, dashscope_key, record=None):
    model = avatar_cfg.get("model") or "videoretalk"
    if model == "liveportrait":
        raise ValueError("阿里云百炼已于 2026-10-10 下线 liveportrait，请返回分镜编辑重新点击合成（将自动改用在线数字人模型）。")
    presenter = avatar_cfg.get("presenter") or "digital"
    resolution = avatar_cfg.get("resolution") or "480P"
    image_path = media_path(avatar_cfg["image"])
    img_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()

    AVATAR_CACHE.mkdir(parents=True, exist_ok=True)
    if model == "videoretalk":
        max_chunk = VIDEORETALK_MAX_CHUNK_SECONDS
        params = {"video_extension": True}
        cost_resolution = ""
    else:
        max_chunk = WAN_S2V_MAX_CHUNK_SECONDS
        params = {"resolution": resolution, "style": "speech"}
        cost_resolution = resolution

    grouped = partition_avatar_chunks(slide_entries, max_seconds=max_chunk)
    wav_pieces = []
    for gi, group_entries in enumerate(grouped):
        group_wav = job_dir / f"avatar-speech-g{gi}.wav"
        build_template_speech_wav(group_entries, group_wav, job_dir)
        wav_pieces.extend(split_wav_file_balanced(group_wav, max_chunk, job_dir, f"avatar-speech-g{gi}"))

    chunk_specs = []
    any_uncached = False
    for ci, (chunk_wav, chunk_sec) in enumerate(wav_pieces):
        audio_hash = hashlib.sha256(chunk_wav.read_bytes()).hexdigest()
        fingerprint = [model, img_hash, audio_hash, params]
        digest = hashlib.sha256(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        cached_mp4 = AVATAR_CACHE / f"{digest}.mp4"
        if not cached_mp4.is_file():
            any_uncached = True
        chunk_specs.append((ci, chunk_wav, chunk_sec, cached_mp4))

    source_asset = image_path
    if any_uncached:
        if not dashscope_key:
            raise ValueError("未找到可复用的数字人素材。请配置阿里云百炼后继续，或在主讲人设置选择静态肖像。")
        if model == "videoretalk":
            job["progress"] = "准备数字人底片视频（640×640）"
            save()
            base_mp4 = AVATAR_CACHE / f"base-{img_hash}-640.mp4"
            source_asset = build_avatar_base_video(image_path, base_mp4, duration=3.0)
        else:
            job["progress"] = "校验人物肖像人脸规范（阿里云百炼）"
            save()
            dashscope_detect_face(image_path, dashscope_key)

    remote_bucket = job.setdefault("remote", {})
    chunk_mp4s = []
    for ci, chunk_wav, chunk_sec, cached_mp4 in chunk_specs:
        chunk_label = f"（第 {ci + 1}/{len(chunk_specs)} 段）" if len(chunk_specs) > 1 else ""
        state_key = f"avatar:{ci}"
        state = remote_bucket.setdefault(state_key, {})
        if cached_mp4.is_file():
            if record and not state.get("remote"):
                record(
                    f"avatar-cache:{ci}",
                    work_costs.avatar_cost(model, chunk_sec, cached=True, chunk_label=chunk_label, resolution=cost_resolution),
                )
            chunk_mp4s.append(cached_mp4)
            continue

        def report_avatar(result, _ci=ci, _sec=chunk_sec, _label=chunk_label, _state=state):
            usage = result.get("usage") if isinstance(result, dict) else {}
            dur = usage.get("video_duration") if isinstance(usage, dict) else None
            if type(dur) not in (int, float) or not 0 < float(dur) <= 300:
                dur = _sec
            if record:
                record(
                    f"avatar:{_ci}:{_state.get('remote', '')}",
                    work_costs.avatar_cost(model, float(dur), cached=False, chunk_label=_label, resolution=cost_resolution),
                )

        dashscope_avatar_clip(
            model,
            source_asset,
            chunk_wav,
            params,
            cached_mp4,
            dashscope_key,
            state,
            save,
            job=job,
            label=chunk_label,
            presenter=presenter,
            on_success=report_avatar if record else None,
        )
        chunk_mp4s.append(cached_mp4)

    if len(chunk_mp4s) == 1:
        return chunk_mp4s[0]

    concat_list = job_dir / "avatar-chunks.txt"
    concat_lines = []
    for mp4 in chunk_mp4s:
        escaped = str(mp4.resolve()).replace("\\", "/").replace("'", "'\\''")
        concat_lines.append(f"file '{escaped}'")
    concat_list.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
    merged = job_dir / "avatar-merged.mp4"
    run_ffmpeg(
        "-f",
        "concat",
        "-safe",
        0,
        "-i",
        concat_list,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        18,
        "-pix_fmt",
        "yuv420p",
        "-an",
        merged,
    )
    return merged


def _norm_avatar_rect(rect):
    if not isinstance(rect, dict):
        return None
    size = max(24, int(round(float(rect["size"]) / 2)) * 2)
    ox = int(round(float(rect["x"])))
    oy = int(round(float(rect["y"])))
    return (ox, oy, size)


def _norm_progress_ring(ring):
    if not isinstance(ring, dict):
        return None
    try:
        rx = float(ring["x"])
        ry = float(ring["y"])
        size = float(ring["size"])
        stroke = float(ring.get("stroke", 6))
    except (KeyError, TypeError, ValueError):
        return None
    if not (20 <= size <= 400 and 1 <= stroke <= 30 and -64 <= rx <= 1280 and -64 <= ry <= 720):
        return None
    color = str(ring.get("color") or "#e67835").strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", color)
    if m:
        hx = m.group(1)
        rc, gc, bc = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
    else:
        rc, gc, bc = 230, 120, 53
    return (round(rx, 1), round(ry, 1), round(size, 1), round(stroke, 1), rc, gc, bc)


def _merge_ring_spans(cue_entries):
    spans = []
    t = 0.0
    for entry in cue_entries:
        dur = entry[1]
        ring = entry[4]
        if spans and spans[-1][0] == ring:
            spans[-1] = (ring, spans[-1][1], t + dur)
        else:
            spans.append((ring, t, t + dur))
        t += dur
    return [(r, s, e) for r, s, e in spans if r is not None]


def _append_ring_overlay(base_filter, in_label, ring_spans, seg_start, seg_dur, total_dur):
    if not ring_spans or total_dur <= 0:
        return base_filter, in_label
    parts = [base_filter] if base_filter else []
    cur = in_label
    for idx, (ring, span_start, span_end) in enumerate(ring_spans):
        rx, ry, rsize, rstroke, rc, gc, bc = ring
        pad = 2
        box_sz = int(round(rsize)) + pad * 2
        ox = int(round(rx)) - pad
        oy = int(round(ry)) - pad
        cx = rsize / 2.0 + pad - 0.5
        cy = cx
        r_out = rsize / 2.0
        r_in = max(1.0, r_out - rstroke)
        r_mid = r_out - rstroke / 2.0
        r_half = rstroke / 2.0
        sweep = f"(2*PI*min(1,(({seg_start:.3f}+T)/{total_dur:.3f})))"
        ang = f"mod(atan2(X-{cx:.2f},{cy:.2f}-Y)+2*PI,2*PI)"
        dist = f"hypot(X-{cx:.2f},Y-{cy:.2f})"
        rad = f"(clip({r_out:.2f}-{dist}+0.5,0,1)*clip({dist}-{r_in:.2f}+0.5,0,1))"
        arc = f"({rad}*clip(({sweep}-{ang})*{r_mid:.2f}+0.5,0,1))"
        cap0 = f"clip({r_half:.2f}+0.5-hypot(X-{cx:.2f},Y-{cy - r_mid:.2f}),0,1)"
        cap1 = f"clip({r_half:.2f}+0.5-hypot(X-({cx:.2f}+{r_mid:.2f}*sin({sweep})),Y-({cy:.2f}-{r_mid:.2f}*cos({sweep}))),0,1)"
        alpha = f"255*max({arc},gt({sweep},0.02)*max({cap0},{cap1}))"
        rlbl = f"ring{idx}"
        olbl = f"vring{idx}"
        parts.append(
            f"color=c=black@0.0:s={box_sz}x{box_sz}:r=24:d={seg_dur + 0.5:.3f},"
            f"format=rgba,geq=r={rc}:g={gc}:b={bc}:a='{alpha}'[{rlbl}]"
        )
        full_cover = span_start <= 0.02 and span_end >= seg_dur - 0.05
        enable = "" if full_cover else f":enable='between(t,{span_start:.3f},{span_end:.3f})'"
        parts.append(
            f"{cur}[{rlbl}]overlay=x={ox}:y={oy}:shortest=1:format=auto{enable}[{olbl}]"
        )
        cur = f"[{olbl}]"
    final = "vout_ring"
    parts.append(f"{cur}format=yuv420p[{final}]")
    return ";".join(parts), f"[{final}]"


def _write_cue_concat(path, cue_pairs):
    lines = []
    last_img = ""
    for img_file, dur in cue_pairs:
        escaped = str(img_file).replace("\\", "/").replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
        lines.append(f"duration {dur:.3f}")
        last_img = escaped
    if last_img:
        lines.append(f"file '{last_img}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _build_template_slide_xfade(cue_specs, prev_img=None):
    """Build FFmpeg inputs and filter_complex for exact-duration cue cuts and xfade dissolves.

    cue_specs: list of (Path, duration_seconds, transition_name)
    Returns: (input_args, filter_complex, video_out_label)
    """
    n = len(cue_specs)
    norm_vf = (
        "scale=1280:720:force_original_aspect_ratio=decrease,"
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,settb=AVTB"
    )
    fades = []
    for k in range(n - 1):
        d_cur = cue_specs[k][1]
        d_next = cue_specs[k + 1][1]
        trans = cue_specs[k + 1][2]
        raw_f = 0.28 if trans == "outro" else (0.22 if trans == "fade" else 0.0)
        f = round(min(raw_f, 0.35 * d_cur, 0.35 * d_next), 3) if raw_f > 0 else 0.0
        fades.append(f if f >= 0.08 else 0.0)

    lead_fade = 0.0
    if prev_img is not None and n >= 1:
        f_lead = round(min(0.24, 0.35 * cue_specs[0][1]), 3)
        if f_lead >= 0.08:
            lead_fade = f_lead

    input_args = []
    filters = []
    in_idx = 0

    prev_label = None
    if lead_fade > 0:
        input_args.extend(["-loop", "1", "-t", f"{lead_fade + 0.08:.3f}", "-i", prev_img])
        prev_label = f"s{in_idx}"
        filters.append(f"[{in_idx}:v]{norm_vf}[{prev_label}]")
        in_idx += 1

    cue_labels = []
    for k, (img_file, dur, _) in enumerate(cue_specs):
        extra = (fades[k] + 0.08) if (k < n - 1 and fades[k] > 0) else 0.0
        stream_dur = dur + extra
        input_args.extend(["-loop", "1", "-t", f"{stream_dur:.3f}", "-i", img_file])
        lbl = f"s{in_idx}"
        filters.append(f"[{in_idx}:v]{norm_vf}[{lbl}]")
        cue_labels.append(lbl)
        in_idx += 1

    step = 0
    if prev_label is not None:
        acc = f"acc{step}"
        filters.append(
            f"[{prev_label}][{cue_labels[0]}]xfade=transition=fade:duration={lead_fade:.3f}:offset=0[{acc}]"
        )
        step += 1
    else:
        acc = cue_labels[0]

    timeline = cue_specs[0][1]
    for k in range(n - 1):
        nxt = cue_labels[k + 1]
        f = fades[k]
        out = f"acc{step}"
        if f > 0:
            filters.append(
                f"[{acc}][{nxt}]xfade=transition=fade:duration={f:.3f}:offset={timeline:.3f}[{out}]"
            )
        else:
            filters.append(f"[{acc}][{nxt}]concat=n=2:v=1:a=0,settb=AVTB[{out}]")
        acc = out
        step += 1
        timeline += cue_specs[k + 1][1]

    return input_args, ";".join(filters), f"[{acc}]", in_idx


def template_slide_seconds(item, spoken):
    raw_pause = item.get("tailPause", 0.55)
    tail_pause = max(0.2, min(3.0, float(raw_pause))) if type(raw_pause) in (int, float) else 0.55
    return max(3.5, round(spoken + tail_pause, 2)) if spoken else float(item["seconds"])


def template_cue_seconds(cues, seconds, spoken):
    def hold_time(cue):
        value = cue.get("holdSeconds")
        return max(0.2, min(5.0, round(float(value), 3))) if type(value) in (int, float) and value > 0 else 0

    holds = [hold_time(cue) for cue in cues]
    hold_total = sum(max(0.2, min(5.0, cue["holdSeconds"])) for cue, hold in zip(cues, holds) if hold)
    weights = [float(cue.get("weight", 1)) for cue in cues]
    spoken_weights = [weight for weight, hold in zip(weights, holds) if not hold]
    total_weight = sum(spoken_weights or weights)
    spoken_budget = (max(0.4 * max(1, len(spoken_weights)), seconds - hold_total)
                     if hold_total > 0 else max(1.0, spoken) if spoken else seconds)
    elapsed = 0.0
    for index, (hold, weight) in enumerate(zip(holds, weights)):
        duration = (max(0.4, round(seconds - elapsed, 3)) if index == len(cues) - 1
                    else hold or max(0.4, round(spoken_budget * weight / total_weight, 3)))
        yield duration
        elapsed += duration


def render_template_video(p, job, save, speech_key, record=None, dashscope_key=""):
    settings = p["settings"]
    music, track, music_url, music_meta = resolve_video_music(p)
    music_extra = {"musicUrl": music_url, "musicMeta": music_meta} if music_url else {}
    items = p["items"]
    voiced = settings.get("voice") in SPEAKERS and any(item.get("line", "").strip() for item in items)
    avatar_cfg = p.get("avatar") if isinstance(p.get("avatar"), dict) else None
    use_avatar = bool(avatar_cfg and avatar_cfg.get("enabled") is True and voiced)
    default_rect = _norm_avatar_rect(avatar_cfg.get("rect")) if use_avatar else None

    vtt_cues = ["WEBVTT\n"]
    start = 0.0
    shot_seconds = []
    base = job["id"]
    job_dir = JOBS / base
    job_dir.mkdir(parents=True, exist_ok=True)
    cached = cached_template_speech(p)

    # First prepare narration WAVs and exact per-slide timing.
    slide_data = []
    for i, item in enumerate(items):
        folder = job_dir / str(i)
        folder.mkdir(parents=True, exist_ok=True)
        line = item.get("line", "").strip()
        job["progress"] = f"准备第 {i + 1} / {len(items)} 页配音"
        save()
        audio, spoken = template_shot_audio(settings, line, folder, speech_key, i, record, cached)
        seconds = template_slide_seconds(item, spoken)
        cues = item["cues"]
        cue_entries = []
        for cue, dur in zip(cues, template_cue_seconds(cues, seconds, spoken)):
            img_file = media_path(cue["image"]).resolve()
            crect = _norm_avatar_rect(cue["avatarRect"]) if "avatarRect" in cue else default_rect
            cring = _norm_progress_ring(cue.get("progressRing"))
            trans = cue.get("transition", "cut")
            cue_entries.append((img_file, dur, crect, trans, cring))
        if line:
            vtt_cues.extend(shot_captions(line, start, min(spoken, seconds - 0.15) if spoken else seconds, "16:9"))
        shot_seconds.append(round(seconds))
        slide_data.append((i, folder, audio, seconds, cue_entries, start))
        start += seconds

    captions = MEDIA / (base + ".vtt")
    captions.write_text("\n".join(vtt_cues), encoding="utf-8")

    if use_avatar:
        slide_entries = [(audio, seconds) for _, _, audio, seconds, _, _ in slide_data]
        full_speech = job_dir / "full-speech.wav"
        build_template_speech_wav(slide_entries, full_speech, job_dir)
        avatar_mp4 = generate_template_avatar_video(
            avatar_cfg, slide_entries, job_dir, job, save, dashscope_key or current_dashscope_key(), record
        )
        job["progress"] = "合成数字人对口型与高清模板画面"
        save()

        # Group consecutive cues sharing identical avatar and ring coordinates into continuous layout runs.
        runs = []
        cursor = 0.0
        for _, _, _, _, cue_entries, _ in slide_data:
            for img_file, dur, crect, _, cring in cue_entries:
                if runs and runs[-1]["rect"] == crect and runs[-1]["ring"] == cring:
                    runs[-1]["cues"].append((img_file, dur))
                    runs[-1]["dur"] += dur
                else:
                    runs.append({"start": cursor, "dur": dur, "rect": crect, "ring": cring, "cues": [(img_file, dur)]})
                cursor += dur

        composed = job_dir / "composed.mp4" if music else MEDIA / (base + ".mp4")
        extra_flags = [] if music else ["-movflags", "+faststart"]

        if len(runs) == 1 and runs[0]["rect"] is not None:
            all_cues = job_dir / "all-cues.txt"
            _write_cue_concat(all_cues, runs[0]["cues"])
            ox, oy, size = runs[0]["rect"]
            filter_complex = (
                f"color=c=black:s=1280x720:r=24[base];"
                f"[0:v]fps=24,tpad=stop_mode=clone:stop_duration=3,"
                f"scale={size}:{size}:force_original_aspect_ratio=increase,"
                f"crop={size}:{size}:(iw-ow)/2:min(ih-oh\\,(ih-oh)*0.2),setsar=1[av];"
                f"[base][av]overlay=x={ox}:y={oy}:format=rgb[with_av];"
                f"[1:v]fps=24,tpad=stop_mode=clone:stop_duration=2,scale=1280:720:flags=lanczos,format=rgba[ov];"
                f"[with_av][ov]overlay=0:0:format=rgb,format=yuv420p[vout]"
            )
            vout_lbl = "[vout]"
            if runs[0]["ring"] is not None:
                filter_complex, vout_lbl = _append_ring_overlay(
                    filter_complex, vout_lbl, [(runs[0]["ring"], 0.0, start)], 0.0, start, start
                )
            run_ffmpeg(
                "-i",
                avatar_mp4,
                "-f",
                "concat",
                "-safe",
                0,
                "-i",
                all_cues,
                "-i",
                full_speech,
                "-filter_complex",
                filter_complex,
                "-map",
                vout_lbl,
                "-map",
                "2:a:0",
                "-t",
                f"{start:.3f}",
                "-af",
                "apad",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                19,
                "-threads",
                2,
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                44100,
                "-ac",
                1,
                *extra_flags,
                composed,
            )
        else:
            run_files = []
            for ri, run in enumerate(runs):
                run_cues = job_dir / f"run-{ri}-cues.txt"
                _write_cue_concat(run_cues, run["cues"])
                run_mp4 = job_dir / f"run-{ri}.mp4"
                run_dur = run["dur"]
                t0 = run["start"]
                if run["rect"] is not None:
                    ox, oy, size = run["rect"]
                    filter_complex = (
                        f"color=c=black:s=1280x720:r=24[base];"
                        f"[0:v]fps=24,tpad=stop_mode=clone:stop_duration=5,"
                        f"trim=start={t0:.3f}:duration={run_dur + 2:.3f},setpts=PTS-STARTPTS,"
                        f"scale={size}:{size}:force_original_aspect_ratio=increase,"
                        f"crop={size}:{size}:(iw-ow)/2:min(ih-oh\\,(ih-oh)*0.2),setsar=1[av];"
                        f"[base][av]overlay=x={ox}:y={oy}:format=rgb[with_av];"
                        f"[1:v]fps=24,tpad=stop_mode=clone:stop_duration=2,scale=1280:720:flags=lanczos,format=rgba[ov];"
                        f"[with_av][ov]overlay=0:0:format=rgb,format=yuv420p[vout]"
                    )
                    vout_lbl = "[vout]"
                    if run["ring"] is not None:
                        filter_complex, vout_lbl = _append_ring_overlay(
                            filter_complex, vout_lbl, [(run["ring"], 0.0, run_dur)], t0, run_dur, start
                        )
                    run_ffmpeg(
                        "-i",
                        avatar_mp4,
                        "-f",
                        "concat",
                        "-safe",
                        0,
                        "-i",
                        run_cues,
                        "-filter_complex",
                        filter_complex,
                        "-map",
                        vout_lbl,
                        "-t",
                        f"{run_dur:.3f}",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "fast",
                        "-crf",
                        19,
                        "-threads",
                        2,
                        "-pix_fmt",
                        "yuv420p",
                        "-an",
                        run_mp4,
                    )
                else:
                    if run["ring"] is not None:
                        fc = "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[vbase]"
                        fc, vout_lbl = _append_ring_overlay(fc, "[vbase]", [(run["ring"], 0.0, run_dur)], t0, run_dur, start)
                        run_ffmpeg(
                            "-f", "concat", "-safe", 0, "-i", run_cues,
                            "-filter_complex", fc, "-map", vout_lbl,
                            "-t", f"{run_dur:.3f}",
                            "-c:v", "libx264", "-preset", "fast", "-crf", 19, "-threads", 2, "-pix_fmt", "yuv420p", "-an",
                            run_mp4,
                        )
                    else:
                        run_ffmpeg(
                            "-f",
                            "concat",
                            "-safe",
                            0,
                            "-i",
                            run_cues,
                            "-t",
                            f"{run_dur:.3f}",
                            "-vf",
                            "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24",
                            "-c:v",
                            "libx264",
                            "-preset",
                            "fast",
                            "-crf",
                            19,
                            "-threads",
                            2,
                            "-pix_fmt",
                            "yuv420p",
                            "-an",
                            run_mp4,
                        )
                run_files.append(run_mp4)
            runs_list = job_dir / "runs.txt"
            runs_list.write_text(
                "\n".join(f"file 'run-{ri}.mp4'" for ri in range(len(run_files))) + "\n",
                encoding="utf-8",
            )
            run_ffmpeg(
                "-f",
                "concat",
                "-safe",
                1,
                "-i",
                runs_list,
                "-i",
                full_speech,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-t",
                f"{start:.3f}",
                "-af",
                "apad",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-ar",
                44100,
                "-ac",
                1,
                *extra_flags,
                composed,
            )
        if music:
            job["progress"] = "混入背景音乐并封装成片"
            save()
            run_ffmpeg(
                "-i",
                composed,
                "-stream_loop",
                -1,
                "-i",
                music,
                "-map",
                "0:v",
                "-filter_complex",
                music_mix(start, True, music_index=1, is_generated=(track == "auto" or str(track).startswith("library:"))),
                "-map",
                "[mix]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                MEDIA / (base + ".mp4"),
            )
        return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track, "shotSeconds": shot_seconds, **music_extra}

    segments = []
    prev_last_img = None
    for i, folder, audio, seconds, cue_entries, seg_start in slide_data:
        job["progress"] = f"合成第 {i + 1} / {len(items)} 页模板画面"
        save()
        cue_specs = [(img_file, dur, trans) for img_file, dur, _, trans, _ in cue_entries]
        ring_spans = _merge_ring_spans(cue_entries)
        has_transition = prev_last_img is not None or any(t in ("fade", "outro") for _, _, t in cue_specs[1:])
        audio_in = ["-i", audio] if audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
        clip = folder / "clip.mp4"

        if has_transition:
            v_inputs, v_filter, v_out, audio_idx = _build_template_slide_xfade(cue_specs, prev_img=prev_last_img)
            if ring_spans:
                v_filter, v_out = _append_ring_overlay(v_filter, v_out, ring_spans, seg_start, seconds, start)
            run_ffmpeg(
                *v_inputs,
                *audio_in,
                "-filter_complex",
                v_filter,
                "-map",
                v_out,
                "-map",
                f"{audio_idx}:a:0",
                "-t",
                f"{seconds:.3f}",
                "-af",
                "apad",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                19,
                "-threads",
                2,
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                44100,
                "-ac",
                1,
                clip,
            )
        else:
            cue_list = folder / "cues.txt"
            _write_cue_concat(cue_list, [(img_file, dur) for img_file, dur, _, _, _ in cue_entries])
            if ring_spans:
                base_fc = "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[vbase]"
                fc, v_out = _append_ring_overlay(base_fc, "[vbase]", ring_spans, seg_start, seconds, start)
                run_ffmpeg(
                    "-f",
                    "concat",
                    "-safe",
                    0,
                    "-i",
                    cue_list,
                    *audio_in,
                    "-filter_complex",
                    fc,
                    "-map",
                    v_out,
                    "-map",
                    "1:a:0",
                    "-t",
                    f"{seconds:.3f}",
                    "-af",
                    "apad",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    19,
                    "-threads",
                    2,
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-ar",
                    44100,
                    "-ac",
                    1,
                    clip,
                )
            else:
                run_ffmpeg(
                    "-f",
                    "concat",
                    "-safe",
                    0,
                    "-i",
                    cue_list,
                    *audio_in,
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-t",
                    f"{seconds:.3f}",
                    "-vf",
                    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24",
                    "-af",
                    "apad",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    19,
                    "-threads",
                    2,
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-ar",
                    44100,
                    "-ac",
                    1,
                    clip,
                )
        prev_last_img = cue_specs[-1][0]
        segments.append(clip)

    job["progress"] = "合并模板画面、配音与背景音乐" if music else "封装模板科普视频"
    save()
    listing = job_dir / "clips.txt"
    listing.write_text(
        "\n".join(f"file '{i}/clip.mp4'" for i in range(len(segments))),
        encoding="utf-8",
    )
    music_input = ["-stream_loop", -1, "-i", music] if music else []
    audio_args = (
        ["-filter_complex", music_mix(start, voiced, music_index=1, is_generated=(track == "auto" or str(track).startswith("library:"))), "-map", "[mix]", "-c:a", "aac", "-b:a", "160k"]
        if music else ["-map", "0:a", "-c:a", "copy"]
    )
    run_ffmpeg(
        "-f",
        "concat",
        "-safe",
        1,
        "-i",
        listing,
        *music_input,
        "-map",
        "0:v",
        *audio_args,
        "-c:v",
        "copy",
        "-movflags",
        "+faststart",
        MEDIA / (base + ".mp4"),
    )
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track, "shotSeconds": shot_seconds, **music_extra}


def svg_speech_cache_path(p, line, speaker):
    fingerprint = json.dumps([p["workId"], SPEECH_RESOURCE, SPEECH_SAMPLE_RATE, speaker, line])
    digest = hashlib.sha256(fingerprint.encode()).hexdigest()
    return MEDIA / (digest + ".wav")


def svg_shot_audio(p, item, index, speech_key, record):
    line = item["line"].strip()
    voice = p["settings"]["voice"]
    speaker = SPEAKERS.get(voice)
    if not speaker:
        return None, 0
    audio = svg_speech_cache_path(p, line, speaker)
    with SVG_SPEECH_LOCKS[int(audio.stem[:1], 16)]:
        if not audio.is_file():
            characters = narrate(line, speaker, audio, speech_key)
            if record:
                record(f"speech:{index}", work_costs.speech_cost(characters, line, voice, index))
        with wave.open(str(audio)) as wav:
            return audio, wav.getnframes() / wav.getframerate()


def svg_template_layout(p):
    requested = p.get("svgLayout", {})
    if not isinstance(requested, dict):
        raise ValueError("SVG 信息图模板设置无效。")
    theme = requested.get("theme", "medical")
    presenter = requested.get("presenter", "digital")
    profile = requested.get("pharmacist", {})
    if theme not in ("medical", "warm") or presenter not in ("digital", "cartoon", "none") or not isinstance(profile, dict):
        raise ValueError("SVG 信息图模板的风格或主讲人无效。")
    pharmacist = {key: draft_content.string_field(profile, key, limit, optional=True)
                  for key, limit in (("name", 16), ("role", 16), ("hospital", 24)) if key in profile}
    avatar_url = profile.get("avatarImage") if presenter == "digital" else None
    avatar = None
    if presenter != "none":
        default = f"/assets/template-doctor-{presenter}.jpg"
        avatar = media_path(avatar_url or default)
        if avatar.suffix.lower() not in (".jpg", ".png", ".webp"):
            raise ValueError("SVG 信息图模板的主讲人肖像必须是图片。")
    return {"title": p["title"], "theme": theme, "presenter": presenter, "pharmacist": pharmacist}, avatar


def svg_caption_intervals(line, seconds, beats=None):
    if not beats:
        yield from shot_caption_intervals(line, 0, seconds, "16:9")
        return
    weights = [max(1, sum(not c.isspace() for c in beat["line"])) for beat in beats]
    total = sum(weights)
    elapsed = 0
    for beat, weight in zip(beats, weights):
        yield from shot_caption_intervals(beat["line"], elapsed * seconds / total, weight * seconds / total, "16:9")
        elapsed += weight


def svg_caption_progress(line, seconds, beats=None):
    return [{"text": cue["text"], "end": cue["end"] / seconds}
            for cue in svg_caption_intervals(line, seconds, beats)]


def render_svg_video(p, job, save, speech_key, record):
    folder = JOBS / job["id"]
    folder.mkdir(parents=True, exist_ok=True)
    plan, entries, stages = [], [], []
    cues = ["WEBVTT\n"]
    total_frames = 0
    for index, item in enumerate(p["items"]):
        job["progress"] = f"对齐第 {index + 1} / {len(p['items'])} 幕口播"
        save()
        audio, spoken = svg_shot_audio(p, item, index, speech_key, record)
        frames, motion_frames = svg_motion.timing(spoken, item["seconds"])
        start = total_frames / svg_motion.FPS
        seconds = frames / svg_motion.FPS
        intervals = list(svg_caption_intervals(item["line"].strip(), spoken or seconds, item.get("beats")))
        cues.extend(caption_vtt({**cue, "start": start + cue["start"], "end": start + cue["end"]}) for cue in intervals)
        plan.append({"name": item["name"], "action": item["action"], "beats": item.get("beats"),
                     "line": item["line"].strip(), "seconds": seconds,
                     "subtitles": [{"text": cue["text"], "end": cue["end"] / (spoken or seconds)} for cue in intervals],
                     "frames": frames, "motionFrames": motion_frames})
        entries.append((audio, seconds))
        stages.append({"start": round(start, 6), "seconds": round(seconds, 6),
                       "speechSeconds": round(spoken, 6), "action": item["action"],
                       "actions": [beat["action"] for beat in item["beats"]] if item.get("beats") else [item["action"]]})
        total_frames += frames
    job["progress"] = "逐帧渲染 SVG 演示动画"
    save()
    source = folder / "svg-template-source.mp4"
    if not source.is_file():
        layout, avatar = svg_template_layout(p)
        source = svg_motion.render(plan, folder, FFMPEG, layout, image_data_url(avatar) if avatar else "")
    if record:
        record("svg-render", work_costs.entry("SVG 演示动画", "本地渲染", f"{total_frames} 帧 · 720p", 0))
    full_audio = build_template_speech_wav(entries, folder / "svg-speech.wav", folder)
    base = job["id"]
    captions = MEDIA / (base + ".vtt")
    captions.write_text("\n".join(cues), encoding="utf-8")
    music, track, music_url, music_meta = resolve_video_music(p)
    total = total_frames / svg_motion.FPS
    job["progress"] = "合成 SVG 动画、字幕与配音"
    save()
    audio_input = ["-stream_loop", "-1", "-i", music] if music else []
    audio_filter = (
        ["-filter_complex", music_mix(total, any(path for path, _ in entries),
                                       is_generated=track == "auto" or str(track).startswith("library:"), music_index=2, voice_index=1),
         "-map", "[mix]"] if music else ["-map", "1:a:0"]
    )
    output = MEDIA / (base + ".mp4")
    temp = folder / "svg-output.tmp.mp4"
    run_ffmpeg(
        "-i", source, "-i", full_audio, *audio_input,
        "-map", "0:v:0", *audio_filter, "-t", f"{total:.6f}",
        "-c:v", "copy", "-c:a", "aac",
        "-movflags", "+faststart", temp,
    )
    temp.replace(output)
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track,
            "burnedCaptions": True,
            **({"musicUrl": music_url, "musicMeta": music_meta} if music_url else {}), "svgTimeline": stages,
            "shotSeconds": [row["seconds"] for row in stages]}


def preview_svg_speech(p, save, job, speech_key, record):
    item = p["items"][0]
    job["progress"] = "生成本幕口播试听"
    save()
    audio, spoken = svg_shot_audio(p, item, item["index"], speech_key, record)
    job["output"] = {"url": f"/media/{audio.name}", "seconds": spoken,
                     "subtitles": svg_caption_progress(item["line"].strip(), spoken, item.get("beats"))}


def render_code_motion(p, job, save, speech_key, record, dashscope_key=""):
    template_info = p.get("templateInfo")
    script = ({"title": p["title"], "scenes": p["items"]} if template_info else code_motion_payload_script(p))
    fps = 24 if template_info else CODE_MOTION_FPS
    appearance = code_motion_appearance(p)
    font = ASSETS.resolve(p["settings"]["fontId"], ("font",)) if not template_info and p["settings"].get("fontId") else None
    used_assets = [font] if font else []
    base = job["id"]
    folder = JOBS / base
    folder.mkdir(parents=True, exist_ok=True)
    shots, entries, durations = [], [], []
    cached = cached_template_speech(p)
    elapsed = 0.0
    for index, scene in enumerate(script["scenes"]):
        job["progress"] = f"准备第 {index + 1} / {len(script['scenes'])} 页口播"
        save()
        audio_folder = folder / str(index)
        audio_folder.mkdir(exist_ok=True)
        line = scene["line"].strip()
        audio, spoken = template_shot_audio(p["settings"], line, audio_folder, speech_key, index, record, cached)
        start = elapsed
        if template_info:
            seconds = template_slide_seconds(scene, spoken)
            cues = []
            cursor = start
            for cue, length in zip(scene["cues"], template_cue_seconds(scene["cues"], seconds, spoken)):
                cleaned_text = strip_trailing_subtitle_punctuation(cue.get("text", ""))
                cues.append({**cue, "text": cleaned_text, "start": cursor, "end": min(cursor + length, start + seconds)})
                cursor += length
                if cursor >= start + seconds:
                    break
        else:
            if spoken > 0:
                tail = 0.65 if scene.get("visual") == "summary" else 0.45
                seconds = max(round(3.2 * fps), math.ceil((spoken + tail) * fps)) / fps
            else:
                est = float(scene.get("seconds") or draft_content.template_slide_seconds(line))
                seconds = max(round(3.2 * fps), round(est * fps)) / fps
            cues = code_motion_shot_captions(scene, start, spoken or seconds)
        elapsed = end = start + seconds
        if cues:
            cues[-1]["end"] = end
        shot = {**scene, "start": start, "end": end, "captions": cues}
        if not template_info and scene.get("libraryArtId"):
            image = ASSETS.resolve(scene["libraryArtId"], ("image", "svg"))
            used_assets.append(image)
            shot["libraryArtUrl"] = image[0].as_uri()
        shots.append(shot)
        entries.append((audio, seconds))
        durations.append(seconds)

    voiced = any(audio for audio, _ in entries)
    music, track, music_url, music_meta = resolve_video_music(p)
    if music:
        used_assets.append((music, library_music_item(music_meta) if music_meta else preset_music_item(track)))
    frames = round(elapsed * fps)
    duration = frames / fps
    avatar = p.get("avatar")
    portrait = appearance["pharmacist"].get("avatarImage") if appearance["presenter"] == "digital" else None
    avatar_mp4 = (
        generate_template_avatar_video(avatar, entries, folder, job, save, dashscope_key, record)
        if avatar and voiced else None
    )
    with tempfile.TemporaryDirectory(dir=folder, prefix="motion-") as temp:
        scratch = Path(temp)
        voice = build_template_speech_wav(entries, scratch / "speech.wav", scratch)
        if avatar_mp4:
            job["progress"] = "准备同版式药师头像动效"
            save()
            run_ffmpeg(
                "-i", avatar_mp4, "-an", "-vf",
                f"fps={fps},scale=180:180:force_original_aspect_ratio=increase,"
                f"crop=180:180:(iw-ow)/2:(ih-oh)*0.2,tpad=stop_mode=clone:stop_duration={duration:.3f}",
                "-frames:v", frames, "-start_number", 0, "-q:v", 3, scratch / "avatar-%05d.jpg",
            )
        manifest = scratch / "motion.json"
        write_json(manifest, {
            "title": script["title"],
            "shortTitle": script.get("shortTitle"),
            "chapters": script.get("chapters"),
            "disclaimer": script.get("disclaimer"),
            "shots": shots,
            "appearance": appearance,
            "fps": fps,
            "frames": frames,
            "hasAvatarFrames": bool(avatar_mp4),
            "templateInfo": template_info,
            "localAvatar": media_path(portrait).as_uri() if portrait else None,
            "fontId": font[1]["id"] if font else None,
        })
        job["progress"] = f"逐帧渲染代码动效（{len(shots)} 幕 · {frames} 帧）"
        save()
        result = subprocess.run(
            [shutil.which("node"), str(ROOT / "scripts/render-code-motion.mjs"), str(manifest), str(scratch)],
            cwd=ROOT, capture_output=True, timeout=max(300, frames / 15 + 60),
        )
        if result.returncode:
            detail = result.stderr.decode("utf-8", "replace")
            error = next((line.removeprefix("Error: ") for line in detail.splitlines()
                          if line.startswith(("Error: ", "page."))), "请核对 Chrome 和 Playwright 安装。")
            raise ValueError(f"代码动效渲染失败：{error[:260]}")
        job["progress"] = "合成代码动效、配音与 MP4"
        save()
        music_input = ["-stream_loop", "-1", "-i", music] if music else []
        sfx_input, mix, sounds = library_sound_mix(shots, music, track, duration, voiced)
        versions = asset_versions([*used_assets, *sounds])
        output = scratch / "output.mp4"
        run_ffmpeg(
            "-i", voice, "-framerate", fps, "-start_number", 0, "-i", scratch / "frame-%05d.jpg",
            *music_input, *sfx_input, "-map", "1:v:0", *mix, "-t", f"{duration:.3f}",
            "-c:v", "libx264", "-preset", "fast", "-crf", 18, "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output,
        )
        captions = scratch / "captions.vtt"
        captions.write_text("WEBVTT\n\n" + "\n".join(caption_vtt(cue) for shot in shots for cue in shot["captions"]),
                            encoding="utf-8")
        captions.replace(MEDIA / (base + ".vtt"))
        poster_idx = min(round(fps * 1.4), max(0, frames - 1))
        (scratch / f"frame-{poster_idx:05d}.jpg").replace(MEDIA / (base + ".jpg"))
        output.replace(MEDIA / (base + ".mp4"))
    return {
        "url": f"/media/{base}.mp4", "poster": f"/media/{base}.jpg", "captions": f"/media/{base}.vtt",
        "burnedCaptions": True, "music": track, "shotSeconds": durations,
        **({"musicUrl": music_url, "musicMeta": music_meta} if music_url else {}),
        **({"assets": versions} if versions else {}),
    }


def stage_appearance(p, images=None, used=None):
    appearance = code_motion_appearance(p)
    raw = p.get("appearance", {})
    theme_id = raw.get("themeId")
    if theme_id is None:
        return appearance
    if not isinstance(theme_id, str) or not theme_id.strip():
        raise ValueError("所选主题无效。")
    definition, theme_item, theme_path = ASSETS.theme(theme_id)
    base = definition["base"]
    appearance.update(
        theme=base,
        themeId=theme_id,
        themeVars=dict(definition["vars"]),
        themeGlass=bool(definition.get("glass")),
        themeFadeColor=definition.get("fadeColor") or ("#fdf5e7" if base == "warm" else "#edf6fe"),
    )
    if used is not None:
        used.append((theme_path, theme_item))
    if background := definition.get("background"):
        bg_path, bg_item = ASSETS.resolve(background["assetId"], ("image",))
        bg_url = asset_library.asset_url(background["assetId"])
        appearance["themeBackground"] = bg_url
        if images is not None:
            images[bg_url] = bg_path.as_uri()
        if used is not None:
            used.append((bg_path, bg_item))
    return appearance


def validate_stage_video(p):
    settings = p.get("settings")
    if not isinstance(settings, dict) or settings.get("voice") not in (*SPEAKERS, "无配音"):
        raise ValueError("未知配音")
    if settings.get("ratio") != "16:9":
        raise ValueError("当前视频布局固定为 16:9。")
    stage_video.stage_input(p, ASSETS, media_path)
    stage_video.sound_settings(p, ASSETS)
    appearance = stage_appearance(p)
    if not code_motion_ready():
        raise ValueError("视频合成需要 Node.js、Playwright 和 FFmpeg。")
    if settings["voice"] in SPEAKERS and not current_speech_key() and not has_template_speech(p):
        raise ValueError("请先配置火山语音，再合成带配音的视频。")
    if p.get("avatar") is not None:
        avatar = p["avatar"]
        if (not isinstance(avatar, dict) or avatar.get("enabled") is not True or settings["voice"] not in SPEAKERS
                or appearance["presenter"] == "none" or avatar.get("presenter") != appearance["presenter"]):
            raise ValueError("数字人设置与当前主讲人不匹配。")
        validate_template_avatar(avatar, True, check_key=not p.get("previousVideo"))
    if settings.get("fontId"):
        ASSETS.resolve(settings["fontId"], ("font",))
    validate_video_music_settings(settings)


def _stage_cues(shot, start, seconds, spoken):
    source = shot["cues"] or [{"text": text, "weight": len(text), "focus": "all"}
                              for text in caption_chunks(shot["line"], 22)]
    source = source or [{"text": shot["line"], "weight": 1, "focus": "all"}]
    cues, cursor = [], start
    for cue, length in zip(source, template_cue_seconds(source, seconds, spoken)):
        text = strip_trailing_subtitle_punctuation(cue.get("text", ""))
        cues.append({**cue, "text": text, "start": cursor, "end": min(cursor + length, start + seconds)})
        cursor += length
        if cursor >= start + seconds:
            break
    return cues


def build_timeline(p, shots, folder, speech_key, record=None, progress=None):
    """Prepare narration and provide the authored frame times and absolute subtitle cues."""
    compatible = p.get("compatibility")
    fps = CODE_MOTION_FPS if compatible == "scene" else 24
    cached = cached_template_speech(p)
    entries, caption_rows, elapsed = [], [], 0.0
    for index, shot in enumerate(shots):
        if progress:
            progress(f"准备第 {index + 1} / {len(shots)} 幕口播")
        audio_dir = folder / str(index)
        audio_dir.mkdir(parents=True, exist_ok=True)
        line = shot["line"]
        speaker = SPEAKERS.get(p["settings"]["voice"])
        prior = svg_speech_cache_path(p, line, speaker) if speaker and p.get("workId") and shot["kind"] == "svg" else None
        if prior and prior.is_file():
            with wave.open(str(prior)) as wav:
                audio, spoken = prior, wav.getnframes() / wav.getframerate()
        else:
            audio, spoken = template_shot_audio(p["settings"], line, audio_dir, speech_key, index, record, cached)
        if compatible == "svg":
            frames, moving = svg_motion.timing(spoken, shot["seconds"])
            seconds = frames / fps
            shot["motionSeconds"] = moving / fps
            cues = [{**cue, "start": elapsed + cue["start"], "end": elapsed + cue["end"], "focus": "all"}
                    for cue in svg_caption_intervals(line, spoken or seconds, shot.get("beats"))]
        elif compatible == "scene":
            tail = 0.65 if shot.get("visual") == "summary" else 0.45
            frames = math.ceil((spoken + tail) * fps) if spoken else round(float(shot["seconds"]) * fps)
            seconds = max(round(3.2 * fps), frames) / fps
            cues = code_motion_shot_captions(shot, elapsed, spoken or seconds)
        else:
            seconds = template_slide_seconds(shot, spoken)
            cues = _stage_cues(shot, elapsed, seconds, spoken)
        end = elapsed + seconds
        if compatible != "svg" and cues:
            cues[-1]["end"] = end
        shot.update(start=elapsed, end=end, captions=cues)
        entries.append((audio, seconds))
        if compatible == "image":
            caption_rows.extend(shot_caption_intervals(line, elapsed, min(spoken, seconds - 0.15) if spoken else seconds, "16:9"))
        else:
            caption_rows.extend(cues)
        elapsed = end
    vtt = "WEBVTT\n\n" + "\n".join(caption_vtt(cue) for cue in caption_rows)
    return {"shots": shots, "entries": entries, "fps": fps, "frames": round(elapsed * fps), "vtt": vtt}


def render_motion_preview(asset, destination):
    if not code_motion_ready():
        raise ValueError("生成动画预览需要 Node.js、Chrome、Playwright 和 FFmpeg。")
    destination.mkdir(parents=True, exist_ok=True)
    duration = max(2.0, min(4.0, asset["duration"]))
    fps = 12
    with tempfile.TemporaryDirectory(prefix="motion-preview-", dir=destination) as tmp:
        scratch = Path(tmp)
        manifest = scratch / "preview.json"
        slide = {"name": "动画预览", "line": "", "type": "explain", "layoutMode": "explain", "seconds": duration}
        plan = {
            "fps": fps, "frames": round(duration * fps), "fontId": None, "images": {},
            "layout": {"canvas": {"w": 1280, "h": 720}, "regions": {
                "media": {"x": 0, "y": 0, "w": 100, "h": 100, "component": "media"}}},
            "deck": {"title": "动画预览", "theme": asset.get("theme", "medical"), "presenter": "none",
                     "chapters": ["预览", "结束"], "slides": [slide]},
            "shots": [{"name": "动画预览", "line": "", "kind": "mg", "start": 0, "end": duration, "captions": [],
                       "overlay": "off", "fit": "auto", "motionAsset": asset}],
        }
        write_json(manifest, plan)
        try:
            response = subprocess.run([shutil.which("node"), str(ROOT / "scripts/render-stage.mjs"),
                                       str(manifest), str(scratch)], cwd=ROOT, capture_output=True, timeout=45)
        except subprocess.TimeoutExpired:
            raise ValueError("动画预览渲染超时，请检查文件并重试。") from None
        if response.returncode:
            raise ValueError("动画预览失败，请检查导出的图层与关键帧。")
        run_ffmpeg("-f", "concat", "-safe", "0", "-i", scratch / "frames.txt", "-vf", f"fps={fps},scale=480:270",
                   "-t", f"{duration:.3f}", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                   "-movflags", "+faststart", scratch / "preview.mp4")
        run_ffmpeg("-i", scratch / "poster.jpg", "-vf", "scale=480:270", scratch / "thumb.jpg")
        (scratch / "thumb.jpg").replace(destination / "poster.jpg")
        (scratch / "preview.mp4").replace(destination / "preview.mp4")


def render_stage_video(p, job, save, speech_key, record=None, dashscope_key=""):
    layout, deck, shots, images, used = stage_video.stage_input(p, ASSETS, media_path)
    appearance = stage_appearance(p, images, used)
    deck.update(appearance)
    deck["slides"] = [shot.pop("slide") for shot in shots]
    if appearance["presenter"] == "digital" and appearance["pharmacist"].get("avatarImage"):
        url = appearance["pharmacist"]["avatarImage"]
        images[url] = media_path(url).as_uri()
    else:
        for name in ("digital", "cartoon"):
            url = f"/assets/template-doctor-{name}.jpg"
            images[url] = media_path(url).as_uri()
    base = job["id"]
    folder = JOBS / base
    folder.mkdir(exist_ok=True)

    def progress(message):
        job["progress"] = message
        save()

    timeline = build_timeline(p, shots, folder, speech_key, record, progress)
    fps, frames = timeline["fps"], timeline["frames"]
    duration = frames / fps
    entries = timeline["entries"]
    voiced = any(audio for audio, _ in entries)
    avatar = p.get("avatar")
    avatar_mp4 = (generate_template_avatar_video(avatar, entries, folder, job, save, dashscope_key, record)
                  if avatar and voiced else None)
    settings = p["settings"]
    font_id = settings.get("fontId")
    if font_id:
        used.append(ASSETS.resolve(font_id, ("font",)))
    music, track, music_url, music_meta = resolve_video_music(p)
    if music:
        used.append((music, library_music_item(music_meta) if music_meta else preset_music_item(track)))
    with tempfile.TemporaryDirectory(dir=folder, prefix="stage-") as temp:
        scratch = Path(temp)
        voice = build_template_speech_wav(entries, scratch / "speech.wav", scratch)
        if avatar_mp4:
            avatar_size = 2 * round(layout.get("slots", {}).get("avatarSize", 180) / 2)
            run_ffmpeg("-i", avatar_mp4, "-an", "-vf",
                       f"fps={fps},scale={avatar_size}:{avatar_size}:force_original_aspect_ratio=increase,"
                       f"crop={avatar_size}:{avatar_size}:(iw-ow)/2:(ih-oh)*0.2,tpad=stop_mode=clone:stop_duration={duration:.3f}",
                       "-frames:v", frames, "-start_number", 0, "-q:v", 3, scratch / "avatar-%05d.jpg")
        manifest = scratch / "stage.json"
        write_json(manifest, {"deck": deck, "layout": layout, "images": images, "shots": shots, "fps": fps,
                              "frames": frames, "compatibility": p.get("compatibility"), "fontId": font_id,
                              "hasAvatarFrames": bool(avatar_mp4), "imageFocus": not bool(p.get("compatibility"))})
        progress(f"渲染统一舞台（{len(shots)} 幕 · {frames} 帧）")
        result = subprocess.run([shutil.which("node"), str(ROOT / "scripts/render-stage.mjs"), str(manifest), str(scratch)],
                                cwd=ROOT, capture_output=True, timeout=max(300, frames / 15 + 60))
        if result.returncode:
            detail = result.stderr.decode("utf-8", "replace")
            error = next((line.removeprefix("Error: ") for line in detail.splitlines()
                          if line.startswith(("Error: ", "page."))), "请核对 Chrome 和 Playwright 安装。")
            raise ValueError(f"舞台渲染失败：{error[:260]}")
        progress("合成画面、配音与 MP4")
        music_input = ["-stream_loop", "-1", "-i", music] if music else []
        event_rows = read_json(scratch / "events.json")
        sfx_input, mix, sounds = stage_sound_mix(p, shots, music, track, duration, voiced, event_rows)
        output = scratch / "output.mp4"
        render_stats = read_json(scratch / "capture-stats.json")
        sequence = render_stats["captures"] == frames and (scratch / "frame-00000.jpg").is_file()
        video_input = (["-framerate", fps, "-start_number", 0, "-i", scratch / "frame-%05d.jpg"] if sequence
                       else ["-f", "concat", "-safe", "0", "-i", scratch / "frames.txt"])
        run_ffmpeg("-i", voice, *video_input,
                   *music_input, *sfx_input, "-map", "1:v:0", *mix, "-vf", f"fps={fps}",
                   "-t", f"{duration:.4f}", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output)
        caption_path = scratch / "captions.vtt"
        caption_path.write_text(timeline["vtt"], encoding="utf-8")
        asset_refs = asset_versions([*used, *sounds])
        (scratch / "events.json").replace(folder / "events.json")
        caption_path.replace(MEDIA / (base + ".vtt"))
        (scratch / "poster.jpg").replace(MEDIA / (base + ".jpg"))
        output.replace(MEDIA / (base + ".mp4"))
    if record:
        record("stage-render", work_costs.entry("视频舞台", "本地渲染", f"{frames} 帧 · 720p", 0))
    return {"url": f"/media/{base}.mp4", "poster": f"/media/{base}.jpg", "captions": f"/media/{base}.vtt",
            "burnedCaptions": True, "music": track, "shotSeconds": [seconds for _, seconds in entries],
            "assetVersions": asset_refs,
            "renderStats": render_stats,
            **({"musicUrl": music_url, "musicMeta": music_meta} if music_url else {})}


def render_video(p, job, save, speech_key, record=None, dashscope_key=""):
    if p.get("stage") is True:
        return render_stage_video(p, job, save, speech_key, record, dashscope_key)
    if p.get("codeMotion") is True:
        return render_code_motion(p, job, save, speech_key, record, dashscope_key)
    if p.get("svg") is True:
        return render_svg_video(p, job, save, speech_key, record)
    if p.get("template") is True:
        return render_template_video(p, job, save, speech_key, record, dashscope_key)
    settings = p["settings"]
    music, track, music_url, music_meta = resolve_video_music(p)
    music_extra = {"musicUrl": music_url, "musicMeta": music_meta} if music_url else {}
    segments = []
    cues = ["WEBVTT\n"]
    start = 0
    shot_seconds = []
    items = p["items"]
    storyboard = p.get("storyboard") is True
    for i, item in enumerate(items):
        folder = JOBS / job["id"] / str(i)
        folder.mkdir(parents=True, exist_ok=True)
        tail = None
        line = item["line"].strip()
        if storyboard:
            job["progress"] = f"准备第 {i + 1} 幕配音"
            save()
            audio, spoken = shot_audio(settings, line, folder, speech_key, i, record)
            if i + 1 < len(items) and item.get("matchNext") is True:
                tail = items[i + 1]["image"]
            item = storyboard_timing(item, spoken, VIDEO_MODELS[settings["videoModel"]][2], tail)
        job["progress"] = f"制作分镜 {i + 1} / {len(p['items'])}"
        save()
        # Reuse unchanged shots across edits. Only changed pictures/prompts require a new Ark render.
        fingerprint = [
            p["mode"],
            settings["videoModel"],
            settings["ratio"],
            settings["resolution"],
            settings["watermark"],
            item["image"],
            item["prompt"],
            item["seconds"],
        ]
        if tail:
            fingerprint.append(tail)
        digest = hashlib.sha256(
            json.dumps(fingerprint, ensure_ascii=False).encode()
        ).hexdigest()
        source = DATA / (digest + ".mp4")
        state = job["remote"].get(str(i), {})
        if not source.is_file():
            temp = folder / "source.tmp.mp4"
            state = job["remote"].setdefault(str(i), {})

            def report_video(result):
                tokens = work_costs.usage_value(result.get("usage"), "completion_tokens")
                seconds = result.get("duration")
                if type(seconds) not in (int, float) or not 0 < seconds <= 120:
                    seconds = item["seconds"]
                record(f"video:{i}:{state['remote']}", work_costs.video_cost(
                    settings["videoModel"], settings["resolution"], seconds, tokens, i, frame_size(settings),
                ))

            source_clip(p, item, temp, state, save, tail, report_video if record else None)
            temp.replace(source)
        elif record and not state.get("remote"):
            record(f"video-cache:{i}", work_costs.entry(
                f"第 {i + 1} 幕动画", settings["videoModel"], "复用本地视频", 0, i,
            ))
        if not storyboard:
            audio, spoken = shot_audio(settings, line, folder, speech_key, i, record)
        clip = timed_clip(p, item, source, folder, audio, spoken)
        segments.append(clip)
        seconds = item["seconds"]
        audible = min(spoken, seconds - 0.15) if spoken else seconds
        cues.extend(shot_captions(line, start, audible, settings["ratio"]))
        shot_seconds.append(seconds)
        start += seconds
    job["progress"] = "合并分镜、配音、背景音乐与字幕" if music else "合并分镜、配音与字幕"
    save()
    base = job["id"]
    captions = MEDIA / (base + ".vtt")
    captions.write_text("\n".join(cues), encoding="utf-8")
    listing = JOBS / base / "clips.txt"
    listing.write_text(
        "\n".join(f"file '{i}/clip.mp4'" for i in range(len(segments))),
        encoding="utf-8",
    )
    music_input = ["-stream_loop", -1, "-i", music] if music else []
    voiced = settings["voice"] in SPEAKERS and any(item["line"].strip() for item in p["items"])
    audio = (
        ["-filter_complex", music_mix(start, voiced, is_generated=(track == "auto" or str(track).startswith("library:"))), "-map", "[mix]", "-c:a", "aac", "-b:a", "160k"]
        if music else ["-map", "0:a", "-c:a", "copy"]
    )
    run_ffmpeg(
        "-f",
        "concat",
        "-safe",
        1,
        "-i",
        listing,
        "-i",
        captions,
        *music_input,
        "-map",
        "0:v",
        *audio,
        "-map",
        "1:0",
        "-c:v",
        "copy",
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=zho",
        "-movflags",
        "+faststart",
        MEDIA / (base + ".mp4"),
    )
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track, "shotSeconds": shot_seconds, **music_extra}


def write_draft(p, job, save, record=None):
    model = p["settings"].get("textModel") or default_text_model()

    def tracked_deepseek(label):
        def request(path, body, **kwargs):
            result = deepseek(path, body, **kwargs)
            if record:
                record(f"text:{uuid.uuid4()}", work_costs.text_cost(
                    label, result.get("model") or body["model"], result.get("usage") or {},
                ))
            return result
        return request

    item = p["draft"]
    if item["type"] == "video":
        settings = p["settings"]
        if item.get("videoMode") == "stage":
            if "produceShot" in item:
                job["progress"] = "按所选方式制作本幕画面"
                save()
                job["output"] = {"content": mix_plan.produce_shot(tracked_deepseek("单幕画面制作"), model, item, ASSETS)}
                return
            script = item.get("script") or job.get("stageScript")
            if script is None:
                job["progress"] = "撰写视频脚本"
                save()
                script = mix_plan.write_script(
                    tracked_deepseek("视频脚本"), model, item, settings.get("duration"), ASSETS.stage_catalog(),
                )
                job["stageScript"] = script
                save()
            job["progress"] = "编排各幕呈现方式"
            save()
            label = {"mix": "Mix 编排呈现", "svg": "SVG 道具编排", "mg": "MG 动画编排"}.get(item["presentation"])
            job["output"] = mix_plan.arrange(tracked_deepseek(label), model, item, script, ASSETS)
            return
        if item.get("videoMode") == "code-motion":
            ref_duration = settings.get("duration")
            job["progress"] = (
                f"按 {ref_duration} 秒动态编排代码动效分镜"
                if ref_duration
                else "按主题动态编排代码动效分镜"
            )
            save()
            job["output"] = draft_content.code_motion_draft(
                tracked_deepseek("代码动效脚本"), model, item, ref_duration,
            )
            return
        if item.get("videoMode") == "svg":
            job["progress"] = "用 DeepSeek 规划 SVG 道具、动作与口播"
            save()
            job["output"] = draft_content.svg_video_draft(
                tracked_deepseek("SVG 分镜与口播"), model, item, settings.get("duration"),
            )
            return
        if item.get("videoMode") == "template":
            ref_duration = settings.get("duration")
            job["progress"] = (
                f"按 {ref_duration} 秒规划模板分镜与口播脚本"
                if ref_duration
                else "按主题规划模板分镜与口播脚本"
            )
            save()
            job["output"] = draft_content.template_video_draft(
                tracked_deepseek("模板讲解脚本"), model, item, ref_duration,
            )
            return
        job["progress"] = "撰写完整口播并划分分镜"
        save()
        job["output"] = draft_content.video_draft(
            tracked_deepseek("口播与分镜脚本"), model, item, settings.get("duration"), VIDEO_MODELS[settings["videoModel"]][2],
            settings.get("ratio", "9:16"),
        )
        return

    if not job.get("output"):
        job["progress"] = "撰写文章正文"
        save()
        job["output"] = draft_content.article_draft(tracked_deepseek("文章正文"), model, item)
    if "images" not in job["output"]:
        job["progress"] = "根据正文规划配图"
        save()
        job["output"]["images"] = draft_content.article_images(
            tracked_deepseek("规划文章配图"), model, job["output"], item["layout"],
        )


def write_mg_draft(p, job, save, record):
    model = p["settings"].get("textModel") or default_text_model()
    item = p["mg"]

    def progress(message):
        job["progress"] = message
        save()

    def tracked(path, body, **kwargs):
        result = deepseek(path, body, **kwargs)
        record(f"text:{uuid.uuid4()}", work_costs.text_cost(
            "MG 动画素材制作", result.get("model") or body["model"], result.get("usage") or {},
        ))
        return result

    generated = job.get("mgDraft")
    if generated is None:
        progress("用 DeepSeek 制作无字矢量动画")
        generated = mg_generation.generate(tracked, model, item, lambda n: progress(f"按校验结果修正 MG 规格（{n}/2）"))
        job["mgDraft"] = generated
        save()
    progress("在本机渲染 MG 预览")
    job["output"] = ASSETS.save_pending("pending:" + job["id"], generated, model, render_motion_preview, item.get("parentId"))


def work(job, key=None, speech_key="", deepseek_key=None, dashscope_key=""):
    def save():
        with CACHE_LOCK:
            write_json(JOBS / (job["id"] + ".json"), job)

    def record(key, row):
        costs = job.setdefault("costs", {})
        if costs.get(key) != row:
            costs[key] = row
            save()

    JOB_CREDENTIALS.key = key
    JOB_CREDENTIALS.deepseek_key = deepseek_key
    JOB_CREDENTIALS.dashscope_key = dashscope_key
    try:
        with SLOTS:
            p = job["request"]
            job.update(status="running", error="")
            save()
            if p["kind"] == "images":
                for i in range(len(job["results"]), len(p["items"])):
                    job["progress"] = f"生成配图 {i + 1} / {len(p['items'])}"
                    save()
                    job["results"].append(image_item(p, p["items"][i], i, record))
                    save()
                job["output"] = {"images": job["results"]}
            elif p["kind"] == "draft":
                write_draft(p, job, save, record)
            elif p["kind"] == "mg-draft":
                write_mg_draft(p, job, save, record)
            elif p["kind"] == "svg-speech":
                preview_svg_speech(p, save, job, speech_key, record)
            else:
                job["output"] = render_video(p, job, save, speech_key, record, dashscope_key)
            job["status"] = "done"
    except Exception as error:
        job.update(status="failed", error=str(error)[:650])
    finally:
        with CACHE_LOCK:
            save()
            ACTIVE.discard(job["id"])


def visible(job):
    return {k: job.get(k) for k in ("id", "status", "progress", "error", "output")}


def job_costs(job):
    p = job["request"]
    settings = p["settings"]
    recorded = job.get("costs", {})
    rows = list(recorded.values())
    # Older requests had no work ID or per-call usage. Recover what the saved outputs establish.
    legacy = not p.get("workId")
    if legacy and p["kind"] == "draft" and job.get("output") and not any(k.startswith("text:") for k in recorded):
        rows.append(work_costs.entry("历史文字生成", "", "缺少 Token 用量", None))
    elif legacy and p["kind"] == "images" and p["mode"] == "ark":
        size = SIZES[settings["imageSize"]][settings["ratio"]]
        for index, item in enumerate(p["items"][:len(job.get("results", []))]):
            if not any(k.startswith(f"image:{index}:") for k in recorded):
                rows.append(work_costs.image_cost(settings["imageModel"], size, len(image_references(p, item)), index))
    elif p["kind"] == "video":
        output = job.get("output") or {}
        seconds = output.get("shotSeconds") or [item.get("seconds") for item in p["items"]]
        for index, item in enumerate(p["items"]):
            folder = JOBS / job["id"] / str(index)
            state = job.get("remote", {}).get(str(index), {})
            if p["mode"] == "ark" and not (p.get("template") or p.get("codeMotion")) and (state.get("remote") or state.get("submitting")) and not any(
                k.startswith(f"video:{index}:") for k in recorded
            ):
                # A completed clip proves the remote request succeeded. A submitted ID alone does not.
                duration = seconds[index] if output.get("url") else None
                if duration is None and not p.get("storyboard") and (folder / "clip.mp4").is_file():
                    duration = item["seconds"]
                rows.append(work_costs.video_cost(
                    settings["videoModel"], settings["resolution"], duration, None, index, frame_size(settings),
                ))
            if legacy and f"speech:{index}" not in recorded and any(folder.glob("speech-*.wav")):
                rows.append(work_costs.speech_cost(None, item["line"].strip(), settings["voice"], index))
    return rows


def cost_details(request):
    if not isinstance(request.get("workId"), str) or not isinstance(request.get("jobIds", []), list) or not isinstance(request.get("media", []), list):
        raise ValueError("费用查询格式无效")
    if not all(isinstance(job_id, str) for job_id in request.get("jobIds", [])):
        raise ValueError("任务 ID 无效")
    work_id = str(uuid.UUID(request["workId"]))
    job_ids = {str(uuid.UUID(job_id)) for job_id in request.get("jobIds", [])}
    assets = {url for url in request.get("media", []) if isinstance(url, str) and re.fullmatch(
        r"/media/[a-f0-9-]+\.(?:jpg|png|webp|mp4)", url,
    )}
    rows = []
    unresolved = False
    for path in sorted(JOBS.glob("*.json"), key=lambda file: file.stat().st_mtime):
        job = read_json(path)
        p = job["request"]
        known_work = p.get("workId")
        output = job.get("output") or {}
        if known_work:
            if known_work != work_id:
                continue
        elif job["id"] not in job_ids and output.get("url") not in assets and not assets.intersection(job.get("results", [])):
            continue
        rows.extend(job_costs(job))
        if job["status"] in ("queued", "running", "failed"):
            unresolved = True
    amounts = [float(row["amount"]) for row in rows if row["amount"] is not None]
    return {"rows": rows, "total": math.fsum(amounts) if amounts else None, "unresolved": unresolved,
            "priceDate": work_costs.PRICE_DATE, "arkPrice": work_costs.ARK_PRICE,
            "deepseekPrice": work_costs.DEEPSEEK_PRICE, "speechPrice": work_costs.SPEECH_PRICE,
            "dashscopePrice": work_costs.DASHSCOPE_PRICE, "murekaPrice": work_costs.MUREKA_PRICE}


BUILTIN_MUSIC_CREDITS = {
    "bedb95f1a36f": "Clean Soul · Kevin MacLeod",
    "fa687d97d550": "Friday Morning · Kevin MacLeod",
    "bc4296a1138c": "Carefree · Kevin MacLeod",
    "2142ab73a83b": "Solace · Scott Buckley",
}


def library_music_item(track):
    credit = BUILTIN_MUSIC_CREDITS.get(track["id"], "")
    return {
        "id": "library:" + track["id"], "kind": "music", "name": track["title"],
        "url": track["url"], "tags": [value for key in ("mood", "styleLabel") if (value := track.get(key))],
        "source": "项目曲库" if track.get("provider") == "library" else track.get("provider", "项目曲库"),
        "license": "CC BY 4.0" if credit else "待核对",
        "credit": credit,
        **({"termsUrl": "/assets/music/generated/" + quote("配乐来源与署名.md")} if credit else {}),
    }


def preset_music_item(choice):
    name = {"calm": "舒缓钢琴", "light": "轻快木琴"}[choice]
    return {"id": "builtin:music/" + choice, "choice": choice, "kind": "music", "name": name,
            "url": "/assets/music/" + choice + ".flac", "tags": [], "source": "工作台预设", "license": "待核对"}


def list_assets():
    items = ASSETS.items()
    return [
        *(item for item in items if item["kind"] not in ("layout", "theme")),
        *ASSETS.layout_items(items),
        *ASSETS.theme_items(items),
        *(library_music_item(track) for track in music_gen.list_music_library(GENERATED_MUSIC_DIR)),
        *(preset_music_item(choice) for choice, path in MUSIC_TRACKS.items() if path.is_file()),
        *({"id": "builtin:motion/" + action, "kind": "motion", "name": label, "action": action,
           "source": "内置", "license": "项目自制", "tags": []} for action, label in svg_motion.ACTIONS.items()),
    ]


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, code, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        return self.headers.get("Host") in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")

    def do_GET(self):
        if not self.allowed():
            return self.send_error(403)
        path = urlsplit(self.path).path
        if path == "/api/config":
            return self.send_json(
                200,
                {
                    "imageModels": IMAGE_MODELS,
                    "videoModels": VIDEO_MODELS,
                    "textModels": text_models(),
                    "textModel": default_text_model(),
                    "avatarModels": AVATAR_MODELS,
                    "avatarMotions": AVATAR_MOTIONS,
                    "avatarLipSync": True,
                    "musicModels": music_gen.MUSIC_MODELS,
                    "musicModel": music_gen.DEFAULT_MUSIC_MODEL,
                    "musicLibrary": music_gen.list_music_library(GENERATED_MUSIC_DIR, include_archived=True),
                    "workCosts": True,
                    "videoBackgroundMusic": True,
                    "videoAutoMusicGeneration": False,
                    "imageStyleReference": True,
                    **ark_connection(),
                    **deepseek_connection(),
                    **dashscope_connection(),
                    **mureka_connection(),
                    "encoder": bool(FFMPEG),
                    "codeMotionReady": code_motion_ready(),
                    "templateMotionSwitch": True,
                    "stageRender": STAGE_RENDER,
                    "stageShotProduction": True,
                    "stageLayouts": ASSETS.layout_items(),
                    "stageThemes": ASSETS.theme_items(),
                    "layoutVariants": asset_library.LAYOUT_VARIANTS,
                    "stageCatalog": ASSETS.stage_catalog(),
                    "motionPalette": motion_asset.THEME_PALETTE,
                    "mgGeneration": True,
                    "imageRates": work_costs.image_estimate_rates(),
                    "sfxPacks": ASSETS.sound_packs(),
                    "svgMotion": {"actions": svg_motion.ACTIONS, "exportReady": svg_motion.ready(FFMPEG)},
                    **speech_connection(),
                    "keyStorage": KEY_STORAGE,
                },
            )
        if path == "/api/music-library":
            return self.send_json(200, {"tracks": music_gen.list_music_library(GENERATED_MUSIC_DIR, include_archived=True)})
        if path == "/api/library":
            with CACHE_LOCK:
                return self.send_json(200, {"items": list_assets()})
        if path == "/api/library/mg-pending":
            return self.send_json(200, {"items": ASSETS.pending_items()})
        if m := re.fullmatch(r"/library-pending/([^/]+)/(poster\.jpg|preview\.mp4)", path):
            try:
                return self.file_response(ASSETS.pending_preview_file(unquote(m[1]), m[2]))
            except ValueError:
                return self.send_error(404)
        if m := re.fullmatch(r"/api/library/motion/([^/]+)", path):
            try:
                asset, _, _ = ASSETS.motion(unquote(m[1]))
                return self.send_json(200, asset)
            except ValueError as error:
                return self.send_json(404, {"error": str(error)})
        if m := re.fullmatch(r"/library-preview/([^/]+)/(poster\.jpg|preview\.mp4)", path):
            try:
                return self.file_response(ASSETS.motion_preview_file(unquote(m[1]), m[2]))
            except ValueError:
                return self.send_error(404)
        if path.startswith("/library/"):
            try:
                file, _ = ASSETS.resolve(unquote(path.removeprefix("/library/")))
            except ValueError:
                return self.send_error(404)
            return self.file_response(file)
        if m := re.fullmatch(r"/api/jobs/([a-f0-9-]{36})", path):
            file = JOBS / (m[1] + ".json")
            if file.is_file():
                with CACHE_LOCK:
                    job = read_json(file)
                    if job["status"] in ("running", "queued") and m[1] not in ACTIVE:
                        job.update(
                            status="failed",
                            error="本地服务已重启。可继续此任务，已完成的步骤将复用。",
                        )
                    return self.send_json(200, visible(job))
            return self.send_json(404, {"error": "未找到这个任务"})
        if path.startswith("/media/"):
            try:
                file = media_path(path)
            except ValueError:
                return self.send_error(404)
            return self.file_response(file)
        decoded_path = unquote(path)
        file = (
            (PUBLIC / decoded_path.lstrip("/")).resolve()
            if decoded_path != "/"
            else PUBLIC / "index.html"
        )
        if PUBLIC not in file.parents or not file.is_file():
            return self.send_error(404)
        self.file_response(file)

    def file_response(self, file):
        size = file.stat().st_size
        begin, end = 0, size - 1
        ranged = self.headers.get("Range")
        if ranged:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", ranged)
            if not match:
                return self.send_error(416)
            begin = int(match[1])
            end = min(int(match[2]), end) if match[2] else end
            if begin > end:
                return self.send_error(416)
        self.send_response(206 if ranged else 200)
        self.send_header(
            "Content-Type",
            mimetypes.guess_type(file.name)[0] or "application/octet-stream",
        )
        self.send_header("Content-Length", str(end - begin + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if file.suffix == ".svg":
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        if file.suffix in (".html", ".css", ".js"):
            self.send_header("Cache-Control", "no-cache")
        if ranged:
            self.send_header("Content-Range", f"bytes {begin}-{end}/{size}")
        self.end_headers()
        try:
            with file.open("rb") as f:
                f.seek(begin)
                remaining = end - begin + 1
                while remaining:
                    buf = f.read(min(65536, remaining))
                    if not buf:
                        break
                    self.wfile.write(buf)
                    remaining -= len(buf)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_POST(self):
        if (
            self.path not in ("/api/jobs", "/api/costs", "/api/ark-key", "/api/deepseek-key", "/api/speech-key", "/api/dashscope-key", "/api/mureka-key", "/api/upload-frame", "/api/generate-music", "/api/music-library/rename", "/api/music-library/delete",
                              "/api/library/upload", "/api/library/collect-image", "/api/library/copy-layout", "/api/library/copy-theme", "/api/library/motion-palette", "/api/library/mg-decide", "/api/library/archive")
            or not self.allowed()
            or self.headers.get("Origin") not in (ORIGIN, f"http://localhost:{PORT}")
            or self.headers.get_content_type() != "application/json"
        ):
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            max_bytes = 8_000_000 if self.path == "/api/upload-frame" else (100000 if self.path in ("/api/jobs", "/api/costs", "/api/generate-music") else 4096)
            if self.path == "/api/library/upload":
                max_bytes = 11_200_000
            elif self.path in ("/api/library/collect-image", "/api/library/copy-layout", "/api/library/copy-theme", "/api/library/motion-palette"):
                max_bytes = 32_000
            if not 0 < n <= max_bytes:
                raise ValueError("请求大小无效")
            p = json.loads(self.rfile.read(n))
            if not isinstance(p, dict):
                raise ValueError("请求格式无效")
            if self.path == "/api/upload-frame":
                return self.send_json(200, save_uploaded_frame(p))
            if self.path == "/api/library/upload":
                return self.send_json(200, {"item": ASSETS.upload(p, FFMPEG, render_motion_preview)})
            if self.path == "/api/library/mg-decide":
                if type(p.get("adopt")) is not bool:
                    raise ValueError("请选择采用或丢弃。")
                return self.send_json(200, {"item": ASSETS.decide_pending(p.get("id"), p["adopt"])})
            if self.path == "/api/library/motion-palette":
                return self.send_json(200, {"item": ASSETS.copy_motion_palette(p, render_motion_preview)})
            if self.path == "/api/library/copy-layout":
                return self.send_json(200, {"item": ASSETS.copy_layout(p)})
            if self.path == "/api/library/copy-theme":
                return self.send_json(200, {"item": ASSETS.copy_theme(p)})
            if self.path == "/api/library/collect-image":
                source = media_path(p.get("url"))
                if source.suffix not in (".png", ".jpg", ".webp") or source.stat().st_size > asset_library.LIMITS["image"]:
                    raise ValueError("请选择不超过 8 MB 的现有配图。")
                return self.send_json(200, {"item": ASSETS.add("image", source.read_bytes(), p, FFMPEG, "project")})
            if self.path == "/api/library/archive":
                ASSETS.archive(p.get("id"))
                return self.send_json(200, {"ok": True})
            if self.path == "/api/generate-music":
                return self.send_json(200, generate_music_request(p))
            if self.path == "/api/music-library/rename":
                with CACHE_LOCK:
                    track, library = music_gen.rename_library_track(GENERATED_MUSIC_DIR, p.get("id"), p.get("title"))
                return self.send_json(200, {"track": track, "library": library})
            if self.path == "/api/music-library/delete":
                with CACHE_LOCK:
                    music_gen.archive_library_track(GENERATED_MUSIC_DIR, p.get("id"))
                    library = music_gen.list_music_library(GENERATED_MUSIC_DIR, include_archived=True)
                return self.send_json(200, {"library": library})
            if self.path == "/api/costs":
                return self.send_json(200, cost_details(p))
            if self.path in ("/api/ark-key", "/api/deepseek-key", "/api/speech-key", "/api/dashscope-key", "/api/mureka-key"):
                if self.path == "/api/speech-key":
                    return self.send_json(200, configure_speech(p.get("key")))
                if self.path == "/api/deepseek-key":
                    return self.send_json(200, connect_deepseek(p.get("key")))
                if self.path == "/api/dashscope-key":
                    return self.send_json(200, connect_dashscope(p.get("key")))
                if self.path == "/api/mureka-key":
                    return self.send_json(200, connect_mureka(p.get("key")))
                return self.send_json(200, connect_ark(p.get("key")))
            job_id = str(uuid.UUID(p["id"]))
            if "workId" in p and (not isinstance(p["workId"], str) or str(uuid.UUID(p["workId"])) != p["workId"]):
                raise ValueError("作品 ID 无效")
            setting_valid(p)
            file = JOBS / (job_id + ".json")
            with CACHE_LOCK:
                if file.exists():
                    job = read_json(file)
                    if job["request"] != p:
                        raise ValueError("任务 ID 与内容不匹配")
                    if job["status"] == "done" or job_id in ACTIVE:
                        return self.send_json(200, visible(job))
                else:
                    job = {"id": job_id, "request": p, "remote": {}, "results": []}
                job.update(status="queued", progress="等待本地工作台处理", error="")
                write_json(file, job)
                ACTIVE.add(job_id)
                key = current_ark_key()
                ds_key = current_deepseek_key() if p["kind"] in ("draft", "mg-draft") else None
                motion_avatar = p.get("codeMotion") is True and p.get("avatar") is not None
                dash_key = current_dashscope_key() if p["kind"] == "video" and (p.get("template") is True or motion_avatar or (p.get("stage") is True and p.get("avatar"))) else ""
                threading.Thread(
                    target=work, args=(job, key, current_speech_key(), ds_key, dash_key), daemon=True
                ).start()
                self.send_json(202, visible(job))
        except (ValueError, KeyError, TypeError) as error:
            self.send_json(400, {"error": str(error)})


if __name__ == "__main__":
    import webbrowser

    if "--open" in sys.argv:
        try:
            with urlopen(ORIGIN + "/api/config", timeout=1) as response:
                existing = json.load(response)
            if "imageModels" in existing and "videoModels" in existing:
                webbrowser.open(ORIGIN)
                sys.exit(0)
        except (OSError, ValueError):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if current_deepseek_key():
        def _warm_deepseek_models():
            try:
                refresh_deepseek_models()
            except Exception:
                pass
        threading.Thread(target=_warm_deepseek_models, daemon=True).start()
    if "--open" in sys.argv:
        webbrowser.open(ORIGIN)
    print(f"希息药事  {ORIGIN}", flush=True)
    server.serve_forever()
