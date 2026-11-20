"use strict";

/* Dynamic content-adaptive code-motion renderer inside the 1280x720 TemplateVideo frame.
 * Every visual and motion choreography is deterministically driven by (time, shot, beat)
 * so preview scrubbing and Playwright frame-by-frame MP4 capture stay 100% identical. */
(function () {
  const canvas = document.querySelector("#motion-frame");
  const fit = () => {
    canvas.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`;
  };
  addEventListener("resize", fit);
  fit();

  let timeline = [];
  let deck = null;
  let imgMap = new Map();
  let mountedScene = -1;
  let previousSubtitle = undefined;
  let templateMotion = false;
  let contentDom = null;

  /* ===== Public Player API (used by Preview iframe & Playwright MP4 Exporter) ===== */
  window.setMotionPlan = ({ title, shortTitle, chapters, disclaimer, shots, appearance = {}, localAvatar, templateInfo, fontId }) => {
    canvas.classList.toggle("cm-library-font", fontId === "builtin:font/noto-sans-sc");
    timeline = Array.isArray(shots) ? shots : [];
    templateMotion = Boolean(templateInfo);
    const resolvedChapters = Array.isArray(chapters) && chapters.length >= 2
      ? chapters
      : ["先看要点", "用药提醒"];
    deck = TemplateVideo.normalizeDeck({
      ...appearance,
      title,
      shortTitle: shortTitle || title,
      chapters: resolvedChapters,
      ...(disclaimer !== undefined ? { disclaimer } : {}),
      ...templateInfo,
      slides: templateMotion
        ? timeline.map((shot) => ({ ...shot.visual, layoutMode: "explain", line: shot.line }))
        : timeline.map((shot, index) => {
            const meta = StageSceneContent.resolveSceneMeta(shot, index, timeline.length);
            const fallbackChap = timeline.length === 5 && resolvedChapters.length === 2
              ? (index < 3 ? 0 : 1)
              : Math.min(resolvedChapters.length - 1, Math.floor((index * resolvedChapters.length) / Math.max(1, timeline.length)));
            return {
              ...shot,
              type: "explain",
              layoutMode: "explain",
              chapterIndex: Number.isInteger(shot.chapterIndex) ? shot.chapterIndex : fallbackChap,
              highlightWords: meta.items.map((it) => it.title),
            };
          }),
    });
    const avatar = TemplateVideo.resolveAvatarSrc(deck);
    imgMap = new Map(avatar ? [[avatar, localAvatar || new URL("." + avatar, location.href).href]] : []);
    mountedScene = -1;
    previousSubtitle = undefined;
    contentDom = null;
  };

  window.drawMotionFrame = (time, avatarFrame) => {
    if (!timeline.length || !deck) return;
    let index = timeline.findIndex((shot) => time < shot.end);
    if (index < 0) index = timeline.length - 1;
    const shot = timeline[index];
    if (!shot) return;

    const renderer = templateMotion ? Contents.card : Contents.scene;
    const context = { slide: deck.slides[index], index, total: timeline.length };
    if (mountedScene !== index) {
      canvas.innerHTML = TemplateVideo.renderFrameHtml(deck, index, {
        subtitleText: shot.captions?.[0]?.text || shot.line || " ",
        imgMap,
        progress: 1,
        renderMedia: () => "",
      });
      const footer = canvas.querySelector(".pt-footer");
      if (footer && !footer.firstElementChild) {
        const subtitle = document.createElement("div");
        subtitle.className = "pt-subtitle";
        footer.append(subtitle);
      }
      contentDom = renderer.mount(canvas.querySelector(".pt-media-slot"), shot, context);
      previousSubtitle = undefined;
      mountedScene = index;
    }

    const localTime = Math.max(0, time - shot.start);
    const cue = (shot.captions || []).find((caption) => time < caption.end) || shot.captions?.at(-1);
    renderer.draw(contentDom, shot, localTime, context);
    const state = { avatarFrame, progress: time / (timeline.at(-1).end || 1) };
    if (previousSubtitle !== cue) {
      state.subtitle = cue?.text ?? "";
      state.highlightWords = cue?.highlightWords?.length
        ? cue.highlightWords
        : (shot.labels || shot.items?.map((it) => it.title) || []);
      previousSubtitle = cue;
    }
    return LayoutEngine.update(canvas, state);
  };
})();
