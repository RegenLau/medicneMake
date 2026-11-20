"""Compare real legacy and stage exports in fresh processes without model calls."""

import json
import subprocess
import sys
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BASE = {"title": "说明书核对练习", "shortTitle": "说明书核对", "chapters": ["核对资料", "保存记录"],
        "disclaimer": "科普内容仅供参考", "settings": {"ratio": "16:9", "voice": "无配音", "music": "off"},
        "appearance": {"theme": "medical", "presenter": "none"}, "kind": "video", "mode": "ark"}
IMAGE = "/assets/template-info-tablet.jpg"


def fixtures(kind, length):
    number = 5 if length == 60 else 2
    duration = length / number
    names = ["看清标题", "核对成分", "查看对应栏目", "核对使用记录", "保留外包装"]
    payload = {**BASE, "items": []}
    legacy = {**BASE, "items": []}
    deck = {**BASE, **BASE["appearance"], "slides": []}
    for index, name in enumerate(names[:number]):
        line = name + "，再核对手边的资料。"
        common = {"name": name, "line": line, "seconds": duration, "chapterIndex": int(index > 2)}
        cue = {"text": line, "focus": "all", "weight": 1}
        pts = {"type": "explain", "headline": name,
               "items": [{"title": "核对说明书", "detail": "查看对应栏目", "tag": ""},
                         {"title": "保留包装", "detail": "方便再次核对", "tag": ""}],
               "takeaway": name}
        if kind == "image":
            content = {"kind": kind, "image": IMAGE}
            deck["slides"].append({**common, **pts, "contentImage": IMAGE, "layoutMode": "explain"})
            legacy["items"].append({**common, "cues": [{**cue, "image": f"/media/{index}-0.png"}]})
            legacy["template"] = True
        else:
            content = {"kind": kind, "visual": "checklist", "motion": "spotlight", "motif": "checklist", "tone": "safe"}
            legacy["items"].append({**common, **{key: content[key] for key in ("visual", "motion", "motif", "tone")},
                                    "items": pts["items"], "takeaway": name})
            legacy["codeMotion"] = True
        payload["items"].append({**common, "content": content, "points": pts, "cues": [cue]})
    return {"legacy": legacy, "stage": {**payload, "stage": True, "compatibility": kind}, "deck": deck}


def export_worker(kind, version, length, workdir):
    import server

    server.MEDIA, server.JOBS = workdir / "media", workdir / "jobs"
    server.MEDIA.mkdir(parents=True, exist_ok=True)
    server.JOBS.mkdir(exist_ok=True)
    case = fixtures(kind, length)
    p = {**case[version], "id": str(uuid.uuid4()), "workId": str(uuid.uuid4())}
    if kind == "image" and version == "legacy":
        src = workdir / "test.json"
        src.write_text(json.dumps({"deck": case["deck"], "items": p["items"]}, ensure_ascii=False), encoding="utf-8")
        subprocess.run(["node", str(ROOT / "tests/render-template-fixtures.mjs"), str(src), str(server.MEDIA)], check=True)
    server.setting_valid(p)
    output = server.render_video(p, {"id": p["id"]}, lambda: None, "")
    print(json.dumps(output, ensure_ascii=False))


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "default=nw=1:nk=1", str(path)], text=True))


def shot_pixels(path, timestamp, image):
    subprocess.run(["ffmpeg", "-v", "error", "-ss", str(timestamp), "-i", str(path), "-frames:v", "1", str(image)], check=True)
    return subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(image), "-frames:v", "1", "-f", "rawvideo",
                                    "-pix_fmt", "rgb24", "-"])


def main(target, length=60):
    results = {}
    thresholds = {"mean": 1.0, "over_eight": .012}
    for kind in ("image", "scene"):
        clips, vtt, stats = {}, {}, {}
        for version in ("legacy", "stage"):
            workdir = target / f"{kind}-{version}"
            start = time.perf_counter()
            raw = subprocess.check_output([sys.executable, "-B", __file__, "--worker", kind, version,
                                           str(length), str(workdir)], cwd=ROOT, text=True)
            wall = time.perf_counter() - start
            result = json.loads(raw)
            clips[version] = workdir / result["url"].lstrip("/")
            vtt[version] = (workdir / result["captions"].lstrip("/")).read_bytes()
            stats[version] = {"seconds": duration(clips[version]), "wall": wall}
            if result.get("renderStats"):
                stats[version].update(result["renderStats"])
        fps = 25 if kind == "scene" else 24
        differences = []
        for timestamp in (length * .1, length * .5, length * .9):
            frames = [shot_pixels(path, timestamp, target / f"{kind}-{version}-{timestamp}.png")
                      for version, path in clips.items()]
            if len(frames[0]) != len(frames[1]) or len(frames[0]) != 1280 * 720 * 3:
                raise RuntimeError("抽帧尺寸有误")
            error = [abs(a - b) for a, b in zip(*frames)]
            differences.append({"timestamp": timestamp, "mean": sum(error) / len(error),
                                "over_eight": sum(delta > 8 for delta in error) / len(error)})
        results[kind] = {**stats, "duration_delta": abs(stats["stage"]["seconds"] - stats["legacy"]["seconds"]),
                         "vtt_equal": vtt["stage"] == vtt["legacy"], "pixels": differences,
                         "ratio": stats["stage"]["wall"] / stats["legacy"]["wall"], "fps": fps}
    print(json.dumps(results, ensure_ascii=False, indent=2))
    for kind, row in results.items():
        assert row["duration_delta"] < 1 / row["fps"], (kind, "时长差")
        assert row["vtt_equal"], (kind, "字幕不一致")
        for frame in row["pixels"]:
            assert frame["mean"] <= thresholds["mean"] and frame["over_eight"] <= thresholds["over_eight"], (kind, frame)
        if length == 60:
            assert row["ratio"] <= (2 if kind == "image" else 1), (kind, "耗时超限", row["ratio"])


if __name__ == "__main__":
    if sys.argv[1] == "--worker":
        export_worker(sys.argv[2], sys.argv[3], int(sys.argv[4]), Path(sys.argv[5]).resolve())
    else:
        main(Path(sys.argv[1]).resolve(), int(sys.argv[2]) if len(sys.argv) > 2 else 60)
