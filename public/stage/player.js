"use strict";

(function (global) {
  const root = document.querySelector("#stage-frame");
  function fit() {
    root.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`;
  }
  addEventListener("resize", fit);
  fit();

  let plan, deck, imgMap, mounted, content, stickerDom, lastSubtitle, prevLayer;

  function clearPrevLayer() {
    prevLayer?.content?.dispose?.();
    if (prevLayer?.el?.parentNode) prevLayer.el.remove();
    prevLayer = null;
  }

  async function setPlan(input) {
    clearPrevLayer();
    content?.dispose?.();
    content = null;
    for (const shot of plan?.shots || []) Contents[shot.kind].dispose?.(shot);
    plan = input;
    deck = TemplateVideo.normalizeDeck(input.deck);
    deck.slides.forEach((slide, index) => {
      const shot = input.shots[index];
      if (shot.kind !== "svg") return;
      slide.highlightWords = [...new Set([
        ...(shot.beats || [shot]).flatMap(beat => [beat.label, ...(StageSvgContent.keywords[beat.action] || [])]),
        slide.name,
      ])].filter(word => word && slide.line.includes(word)).slice(0, 4);
    });
    imgMap = new Map(Object.entries(input.images || {}));
    root.classList.toggle("cm-library-font", input.fontId === "builtin:font/noto-sans-sc");
    mounted = null;
    stickerDom = null;
    lastSubtitle = null;
    if (input.fontId) {
      const fonts = await document.fonts.load('650 30px "Studio Noto Sans SC"', "用药");
      if (!fonts.length) throw Error("素材库字体未加载。");
    }
    await document.fonts.ready;
    if (deck.themeBackground) {
      const bgImg = new Image();
      bgImg.src = mapSrc(deck.themeBackground);
      await new Promise((resolve, reject) => {
        if (bgImg.complete && bgImg.naturalWidth) return resolve();
        bgImg.onload = () => resolve();
        bgImg.onerror = () => reject(Error("主题背景图未加载。"));
      });
      if (bgImg.decode) await bgImg.decode().catch(() => {});
    }
    await Promise.all(input.shots.map((shot,index) =>
      Contents[shot.kind].prepare?.(shot, {
        deck, theme: deck.theme, slide: deck.slides[index], index,
        mapSrc, layout: input.layout, size: LayoutEngine.mediaSize(input.layout, "explain"),
      })));
  }

  const mapSrc = (url) => imgMap.get(url) || url || "";

  function locate(time) {
    const index = plan.shots.findIndex((shot) => time < shot.end);
    const current = index < 0 ? plan.shots.length - 1 : index;
    return current;
  }

  function transitionProgress(index, localTime) {
    return plan.compatibility || index === 0 ? 1 : MgKit.progress(localTime, 0, .3);
  }

  function legacyImageFade(index, time, cue) {
    if (plan.compatibility !== "image" || !cue) return null;
    const shot = plan.shots[index];
    const cueIndex = shot.captions.indexOf(cue);
    const before = cueIndex > 0 ? shot.captions[cueIndex - 1] : plan.shots[index - 1]?.captions.at(-1);
    if (!before) return null;
    const fade = cueIndex === 0 ? 0.24 : cue.transition === "outro" ? 0.28 : cue.transition === "fade" ? 0.22 : 0;
    const duration = Math.min(fade, (cue.end - cue.start) * .35,
      cueIndex === 0 ? fade : (before.end - before.start) * .35);
    const phase = (time - cue.start) / duration;
    if (duration < .08 || phase >= 1) return null;
    return { index: cueIndex === 0 ? index - 1 : index, cue: before, alpha: 1 - Math.max(0, phase) };
  }

  function computeChapterProgress(time, current) {
    const chapIdx = Number(deck.slides[current]?.chapterIndex) || 0;
    let chapStart = plan.shots[current].start;
    let chapEnd = plan.shots[current].end;
    for (let i = current - 1; i >= 0; i -= 1) {
      if ((Number(deck.slides[i]?.chapterIndex) || 0) !== chapIdx) break;
      chapStart = plan.shots[i].start;
    }
    for (let i = current + 1; i < plan.shots.length; i += 1) {
      if ((Number(deck.slides[i]?.chapterIndex) || 0) !== chapIdx) break;
      chapEnd = plan.shots[i].end;
    }
    const dur = chapEnd - chapStart;
    return dur > 0 ? Math.max(0, Math.min(1, (time - chapStart) / dur)) : 0;
  }

  function frameSignature(time) {
    const index = locate(time);
    const shot = plan.shots[index];
    const localTime = Math.max(0, time - shot.start);
    const cue = Contents.activeCue(shot, localTime);
    const hasDynamicRegion = Boolean(
      plan.layout.regions.progress ||
      plan.layout.regions.chapters?.variant === "nav-panel" ||
      plan.layout.regions.header?.variant === "breadcrumb",
    );
    if (plan.hasAvatarFrames || deck.presenter !== "none" || hasDynamicRegion ||
        !Contents[shot.kind].isStatic?.(shot, localTime) || transitionProgress(index, localTime) !== 1 ||
        legacyImageFade(index, time, cue) || global.StageStickers?.isDynamic(shot, localTime)) return null;
    const stickerKey = global.StageStickers ? global.StageStickers.stateKey(shot, localTime) : "";
    return `${index}/${shot.captions.indexOf(cue)}/${stickerKey}`;
  }

  function drawFrame(time, avatarFrame) {
    const current = locate(time);
    const shot = plan.shots[current];
    const slide = deck.slides[current];
    const localTime = Math.max(0, time - shot.start);
    const cue = Contents.activeCue(shot, localTime);
    const focus = cue?.focus || "all";
    const renderer = Contents[shot.kind];
    const isPromptSvg = shot.kind === "svg" && Boolean(shot.svgCode && typeof shot.svgCode.svg === "string" && shot.svgCode.svg.trim());
    const code = shot.kind === "card" || shot.kind === "scene" || isPromptSvg;
    const keepMounted = code || shot.kind === "clip";
    const layoutFocus = plan.previewStage === "outro" ? "outro" : keepMounted ? "all" : focus;
    const cueFocus = plan.previewStage === "outro" ? "outro" : focus;
    const stage = plan.previewStage || (layoutFocus === "outro" && !slide.outroImage ? "outro"
      : slide.layoutMode === "hook" && !slide.contentImage ? "hook" : "explain");
    const totalDuration = Number(plan.shots.at(-1)?.end) || 0;
    const progress = totalDuration > 0 ? Math.max(0, Math.min(1, time / totalDuration)) : 0;
    const chapterProgress = computeChapterProgress(time, current);
    const hasCustomHighlight = Boolean(cue?.highlightCustom);
    const highlightWords = hasCustomHighlight
      ? (Array.isArray(cue.highlightWords) ? cue.highlightWords : [])
      : (cue?.highlightWords?.length ? cue.highlightWords
          : code ? (shot.labels || shot.items?.map((item) => item.title) || []) : slide.highlightWords);
    const subtitle = cue?.text ?? slide.line;
    const slotDesc = LayoutEngine.describeMediaSlot ? LayoutEngine.describeMediaSlot(plan.layout, stage) : null;
    const context = {
      size: LayoutEngine.mediaSize(plan.layout, stage),
      slotDesc,
      layout: plan.layout,
      stage,
      theme: deck.theme,
      compatibility: plan.compatibility,
      focus, slide, imgMap, mapSrc, deck, index: current, total: plan.shots.length,
      layoutTitle: shot.kind === "svg" && !isPromptSvg && !plan.compatibility,
    };
    const mountKey = `${current}/${stage}/${keepMounted ? "keep" : progress}`;
    if (mounted !== mountKey) {
      clearPrevLayer();
      content?.dispose?.();
      content = null;
      root.innerHTML = LayoutEngine.render(plan.layout, deck, current, {
        focus: layoutFocus, cueFocus, stage, progress: keepMounted ? 1 : progress,
        chapterProgress, currentTime: time, totalDuration: plan.hideClock ? 0 : totalDuration,
        imgMap,
        subtitleText: subtitle || (keepMounted ? " " : ""), highlightWords, highlightCustom: hasCustomHighlight,
        contentTitle: context.layoutTitle ? slide.name : "",
        renderMedia: () => "",
      });
      const slot = root.querySelector(".media-slot");
      content = slot ? renderer.mount(slot, shot, context) : null;
      stickerDom = slot && global.StageStickers ? global.StageStickers.mount(slot, shot, context) : null;
      mounted = mountKey;
      lastSubtitle = null;
    }
    if (content) renderer.draw(content, shot, localTime, context);
    if (stickerDom && global.StageStickers) global.StageStickers.draw(stickerDom, shot, localTime, context);
    const slot = root.querySelector(".media-slot");
    if (slot && !plan.compatibility && current > 0) {
      const p = transitionProgress(current, localTime);
      const transKind = shot.transition || "fade";
      if (p < 1 && plan.shots[current - 1]) {
        const prevIndex = current - 1;
        const prevShot = plan.shots[prevIndex];
        const prevSlide = deck.slides[prevIndex];
        if (!prevLayer || prevLayer.shotIndex !== prevIndex || !prevLayer.el.isConnected) {
          clearPrevLayer();
          const prevEl = slot.cloneNode(false);
          prevEl.classList.remove("media-slot");
          prevEl.classList.add("stage-prev-slot");
          prevEl.style.opacity = "";
          prevEl.style.transform = "";
          prevEl.style.clipPath = "";
          prevEl.style.filter = "";
          prevEl.style.pointerEvents = "none";
          if (getComputedStyle(slot).position !== "absolute") {
            prevEl.style.position = "absolute";
            prevEl.style.left = `${slot.offsetLeft}px`;
            prevEl.style.top = `${slot.offsetTop}px`;
            prevEl.style.width = `${slot.offsetWidth}px`;
            prevEl.style.height = `${slot.offsetHeight}px`;
          }
          const prevDur = Math.max(0, (Number(prevShot.end) || 0) - (Number(prevShot.start) || 0));
          const prevEndLocal = Math.max(0, prevDur - 0.001);
          const prevCue = Contents.activeCue(prevShot, prevEndLocal);
          const prevIsPromptSvg = prevShot.kind === "svg" && Boolean(prevShot.svgCode && typeof prevShot.svgCode.svg === "string" && prevShot.svgCode.svg.trim());
          const prevContext = {
            size: context.size,
            slotDesc: context.slotDesc,
            layout: plan.layout,
            stage,
            theme: deck.theme,
            compatibility: plan.compatibility,
            focus: prevCue?.focus || "all",
            slide: prevSlide,
            imgMap,
            mapSrc,
            deck,
            index: prevIndex,
            total: plan.shots.length,
            layoutTitle: prevShot.kind === "svg" && !prevIsPromptSvg && !plan.compatibility,
          };
          slot.parentNode?.insertBefore(prevEl, slot);
          const prevRenderer = Contents[prevShot.kind];
          const prevContent = prevRenderer ? prevRenderer.mount(prevEl, prevShot, prevContext) : null;
          if (prevContent) prevRenderer.draw(prevContent, prevShot, prevEndLocal, prevContext);
          const prevStickers = global.StageStickers ? global.StageStickers.mount(prevEl, prevShot, prevContext) : null;
          if (prevStickers && global.StageStickers) global.StageStickers.draw(prevStickers, prevShot, prevEndLocal, prevContext);
          prevLayer = { shotIndex: prevIndex, el: prevEl, content: prevContent };
        }
        MgKit.transitionOut?.(prevLayer.el, transKind, p);
      } else {
        clearPrevLayer();
      }
      MgKit.transition(slot, transKind, p);
    } else {
      clearPrevLayer();
    }
    const fade = legacyImageFade(current, time, cue);
    if (fade) {
      const previous = LayoutEngine.render(plan.layout, deck, fade.index, {
        imgMap, progress, focus: fade.cue.focus || "all", subtitleText: fade.cue.text,
        highlightWords: fade.cue.highlightWords, highlightCustom: Boolean(fade.cue.highlightCustom),
      });
      if (fade.alpha === 1) {
        root.innerHTML = previous;
        mounted = null;
        stickerDom = null;
      } else {
        const fallback = deck.theme === "warm" ? "#fdf5e7" : "#edf6fe";
        const candidate = deck.themeFadeColor || deck.themeVars?.["--v-bg"] || fallback;
        const fill = LayoutEngine.safeColor ? LayoutEngine.safeColor(candidate, fallback) : fallback;
        root.insertAdjacentHTML("beforeend", `<div style="position:absolute;inset:0;opacity:${fade.alpha};background:${fill}">${previous}</div>`);
      }
    }
    const state = {
      avatarFrame,
      ...(keepMounted ? { progress } : {}),
      chapterProgress: cueFocus === "outro" ? 1 : chapterProgress,
      currentTime: time,
      totalDuration: plan.hideClock ? 0 : totalDuration,
      keypointsFocus: cueFocus,
    };
    if (keepMounted && lastSubtitle !== cue) {
      state.subtitle = subtitle;
      state.highlightWords = highlightWords;
      lastSubtitle = cue;
    }
    return LayoutEngine.update(root, state);
  }

  const eventPriority = {
    "warning": 7, "outro": 6, "cross": 5, "check": 4, "count": 4,
    "flip": 3, "draw": 3, "scene-in": 3, "beat-in": 2, "item-focus": 1,
  };

  function collectEvents() {
    const stickerEvents = [];
    const events = plan.shots.flatMap((shot, index) => {
      const slide = deck.slides[index];
      const duration = shot.end - shot.start;
      const local = [...Contents[shot.kind].events(shot, {
        slide, theme: deck.theme, index, total: deck.slides.length, layout: plan.layout,
        size: LayoutEngine.mediaSize(plan.layout, "explain"),
        slotDesc: LayoutEngine.describeMediaSlot ? LayoutEngine.describeMediaSlot(plan.layout, "explain") : null,
      })];
      if (index > 0) local.push({t:0, type:"scene-in"});
      if (index === deck.slides.length - 1) {
        const outro = shot.captions.find(cue => cue.focus === "outro") || shot.captions.at(-1);
        local.push({t:outro ? outro.start - shot.start : 0, type:"outro"});
      }
      if (global.StageStickers) {
        for (const ev of global.StageStickers.events(shot)) {
          if (Number.isFinite(ev.t) && ev.t >= 0 && ev.t < duration) {
            stickerEvents.push({...ev, shot: index, t: shot.start + ev.t});
          }
        }
      }
      return local.filter(event => Number.isFinite(event.t) && event.t >= 0 && event.t < duration)
        .map(event => ({...event, shot:index, t:shot.start + event.t}));
    });
    const rank = (a,b) => (eventPriority[b.type] || 0) - (eventPriority[a.type] || 0) || a.t - b.t;
    const selected = [];
    const count = new Map();
    for (const event of events.sort(rank)) {
      if ((count.get(event.shot) || 0) >= 4 || selected.some(other => Math.abs(other.t - event.t) < .35 - 1e-9)) continue;
      selected.push(event);
      count.set(event.shot, (count.get(event.shot) || 0) + 1);
    }
    return [...selected, ...stickerEvents].sort((a,b) => a.t - b.t);
  }

  global.setPlan = setPlan;
  global.drawFrame = drawFrame;
  global.frameSignature = frameSignature;
  global.collectStageEvents = collectEvents;
})(globalThis);
