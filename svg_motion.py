"""Local SVG video effect settings, validation and Chromium rendering."""

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FPS = 24
MAX_LINE = 100
ACTIONS = {
    "leaflet": "说明书翻页，放大镜移到对应栏目",
    "carton": "转动药盒，沿边描出标签位置",
    "clock": "时钟指针转动",
    "scale": "体重秤指针摆动",
    "log": "笔在记录本上写下两行",
    "travel": "把药盒和药瓶放进随身药包并拉上拉链",
    "compare": "片状图标分开，出现警示叉号（仅用于明确的误区）",
    "consult": "出现咨询对话与勾选标记",
}


def chrome_bin():
    app_dirs = [os.environ.get(key) for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
    candidates = [
        os.environ.get("STUDIO_CHROME_BIN"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" if sys.platform == "darwin" else None,
        *(str(Path(root) / "Google/Chrome/Application/chrome.exe") for root in app_dirs if root),
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


def ready(ffmpeg):
    return bool(ffmpeg and shutil.which("node") and chrome_bin())


def validate_beats(beats):
    if not isinstance(beats, list) or not 1 <= len(beats) <= 3:
        raise ValueError("每幕需要 1–3 段 SVG 动作。")
    for beat in beats:
        if not isinstance(beat, dict) or not isinstance(beat.get("action"), str) or beat["action"] not in ACTIONS:
            raise ValueError("请选择有效的道具动作。")
        for field, maximum, label in (("line", 55, "动作口播"), ("label", 10, "画面短标签")):
            value = beat.get(field)
            if not isinstance(value, str) or not value.strip() or len(value) > maximum:
                raise ValueError(f"{label}不能为空，最多 {maximum} 字。")
    return [{"action": beat["action"], "line": beat["line"].strip(), "label": beat["label"].strip()} for beat in beats]


def validate_shot(item, require_line=True):
    if not isinstance(item, dict):
        raise ValueError("SVG 分镜格式无效。")
    if not isinstance(item.get("action"), str) or item["action"] not in ACTIONS:
        raise ValueError("请选择 SVG 分镜的道具动作。")
    name = item.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 60:
        raise ValueError("SVG 分镜标题不能为空，最多 60 字。")
    line = item.get("line")
    if not isinstance(line, str) or (require_line and not line.strip()) or len(line) > MAX_LINE:
        raise ValueError(f"请填写 SVG 分镜口播，每幕最多 {MAX_LINE} 字。")
    if "beats" in item:
        beats = validate_beats(item["beats"])
        if beats[0]["action"] != item["action"] or "".join(beat["line"] for beat in beats) != line.strip():
            raise ValueError("动作片段必须与本幕口播及首个道具一致。")
    seconds = item.get("seconds")
    if type(seconds) not in (int, float) or not 2 <= seconds <= 35:
        raise ValueError("SVG 分镜时长应在 2–35 秒之间。")


def timing(spoken, estimated):
    seconds = spoken if spoken > 0 else estimated
    # Round each scene independently so the next clip starts on the frame grid.
    frames = math.ceil((seconds + (0.4 if spoken else 0)) * FPS)
    motion_frames = max(1, min(frames - 1, round(seconds * FPS)))
    return frames, motion_frames


def render(shots, folder, ffmpeg, layout, avatar_url):
    if not ready(ffmpeg):
        raise ValueError("SVG 导出需要 Chrome、Node.js 和 FFmpeg。详见使用说明。")
    plan = folder / "svg-render.json"
    plan.write_text(json.dumps({"fps": FPS, "shots": shots, "layout": layout, "avatarUrl": avatar_url},
                               ensure_ascii=False), encoding="utf-8")
    temp = folder / "svg-template-source.tmp.mp4"
    target = folder / "svg-template-source.mp4"
    try:
        result = subprocess.run(
            [shutil.which("node"), str(ROOT / "render_svg_video.mjs"), chrome_bin(), ffmpeg, str(plan), str(temp)],
            capture_output=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("SVG 渲染超时，可缩短视频后重试。") from None
    if result.returncode or not temp.is_file() or temp.stat().st_size == 0:
        raise ValueError("SVG 渲染失败：" + result.stderr.decode("utf-8", "replace")[-420:].strip())
    temp.replace(target)
    return target
