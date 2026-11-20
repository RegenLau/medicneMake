"""Measure MP4 timing, audio placement, True Peak and off-path parity with cached audio."""

from array import array
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import wave


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
RATE = 24000


def worker(source, target, mode):
    import server

    server.JOBS, server.MEDIA = target / "jobs", target / "media"
    server.JOBS.mkdir(parents=True)
    server.MEDIA.mkdir()
    payload = json.loads(source.read_text(encoding="utf-8"))["request"]
    payload["settings"].update(voice="男声", music="calm")
    payload["audio"] = {"sfx": {"pack": "off" if mode == "off" else "builtin:sfx-pack/soft", "gainDb": -6}} if mode != "implicit" else {}
    payload["items"][-1]["sfxId"] = "builtin:sfx/check"
    name = payload["id"]

    def forbidden(*args, **kwargs):
        raise AssertionError("SFX export uses only cached narration and local assets.")

    server.ark = server.dashscope_json = server.deepseek = server.narrate = forbidden
    for index, shot in enumerate(payload["items"]):
        destination = server.JOBS / name / str(index) / server.speech_cache_name(payload["settings"], shot["line"])
        destination.parent.mkdir(parents=True)
        signal = array("h", (round((.96 if index == 2 else .18) * 32767 * math.sin(2 * math.pi * (362 + 35 * index) * i / RATE))
                             for i in range(round(3.45 * RATE))))
        with wave.open(str(destination), "wb") as wav:
            wav.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            wav.writeframes(signal.tobytes())
    delegated = server.run_ffmpeg

    def trace(*args):
        if str(args[-1]).endswith("output.mp4"):
            normalized = [re.sub(r'^.*/stage-[^/]+/', "<render>/", str(arg)) if isinstance(arg, Path) else str(arg)
                          for arg in args]
            (target / "ffmpeg.json").write_text(json.dumps(normalized))
        return delegated(*args)

    server.run_ffmpeg = trace
    server.setting_valid(payload)
    result = server.render_video(payload, {"id": name}, lambda: None, "")
    print(json.dumps(result))


def pcm(path):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ar", str(RATE), "-ac", "1", "-f", "f32le", "-"])
    return array("f", raw)


def peak(path):
    output = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128=peak=true",
                             "-f", "null", "-"], capture_output=True, text=True, check=True).stderr
    return float(re.findall(r"Peak:\s+([-\d.]+) dBFS", output)[-1])


def rgb(path, at, image):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1", image], check=True)
    return subprocess.check_output(["ffmpeg", "-v", "error", "-i", image, "-frames:v", "1", "-f", "rawvideo",
                                    "-pix_fmt", "rgb24", "-"])


def run(source, target):
    times = {}
    videos = {}
    probes = {}
    for mode in ("implicit", "off", "soft"):
        folder = target / mode
        start = time.perf_counter()
        result = json.loads(subprocess.check_output([sys.executable, "-B", __file__, "--worker", str(source), str(folder), mode]))
        videos[mode] = folder / result["url"].lstrip("/")
        times[mode] = time.perf_counter() - start
        probes[mode] = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                                     "-of", "default=nw=1:nk=1", videos[mode]]))
    assert len(set(probes.values())) == 1, probes
    assert abs(probes["soft"] - sum(result["shotSeconds"])) < 1 / 24
    implicit_args = json.loads((target / "implicit/ffmpeg.json").read_text())
    off_args = json.loads((target / "off/ffmpeg.json").read_text())
    assert implicit_args == off_args
    off_pixels = rgb(videos["off"], 1.5, target / "off.png")
    on_pixels = rgb(videos["soft"], 1.5, target / "soft.png")
    assert off_pixels == on_pixels
    mixed = pcm(videos["soft"])
    reference = pcm(videos["off"])
    implicit = pcm(videos["implicit"])
    assert len(reference) == len(implicit)
    off_rms = math.sqrt(sum((sample - expected) ** 2 for sample, expected in zip(reference, implicit)) / len(reference))
    assert off_rms <= 1e-4
    impact = pcm(ROOT / "public/assets/library/sfx/check.wav")
    events = json.loads(next((target / "soft/jobs").glob("*/events.json")).read_text())
    event = next(event for event in events if event["shot"] == 0 and event["type"] == "check")
    approx = round(event["t"] * RATE)
    residual = [value - ref for value, ref in zip(mixed, reference)]
    template = range(0, min(len(impact), round(.14 * RATE)), 6)
    displacement = max(range(-1008, 1009, 6),
                       key=lambda lag: sum(residual[approx + lag + k] * impact[k] for k in template))
    assert abs(displacement / RATE) <= 1 / 24
    measured = peak(videos["soft"])
    assert measured <= -1
    print(json.dumps({"duration": probes, "times": times, "frames": result["renderStats"]["frames"], "peakSoft": measured,
                      "peakOff": peak(videos["off"]), "audioDelayMs": displacement / RATE * 1000,
                      "firstCheck": event["t"], "matchingFlags": len(off_args), "offRms": off_rms,
                      "differentPixels": 0, "events": events}))


if __name__ == "__main__":
    if sys.argv[1] == "--worker":
        worker(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4])
    else:
        run(Path(sys.argv[1]), Path(sys.argv[2]))
