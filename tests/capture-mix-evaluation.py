"""Capture the eight authorized DeepSeek Mix runs via the local workbench.

Start a workbench with a test data directory and no media providers. The
journal prevents a second paid submission for a completed topic and reuses
the same job ID if polling was interrupted.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid


TOPICS = (
    "孩子发烧，退烧药怎么吃",
    "滴眼液怎么滴",
    "降压药忘吃了要不要补",
    "肠溶片为什么不能掰开",
    "感冒药和退烧药成分重叠",
    "出门怎么带药",
    "药盒有效期怎么看",
    "胃药饭前还是饭后吃",
)


def request(origin, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = Request(origin + path, data=data, headers={"Origin": origin, "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(json.load(error).get("error", f"HTTP {error.code}")) from None


def write(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def capture(origin, directory, i, model):
    path = directory / f"{i + 1:02}.json"
    if path.exists():
        run = json.loads(path.read_text(encoding="utf-8"))
        if "result" in run:
            return
    else:
        run = {"request": {"id": str(uuid.uuid4()), "workId": str(uuid.uuid4()), "mode": "ark", "kind": "draft",
                           "items": [], "settings": {"textModel": model, "ratio": "16:9", "duration": 45},
                           "draft": {"type": "video", "videoMode": "stage", "presentation": "mix",
                                     "layoutId": "builtin:layout/info-classic", "imageBudget": 2, "topic": TOPICS[i]}}}
        write(path, run)
    payload = run["request"]
    start = time.monotonic()
    status = request(origin, "/api/jobs", payload)
    while status["status"] in ("queued", "running"):
        if time.monotonic() - start > 275:
            raise TimeoutError(f"{TOPICS[i]} 的任务仍在运行，请核对任务状态。")
        time.sleep(.8)
        status = request(origin, "/api/jobs/" + payload["id"])
    run["result"] = status
    run["costs"] = request(origin, "/api/costs", {"workId": payload["workId"], "jobIds": [payload["id"]]})
    run["waitSeconds"] = round(time.monotonic() - start, 3)
    write(path, run)
    summary = status["output"].get("notice") or [row["content"]["kind"] for row in status["output"]["shots"]] if status["status"] == "done" else status["error"]
    print(i + 1, status["status"], f'{run["waitSeconds"]:.3f}s', summary, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin")
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    cfg = request(args.origin, "/api/config")
    if not cfg["deepseekKeyPresent"]:
        raise SystemExit("本地工作台未找到 DeepSeek 凭据。")
    args.directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(capture, args.origin, args.directory, i, cfg["textModel"]) for i in range(len(TOPICS))]
        for future in futures:
            future.result()


if __name__ == "__main__":
    main()
