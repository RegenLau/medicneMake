"use strict";

(function (global) {
  const root = document.querySelector("#stage-frame");
  function fit() {
    root.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`;
  }
  addEventListener("resize", fit);
  fit();

  let plan, deck, imgMap, mounted, content, lastSubtitle;

  async function setPlan(input) {
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
    lastSubtitle = null;
    if (input.fontId) {
      const fonts = await document.fonts.load('650 30px "Studio Noto Sans SC"', "用药");
      if (!fonts.length) throw Error("素材库字体未加载。");
    }
    await document.fonts.ready;
    await Promise.all(input.shots.map((shot,index) =>
      Contents[shot.kind].prepare?.(shot, {deck, theme:deck.theme, slide:deck.slides[index], index})));
  }

  const mapSrc = (url) => imgMap.get(url) || url || "";

  function locate(time) {
    const index = plan.shots.findIndex((shot) => time < shot.end);
    const current = index < 0 ? plan.shots.length - 1 : index;
    return current;
  }

  function dissolve(index, localTime) {
    return plan.compatibility || index === 0 ? 1 : Math.min(1, localTime / 0.3);
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

  function frameSignature(time) {
    const index = locate(time);
    const shot = plan.shots[index];
    const localTime = Math.max(0, time - shot.start);
    const cue = Contents.activeCue(shot, localTime);
    if (plan.hasAvatarFrames || deck.presenter !== "none" || plan.layout.regions.progress ||
        !Contents[shot.kind].isStatic?.(shot, localTime) || dissolve(index, localTime) !== 1 ||
        legacyImageFade(index, time, cue)) return null;
    return `${index}/${shot.captions.indexOf(cue)}`;
  }

  function drawFrame(time, avatarFrame) {
    const current = locate(time);
    const shot = plan.shots[current];
    const slide = deck.slides[current];
    const localTime = Math.max(0, time - shot.start);
    const cue = Contents.activeCue(shot, localTime);
    const focus = cue?.focus || "all";
    const renderer = Contents[shot.kind];
    const code = shot.kind === "card" || shot.kind === "scene";
    const layoutFocus = plan.previewStage === "outro" ? "outro" : code ? "all" : focus;
    const stage = plan.previewStage || (layoutFocus === "outro" && !slide.outroImage ? "outro"
      : slide.layoutMode === "hook" && !slide.contentImage ? "hook" : "explain");
    const progress = Math.max(0, Math.min(1, time / plan.shots.at(-1).end));
    const highlightWords = cue?.highlightWords?.length ? cue.highlightWords
      : code ? (shot.labels || shot.items?.map((item) => item.title) || []) : slide.highlightWords;
    const subtitle = cue?.text ?? slide.line;
    const context = {
      size: LayoutEngine.mediaSize(plan.layout, stage),
      theme: deck.theme,
      imageFocus: plan.imageFocus === true,
      focus, slide, imgMap, mapSrc, deck, index: current, total: plan.shots.length,
      layoutTitle: shot.kind === "svg" && !plan.compatibility,
    };
    const mountKey = `${current}/${stage}/${code ? "code" : progress}`;
    if (mounted !== mountKey) {
      root.innerHTML = LayoutEngine.render(plan.layout, deck, current, {
        focus: layoutFocus, stage, progress: code ? 1 : progress, imgMap,
        subtitleText: subtitle || (code ? " " : ""), highlightWords,
        contentTitle: context.layoutTitle ? slide.name : "",
        renderMedia: () => "",
      });
      const slot = root.querySelector(".media-slot");
      content = slot ? renderer.mount(slot, shot, context) : null;
      mounted = mountKey;
      lastSubtitle = null;
    }
    if (content) renderer.draw(content, shot, localTime, context);
    const slot = root.querySelector(".media-slot");
    if (slot && !plan.compatibility && current > 0) slot.style.opacity = String(dissolve(current, localTime));
    const fade = legacyImageFade(current, time, cue);
    if (fade) {
      const previous = LayoutEngine.render(plan.layout, deck, fade.index, {
        imgMap, progress, focus: fade.cue.focus || "all", subtitleText: fade.cue.text, highlightWords: fade.cue.highlightWords,
      });
      if (fade.alpha === 1) {
        root.innerHTML = previous;
        mounted = null;
      } else {
        const fill = deck.theme === "warm" ? "#fdf5e7" : "#edf6fe";
        root.insertAdjacentHTML("beforeend", `<div style="position:absolute;inset:0;opacity:${fade.alpha};background:${fill}">${previous}</div>`);
      }
    }
    const state = { avatarFrame, ...(code ? { progress } : {}) };
    if (code && lastSubtitle !== cue) {
      state.subtitle = subtitle;
      state.highlightWords = highlightWords;
      lastSubtitle = cue;
    }
    return LayoutEngine.update(root, state);
  }

  const eventPriority = {"warning": 6, "outro": 5, "check": 4, "scene-in": 3, "beat-in": 2, "item-focus": 1};

  function collectEvents() {
    const events = plan.shots.flatMap((shot, index) => {
      const slide = deck.slides[index];
      const local = [...Contents[shot.kind].events(shot, {slide, theme:deck.theme, index, total:deck.slides.length})];
      if (index > 0) local.push({t:0, type:"scene-in"});
      if (index === deck.slides.length - 1) {
        const outro = shot.captions.find(cue => cue.focus === "outro") || shot.captions.at(-1);
        local.push({t:outro ? outro.start - shot.start : 0, type:"outro"});
      }
      return local.filter(event => Number.isFinite(event.t) && event.t >= 0 && event.t < shot.end - shot.start)
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
    return selected.sort((a,b) => a.t - b.t);
  }

  global.setPlan = setPlan;
  global.drawFrame = drawFrame;
  global.frameSignature = frameSignature;
  global.collectStageEvents = collectEvents;
})(globalThis);
