"use strict";

(function (global) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v) => (global.MgKit ? global.MgKit.clamp(v) : Math.max(0, Math.min(1, Number(v) || 0)));
  const easeOutExpo = (v) => (global.MgKit ? global.MgKit.easing.outExpo(v) : clamp(v) >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(v)));
  const easeOutCubic = (v) => (global.MgKit ? global.MgKit.easing.outCubic(v) : 1 - Math.pow(1 - clamp(v), 3));

  const SIZE_RATIO = { s: 0.14, m: 0.2, l: 0.26 };
  const SIZE_DOWN = { l: "m", m: "s", s: "s" };
  const FALLBACK_CORNERS = ["media-tr", "media-br", "media-tl", "media-bl"];
  const ENTER_DURATION = 0.42;

  function stickerWindow(shot, st) {
    const duration = Math.max(0.5, (Number(shot.end) || 4) - (Number(shot.start) || 0));
    const captions = shot.captions || [];
    const cueIdx = Number.isInteger(st.cue) && st.cue >= 0 && st.cue < captions.length ? st.cue : 0;
    const cue = captions[cueIdx];
    let appear = cue ? Math.max(0, cue.start - shot.start) : 0;
    const cueEnd = cue ? Math.max(appear + 0.25, cue.end - shot.start) : duration;
    if (st.keyword && cue?.text) {
      const pos = cue.text.indexOf(st.keyword);
      if (pos >= 0) {
        const ratio = pos / Math.max(1, cue.text.length);
        appear = Math.min(cueEnd - 0.2, appear + ratio * (cueEnd - appear) * 0.85);
      }
    }
    const disappear = st.hold === "cue" ? cueEnd : duration;
    return { appear, disappear };
  }

  function autoSfxId(tags) {
    const joined = (Array.isArray(tags) ? tags : []).join(" ");
    if (/警示|警告|注意|提醒|禁止|叉|错|停|禁忌/.test(joined)) return "builtin:sfx/transition";
    if (/对勾|正确|勾选|确认|点赞|推荐/.test(joined)) return "builtin:sfx/check";
    return "builtin:sfx/soft-pop";
  }

  function offsetRectIn(el, root) {
    let x = 0;
    let y = 0;
    let cur = el;
    while (cur && cur !== root && cur.offsetParent) {
      x += cur.offsetLeft || 0;
      y += cur.offsetTop || 0;
      cur = cur.offsetParent;
    }
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    if (!w || !h) return null;
    return { x, y, w, h };
  }

  function overlapArea(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    return x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) : 0;
  }

  function candidateRect(anchor, px, slotW, slotH, slot) {
    const pad = Math.round(Math.max(10, Math.min(slotW, slotH) * 0.032));
    if (anchor === "media-tl") return { x: pad, y: pad, w: px, h: px };
    if (anchor === "media-tr") return { x: slotW - pad - px, y: pad, w: px, h: px };
    if (anchor === "media-bl") return { x: pad, y: slotH - pad - px, w: px, h: px };
    if (anchor === "media-br") return { x: slotW - pad - px, y: slotH - pad - px, w: px, h: px };
    if (anchor === "headline-end") {
      const target = slot.querySelector('[data-anchor="headline-end"], .if-headline, .cm-heading, .pt-fb-headline');
      const r = target && offsetRectIn(target, slot);
      if (r) {
        return {
          x: Math.max(pad, Math.min(slotW - pad - px, r.x + r.w + 8)),
          y: Math.max(pad, Math.min(slotH - pad - px, r.y + (r.h - px) / 2)),
          w: px, h: px,
        };
      }
      return { x: slotW - pad - px, y: pad, w: px, h: px };
    }
    if (/^item-[0-3]$/.test(anchor)) {
      const idx = Number(anchor.slice(5));
      const target = slot.querySelector(`[data-anchor="${anchor}"]`) ||
        slot.querySelectorAll(".cm-item, .pt-focus-target")[idx];
      const r = target && offsetRectIn(target, slot);
      if (r) {
        return {
          x: Math.max(pad, Math.min(slotW - pad - px, r.x + r.w - px * 0.35)),
          y: Math.max(pad, Math.min(slotH - pad - px, r.y - px * 0.2)),
          w: px, h: px,
        };
      }
    }
    return { x: slotW - pad - px, y: pad, w: px, h: px };
  }

  function placeSticker(anchor, sizeKey, slotW, slotH, slot, avoidRects) {
    const shortSide = Math.min(slotW, slotH);
    const trySize = (sk) => {
      const px = Math.max(40, Math.round(shortSide * (SIZE_RATIO[sk] || 0.2)));
      const order = [anchor, ...FALLBACK_CORNERS.filter((c) => c !== anchor)];
      let best = null;
      for (const cand of order) {
        const rect = candidateRect(cand, px, slotW, slotH, slot);
        const totalOverlap = avoidRects.reduce((sum, r) => sum + overlapArea(rect, r), 0);
        if (totalOverlap === 0) return { rect, anchor: cand, size: sk, overlap: 0 };
        if (!best || totalOverlap < best.overlap) best = { rect, anchor: cand, size: sk, overlap: totalOverlap };
      }
      return best;
    };
    const first = trySize(sizeKey);
    if (first.overlap === 0 || sizeKey === "s") return first;
    const smaller = trySize(SIZE_DOWN[sizeKey]);
    return smaller.overlap <= first.overlap ? smaller : first;
  }

  function mount(slot, shot, ctx) {
    const list = Array.isArray(shot.stickers) ? shot.stickers.slice(0, 2) : [];
    if (!list.length) return null;
    const slotW = Math.round(slot.clientWidth || ctx?.size?.w || 960);
    const slotH = Math.round(slot.clientHeight || ctx?.size?.h || 540);
    const avoidNodes = [...slot.querySelectorAll("[data-sticker-avoid], .pt-focus-target, .cm-heading, .cm-item, .stage-mg-overlay")];
    const avoidRects = avoidNodes.map((el) => offsetRectIn(el, slot)).filter(Boolean);
    const layer = slot.ownerDocument.createElement("div");
    layer.className = "stage-sticker-layer";
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:20;overflow:hidden;";
    const entries = [];
    for (let i = 0; i < list.length; i++) {
      const st = list[i];
      const url = st.url || (st.assetId && ctx?.mapSrc ? ctx.mapSrc(st.assetId) : "");
      if (!url) continue;
      const placed = placeSticker(st.anchor || "media-tr", st.size || "m", slotW, slotH, slot, avoidRects);
      avoidRects.push(placed.rect);
      const wrap = slot.ownerDocument.createElement("div");
      wrap.className = "stage-sticker-item";
      wrap.dataset.stickerIndex = String(i);
      wrap.dataset.stickerAnchor = placed.anchor;
      wrap.dataset.stickerSize = placed.size;
      wrap.style.cssText = `position:absolute;left:${Math.round(placed.rect.x)}px;top:${Math.round(placed.rect.y)}px;` +
        `width:${placed.rect.w}px;height:${placed.rect.h}px;opacity:0;visibility:hidden;transform-origin:center center;`;
      const img = slot.ownerDocument.createElement("img");
      img.src = url;
      img.alt = "";
      img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.18));";
      wrap.append(img);
      layer.append(wrap);
      const win = stickerWindow(shot, st);
      entries.push({ el: wrap, st, ...win, isLeft: placed.rect.x < slotW / 2 });
    }
    if (!entries.length) return null;
    slot.append(layer);
    return { layer, entries };
  }

  function draw(mounted, shot, localTime) {
    if (!mounted) return;
    for (const entry of mounted.entries) {
      const { el, st, appear, disappear, isLeft } = entry;
      if (localTime < appear || localTime >= disappear) {
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        el.style.transform = "scale(0.6)";
        continue;
      }
      el.style.visibility = "visible";
      const dt = Math.max(0, localTime - appear);
      const p = clamp(dt / ENTER_DURATION);
      const enter = st.enter || "pop";
      let opacity = easeOutExpo(p);
      let transform = "none";
      if (enter === "pop") {
        const s = p < 0.7 ? 0.3 + 0.8 * easeOutCubic(p / 0.7) : 1.1 - 0.1 * easeOutCubic((p - 0.7) / 0.3);
        transform = `scale(${s.toFixed(3)})`;
      } else if (enter === "bounce") {
        const bounceY = p < 1 ? -32 * Math.exp(-4.5 * p) * Math.abs(Math.cos(p * Math.PI * 1.8)) : 0;
        transform = `translateY(${bounceY.toFixed(2)}px) scale(${(0.85 + 0.15 * easeOutExpo(p)).toFixed(3)})`;
      } else if (enter === "slide") {
        const dir = isLeft ? -1 : 1;
        const dx = (1 - easeOutExpo(p)) * 42 * dir;
        transform = `translateX(${dx.toFixed(2)}px)`;
      } else if (enter === "stamp") {
        opacity = Math.min(1, p * 2.6);
        const s = p < 0.65 ? 1.8 - 0.88 * easeOutCubic(p / 0.65) : 0.92 + 0.08 * easeOutCubic((p - 0.65) / 0.35);
        const rot = -10 + 4 * easeOutCubic(p);
        transform = `scale(${s.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`;
      } else {
        // float
        const s = 0.4 + 0.6 * easeOutExpo(p);
        const bob = Math.sin(dt * 2.8) * 5 * easeOutCubic(p);
        transform = `translateY(${bob.toFixed(2)}px) scale(${s.toFixed(3)})`;
      }
      el.style.opacity = String(opacity.toFixed(3));
      el.style.transform = transform;
    }
  }

  function isDynamic(shot, localTime) {
    const list = Array.isArray(shot.stickers) ? shot.stickers : [];
    for (const st of list) {
      const { appear, disappear } = stickerWindow(shot, st);
      if (localTime >= appear && localTime < disappear) {
        if (localTime <= appear + ENTER_DURATION + 0.05) return true;
        if (st.enter === "float") return true;
      }
    }
    return false;
  }

  function stateKey(shot, localTime) {
    const list = Array.isArray(shot.stickers) ? shot.stickers : [];
    if (!list.length) return "";
    return list.map((st) => {
      const { appear, disappear } = stickerWindow(shot, st);
      return localTime >= appear && localTime < disappear ? "1" : "0";
    }).join("");
  }

  function events(shot) {
    const list = Array.isArray(shot.stickers) ? shot.stickers.slice(0, 2) : [];
    const out = [];
    for (const st of list) {
      if (st.sfx === "none") continue;
      const { appear } = stickerWindow(shot, st);
      const sfxId = st.sfx && st.sfx !== "auto" ? st.sfx : autoSfxId(st.tags);
      out.push({ t: appear, type: "sticker", sfxId });
    }
    return out;
  }

  global.StageStickers = { mount, draw, events, isDynamic, stateKey, autoSfxId, stickerWindow };
})(globalThis);
