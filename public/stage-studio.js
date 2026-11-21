"use strict";

/* Shared work data and editor for the infographic video modes. */
const StageStudio = (() => {
  const CLASSIC = "builtin:layout/info-classic";
  const IMAGE_PLACEHOLDER = "/assets/stage-image-placeholder.png";
  const kinds = {image: "AI 完整图", svg: "SVG 动画", scene: "代码动效场景", clip: "AI 视频", card: "旧版信息图", asset: "旧版素材", mg: "旧版 MG"};
  const kindLabel = c => c?.kind === "clip" ? (c.clipStyle === "mg" ? "AI MG 动画" : "AI 演示视频") : (kinds[c?.kind] || "");
  const layoutLoads = new Map();
  const themeLoads = new Map();
  const selected = new WeakMap();
  const inspector = new WeakMap();
  const mgPanels = new WeakMap();
  const pendingAutoPlay = new WeakMap();
  const batchQueues = new WeakMap();
  const reviewFilter = new WeakMap();
  let reviewAudio = null;
  let reviewPlayingWork = null;
  let reviewPlayingIndex = null;
  const STAGE_MODULES = [
    { id: "visual",    group: "shot",   label: "画面", title: "本幕画面",   icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/>' },
    { id: "points",    group: "shot",   label: "要点", title: "本幕要点",   icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>' },
    { id: "template",  group: "global", label: "模板", title: "模板与主题", icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { id: "presenter", group: "global", label: "主讲", title: "主讲人",     icon: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>' },
    { id: "music",     group: "global", label: "音乐", title: "背景音乐",   icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
    { id: "meta",      group: "global", label: "信息", title: "作品信息",   icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>' },
  ];
  const normalizeModule = id => id === "scene" ? "visual" : id === "global" ? "template"
    : (STAGE_MODULES.some(m => m.id === id) ? id : "visual");
  const moduleIcon = paths => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const PLAY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none"/></svg>';
  const PAUSE_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></svg>';
  const HIGHLIGHT_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" stroke="none"/></svg>';
  const REVIEW_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>';
  const STUDIO_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const currentView = w => w?.stagePlan?.editorView === "review" ? "review" : "studio";
  const shotReadyState = s => s?.content?.kind === "image" ? (s.content.image ? "ok" : "pending")
    : s?.content?.kind === "clip" ? (s.content.clip ? "ok" : "pending")
    : s?.content?.kind === "svg" ? (s.content.svgCode ? "ok" : "pending")
    : s?.content?.kind === "scene" ? (s.content.code ? "ok" : "pending")
    : ["asset", "mg"].includes(s?.content?.kind) ? (s.content.assetId ? "ok" : "pending")
    : "ok";
  const shotNeedsRegen = s => shotReadyState(s) === "ok" && Boolean(s?.presentationStale);

  function stopReviewAudio() {
    if (reviewAudio) {
      try { reviewAudio.pause(); } catch {}
      reviewAudio.src = "";
      reviewAudio = null;
    }
    const prevIdx = reviewPlayingIndex;
    reviewPlayingWork = null;
    reviewPlayingIndex = null;
    if (prevIdx !== null) {
      const btnEl = app?.querySelector?.(`[data-action="stage-review-speech"][data-val="${prevIdx}"]`);
      if (btnEl) {
        btnEl.classList.remove("is-playing");
        const cached = btnEl.classList.contains("is-cached");
        btnEl.innerHTML = `${PLAY_ICON}<span>试听口播</span>${cached ? '<em class="stage-speech-tag">已缓存</em>' : ""}`;
      }
    }
  }

  function playReviewSpeech(w, index) {
    const shot = w?.stagePlan?.shots?.[index];
    const cached = shot?.speech;
    if (!cached?.url || cached.line !== shot.line.trim() || cached.voice !== w.settings.voice) return false;
    if (reviewPlayingWork === w && reviewPlayingIndex === index && reviewAudio && !reviewAudio.paused) {
      stopReviewAudio();
      return true;
    }
    stopReviewAudio();
    const audio = new Audio(cached.url);
    reviewAudio = audio;
    reviewPlayingWork = w;
    reviewPlayingIndex = index;
    const syncBtn = playing => {
      const btnEl = app?.querySelector?.(`[data-action="stage-review-speech"][data-val="${index}"]`);
      if (!btnEl) return;
      btnEl.classList.toggle("is-playing", playing);
      btnEl.classList.add("is-cached");
      btnEl.innerHTML = playing
        ? `${PAUSE_ICON}<span>停止试听</span>`
        : `${PLAY_ICON}<span>试听口播</span><em class="stage-speech-tag">已缓存</em>`;
    };
    syncBtn(true);
    audio.addEventListener("ended", () => {
      if (reviewAudio === audio) stopReviewAudio();
    });
    audio.addEventListener("error", () => {
      if (reviewAudio === audio) stopReviewAudio();
    });
    audio.play().catch(() => {
      if (reviewAudio === audio) stopReviewAudio();
    });
    return true;
  }

  function usesDynamicAvatar(w) {
    const presenter = w.templatePresenter || "digital";
    const avatarMode = w.videoMode === "svg" ? "static"
      : w.videoMode === "code-motion" ? codeMotionAvatarMode(w) : resolveAvatarMode(w.settings.avatarMode);
    return w.settings.voice !== "无配音" && presenter !== "none" && avatarMode !== "static";
  }

  function collectBatchPlan(w, { includeStale = false } = {}) {
    const shots = w?.stagePlan?.shots || [];
    const image = [];
    const svg = [];
    const scene = [];
    const missingClips = [];
    const missingAssets = [];
    let staleCount = 0;
    let readyCount = 0;
    shots.forEach((s, i) => {
      const ready = shotReadyState(s) === "ok";
      const stale = ready && Boolean(s.presentationStale);
      if (ready) readyCount++;
      if (stale) staleCount++;
      const need = !ready || (includeStale && stale);
      const kind = s.content.kind;
      if (kind === "image" && need) image.push(i);
      else if (kind === "svg" && need) svg.push(i);
      else if (kind === "scene" && need) scene.push(i);
      else if (kind === "clip" && !ready) missingClips.push(i);
      else if (["asset", "mg"].includes(kind) && !ready) missingAssets.push(i);
    });
    return {
      image,
      svg,
      scene,
      missingClips,
      missingAssets,
      staleCount,
      readyCount,
      totalShots: shots.length,
      totalBatchShots: image.length + svg.length + scene.length,
    };
  }

  function canAutoCompose(w, plan) {
    return Boolean(
      config?.codeMotionReady &&
      !usesDynamicAvatar(w) &&
      plan.missingClips.length === 0 &&
      plan.missingAssets.length === 0,
    );
  }

  function clearBatchQueue(w) {
    if (w) batchQueues.delete(w);
  }

  function formatJobProgress(w, job, rawText) {
    const queue = w ? batchQueues.get(w) : null;
    const base = rawText || "";
    if (!queue || queue.totalSteps <= 1) return base;
    const stepNo = Math.min(queue.doneSteps + 1, queue.totalSteps);
    return `步骤 ${stepNo}/${queue.totalSteps} · ${base}`;
  }
  let narrationCleanup = null;
  const pointVisual = () => config.stageCatalog.pointVisuals;
  const copy = value => structuredClone(value);
  const fixedKinds = ["image", "svg", "scene"];
  const draftModes = [["image", "AI 完整图（推荐）"], ...fixedKinds.slice(1).map(kind => [kind, kinds[kind]])];
  const clipEstimate = (model, resolution, seconds, dims, includeFrame, w) => {
    const rate = config.videoRates?.[model]?.[resolution];
    const [dw, dh] = dims || [1280, 720];
    const videoYuan = rate ? (Number(seconds) * dw * dh * 24 / 1024) * Number(rate) / 1_000_000 : null;
    const frameRate = includeFrame ? Number(config.imageRates?.[w.settings.imageModel]?.[w.settings.imageSize] || 0) : 0;
    return { videoYuan, frameYuan: frameRate, totalYuan: videoYuan !== null ? videoYuan + frameRate : null };
  };
  const clipDimensions = (resolution, slot) => {
    const short = parseInt(String(resolution || "720p"), 10) || 720;
    const ar = slot?.w && slot?.h ? Math.max(0.5, Math.min(2.2, slot.w / slot.h)) : 16 / 9;
    return ar >= 1
      ? [Math.round(short * ar / 2) * 2, Math.round(short / 2) * 2]
      : [Math.round(short / 2) * 2, Math.round(short / ar / 2) * 2];
  };

  function applies(w) {
    return Boolean(config?.stageRender && w?.type === "video" && ["template", "code-motion", "svg"].includes(w.videoMode));
  }

  function hasLegacyImageJobs(w) {
    return w.blocks.some(block => block.job) || Boolean(w.templateDeck?.slides?.some(slide => slide.job || slide.outroJob));
  }

  function isActive(w) {
    return Boolean(applies(w) && w.stagePlan && !hasLegacyImageJobs(w));
  }

  function cueWeight(rawChunk) {
    let weight = 0;
    for (const ch of String(rawChunk || "")) {
      if (!ch.trim()) continue;
      weight += "。！？；，、,.!?;…".includes(ch) ? 0.35 : 1;
    }
    return Math.max(1, weight);
  }

  function formatLineByCues(shot) {
    const raw = String(shot?.line || "");
    if (!raw || raw.includes("\n")) return raw;
    const cues = Array.isArray(shot?.cues) ? shot.cues.filter(c => String(c?.text || "").trim()) : [];
    if (cues.length <= 1) return raw;
    let pos = 0;
    const lines = [];
    for (const cue of cues) {
      const piece = String(cue.text || "").trim();
      const idx = raw.indexOf(piece, pos);
      if (idx === -1) return cues.map(c => String(c.text || "").trim()).filter(Boolean).join("\n");
      let end = idx + piece.length;
      while (end < raw.length && /[。！？；，、,.!?;…\u2026”’」』》）】\s]/.test(raw[end])) end++;
      const segment = raw.slice(pos, end).trim();
      if (segment) lines.push(segment);
      pos = end;
    }
    const tail = raw.slice(pos).trim();
    if (tail) {
      if (lines.length) lines[lines.length - 1] += tail;
      else lines.push(tail);
    }
    return lines.length ? lines.join("\n") : raw;
  }

  function authoredCues(line, words = [], prevCues = []) {
    const raw = String(line || "");
    const prevList = Array.isArray(prevCues) ? prevCues : [];
    let rawCues;
    if (raw.includes("\n")) {
      const rows = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 24);
      rawCues = [];
      for (const row of rows) {
        const display = typeof TemplateVideo.stripTrailingSubtitlePunctuation === "function"
          ? TemplateVideo.stripTrailingSubtitlePunctuation(row)
          : row.replace(/[。！？；，、,.!?;…\s]+$/g, "").trim();
        if (!display) continue;
        rawCues.push({ text: display.slice(0, 240), weight: cueWeight(row) });
      }
    } else {
      rawCues = TemplateVideo.splitSubtitleChunks(raw, 22).slice(0, 24);
    }
    const sameCount = prevList.length === rawCues.length;
    const anyCustom = prevList.some(c => c?.highlightCustom);
    const prevWordPool = [...new Set(prevList.flatMap(c => Array.isArray(c?.highlightWords) ? c.highlightWords : []).filter(Boolean))];
    return rawCues.map((cue, idx) => {
      const prev = prevList[idx];
      const focus = prev?.focus || "all";
      if (sameCount && prev) {
        if (prev.highlightCustom) {
          const kept = (Array.isArray(prev.highlightWords) ? prev.highlightWords : []).filter(w => w && cue.text.includes(w));
          return { ...cue, focus, highlightWords: kept, highlightCustom: true };
        }
        return { ...cue, focus, highlightWords: prev.highlightWords?.length ? prev.highlightWords : words };
      }
      const matched = prevWordPool.filter(w => cue.text.includes(w));
      if (anyCustom) {
        return { ...cue, focus, highlightWords: matched, highlightCustom: true };
      }
      return { ...cue, focus, highlightWords: matched.length ? matched : words };
    });
  }

  function effectiveCueHighlightWords(shot, cue) {
    if (!cue) return [];
    if (cue.highlightCustom) {
      return Array.isArray(cue.highlightWords)
        ? cue.highlightWords.map(w => String(w || "").trim()).filter(Boolean)
        : [];
    }
    if (Array.isArray(cue.highlightWords) && cue.highlightWords.length) {
      return cue.highlightWords.map(w => String(w || "").trim()).filter(Boolean);
    }
    const kind = shot?.content?.kind;
    if (kind === "svg") {
      const beats = shot.content?.beats || [];
      return [...new Set([
        ...beats.flatMap(b => [b.label, ...(window.StageSvgContent?.keywords?.[b.action] || [])]),
        shot.name,
      ])].map(w => String(w || "").trim()).filter(Boolean).slice(0, 4);
    }
    const fallback = Array.isArray(shot?.points?.highlightWords)
      ? shot.points.highlightWords.map(w => String(w || "").trim()).filter(Boolean)
      : [];
    if (fallback.length) return fallback;
    if ((kind === "card" || kind === "scene") && !Array.isArray(shot?.points?.highlightWords)) {
      return (shot?.points?.items || []).map(it => String(it?.title || "").trim()).filter(Boolean);
    }
    return [];
  }

  function matchHighlightSpans(text, words) {
    const raw = String(text || "");
    const list = [...new Set((Array.isArray(words) ? words : [words])
      .map(w => String(w || "").trim())
      .filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    if (!raw || !list.length) return [];
    const re = new RegExp("(" + list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "g");
    const spans = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
      if (!m[0].length) break;
      spans.push([m.index, m.index + m[0].length]);
    }
    return spans;
  }

  function mapNarrationToCues(lineText, cues) {
    const raw = String(lineText || "");
    const list = Array.isArray(cues) ? cues : [];
    if (!raw || !list.length) return [];
    if (!raw.includes("\n") && list.length > 1) {
      let pos = 0;
      const mapped = [];
      for (let i = 0; i < list.length; i++) {
        const text = String(list[i]?.text || "");
        if (!text) continue;
        const idx = raw.indexOf(text, pos);
        if (idx === -1) break;
        mapped.push({ cueIndex: i, cue: list[i], start: idx, end: idx + text.length, displayOffset: idx });
        pos = idx + text.length;
      }
      if (mapped.length === list.length) return mapped;
    }
    const mapped = [];
    let offset = 0;
    let cueIdx = 0;
    const lines = raw.split("\n");
    for (const rawLine of lines) {
      const lineNoCr = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const trimmed = lineNoCr.trim();
      const display = typeof TemplateVideo.stripTrailingSubtitlePunctuation === "function"
        ? TemplateVideo.stripTrailingSubtitlePunctuation(trimmed)
        : trimmed.replace(/[。！？；，、,.!?;…\s]+$/g, "").trim();
      if (trimmed && display && cueIdx < list.length) {
        const cue = list[cueIdx];
        const cueText = String(cue?.text || "");
        const leadSpaces = lineNoCr.length - lineNoCr.trimStart().length;
        const innerIdx = cueText ? lineNoCr.indexOf(cueText) : leadSpaces;
        const displayOffset = offset + (innerIdx >= 0 ? innerIdx : leadSpaces);
        mapped.push({
          cueIndex: cueIdx,
          cue,
          start: offset,
          end: offset + lineNoCr.length,
          displayOffset,
        });
        cueIdx++;
      }
      offset += rawLine.length + 1;
    }
    return mapped;
  }

  function inspectNarrationSelection(shot, lineText, rawStart, rawEnd) {
    const raw = String(lineText || "");
    let s = Math.max(0, Math.min(raw.length, Number(rawStart) || 0));
    let e = Math.max(0, Math.min(raw.length, Number(rawEnd) || 0));
    if (s >= e) return null;
    while (s < e && /\s/.test(raw[s])) s++;
    while (e > s && /\s/.test(raw[e - 1])) e--;
    if (s >= e) return null;
    if (raw.slice(s, e).includes("\n")) return { invalid: "multiline" };
    const outerPunct = /[。！？；，、,.!?;…\u2026\s]/;
    while (s < e && outerPunct.test(raw[s])) s++;
    while (e > s && outerPunct.test(raw[e - 1])) e--;
    if (s >= e) return null;
    const mapped = mapNarrationToCues(raw, shot?.cues);
    const seg = mapped.find(item => s >= item.start && e <= item.end)
      || mapped.find(item => s >= item.displayOffset && e <= item.displayOffset + String(item.cue?.text || "").length);
    if (!seg) return { invalid: "multiline" };
    const cueText = String(seg.cue?.text || "");
    const relStart = Math.max(0, s - seg.displayOffset);
    const relEnd = Math.min(cueText.length, e - seg.displayOffset);
    if (relStart >= relEnd) return null;
    const phrase = cueText.slice(relStart, relEnd).trim();
    if (!phrase || phrase.length > 60) return null;
    const activeWords = [...new Set(effectiveCueHighlightWords(shot, seg.cue).filter(word => cueText.includes(word)))];
    const spans = matchHighlightSpans(cueText, activeWords);
    let covered = true;
    for (let i = relStart; i < relEnd; i++) {
      if (!spans.some(([a, b]) => i >= a && i < b)) { covered = false; break; }
    }
    return {
      cueIndex: seg.cueIndex,
      cue: seg.cue,
      phrase,
      selStart: s,
      selEnd: e,
      relStart,
      relEnd,
      isHighlighted: covered,
      activeWords,
    };
  }

  function applyCueHighlightToggle(shot, sel) {
    if (!sel || sel.invalid || !sel.cue) return false;
    const cue = sel.cue;
    const cueText = String(cue.text || "");
    const words = sel.activeWords;
    let nextWords;
    if (sel.isHighlighted && words.includes(sel.phrase)) {
      nextWords = words.filter(word => word !== sel.phrase);
    } else {
      const mask = new Uint8Array(cueText.length);
      for (const [a, b] of matchHighlightSpans(cueText, words)) {
        for (let i = a; i < b; i++) mask[i] = 1;
      }
      const fill = sel.isHighlighted ? 0 : 1;
      for (let i = sel.relStart; i < sel.relEnd; i++) mask[i] = fill;
      const runs = [];
      let i = 0;
      while (i < mask.length) {
        if (!mask[i]) { i++; continue; }
        let j = i + 1;
        while (j < mask.length && mask[j]) j++;
        const token = cueText.slice(i, j).trim();
        if (token && !runs.includes(token)) runs.push(token);
        i = j;
      }
      nextWords = runs.slice(0, 24);
    }
    cue.highlightWords = nextWords;
    cue.highlightCustom = true;
    return true;
  }

  function renderNarrationBackdropHtml(shot, lineText, selStart = -1, selEnd = -1) {
    const raw = String(lineText || "");
    if (!raw) return "";
    const mask = new Uint8Array(raw.length);
    for (const seg of mapNarrationToCues(raw, shot?.cues)) {
      const cueText = String(seg.cue?.text || "");
      const words = effectiveCueHighlightWords(shot, seg.cue);
      for (const [a, b] of matchHighlightSpans(cueText, words)) {
        const from = seg.displayOffset + a;
        const to = Math.min(raw.length, seg.displayOffset + b);
        for (let i = from; i < to; i++) mask[i] = 1;
      }
    }
    const hasSel = selStart >= 0 && selEnd > selStart && selEnd <= raw.length;
    const out = [];
    let i = 0;
    while (i < raw.length) {
      const hl = mask[i] === 1;
      const sl = hasSel && i >= selStart && i < selEnd;
      let j = i + 1;
      while (j < raw.length && (mask[j] === 1) === hl && (hasSel && j >= selStart && j < selEnd) === sl) j++;
      const chunk = esc(raw.slice(i, j));
      if (hl && sl) out.push(`<mark class="stage-narration-hl" data-hl-sel>${chunk}</mark>`);
      else if (hl) out.push(`<mark class="stage-narration-hl">${chunk}</mark>`);
      else if (sl) out.push(`<span data-hl-sel>${chunk}</span>`);
      else out.push(chunk);
      i = j;
    }
    if (raw.endsWith("\n")) out.push("\u200b");
    return out.join("");
  }

  function renderHighlightChipsHtml(shot) {
    const cues = Array.isArray(shot?.cues) ? shot.cues : [];
    const items = [];
    cues.forEach((cue, cueIndex) => {
      const cueText = String(cue?.text || "");
      const seen = new Set();
      for (const word of effectiveCueHighlightWords(shot, cue)) {
        if (!word || seen.has(word) || !cueText.includes(word)) continue;
        seen.add(word);
        items.push({ cueIndex, word });
      }
    });
    const chipsHtml = items.length
      ? items.map(({ cueIndex, word }) =>
          `<span class="stage-hl-chip">` +
          `<button type="button" class="stage-hl-chip-jump" data-action="stage-hl-jump" data-val="${cueIndex}" title="预览第 ${cueIndex + 1} 句字幕">${esc(word)}</button>` +
          `<button type="button" class="stage-hl-chip-del" data-action="stage-hl-remove" data-val="${cueIndex}:${encodeURIComponent(word)}" aria-label="取消高亮 ${esc(word)}" title="取消高亮">×</button>` +
          `</span>`
        ).join("") + `<button type="button" class="stage-hl-clear" data-action="stage-hl-clear">清空</button>`
      : `<span class="stage-hl-empty">选中上方口播文字，即可标注为字幕高亮重点词</span>`;
    return `<span class="stage-hl-label">${HIGHLIGHT_ICON}<span>字幕高亮</span></span><div class="stage-hl-chips">${chipsHtml}</div>`;
  }

  function syncNarrationBackdrop(shot, selStart = -1, selEnd = -1) {
    const ta = $("#stage-line-input");
    const backdrop = $("#stage-line-backdrop");
    if (ta && backdrop) {
      backdrop.innerHTML = renderNarrationBackdropHtml(shot, ta.value, selStart, selEnd);
      backdrop.style.width = `${ta.clientWidth}px`;
      backdrop.style.height = `${ta.clientHeight}px`;
      backdrop.scrollTop = ta.scrollTop;
      backdrop.scrollLeft = ta.scrollLeft;
    }
  }

  function syncNarrationHighlights(shot, selStart = -1, selEnd = -1) {
    syncNarrationBackdrop(shot, selStart, selEnd);
    const chips = $("#stage-narration-highlights");
    if (chips) chips.innerHTML = renderHighlightChipsHtml(shot);
  }

  function initialContent(kind, shot, clipStyle = "demo") {
    if (kind === "scene") {
      const visual = pointVisual()[shot.points.type];
      return { kind, codePrompt: "", visual, ...config.stageCatalog.sceneDefaults[visual] };
    }
    if (kind === "svg") return { kind, beats: [{action:config.stageCatalog.svgDefault, label:shot.name.slice(0, 10) || "用药要点", line:shot.line.slice(0, 55) || "请核对用药信息"}] };
    if (kind === "card") return { kind, motionStyle: "auto" };
    if (kind === "clip") return { kind, clipStyle, clipPrompt: "", clipFirstFrame: "", clip: "", clipPoster: "", overlay: "points", clipSpeed: "normal" };
    if (kind === "asset") return { kind, move: "still" };
    if (kind === "mg") return {kind,fit:"auto",overlay:"points"};
    return { kind, image: "", imagePrompt: "" };
  }

  function oldKind(w) {
    if (w.videoMode === "svg") return "svg";
    if (w.videoMode === "code-motion") return "scene";
    return w.templateContent === "code-motion" ? "card" : "image";
  }

  function pointsFrom(raw, kind) {
    const type = kind === "scene" ? Object.keys(pointVisual()).find(type => pointVisual()[type] === raw.visual) : raw.type;
    const items = raw.items || raw.points || raw.steps || raw.checks || raw.columns || raw.warnings || [];
    return {
      type: type || "explain", headline: raw.headline || raw.name, lead: raw.lead || "", accentPhrase: raw.accentPhrase || "",
      question: raw.question || "", answer: raw.answer || "",
      verdictTone: ["ok", "no", "warn"].includes(raw.verdictTone) ? raw.verdictTone : "",
      items: items.map(item => typeof item === "string" ? {title: item, detail:"", tag:""}
        : {title: item.title || item.label || item.head || "", detail: item.detail || item.desc || "", tag: item.tag || ""}),
      takeaway: raw.takeaway || raw.footerNote || "", highlightWords: raw.highlightWords || raw.labels || [],
      ...(raw.layoutMode ? { layoutMode: raw.layoutMode } : {}),
      ...Object.fromEntries(["points", "columns", "steps", "warnings", "checks", "pills", "footerNote", "outroNote", "listTitle"]
        .filter(key => raw[key] !== undefined).map(key => [key, copy(raw[key])])),
    };
  }

  function fromLegacy(raw, kind, i) {
    const name = raw.name || raw.headline || `第 ${i + 1} 幕`;
    const line = raw.line || "";
    const points = pointsFrom(raw, kind);
    const cues = raw.type ? TemplateVideo.getSlideCues(raw, 22) : authoredCues(line, points.highlightWords);
    const shot = {name, line, points, seconds: Math.max(kind === "svg" ? 2 : 4, Number(raw.seconds) || 5),
      chapterIndex: Math.max(0, Math.min(4, Number(raw.chapterIndex) || 0)), cues: copy(cues), variants: {}};
    const image = raw.contentImage || raw.image || "";
    if (kind === "image" || kind === "card" || image) {
      shot.variants.image = {kind:"image", image, imagePrompt: raw.imagePrompt || raw.prompt || "", focusRegions:raw.focusRegions || {}, outroImage:raw.outroImage || ""};
    }
    if (kind === "svg") {
      shot.variants.svg = {kind, action:raw.action || "leaflet",
        beats: raw.beats?.length ? copy(raw.beats) : [{action:raw.action || "leaflet", line:line.slice(0, 55), label:name.slice(0, 10)}],
        ...(raw.beats?.length ? {} : {singleAction: true})};
      if (raw.svgSpeech) shot.speech = copy(raw.svgSpeech);
    }
    if (kind === "scene") {
      shot.variants.scene = {kind, visual:raw.visual, motion:raw.motion, motif:raw.motif, tone:raw.tone, libraryArtId:raw.libraryArtId};
      shot.beats = copy(raw.beats || []);
      if (raw.sfxId) { shot.sfxId = raw.sfxId; shot.sfxName = raw.sfxName; }
    }
    if (kind === "card") shot.variants.card = {kind, motionStyle:raw.motionStyle || "auto"};
    shot.content = shot.variants[kind] || initialContent(kind, shot);
    return shot;
  }

  function migrateLegacyAssetShots(plan) {
    if (!plan?.shots) return;
    for (const shot of plan.shots) {
      if (shot?.content?.kind !== "asset") continue;
      const old = shot.content;
      const form = window.InfoForms ? InfoForms.mapLegacyForm({}, shot) : undefined;
      const formData = form && window.InfoForms ? InfoForms.fromPoints(form, shot) : undefined;
      shot.content = {
        kind: "card",
        motionStyle: "auto",
        ...(form ? { form, variant: "solid", formData } : {}),
        ...(old.transition ? { transition: old.transition } : {}),
        ...(old.decidedBy ? { decidedBy: old.decidedBy } : {}),
      };
      shot.variants = { ...(shot.variants || {}), card: shot.content };
    }
  }

  function normalizeWork(w) {
    if (!applies(w) || w.job || hasLegacyImageJobs(w)) return w.stagePlan;
    if (w.stagePlan) {
      migrateLegacyAssetShots(w.stagePlan);
      if (!w.stagePlan.shots?.length && !fixedKinds.includes(w.stagePlan.mode)) w.stagePlan.mode = "image";
      return w.stagePlan;
    }
    const kind = oldKind(w);
    const slides = TemplateStudio.isTemplateVideo(w) && w.blocks.length
      ? TemplateStudio.buildDeckForWork(w, data) : null;
    if (kind === "scene" && w.blocks.length) normalizeCodeMotionWork(w);
    const meta = slides || w.motionMeta || {};
    w.stagePlan = {
      layout: {id: CLASSIC}, mode: w.blocks.length ? kind : "image", audio: {}, shots: (slides?.slides || w.blocks).map((shot, i) => fromLegacy(shot, kind, i)),
      ...(w.blocks.length ? {compatibility: kind} : {}),
      shortTitle: meta.shortTitle || "", chapters: meta.chapters || ["先看要点", "用药提醒"],
      disclaimer: meta.disclaimer ?? TemplateVideo.DEFAULT_DISCLAIMER,
    };
    return w.stagePlan;
  }

  function initWork(w) {
    const plan = normalizeWork(w);
    if (plan) plan.audio = { ...(plan.audio || {}), sfx: { pack: "off", stickerSfx: false } };
  }

  function syncBlocks(w) {
    w.blocks = w.stagePlan.shots.map(shot => ({ name:shot.name, line:shot.line, seconds:shot.seconds,
      image:shot.variants.image?.image || "", ...(shot.speech ? {svgSpeech:shot.speech} : {}) }));
  }

  function touch(w, structural = false) {
    if (structural) delete w.stagePlan.compatibility;
    syncBlocks(w);
    if (w.video) w.videoDirty = true;
    changed(w);
  }

  function selectKind(w, shot, kind, clipStyle) {
    const transition = shot.content.transition;
    const from = shot.content;
    const variantKey = from.kind === "clip" ? `clip:${from.clipStyle || "demo"}` : from.kind;
    shot.variants[variantKey] = from;
    const nextKey = kind === "clip" ? `clip:${clipStyle || "demo"}` : kind;
    shot.content = shot.variants[nextKey] || shot.variants[kind] || initialContent(kind, shot, clipStyle || "demo");
    shot.content.kind = kind;
    if (kind === "clip") shot.content.clipStyle = clipStyle || shot.content.clipStyle || "demo";
    if (transition !== undefined) shot.content.transition = transition;
    shot.variants[nextKey] = shot.content;
  }

  function getLayout(layoutId) {
    if (!layoutLoads.has(layoutId)) {
      const pending = jsonRequest(StudioAssets.url(layoutId)).catch(error => {
        layoutLoads.delete(layoutId);
        throw error;
      });
      layoutLoads.set(layoutId, pending);
    }
    return layoutLoads.get(layoutId);
  }

  function getTheme(themeId) {
    if (!themeLoads.has(themeId)) {
      const pending = jsonRequest(StudioAssets.url(themeId)).catch(error => {
        themeLoads.delete(themeId);
        throw error;
      });
      themeLoads.set(themeId, pending);
    }
    return themeLoads.get(themeId);
  }

  const layoutResolved = new Map();
  const activeLayouts = () => (config.stageLayouts || []).filter(item => item.aspect === "16:9");
  const activeThemes = () => config.stageThemes || [];
  const defaultThemeId = w => w.templateTheme === "warm" ? "builtin:theme/warm" : "builtin:theme/medical";
  const themeIdFor = w => w.stagePlan?.themeId || defaultThemeId(w);
  const currentThemeDef = w => activeThemes().find(item => item.id === themeIdFor(w)) || null;
  const currentLayoutDef = w => {
    const id = w.stagePlan?.layout?.id || CLASSIC;
    return activeLayouts().find(item => item.id === id) || layoutResolved.get(id) || null;
  };
  async function resolveWorkLayout(w) {
    const cached = currentLayoutDef(w);
    if (cached?.regions) return cached;
    const id = w.stagePlan?.layout?.id || CLASSIC;
    try {
      const loaded = await getLayout(id);
      layoutResolved.set(id, loaded);
      return loaded;
    } catch {
      return cached;
    }
  }
  function mediaRatioMismatched(savedSize, currentSlot) {
    if (!savedSize?.w || !savedSize?.h || !currentSlot?.w || !currentSlot?.h) return false;
    const savedAr = savedSize.w / savedSize.h;
    const slotAr = currentSlot.w / currentSlot.h;
    return Math.abs(savedAr - slotAr) / slotAr > 0.12;
  }
  const themeName = w => {
    const id = themeIdFor(w);
    return activeThemes().find(item => item.id === id)?.name
      || TemplateVideo.THEMES.find(item => item.id === (w.templateTheme || "medical"))?.name
      || "医疗白蓝风";
  };
  const allowsMode = (layout, mode) => !layout?.supports || layout.supports.includes(mode);

  function layoutControls(w) {
    const id = w.stagePlan.layout.id;
    const choices = activeLayouts();
    return '<div class="formrow"><span class="label">布局模板</span><div class="stage-layout-grid">' + choices.map(item =>
      `<button type="button" class="mode-card" data-action="stage-layout" data-val="${esc(item.id)}" aria-pressed="${id === item.id}">
      ${StudioAssets.layoutDiagram(item)}<strong>${esc(item.name)}</strong></button>`).join("") +
      '<button type="button" class="mode-card stage-layout-manage" data-action="stage-manage-layouts">管理布局</button>' +
      (choices.some(item => item.id === id) ? "" : '<span class="small">当前作品保留已下架布局</span>') + '</div></div>';
  }

  function themeControls(w) {
    const id = themeIdFor(w);
    const choices = activeThemes();
    if (!choices.length) return "";
    return '<div class="formrow"><span class="label">视觉主题</span><div class="stage-theme-grid">' + choices.map(item =>
      `<button type="button" class="mode-card stage-theme-card" data-action="stage-theme" data-val="${esc(item.id)}" aria-pressed="${id === item.id}">
      ${StudioAssets.themeSwatch(item)}<strong>${esc(item.name)}</strong></button>`).join("") +
      '<button type="button" class="mode-card stage-theme-manage" data-action="stage-manage-themes">管理主题</button>' +
      (w.stagePlan.themeId && !choices.some(item => item.id === id) ? '<span class="small">当前作品保留已下架主题</span>' : "") + '</div></div>';
  }

  function samplePlan(layout, theme, kind, stage = "explain") {
    const title = "漏服了，也只吃一次";
    const line = "间隔还不到一半，想起来就补上，千万不要吃双倍。";
    const points = [
      {title:"先判断离下次服药还有多久", detail:"看是否超过服药间隔的一半"},
      {title:"没过半时想起来就补一次", detail:"按常规剂量补服，次日照常吃"},
      {title:"已经过半就跳过这一次", detail:"等到下次服药时间再按常规吃"},
      {title:"千万不要一次吃双倍剂量", detail:"避免血药浓度骤升引发低血压"},
    ];
    const slide = {
      name:"漏服如何处理", headline:title, accentPhrase:"也只吃一次",
      lead:"不论补服还是到点服药，每次都只吃平时的常规剂量。",
      line, type:"steps", layoutMode:stage, chapterIndex:1,
      question:"昨天忘吃降压药，今天吃两片补回来，行吗？",
      answer:"不行，只吃常规剂量", verdictTone:"no",
      takeaway:"一次只吃常规量，漏服绝不加倍补",
      highlightWords:["想起来就补上","吃双倍"],
      points:points.map(({title,detail}) => ({title,desc:detail})),
      steps:points.slice(0,3).map(({title,detail}) => ({title,desc:detail})),
    };
    const shot = {
      ...slide, kind, items:points, start:0, end:4,
      captions:[{start:0,end:4,text:"间隔还不到一半，想起来就补上",focus:stage === "outro" ? "outro" : "1",highlightWords:["想起来就补上"]}],
    };
    if (kind === "image") slide.contentImage = "/assets/template-info-tablet.jpg";
    if (kind === "scene") Object.assign(shot,{visual:"steps",motion:"flow",motif:"checklist",tone:"primary"});
    if (kind === "svg") {
      shot.beats = [{action:"leaflet",line,label:"看说明书"}];
      Object.assign(slide,{action:"leaflet",svgBeats:shot.beats});
    }
    if (kind === "asset") Object.assign(shot,{assetUrl:StudioAssets.url("builtin:svg/reading-list"),move:"zoom"});
    if (kind === "mg") Object.assign(shot,{motionAssetUrl:StudioAssets.motionUrl("builtin:lottie/capsule"),fit:"auto",overlay:"points"});
    const themeDeck = theme && typeof theme === "object"
      ? {
          theme: theme.base === "warm" ? "warm" : "medical",
          ...(theme.id ? { themeId: theme.id } : {}),
          themeVars: theme.vars,
          themeGlass: Boolean(theme.glass),
          ...(theme.fadeColor ? { themeFadeColor: theme.fadeColor } : {}),
          ...(theme.background?.assetId
            ? { themeBackground: theme.background.url || StudioAssets.url(theme.background.assetId) }
            : {}),
        }
      : { theme: theme === "warm" ? "warm" : "medical" };
    return {
      layout, previewStage:stage,
      deck:{
        title:"降压药忘吃了，要不要补？", shortTitle:"降压药漏服怎么补？",
        drug:"硝苯地平缓释片", drugTags:["缓释片","处方药"],
        ...themeDeck, presenter:"digital",
        pharmacist:{...TemplateStudio.ensurePharmacist(data)},
        chapters:["先判断时间","补还是不补","千万别加倍","何时问药师"],
        slides:[slide],
      },
      shots:[shot],
    };
  }

  function modeControls(w) {
    const p = w.stagePlan;
    const layout = activeLayouts().find(item => item.id === p.layout.id);
    const displayMode = fixedKinds.includes(p.mode) ? p.mode : (p.shots.length ? "" : "image");
    return '<div class="formrow"><span class="label">制作方式</span><div class="chips">' +
      draftModes.map(([kind,label]) => btn(label, "stage-mode", "chip" + (displayMode === kind ? " selected" : ""), kind,
        `aria-pressed="${displayMode === kind}" ${allowsMode(layout,kind) ? "" : "disabled"}`)).join("") + '</div></div>';
  }

  function setupControls(w) {
    return layoutControls(w) + themeControls(w) + modeControls(w);
  }

  function submitDraft(w, draft = {}, stageDraft = "stage", shotIndex) {
    if (w.job) return;
    const isFreshScript = stageDraft === "stage" && draft.script === undefined && !draft.produceShot && !draft.clipPrompt;
    let promptMeta = null;
    if (isFreshScript && typeof resolveVideoScriptPromptForSubmit === "function") {
      if (typeof validateVideoScriptPrompt === "function" && !validateVideoScriptPrompt(w)) return;
      promptMeta = resolveVideoScriptPromptForSubmit(w);
    }
    const job = createJob(w, "write-draft", [], {...w.settings, ratio:"16:9", duration:videoReferenceSeconds(w), textModel:resolveTextModel(w.settings)});
    job.stageDraft = stageDraft;
    if (shotIndex !== undefined) job.stageShotIndex = shotIndex;
    const presentation = fixedKinds.includes(w.stagePlan.mode) ? w.stagePlan.mode : "image";
    const effectivePresentation = draft.presentation || presentation;
    const usesArrange = effectivePresentation === "mix" || effectivePresentation === "svg" || effectivePresentation === "mg";
    const arrangeMeta = usesArrange && !draft.produceShot && !draft.produceSvgBatch && !draft.produceSceneBatch && !draft.planStickers && !draft.clipPrompt && typeof resolveExtraPromptForSubmit === "function"
      ? resolveExtraPromptForSubmit(w, "stage-arrange")
      : null;
    job.payload.draft = {type:"video", videoMode:"stage", presentation, layoutId:w.stagePlan.layout.id,
      workId:w.id,
      topic:w.topic.trim(), drug:w.drug,
      ...(promptMeta?.customPrompt ? { scriptPrompt: promptMeta.customPrompt } : {}),
      ...(arrangeMeta?.customPrompt ? { arrangePrompt: arrangeMeta.customPrompt } : {}),
      ...draft};
    if (promptMeta && typeof recordScriptPromptUse === "function") {
      recordScriptPromptUse(w, promptMeta);
    }
    if (arrangeMeta && typeof recordExtraPromptUse === "function") {
      recordExtraPromptUse(w, arrangeMeta);
    }
    w.job = job;
    return sendJob(w);
  }

  function requestDraft(w) {
    if (typeof validateVideoScriptPrompt === "function" && !validateVideoScriptPrompt(w)) return;
    const detail = "生成全片口播脚本、屏显要点与各幕画面构想。";
    const image = "仅生成文字蓝图（暂不产生出图/动画费用），生成后将先进入「总览审稿」页，方便一页核对修改后再统一生成全部画面。";
    return authorize(w, 1, "draft", () => submitDraft(w), 1, {detail, image});
  }

  function showShotIssue(w, index, message, focus) {
    selected.set(w, index);
    if (currentView(w) === "review" && (focus?.includes('="line"') || focus?.includes('="name"'))) {
      const reviewField = focus.includes('="name"') ? `review-name:${index}` : `review-line:${index}`;
      let target = $(`[data-stage-field="${reviewField}"]`);
      if (!target && getReviewFilter(w) !== "all") {
        reviewFilter.set(w, index);
        render(true);
        target = $(`[data-stage-field="${reviewField}"]`);
      }
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.focus();
        notify(message, "warn");
        return;
      }
    }
    if (currentView(w) === "review") {
      w.stagePlan.editorView = "studio";
    }
    if (focus?.includes('="name"')) inspector.set(w, "points");
    else if (!focus?.includes('="line"')) inspector.set(w, "visual");
    render(true);
    $(`.stage-rail [data-action="stage-select"][data-val="${index}"]`)?.scrollIntoView({block:"nearest",inline:"nearest"});
    $(focus)?.focus();
    notify(message, "warn");
  }

  function checkShotText(w, indices) {
    for (const index of indices) {
      const {name, line} = w.stagePlan.shots[index];
      if (name.trim() && line.trim()) continue;
      const missing = !name.trim() && !line.trim() ? "标题和口播" : name.trim() ? "口播" : "标题";
      const label = name.trim() ? `第 ${index + 1} 幕「${name.trim()}」` : `第 ${index + 1} 幕`;
      showShotIssue(w, index, `${label}缺少${missing}，请补齐。`,
        `[data-stage-field="${name.trim() ? "line" : "name"}"]`);
      return false;
    }
    return true;
  }

  function shotScript({name, line, seconds, chapterIndex, points, cues}) {
    return {name, line, seconds, chapterIndex, points, cues};
  }

  function produceShot(w, shot, index) {
    if (!config.stageShotProduction || w.job || !checkShotText(w, [index])) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    const kind = shot.content.kind;
    if (kind === "image" || kind === "clip") return;
    const isPromptSvg = kind === "svg";
    const isCodeScene = kind === "scene";
    const isPromptDriven = isPromptSvg || isCodeScene;
    const options = config.stageCatalog.presenters[kind].options;
    const previousParams = isPromptSvg
      ? (shot.content.svgCode ? { svgCode: shot.content.svgCode } : {})
      : isCodeScene
        ? (shot.content.code ? { code: shot.content.code } : {})
        : Object.fromEntries(Object.keys(options).filter(key => shot.content[key] !== undefined)
            .map(key => [key, shot.content[key]]));
    const title = productionTitle(shot.content);
    const revisionCount = (shot.content._revCount || 0) + 1;
    if (typeof syncExtraSystemPrompt === "function") syncExtraSystemPrompt(w, "stage-produce");
    const prodState = typeof getExtraPromptState === "function" ? getExtraPromptState(w, "stage-produce") : null;
    retryPayload = () => {
      const promptInput = $("#stage-produce-prompt", dialogBody);
      let producePromptMeta = null;
      if (promptInput && typeof resolveExtraPromptForSubmit === "function") {
        if (typeof validateExtraPrompt === "function" && !validateExtraPrompt(w, "stage-produce")) return;
        producePromptMeta = resolveExtraPromptForSubmit(w, "stage-produce");
      }
      const shotPrompt = isPromptSvg
        ? renderSvgPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w))
        : isCodeScene
          ? renderCodePromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w))
          : "";
      const res = submitDraft(w, {
        presentation:kind,
        produceShot:{
          shot:shotScript(shot),
          previousParams,
          revisionCount,
          revision: $("#stage-production-revision", dialogBody)?.value.trim() || "",
          ...(isPromptDriven ? {
            prompt: shotPrompt,
            ...(isPromptSvg && shot.content.customSvgPrompt?.trim() ? { customSvgPrompt: shot.content.customSvgPrompt.trim() } : {}),
            ...(isCodeScene && shot.content.customCodePrompt?.trim() ? { customCodePrompt: shot.content.customCodePrompt.trim() } : {}),
          } : {}),
        },
        ...(producePromptMeta?.customPrompt ? { produceShotPrompt: producePromptMeta.customPrompt } : {}),
      }, "produce", index);
      if (producePromptMeta && typeof recordExtraPromptUse === "function") {
        recordExtraPromptUse(w, producePromptMeta);
      }
      return res;
    };
    const promptLabel = isPromptSvg ? "SVG 动画提示词" : isCodeScene ? "代码动画提示词" : "调试单幕制作系统提示词（高级）";
    const promptBoxHtml = prodState
      ? isPromptDriven
        ? `<div class="stage-prompt-card">
            <div class="stage-prompt-head">
              <label class="label" for="stage-produce-prompt">${promptLabel}</label>
              <span id="stage-produce-prompt-badge" class="prompt-badge ${prodState.badgeClass}">${esc(prodState.badgeLabel)}</span>
            </div>
            <textarea id="stage-produce-prompt" data-extra-prompt="stage-produce" rows="8" maxlength="20000" aria-label="${promptLabel}">${esc(prodState.value)}</textarea>
            <div class="asset-inline" style="margin-top:6px">
              ${btn("放大对比与历史", "prompt-studio-open", "outline", "stage-produce")}
              ${btn("存为常用默认", "extra-prompt-save-default", "outline", "stage-produce", prodState.canSaveDefault ? "" : "disabled")}
              ${btn("恢复系统默认", "extra-prompt-reset", "textbtn", "stage-produce", prodState.canResetSystem ? "" : "disabled")}
            </div>
          </div>`
        : `<details class="shot-options stage-full-prompt-box"><summary>${promptLabel}<span id="stage-produce-prompt-badge" class="prompt-badge ${prodState.badgeClass}">${esc(prodState.badgeLabel)}</span></summary>
            <textarea id="stage-produce-prompt" data-extra-prompt="stage-produce" rows="7" maxlength="20000" aria-label="单幕画面制作系统提示词">${esc(prodState.value)}</textarea>
            <div class="asset-inline" style="margin-top:6px">
              ${btn("放大对比与历史", "prompt-studio-open", "outline", "stage-produce")}
              ${btn("存为常用默认", "extra-prompt-save-default", "outline", "stage-produce", prodState.canSaveDefault ? "" : "disabled")}
              ${btn("恢复系统默认", "extra-prompt-reset", "textbtn", "stage-produce", prodState.canResetSystem ? "" : "disabled")}
            </div>
          </details>`
      : "";
    const descHtml = isPromptSvg
      ? `<p>用 DeepSeek 按第 ${index + 1} 幕的本幕提示词、口播和要点，直接生成纯矢量 SVG 动画（不含插图）。可直接在下方提示词上修改。</p>`
      : isCodeScene
        ? `<p>用 DeepSeek 按第 ${index + 1} 幕的本幕提示词、口播和要点，生成纯代码动效（不含插图）。可直接在下方提示词上修改。</p>`
        : `<p>用 DeepSeek 按第 ${index + 1} 幕的口播和要点，用「${kinds[kind]}」设计新画面。保留口播、要点和其他幕。</p>`;
    const revisionFieldHtml = isPromptDriven
      ? ""
      : `<label class="field">画面要求（选填）<textarea id="stage-production-revision" maxlength="200" rows="3" placeholder="想先展示哪个要点，或想演示哪个动作？"></textarea></label>`;
    openModal(title, `${descHtml}
      ${revisionFieldHtml}
      ${promptBoxHtml}
      <p class="small">提交 1 次文本请求，按 Token 计费。</p>
      <div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认提交并计费","confirm-paid","primary")}</div>`, "confirm");
  }

  function preparePromptBatch(w, kind) {
    if (!config.stageShotProduction || w.job) return;
    const isSvg = kind === "svg";
    const indices = isSvg ? missingSvgCodes(w) : missingSceneCodes(w);
    if (!indices.length) return;
    if (!checkShotText(w, indices)) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    const label = isSvg ? "SVG 动画" : "代码动画";
    const prodState = typeof getExtraPromptState === "function" ? getExtraPromptState(w, "stage-produce") : null;
    retryPayload = () => {
      const producePromptMeta = typeof resolveExtraPromptForSubmit === "function"
        ? resolveExtraPromptForSubmit(w, "stage-produce") : null;
      const layout = currentLayoutDef(w);
      const themeDef = currentThemeDef(w);
      const batch = indices.map(idx => {
        const s = w.stagePlan.shots[idx];
        const prompt = isSvg
          ? renderSvgPromptForShot(w, s, layout, themeDef)
          : renderCodePromptForShot(w, s, layout, themeDef);
        return {
          index: idx,
          shot: shotScript(s),
          prompt,
          ...(isSvg && s.content.customSvgPrompt?.trim() ? { customSvgPrompt: s.content.customSvgPrompt.trim() } : {}),
          ...(!isSvg && s.content.customCodePrompt?.trim() ? { customCodePrompt: s.content.customCodePrompt.trim() } : {}),
        };
      });
      return submitDraft(w, {
        presentation: kind,
        ...(isSvg ? { produceSvgBatch: batch } : { produceSceneBatch: batch }),
        ...(producePromptMeta?.customPrompt ? { produceShotPrompt: producePromptMeta.customPrompt } : {}),
      }, isSvg ? "svg-batch" : "scene-batch");
    };
    openModal(`生成缺失${label}（${indices.length} 幕）`,
      `<p>将依次调用 DeepSeek，按每幕的提示词、口播和要点生成${isSvg ? "纯矢量 SVG 动画" : "纯代码动效（HTML + CSS + 内联 SVG + JS）"}，不含插图。</p>` +
      `<p class="small">共提交 ${indices.length} 次文本请求，按实际 Token 计费${prodState?.isCustom ? "（已应用自定义系统提示词）" : ""}。</p>` +
      `<div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认生成并计费","confirm-paid","primary")}</div>`, "confirm");
  }

  function requestClipPrompt(w, shot, index) {
    if (w.job || !checkShotText(w, [index])) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    const clipStyle = shot.content.clipStyle || "demo";
    retryPayload = () => submitDraft(w, {
      clipPrompt: { shot: shotScript(shot), clipStyle },
    }, "clip-prompt", index);
    openModal("AI 写视频描述",
      `<p>用 DeepSeek 按第 ${index + 1} 幕的口播和要点，撰写适合「${clipStyle === "mg" ? "AI MG 动画" : "AI 演示视频"}」的画面动作描述（不含文字、品牌和医生形象）。提交 1 次文本请求，按 Token 计费。</p>` +
      '<div class="actions dialog-actions">' + btn("取消","close","secondary") +
      btn("确认提交并计费","confirm-paid","primary") + '</div>', "confirm");
  }

  function usePlan(shot, content) {
    const saved = shot.content.kind === content.kind ? shot.content : shot.variants[content.kind] || {};
    const fields = content.kind === "scene"
      ? ["codePrompt", "customCodePrompt", "visual", "motion", "motif", "tone"]
      : content.kind === "svg"
        ? ["customSvgPrompt", "beats", "action"]
        : ["image","outroImage","focusRegions"];
    if (content.kind === "mg" && content.mgRequest && !content.assetId) fields.push("assetId","assetName","fit","overlay");
    const preserved = Object.fromEntries(fields
      .filter(field => saved[field] !== undefined && content[field] === undefined).map(field => [field,saved[field]]));
    shot.variants[shot.content.kind] = shot.content;
    const transition = content.transition ?? shot.content.transition;
    shot.content = {...preserved, ...content, ...(transition ? {transition} : {})};
    shot.variants[content.kind] = shot.content;
    delete shot.presentationStale;
  }

  function installDraft(w, mode, output, job) {
    if (mode === "scene-batch" || mode === "svg-batch") {
      const isSvg = mode === "svg-batch";
      const targetKind = isSvg ? "svg" : "scene";
      const label = isSvg ? "SVG 动画" : "代码动画";
      const contents = output?.contents || {};
      const errCount = Object.keys(output?.errors || {}).length;
      let okCount = 0;
      for (const [rawIdx, content] of Object.entries(contents)) {
        const idx = Number(rawIdx);
        const shot = w.stagePlan.shots[idx];
        const hasPayload = isSvg ? Boolean(content?.svgCode?.svg) : Boolean(content?.code?.html);
        if (shot && shot.content.kind === targetKind && hasPayload) {
          content._revCount = (shot.content._revCount || 0) + 1;
          usePlan(shot, content);
          okCount++;
        }
      }
      if (okCount) touch(w, true);
      if (current() === w) {
        notify(errCount ? `已生成 ${okCount} 幕${label}，${errCount} 幕生成失败可单独重试` : `已生成 ${okCount} 幕${label}`, errCount ? "warn" : "ok");
      }
      return;
    }
    if (mode === "clip-prompt") {
      const index = job.stageShotIndex;
      const shot = w.stagePlan.shots[index];
      if (shot?.content.kind === "clip" && output.clipPrompt) {
        shot.content.clipPrompt = output.clipPrompt;
        shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
        touch(w);
        if (current() === w) notify(`第 ${index + 1} 幕视频描述已生成`, "ok");
      }
      selected.set(w, index);
      return;
    }
    if (mode === "produce") {
      const index = job.stageShotIndex;
      const shot = w.stagePlan.shots[index];
      const expected = job.payload.draft.produceShot.shot;
      if (shot?.content.kind === output.content.kind && shot.name === expected.name && shot.line === expected.line) {
        output.content._revCount = (shot.content._revCount || 0) + 1;
        usePlan(shot, output.content);
        touch(w, true);
        if (current() === w) notify(output.content.mgRequest ? `第 ${index + 1} 幕已准备 MG 草稿建议` : `第 ${index + 1} 幕画面已制作`, "ok");
      }
      selected.set(w, index);
      return;
    }
    if (output.notice) notify(output.notice, "warn");
    if (mode === "replan") {
      for (const index of output.plannedIndices) usePlan(w.stagePlan.shots[index], output.shots[index].content);
      if (output.plannedIndices.length) touch(w, true);
      return;
    }
    w.stagePlan.shots = mode === "stage" ? output.shots.map(shot => ({
      ...shot, variants:{[shot.content.kind]:shot.content},
    })) : (output.slides || output.scenes || output.shots).map((row, index) => fromLegacy(row, mode, index));
    if (fixedKinds.includes(mode)) w.stagePlan.mode = mode;
    w.stagePlan.shortTitle = output.shortTitle || "";
    w.stagePlan.chapters = output.chapters || ["先看要点", "用药提醒"];
    w.stagePlan.disclaimer = output.disclaimer ?? TemplateVideo.DEFAULT_DISCLAIMER;
    if (Array.isArray(output.drugTags)) {
      w.stagePlan.drugTags = output.drugTags.map(t => String(t || "").trim().slice(0, 6)).filter(Boolean).slice(0, 2);
    } else delete w.stagePlan.drugTags;
    delete w.stagePlan.compatibility;
    if (mode === "stage") w.stagePlan.editorView = "review";
    w.title = output.title;
    w.stage = "script";
    w.viewingSetup = false;
    w.editing = false;
    w.video = null;
    w.videoDirty = false;
    selected.set(w, 0);
    syncBlocks(w);
  }

  function deck(w, themeDef, options = {}) {
    const p = w.stagePlan;
    const themeProps = themeDef
      ? {
          theme: themeDef.base === "warm" ? "warm" : "medical",
          ...(p.themeId ? { themeId: p.themeId } : {}),
          themeVars: themeDef.vars,
          themeGlass: Boolean(themeDef.glass),
          ...(themeDef.fadeColor ? { themeFadeColor: themeDef.fadeColor } : {}),
          ...(themeDef.background?.assetId ? { themeBackground: StudioAssets.url(themeDef.background.assetId) } : {}),
        }
      : { theme: w.templateTheme || "medical" };
    const drug = String(w.drug || "").trim().slice(0, 20);
    const drugTags = Array.isArray(p.drugTags)
      ? p.drugTags.map(t => String(t || "").trim().slice(0, 6)).filter(Boolean).slice(0, 2)
      : [];
    return {title:w.title, shortTitle:p.shortTitle, chapters:p.chapters, disclaimer:p.disclaimer,
      ...(drug ? { drug } : {}), ...(drugTags.length ? { drugTags } : {}),
      ...themeProps, presenter:w.templatePresenter || "digital", pharmacist:{...TemplateStudio.ensurePharmacist(data)},
      slides:p.shots.map(shot => {
        const {points, content} = shot;
        const items = points.items.map(({title, detail}) => ({title, desc:detail}));
        return {...points, name:shot.name, line:shot.line, seconds:shot.seconds, chapterIndex:shot.chapterIndex,
          points:points.points || items, steps:points.steps || items, warnings:points.warnings || items, checks:points.checks || items,
          contentImage: content.kind === "image" ? (content.image || (options.placeholder ? IMAGE_PLACEHOLDER : "")) : "",
          outroImage:content.kind === "image" ? content.outroImage : "",
          focusRegions:content.focusRegions, motionStyle:content.motionStyle,
          ...(content.kind === "svg" ? {action:content.beats?.[0]?.action, svgBeats:content.beats || [], layoutMode:"explain"} : {}),
          ...(["card", "scene", "asset", "mg", "clip"].includes(content.kind) ? {layoutMode:"explain"} : {})};
      })};
  }

  function previewPlan(w, layout, themeDef) {
    let start = 0;
    const shots = w.stagePlan.shots.map(shot => {
      const cues = shot.cues.length ? shot.cues : authoredCues(shot.line);
      const weight = cues.reduce((sum, cue) => sum + (Number(cue.weight) || 1), 0) || 1;
      const end = start + shot.seconds;
      let cursor = start;
      const captions = cues.map(cue => {
        const start = cursor;
        cursor += shot.seconds * (Number(cue.weight) || 1) / weight;
        return {...cue, start, end:cursor};
      });
      if (captions.length) captions.at(-1).end = end;
      const content = shot.content;
      const spec = {...content, kind:content.kind, name:shot.name, line:shot.line, items:shot.points.items,
        takeaway:shot.points.takeaway, listTitle:shot.points.listTitle, labels:shot.points.highlightWords, start, end, captions,
        ...(content.kind === "card" && content.art ? {artUrl:content.art} : {}),
        ...(content.assetId ? (content.kind === "mg"
          ? {motionAssetUrl:StudioAssets.motionUrl(content.assetId)} : {assetUrl:StudioAssets.url(content.assetId)}) : {})};
      start = end;
      return spec;
    });
    return {layout, deck:deck(w, themeDef, { placeholder: true }), shots, compatibility:w.stagePlan.compatibility, fontId:w.settings.fontId};
  }

  function select(name, field, values, current) {
    return `<label class="field">${name}<select data-stage-field="${field}">${opts(values, current)}</select></label>`;
  }

  function text(name, field, value, max = 60) {
    return `<label class="field">${name}<input data-stage-field="${field}" value="${esc(value || "")}" maxlength="${max}"></label>`;
  }

  function formPickerFields(shot, slot) {
    if (!window.InfoForms) return "";
    const c = shot.content;
    const groups = InfoForms.listByRelation(slot);
    const currentForm = c.form || "";
    const optionsHtml = `<option value="">默认（传统版式）</option>` + groups.map(g =>
      `<optgroup label="${esc(g.label)}">${g.forms.map(f =>
        `<option value="${esc(f.id)}"${f.id === currentForm ? " selected" : ""}>${esc(f.label)}</option>`
      ).join("")}</optgroup>`
    ).join("");
    const quickKeys = [
      ["answer", "核心结论", 24], ["question", "患者提问", 24], ["value", "核心数值", 10],
      ["unit", "单位", 8], ["condition", "适用条件", 18], ["interval", "间隔时间", 12],
      ["myth", "常见误区", 22], ["fact", "正确做法", 22], ["motto", "口诀金句", 22],
      ["label", "说明标签", 16], ["note", "底部提醒", 28],
    ];
    const quickInputs = currentForm && c.formData
      ? quickKeys.filter(([k]) => c.formData[k] !== undefined && typeof c.formData[k] !== "object")
        .map(([k, lbl, max]) => text(lbl, "formData:" + k, String(c.formData[k]), max)).join("")
      : "";
    return `<fieldset class="svg-beat-fields stage-form-fields"><legend>信息版式</legend>` +
      `<div class="asset-inline" style="margin-top:0"><label class="field" style="flex:1">版式<select data-stage-field="form">${optionsHtml}</select></label>` +
      btn("换个版式", "stage-next-form", "outline") +
      (currentForm ? btn("按要点刷新", "stage-sync-form", "textbtn") : "") + `</div>` +
      (currentForm ? `<div class="tpl-two-col">${select("视觉变体", "variant", [["solid","柔和填充"],["outline","清晰描边"],["split","左侧色条"]], c.variant || "solid")}</div>` : "") +
      (quickInputs ? `<div class="tpl-two-col">${quickInputs}</div>` : "") +
      `</fieldset>`;
  }

  function clipFields(w, shot, slot) {
    const c = shot.content;
    const style = c.clipStyle || "demo";
    const models = Object.entries(config.videoModels || {});
    const modelId = c.clipModel && config.videoModels?.[c.clipModel] ? c.clipModel : (w.settings.videoModel || models[0]?.[0] || "doubao-seedance-2-5-flash-261115");
    const modelSpec = config.videoModels?.[modelId] || ["Seedance", ["480p", "720p"], 15];
    const resList = modelSpec[1] || ["480p", "720p"];
    const resolution = resList.includes(c.clipResolution) ? c.clipResolution : (resList.includes("720p") ? "720p" : resList[0]);
    const maxSec = modelSpec[2] || 15;
    const defaultSec = Math.max(4, Math.min(maxSec, Math.ceil(shot.seconds || 5)));
    const seconds = c.clipSeconds && c.clipSeconds >= 4 && c.clipSeconds <= maxSec ? c.clipSeconds : defaultSec;
    const dims = clipDimensions(resolution, slot);
    const est = clipEstimate(modelId, resolution, seconds, dims, !c.clipFirstFrame, w);
    const estText = est.totalYuan !== null ? `预计 ¥${est.totalYuan.toFixed(2)}（按方舟实际用量结算）` : "按方舟实际用量结算";
    const costInfo = c.clip
      ? `<p class="small">已生成视频（${esc(config.videoModels?.[c.clipModel]?.[0] || c.clipModel || "视频片段")} · ${c.clipSeconds || Math.round(c.clipDuration || shot.seconds)} 秒${c.clipCost ? ` · 实际 ¥${Number(c.clipCost).toFixed(2)}` : ""}）。</p>`
      : "";
    return `<fieldset class="svg-beat-fields stage-clip-fields"><legend>${style === "mg" ? "AI MG 动画（视频生成）" : "AI 演示视频（视频生成）"}</legend>` +
      `<label class="field">画面动作描述（不含文字、品牌与医生形象）<textarea data-stage-field="clipPrompt" maxlength="400" rows="3" placeholder="${style === "mg" ? "例如：扁平 2D 动效，柔和蓝色背景上胶囊溶解并释放微粒…" : "例如：近景柔和光线，一只手用带刻度滴管量取退烧混悬液…"}">${esc(c.clipPrompt || "")}</textarea></label>` +
      `<div class="asset-inline">${btn("AI 写视频描述", "stage-clip-prompt", "outline")}</div>` +
      `<div class="stage-clip-frame-row">` +
      (c.clipFirstFrame ? `<img class="stage-clip-thumb" src="${esc(c.clipFirstFrame)}" alt="首帧预览">` : `<span class="small">尚未设置首帧（按内容区 ${slot ? `${slot.w}×${slot.h}` : "16:9"} 生成）</span>`) +
      `<div class="asset-inline">${btn(c.clipFirstFrame ? "重新生成首帧" : "生成首帧", "stage-clip-frame", "outline")}` +
      btn(c.clipFirstFrame ? "换素材库首帧" : "从素材库选首帧", "stage-choose", "outline", "clip-frame") + `</div></div>` +
      `<div class="tpl-two-col">` +
      select("视频模型", "clipModel", models.map(([id, spec]) => [id, spec[0]]), modelId) +
      select("分辨率", "clipResolution", resList.map(r => [r, r]), resolution) +
      `<label class="field">视频秒数（4–${maxSec} 秒）<input type="number" min="4" max="${maxSec}" step="1" data-stage-field="clipSeconds" value="${seconds}"></label>` +
      select("文字叠加", "overlay", [["points","标题和要点"],["title","只显示标题"],["off","关闭"]], c.overlay || "points") +
      select("短片时长适配", "clipSpeed", [["normal","不足时定格尾帧"],["slow","轻度慢放至 0.85×"]], c.clipSpeed || "normal") +
      `</div>` +
      `<div class="asset-inline">${btn(c.clip ? "重新生成 AI 视频" : "生成 AI 视频", "stage-clip-generate", "primary")}` +
      btn("从素材库选视频", "stage-choose", "outline", "clip-video") +
      (c.clip?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn", "clip") : "") +
      (c.clip ? btn("移除视频", "stage-clear", "textbtn", "clip") : "") + `</div>` +
      `<p class="small">${estText}</p>${costInfo}</fieldset>`;
  }

  function contentFields(w, shot, slot) {
    const c = shot.content;
    const pair = list => list.map(({id,name}) => [id,name]);
    if (c.kind === "image") {
      const sizeHint = slot ? `<p class="small">当前模板内容区 ${slot.w}×${slot.h}（${esc(slot.ratioLabel)}），生成配图将自动匹配该尺寸。` +
        (c.image && mediaRatioMismatched(c.imageMediaSize, slot) ? "当前配图与现布局比例不同，建议重新生成以铺满画幅。" : "") + "</p>" : "";
      const shotIndex = Math.max(0, w.stagePlan.shots.indexOf(shot));
      const autoFull = renderImagePromptForShot(w, shotIndex, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      const hasCustom = Boolean(c.customFullImagePrompt && c.customFullImagePrompt.trim());
      const fullPromptBox = `<details class="shot-options stage-full-prompt-box"><summary>查看并编辑本幕完整生图提示词` +
        `<span id="stage-shot-image-prompt-badge" class="prompt-badge ${hasCustom ? "is-custom" : "is-default"}">${hasCustom ? "已手改" : "自动拼装"}</span></summary>` +
        `<textarea id="stage-shot-image-full-prompt" data-stage-field="customFullImagePrompt" rows="7" maxlength="3800" aria-label="本幕完整生图提示词">${esc(hasCustom ? c.customFullImagePrompt : autoFull)}</textarea>` +
        `<div class="asset-inline" style="margin-top:6px">` +
        btn("编辑全片生图模板", "prompt-studio-open", "outline", "stage-image") +
        btn("恢复自动拼装", "stage-reset-shot-prompt", "textbtn", "image", hasCustom ? "" : "disabled") +
        `</div></details>`;
      return (c.image ? '<div class="asset-inline">' +
        (c.image?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn") : "") +
        btn("移除配图", "stage-clear", "textbtn", "image") + '</div>' : "") +
        text("配图描述", "imagePrompt", c.imagePrompt, 400) + fullPromptBox + sizeHint;
    }
    if (c.kind === "clip") return clipFields(w, shot, slot);
    if (c.kind === "asset") return (c.assetId ? '<div class="asset-inline">' + btn("移除素材", "stage-clear", "textbtn", "asset") + '</div>' : "") +
      select("素材运动", "move", [["still", "静止"], ["zoom", "缓慢推近"], ["pan", "平移"]], c.move);
    if (c.kind === "mg") return (c.assetId ? '<div class="asset-inline">' + btn("移除动画","stage-clear","textbtn","mg") + '</div>' : "") +
      select("文字叠加", "overlay", [["points","标题和要点"],["title","只显示标题"],["off","关闭"]], c.overlay || "points") +
      select("时长适配", "fit", [["auto","自动适配"],["hold","原速并定格"]], c.fit || "auto");
    if (c.kind === "card") return formPickerFields(shot, slot) + (c.form ? "" : select("动效方式", "motionStyle", window.CODE_MOTION_MOTION_CHOICES, c.motionStyle));
    if (c.kind === "scene") return promptDrivenCodeFields(w, shot, slot, "scene");
    return promptDrivenCodeFields(w, shot, slot, "svg");
  }

  const productionTitle = content => content.kind === "scene"
    ? (content.code ? "重新生成代码动画" : "生成代码动画")
    : content.kind === "svg"
      ? (content.svgCode ? "重新生成 SVG 动画" : "生成 SVG 动画")
      : (content.reason || content.assetId ? "重新制作本幕" : "制作本幕");
  const artKinds = new Set();
  const missingArt = () => [];
  const missingSceneCodes = w => w.stagePlan.shots.flatMap((shot, i) =>
    shot.content.kind === "scene" && !shot.content.code ? [i] : []);
  const missingSvgCodes = w => w.stagePlan.shots.flatMap((shot, i) =>
    shot.content.kind === "svg" && !shot.content.svgCode ? [i] : []);

  function renderSvgPromptForShot(w, shot, layout, themeDef, { ignoreOverride = false } = {}) {
    if (!ignoreOverride && shot?.content?.customSvgPrompt?.trim()) {
      return shot.content.customSvgPrompt.trim().slice(0, 4000);
    }
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const theme = themeDef || currentThemeDef(w);
    const items = (shot?.points?.items || []).map(it => [it.title, it.detail].filter(Boolean).join("：")).filter(Boolean);
    const desc = shot?.content?.codePrompt?.trim();
    return [
      `内容区尺寸：${slot.w}×${slot.h}（${slot.ratioLabel}，形态 ${slot.shape}），视觉主题：${theme?.name || themeName(w)}。`,
      `本幕标题：${shot?.name || ""}`,
      shot?.line ? `本幕口播：${shot.line.trim()}` : "",
      items.length ? `本幕要点：\n${items.map((row, i) => `${i + 1}. ${row}`).join("\n")}` : "",
      shot?.points?.takeaway ? `画面结语：${shot.points.takeaway}` : "",
      w.drug ? `关联药品：${w.drug}` : "",
      desc ? `画面与动效要求：${desc}` : "画面与动效要求：用扁平医学科普纯矢量 <svg> 绘制核心主体与关键动作（含路径描边、部件位移或状态变化），按口播节拍与时间 t 逐帧演进，少而精的简短标注。",
      "硬性要求：纯矢量 SVG + JS 逐帧实现，禁止使用位图/插图/外部链接，配色继承主题 CSS 变量。",
    ].filter(Boolean).join("\n").slice(0, 4000);
  }

  function renderCodePromptForShot(w, shot, layout, themeDef, { ignoreOverride = false } = {}) {
    if (!ignoreOverride && shot?.content?.customCodePrompt?.trim()) {
      return shot.content.customCodePrompt.trim().slice(0, 4000);
    }
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const theme = themeDef || currentThemeDef(w);
    const items = (shot?.points?.items || []).map(it => [it.title, it.detail].filter(Boolean).join("：")).filter(Boolean);
    const desc = shot?.content?.codePrompt?.trim();
    return [
      `内容区尺寸：${slot.w}×${slot.h}（${slot.ratioLabel}，形态 ${slot.shape}），视觉主题：${theme?.name || themeName(w)}。`,
      `本幕标题：${shot?.name || ""}`,
      shot?.line ? `本幕口播：${shot.line.trim()}` : "",
      items.length ? `本幕要点：\n${items.map((row, i) => `${i + 1}. ${row}`).join("\n")}` : "",
      shot?.points?.takeaway ? `画面结语：${shot.points.takeaway}` : "",
      w.drug ? `关联药品：${w.drug}` : "",
      desc ? `画面与动效要求：${desc}` : "画面与动效要求：结合内联 SVG 矢量医学图示与清晰排版，按口播节拍和进度条 t 逐帧呈现重点变化。",
      "硬性要求：纯 HTML + CSS + 内联 SVG + JS 代码实现，禁止使用任何插图/图片/外部链接，配色继承主题 CSS 变量。",
    ].filter(Boolean).join("\n").slice(0, 4000);
  }

  function promptDrivenCodeFields(w, shot, slot, kind) {
    const isSvg = kind === "svg";
    const c = shot.content;
    const autoFull = isSvg
      ? renderSvgPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true })
      : renderCodePromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
    const customVal = isSvg ? c.customSvgPrompt : c.customCodePrompt;
    const hasCustom = Boolean(customVal && customVal.trim());
    const promptBox = `<div class="stage-prompt-card">` +
      `<div class="stage-prompt-head"><label class="label" for="stage-shot-prompt">本幕提示词</label>` +
      `<span id="stage-shot-prompt-badge" class="prompt-badge ${hasCustom ? "is-custom" : "is-default"}">${hasCustom ? "已手改" : "自动拼装"}</span></div>` +
      `<textarea id="stage-shot-prompt" data-stage-field="shotPrompt" rows="7" maxlength="4000" aria-label="本幕提示词">${esc(hasCustom ? customVal : autoFull)}</textarea>` +
      `<div class="asset-inline" style="margin-top:6px">` +
      btn("编辑系统提示词", "prompt-studio-open", "outline", "stage-produce") +
      btn("恢复自动拼装", "stage-reset-shot-prompt", "textbtn", "shot", hasCustom ? "" : "disabled") +
      `</div></div>`;
    const hasGenerated = isSvg ? Boolean(c.svgCode?.svg) : Boolean(c.code?.html);
    const codeEditorBox = hasGenerated
      ? isSvg
        ? `<details class="shot-options stage-code-source-box"><summary>查看并编辑生成的 SVG 代码（SVG / CSS / JS）</summary>` +
          `<label class="field">SVG 矢量代码（根节点须为 &lt;svg&gt;，禁止 img/foreignObject/script）<textarea data-stage-field="svgCode:svg" rows="5" maxlength="24000">${esc(c.svgCode.svg || "")}</textarea></label>` +
          `<label class="field">CSS（可选，自动隔离在内容区）<textarea data-stage-field="svgCode:css" rows="3" maxlength="12000">${esc(c.svgCode.css || "")}</textarea></label>` +
          `<label class="field">JS 逐帧驱动（function(root, t, duration, api) 函数体）<textarea data-stage-field="svgCode:js" rows="5" maxlength="24000">${esc(c.svgCode.js || "")}</textarea></label>` +
          `</details>`
        : `<details class="shot-options stage-code-source-box"><summary>查看并编辑生成的纯代码（HTML / CSS / JS）</summary>` +
          `<label class="field">HTML（支持内联 SVG，禁止 img/script）<textarea data-stage-field="code:html" rows="5" maxlength="24000">${esc(c.code.html || "")}</textarea></label>` +
          `<label class="field">CSS（自动隔离在内容区，可使用 --v-* 主题变量）<textarea data-stage-field="code:css" rows="4" maxlength="16000">${esc(c.code.css || "")}</textarea></label>` +
          `<label class="field">JS 逐帧驱动（function(root, t, duration, api) 函数体）<textarea data-stage-field="code:js" rows="5" maxlength="24000">${esc(c.code.js || "")}</textarea></label>` +
          `</details>`
      : "";
    const statusText = hasGenerated
      ? (isSvg
          ? `已生成纯矢量 SVG 动画（适配 ${slot ? `${slot.w}×${slot.h}` : "内容区"}，无插图，自动继承视觉主题）。`
          : `已生成纯代码动效（适配 ${slot ? `${slot.w}×${slot.h}` : "内容区"}，无插图，自动继承视觉主题）。`)
      : (isSvg
          ? `可直接修改上方本幕提示词，再点「生成 SVG 动画」，由 DeepSeek 生成纯矢量 SVG 动画（不含插图，按文本 Token 计费）。`
          : `可直接修改上方本幕提示词，再点「生成代码动画」，由 DeepSeek 生成纯 HTML + CSS + SVG + JS 动效（不含插图，按文本 Token 计费）。`);
    return promptBox + codeEditorBox + `<p class="small">${statusText}</p>`;
  }

  function artFields(w, shot, c, slot) {
    const art = slot?.art;
    const placeText = art?.placement === "top"
      ? "画面上方显示横幅插画，下方逐条显示要点。"
      : "画面左侧显示插画，右侧逐条显示要点。";
    const sizeText = art ? `插画区 ${art.w}×${art.h}（${esc(art.ratioLabel)}）。` : "";
    const mismatch = c.art && art && mediaRatioMismatched(c.artMediaSize, art)
      ? "当前插画与现布局比例不同，建议重新生成。" : "";
    const note = (c.art ? (c.artName ? `已选素材：${esc(c.artName)}。` : "已生成插画。") : "生成后，") +
      placeText + sizeText + mismatch + (c.art ? "" : "插画由火山方舟按张计费。");
    const autoArtFull = renderArtPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
    const hasCustomArt = Boolean(c.customArtPrompt && c.customArtPrompt.trim());
    const fullArtBox = `<details class="shot-options stage-full-prompt-box"><summary>查看并编辑本幕完整插画提示词` +
      `<span id="stage-shot-art-prompt-badge" class="prompt-badge ${hasCustomArt ? "is-custom" : "is-default"}">${hasCustomArt ? "已手改" : "自动拼装"}</span></summary>` +
      `<textarea id="stage-shot-art-full-prompt" data-stage-field="customArtPrompt" rows="6" maxlength="3800" aria-label="本幕完整插画提示词">${esc(hasCustomArt ? c.customArtPrompt : autoArtFull)}</textarea>` +
      `<div class="asset-inline" style="margin-top:6px">` +
      btn("编辑全片插画模板", "prompt-studio-open", "outline", "stage-art") +
      btn("恢复自动拼装", "stage-reset-shot-prompt", "textbtn", "art", hasCustomArt ? "" : "disabled") +
      `</div></details>`;
    return '<fieldset class="svg-beat-fields stage-art-fields"><legend>本幕插画</legend>' +
      `<label class="field">插画描述<textarea data-stage-field="artPrompt" maxlength="300" rows="3" placeholder="例如：妈妈用带刻度的量杯给孩子倒退烧药混悬液">${esc(c.artPrompt || "")}</textarea></label>` +
      fullArtBox +
      '<div class="asset-inline">' + btn(c.art ? "重新生成插画" : "生成本幕插画", "stage-art", c.art ? "outline" : "primary", "one") +
      btn(c.art ? "从素材库换插画" : "从素材库选插画", "stage-choose", "outline", "art-image") +
      (c.art?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn", "art") : "") +
      (c.art ? btn("移除插画", "stage-clear", "textbtn", "art-image") : "") + '</div>' +
      `<p class="small">${note}</p></fieldset>`;
  }

  function _artPromptParts(w, shot, layout, themeDef) {
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const art = slot.art;
    const theme = themeDef || currentThemeDef(w);
    const themeId = theme?.id || themeIdFor(w);
    const isDark = themeId === "builtin:theme/night" || Boolean(theme?.vars && LayoutEngine.isDarkTheme({ themeVars: theme.vars }));
    const warm = (w.templateTheme || "medical") === "warm" || themeId === "builtin:theme/illus";
    const items = (shot?.points?.items || []).map(item => item.title).filter(Boolean).join("、");
    const subject = shot?.content?.artPrompt?.trim() || (shot ? `表现「${shot.name}」：${items || (shot.line || "").slice(0, 80)}` : "");
    const orientLabel = art.orientation === "landscape" ? "横幅" : art.orientation === "portrait" ? "竖幅" : "方形";
    const placeLine = art.placement === "top"
      ? `插画放在画面上方的${orientLabel}区域（${art.w}×${art.h}，比例 ${art.ratioLabel}），文字由程序另外叠加在下方`
      : `插画放在画面左侧的${orientLabel}区域（${art.w}×${art.h}，比例 ${art.ratioLabel}），文字由程序另外叠加在右侧`;
    const styleLine = isDark
      ? "风格：深色护眼扁平矢量医学插画，深蓝灰纯色背景（#162236），柔和天蓝（#62b4ff）、薄荷绿（#5ee2a0）与暖珊瑚（#ff7d6b）点缀，线条清晰干净、对比柔和。"
      : themeId === "builtin:theme/mint"
        ? "风格：清新临床薄荷扁平矢量医学插画，淡薄荷浅绿纯色背景（#edf8f4），以青绿（#0d9488）与深墨绿（#12322d）为主色，柔和暖橙点缀，线条圆润干净。"
        : warm
          ? "风格：温暖亲切的扁平手绘医学插画，柔和暖米白纯色背景（#fdf5e7），深炭蓝细描边（#2c3e50），暖砖红（#cf5228）、柔和草绿（#5c9145）与淡琥珀色点缀，色块干净，轻微纸张质感。"
          : "风格：现代清爽的扁平矢量医学插画，极浅蓝纯色背景（#eef5fd），以医学蓝（#1466cc）和深藏青（#122d4c）为主色，少量珊瑚橙（#e6592d）点缀，柔和渐变与轻阴影，线条圆润干净。";
    const compLine = art.orientation === "landscape"
      ? `构图：严格 ${art.ratioLabel} 横幅构图，核心主体居中或微偏中舒展排布，高度占画幅 65%–75%，左右留出均匀空白；背景纯色铺满，不画边框、卡片、画框或分栏。`
      : art.orientation === "portrait"
        ? `构图：严格 ${art.ratioLabel} 竖幅构图，一个清晰主体位于画面中央，约占画面 60%–65%，上下与左右留出均匀安全空白；背景纯色铺满，不画边框、卡片、画框或分栏。`
        : `构图：严格 ${art.ratioLabel} 方形构图，一个清晰主体位于中央，约占画面 60%，四周留出均匀空白；背景纯色铺满，不画边框、卡片、画框或分栏。`;
    return {
      purposeLine: `用途：医院药师用药科普短视频的配图插画。${placeLine}，插画本身不含任何文字。`,
      subjectLine: subject ? `画面内容：${subject}` : "",
      styleLine,
      compLine,
      drugLine: w.drug ? `涉及药品：${w.drug}（通用外观，不画品牌名、商品 Logo 和价格）。` : "",
      banLine: "禁止：画面中不出现任何文字、汉字、字母、数字、标签、对话框文字、品牌名、Logo 或水印；不画医生或主讲人头像；不画红十字标志；不做信息图排版。",
    };
  }

  function defaultArtPromptTemplate(w, layout, themeDef) {
    const parts = _artPromptParts(w, null, layout, themeDef);
    return [
      parts.purposeLine,
      "{{画面内容}}",
      parts.styleLine,
      parts.compLine,
      "{{药品说明}}",
      parts.banLine,
    ].join("\n");
  }

  function illustrationPrompt(w, shot, layout, themeDef) {
    const parts = _artPromptParts(w, shot, layout, themeDef);
    return [parts.purposeLine, parts.subjectLine, parts.styleLine, parts.compLine, parts.drugLine, parts.banLine]
      .filter(Boolean).join("\n").slice(0, 2100);
  }

  function renderArtPromptForShot(w, shot, layout, themeDef, { ignoreOverride = false } = {}) {
    if (!ignoreOverride && shot?.content?.customArtPrompt?.trim()) {
      return shot.content.customArtPrompt.trim().slice(0, 3800);
    }
    const tplState = typeof getExtraPromptState === "function" ? getExtraPromptState(w, "stage-art") : null;
    if (tplState?.isCustom && tplState.value.trim()) {
      const parts = _artPromptParts(w, shot, layout, themeDef);
      const map = {
        "{{画面内容}}": parts.subjectLine,
        "{{插画主题}}": parts.subjectLine,
        "{{药品说明}}": parts.drugLine,
      };
      return tplState.value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map(line => {
          let next = line;
          for (const [token, val] of Object.entries(map)) {
            if (next.includes(token)) next = next.split(token).join(val);
          }
          return next.trim();
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, 3800);
    }
    return illustrationPrompt(w, shot, layout, themeDef);
  }

  function renderImagePromptForShot(w, index, layout, themeDef, { ignoreOverride = false } = {}) {
    const shot = w.stagePlan.shots[index];
    if (!ignoreOverride && shot?.content?.customFullImagePrompt?.trim()) {
      return shot.content.customFullImagePrompt.trim().slice(0, 3800);
    }
    const resolvedLayout = layout || currentLayoutDef(w);
    const resolvedTheme = themeDef || currentThemeDef(w);
    const data = deck(w, resolvedTheme);
    const tplState = typeof getExtraPromptState === "function" ? getExtraPromptState(w, "stage-image") : null;
    if (tplState?.isCustom && tplState.value.trim() && typeof TemplateVideo.renderCardImageTemplate === "function") {
      return TemplateVideo.renderCardImageTemplate(
        tplState.value, data, index, shot?.content?.imagePrompt, w.drug, resolvedLayout, resolvedTheme,
      );
    }
    return TemplateVideo.buildCardImagePrompt(data, index, shot?.content?.imagePrompt, w.drug, resolvedLayout, resolvedTheme);
  }

  function defaultImagePromptTemplate(w, layout, themeDef) {
    const resolvedLayout = layout || currentLayoutDef(w);
    const resolvedTheme = themeDef || currentThemeDef(w);
    const data = deck(w, resolvedTheme);
    return TemplateVideo.defaultCardImageTemplate(data, resolvedLayout, resolvedTheme);
  }

  function currentProduceKind(w) {
    const shot = w?.stagePlan?.shots?.[selected.get(w) || 0];
    const kind = shot?.content?.kind;
    return ["svg", "scene", "card", "asset", "mg"].includes(kind) ? kind : "scene";
  }

  function hasProductionJob(w) {
    return isActive(w) && Boolean(w.job?.stageImageSlots || w.job?.stageClipShot !== undefined || w.job?.stageSpeechIndex !== undefined || ["produce", "scene-batch", "svg-batch", "clip-prompt"].includes(w.job?.stageDraft));
  }

  function updateProductionJob(w) {
    if (!hasProductionJob(w)) return;
    const job = w.job;
    const singleIdx = job.stageShotIndex ?? job.stageSpeechIndex;
    const shotArea = currentView(w) === "review" && singleIdx !== undefined
      ? app.querySelector(`[data-review-job="${singleIdx}"]`)
      : null;
    const topArea = $("#stage-production-job");
    const area = shotArea || topArea;
    if (!area) return;
    if (shotArea && topArea) { topArea.innerHTML = ""; topArea.hidden = true; }
    app.querySelectorAll("[data-review-job]").forEach(el => {
      if (el !== area) { el.innerHTML = ""; el.hidden = true; }
    });
    const picture = job.stageClipFrame ? "首帧" : job.stageArt ? "插画" : "配图";
    const subject = job.stageSpeechIndex !== undefined ? `第 ${job.stageSpeechIndex + 1} 幕口播配音`
      : job.stageClipShot !== undefined ? `第 ${job.stageClipShot + 1} 幕 AI 视频`
      : job.stageDraft === "svg-batch" ? "缺失 SVG 动画"
      : job.stageDraft === "scene-batch" ? "缺失代码动画"
      : job.stageDraft === "clip-prompt" ? `第 ${job.stageShotIndex + 1} 幕视频描述`
      : job.stageShotIndex === undefined ? "缺失" + picture : `第 ${job.stageShotIndex + 1} 幕${job.stageImageSlots ? picture : "画面"}`;
    const progressText = formatJobProgress(w, job, job.progress || `正在制作${subject}…`);
    area.hidden = false;
    area.innerHTML = job.error
      ? `<div class="banner err" role="alert">${subject}未制作完成。${esc(job.error)}<div class="banner-actions">` +
        btn("继续此任务", "retry", "secondary") + btn("关闭提示", "abort-job", "textbtn") + '</div></div>'
      : `<div class="inline-progress" role="status"><span class="spinner" aria-hidden="true"></span><span id="progress">${esc(progressText)}</span></div>`;
    app.querySelectorAll('[data-stage-production-lock], .stage-rail button').forEach(control => { control.disabled = true; });
  }

  function productionButtons(w, shot, content, slot) {
    const {kind} = content;
    let actions = "";
    if (kind === "image") {
      actions = btn(content.image ? "重新生成本幕图" : "生成本幕配图", "stage-images", "primary", "one") +
        btn(content.image ? "从素材库换图" : "从素材库选图", "stage-choose", "outline", "image");
    } else if (kind === "asset") {
      actions = btn(esc(content.assetName || "选择图片或 SVG"), "stage-choose", "primary", "asset");
    } else if (kind === "mg") {
      actions = btn(esc(content.assetName || "选择 MG 动画"), "stage-choose", "primary", "mg") +
        (config.mgGeneration ? btn(content.assetId ? "重新制作 MG 草稿" : "制作 MG 草稿", "stage-create-mg", "outline") : "");
    }
    if (!["image", "clip"].includes(kind) && config.stageShotProduction) {
      actions += btn(productionTitle(content), "stage-produce", actions ? "outline" : "primary");
    }
    if (kind === "svg" && content.svgCode) {
      actions += btn("清空代码", "stage-clear", "textbtn", "svg-code");
    }
    if (kind === "scene" && content.code) {
      actions += btn("清空代码", "stage-clear", "textbtn", "code");
    }
    return actions ? '<div class="asset-inline">' + actions + '</div>' : "";
  }

  function viewSwitchHtml(w, activeView) {
    const plan = collectBatchPlan(w, { includeStale: false });
    const badge = plan.totalBatchShots > 0
      ? `<span class="stage-view-dot is-pending" title="还有 ${plan.totalBatchShots} 幕待生成画面"></span>`
      : plan.staleCount > 0
        ? `<span class="stage-view-dot is-stale" title="有 ${plan.staleCount} 幕内容已改待重画"></span>`
        : "";
    return `<div class="stage-view-switch" role="tablist" aria-label="分镜工作视图">` +
      `<button type="button" class="stage-view-tab${activeView === "review" ? " is-active" : ""}" data-action="stage-view" data-val="review" role="tab" aria-selected="${activeView === "review"}">${REVIEW_ICON}<span>总览审稿</span></button>` +
      `<button type="button" class="stage-view-tab${activeView === "studio" ? " is-active" : ""}" data-action="stage-view" data-val="studio" role="tab" aria-selected="${activeView === "studio"}">${STUDIO_ICON}<span>逐幕精修</span>${badge}</button>` +
      `</div>`;
  }

  function reviewBatchBreakdown(plan) {
    const parts = [];
    if (plan.image.length) parts.push(`${plan.image.length} 张 AI 完整图`);
    if (plan.svg.length) parts.push(`${plan.svg.length} 幕 SVG 动画`);
    if (plan.scene.length) parts.push(`${plan.scene.length} 幕代码动效`);
    return parts.join("、");
  }

  function getReviewFilter(w) {
    const val = reviewFilter.get(w);
    const len = w?.stagePlan?.shots?.length || 0;
    if (typeof val === "number" && val >= 0 && val < len) return val;
    return "all";
  }

  function reviewBatchPrimaryText(w, missingPlan, fullPlan) {
    if (!fullPlan.totalBatchShots) return "";
    const willAuto = Boolean(w.stagePlan.autoComposeAfterBatch && canAutoCompose(w, fullPlan));
    const isOnlyStale = missingPlan.totalBatchShots === 0;
    const hasSomeReady = missingPlan.readyCount > 0 && missingPlan.totalBatchShots > 0;
    if (willAuto) {
      if (isOnlyStale) return `重画已修改画面并合成（${fullPlan.totalBatchShots} 幕）`;
      return hasSomeReady ? `生成剩余画面并合成视频（${fullPlan.totalBatchShots} 幕）` : "确认内容，生成画面并合成视频";
    }
    if (isOnlyStale) return `重新生成已修改画面（${fullPlan.totalBatchShots} 幕）`;
    return hasSomeReady
      ? `生成剩余画面（${fullPlan.totalBatchShots} 幕）`
      : `确认内容，生成全部画面（${fullPlan.totalBatchShots} 幕）`;
  }

  function reviewSingleActionLabel(shot) {
    const kind = shot?.content?.kind;
    const ready = shotReadyState(shot) === "ok";
    if (kind === "image") return ready ? "重新生成 AI 完整图" : "生成 AI 完整图";
    if (kind === "svg") return ready ? "重新生成 SVG 动画" : "生成 SVG 动画";
    if (kind === "scene") return ready ? "重新生成代码动效" : "生成代码动效";
    if (kind === "clip") return `去精修页生成${shot.content.clipStyle === "mg" ? " AI MG 动画" : " AI 演示视频"}`;
    return "精修此幕";
  }

  function refreshReviewSummaryDom(w) {
    if (currentView(w) !== "review") return;
    const shots = w.stagePlan.shots;
    const totalSec = Math.round(shots.reduce((n, s) => n + (Number(s.seconds) || 0), 0));
    const totalChars = shots.reduce((n, s) => n + String(s.line || "").trim().length, 0);
    const sumEl = $("#stage-review-summary");
    if (sumEl) sumEl.textContent = `共 ${shots.length} 幕 · 约 ${totalSec} 秒 · ${totalChars} 字`;
    const missingPlan = collectBatchPlan(w, { includeStale: false });
    const fullPlan = collectBatchPlan(w, { includeStale: true });
    const pillEl = $("#stage-review-readiness");
    if (pillEl) {
      if (missingPlan.totalBatchShots > 0) {
        pillEl.className = "stage-review-pill is-pending";
        pillEl.textContent = `待生成 ${missingPlan.totalBatchShots} 幕`;
      } else if (fullPlan.staleCount > 0) {
        pillEl.className = "stage-review-pill is-stale";
        pillEl.textContent = `${fullPlan.staleCount} 幕已改 · 待重画`;
      } else {
        pillEl.className = "stage-review-pill is-ok";
        pillEl.textContent = `全部 ${shots.length} 幕画面就绪`;
      }
    }
    const footMeta = $("#stage-review-footer-meta");
    if (footMeta) {
      const breakdown = reviewBatchBreakdown(fullPlan);
      footMeta.textContent = breakdown
        ? `共 ${shots.length} 幕 · 约 ${totalSec} 秒 · 待生成：${breakdown}`
        : `共 ${shots.length} 幕 · 约 ${totalSec} 秒 · 全部画面已就绪`;
    }
    app.querySelectorAll('[data-action="stage-batch-all"]').forEach(b => {
      b.hidden = fullPlan.totalBatchShots === 0;
      if (fullPlan.totalBatchShots > 0) {
        const isOnlyStale = missingPlan.totalBatchShots === 0;
        b.dataset.val = isOnlyStale ? "stale" : "all";
        b.textContent = reviewBatchPrimaryText(w, missingPlan, fullPlan);
      }
    });
  }

  function renderReviewEditor(w) {
    if (narrationCleanup) { narrationCleanup(); narrationCleanup = null; }
    const p = w.stagePlan;
    const shots = p.shots;
    const activeFilter = getReviewFilter(w);
    const layoutMeta = currentLayoutDef(w);
    const support = layoutMeta?.supports;
    const layoutId = p.layout.id;
    const layoutName = layoutMeta?.name || "信息图模板";
    const isQaLayout = layoutId === "builtin:layout/qa-chat" || layoutMeta?.regions?.header?.variant === "question" || Boolean(layoutMeta?.regions?.answer);
    const isHeadlineLayout = layoutId === "builtin:layout/headline" || Boolean(layoutMeta?.regions?.headline);
    const isTakeawayLayout = layoutId === "builtin:layout/takeaway" || Boolean(layoutMeta?.regions?.keypoints);
    const isBroadcastLayout = layoutId === "builtin:layout/broadcast" || layoutMeta?.regions?.header?.variant === "ticker";
    const totalSec = Math.round(shots.reduce((n, s) => n + (Number(s.seconds) || 0), 0));
    const totalChars = shots.reduce((n, s) => n + String(s.line || "").trim().length, 0);
    const missingPlan = collectBatchPlan(w, { includeStale: false });
    const fullPlan = collectBatchPlan(w, { includeStale: true });
    const allowAuto = canAutoCompose(w, fullPlan);
    const willAuto = Boolean(p.autoComposeAfterBatch && allowAuto);
    const hasAvatar = usesDynamicAvatar(w);
    const voiceList = typeof voiceOptions !== "undefined"
      ? voiceOptions.map(item => Array.isArray(item) ? item : [item, item])
      : [[w.settings.voice || "无配音", w.settings.voice || "无配音"]];
    const currentVoice = w.settings.voice || "无配音";
    const presenterText = (w.templatePresenter || "digital") === "none"
      ? "无出镜人物"
      : hasAvatar ? `动态数字人（${resolveAvatarMode(w.settings.avatarMode) === "wan2.2-s2v" ? "Wan2.2" : "VideoRetalk"} · 定稿合成时生成）`
      : "静态主讲肖像";

    const readinessHtml = missingPlan.totalBatchShots > 0
      ? `<span class="stage-review-pill is-pending" id="stage-review-readiness">待生成 ${missingPlan.totalBatchShots} 幕</span>`
      : fullPlan.staleCount > 0
        ? `<span class="stage-review-pill is-stale" id="stage-review-readiness">${fullPlan.staleCount} 幕已改 · 待重画</span>`
        : `<span class="stage-review-pill is-ok" id="stage-review-readiness">全部 ${shots.length} 幕画面就绪</span>`;

    const batchActionMode = missingPlan.totalBatchShots > 0 ? "all" : "stale";
    const batchPrimaryLabel = reviewBatchPrimaryText(w, missingPlan, fullPlan);

    const topActions = btn("全片配音与模型", "work-settings", "outline") +
      btn(batchPrimaryLabel || "重新生成已修改画面", "stage-batch-all", "primary", batchActionMode, fullPlan.totalBatchShots > 0 ? "" : "hidden") +
      (fullPlan.totalBatchShots > 0
        ? (missingPlan.totalBatchShots === 0 ? btn("合成视频", "stage-compose", "outline") : "")
        : btn("进入逐幕精修", "stage-view", "outline", "studio") +
          btn("合成视频", "stage-compose", "primary"));

    const guideBanner = missingPlan.totalBatchShots > 0
      ? `<div class="stage-review-guide" role="note">` +
          `<strong>医学审校提示</strong>` +
          `<span>请核对每幕的「口播台词」「屏显要点」与「画面构想」（重点确认药品通用名、用法用量条件、禁忌人群与就医指征）。确认一幕可直接单幕生成，也可全部核对完后一键统一生成。</span>` +
        `</div>`
      : fullPlan.staleCount > 0
        ? `<div class="stage-review-guide is-stale" role="note">` +
            `<strong>内容已更新</strong>` +
            `<span>有 ${fullPlan.staleCount} 幕已修改口播或画面构想，可单幕重画，或一键仅重新生成改过的幕，其余画面自动保留不重复计费。</span>` +
          `</div>`
        : "";

    const shotTabsHtml = `<div class="stage-review-tabs-bar" role="tablist" aria-label="按幕切换审稿">` +
      `<button type="button" class="stage-review-tab${activeFilter === "all" ? " is-active" : ""}" data-action="stage-review-filter" data-val="all" role="tab" aria-selected="${activeFilter === "all"}">` +
        `<span>全部</span><em class="stage-review-tab-count">${shots.length}</em>` +
      `</button>` +
      shots.map((s, idx) => {
        const ready = shotReadyState(s) === "ok";
        const stale = shotNeedsRegen(s);
        const st = !ready ? "pending" : stale ? "stale" : "ok";
        const stTitle = !ready ? "待生成画面" : stale ? "内容已改 · 建议重画" : "画面就绪";
        return `<button type="button" class="stage-review-tab${activeFilter === idx ? " is-active" : ""}" data-action="stage-review-filter" data-val="${idx}" role="tab" aria-selected="${activeFilter === idx}" title="第 ${idx + 1} 幕 · ${esc(s.name || "未命名")}（${stTitle}）">` +
          `<span class="stage-review-tab-dot is-${st}" data-review-tab-dot="${idx}"></span>` +
          `<span class="stage-review-tab-num">第 ${idx + 1} 幕</span>` +
          `<span class="stage-review-tab-name" data-review-tab-name="${idx}">${esc(s.name || "未命名")}</span>` +
        `</button>`;
      }).join("") +
    `</div>`;

    const visibleIndices = activeFilter === "all"
      ? shots.map((_, idx) => idx)
      : [activeFilter];

    const cardsHtml = visibleIndices.map((i) => {
      const shot = shots[i];
      const c = shot.content;
      const kind = c.kind;
      const ready = shotReadyState(shot) === "ok";
      const stale = shotNeedsRegen(shot);
      const statusKind = !ready ? "pending" : stale ? "stale" : "ok";
      const statusLabel = !ready ? "待生成画面" : stale ? "内容已改 · 建议重画" : "画面就绪";
      const lineText = formatLineByCues(shot);
      const lineRows = Math.max(3, Math.min(8, lineText.split("\n").length + 1));
      const hasCachedSpeech = Boolean(shot.speech && shot.speech.line === shot.line.trim() && shot.speech.voice === currentVoice);
      const isPlaying = reviewPlayingWork === w && reviewPlayingIndex === i && reviewAudio && !reviewAudio.paused;
      const speechBtn = `<button type="button" class="stage-review-speech-btn${hasCachedSpeech ? " is-cached" : ""}${isPlaying ? " is-playing" : ""}" data-action="stage-review-speech" data-val="${i}" title="${currentVoice === "无配音" ? "当前为无配音，请在上方选择音色" : "试听本幕口播，合成视频时自动复用不重复计费"}">${isPlaying ? `${PAUSE_ICON}<span>停止试听</span>` : `${PLAY_ICON}<span>试听口播</span>${hasCachedSpeech ? '<em class="stage-speech-tag">已缓存</em>' : ""}`}</button>`;

      const modeChoices = [
        ["image", "AI 完整图", kind === "image", !support || support.includes("image")],
        ["svg", "SVG 动画", kind === "svg", !support || support.includes("svg")],
        ["scene", "代码动效", kind === "scene", !support || support.includes("scene")],
        ["clip:demo", "AI 演示视频", kind === "clip" && (c.clipStyle || "demo") === "demo", !support || support.includes("clip") || support.includes("image")],
        ["clip:mg", "AI MG 动画", kind === "clip" && c.clipStyle === "mg", !support || support.includes("clip") || support.includes("image")],
      ];
      const kindChips = modeChoices.map(([val, label, active, allowed]) =>
        btn(label, "stage-review-kind", "chip" + (active ? " selected" : ""), `${i}:${val}`, `aria-pressed="${active}" ${allowed ? "" : "disabled"}`)
      ).join("") + (["card", "mg", "asset"].includes(kind) ? `<span class="stage-legacy-badge">${esc(kinds[kind] || "旧版")}</span>` : "");

      const previewStrip = kind === "image" && c.image
        ? `<div class="stage-review-thumb-bar">` +
            `<button type="button" class="stage-review-thumb-btn" data-action="stage-review-zoom" data-val="${i}" title="点击查看大图核对画面文字">` +
              `<img src="${esc(c.image)}" alt="第 ${i + 1} 幕配图缩略图">` +
            `</button>` +
            `<div class="stage-review-thumb-info"><strong>已生成 AI 完整图</strong><span class="small">点击左侧缩略图可放大核对画面文字</span></div>` +
            btn("查看大图", "stage-review-zoom", "textbtn stage-review-inline-btn", String(i)) +
          `</div>`
        : kind === "clip" && c.clipPoster
          ? `<div class="stage-review-thumb-bar"><img src="${esc(c.clipPoster)}" alt="第 ${i + 1} 幕视频封面"><div class="stage-review-thumb-info"><strong>已生成 AI 视频片段</strong><span class="small">可在「精修此幕」中播放核对</span></div></div>`
          : (kind === "svg" && c.svgCode?.svg) || (kind === "scene" && c.code?.html)
            ? `<div class="stage-review-ready-note"><strong>已生成${kind === "svg" ? " SVG 动画" : "代码动效"}</strong><span class="small">点击「精修此幕」可播放逐帧效果</span></div>`
            : "";

      const hasCustomFullPrompt = (kind === "image" && Boolean(c.customFullImagePrompt?.trim()))
        || (kind === "svg" && Boolean(c.customSvgPrompt?.trim()))
        || (kind === "scene" && Boolean(c.customCodePrompt?.trim()));
      const customNote = hasCustomFullPrompt ? `<span class="prompt-badge is-custom">精修页已手改提示词</span>` : "";

      const visualIdeaField = kind === "image"
        ? `<label class="field stage-review-field"><span class="stage-review-field-head"><span>画面构想 <em class="small">（描述希望画面画什么）</em></span>${customNote}</span><textarea data-stage-field="review-imagePrompt:${i}" rows="2" maxlength="400" placeholder="用大白话写希望画面突出什么，如：带刻度的滴管量取混悬液、药盒放大有效期…">${esc(c.imagePrompt || "")}</textarea></label>`
        : kind === "svg" || kind === "scene"
          ? `<label class="field stage-review-field"><span class="stage-review-field-head"><span>画面与动效构想 <em class="small">（描述主体与动态变化）</em></span>${customNote}</span><textarea data-stage-field="review-codePrompt:${i}" rows="2" maxlength="600" placeholder="用大白话描述想演示的动作或图示，如：胶囊缓慢溶解释放颗粒，突出不可掰开…">${esc(c.codePrompt || "")}</textarea></label>`
          : kind === "clip"
            ? `<label class="field stage-review-field"><span class="stage-review-field-head"><span>视频动作构想 <em class="small">（AI 视频按秒计费，请在精修页单独生成）</em></span></span><textarea data-stage-field="review-clipPrompt:${i}" rows="2" maxlength="400" placeholder="描述近景动作与镜头，不含文字、品牌与医生正面像…">${esc(c.clipPrompt || "")}</textarea></label>`
            : "";

      const qaFields = isQaLayout
        ? `<div class="stage-review-subgrid">` +
            `<label class="field stage-review-field"><span>患者提问（≤30 字）</span><input data-stage-field="review-question:${i}" value="${esc(shot.points.question || "")}" maxlength="30" placeholder="如：缓释片太大能不能掰半吃？"></label>` +
            `<div class="stage-review-qa-row">` +
              `<label class="field stage-review-field"><span>药师结论（≤16 字）</span><input data-stage-field="review-answer:${i}" value="${esc(shot.points.answer || "")}" maxlength="16" placeholder="如：不能掰开，需整片吞服"></label>` +
              `<label class="field stage-review-field"><span>结论语气</span><select data-stage-field="review-verdictTone:${i}">${opts([["", "默认（正确 ✓）"], ["ok", "正确 / 推荐（✓）"], ["no", "否定 / 禁止（✗）"], ["warn", "提醒 / 注意（!）"]], shot.points.verdictTone || "")}</select></label>` +
            `</div>` +
          `</div>`
        : "";

      const headlineFields = isHeadlineLayout
        ? `<div class="stage-review-subgrid">` +
            `<label class="field stage-review-field"><span>大标题</span><input data-stage-field="review-headline:${i}" value="${esc(shot.points.headline || "")}" maxlength="40"></label>` +
            `<div class="stage-review-qa-row">` +
              `<label class="field stage-review-field"><span>强调短语（须在标题内，≤8 字）</span><input data-stage-field="review-accentPhrase:${i}" value="${esc(shot.points.accentPhrase || "")}" maxlength="8"></label>` +
              `<label class="field stage-review-field"><span>一句解释（≤30 字）</span><input data-stage-field="review-lead:${i}" value="${esc(shot.points.lead || "")}" maxlength="30"></label>` +
            `</div>` +
          `</div>`
        : "";

      const itemsText = (shot.points.items || []).map(item => [item.title, item.detail, item.tag].filter(Boolean).join("｜")).join("\n");
      const itemsLabel = kind === "image"
        ? "画面要点 <em class=\"small\">（每行一条，会融入配图文字）</em>"
        : isTakeawayLayout
          ? "右侧要点清单 <em class=\"small\">（每行一条，最多 4 条）</em>"
          : "屏显要点 <em class=\"small\">（每行一条，可用「｜」补充说明）</em>";
      const showTakeawayRow = isTakeawayLayout || ["card", "scene", "svg"].includes(kind) || Boolean(shot.points.takeaway?.trim());
      const pointsSection =
        `<label class="field stage-review-field"><span>${itemsLabel}</span><textarea data-stage-field="review-items:${i}" rows="${Math.max(2, Math.min(4, (shot.points.items?.length || 1) + 1))}" placeholder="每行一条核心要点…">${esc(itemsText)}</textarea></label>` +
        (showTakeawayRow
          ? `<label class="field stage-review-field"><span>${isTakeawayLayout ? "记住这一句" : "画面结语"}</span><input data-stage-field="review-takeaway:${i}" value="${esc(shot.points.takeaway || "")}" maxlength="40" placeholder="一句话收口提醒…"></label>`
          : "");

      const genLabel = reviewSingleActionLabel(shot);
      const genBtnCls = (!ready || stale) ? "primary stage-review-gen-btn" : "outline stage-review-gen-btn";
      const singleGenBar = ["image", "svg", "scene"].includes(kind)
        ? `<div class="stage-review-shot-actions">` +
            btn(genLabel, "stage-review-generate", genBtnCls, String(i), `data-review-gen-btn="${i}"`) +
            (kind === "image" ? btn(ready ? "从素材库换图" : "从素材库选图", "stage-review-choose", "textbtn stage-review-inline-btn", String(i)) : "") +
            `<span class="small stage-review-shot-hint">${!ready ? "确认本幕无误可直接生成" : stale ? "本幕文案已改，可单独重画" : "可随时微调后单独重做"}</span>` +
          `</div>`
        : kind === "clip"
          ? `<div class="stage-review-shot-actions">` +
              btn(genLabel, "stage-review-open", "outline stage-review-gen-btn", String(i)) +
              `<span class="small stage-review-shot-hint">AI 视频按秒计费，在精修页确认首帧后生成</span>` +
            `</div>`
          : "";

      const chapterSelect = p.chapters.length > 1
        ? `<select class="stage-review-chapter" data-stage-field="review-chapter:${i}" aria-label="第 ${i + 1} 幕所属章节">${opts(p.chapters.map((name, idx) => [String(idx), name]), String(shot.chapterIndex))}</select>`
        : "";

      return `<article class="sheet stage-review-card" data-review-shot="${i}">` +
        `<div class="stage-review-card-head">` +
          `<div class="stage-review-card-id">` +
            `<span class="stage-review-num">第 ${i + 1} 幕</span>` +
            `<input class="stage-review-title-input" data-stage-field="review-name:${i}" value="${esc(shot.name)}" maxlength="40" aria-label="第 ${i + 1} 幕标题" placeholder="输入本幕标题">` +
            chapterSelect +
          `</div>` +
          `<div class="stage-review-card-ops">` +
            `<span class="stage-review-sec" data-review-sec="${i}">约 ${Math.round(shot.seconds)} 秒</span>` +
            `<span class="stage-review-status is-${statusKind}" data-review-status="${i}">${statusLabel}</span>` +
            `<div class="stage-review-move-group">` +
              btn(ico("up"), "stage-review-move", "icon-btn", `${i}:-1`, `title="上移一幕" aria-label="上移第 ${i + 1} 幕" ${i === 0 ? "disabled" : ""}`) +
              btn(ico("down"), "stage-review-move", "icon-btn", `${i}:1`, `title="下移一幕" aria-label="下移第 ${i + 1} 幕" ${i === shots.length - 1 ? "disabled" : ""}`) +
              btn(ico("trash"), "stage-review-remove", "icon-btn danger", String(i), `title="删除本幕" aria-label="删除第 ${i + 1} 幕" ${shots.length === 1 ? "disabled" : ""}`) +
            `</div>` +
            btn("精修此幕", "stage-review-open", "textbtn stage-review-open-btn", String(i)) +
          `</div>` +
        `</div>` +
        `<div class="stage-review-card-body">` +
          `<div class="stage-review-col-script">` +
            `<div class="stage-review-col-head">` +
              `<div><strong>口播台词</strong><span class="small"> · 换行即字幕断句</span></div>` +
              `<div class="stage-review-script-tools">` +
                `<span class="small" data-review-stats="${i}">${shot.cues.length} 句 · ${shot.line.trim().length} 字</span>` +
                speechBtn +
              `</div>` +
            `</div>` +
            `<textarea class="stage-review-line" data-stage-field="review-line:${i}" maxlength="450" rows="${lineRows}" aria-label="第 ${i + 1} 幕口播台词" placeholder="输入本幕口播台词，按回车换行即可调整字幕断句…">${esc(lineText)}</textarea>` +
          `</div>` +
          `<div class="stage-review-col-visual">` +
            `<div class="stage-review-kinds"><span class="stage-review-sublabel">画面方式</span><div class="chips stage-review-kind-chips">${kindChips}</div></div>` +
            previewStrip +
            visualIdeaField +
            qaFields +
            headlineFields +
            pointsSection +
            singleGenBar +
          `</div>` +
        `</div>` +
        `<div class="stage-review-shot-job" data-review-job="${i}" hidden></div>` +
      `</article>`;
    }).join("");

    const singlePagerHtml = activeFilter !== "all"
      ? `<div class="stage-review-pager">` +
          btn(activeFilter > 0 ? `← 上一幕：${esc(shots[activeFilter - 1].name || `第 ${activeFilter} 幕`)}` : "← 已是第 1 幕",
            "stage-review-filter", "outline", activeFilter > 0 ? String(activeFilter - 1) : "0", activeFilter === 0 ? "disabled" : "") +
          `<div class="stage-review-pager-mid"><span class="small">第 ${activeFilter + 1} / ${shots.length} 幕</span>` +
            btn("查看全部幕", "stage-review-filter", "textbtn stage-review-inline-btn", "all") + `</div>` +
          btn(activeFilter < shots.length - 1 ? `下一幕：${esc(shots[activeFilter + 1].name || `第 ${activeFilter + 2} 幕`)} →` : "已是最后一幕 →",
            "stage-review-filter", "outline", activeFilter < shots.length - 1 ? String(activeFilter + 1) : String(shots.length - 1), activeFilter === shots.length - 1 ? "disabled" : "") +
        `</div>`
      : "";

    const footerBreakdown = reviewBatchBreakdown(fullPlan);
    const footerGuard = hasAvatar && fullPlan.totalBatchShots > 0
      ? `<p class="small stage-review-guard">当前已开启数字人对口型：为避免画面未确认即产生数字人费用，生成画面后将先进入逐幕精修核对，确认无误再合成。</p>`
      : fullPlan.missingClips.length > 0
        ? `<p class="small stage-review-guard">第 ${fullPlan.missingClips.map(idx => idx + 1).join("、")} 幕为 AI 视频片段，不参与一键批量生成，将在逐幕精修中单独确认后生成。</p>`
        : "";
    const autoComposeToggle = fullPlan.totalBatchShots > 0 && allowAuto
      ? `<label class="stage-review-autocompose"><input type="checkbox" data-stage-field="work-autoCompose" ${willAuto ? "checked" : ""}><span>画面全部生成后自动合成视频（静态肖像，省去手动点合成）</span></label>`
      : "";

    const footerActions = fullPlan.totalBatchShots > 0
      ? btn("先去逐幕精修", "stage-view", "outline", "studio") +
        btn(batchPrimaryLabel, "stage-batch-all", "primary", batchActionMode)
      : btn("进入逐幕精修", "stage-view", "outline", "studio") +
        btn("重新生成已修改画面", "stage-batch-all", "primary", "stale", "hidden") +
        btn("合成视频", "stage-compose", "primary");

    const showDrugTags = isBroadcastLayout || Boolean(p.drugTags?.length);

    shell(w, "编辑视频分镜", 1, `<div class="vstudio stage-review-shell">` +
      `<div class="sheet vstudio-bar">` +
        `<div class="vstudio-summary">` +
          viewSwitchHtml(w, "review") +
          `<span class="vstudio-metric" id="stage-review-summary">共 ${shots.length} 幕 · 约 ${totalSec} 秒 · ${totalChars} 字</span>` +
          readinessHtml +
        `</div>` +
        `<fieldset class="vstudio-actions stage-edit-fields" data-stage-production-lock>${topActions}</fieldset>` +
      `</div>` +
      `<div id="stage-production-job" hidden></div>` +
      `<fieldset class="stage-edit-fields stage-review-fieldset" data-stage-production-lock>` +
        `<section class="sheet stage-review-meta">` +
          `<div class="stage-review-meta-grid">` +
            `<label class="field stage-review-meta-title">视频标题<input data-stage-field="work-title" value="${esc(w.title || "")}" maxlength="40" placeholder="输入科普视频标题"></label>` +
            `<label class="field">关联药品（选填）<input data-stage-field="work-drug" value="${esc(w.drug || "")}" maxlength="20" placeholder="如：硝苯地平缓释片"></label>` +
            (showDrugTags ? `<label class="field">药品标签（最多 2 个）<input data-stage-field="work-drugTags" value="${esc((p.drugTags || []).join("，"))}" maxlength="20" placeholder="如：缓释片，处方药"></label>` : "") +
            `<label class="field">配音音色<select data-stage-field="work-voice">${opts(voiceList, currentVoice)}</select></label>` +
          `</div>` +
          `<div class="stage-review-meta-bar">` +
            `<div class="stage-review-meta-pills">` +
              `<span class="pill">布局：${esc(layoutName)}</span>` +
              `<span class="pill">主题：${esc(themeName(w))}</span>` +
              `<span class="pill">主讲：${esc(presenterText)}</span>` +
              btn("调整模板与主讲", "stage-goto-module", "textbtn stage-review-inline-btn", "template") +
            `</div>` +
            `<details class="stage-review-more"><summary>编辑章节名与免责声明</summary>` +
              `<div class="stage-review-more-grid">` +
                p.chapters.map((name, idx) => text(`章节 ${idx + 1}`, "work-chapter:" + idx, name, 10)).join("") +
                `<label class="field stage-review-disclaimer-field">底部参考声明<input data-stage-field="work-disclaimer" value="${esc(p.disclaimer || "")}" maxlength="60"></label>` +
              `</div>` +
            `</details>` +
          `</div>` +
        `</section>` +
        guideBanner +
        shotTabsHtml +
        `<div class="stage-review-list">${cardsHtml}</div>` +
        singlePagerHtml +
        `<div class="stage-review-add-row">${btn("+ 添加一幕（最多 12 幕）", "stage-add", "outline", "", shots.length >= 12 ? "disabled" : "")}</div>` +
        `<section class="sheet stage-review-footer">` +
          `<div class="stage-review-footer-info">` +
            `<strong id="stage-review-footer-meta">${footerBreakdown ? `共 ${shots.length} 幕 · 约 ${totalSec} 秒 · 待生成：${footerBreakdown}` : `共 ${shots.length} 幕 · 约 ${totalSec} 秒 · 全部画面已就绪`}</strong>` +
            autoComposeToggle +
            footerGuard +
          `</div>` +
          `<div class="stage-review-footer-actions">${footerActions}</div>` +
        `</section>` +
      `</fieldset>` +
    `</div>`);
    updateProductionJob(w);
  }

  function editor(w) {
    const shots = w.stagePlan.shots;
    if (!shots.length) return setup(w);
    if (currentView(w) === "review") return renderReviewEditor(w);
    stopReviewAudio();
    return renderStudioEditor(w);
  }

  function renderStudioEditor(w) {
    const shots = w.stagePlan.shots;
    const index = Math.min(selected.get(w) ?? w.job?.stageSpeechIndex ?? w.job?.stageShotIndex ?? 0, shots.length - 1);
    const shot = shots[index];
    if (!shot) return setup(w);
    selected.set(w, index);
    const activeModule = normalizeModule(inspector.get(w));
    const activeMeta = STAGE_MODULES.find(m => m.id === activeModule) || STAGE_MODULES[0];
    const layoutMeta = currentLayoutDef(w);
    const slotDesc = LayoutEngine.describeMediaSlot(layoutMeta);
    const support = layoutMeta?.supports;
    const layoutId = w.stagePlan.layout.id;
    const isQaLayout = layoutId === "builtin:layout/qa-chat" || layoutMeta?.regions?.header?.variant === "question" || Boolean(layoutMeta?.regions?.answer);
    const isHeadlineLayout = layoutId === "builtin:layout/headline" || Boolean(layoutMeta?.regions?.headline);
    const isTakeawayLayout = layoutId === "builtin:layout/takeaway" || Boolean(layoutMeta?.regions?.keypoints);
    const isNamecardHeader = layoutMeta?.regions?.header?.variant === "namecard";
    const kind = shot.content.kind;
    const isMotionKind = kind === "card" || kind === "scene";
    const overlayMode = (kind === "clip" || kind === "mg") ? (shot.content.overlay || "points") : "off";
    const showHeadline = isHeadlineLayout || isTakeawayLayout || isNamecardHeader || isMotionKind || overlayMode !== "off";
    const showTakeaway = isTakeawayLayout || isMotionKind;
    const showItems = isTakeawayLayout || isMotionKind || overlayMode === "points";
    const editorModes = [
      ["image", "AI 完整图", shot.content.kind === "image", !support || support.includes("image")],
      ["svg", "SVG 动画", shot.content.kind === "svg", !support || support.includes("svg")],
      ["scene", "代码动效场景", shot.content.kind === "scene", !support || support.includes("scene")],
      ["clip:demo", "AI 演示视频", shot.content.kind === "clip" && (shot.content.clipStyle || "demo") === "demo", !support || support.includes("clip") || support.includes("image")],
      ["clip:mg", "AI MG 动画", shot.content.kind === "clip" && shot.content.clipStyle === "mg", !support || support.includes("clip") || support.includes("image")],
    ];
    const legacyTag = ["card", "mg"].includes(shot.content.kind)
      ? `<span class="stage-legacy-badge" title="旧作品兼容保留，可预览导出或切换为新方式">${esc(kinds[shot.content.kind] || "旧版")}</span>` +
        (shot.content.kind === "card"
          ? btn("改用 SVG 动画", "stage-kind", "outline", "svg")
          : btn("改用 AI 视频", "stage-legacy-to-clip", "outline"))
      : "";
    const kindButtons = editorModes.map(([val, name, active, allowed]) =>
      btn(name, "stage-kind", "chip" + (active ? " selected" : ""), val, `aria-pressed="${active}" ${allowed ? "" : "disabled"}`)
    ).join("") + legacyTag;
    const items = shot.points.items.map(item => [item.title,item.detail,item.tag].filter(Boolean).join("｜")).join("\n");
    const layoutFields = (isQaLayout
      ? text("提问（≤30 字）", "point-question", shot.points.question, 30) +
        text("结论（≤16 字）", "point-answer", shot.points.answer, 16) +
        select("结论语气", "point-verdictTone", [["", "默认（正确 ✓）"], ["ok", "正确 / 推荐（✓）"], ["no", "否定 / 禁止（✗）"], ["warn", "提醒 / 注意（!）"]], shot.points.verdictTone || "")
      : "") +
      (isHeadlineLayout
        ? text("强调短语（须在标题中，≤8 字）", "point-accentPhrase", shot.points.accentPhrase, 8) +
          text("一句解释（≤30 字）", "point-lead", shot.points.lead, 30)
        : "");
    const itemsLabel = (isMotionKind || items.includes("｜"))
      ? "要点（每行一条，可用「｜」分隔说明和标签）"
      : "要点（每行一条）";
    const pointContentFields =
      (showHeadline ? text(isHeadlineLayout ? "大标题" : "屏显要点标题", "point-headline", shot.points.headline) : "") +
      layoutFields +
      (showTakeaway ? text(isTakeawayLayout ? "记住这一句" : "画面结语", "point-takeaway", shot.points.takeaway) : "") +
      (showItems ? `<label class="field">${itemsLabel}<textarea data-stage-field="point-items" rows="3">${esc(items)}</textarea></label>` : "");
    const pointEmptyHint = pointContentFields
      ? ""
      : `<p class="small">${kind === "image"
          ? "当前为 AI 完整图，如需调整画面内容请前往「画面」面板；字幕断句可直接在口播框换行。"
          : "当前画面未叠加文字要点，如需调整画面请前往「画面」面板；字幕断句可直接在口播框换行。"}</p>`;
    const decision = shot.content.reason || shot.content.adjusted || shot.content.mgRequest || shot.content.clipSuggestion || shot.presentationStale ? '<div class="stage-decision">' +
      (shot.content.reason ? `<p>${esc(shot.content.reason)}</p>` : "") +
      (shot.content.adjusted ? `<p class="small stage-adjusted">${esc(shot.content.adjusted)}</p>` : "") +
      (shot.content.clipSuggestion && shot.content.kind !== "clip"
        ? `<p class="small">建议用 AI 视频：${esc(shot.content.clipSuggestion)}</p>` +
          `<div class="asset-inline">${btn("改用 AI 演示视频", "stage-use-clip-suggestion", "outline", "demo")}${btn("改用 AI MG 动画", "stage-use-clip-suggestion", "outline", "mg")}</div>`
        : "") +
      (shot.content.kind === "mg" && shot.content.mgRequest ? `<p class="small">MG 草稿建议：${esc(shot.content.mgRequest)}</p>` : "") +
      '<p class="small" id="stage-stale"' + (shot.presentationStale ? "" : " hidden") + '>口播或要点已更新，可重做画面。</p>' +
      '</div>' : "";

    const panels = {
      visual: '<span class="label">本幕制作方式</span><div class="chips">' + kindButtons + '</div>' +
        productionButtons(w, shot, shot.content, slotDesc) + decision +
        '<div id="stage-mg-panel" hidden></div>' +
        contentFields(w, shot, slotDesc) +
        (index ? select("幕间转场", "transition", Object.entries(config.stageCatalog.transitions || {fade:"淡入"}), shot.content.transition || "fade") : ""),
      points: text("本幕标题", "name", shot.name) +
        '<div class="tpl-two-col">' + text("预览时长（秒）", "seconds", shot.seconds, 4) +
        select("所属章节", "chapterIndex", w.stagePlan.chapters.map((name,i) => [String(i), name]), String(shot.chapterIndex)) + '</div>' +
        pointContentFields +
        pointEmptyHint +
        '<div class="asset-inline">' + btn("本幕前移", "stage-move", "outline", "-1", index === 0 ? "disabled" : "") +
        btn("本幕后移", "stage-move", "outline", 1, index === shots.length - 1 ? "disabled" : "") +
        btn("删除本幕", "stage-remove", "textbtn danger", "", shots.length === 1 ? "disabled" : "") + '</div>',
      template: [
        layoutControls(w),
        themeControls(w),
        modeControls(w),
        select("全片字体", "font", [["", "默认"], ["builtin:font/noto-sans-sc", "Noto Sans SC"]], w.settings.fontId),
      ].join(""),
      presenter: TemplateStudio.templateSetupHtml(w, data, esc, btn, { hideTheme: true }),
      music: renderMusicStudioCard(w, { showModeChips: true }),
      meta: [
        text("作品标题", "work-title", w.title, 40),
        text("标题短句", "work-shortTitle", w.stagePlan.shortTitle, 20),
        text("关联药品", "work-drug", w.drug, 20),
        text("药品标签（最多 2 个，逗号分隔，每个 ≤6 字）", "work-drugTags", (w.stagePlan.drugTags || []).join("，"), 20),
        ...w.stagePlan.chapters.map((name, i) => text(`章节 ${i + 1}`, "work-chapter:" + i, name, 10)),
        text("底部参考声明", "work-disclaimer", w.stagePlan.disclaimer, 60),
      ].join(""),
    };

    const lineText = formatLineByCues(shot);
    const lineRows = Math.max(3, Math.min(7, lineText.split("\n").length + 1));
    const lineChars = shot.line.trim().length;
    const hasCachedSpeech = Boolean(shot.speech && shot.speech.line === shot.line.trim() && shot.speech.voice === w.settings.voice);
    const voiceList = typeof voiceOptions !== "undefined"
      ? voiceOptions.map(item => Array.isArray(item) ? item : [item, item])
      : [[w.settings.voice || "无配音", w.settings.voice || "无配音"]];
    const currentVoice = w.settings.voice || "无配音";
    const speechBtnHtml = `<button type="button" id="stage-speech-btn" class="stage-speech-btn${hasCachedSpeech ? " is-cached" : ""}" data-action="stage-speech" title="${currentVoice === "无配音" ? "当前为无配音，请先选择右侧音色" : "试听本幕配音并同步预览，合成时自动复用不重复计费"}">${PLAY_ICON}<span>试听口播</span>${hasCachedSpeech ? '<em class="stage-speech-tag">已缓存</em>' : ""}</button>`;

    const missingImages = shots.filter(s => s.content.kind === "image" && !s.content.image).length;
    const missingSvgs = missingSvgCodes(w).length;
    const missingCodes = missingSceneCodes(w).length;
    const actions = btn("提示词调试", "prompt-studio-open", "outline", shot.content.kind === "image" ? "stage-image" : ["svg", "scene"].includes(shot.content.kind) ? "stage-produce" : "stage-arrange") +
      btn("全片模型与配音", "work-settings", "outline") +
      (missingImages ? btn(`生成缺失配图（${missingImages} 张）`, "stage-images", "primary", "missing") : "") +
      (missingSvgs ? btn(`生成缺失 SVG 动画（${missingSvgs} 幕）`, "stage-svg-batch", missingImages ? "outline" : "primary") : "") +
      (missingCodes ? btn(`生成缺失代码动画（${missingCodes} 幕）`, "stage-scene-batch", (missingImages || missingSvgs) ? "outline" : "primary") : "") +
      btn("合成视频", "stage-compose", (missingImages || missingSvgs || missingCodes) ? "outline" : "primary");

    const strip = shots.map((s, i) => `<button type="button" class="scene-choice" data-action="stage-select" data-val="${i}" aria-pressed="${i === index}"${s.content.reason ? ` title="${esc(s.content.reason)}"` : ""}>
      <span class="scene-choice-head"><span class="scene-choice-num">${i + 1}</span><span class="scene-choice-title">${esc(s.name)}</span><span class="scene-dot is-${shotReadyState(s)}" title="${shotReadyState(s) === "ok" ? "画面就绪" : "待生成画面"}"></span></span>
      <span class="scene-choice-meta"><span class="stage-kind-badge">${kindLabel(s.content)}</span><span>${s.seconds} 秒</span></span></button>`).join("");

    const railBtn = m =>
      `<button type="button" class="stage-module-btn${activeModule === m.id ? " is-active" : ""}" data-action="stage-inspector" data-val="${m.id}" role="tab" aria-selected="${activeModule === m.id}" title="${esc(m.title)}">${moduleIcon(m.icon)}<span>${esc(m.label)}</span></button>`;
    const moduleRail = `<nav class="stage-module-rail" role="tablist" aria-orientation="vertical" aria-label="编辑模块">` +
      `<span class="stage-rail-group">本幕</span>` +
      STAGE_MODULES.filter(m => m.group === "shot").map(railBtn).join("") +
      `<span class="stage-rail-sep" aria-hidden="true"></span>` +
      `<span class="stage-rail-group">全片</span>` +
      STAGE_MODULES.filter(m => m.group === "global").map(railBtn).join("") +
      `</nav>`;

    const seekDefault = Math.min(1, shot.seconds / 2);
    shell(w, "编辑视频分镜", 1, `<div class="vstudio"><div class="sheet vstudio-bar"><div class="vstudio-summary">
      ${viewSwitchHtml(w, "studio")}
      <span class="vstudio-metric">共 ${shots.length} 幕 · ${Math.round(shots.reduce((n, s) => n + s.seconds, 0))} 秒</span></div><fieldset class="vstudio-actions stage-edit-fields" data-stage-production-lock>${actions}</fieldset></div>
      <div class="stage-studio-grid">
        <aside class="sheet stage-scenes-col" aria-label="分镜列表">
          <div class="stage-scenes-head"><strong>分镜</strong><span class="small">${shots.length} 幕</span></div>
          <div class="stage-rail">${strip}</div>
          <div class="stage-scenes-foot">${btn("+ 添加一幕", "stage-add", "outline", "", shots.length >= 12 ? "disabled" : "")}</div>
        </aside>
        <div class="stage-center-col">
          <section class="sheet vstudio-stage-card">
            <div class="vstudio-stage-head"><strong>第 ${index + 1} 幕 · ${esc(shot.name)}</strong>
            <span id="stage-preview-state" role="status">载入预览…</span></div>
            <iframe id="stage-preview" src="/stage.html" title="分镜预览"></iframe>
            <div id="stage-production-job" hidden></div>
            <div class="asset-inline stage-playbar"><button type="button" class="outline" id="stage-play" disabled>播放本幕</button>
            <input type="range" aria-label="本幕播放进度" min="0" max="${shot.seconds}" step="any" value="${seekDefault}" id="stage-seek">
            <span class="small stage-time" id="stage-time">${seekDefault.toFixed(1)} / ${Number(shot.seconds).toFixed(1)}s</span></div>
          </section>
          <section class="sheet stage-narration-card">
            <fieldset class="stage-edit-fields stage-narration-fieldset" data-stage-production-lock>
              <div class="stage-narration-bar">
                <div class="stage-narration-controls">
                  ${speechBtnHtml}
                  <select class="stage-voice-select" data-stage-field="work-voice" aria-label="配音音色">${opts(voiceList, currentVoice)}</select>
                </div>
                <span class="small stage-narration-stats" id="stage-narration-stats">${shot.cues.length} 句字幕 · ${shot.seconds} 秒</span>
              </div>
              <label class="sr-only" for="stage-line-input">本幕口播</label>
              <div class="stage-narration-editor" id="stage-narration-editor">
                <div class="stage-narration-backdrop" id="stage-line-backdrop" aria-hidden="true">${renderNarrationBackdropHtml(shot, lineText)}</div>
                <textarea id="stage-line-input" class="stage-narration-input" data-stage-field="line" maxlength="450" rows="${lineRows}" placeholder="按字幕顺序每行输入一句口播，换行即可调整字幕断句…">${esc(lineText)}</textarea>
                <div class="stage-hl-popover" id="stage-hl-popover" hidden>
                  <button type="button" class="stage-hl-pop-btn" id="stage-hl-pop-btn">${HIGHLIGHT_ICON}<span>标为高亮</span></button>
                </div>
              </div>
              <div class="stage-narration-highlights" id="stage-narration-highlights">${renderHighlightChipsHtml(shot)}</div>
              <div class="stage-narration-foot">
                <span class="small">按字幕顺序每行一句，换行即可调整字幕断句 · 选中文字可标为字幕高亮 · 试听配音合成时自动复用</span>
                <span class="small" id="stage-line-chars">${lineChars} / 450</span>
              </div>
            </fieldset>
          </section>
        </div>
        <aside class="sheet stage-inspector-shell">
          <div class="stage-inspector-panel">
            <div class="stage-panel-head">
              <strong>${esc(activeMeta.title)}</strong>
              <span class="stage-scope-pill${activeMeta.group === "global" ? " is-global" : ""}">${activeMeta.group === "shot" ? `第 ${index + 1} 幕` : "全片"}</span>
            </div>
            <div class="vstudio-inspector-body" role="tabpanel" data-inspector-key="${esc(w.id)}:${activeModule}:${activeMeta.group === "shot" ? index : ""}">
              <fieldset class="stage-fields stage-edit-fields" data-stage-production-lock>${panels[activeModule]}</fieldset>
            </div>
          </div>
          ${moduleRail}
        </aside>
      </div></div>`);
    bindPreview(w, index);
    bindNarrationHighlight(w, index);
    updateProductionJob(w);
    const panel = mgPanels.get(shot);
    const host = $("#stage-mg-panel");
    if (host && panel) {
      host.append(panel);
      host.hidden = false;
    }
  }

  function bindPreview(w, index) {
    const iframe = $("#stage-preview"), button = $("#stage-play"), seek = $("#stage-seek"), status = $("#stage-preview-state");
    const speechBtn = $("#stage-speech-btn"), timeEl = $("#stage-time");
    let frame, player, plan, audio, playing = false, playingSpeech = false;
    let run = 0;
    const setTime = offset => {
      if (timeEl) timeEl.textContent = `${Number(offset).toFixed(1)} / ${Number(seek.max || 0).toFixed(1)}s`;
    };
    const setSpeechButton = active => {
      if (!speechBtn) return;
      speechBtn.classList.toggle("is-playing", active);
      const cached = speechBtn.classList.contains("is-cached");
      speechBtn.innerHTML = active
        ? `${PAUSE_ICON}<span>暂停试听</span>`
        : `${PLAY_ICON}<span>试听口播</span>${cached ? '<em class="stage-speech-tag">已缓存</em>' : ""}`;
    };
    function pause() {
      run++;
      playing = false;
      playingSpeech = false;
      audio?.pause();
      cancelAnimationFrame(frame);
      if (button) button.textContent = "播放本幕";
      setSpeechButton(false);
    }
    function draw(offset) {
      const shot = plan.shots[index];
      player.drawFrame(Math.min(shot.end - .001, shot.start + offset));
      setTime(offset);
    }
    async function prepare(focusCueIndex) {
      const [layout, themeDef] = await Promise.all([
        getLayout(w.stagePlan.layout.id),
        w.stagePlan.themeId ? getTheme(w.stagePlan.themeId) : null,
      ]);
      if (!iframe.isConnected) return;
      player = iframe.contentWindow;
      plan = previewPlan(w, layout, themeDef);
      seek.max = String(w.stagePlan.shots[index].seconds);
      const clamped = Math.min(Number(seek.value) || 0, w.stagePlan.shots[index].seconds);
      seek.value = String(clamped);
      await player.setPlan(plan);
      draw(clamped);
      if (focusCueIndex !== undefined) iframe.seekToCue(focusCueIndex, false);
      status.textContent = "";
      button.disabled = false;
      if (pendingAutoPlay.get(w) === index && w.stagePlan.shots[index]?.speech) {
        pendingAutoPlay.delete(w);
        iframe.playSpeech(w.stagePlan.shots[index].speech);
      }
    }
    iframe.addEventListener("load", () => prepare().catch(error => {status.textContent = error.message;}), {once:true});
    iframe.isReady = () => Boolean(player);
    iframe.stopSpeech = () => { if (playingSpeech) pause(); };
    iframe.seekToCue = (cueIndex, force = false) => {
      if (!plan || !player) return;
      const currentShot = plan.shots[index];
      const caption = currentShot?.captions?.[cueIndex];
      if (!caption) return;
      if (playing && !force) return;
      if (force) pause();
      const curOffset = Number(seek.value) || 0;
      const localStart = Math.max(0, caption.start - currentShot.start);
      const localEnd = Math.max(localStart, caption.end - currentShot.start);
      if (!force && curOffset >= localStart && curOffset < localEnd) return;
      const target = Math.min(Number(seek.max) || localEnd, localStart + (localEnd - localStart) * 0.45);
      seek.value = String(target);
      draw(target);
    };
    iframe.refreshStage = focusCueIndex => { if (player) prepare(focusCueIndex).catch(error => {status.textContent = error.message;}); };
    iframe.playSpeech = async speech => {
      if (!player) return;
      pause();
      const ticket = run;
      audio = new Audio(speech.url);
      playing = true;
      playingSpeech = true;
      button.textContent = "暂停";
      setSpeechButton(true);
      const finishSpeech = () => {
        if (ticket !== run || !iframe.isConnected) return;
        const end = Number(seek.max) || 0;
        seek.value = String(end);
        draw(end);
        pause();
      };
      audio.addEventListener("ended", finishSpeech, { once: true });
      const tick = () => {
        if (!iframe.isConnected || !playing) return pause();
        if (audio.ended) return finishSpeech();
        const maxSec = Number(seek.max) || 0;
        const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(0.1, speech.seconds);
        const position = Math.min(maxSec, (audio.currentTime / Math.max(0.1, total)) * maxSec);
        seek.value = String(position);
        draw(position);
        frame = requestAnimationFrame(tick);
      };
      try {
        await audio.play();
        if (ticket !== run || !iframe.isConnected) return;
        tick();
      } catch (error) {
        pause();
        notify(error.message, "warn");
      }
    };
    iframe.toggleSpeech = speech => {
      if (playingSpeech) { pause(); return; }
      return iframe.playSpeech(speech);
    };
    seek.addEventListener("input", () => { pause(); if (player) draw(Number(seek.value)); });
    function play() {
      if (!player) return;
      if (playing) { pause(); return; }
      playing = true;
      run++;
      button.textContent = "暂停";
      const start = performance.now();
      function tick(now) {
        if (!iframe.isConnected) return pause();
        const time = Math.min(Number(seek.max), (now - start) / 1000);
        seek.value = String(time);
        draw(time);
        if (time < Number(seek.max)) frame = requestAnimationFrame(tick);
        else pause();
      }
      tick(start);
    }
    button.addEventListener("click", play);
  }

  function bindNarrationHighlight(w, index) {
    if (narrationCleanup) { narrationCleanup(); narrationCleanup = null; }
    const ta = $("#stage-line-input");
    const backdrop = $("#stage-line-backdrop");
    const editorBox = $("#stage-narration-editor");
    const popover = $("#stage-hl-popover");
    const popBtn = $("#stage-hl-pop-btn");
    if (!ta || !backdrop || !editorBox || !popover || !popBtn) return;

    const getShot = () => w.stagePlan?.shots?.[index];
    let currentSel = null;
    const controller = new AbortController();
    const { signal } = controller;

    const hidePopover = () => { popover.hidden = true; };

    const syncScroll = () => {
      backdrop.style.width = `${ta.clientWidth}px`;
      backdrop.style.height = `${ta.clientHeight}px`;
      backdrop.scrollTop = ta.scrollTop;
      backdrop.scrollLeft = ta.scrollLeft;
    };

    const refreshSelectionUi = (showPop = true) => {
      if (!ta.isConnected) return;
      const shot = getShot();
      if (!shot) return;
      const sel = inspectNarrationSelection(shot, ta.value, ta.selectionStart, ta.selectionEnd);
      currentSel = sel && !sel.invalid ? sel : null;
      if (currentSel) {
        const label = currentSel.isHighlighted ? "取消高亮" : "标为高亮";
        syncNarrationBackdrop(shot, currentSel.selStart, currentSel.selEnd);
        if (showPop && document.activeElement === ta) {
          popBtn.classList.toggle("is-remove", currentSel.isHighlighted);
          popBtn.innerHTML = `${HIGHLIGHT_ICON}<span>${label}</span>`;
          popover.hidden = false;
          const anchor = backdrop.querySelector("[data-hl-sel]");
          if (anchor) {
            const boxRect = editorBox.getBoundingClientRect();
            const selRect = anchor.getBoundingClientRect();
            if (selRect.bottom < boxRect.top || selRect.top > boxRect.bottom) {
              hidePopover();
            } else {
              const popRect = popover.getBoundingClientRect();
              const centerX = selRect.left - boxRect.left + selRect.width / 2;
              const left = Math.max(8, Math.min(boxRect.width - popRect.width - 8, centerX - popRect.width / 2));
              const topAbove = selRect.top - boxRect.top - popRect.height - 6;
              const topBelow = selRect.bottom - boxRect.top + 6;
              const top = topAbove >= -26 ? topAbove : topBelow;
              popover.style.left = `${Math.round(left)}px`;
              popover.style.top = `${Math.round(top)}px`;
            }
          } else {
            hidePopover();
          }
        } else {
          hidePopover();
        }
      } else {
        hidePopover();
        syncNarrationBackdrop(shot);
      }
    };

    const applyHighlight = () => {
      const shot = getShot();
      if (!shot) return;
      const sel = inspectNarrationSelection(shot, ta.value, ta.selectionStart, ta.selectionEnd) || currentSel;
      if (!sel || sel.invalid) return;
      if (!applyCueHighlightToggle(shot, sel)) return;
      const caret = sel.selEnd;
      ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch {}
      currentSel = null;
      syncNarrationHighlights(shot);
      refreshSelectionUi(false);
      touch(w, true);
      $("#stage-preview")?.refreshStage?.(sel.cueIndex);
    };

    const keepSelection = e => { e.preventDefault(); };
    popBtn.addEventListener("mousedown", keepSelection, { signal });
    popBtn.addEventListener("click", applyHighlight, { signal });

    ta.addEventListener("scroll", () => {
      syncScroll();
      if (currentSel && !popover.hidden) refreshSelectionUi(true);
    }, { signal });
    ta.addEventListener("mouseup", () => requestAnimationFrame(() => refreshSelectionUi(true)), { signal });
    ta.addEventListener("select", () => refreshSelectionUi(true), { signal });
    ta.addEventListener("keyup", e => {
      if (e.key === "Escape") { hidePopover(); return; }
      refreshSelectionUi(true);
    }, { signal });
    ta.addEventListener("keydown", e => {
      if ((e.altKey && (e.key === "h" || e.key === "H")) || ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "h" || e.key === "H"))) {
        const shot = getShot();
        const sel = inspectNarrationSelection(shot, ta.value, ta.selectionStart, ta.selectionEnd);
        if (sel && !sel.invalid) {
          e.preventDefault();
          applyHighlight();
        }
      }
    }, { signal });
    ta.addEventListener("blur", () => {
      hidePopover();
      const shot = getShot();
      if (shot) syncNarrationBackdrop(shot);
    }, { signal });
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === ta) refreshSelectionUi(true);
    }, { signal });

    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(syncScroll);
      ro.observe(ta);
    }
    syncScroll();

    narrationCleanup = () => {
      controller.abort();
      ro?.disconnect();
    };
  }

  function syncVoiceUi(w) {
    if (!isActive(w)) return;
    const shots = w.stagePlan.shots;
    const index = Math.min(selected.get(w) || 0, shots.length - 1);
    const shot = shots[index];
    const voice = w.settings.voice || "无配音";
    stopReviewAudio();
    $("#stage-preview")?.stopSpeech?.();
    app.querySelectorAll('[data-stage-field="work-voice"]').forEach(sel => {
      if (sel.value !== voice) sel.value = voice;
    });
    const speechBtn = $("#stage-speech-btn");
    if (speechBtn && shot) {
      const hasCached = Boolean(shot.speech && shot.speech.line === shot.line.trim() && shot.speech.voice === voice);
      speechBtn.classList.toggle("is-cached", hasCached);
      speechBtn.classList.remove("is-playing");
      speechBtn.title = voice === "无配音"
        ? "当前为无配音，请先选择右侧音色"
        : "试听本幕配音并同步预览，合成时自动复用不重复计费";
      speechBtn.innerHTML = `${PLAY_ICON}<span>试听口播</span>${hasCached ? '<em class="stage-speech-tag">已缓存</em>' : ""}`;
    }
    app.querySelectorAll('[data-action="stage-review-speech"]').forEach(btnEl => {
      const idx = Number(btnEl.dataset.val);
      const row = shots[idx];
      if (!row) return;
      const hasCached = Boolean(row.speech && row.speech.line === row.line.trim() && row.speech.voice === voice);
      btnEl.classList.toggle("is-cached", hasCached);
      btnEl.classList.remove("is-playing");
      btnEl.title = voice === "无配音"
        ? "当前为无配音，请在上方选择音色"
        : "试听本幕口播，合成视频时自动复用不重复计费";
      btnEl.innerHTML = `${PLAY_ICON}<span>试听口播</span>${hasCached ? '<em class="stage-speech-tag">已缓存</em>' : ""}`;
    });
  }

  function finishSpeechUi(w, index) {
    if (!isActive(w) || current() !== w) return false;
    const shots = w.stagePlan.shots;
    const shot = shots[index];
    if (!shot) return false;
    if (currentView(w) === "review") {
      const area = $("#stage-production-job");
      if (area) { area.innerHTML = ""; area.hidden = true; }
      app.querySelectorAll("[data-review-job]").forEach(el => { el.innerHTML = ""; el.hidden = true; });
      app.querySelectorAll('[data-stage-production-lock]').forEach(control => { control.disabled = false; });
      const secEl = app.querySelector(`[data-review-sec="${index}"]`);
      if (secEl) secEl.textContent = `约 ${Math.round(shot.seconds)} 秒`;
      refreshReviewSummaryDom(w);
      syncVoiceUi(w);
      if (pendingAutoPlay.get(w) === index) {
        pendingAutoPlay.delete(w);
        playReviewSpeech(w, index);
      }
      return true;
    }
    const iframe = $("#stage-preview");
    if (!iframe?.isReady?.() || (selected.get(w) || 0) !== index) return false;
    const area = $("#stage-production-job");
    if (area) { area.innerHTML = ""; area.hidden = true; }
    app.querySelectorAll('[data-stage-production-lock], .stage-rail button').forEach(control => { control.disabled = false; });
    const metric = $(".vstudio-metric");
    if (metric) metric.textContent = `共 ${shots.length} 幕 · ${Math.round(shots.reduce((n, s) => n + s.seconds, 0))} 秒`;
    const railSec = app.querySelector(`.stage-rail [data-action="stage-select"][data-val="${index}"] .stage-kind-badge + span`);
    if (railSec) railSec.textContent = `${shot.seconds} 秒`;
    const stats = $("#stage-narration-stats");
    if (stats) stats.textContent = `${shot.cues.length} 句字幕 · ${shot.seconds} 秒`;
    const secInput = $('[data-stage-field="seconds"]');
    if (secInput) secInput.value = String(shot.seconds);
    syncVoiceUi(w);
    iframe.refreshStage?.();
    return true;
  }

  function handleInput(w, el) {
    const field = el.dataset.stageField;
    if (!isActive(w) || !field) return false;
    const [key, rawIndex] = field.split(":");
    const value = el.value;
    if (key === "work-autoCompose") {
      w.stagePlan.autoComposeAfterBatch = Boolean(el.checked);
      touch(w);
      refreshReviewSummaryDom(w);
      return true;
    }
    if (key.startsWith("review-")) {
      const idx = Number(rawIndex);
      const row = w.stagePlan.shots[idx];
      if (!row) return true;
      const sub = key.slice(7);
      let marksStale = false;
      if (sub === "line") {
        row.line = value;
        row.cues = authoredCues(value, row.points.highlightWords, row.cues);
        delete row.speech;
        if (reviewPlayingWork === w && reviewPlayingIndex === idx) stopReviewAudio();
        el.rows = Math.max(3, Math.min(8, value.split("\n").length + 1));
        const stats = app.querySelector(`[data-review-stats="${idx}"]`);
        if (stats) stats.textContent = `${row.cues.length} 句 · ${value.trim().length} 字`;
        const speechBtn = app.querySelector(`[data-action="stage-review-speech"][data-val="${idx}"]`);
        if (speechBtn) {
          speechBtn.classList.remove("is-cached", "is-playing");
          speechBtn.innerHTML = `${PLAY_ICON}<span>试听口播</span>`;
        }
        marksStale = true;
      } else if (sub === "name") {
        row.name = value;
        const tabName = app.querySelector(`[data-review-tab-name="${idx}"]`);
        if (tabName) tabName.textContent = value.trim() || "未命名";
        marksStale = true;
      } else if (sub === "chapter") {
        row.chapterIndex = Number(value);
      } else if (sub === "imagePrompt") {
        row.content.imagePrompt = value;
        row.variants[row.content.kind] = row.content;
        marksStale = true;
      } else if (sub === "codePrompt") {
        row.content.codePrompt = value;
        row.variants[row.content.kind] = row.content;
        marksStale = true;
      } else if (sub === "clipPrompt") {
        row.content.clipPrompt = value;
        row.variants[`clip:${row.content.clipStyle || "demo"}`] = row.content;
        marksStale = true;
      } else if (sub === "items") {
        row.points.items = value.split("\n").filter(Boolean).slice(0, 4).map(r => {
          const [title, detail = "", tag = ""] = r.split("｜");
          return { title, detail, tag };
        });
        for (const f of ["points", "steps", "warnings", "columns", "checks"]) delete row.points[f];
        marksStale = true;
      } else if (["takeaway", "headline", "accentPhrase", "lead", "question", "answer", "verdictTone"].includes(sub)) {
        row.points[sub] = value;
        marksStale = true;
      }
      if (marksStale && shotReadyState(row) === "ok") {
        row.presentationStale = true;
        const stEl = app.querySelector(`[data-review-status="${idx}"]`);
        if (stEl) {
          stEl.className = "stage-review-status is-stale";
          stEl.textContent = "内容已改 · 建议重画";
        }
        const dotEl = app.querySelector(`[data-review-tab-dot="${idx}"]`);
        if (dotEl) dotEl.className = "stage-review-tab-dot is-stale";
        const genBtn = app.querySelector(`[data-review-gen-btn="${idx}"]`);
        if (genBtn) {
          genBtn.classList.remove("outline");
          genBtn.classList.add("primary");
          genBtn.textContent = reviewSingleActionLabel(row);
        }
      }
      touch(w, true);
      refreshReviewSummaryDom(w);
      return true;
    }
    const shot = w.stagePlan.shots[selected.get(w) || 0];
    if (key === "work-voice") {
      w.settings.voice = value;
      touch(w);
      syncVoiceUi(w);
      return true;
    }
    if (key === "work-title") w.title = value;
    else if (key === "work-drug") w.drug = value.slice(0, 20);
    else if (key === "work-drugTags") {
      const tags = value.split(/[，,、\s]+/).map(t => t.trim().slice(0, 6)).filter(Boolean).slice(0, 2);
      if (tags.length) w.stagePlan.drugTags = tags;
      else delete w.stagePlan.drugTags;
    }
    else if (key === "work-chapter") w.stagePlan.chapters[Number(rawIndex)] = value;
    else if (key.startsWith("work-")) w.stagePlan[key.slice(5)] = value;
    else if (key === "font") {
      if (value) w.settings.fontId = value;
      else delete w.settings.fontId;
    } else if (key === "line") {
      shot.line = value;
      shot.cues = authoredCues(value, shot.points.highlightWords, shot.cues);
      delete shot.speech;
      el.rows = Math.max(3, Math.min(7, value.split("\n").length + 1));
      const stats = $("#stage-narration-stats");
      if (stats) stats.textContent = `${shot.cues.length} 句字幕 · ${shot.seconds} 秒`;
      const chars = $("#stage-line-chars");
      if (chars) chars.textContent = `${value.trim().length} / 450`;
      const speechBtn = $("#stage-speech-btn");
      if (speechBtn) {
        speechBtn.classList.remove("is-cached", "is-playing");
        speechBtn.innerHTML = `${PLAY_ICON}<span>试听口播</span>`;
      }
      syncNarrationHighlights(shot);
      const pop = $("#stage-hl-popover");
      if (pop) pop.hidden = true;
    } else if (key === "name") shot.name = value;
    else if (key === "seconds") {
      if (Number(value) >= 2 && Number(value) <= 60) {
        shot.seconds = Number(value);
        const stats = $("#stage-narration-stats");
        if (stats) stats.textContent = `${shot.cues.length} 句字幕 · ${shot.seconds} 秒`;
      }
    } else if (key === "chapterIndex") shot.chapterIndex = Number(value);
    else if (key === "point-items") {
      shot.points.items = value.split("\n").filter(Boolean).slice(0, 4).map(row => {
        const [title,detail="",tag=""] = row.split("｜");
        return {title,detail,tag};
      });
      for (const field of ["points","steps","warnings","columns","checks"]) delete shot.points[field];
    } else if (key === "form") {
      if (!value) {
        delete shot.content.form;
        delete shot.content.formData;
        delete shot.content.variant;
      } else {
        shot.content.form = value;
        shot.content.variant = shot.content.variant || "solid";
        shot.content.formData = window.InfoForms ? InfoForms.fromPoints(value, shot) : {};
      }
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
      render(true);
      return true;
    } else if (key === "formData" && rawIndex) {
      shot.content.formData ||= {};
      const oldVal = shot.content.formData[rawIndex];
      shot.content.formData[rawIndex] = typeof oldVal === "number" ? (Number(value) || oldVal) : value;
      shot.variants[shot.content.kind] = shot.content;
    } else if (key === "clipSeconds") {
      const n = Math.round(Number(value));
      if (n >= 4 && n <= 30) shot.content.clipSeconds = n;
    } else if (key === "clipModel" || key === "clipResolution") {
      shot.content[key] = value;
      touch(w);
      render(true);
      return true;
    } else if (key === "customFullImagePrompt") {
      const idx = selected.get(w) || 0;
      const autoVal = renderImagePromptForShot(w, idx, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      if (value.trim() && value.trim() !== autoVal.trim()) shot.content.customFullImagePrompt = value;
      else delete shot.content.customFullImagePrompt;
      const hasCustom = Boolean(shot.content.customFullImagePrompt);
      const badge = $("#stage-shot-image-prompt-badge");
      if (badge) { badge.textContent = hasCustom ? "已手改" : "自动拼装"; badge.className = "prompt-badge " + (hasCustom ? "is-custom" : "is-default"); }
      const resetBtn = app.querySelector('[data-action="stage-reset-shot-prompt"][data-val="image"]');
      if (resetBtn) resetBtn.disabled = !hasCustom;
    } else if (key === "shotPrompt") {
      const isSvg = shot.content.kind === "svg";
      const autoVal = isSvg
        ? renderSvgPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true })
        : renderCodePromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      const fieldName = isSvg ? "customSvgPrompt" : "customCodePrompt";
      if (value.trim() && value.trim() !== autoVal.trim()) shot.content[fieldName] = value;
      else delete shot.content[fieldName];
      const hasCustom = Boolean(shot.content[fieldName]);
      const badge = $("#stage-shot-prompt-badge");
      if (badge) { badge.textContent = hasCustom ? "已手改" : "自动拼装"; badge.className = "prompt-badge " + (hasCustom ? "is-custom" : "is-default"); }
      const resetBtn = app.querySelector('[data-action="stage-reset-shot-prompt"][data-val="shot"]');
      if (resetBtn) resetBtn.disabled = !hasCustom;
    } else if (key === "svgCode" && rawIndex && ["svg", "css", "js"].includes(rawIndex)) {
      shot.content.svgCode = { svg: "", css: "", js: "", ...(shot.content.svgCode || {}), [rawIndex]: value };
      shot.variants[shot.content.kind] = shot.content;
    } else if (key === "code" && rawIndex && ["html", "css", "js"].includes(rawIndex)) {
      shot.content.code = { html: "", css: "", js: "", ...(shot.content.code || {}), [rawIndex]: value };
      shot.variants[shot.content.kind] = shot.content;
    } else if (key === "customArtPrompt") {
      const autoVal = renderArtPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      if (value.trim() && value.trim() !== autoVal.trim()) shot.content.customArtPrompt = value;
      else delete shot.content.customArtPrompt;
      const hasCustom = Boolean(shot.content.customArtPrompt);
      const badge = $("#stage-shot-art-prompt-badge");
      if (badge) { badge.textContent = hasCustom ? "已手改" : "自动拼装"; badge.className = "prompt-badge " + (hasCustom ? "is-custom" : "is-default"); }
      const resetBtn = app.querySelector('[data-action="stage-reset-shot-prompt"][data-val="art"]');
      if (resetBtn) resetBtn.disabled = !hasCustom;
    } else if (key.startsWith("point-")) shot.points[key.slice(6)] = value;
    else if (key.startsWith("beat-")) shot.content.beats[Number(rawIndex)][key.slice(5)] = value;
    else shot.content[key] = value;
    if (key === "imagePrompt" || key === "name" || key.startsWith("point-")) {
      const imgTa = $("#stage-shot-image-full-prompt");
      if (imgTa && !shot.content.customFullImagePrompt) {
        imgTa.value = renderImagePromptForShot(w, selected.get(w) || 0, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      }
    }
    if (key === "name" || key === "line" || key.startsWith("point-")) {
      const shotTa = $("#stage-shot-prompt");
      if (shotTa) {
        const isSvg = shot.content.kind === "svg";
        const hasCustom = Boolean(isSvg ? shot.content.customSvgPrompt : shot.content.customCodePrompt);
        if (!hasCustom) {
          shotTa.value = isSvg
            ? renderSvgPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true })
            : renderCodePromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
        }
      }
    }
    if (key === "artPrompt" || key === "name" || key === "line" || key.startsWith("point-")) {
      const artTa = $("#stage-shot-art-full-prompt");
      if (artTa && !shot.content.customArtPrompt) {
        artTa.value = renderArtPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w), { ignoreOverride: true });
      }
    }
    if (shot && (["line","name"].includes(key) || key.startsWith("point-"))) {
      shot.presentationStale = true;
      const stale = $("#stage-stale");
      if (stale) stale.hidden = false;
    }
    touch(w, key !== "font");
    $("#stage-preview")?.refreshStage?.();
    return true;
  }

  function startImagesJob(w, indices, { mode, layout, themeDef, settings, jobId }) {
    const items = indices.map((index, i) => ({
      prompt: renderImagePromptForShot(w, index, layout, themeDef),
      variant: i + 1,
    }));
    const job = createJob(w, "stage-images", items, settings, jobId);
    delete job.payload.storyboard;
    Object.assign(job.payload, { template: true, styleReference: false });
    job.stageImageSlots = indices;
    if (mode === "one") job.stageShotIndex = indices[0];
    w.job = job;
    return sendJob(w);
  }

  async function prepareImages(w, mode) {
    const p = w.stagePlan;
    const indices = mode === "one" ? [selected.get(w) || 0] : p.shots.flatMap((shot,i) => shot.content.kind === "image" && !shot.content.image ? [i] : []);
    if (!indices.length || w.job || indices.some(i => p.shots[i].content.kind !== "image")) return;
    if (!checkShotText(w, indices)) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, slot.w, slot.h);
    const settings = { ...w.settings, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
    const authSettings = { ...settings, sizeLabel: `${slot.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, indices.length, "images", () =>
      startImagesJob(w, indices, { mode, layout, themeDef, settings }));
  }

  async function prepareArt(w, mode) {
    const p = w.stagePlan;
    const indices = mode === "one" ? [selected.get(w) || 0] : missingArt(w);
    if (!indices.length || w.job || indices.some(i => !artKinds.has(p.shots[i].content.kind))) return;
    if (!checkShotText(w, indices)) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const art = slot.art;
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, art.w, art.h);
    const settings = { ...w.settings, ratio: art.arkRatio, targetSize: { w: art.w, h: art.h } };
    const authSettings = { ...settings, sizeLabel: `${art.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, indices.length, "images", () => {
      const items = indices.map((index,i) => ({prompt:renderArtPromptForShot(w, p.shots[index], layout, themeDef), variant:i + 1}));
      const job = createJob(w, "stage-images", items, settings);
      delete job.payload.storyboard;
      Object.assign(job.payload, {template:true, styleReference:false});
      job.stageImageSlots = indices;
      job.stageArt = true;
      if (mode === "one") job.stageShotIndex = indices[0];
      w.job = job;
      return sendJob(w);
    });
  }

  function clipFirstFramePrompt(w, shot, style, layout, themeDef) {
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const desc = shot.content.clipPrompt?.trim() || `表现「${shot.name}」：${shot.line.slice(0, 100)}`;
    const prefix = style === "mg"
      ? "风格：扁平 2D 医学科普动态图形首帧，几何构图清晰、柔和干净纯色背景、矢量质感。"
      : "风格：柔和自然光线的写实/半写实生活场景首帧，主体清晰居中，适合接续生成短视频演示。";
    return [
      `用途：用药科普短视频第 ${slot.ratioLabel}（${slot.w}×${slot.h}）内容区的 AI 视频首帧。`,
      `画面内容：${desc}`,
      prefix,
      w.drug && `涉及药品：${w.drug}（通用外观，不画品牌名与商标）。`,
      "禁止：画面不出现任何文字、数字、品牌 Logo、水印或医生正面肖像。",
    ].filter(Boolean).join("\n").slice(0, 1800);
  }

  async function prepareClipFrame(w) {
    const index = selected.get(w) || 0;
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || w.job) return;
    if (!checkShotText(w, [index])) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, slot.w, slot.h);
    const settings = { ...w.settings, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
    const authSettings = { ...settings, sizeLabel: `${slot.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, 1, "images", () => {
      const items = [{ prompt: clipFirstFramePrompt(w, shot, shot.content.clipStyle || "demo", layout, themeDef), variant: 1 }];
      const job = createJob(w, "stage-images", items, settings);
      delete job.payload.storyboard;
      Object.assign(job.payload, { template: true, styleReference: false });
      job.stageImageSlots = [index];
      job.stageClipFrame = true;
      job.stageShotIndex = index;
      w.job = job;
      return sendJob(w);
    });
  }

  async function prepareClipVideo(w) {
    const index = selected.get(w) || 0;
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || w.job) return;
    const c = shot.content;
    if (!c.clipPrompt?.trim()) return notify("请先填写或 AI 生成视频描述。", "warn");
    if (!c.clipFirstFrame) return notify("请先生成或从素材库选择首帧图片。", "warn");
    if (!config.keyPresent) return openApiKeys("ark");
    const layout = await resolveWorkLayout(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const models = Object.keys(config.videoModels || {});
    const modelId = c.clipModel && config.videoModels?.[c.clipModel] ? c.clipModel : (w.settings.videoModel || models[0] || "doubao-seedance-2-5-flash-261115");
    const modelSpec = config.videoModels?.[modelId] || ["Seedance", ["480p", "720p"], 15];
    const resList = modelSpec[1] || ["480p", "720p"];
    const resolution = resList.includes(c.clipResolution) ? c.clipResolution : (resList.includes("720p") ? "720p" : resList[0]);
    const maxSec = modelSpec[2] || 15;
    const seconds = Math.max(4, Math.min(maxSec, Math.round(c.clipSeconds || Math.ceil(shot.seconds || 5))));
    const dims = clipDimensions(resolution, slot);
    const est = clipEstimate(modelId, resolution, seconds, dims, false, w);
    const costLine = est.totalYuan !== null
      ? `预计 <strong>¥${est.totalYuan.toFixed(2)}</strong>，按方舟实际用量结算`
      : "按方舟实际用量结算";
    retryPayload = () => {
      const settings = { ...w.settings, videoModel: modelId, resolution, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
      const job = createJob(w, "stage-clip", [], settings);
      delete job.payload.storyboard;
      job.payload.clip = {
        shotIndex: index,
        clipStyle: c.clipStyle || "demo",
        prompt: c.clipPrompt.trim(),
        image: c.clipFirstFrame,
        seconds,
      };
      job.stageClipShot = index;
      job.stageShotIndex = index;
      w.job = job;
      return sendJob(w);
    };
    openModal("确认生成 AI 视频片段",
      `<p>将调用 <strong>${esc(modelSpec[0])}</strong>（${esc(resolution)} · ${seconds} 秒 · ${dims[0]}×${dims[1]}）为第 ${index + 1} 幕生成视频。</p>` +
      `<p>${costLine}。</p>` +
      `<div class="actions dialog-actions">${btn("取消", "close", "secondary")}${btn("确认提交并计费", "confirm-paid", "primary")}</div>`, "confirm");
  }

  function installClip(w, index, output, job) {
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || !output?.clip) return;
    Object.assign(shot.content, {
      clip: output.clip,
      clipPoster: output.clipPoster || shot.content.clipPoster || "",
      clipModel: output.clipModel || shot.content.clipModel,
      clipResolution: output.clipResolution || shot.content.clipResolution,
      clipSeconds: output.clipSeconds || shot.content.clipSeconds,
      clipDuration: output.clipDuration || output.clipSeconds || shot.seconds,
      clipCost: output.clipCost ?? shot.content.clipCost,
    });
    shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
    touch(w, true);
    if (current() === w) notify(`第 ${index + 1} 幕 AI 视频已生成`, "ok");
  }

  function installImages(w, indices, output, job) {
    const art = Boolean(job?.stageArt);
    const clipFrame = Boolean(job?.stageClipFrame);
    const targetSize = job?.payload?.settings?.targetSize;
    indices.forEach((index,i) => {
      const shot = w.stagePlan.shots[index];
      if (clipFrame && shot?.content.kind === "clip" && output.images[i]) {
        shot.content.clipFirstFrame = output.images[i];
        shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
        return;
      }
      const fits = art ? artKinds.has(shot?.content.kind) : shot?.content.kind === "image";
      if (fits && output.images[i]) {
        if (art) {
          shot.content.art = output.images[i];
          if (targetSize) shot.content.artMediaSize = { w: targetSize.w, h: targetSize.h };
          delete shot.content.artName;
        } else {
          shot.content.image = output.images[i];
          if (targetSize) shot.content.imageMediaSize = { w: targetSize.w, h: targetSize.h };
          delete shot.presentationStale;
        }
        shot.variants[shot.content.kind] = shot.content;
      }
    });
    touch(w);
  }

  function submitPromptBatchNow(w, kind, indices) {
    const isSvg = kind === "svg";
    const producePromptMeta = typeof resolveExtraPromptForSubmit === "function"
      ? resolveExtraPromptForSubmit(w, "stage-produce") : null;
    const layout = currentLayoutDef(w);
    const themeDef = currentThemeDef(w);
    const batch = indices.map(idx => {
      const s = w.stagePlan.shots[idx];
      const prompt = isSvg
        ? renderSvgPromptForShot(w, s, layout, themeDef)
        : renderCodePromptForShot(w, s, layout, themeDef);
      return {
        index: idx,
        shot: shotScript(s),
        prompt,
        ...(isSvg && s.content.customSvgPrompt?.trim() ? { customSvgPrompt: s.content.customSvgPrompt.trim() } : {}),
        ...(!isSvg && s.content.customCodePrompt?.trim() ? { customCodePrompt: s.content.customCodePrompt.trim() } : {}),
      };
    });
    return submitDraft(w, {
      presentation: kind,
      ...(isSvg ? { produceSvgBatch: batch } : { produceSceneBatch: batch }),
      ...(producePromptMeta?.customPrompt ? { produceShotPrompt: producePromptMeta.customPrompt } : {}),
    }, isSvg ? "svg-batch" : "scene-batch");
  }

  function startComposeJob(w) {
    const p = w.stagePlan;
    const appearance = deck(w);
    const avatarMode = w.videoMode === "svg" ? "static"
      : w.videoMode === "code-motion" ? codeMotionAvatarMode(w) : resolveAvatarMode(w.settings.avatarMode);
    const avatar = w.settings.voice !== "无配音" && appearance.presenter !== "none" && avatarMode !== "static"
      ? {enabled:true,model:avatarMode,resolution:w.settings.avatarResolution || "480P",presenter:appearance.presenter,image:TemplateVideo.resolveAvatarSrc(appearance)} : null;
    const items = p.shots.map(({variants,speech,sfxId,sfxName,stickers,...shot}) => ({...shot, tailPause:shot.cues.some(cue => cue.focus === "outro") ? 1.15 : 0.55}));
    const job = createJob(w,"compose",items,{...w.settings,...videoMusicSettings(w),ratio:"16:9"});
    delete job.payload.storyboard;
    delete job.payload.codeMotion;
    delete job.payload.svg;
    delete job.payload.svgLayout;
    Object.assign(job.payload,{stage:true,layoutId:p.layout.id,title:w.title,shortTitle:p.shortTitle || undefined,
      ...(w.drug?.trim() ? {drug:w.drug.trim().slice(0, 20)} : {}),
      ...(p.drugTags?.length ? {drugTags:p.drugTags.slice(0, 2)} : {}),
      disclaimer:p.disclaimer,chapters:p.chapters,appearance:{theme:appearance.theme,presenter:appearance.presenter,pharmacist:appearance.pharmacist,
        ...(p.themeId ? {themeId:p.themeId} : {})},
      compatibility:p.compatibility,audio:{sfx:{pack:"off",stickerSfx:false}},...(avatar ? {avatar} : {}),...(w.video?.url ? {previousVideo:w.video.url} : {})});
    // Drop optional absent values before saving so the replay payload is byte-stable.
    job.payload = JSON.parse(JSON.stringify(job.payload));
    w.job = job;
    return sendJob(w);
  }

  function runNextBatchStep(w) {
    const queue = batchQueues.get(w);
    if (!queue || !queue.steps.length) {
      batchQueues.delete(w);
      return false;
    }
    const step = queue.steps.shift();
    if (step.type === "images") {
      startImagesJob(w, step.indices, { mode: "missing", layout: step.layout, themeDef: step.themeDef, settings: step.settings });
      return true;
    }
    if (step.type === "svg" || step.type === "scene") {
      submitPromptBatchNow(w, step.type, step.indices);
      return true;
    }
    if (step.type === "compose") {
      startComposeJob(w);
      return true;
    }
    batchQueues.delete(w);
    return false;
  }

  function onJobFinished(w, job) {
    if (!isActive(w)) return false;
    const queue = batchQueues.get(w);
    if (!queue) return false;
    if (job.target === "compose") {
      batchQueues.delete(w);
      w.stagePlan.editorView = "studio";
      save();
      return false;
    }
    queue.doneSteps += 1;
    if (queue.steps.length > 0) {
      return runNextBatchStep(w);
    }
    const focusIndex = queue.firstShotIndex ?? 0;
    const switchToStudio = queue.switchToStudio !== false;
    const totalShots = queue.totalShots || 0;
    batchQueues.delete(w);
    if (switchToStudio) {
      w.stagePlan.editorView = "studio";
      selected.set(w, Math.min(focusIndex, Math.max(0, w.stagePlan.shots.length - 1)));
      save();
      if (current() === w) {
        notify(`已生成 ${totalShots} 幕画面，请快速核对各幕效果后合成视频`, "ok");
      }
    }
    return false;
  }

  async function prepareBatchAll(w, mode = "all") {
    if (w.job) return;
    const plan = collectBatchPlan(w, { includeStale: true });
    if (!plan.totalBatchShots) {
      if (plan.missingClips.length) {
        w.stagePlan.editorView = "studio";
        selected.set(w, plan.missingClips[0]);
        render(true);
        notify(`第 ${plan.missingClips[0] + 1} 幕为 AI 视频片段，请在精修页单独确认并生成。`, "warn");
      }
      return;
    }
    const targetIndices = [...new Set([...plan.image, ...plan.svg, ...plan.scene])].sort((a, b) => a - b);
    if (!checkShotText(w, targetIndices)) return;
    if (plan.image.length && !config.keyPresent) return openApiKeys("ark");
    if ((plan.svg.length || plan.scene.length) && !config.deepseekKeyPresent) return openApiKeys("deepseek");
    const allowAuto = canAutoCompose(w, plan);
    const willAutoCompose = Boolean(w.stagePlan.autoComposeAfterBatch && allowAuto);
    if (willAutoCompose && w.settings.voice !== "无配音" && !config.speechKeyPresent && !w.video) {
      return openApiKeys("speech");
    }

    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, slot.w, slot.h);
    const imgSettings = { ...w.settings, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };

    const lines = [];
    if (plan.image.length) {
      const rate = Number(config.imageRates?.[w.settings.imageModel]?.[w.settings.imageSize] || 0);
      const est = rate > 0 ? `，预计约 <strong>¥${(rate * plan.image.length).toFixed(2)}</strong>` : "";
      const modelLabel = config.imageModels?.[w.settings.imageModel]?.[0] || w.settings.imageModel;
      lines.push(`<li><strong>AI 完整图（${plan.image.length} 张）</strong>：${esc(modelLabel)} · ${esc(w.settings.imageSize)}（${esc(slot.ratioLabel)} · ${esc(pxSize)}）${est}</li>`);
    }
    if (plan.svg.length) {
      lines.push(`<li><strong>SVG 动画（${plan.svg.length} 幕）</strong>：调用 DeepSeek 生成纯矢量动画，按实际 Token 计费</li>`);
    }
    if (plan.scene.length) {
      lines.push(`<li><strong>代码动效（${plan.scene.length} 幕）</strong>：调用 DeepSeek 生成纯代码动效，按实际 Token 计费</li>`);
    }
    if (willAutoCompose) {
      const voice = w.settings.voice || "无配音";
      if (voice !== "无配音") {
        const uncachedChars = w.stagePlan.shots.reduce((sum, s) => {
          const cached = s.speech && s.speech.line === s.line.trim() && s.speech.voice === voice;
          return sum + (cached ? 0 : s.line.trim().length);
        }, 0);
        const estVoice = uncachedChars > 0 ? `约 ${uncachedChars} 字待配音，预计约 ¥${(uncachedChars * 0.0003).toFixed(2)}` : "全部配音已缓存，直接复用";
        lines.push(`<li><strong>自动合成 MP4</strong>：${esc(voiceLabel(voice))}（${estVoice}）+ 本地 1280×720 渲染（0 画面费用）</li>`);
      } else {
        lines.push(`<li><strong>自动合成 MP4</strong>：无配音，本地 1280×720 渲染，无额外费用</li>`);
      }
    }

    const clipHint = plan.missingClips.length
      ? `<p class="small">第 ${plan.missingClips.map(i => i + 1).join("、")} 幕为 AI 视频片段，不参与本次一键批量生成，稍后可在逐幕精修页单独生成。</p>`
      : "";
    const nextHint = willAutoCompose
      ? `<p class="small">全部完成后将直接进入成品草稿页供您审片。</p>`
      : `<p class="small">全部画面生成完成后，将自动进入「逐幕精修」页供您快速核对画面与合成视频。</p>`;

    const steps = [];
    if (plan.image.length) steps.push({ type: "images", indices: plan.image, layout, themeDef, settings: imgSettings });
    if (plan.svg.length) steps.push({ type: "svg", indices: plan.svg });
    if (plan.scene.length) steps.push({ type: "scene", indices: plan.scene });
    if (willAutoCompose) steps.push({ type: "compose" });

    retryPayload = () => {
      stopReviewAudio();
      batchQueues.set(w, {
        totalSteps: steps.length,
        doneSteps: 0,
        steps: [...steps],
        switchToStudio: !willAutoCompose,
        firstShotIndex: targetIndices[0] ?? 0,
        totalShots: plan.totalBatchShots,
      });
      runNextBatchStep(w);
    };

    const modalTitle = mode === "stale"
      ? `确认重新生成已修改画面（${plan.totalBatchShots} 幕）`
      : willAutoCompose
        ? `确认生成全部画面并合成视频（${plan.totalBatchShots} 幕）`
        : `确认生成全部画面（${plan.totalBatchShots} 幕）`;

    openModal(modalTitle,
      `<p>将按您确认后的脚本与分镜内容，依次执行以下生成任务：</p>` +
      `<ul class="stage-batch-list">${lines.join("")}</ul>` +
      clipHint + nextHint +
      `<div class="actions dialog-actions">${btn("取消", "close", "secondary")}${btn(willAutoCompose ? "确认生成并合成" : "确认生成并计费", "confirm-paid", "primary")}</div>`,
      "confirm");
  }

  function prepareReviewShotGenerate(w, index) {
    if (w.job) return;
    const shot = w.stagePlan.shots[index];
    if (!shot) return;
    const kind = shot.content.kind;
    if (kind === "image") {
      selected.set(w, index);
      return prepareImages(w, "one");
    }
    if (kind === "svg" || kind === "scene") {
      if (!config.stageShotProduction || !checkShotText(w, [index])) return;
      if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
      const isSvg = kind === "svg";
      const label = isSvg ? "SVG 动画" : "代码动效";
      const revisionCount = (shot.content._revCount || 0) + 1;
      const previousParams = isSvg
        ? (shot.content.svgCode ? { svgCode: shot.content.svgCode } : {})
        : (shot.content.code ? { code: shot.content.code } : {});
      selected.set(w, index);
      retryPayload = () => {
        const producePromptMeta = typeof resolveExtraPromptForSubmit === "function"
          ? resolveExtraPromptForSubmit(w, "stage-produce") : null;
        const shotPrompt = isSvg
          ? renderSvgPromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w))
          : renderCodePromptForShot(w, shot, currentLayoutDef(w), currentThemeDef(w));
        return submitDraft(w, {
          presentation: kind,
          produceShot: {
            shot: shotScript(shot),
            previousParams,
            revisionCount,
            revision: "",
            prompt: shotPrompt,
            ...(isSvg && shot.content.customSvgPrompt?.trim() ? { customSvgPrompt: shot.content.customSvgPrompt.trim() } : {}),
            ...(!isSvg && shot.content.customCodePrompt?.trim() ? { customCodePrompt: shot.content.customCodePrompt.trim() } : {}),
          },
          ...(producePromptMeta?.customPrompt ? { produceShotPrompt: producePromptMeta.customPrompt } : {}),
        }, "produce", index);
      };
      const idea = shot.content.codePrompt?.trim();
      openModal(`生成第 ${index + 1} 幕${label}`,
        `<p>将按第 ${index + 1} 幕「${esc(shot.name || "未命名")}」的口播、要点与画面构想，调用 DeepSeek 生成${isSvg ? "纯矢量 SVG 动画" : "纯代码动效"}。</p>` +
        (idea ? `<p class="small">画面构想：${esc(idea)}</p>` : "") +
        `<p class="small">仅生成本幕（提交 1 次文本请求，按 Token 计费），完成后留在当前审稿页。</p>` +
        `<div class="actions dialog-actions">${btn("取消", "close", "secondary")}${btn("确认生成并计费", "confirm-paid", "primary")}</div>`,
        "confirm");
      return;
    }
    if (kind === "clip") {
      stopReviewAudio();
      selected.set(w, index);
      w.stagePlan.editorView = "studio";
      changed(w);
      render(false);
    }
  }

  function prepareSpeech(w, index) {
    if (w.job) return;
    const shot = w.stagePlan.shots[index];
    if (!shot) return;
    if (w.settings.voice === "无配音") {
      notify("当前已设为「无配音」，请先选择配音音色。", "warn");
      $('[data-stage-field="work-voice"]')?.focus();
      return;
    }
    const line = shot.line.trim();
    const cached = shot.speech;
    if (cached?.line === line && cached.voice === w.settings.voice) {
      if (currentView(w) === "review") return playReviewSpeech(w, index);
      return $("#stage-preview")?.toggleSpeech?.(cached);
    }
    if (!line || line.length > 450) {
      notify("逐幕试听口播须为 1–450 字。", "warn");
      (currentView(w) === "review" ? $(`[data-stage-field="review-line:${index}"]`) : $("#stage-line-input"))?.focus();
      return;
    }
    if (!config.speechKeyPresent) return openApiKeys("speech");
    const job = createJob(w, "svg-speech", [{ line, index }]);
    delete job.payload.storyboard;
    job.payload.stage = true;
    job.payload.workId = w.id;
    job.stageSpeechIndex = index;
    w.job = job;
    return sendJob(w);
  }

  function installSpeech(w, index, job, output) {
    const shot = w.stagePlan.shots[index];
    if (shot?.line.trim() === job.payload.items[0].line) {
      shot.speech = { ...output, line: shot.line.trim(), voice: job.payload.settings.voice };
      if (Number(output.seconds) > 0) {
        shot.seconds = Math.max(2, Math.min(60, Number((Number(output.seconds) + 0.55).toFixed(2))));
      }
      pendingAutoPlay.set(w, index);
      syncBlocks(w);
    }
  }

  async function compose(w) {
    if (w.job) return;
    if (!config.codeMotionReady) return notify("合成需要 Node.js、Playwright、Chrome 和 FFmpeg。", "warn");
    const p = w.stagePlan;
    if (!checkShotText(w, p.shots.map((_, index) => index))) return;
    const missing = p.shots.findIndex(({content}) => content.kind === "image" ? !content.image
      : content.kind === "clip" ? !content.clip
      : ["asset","mg"].includes(content.kind) && !content.assetId);
    if (missing !== -1) {
      const {name, content:{kind}} = p.shots[missing];
      const label = `第 ${missing + 1} 幕「${name.trim()}」`;
      return showShotIssue(w, missing, `${label}缺少${kind === "image" ? "配图" : kind === "clip" ? "AI 视频片段" : "素材"}，请补齐或切换制作方式。`,
        kind === "image" ? '[data-action="stage-images"][data-val="one"]'
        : kind === "clip" ? '[data-action="stage-clip-generate"]'
        : `[data-action="stage-choose"][data-val="${kind}"]`);
    }
    const appearance = deck(w);
    const avatarMode = w.videoMode === "svg" ? "static"
      : w.videoMode === "code-motion" ? codeMotionAvatarMode(w) : resolveAvatarMode(w.settings.avatarMode);
    const avatar = w.settings.voice !== "无配音" && appearance.presenter !== "none" && avatarMode !== "static"
      ? {enabled:true,model:avatarMode,resolution:w.settings.avatarResolution || "480P",presenter:appearance.presenter,image:TemplateVideo.resolveAvatarSrc(appearance)} : null;
    const send = () => startComposeJob(w);
    if (w.settings.voice !== "无配音" || avatar) {
      if (!config.speechKeyPresent && !w.video) return openApiKeys("speech");
      if (avatar && !config.dashscopeKeyPresent && !w.video) return openApiKeys("dashscope");
      return authorizeSpeechOnly(w,p.shots.length,send,{usesAvatar:Boolean(avatar),avatarModel:avatar?.model,reuseSpeech:Boolean(w.video)});
    }
    retryPayload = send;
    const pictures = p.shots.filter(shot => shot.content.kind === "image").length;
    openModal("确认合成视频", `<p>${pictures ? `复用 ${pictures} 张已有配图。` : ""}本地渲染，无模型画面费用。</p><div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认合成 MP4","confirm-paid","primary")}</div>`, "confirm");
  }

  function handleAction(w, action, value) {
    if (!isActive(w) || !action.startsWith("stage-")) return false;
    const p = w.stagePlan;
    const index = selected.get(w) || 0;
    const shot = p.shots[index];
    if (action === "stage-view") {
      const next = value === "review" ? "review" : "studio";
      if (currentView(w) === next) return true;
      stopReviewAudio();
      p.editorView = next;
      changed(w);
      render(false);
      return true;
    }
    if (action === "stage-goto-module") {
      stopReviewAudio();
      p.editorView = "studio";
      inspector.set(w, normalizeModule(value));
      changed(w);
      render(false);
      return true;
    }
    if (action === "stage-batch-all") {
      prepareBatchAll(w, value || "all");
      return true;
    }
    if (action === "stage-review-filter") {
      const next = value === "all" ? "all" : Math.max(0, Math.min(p.shots.length - 1, Number(value) || 0));
      if (getReviewFilter(w) === next) return true;
      reviewFilter.set(w, next);
      if (typeof next === "number") selected.set(w, next);
      render(true);
      return true;
    }
    if (action === "stage-review-generate") {
      const targetIdx = Math.max(0, Math.min(p.shots.length - 1, Number(value) || 0));
      prepareReviewShotGenerate(w, targetIdx);
      return true;
    }
    if (action === "stage-review-choose") {
      const targetIdx = Math.max(0, Math.min(p.shots.length - 1, Number(value) || 0));
      const targetShot = p.shots[targetIdx];
      if (!targetShot || targetShot.content.kind !== "image") return true;
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.pick(["image"], item => {
        targetShot.content.image = item.url;
        delete targetShot.content.imageMediaSize;
        delete targetShot.presentationStale;
        targetShot.variants.image = targetShot.content;
        touch(w, true);
        render(true);
      }, { topic: w.topic, style: w.templateTheme || "medical", ratio: slot.ratioLabel });
      return true;
    }
    if (action === "stage-review-zoom") {
      const targetIdx = Math.max(0, Math.min(p.shots.length - 1, Number(value) || 0));
      const targetShot = p.shots[targetIdx];
      if (!targetShot?.content?.image) return true;
      openModal(`第 ${targetIdx + 1} 幕 · ${targetShot.name || "AI 完整图"}`,
        `<div class="stage-review-zoom-box"><img src="${esc(targetShot.content.image)}" alt="第 ${targetIdx + 1} 幕配图大图"></div>` +
        `<div class="actions dialog-actions">${btn("精修此幕", "stage-review-open", "outline", String(targetIdx))}${btn("关闭", "close", "primary")}</div>`,
        "info");
      return true;
    }
    if (action === "stage-review-open") {
      const targetIdx = Math.max(0, Math.min(p.shots.length - 1, Number(value) || 0));
      if (dialog?.open) dialog.close();
      stopReviewAudio();
      selected.set(w, targetIdx);
      p.editorView = "studio";
      changed(w);
      render(false);
      return true;
    }
    if (action === "stage-review-kind") {
      const parts = String(value || "").split(":");
      const targetIdx = Number(parts[0]);
      const rawKind = parts[1];
      const clipStyle = parts[2];
      const targetShot = p.shots[targetIdx];
      if (!targetShot || !Object.hasOwn(kinds, rawKind)) return true;
      const same = targetShot.content.kind === rawKind && (rawKind !== "clip" || (targetShot.content.clipStyle || "demo") === (clipStyle || "demo"));
      if (same) return true;
      const prevIdea = targetShot.content.imagePrompt || targetShot.content.codePrompt || targetShot.content.clipPrompt || "";
      selectKind(w, targetShot, rawKind, clipStyle);
      if (rawKind === "image" && !targetShot.content.imagePrompt && prevIdea) targetShot.content.imagePrompt = prevIdea.slice(0, 400);
      else if ((rawKind === "svg" || rawKind === "scene") && !targetShot.content.codePrompt && prevIdea) targetShot.content.codePrompt = prevIdea.slice(0, 600);
      else if (rawKind === "clip" && !targetShot.content.clipPrompt && prevIdea) targetShot.content.clipPrompt = prevIdea.slice(0, 400);
      if (targetShot.content.decidedBy !== "user") delete targetShot.content.reason;
      delete targetShot.content.adjusted;
      targetShot.content.decidedBy = "user";
      delete targetShot.presentationStale;
      touch(w, true);
      render(true);
      return true;
    }
    if (action === "stage-review-move") {
      const [rawIdx, rawDelta] = String(value || "").split(":");
      const from = Number(rawIdx);
      const to = from + Number(rawDelta);
      if (from >= 0 && from < p.shots.length && to >= 0 && to < p.shots.length) {
        stopReviewAudio();
        const curFilter = getReviewFilter(w);
        p.shots.splice(to, 0, p.shots.splice(from, 1)[0]);
        if (curFilter === from) reviewFilter.set(w, to);
        else if (curFilter === to) reviewFilter.set(w, from);
        selected.set(w, to);
        touch(w, true);
        render(true);
      }
      return true;
    }
    if (action === "stage-review-remove" && p.shots.length > 1) {
      const targetIdx = Number(value);
      if (targetIdx >= 0 && targetIdx < p.shots.length) {
        stopReviewAudio();
        const curFilter = getReviewFilter(w);
        p.shots.splice(targetIdx, 1);
        if (typeof curFilter === "number") {
          if (curFilter === targetIdx) reviewFilter.set(w, Math.min(targetIdx, p.shots.length - 1));
          else if (curFilter > targetIdx) reviewFilter.set(w, curFilter - 1);
        }
        selected.set(w, Math.min(selected.get(w) || 0, p.shots.length - 1));
        touch(w, true);
        render(true);
      }
      return true;
    }
    if (action === "stage-review-speech") {
      const targetIdx = Number(value);
      if (targetIdx >= 0 && targetIdx < p.shots.length) prepareSpeech(w, targetIdx);
      return true;
    }
    if (action === "stage-manage-layouts") { StudioAssets.manageLayouts(); return true; }
    if (action === "stage-manage-themes") { StudioAssets.manageThemes(); return true; }
    if (action === "stage-theme") {
      const theme = activeThemes().find(item => item.id === value);
      if (!theme || value === themeIdFor(w)) return true;
      p.themeId = value;
      w.templateTheme = theme.base === "warm" ? "warm" : "medical";
      touch(w, true);
    }
    else if (action === "stage-layout") {
      const layout = activeLayouts().find(item => item.id === value);
      if (!layout || value === p.layout.id) return true;
      if (layout.supports && p.shots.some(row => !layout.supports.includes(row.content.kind))) {
        notify("所选布局缺少本片使用的制作方式。","warn");
        return true;
      }
      if (!allowsMode(layout, p.mode)) {
        const allowed = draftModes.find(([kind]) => allowsMode(layout,kind));
        if (!allowed) { notify("所选布局不支持脚本制作方式。","warn"); return true; }
        p.mode = allowed[0];
      }
      p.layout.id = value;
      touch(w, true);
    }
    else if (action === "stage-mode" && fixedKinds.includes(value) && p.mode !== value) {
      p.mode = value;
      p.shots.forEach(shot => {
        selectKind(w, shot, value);
        for (const key of ["decidedBy","reason","adjusted"]) delete shot.content[key];
      });
      touch(w, true);
    } else if (action === "stage-inspector") inspector.set(w, normalizeModule(value));
    else if (action === "stage-select") { selected.set(w, Number(value)); }
    else if (action === "stage-produce" && shot) { produceShot(w, shot, index); return true; }
    else if (action === "stage-svg-batch") { preparePromptBatch(w, "svg"); return true; }
    else if (action === "stage-scene-batch") { preparePromptBatch(w, "scene"); return true; }
    else if (action === "stage-create-mg" && shot && (shot.content.kind === "mg" || shot.content.mgRequest)) {
      if (!config.deepseekKeyPresent) { openApiKeys("deepseek"); return true; }
      const existing = mgPanels.get(shot);
      if (existing) { existing.querySelector("textarea, video")?.focus(); return true; }
      const host = $("#stage-mg-panel");
      if (!host) return true;
      const panel = document.createElement("section");
      panel.className = "stage-mg-production";
      mgPanels.set(shot, panel);
      host.append(panel);
      host.hidden = false;
      const content = shot.content;
      const description = content.mgRequest || (shot.line.trim()
        ? `根据这段口播制作无字动画，按口播顺序展示动作：${shot.line.trim().slice(0,160)}` : "");
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.generateMG({
        description, workId: w.id, theme: w.templateTheme || "medical", panel,
        mediaSize: { w: slot.w, h: slot.h }, ratioLabel: slot.ratioLabel,
        onClose:() => {
          mgPanels.delete(shot);
          if (panel.parentElement) panel.parentElement.hidden = true;
          panel.replaceChildren();
          panel.remove();
        },
        onAdopt:item => {
          if (!w.stagePlan.shots.includes(shot) || shot.content !== content) return;
          selectKind(w,shot,"mg");
          Object.assign(shot.content,{assetId:item.id,assetName:item.name,decidedBy:"user"});
          delete shot.content.adjusted;
          delete shot.presentationStale;
          touch(w,true);
          if (current() === w) render(true);
        }});
      return true;
    }
    else if (action === "stage-kind" && shot) {
      const [rawKind, clipStyle] = String(value).split(":");
      if (!Object.hasOwn(kinds, rawKind)) return true;
      const same = shot.content.kind === rawKind && (rawKind !== "clip" || (shot.content.clipStyle || "demo") === (clipStyle || "demo"));
      if (same) return true;
      selectKind(w, shot, rawKind, clipStyle);
      if (shot.content.decidedBy !== "user") delete shot.content.reason;
      delete shot.content.adjusted;
      shot.content.decidedBy = "user";
      delete shot.presentationStale;
      touch(w,true);
    }
    else if (action === "stage-legacy-to-clip" && shot) {
      const seed = shot.content.mgRequest || shot.line.trim().slice(0, 160);
      const targetStyle = shot.content.kind === "mg" ? "mg" : "demo";
      selectKind(w, shot, "clip", targetStyle);
      if (!shot.content.clipPrompt && seed) shot.content.clipPrompt = seed;
      shot.content.decidedBy = "user";
      touch(w, true);
    }
    else if (action === "stage-use-clip-suggestion" && shot) {
      const sug = shot.content.clipSuggestion || shot.line.trim().slice(0, 160);
      selectKind(w, shot, "clip", value === "mg" ? "mg" : "demo");
      shot.content.clipPrompt = sug;
      shot.content.decidedBy = "user";
      touch(w, true);
    }
    else if (action === "stage-next-form" && shot && shot.content.kind === "card" && window.InfoForms) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      const curForm = shot.content.form || InfoForms.mapLegacyForm(shot.content, shot, slot);
      const nextForm = InfoForms.nextInRelation(curForm, slot);
      shot.content.form = nextForm;
      shot.content.variant = shot.content.variant || "solid";
      shot.content.formData = InfoForms.fromPoints(nextForm, shot);
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
    }
    else if (action === "stage-sync-form" && shot && shot.content.form && window.InfoForms) {
      shot.content.formData = InfoForms.fromPoints(shot.content.form, shot);
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
    }
    else if (action === "stage-clip-prompt" && shot) { requestClipPrompt(w, shot, index); return true; }
    else if (action === "stage-clip-frame" && shot) { prepareClipFrame(w); return true; }
    else if (action === "stage-clip-generate" && shot) { prepareClipVideo(w); return true; }
    else if (action === "stage-add" && p.shots.length < 12) {
      const nextKind = fixedKinds.includes(p.mode) ? p.mode : "image";
      const next = fromLegacy({name:`第 ${p.shots.length + 1} 幕`, line:"", seconds:5}, nextKind, p.shots.length);
      p.shots.push(next);
      const nextIdx = p.shots.length - 1;
      selected.set(w, nextIdx);
      touch(w,true);
      if (currentView(w) === "review") {
        if (getReviewFilter(w) !== "all") reviewFilter.set(w, nextIdx);
        render(true);
        const addedCard = app.querySelector(`[data-review-shot="${nextIdx}"]`);
        addedCard?.scrollIntoView({ block: "center", behavior: "smooth" });
        addedCard?.querySelector(`[data-stage-field="review-line:${nextIdx}"]`)?.focus();
        return true;
      }
    } else if (action === "stage-remove" && p.shots.length > 1) {
      p.shots.splice(index,1); selected.set(w,Math.min(index,p.shots.length-1)); touch(w,true);
    } else if (action === "stage-move") {
      const to = index+Number(value);
      if (to >= 0 && to < p.shots.length) {
        p.shots.splice(to,0,p.shots.splice(index,1)[0]); selected.set(w,to); touch(w,true);
      }
    } else if (action === "stage-choose" && shot) {
      const content = shot.content;
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      const hints = {
        topic: w.topic,
        style: w.templateTheme || "medical",
        ratio: value === "art-image" ? slot.art.ratioLabel : slot.ratioLabel,
      };
      const pickKinds = value === "clip-video" ? ["video"]
        : ["image", "art-image", "clip-frame"].includes(value) ? ["image"]
        : value === "mg" ? ["lottie","mg"] : ["image", "svg"];
      StudioAssets.pick(pickKinds, item => {
        if (value === "image") { content.image = item.url; delete content.imageMediaSize; }
        else if (value === "art-image") { content.art = item.url; content.artName = item.name; delete content.artMediaSize; }
        else if (value === "clip-frame") { content.clipFirstFrame = item.url; }
        else if (value === "clip-video") { content.clip = item.url; content.clipPoster = item.thumbnailUrl || ""; delete content.clipCost; }
        else if (value === "asset" || value === "mg") {
          content.assetId=item.id;
          content.assetName=item.name;
          delete content.adjusted;
        }
        else { content.libraryArtId=item.id; content.libraryArtName=item.name; }
        const vKey = content.kind === "clip" ? `clip:${content.clipStyle || "demo"}` : content.kind;
        shot.variants[vKey] = content;
        touch(w,true); render(true);
      }, hints);
      return true;
    } else if (action === "stage-clear" && shot) {
      for (const key of ({image:["image","imageMediaSize"],code:["code","reason"],"svg-code":["svgCode","reason"],asset:["assetId","assetName"],mg:["assetId","assetName"],art:["libraryArtId","libraryArtName"],"art-image":["art","artName","artMediaSize"],clip:["clip","clipPoster","clipDuration","clipCost"]}[value] || [])) delete shot.content[key];
      touch(w,true);
    } else if (action === "stage-collect" && value === "clip" && shot?.content.clip) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collectVideo(shot.content.clip, { name: shot.name, topic: w.topic, ratio: slot.ratioLabel, style: shot.content.clipStyle || "demo", model: shot.content.clipModel || "", prompt: shot.content.clipPrompt || "" });
      return true;
    } else if (action === "stage-collect" && value === "art" && shot?.content.art) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collect(shot.content.art,{name:shot.name,topic:w.topic,ratio:slot.art.ratioLabel,style:w.templateTheme || "medical",prompt:shot.content.artPrompt || ""});
      return true;
    } else if (action === "stage-collect" && shot?.content.image) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collect(shot.content.image,{name:shot.name,topic:w.topic,ratio:slot.ratioLabel,style:w.templateTheme || "medical",prompt:shot.content.imagePrompt || ""});
      return true;
    } else if (action === "stage-beat-add" && shot?.content.beats?.length < 3) {
      shot.content.beats.push({action:"log",label:"核对记录",line:shot.line.slice(-55) || "核对记录"}); touch(w,true);
    } else if (action === "stage-beat-remove" && shot?.content.beats?.length > 1) {
      shot.content.beats.splice(Number(value),1); touch(w,true);
    } else if (action === "stage-reset-shot-prompt" && shot) {
      if (value === "image") delete shot.content.customFullImagePrompt;
      else if (value === "shot") {
        if (shot.content.kind === "svg") delete shot.content.customSvgPrompt;
        else { delete shot.content.customCodePrompt; delete shot.content.codePrompt; }
      }
      else if (value === "code") delete shot.content.customCodePrompt;
      else if (value === "art") delete shot.content.customArtPrompt;
      touch(w);
      render(true);
      notify("已恢复本幕自动拼装提示词", "ok");
      return true;
    } else if (action === "stage-hl-remove" && shot) {
      const sep = String(value).indexOf(":");
      const cueIndex = Number(String(value).slice(0, sep));
      const word = decodeURIComponent(String(value).slice(sep + 1));
      const cue = shot.cues?.[cueIndex];
      if (cue && word) {
        const cueText = String(cue.text || "");
        const currentWords = [...new Set(effectiveCueHighlightWords(shot, cue).filter(w => cueText.includes(w)))];
        cue.highlightWords = currentWords.filter(w => w !== word);
        cue.highlightCustom = true;
        syncNarrationHighlights(shot);
        touch(w, true);
        $("#stage-preview")?.refreshStage?.(cueIndex);
      }
      return true;
    } else if (action === "stage-hl-clear" && shot) {
      for (const cue of shot.cues || []) {
        cue.highlightWords = [];
        cue.highlightCustom = true;
      }
      syncNarrationHighlights(shot);
      touch(w, true);
      $("#stage-preview")?.refreshStage?.();
      return true;
    } else if (action === "stage-hl-jump" && shot) {
      $("#stage-preview")?.seekToCue?.(Number(value), true);
      return true;
    } else if (action === "stage-images") { prepareImages(w,value); return true; }
    else if (action === "stage-art") { prepareArt(w,value); return true; }
    else if (action === "stage-speech") { prepareSpeech(w,index); return true; }
    else if (action === "stage-compose") { compose(w); return true; }
    render(true);
    return true;
  }

  return {applies,isActive,normalizeWork,initWork,setupControls,themeName,samplePlan,requestDraft,installDraft,installImages,installClip,installSpeech,syncVoiceUi,finishSpeechUi,editor,hasProductionJob,updateProductionJob,handleInput,handleAction,defaultImagePromptTemplate,defaultArtPromptTemplate,renderImagePromptForShot,renderArtPromptForShot,renderSvgPromptForShot,renderCodePromptForShot,currentProduceKind,onJobFinished,clearBatchQueue,formatJobProgress,stopReviewAudio};
})();
