"""希息药事本地工作台。Python 3.10+，仅监听回环地址。"""

import base64
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("text/vtt", ".vtt")
PUBLIC = ROOT / "public"
DATA = ROOT / ".studio"
MEDIA = DATA / "media"
JOBS = DATA / "jobs"
for directory in (MEDIA, JOBS):
    directory.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("STUDIO_PORT", "8765"))
ORIGIN = f"http://127.0.0.1:{PORT}"
ARK = "https://ark.cn-beijing.volces.com/api/v3"
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


def write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def ark(path, body=None):
    key = os.environ.get("ARK_API_KEY", "").strip()
    if not key:
        raise ValueError("当前服务未读到 ARK_API_KEY，请配置后重启。")
    request = Request(
        ARK + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=240) as response:
            return json.load(response)
    except HTTPError as error:
        try:
            info = json.load(error).get("error", {})
            message = str(info.get("message") or info.get("code") or "")
        except (ValueError, AttributeError):
            message = ""
        raise ValueError(f"方舟返回 {error.code}。{message[:450]}") from None


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


def setting_valid(p):
    if p.get("mode") not in ("demo", "ark") or p.get("kind") not in ("images", "video"):
        raise ValueError("未知的生成方式")
    if p["mode"] == "ark" and not os.environ.get("ARK_API_KEY", "").strip():
        raise ValueError("方舟 Key 未配置")
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
    if s["voice"] not in ("女声", "男声", "无配音"):
        raise ValueError("未知配音")
    items = p["items"]
    if not isinstance(items, list) or not 1 <= len(items) <= 12:
        raise ValueError("素材数量应在 1–12 之间")
    for item in items:
        if (
            not isinstance(item.get("prompt"), str)
            or not 1 <= len(item["prompt"].strip()) <= 2200
        ):
            raise ValueError("请填写画面提示词，最多 2200 字")
        if p["kind"] == "video":
            if (
                type(item["seconds"]) is not int
                or not 4 <= item["seconds"] <= VIDEO_MODELS[s["videoModel"]][2]
            ):
                raise ValueError("单镜时长超出当前模型范围")
            if not isinstance(item["line"], str) or len(item["line"]) > 450:
                raise ValueError("每幕口播最多 450 字")
            media_path(item["image"])
    if type(p.get("style")) is not int or not 0 <= p["style"] < len(STYLE):
        raise ValueError("未知画面风格")


def image_item(p, item, index):
    if p["mode"] == "demo":
        time.sleep(0.28)
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
    if s["imageModel"] != "doubao-seedream-5-5-261028":
        body["sequential_image_generation"] = "disabled"
    data = ark("/images/generations", body)
    row = (data.get("data") or [{}])[0]
    if not row.get("b64_json"):
        raise ValueError(str(row.get("error", {}).get("message", "方舟未返回图片")))
    raw = base64.b64decode(row["b64_json"])
    ext = ".png" if raw.startswith(b"\x89PNG") else ".jpg"
    path = MEDIA / (uuid.uuid4().hex + ext)
    path.write_bytes(raw)
    return "/media/" + path.name


def source_clip(p, item, dest, state, save):
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
        frame = dest.parent / "first-frame.jpg"
        run_ffmpeg(
            "-i", media_path(item["image"]), "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1",
            "-frames:v", 1, "-q:v", 2, frame,
        )
        raw = base64.b64encode(frame.read_bytes()).decode()
        content = [
            {"type": "text", "text": item["prompt"]},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mimetypes.guess_type(frame.name)[0]};base64,{raw}"
                },
                "role": "first_frame",
            },
        ]
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


def narrate(line, voice, target):
    env = dict(os.environ, STUDIO_LINE=line, STUDIO_WAV=str(target), STUDIO_VOICE=voice)
    script = r"""
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices=@($s.GetInstalledVoices() | Where-Object {$_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN'})
$gender=if($env:STUDIO_VOICE -eq '男声'){'Male'}else{'Female'}
$v=$voices | Where-Object {$_.VoiceInfo.Gender.ToString() -eq $gender} | Select-Object -First 1
if(!$v){throw 'Requested Chinese voice unavailable'}
$s.SelectVoice($v.VoiceInfo.Name)
$s.SetOutputToWaveFile($env:STUDIO_WAV)
$s.Speak($env:STUDIO_LINE)
$s.Dispose()
"""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        env=env,
        capture_output=True,
        timeout=90,
    )
    if result.returncode:
        raise ValueError("当前系统缺少所选中文语音。请安装对应语音，或选择无配音。")


def timed_clip(p, item, source, folder):
    import wave

    settings = p["settings"]
    width, height = frame_size(settings, p["mode"] == "demo")
    seconds = item["seconds"]
    audio = folder / "voice.wav"
    speed = 1
    if settings["voice"] != "无配音" and item["line"].strip():
        narrate(item["line"], settings["voice"], audio)
        with wave.open(str(audio)) as wav:
            speed = max(
                1, wav.getnframes() / wav.getframerate() / max(1, seconds - 0.15)
            )
        inputs = ["-i", audio]
    else:
        inputs = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
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


def render_video(p, job, save):
    segments = []
    cues = ["WEBVTT\n"]
    start = 0
    for i, item in enumerate(p["items"]):
        job["progress"] = f"制作分镜 {i + 1} / {len(p['items'])}"
        save()
        # Reuse unchanged shots across edits. Only changed pictures/prompts require a new Ark render.
        s = p["settings"]
        fingerprint = [
            p["mode"],
            s["videoModel"],
            s["ratio"],
            s["resolution"],
            s["watermark"],
            item["image"],
            item["prompt"],
            item["seconds"],
        ]
        digest = hashlib.sha256(
            json.dumps(fingerprint, ensure_ascii=False).encode()
        ).hexdigest()
        folder = JOBS / job["id"] / str(i)
        folder.mkdir(parents=True, exist_ok=True)
        source = DATA / (digest + ".mp4")
        if not source.is_file():
            temp = folder / "source.tmp.mp4"
            state = job["remote"].setdefault(str(i), {})
            source_clip(p, item, temp, state, save)
            temp.replace(source)
        clip = timed_clip(p, item, source, folder)
        segments.append(clip)
        chunks = re.findall(".{1,18}", " ".join(item["line"].split())) or [""]
        for j, chunk in enumerate(chunks):
            t0 = start + item["seconds"] * j / len(chunks)
            t1 = start + item["seconds"] * (j + 1) / len(chunks)
            cues.append(f"{stamp(t0)} --> {stamp(t1)}\n{chunk.replace('-->', '→')}\n")
        start += item["seconds"]
    job["progress"] = "合并分镜、配音与字幕"
    save()
    base = job["id"]
    captions = MEDIA / (base + ".vtt")
    captions.write_text("\n".join(cues), encoding="utf-8")
    listing = JOBS / base / "clips.txt"
    listing.write_text(
        "\n".join(f"file '{i}/clip.mp4'" for i in range(len(segments))),
        encoding="utf-8",
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
        "-map",
        "0:v",
        "-map",
        "0:a",
        "-map",
        "1:0",
        "-c",
        "copy",
        "-c:s",
        "mov_text",
        "-metadata:s:s:0",
        "language=zho",
        "-movflags",
        "+faststart",
        MEDIA / (base + ".mp4"),
    )
    return {"url": f"/media/{base}.mp4", "captions": f"/media/{base}.vtt"}


def work(job):
    def save():
        with CACHE_LOCK:
            write_json(JOBS / (job["id"] + ".json"), job)

    try:
        with SLOTS:
            p = job["request"]
            job.update(status="running", error="")
            save()
            if p["kind"] == "images":
                for i in range(len(job["results"]), len(p["items"])):
                    job["progress"] = f"生成配图 {i + 1} / {len(p['items'])}"
                    save()
                    job["results"].append(image_item(p, p["items"][i], i))
                    save()
                job["output"] = {"images": job["results"]}
            else:
                job["output"] = render_video(p, job, save)
            job["status"] = "done"
    except Exception as error:
        job.update(status="failed", error=str(error)[:650])
    finally:
        with CACHE_LOCK:
            save()
            ACTIVE.discard(job["id"])


def visible(job):
    return {k: job.get(k) for k in ("id", "status", "progress", "error", "output")}


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
                    "keyPresent": bool(os.getenv("ARK_API_KEY", "").strip()),
                    "encoder": bool(FFMPEG),
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
                            error="本地服务已重启。可继续此任务，已完成的分镜将复用。",
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
            self.path != "/api/jobs"
            or not self.allowed()
            or self.headers.get("Origin") not in (ORIGIN, f"http://localhost:{PORT}")
            or self.headers.get_content_type() != "application/json"
        ):
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if not 0 < n <= 100000:
                raise ValueError("请求大小无效")
            p = json.loads(self.rfile.read(n))
            job_id = str(uuid.UUID(p["id"]))
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
                threading.Thread(target=work, args=(job,), daemon=True).start()
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
