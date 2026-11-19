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
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import draft_content
import work_costs

ROOT = Path(__file__).resolve().parent
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/vtt", ".vtt")
PUBLIC = ROOT / "public"
DATA = ROOT / ".studio"
MEDIA = DATA / "media"
JOBS = DATA / "jobs"
KEY_STORAGE = "mac-keychain" if sys.platform == "darwin" else "windows-dpapi" if os.name == "nt" else "session"
if sys.platform == "darwin":
    import mac_keychain
for directory in (MEDIA, JOBS):
    directory.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("STUDIO_PORT", "8765"))
ORIGIN = f"http://127.0.0.1:{PORT}"
ARK = "https://ark.cn-beijing.volces.com/api/v3"
TEXT_MODEL = os.environ.get("ARK_TEXT_MODEL", "").strip() or "doubao-seed-2-1-lite-260915"
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
PAGE_SPEECH_KEY = load_saved_key("speech")


def current_ark_key():
    return PAGE_ARK_KEY or os.environ.get("ARK_API_KEY", "").strip()


def current_speech_key():
    return PAGE_SPEECH_KEY or os.environ.get("VOLC_SPEECH_API_KEY", "").strip()


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


def media_path(url):
    if not isinstance(url, str):
        raise ValueError("缺少分镜图")
    if re.fullmatch(r"/media/[a-f0-9-]+\.(jpg|png|mp4|vtt)", url):
        path = MEDIA / url.split("/")[-1]
    elif re.fullmatch(r"/assets/style-[0-5]\.webp", url):
        path = PUBLIC / url.lstrip("/")
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


def setting_valid(p):
    if p.get("mode") not in ("demo", "ark") or p.get("kind") not in ("images", "video", "draft"):
        raise ValueError("未知的生成方式")
    if p["kind"] == "draft":
        if p["mode"] != "ark" or not current_ark_key():
            raise ValueError("请先连接火山方舟，再生成自定义内容。")
        draft_content.validate_request(p["draft"], p["settings"], VIDEO_MODELS)
        return
    if p["kind"] == "video" and p.get("template") is True:
        s = p["settings"]
        if s.get("voice") != "无配音" and s.get("voice") not in SPEAKERS:
            raise ValueError("未知配音")
        music_path(s.get("music", "off"))
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
            cues = item.get("cues")
            if not isinstance(cues, list) or not 1 <= len(cues) <= 16:
                raise ValueError("每页至少需要 1 张渲染帧")
            for cue in cues:
                if not isinstance(cue, dict):
                    raise ValueError("渲染帧数据无效")
                media_path(cue.get("image", ""))
                if type(cue.get("weight", 1)) not in (int, float) or float(cue.get("weight", 1)) <= 0:
                    raise ValueError("字幕权重无效")
        if (
            s.get("voice") in SPEAKERS
            and any(item.get("line", "").strip() for item in items)
            and not current_speech_key()
        ):
            raise ValueError("请先配置火山语音，再继续合成带配音的模板视频。")
        return
    if p["mode"] == "ark" and not current_ark_key():
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
        music_path(s.get("music", "off"))
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
    style_asset = f"/assets/style-{p['style']}.webp"
    if p["mode"] == "demo":
        time.sleep(0.28)
        if p.get("styleReference") is True:
            return style_asset
        return f"/assets/style-{(p['style'] + index + int(item.get('variant', 0))) % 6}.webp"
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
    if p["mode"] == "demo":
        width, height = frame_size(s, demo=True)
        run_ffmpeg(
            "-loop",
            1,
            "-framerate",
            12,
            "-i",
            media_path(item["image"]),
            "-t",
            item["seconds"],
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-threads",
            2,
            "-pix_fmt",
            "yuv420p",
            dest,
        )
        return
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


def frame_size(s, demo=False):
    short = min(480, int(s["resolution"][:-1])) if demo else int(s["resolution"][:-1])
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


def shot_audio(settings, line, folder, speech_key, index=0, record=None):
    speaker = SPEAKERS.get(settings["voice"])
    if not speaker or not line:
        return None, 0
    fingerprint = json.dumps([SPEECH_RESOURCE, SPEECH_SAMPLE_RATE, speaker, line])
    digest = hashlib.sha256(fingerprint.encode()).hexdigest()
    audio = folder / ("speech-" + digest + ".wav")
    if not audio.is_file():
        characters = narrate(line, speaker, audio, speech_key)
        if record:
            record(f"speech:{index}", work_costs.speech_cost(characters, line, settings["voice"], index))
    with wave.open(str(audio)) as wav:
        return audio, wav.getnframes() / wav.getframerate()


def timed_clip(p, item, source, folder, audio, spoken_seconds):
    settings = p["settings"]
    width, height = frame_size(settings, p["mode"] == "demo")
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


def caption_chunks(line, limit):
    text = " ".join(line.split())
    stops = "，。！？；、：,.!?;:"
    while len(text) > limit:
        cut = next((i for i in range(limit, limit // 2, -1) if text[i - 1] in stops + " "), limit)
        while cut < min(len(text), limit + 1) and text[cut] in stops:
            cut += 1
        yield text[:cut].strip()
        text = text[cut:].lstrip()
    if text:
        yield text


def shot_captions(line, start, seconds, ratio):
    limit = {"9:16": 12, "3:4": 15, "1:1": 17, "16:9": 23}[ratio]
    chunks = list(caption_chunks(line, limit))
    # Use audible length for the whole line, and estimate the cue boundaries within it.
    weights = [sum(0.35 if unicodedata.category(c).startswith("P") else 1 for c in chunk if not c.isspace())
               for chunk in chunks]
    total = sum(weights)
    elapsed = 0
    for chunk, weight in zip(chunks, weights):
        begin = start + seconds * elapsed / total
        elapsed += weight
        end = start + seconds * elapsed / total
        yield f"{stamp(begin)} --> {stamp(end)} position:50% size:84% align:center\n{escape(chunk, quote=False)}\n"


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
    if track == "off":
        return None
    if not isinstance(track, str) or track not in MUSIC_TRACKS:
        raise ValueError("请选择有效的背景音乐。")
    path = MUSIC_TRACKS[track]
    if not path.is_file():
        raise ValueError("缺少内置背景音乐文件，请补齐工作台素材后重试。")
    return path


def music_mix(duration, voiced, music_index=2):
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
        "[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[voice][detector];"
        "[bed][detector]sidechaincompress=threshold=0.055:ratio=4:attack=25:release=550[ducked];"
        "[voice][ducked]amix=inputs=2:duration=first:normalize=0,"
        "alimiter=limit=0.95:level=false:latency=1[mix]"
    )


def render_template_video(p, job, save, speech_key, record=None):
    settings = p["settings"]
    track = settings.get("music", "off")
    music = music_path(track)
    segments = []
    vtt_cues = ["WEBVTT\n"]
    start = 0.0
    shot_seconds = []
    items = p["items"]
    for i, item in enumerate(items):
        folder = JOBS / job["id"] / str(i)
        folder.mkdir(parents=True, exist_ok=True)
        line = item.get("line", "").strip()
        job["progress"] = f"准备第 {i + 1} / {len(items)} 页配音"
        save()
        audio, spoken = shot_audio(settings, line, folder, speech_key, i, record)
        seconds = max(3.5, round(spoken + 0.55, 2)) if spoken else float(item["seconds"])
        job["progress"] = f"合成第 {i + 1} / {len(items)} 页模板画面"
        save()
        cues = item["cues"]
        total_weight = sum(float(c.get("weight", 1)) for c in cues)
        audible = max(1.0, spoken) if spoken else seconds
        lines = []
        elapsed = 0.0
        for ci, cue in enumerate(cues):
            img_file = media_path(cue["image"]).resolve()
            escaped = str(img_file).replace("\\", "/").replace("'", "'\\''")
            if ci == len(cues) - 1:
                dur = max(0.4, round(seconds - elapsed, 3))
            else:
                dur = max(0.4, round(audible * float(cue.get("weight", 1)) / total_weight, 3))
                elapsed += dur
            lines.append(f"file '{escaped}'")
            lines.append(f"duration {dur:.3f}")
        last_img = str(media_path(cues[-1]["image"]).resolve()).replace("\\", "/").replace("'", "'\\''")
        lines.append(f"file '{last_img}'")
        cue_list = folder / "cues.txt"
        cue_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

        audio_in = ["-i", audio] if audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
        clip = folder / "clip.mp4"
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
        segments.append(clip)
        if line:
            vtt_cues.extend(shot_captions(line, start, min(spoken, seconds - 0.15) if spoken else seconds, "16:9"))
        shot_seconds.append(round(seconds))
        start += seconds

    job["progress"] = "合并模板画面、配音与背景音乐" if music else "封装模板科普视频"
    save()
    base = job["id"]
    captions = MEDIA / (base + ".vtt")
    captions.write_text("\n".join(vtt_cues), encoding="utf-8")
    listing = JOBS / base / "clips.txt"
    listing.write_text(
        "\n".join(f"file '{i}/clip.mp4'" for i in range(len(segments))),
        encoding="utf-8",
    )
    music_input = ["-stream_loop", -1, "-i", music] if music else []
    voiced = settings.get("voice") in SPEAKERS and any(item.get("line", "").strip() for item in items)
    audio_args = (
        ["-filter_complex", music_mix(start, voiced, music_index=1), "-map", "[mix]", "-c:a", "aac", "-b:a", "160k"]
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
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track, "shotSeconds": shot_seconds}


def render_video(p, job, save, speech_key, record=None):
    if p.get("template") is True:
        return render_template_video(p, job, save, speech_key, record)
    settings = p["settings"]
    track = settings.get("music", "off")
    music = music_path(track)
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
            if p["mode"] == "ark" and i + 1 < len(items) and item.get("matchNext") is True:
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
        elif record and p["mode"] == "ark" and not state.get("remote"):
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
        ["-filter_complex", music_mix(start, voiced), "-map", "[mix]", "-c:a", "aac", "-b:a", "160k"]
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
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt", "music": track, "shotSeconds": shot_seconds}


def write_draft(p, job, save, record=None):
    def tracked_ark(label):
        def request(path, body, **kwargs):
            result = ark(path, body, **kwargs)
            if record:
                record(f"text:{uuid.uuid4()}", work_costs.text_cost(
                    label, result.get("model") or body["model"], result.get("usage") or {},
                ))
            return result
        return request

    item = p["draft"]
    if item["type"] == "video":
        settings = p["settings"]
        if item.get("videoMode") == "template":
            job["progress"] = "生成 5 页模板结构与口播脚本"
            save()
            job["output"] = draft_content.template_video_draft(
                tracked_ark("模板讲解脚本"), TEXT_MODEL, item,
            )
            return
        job["progress"] = "撰写完整口播并划分分镜"
        save()
        job["output"] = draft_content.video_draft(
            tracked_ark("口播与分镜脚本"), TEXT_MODEL, item, settings.get("duration"), VIDEO_MODELS[settings["videoModel"]][2],
            settings.get("ratio", "9:16"),
        )
        return

    if not job.get("output"):
        job["progress"] = "撰写文章正文"
        save()
        job["output"] = draft_content.article_draft(tracked_ark("文章正文"), TEXT_MODEL, item)
    if "images" not in job["output"]:
        job["progress"] = "根据正文规划配图"
        save()
        job["output"]["images"] = draft_content.article_images(
            tracked_ark("规划文章配图"), TEXT_MODEL, job["output"], item["layout"],
        )


def work(job, key=None, speech_key=""):
    def save():
        with CACHE_LOCK:
            write_json(JOBS / (job["id"] + ".json"), job)

    def record(key, row):
        costs = job.setdefault("costs", {})
        if costs.get(key) != row:
            costs[key] = row
            save()

    JOB_CREDENTIALS.key = key
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
            else:
                job["output"] = render_video(p, job, save, speech_key, record)
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
        seconds = output.get("shotSeconds") or [item["seconds"] for item in p["items"]]
        for index, item in enumerate(p["items"]):
            folder = JOBS / job["id"] / str(index)
            state = job.get("remote", {}).get(str(index), {})
            if p["mode"] == "ark" and not p.get("template") and (state.get("remote") or state.get("submitting")) and not any(
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
            "priceDate": work_costs.PRICE_DATE, "arkPrice": work_costs.ARK_PRICE, "speechPrice": work_costs.SPEECH_PRICE}


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
                    "textModel": TEXT_MODEL,
                    "workCosts": True,
                    "videoBackgroundMusic": True,
                    "imageStyleReference": True,
                    **ark_connection(),
                    "encoder": bool(FFMPEG),
                    **speech_connection(),
                    "keyStorage": KEY_STORAGE,
                },
            )
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
        file = (
            (PUBLIC / path.lstrip("/")).resolve()
            if path != "/"
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
            self.path not in ("/api/jobs", "/api/costs", "/api/ark-key", "/api/speech-key", "/api/upload-frame")
            or not self.allowed()
            or self.headers.get("Origin") not in (ORIGIN, f"http://localhost:{PORT}")
            or self.headers.get_content_type() != "application/json"
        ):
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            max_bytes = 8_000_000 if self.path == "/api/upload-frame" else (100000 if self.path in ("/api/jobs", "/api/costs") else 4096)
            if not 0 < n <= max_bytes:
                raise ValueError("请求大小无效")
            p = json.loads(self.rfile.read(n))
            if not isinstance(p, dict):
                raise ValueError("请求格式无效")
            if self.path == "/api/upload-frame":
                return self.send_json(200, save_uploaded_frame(p))
            if self.path == "/api/costs":
                return self.send_json(200, cost_details(p))
            if self.path in ("/api/ark-key", "/api/speech-key"):
                if self.path == "/api/speech-key":
                    return self.send_json(200, configure_speech(p.get("key")))
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
                key = current_ark_key() if p["mode"] == "ark" else None
                threading.Thread(
                    target=work, args=(job, key, current_speech_key()), daemon=True
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
    if "--open" in sys.argv:
        webbrowser.open(ORIGIN)
    print(f"希息药事  {ORIGIN}", flush=True)
    server.serve_forever()
