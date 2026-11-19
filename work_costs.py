"""Per-work usage estimates at the providers' public on-demand rates (CNY)."""

from decimal import Decimal


PRICE_DATE = "2026-11-19"
ARK_PRICE = "https://console.volcengine.com/ark/region%3Acn-beijing/docs/model-pricing"
DEEPSEEK_PRICE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing"
SPEECH_PRICE = "https://docs.volcengine.com/docs/doubao-voice/billing-instructions?lang=zh"
DASHSCOPE_PRICE = "https://help.aliyun.com/zh/model-studio/billing-for-model-studio"
MINIMAX_PRICE = "https://platform.minimaxi.com/docs/guides/pricing-paygo"
AVATAR_RATES = {
    "videoretalk": Decimal("0.08"),
    "wan2.2-s2v": Decimal("0.50"),
    "wan2.2-s2v:480P": Decimal("0.50"),
    "wan2.2-s2v:720P": Decimal("0.90"),
}
MUSIC_RATES = {
    # MiniMax official API pay-as-you-go: ~$0.15 / track (approx. ¥1.08 / track).
    "music-3.0": Decimal("1.08"),
    "music-2.6": Decimal("1.08"),
    "music-2.5+": Decimal("1.08"),
    "music-2.5": Decimal("1.08"),
}
TEXT_RATES = {
    # Standard online inference (peak standard rates for DeepSeek), per million input, cached input, and output tokens.
    "deepseek-flash": ("2.00", "0.04", "8.00"),
    "deepseek-v4-flash": ("2.00", "0.04", "8.00"),
    "deepseek-v4-pro": ("9.00", "0.30", "27.00"),
    "deepseek-chat": ("2.00", "0.04", "8.00"),
    "deepseek-reasoner": ("4.00", "0.10", "16.00"),
    "doubao-seed-2-1-lite-260915": ("0.80", "0.16", "2.70"),
    "doubao-seed-2.1-lite": ("0.80", "0.16", "2.70"),
}
VIDEO_RATES = {
    # The workbench sends images and text to these models, without an input video.
    "doubao-seedance-2-5-260628": {"480p": 70, "720p": 70, "1080p": 77},
    "doubao-seedance-2-5-flash-261115": {"480p": 46, "720p": 46},
    "doubao-seedance-2-0-260128": {"480p": 46, "720p": 46, "1080p": 51},
}
IMAGE_RATES = {
    "doubao-seedream-5-0-260128": "0.22",
    "doubao-seedream-4-5-251128": "0.25",
}


def counter(value):
    return value if type(value) is int and value >= 0 else None


def usage_value(usage, key):
    return usage.get(key) if isinstance(usage, dict) else None


def entry(label, model, usage, amount, index=None):
    return {"label": label, "model": model, "usage": usage, "amount": str(amount) if amount is not None else None,
            "index": index}


def text_cost(label, model, usage):
    incoming = counter(usage_value(usage, "prompt_tokens"))
    outgoing = counter(usage_value(usage, "completion_tokens"))
    cached = counter(usage_value(usage, "prompt_cache_hit_tokens"))
    if cached is None:
        cached = counter(usage_value(usage_value(usage, "prompt_tokens_details"), "cached_tokens")) or 0
    if incoming is None or outgoing is None:
        return entry(label, model, "缺少 Token 用量", None)
    cached = min(cached, incoming)
    details = f"输入 {incoming:,} Token · 输出 {outgoing:,} Token"
    if cached:
        details += f" · 缓存命中 {cached:,} Token"
    rate = TEXT_RATES.get(model) or TEXT_RATES.get(str(model or "").lower())
    amount = None
    if rate:
        normal, hit, out = map(Decimal, rate)
        amount = ((incoming - cached) * normal + cached * hit + outgoing * out) / 1_000_000
    return entry(label, model, details, amount)


def image_cost(model, size, reference_count, index):
    amount = None
    if model == "doubao-seedream-5-5-261028":
        width, height = map(int, size.split("x"))
        pixels = width * height
        if pixels <= 4_630_000:
            amount = Decimal("0.13" if pixels <= 2_610_000 else "0.23") + Decimal("0.05") * reference_count
    elif model in IMAGE_RATES:
        amount = Decimal(IMAGE_RATES[model])
    return entry("配图生成", model, f"输出 1 张（{size}）· 参考图 {reference_count} 张", amount, index)


def video_cost(model, resolution, seconds, tokens, index, dimensions):
    rate = VIDEO_RATES.get(model, {}).get(resolution)
    tokens = counter(tokens)
    unit_count = tokens
    if unit_count is None and seconds is not None:
        width, height = dimensions
        unit_count = Decimal(str(seconds)) * width * height * 24 / 1024
    details = f"{resolution}"
    if seconds is not None:
        details += f" · {seconds:g} 秒"
    details += f" · {tokens:,} Token" if tokens is not None else " · 按视频规格估算" if unit_count is not None else " · 缺少 Token 用量"
    amount = None if rate is None or unit_count is None else unit_count * Decimal(rate) / 1_000_000
    return entry(f"第 {index + 1} 幕动画", model, details, amount, index)


def speech_cost(characters, line, voice, index):
    characters = counter(characters)
    units = characters if characters is not None else len(line)
    source = "计费字符" if characters is not None else "字符（按提交台词估算）"
    return entry(f"第 {index + 1} 幕配音", "豆包语音合成 2.0", f"{voice} · {units:,} {source}",
                 Decimal("0.0003") * units, index)


def avatar_cost(model, seconds, *, cached=False, chunk_label="", resolution=""):
    label = f"数字人对口型{chunk_label}" if chunk_label else "数字人对口型"
    if cached:
        details = f"复用本地数字人视频（约 {float(seconds):.1f} 秒）" if seconds else "复用本地数字人视频"
        return entry(label, model, details, Decimal("0"))
    rate_key = f"{model}:{resolution}" if resolution and f"{model}:{resolution}" in AVATAR_RATES else model
    rate = AVATAR_RATES.get(rate_key)
    dur = Decimal(str(round(float(seconds), 2))) if seconds is not None and float(seconds) > 0 else None
    spec = f"{resolution} · " if resolution else ""
    mode_tag = "分段连续生成" if chunk_label else "整片连续生成"
    details = f"{spec}{mode_tag} · {float(seconds):.2f} 秒" if dur is not None else "缺少视频时长"
    amount = None if rate is None or dur is None else (dur * rate).quantize(Decimal("0.0001"))
    return entry(label, model, details, amount)


def music_cost(model, duration_sec=None):
    rate = MUSIC_RATES.get(model)
    dur_text = f" · 约 {round(float(duration_sec))} 秒" if isinstance(duration_sec, (int, float)) and duration_sec > 0 else ""
    return entry("AI 背景音乐生成", model, f"MiniMax 纯音乐 1 首{dur_text}", rate)
