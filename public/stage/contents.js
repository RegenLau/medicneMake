"use strict";

(function (global) {
  const attr = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const clamp = value => global.MgKit.clamp(value);
  const noEvents = () => [];

  function activeCue(shot, localTime) {
    const cues = shot.captions || [];
    const time = shot.start + localTime;
    return cues.find((cue) => time < cue.end) || cues.at(-1);
  }

  const image = {
    html(slide, { mapSrc, focus, hasOutroImage, imageFocus = false, theme }) {
      const url = hasOutroImage ? slide.outroImage : slide.contentImage;
      if (!url) return TemplateVideo.renderFallbackCard(slide, "all");
      const box = imageFocus && TemplateVideo.resolveFocusBox(slide, focus);
      const scale = box ? 1.045 : 1;
      const style = box ? ` style="transform:scale(${scale});transform-origin:${box.x + box.w / 2}% ${box.y + box.h / 2}%"` : "";
      return `<img class="pt-media-img" src="${attr(mapSrc(url))}" alt=""${style} />` +
        (box ? TemplateVideo.renderSpotlightSvg(slide, focus, theme) : "");
    },
    mount(slot) { return { slot }; },
    draw(dom, shot, time, ctx) {
      const focus = activeCue(shot, time)?.focus ?? ctx.focus;
      if (dom.focus !== focus || !dom.mounted) {
        dom.slot.innerHTML = image.html(ctx.slide, { ...ctx, focus, hasOutroImage: focus === "outro" && Boolean(ctx.slide.outroImage) });
        dom.focus = focus;
        dom.mounted = true;
      }
    },
    isStatic: () => true,
    events: noEvents,
  };

  function cardEvents(shot, {slide}) {
    const events = [];
    let previous = "all";
    for (const cue of shot.captions || []) {
      const focus = cue.focus || "all";
      if (focus !== previous && focus !== "all" && focus !== "outro") {
        const check = slide.type === "summary" && focus === "action" && slide.checks?.length;
        events.push({t: cue.start - shot.start, type:check ? "check" : "item-focus"});
      }
      previous = focus;
    }
    if (slide.type === "warning") events.push({t:0, type:"warning"});
    return events;
  }

  const card = {
    mount(slot) { return { slot }; },
    draw(dom, shot, time, { slide }) {
      const focus = activeCue(shot, time)?.focus || "all";
      if (dom.focus !== focus) {
        dom.slot.innerHTML = TemplateVideo.renderFallbackCard(slide, focus);
        dom.headline = dom.slot.querySelector(".pt-fb-headline, .pt-fb-cover-title");
        dom.targets = [...dom.slot.querySelectorAll(".pt-focus-target:not(.pt-fb-tip-bar), .pt-fb-cover-lead, .pt-fb-pill")];
        dom.tipBar = dom.slot.querySelector(".pt-fb-tip-bar");
        dom.focus = focus;
      }
      StageSceneContent.animateTemplateCard(dom, slide, time, focus, Math.max(0.5, shot.end - shot.start));
    },
    events: cardEvents,
  };

  const scene = {
    mount(slot, shot, { index, total }) {
      slot.innerHTML = StageSceneContent.buildDynamicSceneHtml(shot, index, total);
      const one = (name) => slot.querySelector(`[data-cm-${name}]`);
      const all = (name) => [...slot.querySelectorAll(`[data-cm-${name}]`)];
      return {
        meta: StageSceneContent.resolveSceneMeta(shot, index, total),
        scene: one("scene"), heading: one("heading"), motif: one("motif"), answer: one("answer"),
        takeaway: one("takeaway"), divider: one("divider"), progressRail: one("progress-rail"),
        items: all("item"), bars: all("bar"), checks: all("check"), connectors: all("connector"),
        dots: all("dot"), nodes: all("node"), nodeFills: all("node-fill"), pills: all("pill"),
      };
    },
    draw(dom, shot, time) { StageSceneContent.animateDynamicScene(dom, shot, dom.meta, time); },
    events: (shot, {index, total}) => StageSceneContent.sceneEvents(shot, index, total),
  };

  const svg = {
    html(shot, progress, theme, includeHeading = true) { return StageSvgContent.content(shot, clamp(progress), theme, includeHeading); },
    mount(slot, shot, { layoutTitle }) {
      const drawing = slot.ownerDocument.createElement("div");
      drawing.className = "stage-svg-drawing";
      slot.append(drawing);
      return { slot: drawing, includeHeading: !layoutTitle };
    },
    draw(dom, shot, time, { slide, theme }) {
      const duration = shot.motionSeconds ?? shot.end - shot.start;
      dom.slot.innerHTML = svg.html(slide, duration > 0 ? time / duration : 1, theme, dom.includeHeading);
    },
    events: shot => StageSvgContent.events(shot),
  };

  const asset = {
    mount(slot, shot, ctx) {
      slot.innerHTML = shot.assetUrl
        ? `<img class="stage-asset" src="${attr(shot.assetUrl)}" alt="">`
        : TemplateVideo.renderFallbackCard(ctx.slide, "all");
      return { image: slot.querySelector("img") };
    },
    draw(dom, shot, time) {
      if (!dom.image) return;
      const p = clamp(time / Math.max(.1, shot.end - shot.start));
      dom.image.style.transform = shot.move === "zoom" ? `scale(${MgKit.sample(MgKit.presets.pushIn[0],p)})` :
        shot.move === "pan" ? `translateX(${MgKit.sample(MgKit.presets.pan[0],p)}%) scale(1.07)` : "";
    },
    isStatic: shot => !shot.move || shot.move === "still",
    events: noEvents,
  };

  global.Contents = { image, card, scene, svg, asset, activeCue };
})(globalThis);
