"""AI model-driven background music generation via MiniMax Music API (+ DeepSeek prompt planning).

Pure Python 3.10+ standard library (zero local audio synthesis).
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

MINIMAX_HOSTS = (
    "https://api.minimaxi.com",
    "https://api.minimax.io",
)

# (display label, estimated CNY per track at ~$0.15/track)
MUSIC_MODELS = {
    "music-2.6": ("MiniMax Music 2.6（推荐 · 纯音乐）", "1.08"),
    "music-3.0": ("MiniMax Music 3.0", "1.08"),
    "music-2.5+": ("MiniMax Music 2.5+", "1.08"),
    "music-2.5": ("MiniMax Music 2.5", "1.08"),
}

DEFAULT_MUSIC_MODEL = "music-2.6"

_FALLBACK_PROFILES = (
    {
        "id": "warm_piano",
        "styleLabel": "温暖原声钢琴",
        "mood": "温暖安心",
        "bpm": 80,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, warm felt acoustic piano "
            "and subtle soft strings, calm reassuring healthcare documentary vibe, 80 BPM, "
            "clean spacious studio mix with open midrange for voiceover narration"
        ),
    },
    {
        "id": "bright_marimba",
        "styleLabel": "轻快明朗木琴",
        "mood": "轻快明朗",
        "bpm": 98,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, bright wooden marimba "
            "and gentle fingerpicked acoustic guitar with light muted bass, friendly educational "
            "explainer tone, 98 BPM, airy crisp mix leaving space for narration"
        ),
    },
    {
        "id": "soft_epiano",
        "styleLabel": "清透柔和电钢",
        "mood": "现代专业",
        "bpm": 86,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, mellow Rhodes electric piano, "
            "warm ambient pad and gentle soft bassline, modern trustworthy medical science feel, "
            "86 BPM, smooth unobtrusive background bed for spoken explanation"
        ),
    },
    {
        "id": "gentle_harp",
        "styleLabel": "清澈竖琴吉他",
        "mood": "温和关怀",
        "bpm": 82,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, delicate acoustic harp and "
            "nylon guitar arpeggios with airy warm pad, tender caring family health atmosphere, "
            "82 BPM, soft balanced mix ideal underneath narration"
        ),
    },
    {
        "id": "calm_strings",
        "styleLabel": "沉稳专业弦乐",
        "mood": "沉稳专业",
        "bpm": 74,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, dignified warm piano chords "
            "and smooth cinematic chamber strings, calm serious trustworthy medical advisory mood, "
            "74 BPM, restrained non-dramatic mix keeping voiceover crystal clear"
        ),
    },
    {
        "id": "music_box",
        "styleLabel": "安心童趣钢片琴",
        "mood": "亲子呵护",
        "bpm": 88,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, gentle warm celesta, soft "
            "acoustic piano and delicate plucked guitar, cozy comforting pediatric care mood, "
            "88 BPM, warm soft high frequencies suitable under friendly voiceover"
        ),
    },
    {
        "id": "lofi_pulse",
        "styleLabel": "轻松科普律动",
        "mood": "明快易懂",
        "bpm": 96,
        "prompt": (
            "Pure instrumental background music, no vocals, no singing, chill light lofi electric piano, "
            "soft plucked melody and subtle muted beat, engaging science myth-busting explainer vibe, "
            "96 BPM, clean balanced background mix that never competes with speech"
        ),
    },
)

_PROFILES_BY_ID = {item["id"]: item for item in _FALLBACK_PROFILES}


def _clean_text(value, limit=200):
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:limit]


def normalize_context(context):
    ctx = context if isinstance(context, dict) else {}
    title = _clean_text(ctx.get("title", ""), 80)
    topic = _clean_text(ctx.get("topic", ""), 120)
    drug = _clean_text(ctx.get("drug", ""), 60)
    hint = _clean_text(ctx.get("hint", ""), 160)
    raw_lines = ctx.get("lines") if isinstance(ctx.get("lines"), list) else []
    lines = [_clean_text(line, 240) for line in raw_lines if isinstance(line, str) and line.strip()][:12]
    try:
        variant = max(0, min(999, int(ctx.get("variant") or 0)))
    except (TypeError, ValueError):
        variant = 0
    previous = ctx.get("previous") if isinstance(ctx.get("previous"), dict) else None
    return {
        "title": title,
        "topic": topic,
        "drug": drug,
        "lines": lines,
        "hint": hint,
        "variant": variant,
        "previous": previous,
    }


def content_fingerprint(context):
    norm = normalize_context(context)
    payload = {
        "title": norm["title"],
        "topic": norm["topic"],
        "drug": norm["drug"],
        "lines": norm["lines"],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def _short_theme_tag(norm):
    raw = norm["title"] or norm["topic"] or norm["drug"] or "用药科普"
    cleaned = re.sub(r"[？?！!。，,、：:（）()《》“”\"'·\-—\s]+", "", raw)
    if norm["drug"] and len(norm["drug"]) <= 6:
        return norm["drug"]
    if re.search(r"发烧|退烧|发热", cleaned):
        return "安心退热"
    if re.search(r"儿童|宝宝|小孩|孩子|小儿", cleaned):
        return "亲子守护"
    if re.search(r"急救|误服|中毒|危险|警示|禁忌", cleaned):
        return "安全警示"
    if re.search(r"降压|高血压|血压", cleaned):
        return "稳压日常"
    if re.search(r"血糖|糖尿|降糖", cleaned):
        return "控糖指南"
    if re.search(r"他汀|血脂|降脂", cleaned):
        return "护心指南"
    if re.search(r"失眠|睡眠", cleaned):
        return "静夜安眠"
    if re.search(r"药箱|清单|整理|说明书", cleaned):
        return "居家用药"
    if re.search(r"误区|辟谣|对比|区别", cleaned):
        return "科普辨析"
    return cleaned[:4] if len(cleaned) >= 2 else "用药科普"


def _pick_profile_order(text, hint):
    combined = f"{hint} {text}"
    if re.search(r"八音盒|钢片琴|童趣|亲子|摇篮", hint):
        return ["music_box", "gentle_harp", "warm_piano"]
    if re.search(r"木琴|轻快|明快|活泼|清单", hint):
        return ["bright_marimba", "lofi_pulse", "gentle_harp"]
    if re.search(r"弦乐|严肃|沉稳|警示|庄重", hint):
        return ["calm_strings", "warm_piano", "soft_epiano"]
    if re.search(r"竖琴|吉他|拨弦|清澈|清新", hint):
        return ["gentle_harp", "soft_epiano", "bright_marimba"]
    if re.search(r"电钢|现代|科技|干货|律动|节奏", hint):
        return ["lofi_pulse", "soft_epiano", "bright_marimba"]
    if re.search(r"钢琴|舒缓|柔和|安静|慢|温柔", hint):
        return ["warm_piano", "soft_epiano", "gentle_harp"]

    if re.search(r"急救|急症|误服|中毒|过敏|休克|呼吸困难|昏迷|胸痛|心梗|卒中|禁忌|严重不良反应|危险信号", combined):
        return ["calm_strings", "warm_piano", "soft_epiano"]
    if re.search(r"儿童|宝宝|小孩|孩子|婴儿|小儿|幼儿|退烧|发烧|雾化|滴剂", combined):
        return ["music_box", "gentle_harp", "bright_marimba", "warm_piano"]
    if re.search(r"误区|辟谣|对比|区别|清单|整理|怎么看|怎么选|怎么读|读懂|技巧|三步|3步|一分钟|常犯", combined):
        return ["bright_marimba", "lofi_pulse", "soft_epiano", "gentle_harp"]
    if re.search(r"睡眠|失眠|安神|孕|哺乳|缓解|舒缓|滴眼|护胃|调理|情绪|焦虑", combined):
        return ["gentle_harp", "warm_piano", "soft_epiano"]
    if re.search(r"高血压|降压|糖尿病|降糖|他汀|降脂|阿司匹林|慢病|长期|服药时间|饭前|饭后|漏服", combined):
        return ["soft_epiano", "warm_piano", "gentle_harp", "bright_marimba"]
    return ["warm_piano", "soft_epiano", "bright_marimba", "gentle_harp", "lofi_pulse"]


def _extract_json(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    return json.loads(text)


def _plan_prompt_fallback(norm):
    combined = " ".join([norm["title"], norm["topic"], norm["drug"], *norm["lines"]])
    order = _pick_profile_order(combined, norm["hint"])
    prev_style = (norm["previous"] or {}).get("styleLabel", "")
    picked_id = order[norm["variant"] % len(order)]
    if norm["variant"] > 0 and prev_style and _PROFILES_BY_ID[picked_id]["styleLabel"] == prev_style and len(order) > 1:
        picked_id = order[(norm["variant"] + 1) % len(order)]
    profile = _PROFILES_BY_ID[picked_id]
    tag = _short_theme_tag(norm)
    prompt = profile["prompt"]
    if norm["hint"]:
        prompt = f"{prompt}, user preference: {norm['hint']}"
    if norm["variant"] > 0:
        prompt = f"{prompt}, fresh melodic variation take {norm['variant'] + 1}"
    desc = f"根据《{(norm['title'] or norm['topic'] or '本视频')[:18]}》主题定制，以{profile['styleLabel']}营造{profile['mood']}氛围。"
    if norm["hint"]:
        desc = f"结合「{norm['hint'][:18]}」偏好，以{profile['styleLabel']}打造{profile['mood']}纯音乐配乐。"
    return {
        "title": f"{tag}·{profile['styleLabel']}",
        "mood": profile["mood"],
        "styleLabel": profile["styleLabel"],
        "bpm": profile["bpm"],
        "prompt": prompt[:1500],
        "description": desc,
        "hint": norm["hint"],
        "variant": norm["variant"],
        "promptSource": "rule",
        "contentHash": content_fingerprint(norm),
    }


def plan_music_prompt(context, deepseek_fn=None, text_model=None):
    """Compose a tailored MiniMax music prompt from the video's theme, drug, and narration."""
    norm = normalize_context(context)
    fallback = _plan_prompt_fallback(norm)
    if not deepseek_fn or not text_model:
        return fallback

    narration = " ".join(norm["lines"])[:560]
    prev = norm["previous"] or {}
    avoid_text = ""
    if norm["variant"] > 0 and prev:
        avoid_text = (
            f"\n本次为第 {norm['variant'] + 1} 次重新生成，请明显调整配器、情绪色彩或节奏走向，"
            f"不要重复上一版（{prev.get('styleLabel', '')} / {prev.get('mood', '')} / {prev.get('bpm', '')} BPM）。"
        )
    hint_text = f"\n用户补充偏好：{norm['hint']}" if norm["hint"] else ""

    user_prompt = (
        "你是专业医疗健康科普视频的音乐总监。请根据以下用药科普视频的主题、关联药品和口播内容，"
        "为 MiniMax 音乐生成模型（纯音乐模式 is_instrumental=true）撰写一段精准的音乐提示词，并只返回 JSON。\n"
        f"视频标题：{norm['title'] or '（未命名）'}\n"
        f"科普主题：{norm['topic'] or '用药科普'}\n"
        f"关联药品：{norm['drug'] or '无'}\n"
        f"口播摘录：{narration or '药师日常安全用药讲解'}"
        f"{hint_text}{avoid_text}\n\n"
        "要求：\n"
        "1. 必须是纯器乐背景音乐（无任何演唱、哼唱或人声），听感温和克制、留出人声频段，绝不抢药师口播。\n"
        "2. prompt 字段使用清晰的英文音乐制作描述（约 35-70 词），写明流派、主奏乐器、氛围情绪、BPM（68-112）以及适合口播铺底的干净混音质感。\n"
        "3. 输出严格 JSON：\n"
        '{"title":"6-14字中文配乐标题，贴合本视频内容","mood":"4字情绪标签",'
        '"styleLabel":"4-8字中文配器风格名，如温暖原声钢琴、轻快木琴吉他",'
        '"bpm":68到112的整数,'
        '"prompt":"英文纯音乐生成提示词，必须包含 Pure instrumental background music, no vocals",'
        '"description":"一句不超过45字的中文说明，解释为什么这段配乐契合本视频主题与内容"}'
    )
    try:
        response = deepseek_fn(
            "/chat/completions",
            {
                "model": text_model,
                "messages": [
                    {"role": "system", "content": "你只输出严格合法的 JSON 对象，不加任何解释或 Markdown 标记。"},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.85 if norm["variant"] > 0 else 0.65,
                "max_tokens": 420,
                "response_format": {"type": "json_object"},
            },
            timeout=25,
        )
        parsed = _extract_json(response["choices"][0]["message"]["content"])
        if not isinstance(parsed, dict):
            return fallback
        prompt_text = _clean_text(parsed.get("prompt", ""), 1500)
        if len(prompt_text) < 16:
            return fallback
        if not re.search(r"instrumental|纯音乐|无人声", prompt_text, re.I):
            prompt_text = "Pure instrumental background music, no vocals, " + prompt_text
        try:
            bpm = max(66, min(116, int(round(float(parsed.get("bpm", fallback["bpm"]))))))
        except (TypeError, ValueError):
            bpm = fallback["bpm"]
        return {
            "title": _clean_text(parsed.get("title", ""), 24) or fallback["title"],
            "mood": _clean_text(parsed.get("mood", ""), 12) or fallback["mood"],
            "styleLabel": _clean_text(parsed.get("styleLabel", ""), 16) or fallback["styleLabel"],
            "bpm": bpm,
            "prompt": prompt_text,
            "description": _clean_text(parsed.get("description", ""), 70) or fallback["description"],
            "hint": norm["hint"],
            "variant": norm["variant"],
            "promptSource": "deepseek",
            "contentHash": content_fingerprint(norm),
        }
    except Exception:
        return fallback


def _minimax_post(host, path, body, api_key, timeout=180):
    request = Request(
        host.rstrip("/") + path,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            return response.status, json.loads(raw)
    except HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = {"base_resp": {"status_code": error.code, "status_msg": raw[:300]}}
        return error.code, parsed
    except (URLError, TimeoutError) as error:
        raise ValueError(f"暂时连不上 MiniMax 服务（{host}），请检查网络后重试。") from error


def _is_auth_error(http_code, payload):
    if http_code in (401, 403):
        return True
    base = payload.get("base_resp") if isinstance(payload, dict) else {}
    code = base.get("status_code") if isinstance(base, dict) else None
    return code in (1004, 2049)


def _format_minimax_error(http_code, payload, api_key):
    base = payload.get("base_resp") if isinstance(payload, dict) else {}
    code = base.get("status_code") if isinstance(base, dict) else None
    msg = str((base or {}).get("status_msg") or "").replace(api_key, "[已隐藏]")[:320]
    if _is_auth_error(http_code, payload):
        return "MiniMax 未接受此 API Key，请检查是否复制完整、未过期，或所属账户权限。"
    if code == 1008:
        return "MiniMax 账户余额不足，请先充值后再试。"
    if code in (1002, 1039):
        return "MiniMax 接口触发频率限制，请稍等片刻后重试。"
    if code in (1026, 1027):
        return "配乐提示词未通过 MiniMax 安全审核，请微调偏好描述后重试。"
    if code is not None:
        return f"MiniMax 音乐生成失败（错误码 {code}）：{msg or '请稍后重试'}"
    return f"MiniMax 返回 HTTP {http_code}：{msg or '请稍后重试'}"


def verify_minimax_key(api_key, timeout=15):
    """Validate a MiniMax API Key with zero billing by probing empty music_generation params."""
    if not isinstance(api_key, str) or not re.fullmatch(r"[!-~]{1,1024}", api_key.strip()):
        raise ValueError("请输入有效的 MiniMax API Key")
    key = api_key.strip()
    last_error = None
    for host in MINIMAX_HOSTS:
        try:
            http_code, payload = _minimax_post(host, "/v1/music_generation", {}, key, timeout=timeout)
        except ValueError as err:
            last_error = err
            continue
        if _is_auth_error(http_code, payload):
            last_error = ValueError(_format_minimax_error(http_code, payload, key))
            continue
        # Non-auth response (e.g. status_code 2013 invalid params) confirms the key is accepted on this host.
        if isinstance(payload, dict) and isinstance(payload.get("base_resp"), dict):
            return host
        if 200 <= http_code < 500:
            return host
    if last_error is not None:
        raise last_error
    raise ValueError("MiniMax API Key 验证失败，请检查网络或密钥是否正确。")


def _detect_audio_ext(raw_bytes):
    if raw_bytes.startswith(b"ID3") or (len(raw_bytes) >= 2 and raw_bytes[0] == 0xFF and (raw_bytes[1] & 0xE0) == 0xE0):
        return ".mp3"
    if raw_bytes.startswith(b"RIFF") and raw_bytes[8:12] == b"WAVE":
        return ".wav"
    if raw_bytes.startswith(b"fLaC"):
        return ".flac"
    return ".mp3"


def _download_audio_bytes(url, timeout=120):
    req = Request(url, headers={"User-Agent": "XixiPharmacyStudio/1.0"})
    try:
        with urlopen(req, timeout=timeout) as response:
            data = response.read()
    except (HTTPError, URLError, TimeoutError) as error:
        raise ValueError("下载 MiniMax 生成的背景音乐失败，请重试。") from error
    if len(data) < 1024:
        raise ValueError("MiniMax 返回的音频文件内容异常，请重试。")
    return data


def call_minimax_music(api_key, model, prompt, host=None, timeout=240):
    """Invoke MiniMax /v1/music_generation to create pure instrumental background music."""
    if not api_key:
        raise ValueError("请先在「模型配置 → 背景音乐」填写 MiniMax API Key。")
    if model not in MUSIC_MODELS:
        model = DEFAULT_MUSIC_MODEL

    hosts = [host] if host in MINIMAX_HOSTS else list(MINIMAX_HOSTS)
    if host in MINIMAX_HOSTS:
        for alt in MINIMAX_HOSTS:
            if alt not in hosts:
                hosts.append(alt)

    base_body = {
        "model": model,
        "prompt": prompt,
        "is_instrumental": True,
        "output_format": "url",
        "audio_setting": {
            "sample_rate": 44100,
            "bitrate": 256000,
            "format": "mp3",
        },
    }

    last_error = None
    for idx, current_host in enumerate(hosts):
        body = dict(base_body)
        try:
            http_code, payload = _minimax_post(current_host, "/v1/music_generation", body, api_key, timeout=timeout)
        except ValueError as err:
            last_error = err
            continue

        # If auth fails on the first host (e.g. user's key is for global .io rather than domestic .com), try next host.
        if _is_auth_error(http_code, payload) and idx + 1 < len(hosts):
            last_error = ValueError(_format_minimax_error(http_code, payload, api_key))
            continue

        base_resp = payload.get("base_resp") if isinstance(payload, dict) else {}
        status_code = base_resp.get("status_code") if isinstance(base_resp, dict) else None
        status_msg = str((base_resp or {}).get("status_msg") or "")

        # Compatibility fallback for older music-2.5 if it rejects is_instrumental and requires lyrics tag.
        if status_code == 2013 and "lyrics" in status_msg.lower() and body.get("is_instrumental"):
            compat_body = {k: v for k, v in body.items() if k != "is_instrumental"}
            compat_body["lyrics"] = "[Inst]\n[Outro]"
            http_code, payload = _minimax_post(current_host, "/v1/music_generation", compat_body, api_key, timeout=timeout)
            base_resp = payload.get("base_resp") if isinstance(payload, dict) else {}
            status_code = base_resp.get("status_code") if isinstance(base_resp, dict) else None

        if http_code >= 400 or (status_code is not None and status_code != 0):
            raise ValueError(_format_minimax_error(http_code, payload, api_key))

        data = payload.get("data") if isinstance(payload, dict) else None
        audio_field = data.get("audio") if isinstance(data, dict) else None
        if not isinstance(audio_field, str) or not audio_field.strip():
            raise ValueError("MiniMax 未返回背景音乐音频数据，请稍后重试。")

        audio_str = audio_field.strip()
        if audio_str.startswith(("http://", "https://")):
            raw_bytes = _download_audio_bytes(audio_str, timeout=120)
        else:
            try:
                raw_bytes = bytes.fromhex(audio_str)
            except ValueError as err:
                raise ValueError("无法解析 MiniMax 返回的音频编码，请重试。") from err
            if len(raw_bytes) < 1024:
                raise ValueError("MiniMax 返回的音频数据不完整，请重试。")

        ext = _detect_audio_ext(raw_bytes)
        extra = payload.get("extra_info") if isinstance(payload, dict) else {}
        dur_ms = extra.get("music_duration") if isinstance(extra, dict) else None
        duration = round(float(dur_ms) / 1000.0, 2) if isinstance(dur_ms, (int, float)) and dur_ms > 0 else None
        trace_id = str(payload.get("trace_id") or "") if isinstance(payload, dict) else ""
        return raw_bytes, ext, duration, current_host, trace_id

    if last_error is not None:
        raise last_error
    raise ValueError("MiniMax 背景音乐生成失败，请检查 API Key 与网络连接后重试。")


LIBRARY_INDEX_NAME = "library.json"
LIBRARY_URL_PREFIX = "/assets/music/generated/"
AUDIO_EXTENSIONS = (".mp3", ".flac", ".wav")


def sanitize_filename_part(text, limit=32):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f\s·]+', "-", str(text or "").strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-. ")
    return cleaned[:limit] or "科普背景音乐"


def build_music_filename(title, ext, track_id):
    stem = sanitize_filename_part(title, limit=32)
    stamp = datetime.now().strftime("%Y%m%d")
    short_id = re.sub(r"[^a-zA-Z0-9]", "", str(track_id))[:6] or uuid.uuid4().hex[:6]
    return f"{stem}-{stamp}-{short_id}{ext}"


def library_audio_url(filename):
    return LIBRARY_URL_PREFIX + quote(str(filename))


def _load_library_raw(library_dir):
    index_path = Path(library_dir) / LIBRARY_INDEX_NAME
    if not index_path.is_file():
        return []
    try:
        data = json.loads(index_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save_library_raw(library_dir, entries):
    lib = Path(library_dir)
    lib.mkdir(parents=True, exist_ok=True)
    index_path = lib / LIBRARY_INDEX_NAME
    tmp = index_path.with_suffix(".tmp.json")
    try:
        tmp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(index_path)
    finally:
        tmp.unlink(missing_ok=True)


def list_music_library(library_dir):
    """Return all valid saved project BGM tracks, syncing with files on disk."""
    lib = Path(library_dir)
    if not lib.is_dir():
        return []
    raw_entries = _load_library_raw(lib)
    valid = []
    seen_files = set()
    dirty = False
    for item in raw_entries:
        if not isinstance(item, dict):
            dirty = True
            continue
        filename = item.get("filename")
        if not isinstance(filename, str) or "/" in filename or "\\" in filename or filename in seen_files:
            dirty = True
            continue
        file_path = (lib / filename).resolve()
        if lib.resolve() not in file_path.parents or not file_path.is_file() or file_path.suffix.lower() not in AUDIO_EXTENSIONS:
            dirty = True
            continue
        seen_files.add(filename)
        track_id = str(item.get("id") or hashlib.sha256(filename.encode("utf-8")).hexdigest()[:12])
        entry = {
            **item,
            "id": track_id,
            "filename": filename,
            "url": library_audio_url(filename),
        }
        valid.append(entry)

    # Also auto-discover any audio files placed manually into public/assets/music/generated/.
    for file_path in sorted(lib.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not file_path.is_file() or file_path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        if file_path.name in seen_files or file_path.name.startswith(".") or ".tmp" in file_path.name:
            continue
        seen_files.add(file_path.name)
        track_id = hashlib.sha256(file_path.name.encode("utf-8")).hexdigest()[:12]
        valid.append(
            {
                "id": track_id,
                "filename": file_path.name,
                "url": library_audio_url(file_path.name),
                "title": file_path.stem,
                "mood": "项目配乐",
                "styleLabel": "本地已存",
                "provider": "library",
                "createdAt": int(file_path.stat().st_mtime),
            }
        )
        dirty = True

    valid.sort(key=lambda x: int(x.get("createdAt") or 0), reverse=True)
    if dirty:
        try:
            _save_library_raw(lib, valid)
        except OSError:
            pass
    return valid


def resolve_library_track(library_dir, track_id):
    if not isinstance(track_id, str) or not track_id.strip():
        raise ValueError("请选择有效的项目背景音乐。")
    lib = Path(library_dir).resolve()
    for entry in list_music_library(lib):
        if entry["id"] == track_id.strip():
            file_path = (lib / entry["filename"]).resolve()
            if lib in file_path.parents and file_path.is_file():
                return file_path, entry
    raise ValueError("未找到所选的项目背景音乐，可能已被移动或删除。")


def rename_library_track(library_dir, track_id, new_title):
    clean_title = _clean_text(new_title, 40)
    if len(clean_title) < 1:
        raise ValueError("请输入新的背景音乐名称。")
    lib = Path(library_dir).resolve()
    entries = list_music_library(lib)
    updated = None
    for entry in entries:
        if entry["id"] != track_id:
            continue
        old_path = (lib / entry["filename"]).resolve()
        if lib not in old_path.parents or not old_path.is_file():
            raise ValueError("背景音乐文件不存在。")
        ext = old_path.suffix.lower() or ".mp3"
        new_filename = build_music_filename(clean_title, ext, entry["id"])
        new_path = (lib / new_filename).resolve()
        if new_path != old_path:
            if new_path.exists():
                new_filename = build_music_filename(clean_title, ext, uuid.uuid4().hex[:6])
                new_path = (lib / new_filename).resolve()
            old_path.rename(new_path)
        entry["title"] = clean_title
        entry["filename"] = new_filename
        entry["url"] = library_audio_url(new_filename)
        updated = entry
        break
    if updated is None:
        raise ValueError("未找到要重命名的背景音乐。")
    _save_library_raw(lib, entries)
    return updated, entries


def delete_library_track(library_dir, track_id):
    lib = Path(library_dir).resolve()
    entries = list_music_library(lib)
    kept = []
    removed = False
    for entry in entries:
        if entry["id"] == track_id:
            file_path = (lib / entry["filename"]).resolve()
            if lib in file_path.parents:
                file_path.unlink(missing_ok=True)
            removed = True
        else:
            kept.append(entry)
    if not removed:
        raise ValueError("未找到要删除的背景音乐。")
    _save_library_raw(lib, kept)
    return kept


def generate_music(
    context,
    library_dir,
    minimax_key,
    *,
    music_model=DEFAULT_MUSIC_MODEL,
    minimax_host=None,
    deepseek_fn=None,
    text_model=None,
):
    """Plan prompt from video content, generate pure instrumental BGM via MiniMax API, and save into project library."""
    if not minimax_key:
        raise ValueError("请先在「模型配置 → 背景音乐」填写 MiniMax API Key，再生成专属背景音乐。")
    model = music_model if music_model in MUSIC_MODELS else DEFAULT_MUSIC_MODEL
    norm = normalize_context(context)
    plan = plan_music_prompt(norm, deepseek_fn=deepseek_fn, text_model=text_model)
    raw_bytes, ext, duration, used_host, trace_id = call_minimax_music(
        minimax_key,
        model,
        plan["prompt"],
        host=minimax_host,
    )
    lib_path = Path(library_dir)
    lib_path.mkdir(parents=True, exist_ok=True)
    track_id = uuid.uuid4().hex[:12]
    filename = build_music_filename(plan["title"], ext, track_id)
    target = lib_path / filename
    tmp = target.with_suffix(".tmp" + ext)
    try:
        tmp.write_bytes(raw_bytes)
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)

    entry = {
        "id": track_id,
        "filename": filename,
        "url": library_audio_url(filename),
        "title": plan["title"],
        "mood": plan["mood"],
        "styleLabel": plan["styleLabel"],
        "bpm": plan["bpm"],
        "prompt": plan["prompt"],
        "description": plan["description"],
        "topic": norm["topic"],
        "drug": norm["drug"],
        "hint": plan["hint"],
        "variant": plan["variant"],
        "model": model,
        "modelLabel": MUSIC_MODELS[model][0],
        "promptSource": plan["promptSource"],
        "provider": "minimax",
        "contentHash": plan["contentHash"],
        "duration": duration,
        "host": used_host,
        "traceId": trace_id,
        "createdAt": int(time.time()),
    }
    existing = list_music_library(lib_path)
    entries = [entry, *[item for item in existing if item["id"] != track_id]]
    _save_library_raw(lib_path, entries)
    return entry
