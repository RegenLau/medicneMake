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

  const imageAspects = new Map();

  function probeAspect(src) {
    if (!src || imageAspects.has(src)) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      const finish = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          imageAspects.set(src, img.naturalWidth / img.naturalHeight);
        }
        resolve();
      };
      img.onload = finish;
      img.onerror = () => resolve();
      img.src = src;
      if (img.complete) finish();
    });
  }

  const image = {
    async prepare(shot, { slide, mapSrc }) {
      const urls = [slide?.contentImage, slide?.outroImage].filter(Boolean).map((u) => (mapSrc ? mapSrc(u) : u));
      await Promise.all(urls.map(probeAspect));
    },
    html(slide, { mapSrc, hasOutroImage, size, compatibility }) {
      const url = hasOutroImage ? slide.outroImage : slide.contentImage;
      if (!url) return TemplateVideo.renderFallbackCard(slide, "all");
      const mapped = mapSrc(url);
      const natAr = imageAspects.get(mapped);
      const slotAr = size && size.w > 0 && size.h > 0 ? size.w / size.h : null;
      const useContain = Boolean(!compatibility && natAr && slotAr && Math.abs(natAr - slotAr) / slotAr > 0.12);
      const cls = useContain ? "pt-media-img is-contain" : "pt-media-img";
      return `<img class="${cls}" src="${attr(mapped)}" alt="" />`;
    },
    mount(slot) { return { slot }; },
    draw(dom, shot, time, ctx) {
      const focus = activeCue(shot, time)?.focus ?? ctx.focus;
      const outro = focus === "outro" && Boolean(ctx.slide.outroImage);
      if (dom.outro !== outro || !dom.mounted) {
        dom.slot.innerHTML = image.html(ctx.slide, { ...ctx, hasOutroImage: outro });
        dom.outro = outro;
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

  function resolveForm(shot) {
    return shot?.form && global.InfoForms?.has(shot.form) ? global.InfoForms.get(shot.form) : null;
  }

  function formContext(shot, ctx) {
    return {
      ...ctx,
      shot,
      variant: shot.variant,
      artUrl: shot.artUrl,
      slotDesc: ctx.slotDesc || (global.InfoForms ? global.InfoForms.resolveSlot(ctx) : null),
    };
  }

  function formDataFor(form, shot) {
    return shot.formData && typeof shot.formData === "object" ? shot.formData : form.fromPoints(shot);
  }

  const card = {
    mount(slot, shot, ctx) {
      const form = resolveForm(shot);
      if (form) {
        const fctx = formContext(shot, ctx);
        const data = formDataFor(form, shot);
        slot.innerHTML = form.html(data, fctx);
        return { slot, form, data, fctx };
      }
      if (!shot.artUrl) return { slot };
      const artShot = StageSceneContent.cardArtShot(shot, ctx.slide);
      return { ...scene.mount(slot, artShot, ctx), artShot };
    },
    draw(dom, shot, time, ctx) {
      if (dom.form) {
        dom.form.animate(dom.slot, dom.data, time, { ...dom.fctx, ...ctx, shot });
        return;
      }
      if (dom.artShot) return scene.draw(dom, dom.artShot, time);
      const { slide } = ctx;
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
    events(shot, ctx) {
      const form = resolveForm(shot);
      if (form) return form.events(formDataFor(form, shot), formContext(shot, ctx));
      return cardEvents(shot, ctx);
    },
  };

  const scene = {
    mount(slot, shot, ctx) {
      const form = resolveForm(shot);
      if (form) {
        const fctx = formContext(shot, ctx);
        const data = formDataFor(form, shot);
        slot.innerHTML = form.html(data, fctx);
        return { slot, form, data, fctx };
      }
      const { index, total } = ctx;
      slot.innerHTML = StageSceneContent.buildDynamicSceneHtml(shot, index, total);
      const one = (name) => slot.querySelector(`[data-cm-${name}]`);
      const all = (name) => [...slot.querySelectorAll(`[data-cm-${name}]`)];
      return {
        meta: StageSceneContent.resolveSceneMeta(shot, index, total),
        scene: one("scene"), heading: one("heading"), motif: one("motif"), answer: one("answer"),
        art: one("art"), artImage: slot.querySelector(".cm-art-img"),
        takeaway: one("takeaway"), divider: one("divider"), progressRail: one("progress-rail"),
        items: all("item"), bars: all("bar"), checks: all("check"), connectors: all("connector"),
        dots: all("dot"), nodes: all("node"), nodeFills: all("node-fill"), pills: all("pill"),
      };
    },
    draw(dom, shot, time, ctx) {
      if (dom.form) {
        dom.form.animate(dom.slot, dom.data, time, { ...dom.fctx, ...ctx, shot });
        return;
      }
      StageSceneContent.animateDynamicScene(dom, shot, dom.meta, time);
    },
    events(shot, ctx) {
      const form = resolveForm(shot);
      if (form) return form.events(formDataFor(form, shot), formContext(shot, ctx));
      return StageSceneContent.sceneEvents(shot, ctx.index, ctx.total);
    },
  };

  const svg = {
    html(shot, progress, theme, includeHeading = true, deck = null, size = null) { return StageSvgContent.content(shot, clamp(progress), theme, includeHeading, deck, size); },
    mount(slot, shot, { layoutTitle }) {
      const drawing = slot.ownerDocument.createElement("div");
      drawing.className = "stage-svg-drawing";
      slot.append(drawing);
      return { slot: drawing, includeHeading: !layoutTitle };
    },
    draw(dom, shot, time, { slide, theme, deck, size }) {
      const duration = shot.motionSeconds ?? shot.end - shot.start;
      dom.slot.innerHTML = svg.html(slide, duration > 0 ? time / duration : 1, theme, dom.includeHeading, deck, size);
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
