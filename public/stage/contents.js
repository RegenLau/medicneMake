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

  const CUSTOM_CODE_BASE_CSS = `
    :host { display: block; width: 100%; height: 100%; overflow: hidden; box-sizing: border-box; font-family: inherit; color: var(--v-ink, #122d4c); }
    *, *::before, *::after { box-sizing: border-box; }
  `;

  function customEaseApi(localTime, duration) {
    const clampVal = (v, min = 0, max = 1) => Math.max(min, Math.min(max, Number(v) || 0));
    return {
      clamp: clampVal,
      smooth: (start, end) => (end <= start ? (localTime >= start ? 1 : 0) : clampVal((localTime - start) / (end - start))),
      ease: {
        outCubic: (p) => 1 - Math.pow(1 - clampVal(p), 3),
        outExpo: (p) => { const x = clampVal(p); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); },
        inOutCubic: (p) => { const x = clampVal(p); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
        outBack: (p) => { const x = clampVal(p); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
      },
      progress: clampVal(localTime / Math.max(0.1, duration)),
    };
  }

  function mountCustomCode(slot, shot) {
    const code = shot.code || {};
    slot.innerHTML = "";
    const host = slot.ownerDocument.createElement("div");
    host.className = "stage-custom-code-host";
    host.setAttribute("data-custom-code-host", "1");
    host.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;";
    slot.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const baseStyle = slot.ownerDocument.createElement("style");
    baseStyle.textContent = CUSTOM_CODE_BASE_CSS;
    shadow.append(baseStyle);
    if (code.css) {
      const userStyle = slot.ownerDocument.createElement("style");
      userStyle.textContent = String(code.css);
      shadow.append(userStyle);
    }
    const wrapper = slot.ownerDocument.createElement("div");
    wrapper.className = "stage-custom-code-inner";
    wrapper.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;";
    wrapper.innerHTML = String(code.html || "");
    shadow.append(wrapper);
    let fn = null;
    let compileError = null;
    const js = String(code.js || "").trim();
    if (js) {
      try {
        fn = new Function("root", "t", "duration", "api", js);
      } catch (err) {
        compileError = String(err?.message || err);
      }
    }
    return { slot, customCode: true, host, shadow, wrapper, fn, compileError, runtimeError: null };
  }

  function drawCustomCode(dom, shot, time, ctx) {
    if (dom.compileError || dom.runtimeError) {
      if (!dom.errorShown) {
        dom.errorShown = true;
        const msg = attr(dom.compileError || dom.runtimeError);
        dom.wrapper.innerHTML = `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;padding:24px;text-align:center;color:var(--v-muted,#475569);font-size:16px;gap:8px;"><strong style="color:var(--v-red,#dc2626);">代码动效运行出错</strong><span style="max-width:85%;word-break:break-word;">${msg}</span><span style="font-size:13px;">可调整提示词后点击「重新生成代码动画」或直接编辑代码</span></div>`;
      }
      return;
    }
    const duration = Math.max(0.1, (shot.end ?? 5) - (shot.start ?? 0));
    const cues = (shot.captions || []).map((c) => ({
      start: Math.max(0, (c.start ?? 0) - (shot.start ?? 0)),
      end: Math.max(0, (c.end ?? duration) - (shot.start ?? 0)),
      text: c.text || "",
    }));
    let cueIndex = cues.findIndex((c) => time < c.end);
    if (cueIndex < 0) cueIndex = Math.max(0, cues.length - 1);
    const helpers = customEaseApi(time, duration);
    const api = {
      ...helpers,
      width: ctx?.size?.w || 960,
      height: ctx?.size?.h || 540,
      cueIndex,
      cues,
      theme: ctx?.theme || "medical",
    };
    if (dom.fn) {
      try {
        dom.fn(dom.shadow, time, duration, api);
      } catch (err) {
        dom.runtimeError = String(err?.message || err);
        drawCustomCode(dom, shot, time, ctx);
        return;
      }
    }
    if (typeof dom.shadow.getAnimations === "function") {
      for (const anim of dom.shadow.getAnimations()) {
        try {
          anim.pause();
          anim.currentTime = time * 1000;
        } catch {}
      }
    }
  }

  const scene = {
    mount(slot, shot, ctx) {
      if (shot?.code && typeof shot.code.html === "string" && shot.code.html.trim()) {
        return mountCustomCode(slot, shot, ctx);
      }
      const noArtShot = { ...shot, artUrl: "", libraryArtUrl: "" };
      const form = resolveForm(noArtShot);
      if (form) {
        const fctx = formContext(noArtShot, ctx);
        const data = formDataFor(form, noArtShot);
        slot.innerHTML = form.html(data, fctx);
        return { slot, form, data, fctx };
      }
      const { index, total } = ctx;
      slot.innerHTML = StageSceneContent.buildDynamicSceneHtml(noArtShot, index, total);
      const one = (name) => slot.querySelector(`[data-cm-${name}]`);
      const all = (name) => [...slot.querySelectorAll(`[data-cm-${name}]`)];
      return {
        meta: StageSceneContent.resolveSceneMeta(noArtShot, index, total),
        scene: one("scene"), heading: one("heading"), motif: one("motif"), answer: one("answer"),
        art: one("art"), artImage: slot.querySelector(".cm-art-img"),
        takeaway: one("takeaway"), divider: one("divider"), progressRail: one("progress-rail"),
        items: all("item"), bars: all("bar"), checks: all("check"), connectors: all("connector"),
        dots: all("dot"), nodes: all("node"), nodeFills: all("node-fill"), pills: all("pill"),
      };
    },
    draw(dom, shot, time, ctx) {
      if (dom.customCode) {
        drawCustomCode(dom, shot, time, ctx);
        return;
      }
      if (dom.form) {
        dom.form.animate(dom.slot, dom.data, time, { ...dom.fctx, ...ctx, shot });
        return;
      }
      StageSceneContent.animateDynamicScene(dom, shot, dom.meta, time);
    },
    events(shot, ctx) {
      if (shot?.code && typeof shot.code.html === "string" && shot.code.html.trim()) return [];
      const form = resolveForm(shot);
      if (form) return form.events(formDataFor(form, shot), formContext(shot, ctx));
      return StageSceneContent.sceneEvents(shot, ctx.index, ctx.total);
    },
  };

  const svg = {
    html(shot, progress, theme, includeHeading = true, deck = null, size = null) { return StageSvgContent.content(shot, clamp(progress), theme, includeHeading, deck, size); },
    mount(slot, shot, ctx) {
      if (shot?.svgCode && typeof shot.svgCode.svg === "string" && shot.svgCode.svg.trim()) {
        const css = `svg { display: block; width: 100%; height: 100%; }\n${shot.svgCode.css || ""}`;
        return mountCustomCode(slot, { code: { html: shot.svgCode.svg, css, js: shot.svgCode.js || "" } }, ctx);
      }
      const drawing = slot.ownerDocument.createElement("div");
      drawing.className = "stage-svg-drawing";
      slot.append(drawing);
      return { slot: drawing, includeHeading: !ctx?.layoutTitle };
    },
    draw(dom, shot, time, ctx) {
      if (dom.customCode) {
        drawCustomCode(dom, shot, time, ctx);
        return;
      }
      const { slide, theme, deck, size } = ctx;
      const duration = shot.motionSeconds ?? shot.end - shot.start;
      dom.slot.innerHTML = svg.html(slide, duration > 0 ? time / duration : 1, theme, dom.includeHeading, deck, size);
    },
    events: shot => (shot?.svgCode && typeof shot.svgCode.svg === "string" && shot.svgCode.svg.trim() ? [] : StageSvgContent.events(shot)),
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
