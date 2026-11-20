"use strict";

(function (global) {
  const root = document.querySelector("#stage-frame");
  function fit() {
    root.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`;
  }
  addEventListener("resize", fit);
  fit();

  let plan, deck, imgMap, mounted, content;

  async function setPlan(input) {
    plan = input;
    deck = TemplateVideo.normalizeDeck(input.deck);
    imgMap = new Map(Object.entries(input.images || {}));
    root.classList.toggle("cm-library-font", input.fontId === "builtin:font/noto-sans-sc");
    mounted = null;
    if (input.fontId) {
      const fonts = await document.fonts.load('650 30px "Studio Noto Sans SC"', "用药");
      if (!fonts.length) throw Error("素材库字体未加载。");
    }
    await document.fonts.ready;
  }

  const mapSrc = (url) => imgMap.get(url) || url || "";

  function drawFrame(time, avatarFrame) {
    const index = plan.shots.findIndex((shot) => time < shot.end);
    const current = index < 0 ? plan.shots.length - 1 : index;
    const shot = plan.shots[current];
    const slide = deck.slides[current];
    const localTime = Math.max(0, time - shot.start);
    const cue = Contents.activeCue(shot, localTime);
    const focus = cue?.focus || "all";
    const renderer = Contents[shot.kind];
    const code = shot.kind === "card" || shot.kind === "scene";
    const layoutFocus = code ? "all" : focus;
    const stage = layoutFocus === "outro" && !slide.outroImage ? "outro"
      : slide.layoutMode === "hook" && !slide.contentImage ? "hook" : "explain";
    const progress = Math.max(0, Math.min(1, time / plan.shots.at(-1).end));
    const highlightWords = cue?.highlightWords?.length ? cue.highlightWords
      : code ? (shot.labels || shot.items?.map((item) => item.title) || []) : slide.highlightWords;
    const subtitle = cue?.text ?? slide.line;
    const context = {
      size: LayoutEngine.mediaSize(plan.layout, stage),
      theme: deck.theme,
      imageFocus: plan.imageFocus === true,
      focus, slide, imgMap, mapSrc, deck, index: current, total: plan.shots.length,
    };
    const mountKey = `${current}/${stage}/${code ? "code" : progress}`;
    if (mounted !== mountKey) {
      root.innerHTML = LayoutEngine.render(plan.layout, deck, current, {
        focus: layoutFocus, stage, progress: code ? 1 : progress, imgMap,
        subtitleText: subtitle || (code ? " " : ""), highlightWords,
        renderMedia: () => "",
      });
      const slot = root.querySelector(".media-slot");
      content = slot ? renderer.mount(slot, shot, context) : null;
      mounted = mountKey;
    }
    if (content) renderer.draw(content, shot, localTime, context);
    return LayoutEngine.update(root, { avatarFrame, ...(code ? { progress, subtitle, highlightWords } : {}) });
  }

  global.setPlan = setPlan;
  global.drawFrame = drawFrame;
})(globalThis);
