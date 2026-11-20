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
    const region = regionsFor(layout, stage).media;
    return { w: region.w * layout.canvas.w / 100, h: region.h * layout.canvas.h / 100 };
  }

  function placement(layout, region) {
    if (!region) return "";
    const px = (value, axis) => (value * axis / 100).toFixed(6) + "px";
    const { w, h } = layout.canvas;
    return ` style="position:absolute;left:${px(region.x, w)};top:${px(region.y, h)};width:${px(region.w, w)};height:${px(region.h, h)}"`;
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
    const legacyStage = regions ? media.variant : effectiveLayout;
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
      bodyHtml = `
        ${!regions || regions.presenter
          ? renderLeftBlock(deck, mapSrc, ringProgress, attach("presenter"), !regions?.disclaimer) : ""}
        <section class="pt-media-slot media-slot"${attach("media")}>
          ${mediaHtml}
          ${opts.contentTitle ? `<h2 class="stage-media-title">${xmlEsc(opts.contentTitle)}</h2>` : ""}
        </section>
      `;
    }

    const headerTitle = deck.shortTitle || deck.title;
    const headerHtml = (regions ? !regions.header : effectiveLayout === "hook")
      ? ""
      : `
        <header class="pt-header"${attach("header")}>
          <div class="pt-title-pill">
            <span class="pt-title-dot"></span>
            <span>${xmlEsc(headerTitle)}</span>
          </div>
          ${regions?.chapters ? "" : `<div class="pt-chapters">${chaptersHtml}</div>`}
        </header>`;
    const chapters = regions?.chapters ? `<div class="pt-chapters pt-region-chapters"${attach("chapters")}>${chaptersHtml}</div>` : "";
    const disclaimer = regions?.disclaimer
      ? `<div class="pt-disclaimer pt-region-disclaimer"${attach("disclaimer")}>${xmlEsc(deck.disclaimer)}</div>` : "";
    const progressBar = regions?.progress
      ? `<div class="pt-region-progress"${attach("progress")}><span style="width:${ringProgress * 100}%"></span></div>` : "";
    const themeMeta = themeFrameMeta(deck, mapSrc);
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
        <footer class="pt-footer"${attach("subtitle")}>
          ${subtitleRaw ? `<div class="pt-subtitle">${subtitleHtml}</div>` : ""}
        </footer>
      </div>
    `;
  }

  function update(container, state) {
    if (state.subtitle !== undefined) {
      const subtitle = container.querySelector(".pt-subtitle");
      if (subtitle) {
        subtitle.innerHTML = TemplateVideo.highlightText(
          TemplateVideo.stripTrailingSubtitlePunctuation(state.subtitle),
          state.highlightWords || [],
          "pt-sub-hl",
        );
      }
    }
    if (state.progress !== undefined) {
      const ring = container.querySelector(".pt-avatar-progress circle");
      const bar = container.querySelector(".pt-region-progress span");
      const progress = Math.max(0, Math.min(1, state.progress));
      if (ring) {
        const circumference = 2 * Math.PI * Number(ring.getAttribute("r"));
        ring.setAttribute("opacity", progress > 0.002 ? "1" : "0");
        ring.setAttribute("stroke-linecap", "round");
        ring.setAttribute("stroke-dasharray", `${(circumference * progress).toFixed(2)} ${(circumference + 10).toFixed(2)}`);
        ring.setAttribute("transform", "rotate(-90 50 50)");
      }
      if (bar) bar.style.width = `${progress * 100}%`;
    }
    const avatar = container.querySelector(".pt-avatar-inner img");
    if (avatar && state.avatarFrame && avatar.getAttribute("src") !== state.avatarFrame) avatar.src = state.avatarFrame;
    if (avatar && !avatar.complete) return avatar.decode();
  }

  global.LayoutEngine = { render, update, mediaSize, renderAvatarProgress, isDarkTheme, safeThemeVars, safeColor };
})(globalThis);
