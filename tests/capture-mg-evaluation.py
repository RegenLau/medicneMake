"""Capture exactly the five authorized AI animation drafts via a local workbench."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import json
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
import uuid


request = import_module("capture-mix-evaluation").request
write = import_module("capture-mix-evaluation").write
DESCRIPTIONS = (
    "药片经食道进入胃部并溶解",
    "降压药让血管扩张",
    "滴眼液滴入下眼睑",
    "漏服药物的时间线判断",
    "抗生素作用于细菌",
)


def capture(origin, path, shots, i, model):
    journal = path / f"{i+1:02}.json"
    if journal.exists():
        run = json.loads(journal.read_text())
        if "result" in run:
            return
    else:
        run = {"request": {"id": str(uuid.uuid4()), "workId": str(uuid.uuid4()), "mode": "ark", "kind": "mg-draft",
                           "items": [], "settings": {"textModel": model},
                           "mg": {"description": DESCRIPTIONS[i], "theme": "medical"}}}
        write(journal, run)
    p = run["request"]
    start = time.monotonic()
    result = request(origin, "/api/jobs", p)
    while result["status"] in ("queued", "running"):
        if time.monotonic() - start > 550:
            raise TimeoutError("任务仍在处理，保留相同 ID 查询。")
        time.sleep(.9)
        result = request(origin, "/api/jobs/" + p["id"])
    run.update(result=result, waitSeconds=round(time.monotonic()-start, 3),
               costs=request(origin, "/api/costs", {"workId": p["workId"], "jobIds": [p["id"]]}))
    if result["status"] == "done":
        row = result["output"]
        movie = path / f"{i+1:02}.mp4"
        with urlopen(origin+row["previewUrl"], timeout=15) as stream:
            movie.write_bytes(stream.read())
        duration = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration",
                                                  "-of","default=nw=1:nk=1",movie]))
        names = []
        for label, fraction in (("开场",.12),("动作",.55),("收尾",.88)):
            name = f"G3-评测{i+1}-{label}.png"
            subprocess.run(["ffmpeg","-y","-v","error","-ss",f"{duration*fraction:.4f}","-i",movie,
                            "-frames:v","1",shots/name], check=True)
            names.append(name)
        run.update(duration=duration, previewFrames=names, previewBytes=movie.stat().st_size)
    write(journal, run)
    print(i+1, result["status"], run["waitSeconds"],
          result["output"]["repairCount"] if result["status"] == "done" else result["error"], flush=True)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("origin")
    args.add_argument("results", type=Path)
    args.add_argument("screenshots", type=Path)
    parsed = args.parse_args()
    config = request(parsed.origin,"/api/config")
    if not config["deepseekKeyPresent"]:
        raise SystemExit("本地工作台未找到 DeepSeek 凭据。")
    model = "deepseek-v4-pro" if "deepseek-v4-pro" in config["textModels"] else config["textModel"]
    print("Model",model,flush=True)
    parsed.results.mkdir(parents=True,exist_ok=True)
    parsed.screenshots.mkdir(parents=True,exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in [pool.submit(capture, parsed.origin, parsed.results, parsed.screenshots, i, model)
                       for i in range(len(DESCRIPTIONS))]:
            future.result()


if __name__ == "__main__":
    main()
