"use strict";

(function (global) {
  function xmlEsc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const THEME_VAR_NAMES = new Set([
    "--v-bg", "--v-ink", "--v-ink-soft", "--v-primary", "--v-primary-deep", "--v-primary-soft",
    "--v-coral", "--v-coral-soft", "--v-amber", "--v-amber-soft", "--v-green", "--v-green-soft",
    "--v-card-bg", "--v-card-border", "--v-card-shadow", "--v-card-radius",
    "--v-ring-outer", "--v-ring-track", "--v-ring-inner", "--v-sub-hl",
    "--v-card-border-w", "--v-card-blur", "--v-band", "--v-band-ink",
    "--v-rail-bg", "--v-rail-ink", "--v-rail-line",
  ]);
  const THEME_FORBIDDEN = /url\s*\(|;|[{}<>"'\\]|\/\*|expression|@|\r|\n/i;
  const THEME_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const THEME_RGB = /^rgba?\(\s*[\d.,\s%]+\s*\)$/;
  const THEME_LENGTH = /^\d+(?:\.\d+)?px$/;
  const THEME_BLUR = /^(?:none|blur\(\d+(?:\.\d+)?px\)(?:\s+saturate\(\d+(?:\.\d+)?\))?)$/;
  const THEME_SHADOW = /^[\d.\s,pxrgba()%]+$/;
  const THEME_GRADIENT = /^(?:linear|radial)-gradient\([\d.\s,%a-zA-Z#()-]+\)$/;

  function isSafeColor(value) {
    if (typeof value !== "string") return false;
    const text = value.trim();
    return Boolean(text && !THEME_FORBIDDEN.test(text) && (THEME_HEX.test(text) || THEME_RGB.test(text)));
  }

  function safeColor(value, fallback) {
    return isSafeColor(value) ? value.trim() : fallback;
  }

  function isSafeThemeVar(name, value) {
    if (!THEME_VAR_NAMES.has(name) || typeof value !== "string") return false;
    const text = value.trim();
    if (!text || THEME_FORBIDDEN.test(text)) return false;
    if (name === "--v-card-radius" || name === "--v-card-border-w") return THEME_LENGTH.test(text);
    if (name === "--v-card-blur") return THEME_BLUR.test(text);
    if (name === "--v-card-shadow") return text.length <= 120 && THEME_SHADOW.test(text);
    if (name === "--v-bg") return text.length <= 300 && (isSafeColor(text) || THEME_GRADIENT.test(text));
    return isSafeColor(text);
  }

  function safeThemeVars(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [name, value] of Object.entries(raw)) {
      if (isSafeThemeVar(name, value)) out[name] = value.trim();
    }
    return out;
  }

  function parseRgb(color) {
    if (typeof color !== "string") return null;
    const text = color.trim();
    if (THEME_HEX.test(text)) {
      const hex = text.slice(1);
      if (hex.length === 3) {
        return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
      }
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    const m = /^rgba?\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)/.exec(text);
    if (!m) return null;
    return [1, 3, 5].map((idx) => {
      const num = Number(m[idx]);
      return m[idx + 1] === "%" ? Math.round(num * 2.55) : Math.round(num);
    });
  }

  function isDarkTheme(deck) {
    const bg = deck?.themeVars?.["--v-card-bg"];
    const rgb = parseRgb(bg);
    if (!rgb) return false;
    const lin = (channel) => {
      const s = Math.max(0, Math.min(1, channel / 255));
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return lum < 0.35;
  }

  function themeFrameMeta(deck, mapSrc) {
    const vars = safeThemeVars(deck?.themeVars);
    const declarations = Object.entries(vars).map(([k, v]) => `${k}:${v}`);
    let hasThemeBg = false;
    if (deck?.themeBackground) {
      const mapped = String(mapSrc(deck.themeBackground) || "").trim();
      const isDataImg = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(mapped);
      const isLocalUrl = /^(?:\/|file:\/\/|blob:)/i.test(mapped) && !/["'()\\;\r\n<>]/.test(mapped);
      if (isDataImg || isLocalUrl) {
        declarations.push(`--v-bg:center / cover no-repeat url("${mapped}")`);
        hasThemeBg = true;
      }
    }
    const classes = [];
    if (deck?.themeGlass) classes.push("is-glass");
    if (isDarkTheme(deck)) classes.push("is-dark");
    if (hasThemeBg) classes.push("has-theme-bg");
    return {
      classSuffix: classes.length ? " " + classes.join(" ") : "",
      styleAttr: declarations.length ? ` style="${xmlEsc(declarations.join(";"))}"` : "",
    };
  }

  function renderAvatarProgress(progress, strokeRatio = 3.5) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const sw = Math.max(2, Number(strokeRatio) || 3.5);
    const r = 50 - sw / 2;
    const circ = 2 * Math.PI * r;
    let progressCircle = "";
    if (p >= 0.999) {
      progressCircle = `<circle cx="50" cy="50" r="${r.toFixed(2)}" fill="none" stroke="var(--v-ring-outer)" stroke-width="${sw.toFixed(2)}" />`;
    } else if (p > 0.002) {
      const dash = Math.max(0.01, circ * p);
      progressCircle = `<circle cx="50" cy="50" r="${r.toFixed(2)}" fill="none" stroke="var(--v-ring-outer)" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circ + 10).toFixed(2)}" transform="rotate(-90 50 50)" />`;
    }
    return progressCircle
      ? `<svg class="pt-avatar-progress" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">${progressCircle}</svg>`
      : "";
  }

  function renderAvatarRing(avatarSrc, progress, strokeRatio) {
    const svgHtml = renderAvatarProgress(progress, strokeRatio);
    return `<div class="pt-avatar-ring">${svgHtml}<div class="pt-avatar-inner"><img src="${xmlEsc(avatarSrc)}" alt="" /></div></div>`;
  }

  function renderLeftBlock(deck, mapSrc, ringProgress, placement = "", showDisclaimer = true) {
    const a = deck.pharmacist;
    const disclaimerHtml = showDisclaimer && deck.disclaimer
      ? `<div class="pt-disclaimer">${xmlEsc(deck.disclaimer)}</div>`
      : "";

    if (deck.presenter === "none") {
      return `
        <aside class="pt-left"${placement}>
          <div class="pt-author-card">
            <span class="pt-tape"></span>
            <div class="pt-author-emblem">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/></svg>
            </div>
            <div class="pt-plaque-top">
              <span class="pt-plaque-name">${xmlEsc(a.name || "药师")}</span>
              ${a.role ? `<span class="pt-plaque-role">${xmlEsc(a.role)}</span>` : ""}
            </div>
            ${a.hospital ? `<div class="pt-plaque-hosp">${xmlEsc(a.hospital)}</div>` : ""}
            <div class="pt-author-trust">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span>药师专业核稿讲解</span>
            </div>
          </div>
          ${disclaimerHtml}
        </aside>
      `;
    }

    const avatarSrc = mapSrc(TemplateVideo.resolveAvatarSrc(deck));
    return `
      <aside class="pt-left"${placement}>
        <div class="pt-avatar-wrap">
          ${renderAvatarRing(avatarSrc, ringProgress, 3.45)}
          <div class="pt-plaque">
            <div class="pt-plaque-top">
              <span class="pt-plaque-name">${xmlEsc(a.name || "药师")}</span>
              ${a.role ? `<span class="pt-plaque-role">${xmlEsc(a.role)}</span>` : ""}
            </div>
            ${a.hospital ? `<div class="pt-plaque-hosp">${xmlEsc(a.hospital)}</div>` : ""}
          </div>
        </div>
        ${disclaimerHtml}
      </aside>
    `;
  }

  function renderHookStage(deck, slide, mapSrc, focusKey, ringProgress) {
    const a = deck.pharmacist;
    const questionText = slide.question || slide.headline || deck.title;
    const answerText = slide.answer || slide.lead || slide.footerNote || "请按药品说明书和医嘱规律服用";
    const pills = (Array.isArray(slide.pills) ? slide.pills : []).filter(Boolean).slice(0, 3);
    const questionHtml = TemplateVideo.highlightText(questionText, slide.accentPhrase ? [slide.accentPhrase] : [], "pt-hl-coral");
    const isQuestionBeat = focusKey === "question";

    const avatarPart = deck.presenter === "none"
      ? `<div class="pt-author-emblem"><svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/></svg></div>`
      : renderAvatarRing(mapSrc(TemplateVideo.resolveAvatarSrc(deck)), ringProgress, 4.9);

    if (isQuestionBeat) {
      return `
        <div class="pt-hook-stage is-question">
          <div class="pt-hook-question-card">
            <span class="pt-hook-eyebrow">用药常见疑问 · 药师来解答</span>
            <div class="pt-hook-question-hero">${questionHtml}</div>
          </div>
          <div class="pt-hook-presenter-bar">
            ${avatarPart}
            <div class="pt-hook-presenter-meta">
              <div class="pt-plaque-top">
                <span class="pt-plaque-name">${xmlEsc(a.name || "药师")}</span>
                ${a.role ? `<span class="pt-plaque-role">${xmlEsc(a.role)}</span>` : ""}
              </div>
              ${a.hospital ? `<div class="pt-plaque-hosp">${xmlEsc(a.hospital)}</div>` : ""}
            </div>
          </div>
          ${deck.disclaimer ? `<div class="pt-disclaimer">${xmlEsc(deck.disclaimer)}</div>` : ""}
        </div>
      `;
    }

    const miniAvatar = deck.presenter === "none"
      ? ""
      : renderAvatarRing(mapSrc(TemplateVideo.resolveAvatarSrc(deck)), ringProgress, 5.7);
    const checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>';

    return `
      <div class="pt-hook-stage is-answer">
        <div class="pt-hook-q-mini">
          <span class="pt-hook-q-tag">问</span>
          <span>${xmlEsc(questionText)}</span>
        </div>
        <div class="pt-hook-answer-card">
          <span class="pt-hook-answer-badge">${checkSvg}直接看结论</span>
          <div class="pt-hook-answer-text">${xmlEsc(answerText)}</div>
          ${pills.length ? `
            <div class="pt-hook-pills">
              ${pills.map((p) => `<span class="pt-hook-pill">${xmlEsc(p)}</span>`).join("")}
            </div>
          ` : ""}
        </div>
        <div class="pt-hook-mini-foot">
          <div class="pt-mini-presenter">
            ${miniAvatar}
            <div>
              <span class="pt-mini-presenter-text">${xmlEsc(a.name || "药师")}${a.role ? " · " + xmlEsc(a.role) : ""}</span>
              ${a.hospital ? `<span class="pt-mini-presenter-sub">${xmlEsc(a.hospital)}</span>` : ""}
            </div>
          </div>
          ${deck.disclaimer ? `<div class="pt-disclaimer" style="width:auto;text-align:right">${xmlEsc(deck.disclaimer)}</div>` : ""}
        </div>
      </div>
    `;
  }

  function renderOutroStage(deck, slide, mapSrc, ringProgress) {
    const a = deck.pharmacist;
    const note = slide.outroNote
      || (Array.isArray(slide.points) && slide.points.length
        ? slide.points.map((pt) => pt.title).filter(Boolean).slice(0, 2).join("，")
        : "按说明书和医嘱规律服药，有异常及时就医问药师");
    const avatarPart = deck.presenter === "none"
      ? `<div class="pt-author-emblem" style="width:76px;height:76px"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/></svg></div>`
      : renderAvatarRing(mapSrc(TemplateVideo.resolveAvatarSrc(deck)), ringProgress, 3.7);

    return `
      <div class="pt-outro-stage">
        <div class="pt-outro-card">
          ${avatarPart}
          <div class="pt-plaque-top">
            <span class="pt-plaque-name" style="font-size:24px">${xmlEsc(a.name || "药师")}</span>
            ${a.role ? `<span class="pt-plaque-role" style="font-size:14px">${xmlEsc(a.role)}</span>` : ""}
          </div>
          ${a.hospital ? `<div class="pt-plaque-hosp" style="margin-top:-8px;font-size:15.5px">${xmlEsc(a.hospital)}</div>` : ""}
          <div class="pt-outro-divider"></div>
          <span class="pt-outro-eyebrow">记住这一条</span>
          <div class="pt-outro-note">${xmlEsc(note)}</div>
          ${deck.disclaimer ? `<div class="pt-outro-disclaimer">${xmlEsc(deck.disclaimer)}</div>` : ""}
        </div>
      </div>
    `;
  }

  function regionsFor(layout, stage) {
    return layout?.stages?.[stage]?.regions || layout?.regions;
  }

  function mediaSize(layout, stage = "explain") {
    if (!layout) return { w: 960, h: 540 };
    const canvas = layout.canvas || { w: 1280, h: 720 };
    const region = regionsFor(layout, stage)?.media;
    if (!region) return { w: 960, h: 540 };
    return { w: region.w * canvas.w / 100, h: region.h * canvas.h / 100 };
  }

  const NAMED_RATIOS = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
  ];
  const ARK_RATIOS = [
    ["16:9", 16 / 9],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
  ];
  const IMAGE_PRESETS = {
    "1K": ["1424x800", "800x1424", "864x1152", "1024x1024"],
    "2K": ["2848x1600", "1600x2848", "1728x2304", "2048x2048"],
    "4K": ["5504x3040", "3040x5504", "3520x4704", "4096x4096"],
  };
  const IMAGE_TIERS = {
    "1K": [1120000, 950000, 2500000, 2048],
    "2K": [4194304, 3720000, 4600000, 4096],
    "4K": [14500000, 10500000, 16700000, 6192],
  };

  function formatRatioLabel(w, h) {
    const ar = h ? w / h : 16 / 9;
    for (const [label, target] of NAMED_RATIOS) {
      if (Math.abs(ar - target) / target <= 0.025) return label;
    }
    return ar >= 1 ? `${ar.toFixed(2)}:1` : `1:${(1 / ar).toFixed(2)}`;
  }

  function nearestArkRatio(w, h) {
    const ar = h ? w / h : 16 / 9;
    let best = "16:9";
    let bestDiff = Infinity;
    for (const [label, target] of ARK_RATIOS) {
      const diff = Math.abs(Math.log(ar / target));
      if (diff < bestDiff) { bestDiff = diff; best = label; }
    }
    return best;
  }

  function imagePixelSize(tier, w, h) {
    const presets = IMAGE_PRESETS[tier] || IMAGE_PRESETS["2K"];
    const [targetPx, minPx, maxPx, maxSide] = IMAGE_TIERS[tier] || IMAGE_TIERS["2K"];
    const ar = h ? w / h : 16 / 9;
    for (const preset of presets) {
      const [pw, ph] = preset.split("x").map(Number);
      if (Math.abs(ar - pw / ph) / ar <= 0.015) return preset;
    }
    const maxAligned = Math.floor(maxSide / 16) * 16;
    let rawW = Math.sqrt(targetPx * ar);
    let rawH = Math.sqrt(targetPx / ar);
    if (Math.max(rawW, rawH) > maxAligned) {
      const scale = maxAligned / Math.max(rawW, rawH);
      rawW *= scale;
      rawH *= scale;
    }
    let pw = Math.min(maxAligned, Math.max(64, Math.round(rawW / 16) * 16));
    let ph = Math.min(maxAligned, Math.max(64, Math.round(rawH / 16) * 16));
    while (pw * ph > maxPx && (pw > 64 || ph > 64)) {
      const cand = [];
      if (pw > 64) cand.push([Math.abs((pw - 16) / ph - ar), pw - 16, ph]);
      if (ph > 64) cand.push([Math.abs(pw / (ph - 16) - ar), pw, ph - 16]);
      cand.sort((a, b) => a[0] - b[0]);
      [, pw, ph] = cand[0];
    }
    while (pw * ph < minPx && (pw < maxAligned || ph < maxAligned)) {
      const cand = [];
      if (pw + 16 <= maxAligned) cand.push([Math.abs((pw + 16) / ph - ar), pw + 16, ph]);
      if (ph + 16 <= maxAligned) cand.push([Math.abs(pw / (ph + 16) - ar), pw, ph + 16]);
      if (!cand.length) break;
      cand.sort((a, b) => a[0] - b[0]);
      [, pw, ph] = cand[0];
    }
    return `${pw}x${ph}`;
  }

  function describeMediaSlot(layoutOrSlot, stage = "explain") {
    if (layoutOrSlot && typeof layoutOrSlot === "object" && Number.isFinite(layoutOrSlot.w) && Number.isFinite(layoutOrSlot.h) && layoutOrSlot.art) {
      return layoutOrSlot;
    }
    const layout = layoutOrSlot && typeof layoutOrSlot === "object" ? layoutOrSlot : null;
    const regions = regionsFor(layout, stage) || {};
    const raw = mediaSize(layout, stage);
    const w = Math.max(64, Math.round(raw.w));
    const h = Math.max(64, Math.round(raw.h));
    const aspect = Number((w / h).toFixed(4));
    const shape = aspect < 0.85 ? "portrait"
      : aspect >= 2.2 && h <= 420 ? "shallow-wide"
        : aspect >= 2.2 ? "ultrawide"
          : w <= 720 ? "narrow"
            : h <= 420 ? "shallow"
              : (w <= 860 || h <= 480) ? "compact"
                : "standard";

    let artPlacement = "left", artW, artH;
    if (w <= 720) {
      artPlacement = "top";
      artW = Math.max(120, w - 36);
      artH = Math.max(120, Math.min(200, Math.round(h * 0.39)));
    } else if (h <= 420) {
      artW = Math.max(120, Math.round((w - 40) * 0.36));
      artH = Math.max(120, h - 28);
    } else if (aspect >= 2.2) {
      artW = Math.max(120, Math.round((w - 56) * 0.38));
      artH = Math.max(120, h - 40);
    } else if (w <= 860 || h <= 480) {
      artW = Math.max(120, Math.round((w - 40) * 0.40));
      artH = Math.max(120, h - 32);
    } else {
      artW = Math.max(120, Math.round((w - 54) * 0.41));
      artH = Math.max(120, h - 48);
    }
    const artAspect = Number((artW / artH).toFixed(4));
    const artOrientation = artAspect > 1.15 ? "landscape" : artAspect < 0.87 ? "portrait" : "square";

    const sizeClasses = [];
    if (w <= 720) sizeClasses.push("pt-slot-narrow");
    else if (w <= 860 || (h <= 480 && h > 420)) sizeClasses.push("pt-slot-compact");
    if (h <= 420) sizeClasses.push("pt-slot-shallow");
    if (aspect >= 2.2) sizeClasses.push("pt-slot-ultrawide");
    if (aspect < 0.85) sizeClasses.push("pt-slot-portrait");

    return {
      w, h, aspect,
      ratioLabel: formatRatioLabel(w, h),
      arkRatio: nearestArkRatio(w, h),
      shape,
      sizeClasses,
      hasAnswer: Boolean(regions.answer),
      hasHeadline: Boolean(regions.headline),
      hasKeypoints: Boolean(regions.keypoints),
      isFlush: regions.media?.variant === "flush",
      hasNavPanel: regions.chapters?.variant === "nav-panel",
      art: {
        w: artW, h: artH, aspect: artAspect,
        ratioLabel: formatRatioLabel(artW, artH),
        arkRatio: nearestArkRatio(artW, artH),
        placement: artPlacement,
        orientation: artOrientation,
      },
    };
  }

  function placement(layout, region) {
    if (!region) return "";
    const px = (value, axis) => (value * axis / 100).toFixed(6) + "px";
    const { w, h } = layout.canvas;
    return ` style="position:absolute;left:${px(region.x, w)};top:${px(region.y, h)};width:${px(region.w, w)};height:${px(region.h, h)}"`;
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatDurationApprox(chaptersCount, totalDuration) {
    const base = `共 ${chaptersCount} 章`;
    const dur = Number(totalDuration) || 0;
    if (dur <= 0) return base;
    if (dur >= 60) return `${base} · 约 ${Math.max(1, Math.round(dur / 60))} 分钟`;
    return `${base} · 约 ${Math.max(1, Math.round(dur))} 秒`;
  }

  function renderEmblemSvg(size = 24) {
    return `<div class="pt-author-emblem"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/></svg></div>`;
  }

  function renderMiniAvatar(deck, mapSrc, emblemSize = 22) {
    if (deck.presenter === "none") return `<div class="pt-mini-avatar">${renderEmblemSvg(emblemSize)}</div>`;
    const avatarSrc = mapSrc(TemplateVideo.resolveAvatarSrc(deck));
    return `<div class="pt-mini-avatar"><div class="pt-avatar-inner"><img src="${xmlEsc(avatarSrc)}" alt="" /></div></div>`;
  }

  function keypointItemState(index, focusVal) {
    const key = String(focusVal ?? "all");
    if (key === "outro") return { cls: "done", icon: "✓" };
    if (/^\d+$/.test(key)) {
      const k = Number(key);
      if (index < k) return { cls: "done", icon: "✓" };
      if (index === k) return { cls: "on", icon: String(index + 1) };
      return { cls: "todo", icon: String(index + 1) };
    }
    return { cls: "", icon: String(index + 1) };
  }

  function highlightAccentPhrase(headline, accentPhrase) {
    const text = String(headline || "");
    const phrase = String(accentPhrase || "").trim();
    if (!phrase) return xmlEsc(text);
    const pos = text.indexOf(phrase);
    if (pos < 0) return xmlEsc(text);
    const cls = phrase.length <= 5 ? ' class="pt-em-nowrap"' : "";
    return xmlEsc(text.slice(0, pos)) + `<em${cls}>${xmlEsc(phrase)}</em>` + xmlEsc(text.slice(pos + phrase.length));
  }

  function isV2Regions(regions) {
    if (!regions) return false;
    if (regions.keypoints || regions.answer || regions.headline) return true;
    if (["breadcrumb", "ticker", "namecard", "question"].includes(regions.header?.variant)) return true;
    if (regions.chapters?.variant === "nav-panel") return true;
    if (regions.presenter?.variant === "avatar") return true;
    if (regions.media?.variant === "flush") return true;
    if (["card", "pill", "tab-band", "inline"].includes(regions.subtitle?.variant)) return true;
    if (regions.disclaimer?.variant === "inline-right") return true;
    return false;
  }

  function renderNavPanel(deck, chapIdx, chapProgress, isOutro, totalDuration, mapSrc, placementAttr) {
    const a = deck.pharmacist;
    const activeIdx = isOutro ? deck.chapters.length - 1 : chapIdx;
    const pct = isOutro ? 100 : Math.max(0, Math.min(1, Number(chapProgress) || 0)) * 100;
    const chapsHtml = deck.chapters.map((name, ci) => {
      const done = ci < activeIdx;
      const on = ci === activeIdx;
      const cls = done ? "pt-nav-chap done" : on ? "pt-nav-chap on" : "pt-nav-chap";
      const badge = done ? "✓" : String(ci + 1);
      const bar = on ? `<span class="pt-nav-chap-bar"><span class="pt-nav-chap-bar-fill" style="width:${pct.toFixed(2)}%"></span></span>` : "";
      return `<div class="${cls}" data-chap-index="${ci}"><b class="pt-nav-chap-num">${badge}</b><span class="pt-nav-chap-label">${xmlEsc(name || `章节 ${ci + 1}`)}</span>${bar}</div>`;
    }).join("");
    const whoSub = [a.role, a.hospital].filter(Boolean).join(" · ");
    const avatarHtml = deck.presenter === "none" ? "" : renderMiniAvatar(deck, mapSrc, 22);
    return `
      <aside class="pt-nav-panel"${placementAttr}>
        <div class="pt-nav-kick">用药问答</div>
        <div class="pt-nav-topic">${xmlEsc(deck.title)}</div>
        <div class="pt-nav-meta">${xmlEsc(formatDurationApprox(deck.chapters.length, totalDuration))}</div>
        <div class="pt-nav-chaps">${chapsHtml}</div>
        <div class="pt-nav-who">
          ${avatarHtml}
          <div class="pt-nav-who-meta">
            <strong>${xmlEsc(a.name || "药师")}</strong>
            ${whoSub ? `<span>${xmlEsc(whoSub)}</span>` : ""}
          </div>
        </div>
        ${deck.disclaimer ? `<div class="pt-nav-disc">${xmlEsc(deck.disclaimer)}</div>` : ""}
      </aside>
    `;
  }

  function renderBreadcrumbHeader(deck, chapIdx, currentTime, totalDuration, placementAttr) {
    const chapName = deck.chapters[chapIdx] || `章节 ${chapIdx + 1}`;
    const hasDur = Number(totalDuration) > 0;
    const clockHtml = hasDur
      ? `<div class="pt-clock">${formatClock(currentTime)} / ${formatClock(totalDuration)}</div>`
      : "";
    return `
      <header class="pt-header-breadcrumb"${placementAttr}>
        <div class="pt-crumb">第 ${chapIdx + 1} 章 · <b>${xmlEsc(chapName)}</b></div>
        ${clockHtml}
      </header>
    `;
  }

  function renderTickerHeader(deck, idx, placementAttr) {
    const titleText = deck.shortTitle || deck.title;
    const drug = String(deck.drug || "").trim();
    const drugTags = Array.isArray(deck.drugTags) ? deck.drugTags.filter(Boolean).slice(0, 2) : [];
    const drugPart = drug
      ? `<span class="pt-ticker-sep"></span><small class="pt-ticker-label">本期药品</small><strong class="pt-ticker-drug">${xmlEsc(drug)}</strong>${drugTags.map((t) => `<span class="pt-ticker-tag">${xmlEsc(t)}</span>`).join("")}`
      : "";
    return `
      <header class="pt-header-ticker"${placementAttr}>
        <span class="pt-ticker-pill">用药提醒</span>
        <strong class="pt-ticker-title">${xmlEsc(titleText)}</strong>
        ${drugPart}
        <span class="pt-ticker-count">第 ${idx + 1} / ${deck.slides.length} 幕</span>
      </header>
    `;
  }

  function renderNamecardHeader(deck, slide, chapIdx, isOutro, mapSrc, placementAttr) {
    const a = deck.pharmacist;
    const titleText = slide.headline || slide.name || deck.title;
    const dotsHtml = deck.chapters.map((_, ci) => `<i class="${isOutro || ci <= chapIdx ? "on" : ""}"></i>`).join("");
    return `
      <header class="pt-header-namecard"${placementAttr}>
        ${renderMiniAvatar(deck, mapSrc, 22)}
        <div class="pt-nc-id">
          <div class="pt-nc-id-top">
            <strong>${xmlEsc(a.name || "药师")}</strong>
            ${a.role ? `<span class="pt-nc-badge">${xmlEsc(a.role)}</span>` : ""}
          </div>
          ${a.hospital ? `<div class="pt-nc-hosp">${xmlEsc(a.hospital)}</div>` : ""}
        </div>
        <span class="pt-nc-sep"></span>
        <div class="pt-nc-title">${xmlEsc(titleText)}</div>
        <div class="pt-nc-dots">${dotsHtml}</div>
      </header>
    `;
  }

  function renderQuestionHeader(deck, slide, idx, placementAttr) {
    let qCount = 0;
    for (let i = 0; i <= idx; i += 1) {
      if (String(deck.slides[i]?.question || "").trim()) qCount += 1;
    }
    const qNum = String(Math.max(1, qCount)).padStart(2, "0");
    const qText = String(slide.question || "").trim() || slide.headline || slide.name || deck.title;
    return `
      <header class="pt-header-question"${placementAttr}>
        <div class="pt-ask-q">问</div>
        <div class="pt-ask-bubble">
          <span class="pt-ask-pill">问题 ${qNum}</span>
          <span class="pt-ask-text">${xmlEsc(qText)}</span>
          <small class="pt-ask-from">来自患者提问</small>
        </div>
      </header>
    `;
  }

  function renderPresenterAvatar(layout, region, deck, mapSrc, placementAttr) {
    const pxW = region.w * layout.canvas.w / 100;
    const smClass = pxW < 90 ? " is-sm" : "";
    const inner = deck.presenter === "none"
      ? renderEmblemSvg(pxW < 90 ? 26 : 38)
      : `<div class="pt-avatar-inner"><img src="${xmlEsc(mapSrc(TemplateVideo.resolveAvatarSrc(deck)))}" alt="" /></div>`;
    return `<div class="pt-presenter-avatar${smClass}"${placementAttr}>${inner}</div>`;
  }

  function renderKeypoints(slide, focusVal, placementAttr) {
    const rawList = Array.isArray(slide.points) && slide.points.length
      ? slide.points
      : (Array.isArray(slide.items) ? slide.items : []);
    const items = rawList.map((pt) => (typeof pt === "string" ? pt : (pt?.title || ""))).map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
    const takeaway = String(slide.takeaway || slide.footerNote || "").trim();
    const quoteHtml = takeaway
      ? `<div class="pt-kp-quote"><small>记住这一句</small><span class="pt-kp-quote-text">${xmlEsc(takeaway)}</span></div>`
      : "";
    if (!items.length && takeaway) {
      return `<aside class="pt-keypoints"${placementAttr}>${quoteHtml}</aside>`;
    }
    if (!items.length) {
      const fbTitle = slide.headline || slide.name || "核心要点";
      const fbLead = String(slide.lead || "").trim();
      return `
        <aside class="pt-keypoints"${placementAttr}>
          <div class="pt-kp-card">
            <h5>本节要点</h5>
            <div class="pt-kp-fallback-title">${xmlEsc(fbTitle)}</div>
            ${fbLead ? `<p class="pt-kp-fallback-lead">${xmlEsc(fbLead)}</p>` : ""}
          </div>
        </aside>
      `;
    }
    const denseCls = items.length >= 4 ? " is-dense" : "";
    const rows = items.map((text, i) => {
      const st = keypointItemState(i, focusVal);
      return `<div class="pt-kp-item${st.cls ? " " + st.cls : ""}" data-kp-index="${i}"><i>${st.icon}</i><span>${xmlEsc(text)}</span></div>`;
    }).join("");
    return `
      <aside class="pt-keypoints"${placementAttr}>
        <div class="pt-kp-card">
          <h5>本节要点</h5>
          <div class="pt-kp-items${denseCls}">${rows}</div>
        </div>
        ${quoteHtml}
      </aside>
    `;
  }

  function renderAnswerBubble(deck, slide, placementAttr) {
    const a = deck.pharmacist;
    const meta = [a.name || "药师", a.role, a.hospital].filter(Boolean).join(" · ");
    const rawAns = String(slide.answer || "").trim().slice(0, 16);
    let verdictHtml = "";
    if (rawAns) {
      const tone = ["ok", "no", "warn"].includes(slide.verdictTone) ? slide.verdictTone : "ok";
      const hasMark = /^[✓✗!✔✘]/.test(rawAns);
      const prefix = hasMark ? "" : ({ ok: "✓ ", no: "✗ ", warn: "! " }[tone]);
      verdictHtml = `<span class="pt-answer-verdict is-${tone}">${xmlEsc(prefix + rawAns)}</span>`;
    }
    return `
      <div class="pt-answer-bubble"${placementAttr}>
        <div class="pt-answer-head">
          <strong>药师回答</strong>
          <span class="pt-answer-meta">${xmlEsc(meta)}</span>
          ${verdictHtml}
        </div>
      </div>
    `;
  }

  function renderHeadlinePoster(deck, slide, chapIdx, mapSrc, placementAttr) {
    const a = deck.pharmacist;
    const chapName = deck.chapters[chapIdx] || `章节 ${chapIdx + 1}`;
    const headlineText = slide.headline || slide.name || deck.title;
    const titleHtml = highlightAccentPhrase(headlineText, slide.accentPhrase);
    const leadText = String(slide.lead || "").trim();
    const whoSub = [a.role, a.hospital].filter(Boolean).join(" · ");
    const avatarHtml = deck.presenter === "none" ? "" : renderMiniAvatar(deck, mapSrc, 20);
    return `
      <aside class="pt-headline-poster"${placementAttr}>
        <div class="pt-poster-kicker">第 ${chapIdx + 1} 章 · ${xmlEsc(chapName)}</div>
        <div class="pt-poster-head">
          <h3 class="pt-poster-h3">${titleHtml}</h3>
          ${leadText ? `<p class="pt-poster-lead">${xmlEsc(leadText)}</p>` : ""}
        </div>
        <div class="pt-poster-who">
          ${avatarHtml}
          <span class="pt-poster-who-text"><strong>${xmlEsc(a.name || "药师")}</strong>${xmlEsc(whoSub)}</span>
        </div>
      </aside>
    `;
  }

  function renderSubtitleFooter(deck, regions, subtitleRaw, subtitleHtml, placementAttr) {
    const variant = regions?.subtitle?.variant || "band";
    if (!["card", "pill", "tab-band", "inline"].includes(variant)) {
      return `
        <footer class="pt-footer"${placementAttr}>
          ${subtitleRaw ? `<div class="pt-subtitle">${subtitleHtml}</div>` : ""}
        </footer>
      `;
    }
    if (variant === "tab-band") {
      const a = deck.pharmacist;
      const meta = [a.role, a.hospital].filter(Boolean).join(" · ");
      return `
        <footer class="pt-footer pt-sub-custom pt-sub-tab-band"${placementAttr}>
          <div class="pt-sub-tab-name">${xmlEsc(a.name || "药师")}${meta ? ` <em>${xmlEsc(meta)}</em>` : ""}</div>
          <div class="pt-sub-tab-body"><div class="pt-subtitle${subtitleRaw ? "" : " is-empty"}">${subtitleHtml}</div></div>
        </footer>
      `;
    }
    return `
      <footer class="pt-footer pt-sub-custom pt-sub-${variant}"${placementAttr}>
        <div class="pt-subtitle${subtitleRaw ? "" : " is-empty"}">${subtitleHtml}</div>
      </footer>
    `;
  }

  function fitPosterHeadline(container) {
    const h3 = container.querySelector(".pt-poster-h3");
    if (!h3) return;
    const sizes = [84, 76, 70, 64];
    h3.classList.remove("is-clamped");
    for (const size of sizes) {
      h3.style.fontSize = size + "px";
      const maxH = Math.ceil(size * 1.24 * 2 + 16);
      if (h3.scrollHeight <= maxH && h3.scrollWidth <= h3.clientWidth + 1) return;
    }
    h3.classList.add("is-clamped");
  }

  function render(layout, rawDeck, slideIndex, options) {
    const { normalizeDeck, getSlideCues, stripTrailingSubtitlePunctuation, highlightText, computeDeckProgress } = TemplateVideo;
    const opts = options || {};
    const deck = normalizeDeck(rawDeck);
    const idx = Math.max(0, Math.min(deck.slides.length - 1, Number(slideIndex) || 0));
    const slide = deck.slides[idx];
    const chapIdx = Math.max(0, Math.min(deck.chapters.length - 1, Number(slide.chapterIndex) || 0));
    const focusKey = opts.focus !== undefined
      ? String(opts.focus || "all")
      : (slide.layoutMode === "hook" && !slide.contentImage ? "answer" : "all");
    const cueFocus = opts.cueFocus !== undefined ? String(opts.cueFocus || "all") : focusKey;
    const isOutro = focusKey === "outro";
    const chaptersHtml = deck.chapters.map((name, ci) => {
      let cls = "pt-chap";
      if (isOutro) cls += ci === deck.chapters.length - 1 ? " active" : " done";
      else if (ci === chapIdx) cls += " active";
      else if (ci < chapIdx) cls += " done";
      return `<span class="${cls}">${xmlEsc(name || `章节${ci + 1}`)}</span>`;
    }).join("");

    const cues = getSlideCues(slide, 22);
    const subtitleRaw = stripTrailingSubtitlePunctuation(
      opts.subtitleText !== undefined
        ? opts.subtitleText
        : (cues[0] ? cues[0].text : slide.line || ""),
    );
    const hlWords = Array.isArray(opts.highlightWords) && opts.highlightWords.length
      ? opts.highlightWords
      : (slide.highlightWords || []);
    const subtitleHtml = highlightText(subtitleRaw, hlWords, "pt-sub-hl");

    const mapSrc = (src) => (opts.imgMap && src && opts.imgMap.get(src)) ? opts.imgMap.get(src) : (src || "");
    const hasOutroImage = isOutro && Boolean(slide.outroImage);
    const effectiveLayout = isOutro
      ? (hasOutroImage ? "explain" : "outro")
      : (slide.layoutMode === "hook" && !slide.contentImage)
        ? "hook"
        : (slide.layoutMode === "focus" ? "focus" : "explain");
    const ringProgress = opts.progress !== undefined
      ? Math.max(0, Math.min(1, Number(opts.progress) || 0))
      : computeDeckProgress(deck, idx, opts.cueIndex ?? 0);

    const regions = regionsFor(layout, opts.stage || effectiveLayout);
    const media = regions?.media;
    const attach = (name) => placement(layout, regions?.[name]);
    const isV2 = isV2Regions(regions);
    const legacyStage = regions
      ? (media?.variant === "hook" || media?.variant === "outro" ? media.variant : "explain")
      : effectiveLayout;
    const presenterVariant = regions?.presenter?.variant || "column-card";
    const mediaClasses = ["pt-media-slot", "media-slot"];
    if (media?.variant === "flush") mediaClasses.push("pt-media-flush");
    if (regions?.answer) mediaClasses.push("pt-media-in-answer");
    const slotDesc = describeMediaSlot(layout, opts.stage || effectiveLayout);
    const nonClassicMedia = isV2 || slotDesc.w !== 960 || slotDesc.h !== 540;
    if (nonClassicMedia && slotDesc.sizeClasses.length) {
      mediaClasses.push(...slotDesc.sizeClasses);
    }
    const mediaAttrs = nonClassicMedia
      ? ` data-media-w="${slotDesc.w}" data-media-h="${slotDesc.h}"`
      : "";

    let bodyHtml;
    let bodyPlacement = "";
    if (legacyStage === "outro" || legacyStage === "hook") {
      bodyHtml = legacyStage === "outro"
        ? renderOutroStage(deck, slide, mapSrc, ringProgress)
        : renderHookStage(deck, slide, mapSrc, focusKey, ringProgress);
      bodyPlacement = attach("media");
    } else {
      const mediaHtml = opts.renderMedia ? opts.renderMedia(slide)
        : Contents.image.html(slide, { mapSrc, focus: focusKey, hasOutroImage });
      if (regions) bodyPlacement = ' style="position:absolute;inset:0;height:auto;padding:0"';
      const inlinePresenter = (!regions || (regions.presenter && presenterVariant !== "avatar"))
        ? renderLeftBlock(deck, mapSrc, ringProgress, attach("presenter"), !regions?.disclaimer)
        : "";
      bodyHtml = `
        ${inlinePresenter}
        <section class="${mediaClasses.join(" ")}"${mediaAttrs}${attach("media")}>
          ${mediaHtml}
          ${opts.contentTitle ? `<h2 class="stage-media-title">${xmlEsc(opts.contentTitle)}</h2>` : ""}
        </section>
      `;
    }

    const headerTitle = deck.shortTitle || deck.title;
    let headerHtml = "";
    if (regions ? Boolean(regions.header) : effectiveLayout !== "hook") {
      const hVariant = regions?.header?.variant || "pill-title+chapter-rail";
      if (hVariant === "breadcrumb") {
        headerHtml = renderBreadcrumbHeader(deck, chapIdx, opts.currentTime, opts.totalDuration, attach("header"));
      } else if (hVariant === "ticker") {
        headerHtml = renderTickerHeader(deck, idx, attach("header"));
      } else if (hVariant === "namecard") {
        headerHtml = renderNamecardHeader(deck, slide, chapIdx, isOutro || cueFocus === "outro", mapSrc, attach("header"));
      } else if (hVariant === "question") {
        headerHtml = renderQuestionHeader(deck, slide, idx, attach("header"));
      } else {
        headerHtml = `
        <header class="pt-header"${attach("header")}>
          <div class="pt-title-pill">
            <span class="pt-title-dot"></span>
            <span>${xmlEsc(headerTitle)}</span>
          </div>
          ${regions?.chapters ? "" : `<div class="pt-chapters">${chaptersHtml}</div>`}
        </header>`;
      }
    }

    let chapters = "";
    if (regions?.chapters) {
      chapters = regions.chapters.variant === "nav-panel"
        ? renderNavPanel(deck, chapIdx, opts.chapterProgress ?? ringProgress, isOutro || cueFocus === "outro", opts.totalDuration, mapSrc, attach("chapters"))
        : `<div class="pt-chapters pt-region-chapters"${attach("chapters")}>${chaptersHtml}</div>`;
    }

    const avatarPresenter = regions?.presenter && presenterVariant === "avatar"
      ? renderPresenterAvatar(layout, regions.presenter, deck, mapSrc, attach("presenter"))
      : "";
    const answerHtml = regions?.answer
      ? renderAnswerBubble(deck, slide, attach("answer"))
      : "";
    const keypointsHtml = regions?.keypoints
      ? renderKeypoints(slide, cueFocus, attach("keypoints"))
      : "";
    const headlineHtml = regions?.headline
      ? renderHeadlinePoster(deck, slide, chapIdx, mapSrc, attach("headline"))
      : "";
    const disclaimer = regions?.disclaimer
      ? (regions.disclaimer.variant === "inline-right"
        ? `<div class="pt-disclaimer-inline-right"${attach("disclaimer")}>${xmlEsc(deck.disclaimer || "")}</div>`
        : `<div class="pt-disclaimer pt-region-disclaimer"${attach("disclaimer")}>${xmlEsc(deck.disclaimer)}</div>`)
      : "";
    const progressBar = regions?.progress
      ? `<div class="pt-region-progress${regions.progress.variant === "bar" ? " pt-progress-bar" : ""}"${attach("progress")}><span style="width:${ringProgress * 100}%"></span></div>`
      : "";
    const footerHtml = renderSubtitleFooter(deck, regions, subtitleRaw, subtitleHtml, attach("subtitle"));
    const themeMeta = themeFrameMeta(deck, mapSrc);
    const v2Class = isV2 ? " pt-layout-v2" : "";

    if (!isV2) {
      return `
      <div class="pt-frame theme-${deck.theme} layout-${effectiveLayout}${themeMeta.classSuffix}"${themeMeta.styleAttr}>
        <div class="pt-glow-1"></div>
        <div class="pt-glow-2"></div>
        ${headerHtml}
        ${chapters}
        <div class="pt-body"${bodyPlacement}>
          ${bodyHtml}
        </div>
        ${disclaimer}
        ${progressBar}
        ${footerHtml}
      </div>
    `;
    }

    // Draw order: background -> answer (below media) -> media -> other components -> subtitle
    return `
      <div class="pt-frame theme-${deck.theme} layout-${effectiveLayout}${v2Class}${themeMeta.classSuffix}"${themeMeta.styleAttr}>
        <div class="pt-glow-1"></div>
        <div class="pt-glow-2"></div>
        ${answerHtml}
        <div class="pt-body"${bodyPlacement}>
          ${bodyHtml}
        </div>
        ${headerHtml}
        ${chapters}
        ${avatarPresenter}
        ${keypointsHtml}
        ${headlineHtml}
        ${disclaimer}
        ${progressBar}
        ${footerHtml}
      </div>
    `;
  }

  function update(container, state) {
    const s = state || {};
    if (s.subtitle !== undefined) {
      const subtitle = container.querySelector(".pt-subtitle");
      if (subtitle) {
        const clean = TemplateVideo.stripTrailingSubtitlePunctuation(s.subtitle);
        subtitle.innerHTML = TemplateVideo.highlightText(clean, s.highlightWords || [], "pt-sub-hl");
        if (subtitle.closest(".pt-footer.pt-sub-custom")) {
          subtitle.classList.toggle("is-empty", !clean);
        }
      }
    }
    if (s.progress !== undefined) {
      const ring = container.querySelector(".pt-avatar-progress circle");
      const bar = container.querySelector(".pt-region-progress span");
      const progress = Math.max(0, Math.min(1, s.progress));
      if (ring) {
        const circumference = 2 * Math.PI * Number(ring.getAttribute("r"));
        ring.setAttribute("opacity", progress > 0.002 ? "1" : "0");
        ring.setAttribute("stroke-linecap", "round");
        ring.setAttribute("stroke-dasharray", `${(circumference * progress).toFixed(2)} ${(circumference + 10).toFixed(2)}`);
        ring.setAttribute("transform", "rotate(-90 50 50)");
      }
      if (bar) bar.style.width = `${progress * 100}%`;
    }
    if (s.chapterProgress !== undefined) {
      const fill = container.querySelector(".pt-nav-chap-bar-fill");
      if (fill) {
        const p = Math.max(0, Math.min(1, Number(s.chapterProgress) || 0));
        fill.style.width = `${(p * 100).toFixed(2)}%`;
      }
    }
    if (s.currentTime !== undefined && Number(s.totalDuration) > 0) {
      const clock = container.querySelector(".pt-clock");
      if (clock) clock.textContent = `${formatClock(s.currentTime)} / ${formatClock(s.totalDuration)}`;
    }
    if (s.keypointsFocus !== undefined) {
      const items = container.querySelectorAll(".pt-kp-item[data-kp-index]");
      items.forEach((el) => {
        const idx = Number(el.dataset.kpIndex);
        const st = keypointItemState(idx, s.keypointsFocus);
        el.classList.remove("done", "on", "todo");
        if (st.cls) el.classList.add(st.cls);
        const badge = el.querySelector("i");
        if (badge) badge.textContent = st.icon;
      });
    }
    fitPosterHeadline(container);
    const avatars = [...container.querySelectorAll(".pt-avatar-inner img")];
    if (s.avatarFrame) {
      for (const avatar of avatars) {
        if (avatar.getAttribute("src") !== s.avatarFrame) avatar.src = s.avatarFrame;
      }
    }
    const pending = avatars.filter((img) => !img.complete).map((img) => img.decode());
    if (pending.length) return Promise.all(pending);
  }

  global.LayoutEngine = {
    render, update, mediaSize, describeMediaSlot, imagePixelSize, formatRatioLabel,
    renderAvatarProgress, isDarkTheme, safeThemeVars, safeColor, fitPosterHeadline,
  };
})(globalThis);
