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
      if (dom.artShot) return scene.draw(dom, dom.artShot, time, ctx);
      const { slide } = ctx;
      const focus = activeCue(shot, time)?.focus || "all";
      if (dom.focus !== focus) {
        dom.slot.innerHTML = TemplateVideo.renderFallbackCard(slide, focus);
        dom.headline = dom.slot.querySelector(".pt-fb-headline, .pt-fb-cover-title");
        dom.targets = [...dom.slot.querySelectorAll(".pt-focus-target:not(.pt-fb-tip-bar), .pt-fb-cover-lead, .pt-fb-pill")];
        dom.tipBar = dom.slot.querySelector(".pt-fb-tip-bar");
        dom.focus = focus;
      }
      StageSceneContent.animateTemplateCard(dom, slide, time, focus, Math.max(0.5, shot.end - shot.start), ctx);
    },
    events(shot, ctx) {
      const form = resolveForm(shot);
      if (form) return form.events(formDataFor(form, shot), formContext(shot, ctx));
      return cardEvents(shot, ctx);
    },
  };

  const CUSTOM_CODE_BASE_CSS = `
    :host {
      display: block; width: 100%; height: 100%; overflow: hidden; box-sizing: border-box; font-family: inherit;
      --v-muted: var(--v-ink-soft, #44607d);
      --v-accent: var(--v-primary, #1466cc);
      --v-red: var(--v-coral, #e6592d);
      color: var(--v-ink, #122d4c);
    }
    *, *::before, *::after { box-sizing: border-box; }
    .mc-canvas {
      position: relative; width: 100%; height: 100%; overflow: hidden;
      display: flex; flex-direction: column; justify-content: space-between; gap: 18px;
      padding: 28px 34px; color: var(--v-ink, #122d4c);
      background:
        radial-gradient(circle at 92% 8%, color-mix(in srgb, var(--v-primary-soft, #dfeeff) 75%, transparent) 0%, transparent 42%),
        radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--v-card-border, #d2e4f6) 55%, transparent) 1.1px, transparent 0),
        var(--v-card-bg, #ffffff);
      background-size: 100% 100%, 22px 22px, 100% 100%;
    }
    .mc-canvas.is-grid {
      background:
        linear-gradient(to right, color-mix(in srgb, var(--v-card-border, #d2e4f6) 36%, transparent) 1px, transparent 1px),
        linear-gradient(to bottom, color-mix(in srgb, var(--v-card-border, #d2e4f6) 36%, transparent) 1px, transparent 1px),
        radial-gradient(circle at 88% 12%, color-mix(in srgb, var(--v-primary-soft, #dfeeff) 65%, transparent) 0%, transparent 48%),
        var(--v-card-bg, #ffffff);
      background-size: 28px 28px, 28px 28px, 100% 100%, 100% 100%;
    }
    .mc-canvas.is-paper {
      background:
        radial-gradient(circle at 86% 14%, color-mix(in srgb, var(--v-amber-soft, #fff6e8) 80%, transparent) 0%, transparent 46%),
        radial-gradient(circle at 12% 88%, color-mix(in srgb, var(--v-primary-soft, #dfeeff) 55%, transparent) 0%, transparent 44%),
        var(--v-card-bg, #ffffff);
    }
    .mc-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .mc-head-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .mc-kicker {
      display: inline-flex; align-items: center; gap: 6px; width: fit-content;
      padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
      background: var(--v-primary-soft, #dfeeff); color: var(--v-primary-deep, var(--v-primary, #1466cc));
      border: 1px solid var(--v-card-border, #d2e4f6);
    }
    .mc-kicker.is-warn { background: var(--v-amber-soft, #fff6e8); color: var(--v-amber, #d98218); border-color: color-mix(in srgb, var(--v-amber, #d98218) 30%, transparent); }
    .mc-kicker.is-danger { background: var(--v-coral-soft, #fff1ec); color: var(--v-coral, #e6592d); border-color: color-mix(in srgb, var(--v-coral, #e6592d) 30%, transparent); }
    .mc-kicker.is-ok { background: var(--v-green-soft, #eaf8f0); color: var(--v-green, #1e8e5a); border-color: color-mix(in srgb, var(--v-green, #1e8e5a) 30%, transparent); }
    .mc-title { margin: 0; font-size: 28px; font-weight: 800; line-height: 1.2; letter-spacing: -0.015em; color: var(--v-ink, #122d4c); }
    .mc-sub { margin: 0; font-size: 16px; line-height: 1.45; color: var(--v-ink-soft, #44607d); }
    .mc-num { font-size: 48px; font-weight: 850; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--v-primary, #1466cc); }
    .mc-body { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
    .mc-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; width: 100%; }
    .mc-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; width: 100%; }
    .mc-split { display: grid; grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr); gap: 22px; align-items: center; width: 100%; min-height: 0; }
    .mc-card {
      position: relative; display: flex; flex-direction: column; gap: 10px; min-width: 0;
      padding: 20px 22px; border-radius: 18px;
      background: var(--v-card-bg, #ffffff);
      border: 1.5px solid var(--v-card-border, #d2e4f6);
      box-shadow: 0 8px 22px rgba(15, 42, 74, 0.055);
    }
    .mc-card.is-soft { background: var(--v-primary-soft, #dfeeff); border-color: color-mix(in srgb, var(--v-primary, #1466cc) 24%, var(--v-card-border, #d2e4f6)); box-shadow: none; }
    .mc-card.is-ok { background: var(--v-green-soft, #eaf8f0); border-color: color-mix(in srgb, var(--v-green, #1e8e5a) 32%, transparent); border-left: 5px solid var(--v-green, #1e8e5a); }
    .mc-card.is-warn { background: var(--v-amber-soft, #fff6e8); border-color: color-mix(in srgb, var(--v-amber, #d98218) 32%, transparent); border-left: 5px solid var(--v-amber, #d98218); }
    .mc-card.is-danger { background: var(--v-coral-soft, #fff1ec); border-color: color-mix(in srgb, var(--v-coral, #e6592d) 34%, transparent); border-left: 5px solid var(--v-coral, #e6592d); }
    .mc-card-row { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .mc-card-title { margin: 0; font-size: 20px; font-weight: 750; line-height: 1.25; color: var(--v-ink, #122d4c); }
    .mc-card-desc { margin: 0; font-size: 16px; line-height: 1.45; color: var(--v-ink-soft, #44607d); }
    .mc-icon-badge {
      flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 46px; height: 46px; border-radius: 14px;
      background: var(--v-primary-soft, #dfeeff); color: var(--v-primary, #1466cc);
    }
    .mc-icon-badge.is-lg { width: 64px; height: 64px; border-radius: 18px; }
    .mc-icon-badge.is-ok { background: var(--v-green-soft, #eaf8f0); color: var(--v-green, #1e8e5a); }
    .mc-icon-badge.is-warn { background: var(--v-amber-soft, #fff6e8); color: var(--v-amber, #d98218); }
    .mc-icon-badge.is-danger { background: var(--v-coral-soft, #fff1ec); color: var(--v-coral, #e6592d); }
    .mc-icon-badge.is-solid { background: var(--v-primary, #1466cc); color: #ffffff; }
    .mc-icon-badge svg, .mc-icon svg { width: 58%; height: 58%; display: block; }
    .mc-icon { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; }
    .mc-icon svg { width: 100%; height: 100%; }
    .mc-pill {
      flex: none; align-self: center; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      padding: 11px 26px; border-radius: 999px; font-size: 17px; font-weight: 750; line-height: 1.25;
      background: var(--v-primary, #1466cc); color: #ffffff;
      box-shadow: 0 8px 20px color-mix(in srgb, var(--v-primary, #1466cc) 28%, transparent);
    }
    .mc-pill.is-soft { background: var(--v-primary-soft, #dfeeff); color: var(--v-primary-deep, var(--v-primary, #1466cc)); box-shadow: none; border: 1.5px solid var(--v-card-border, #d2e4f6); }
    .mc-pill.is-warn { background: var(--v-amber-soft, #fff6e8); color: var(--v-amber, #d98218); box-shadow: none; border: 1.5px solid color-mix(in srgb, var(--v-amber, #d98218) 32%, transparent); }
    .mc-pill.is-ok { background: var(--v-green, #1e8e5a); color: #ffffff; box-shadow: 0 8px 20px color-mix(in srgb, var(--v-green, #1e8e5a) 26%, transparent); }
  `;

  function hydrateStageIcons(wrapper) {
    const icons = global.StageIcons;
    if (!icons || !wrapper) return;
    const doc = wrapper.ownerDocument;
    const svgNs = "http://www.w3.org/2000/svg";
    for (const el of wrapper.querySelectorAll("[data-icon]")) {
      const name = String(el.getAttribute("data-icon") || "").trim();
      if (!name || el.childElementCount > 0) continue;
      if (el.namespaceURI === svgNs) {
        const parsed = new DOMParser().parseFromString(icons.svg(name), "image/svg+xml").documentElement;
        if (parsed && parsed.localName === "svg") {
          if (!el.getAttribute("fill")) el.setAttribute("fill", "none");
          if (!el.getAttribute("stroke")) el.setAttribute("stroke", "currentColor");
          if (!el.getAttribute("stroke-width")) el.setAttribute("stroke-width", "2");
          if (!el.getAttribute("stroke-linecap")) el.setAttribute("stroke-linecap", "round");
          if (!el.getAttribute("stroke-linejoin")) el.setAttribute("stroke-linejoin", "round");
          for (const child of [...parsed.childNodes]) {
            el.append(doc.importNode(child, true));
          }
        }
      } else {
        el.innerHTML = icons.svg(name);
      }
    }
  }

  let gsapRegistered = false;
  function ensureGsap() {
    const g = global.gsap;
    if (!g) return null;
    if (!gsapRegistered) {
      const plugins = [global.DrawSVGPlugin, global.MotionPathPlugin, global.MorphSVGPlugin].filter(Boolean);
      if (plugins.length) g.registerPlugin(...plugins);
      if (g.ticker?.lagSmoothing) g.ticker.lagSmoothing(0);
      gsapRegistered = true;
    }
    return g;
  }

  function resolveShadowTargets(gsapLib, target, scope) {
    if (typeof target === "string") return gsapLib.utils.toArray(target, scope);
    if (Array.isArray(target)) return target.flatMap((item) => (typeof item === "string" ? gsapLib.utils.toArray(item, scope) : item));
    return target;
  }

  function resolveShadowElement(val, scope) {
    if (typeof val !== "string" || !scope) return val;
    const trimmed = val.trim();
    if (!trimmed || trimmed === "self" || /^[Mm]\s*[-+]?\d/.test(trimmed)) return val;
    try {
      return scope.querySelector(trimmed) || val;
    } catch {
      return val;
    }
  }

  function resolveShadowVars(vars, scope) {
    if (!vars || typeof vars !== "object" || !scope) return vars;
    let next = vars;
    if (vars.motionPath !== undefined) {
      const mp = vars.motionPath;
      if (typeof mp === "string") {
        const el = resolveShadowElement(mp, scope);
        if (el !== mp) next = { ...next, motionPath: el };
      } else if (mp && typeof mp === "object" && !Array.isArray(mp)) {
        const rPath = typeof mp.path === "string" ? resolveShadowElement(mp.path, scope) : mp.path;
        const rAlign = typeof mp.align === "string" ? resolveShadowElement(mp.align, scope) : mp.align;
        if (rPath !== mp.path || rAlign !== mp.align) {
          next = { ...next, motionPath: { ...mp, path: rPath, align: rAlign } };
        }
      }
    }
    if (typeof vars.morphSVG === "string") {
      const el = resolveShadowElement(vars.morphSVG, scope);
      if (el !== vars.morphSVG) next = { ...next, morphSVG: el };
    } else if (vars.morphSVG && typeof vars.morphSVG === "object" && typeof vars.morphSVG.shape === "string") {
      const el = resolveShadowElement(vars.morphSVG.shape, scope);
      if (el !== vars.morphSVG.shape) next = { ...next, morphSVG: { ...vars.morphSVG, shape: el } };
    }
    return next;
  }

  function patchShadowTimeline(tl, gsapLib, scope) {
    if (!tl || tl._shadowPatched) return tl;
    const origTo = tl.to.bind(tl);
    const origFrom = tl.from.bind(tl);
    const origFromTo = tl.fromTo.bind(tl);
    const origSet = tl.set.bind(tl);
    tl.to = (target, vars, position) => origTo(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope), position);
    tl.from = (target, vars, position) => origFrom(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope), position);
    tl.fromTo = (target, fromVars, toVars, position) => origFromTo(
      resolveShadowTargets(gsapLib, target, scope),
      resolveShadowVars(fromVars, scope),
      resolveShadowVars(toVars, scope),
      position,
    );
    tl.set = (target, vars, position) => origSet(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope), position);
    tl._shadowPatched = true;
    return tl;
  }

  function createScopedGsap(gsapLib, dom) {
    if (!gsapLib) return null;
    const scope = dom.wrapper;
    const safeTimeline = (vars) => patchShadowTimeline(
      gsapLib.timeline({ ...(vars && typeof vars === "object" ? vars : {}), paused: true }),
      gsapLib,
      scope,
    );
    const facade = Object.create(gsapLib);
    facade.timeline = safeTimeline;
    facade.to = (target, vars) => gsapLib.to(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope));
    facade.from = (target, vars) => gsapLib.from(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope));
    facade.fromTo = (target, fromVars, toVars) => gsapLib.fromTo(
      resolveShadowTargets(gsapLib, target, scope),
      resolveShadowVars(fromVars, scope),
      resolveShadowVars(toVars, scope),
    );
    facade.set = (target, vars) => gsapLib.set(resolveShadowTargets(gsapLib, target, scope), resolveShadowVars(vars, scope));
    facade.quickSetter = (target, property, unit) => gsapLib.quickSetter(resolveShadowTargets(gsapLib, target, scope), property, unit);
    facade.q = (sel) => [...dom.shadow.querySelectorAll(sel)];
    facade.delayedCall = () => {
      throw new Error("代码动效禁止使用 gsap.delayedCall，请在 api.setup((tl) => ...) 中用时间轴偏移量编排。");
    };
    return facade;
  }

  function quarantineStrayAnimations(ctx, tl, gsapLib) {
    if (!ctx?.data?.length) return;
    const rootTl = gsapLib.globalTimeline;
    for (const item of [...ctx.data]) {
      if (!item || item === tl || typeof item.pause !== "function" || typeof item.totalTime !== "function") continue;
      if (item.parent === rootTl) {
        item.paused(false);
        tl.add(item, 0);
      }
    }
  }

  const CUSTOM_SFX_TYPES = new Set([
    "item-focus", "check", "warning", "cross", "count", "draw", "flip", "beat-in", "outro",
  ]);
  const CUSTOM_SFX_ALIAS = {
    pop: "item-focus",
    tick: "item-focus",
    ok: "check",
    confirm: "check",
    alert: "warning",
    error: "cross",
    line: "draw",
  };
  const customEventsCache = new WeakMap();

  function normalizeSfxType(type) {
    const raw = String(type || "item-focus").trim().toLowerCase();
    const mapped = CUSTOM_SFX_ALIAS[raw] || raw;
    return CUSTOM_SFX_TYPES.has(mapped) ? mapped : null;
  }

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

  function disposeCustomCode(dom) {
    if (!dom) return;
    try { dom.tl?.kill(); } catch {}
    try { dom.gsapCtx?.revert(); } catch {}
    dom.tl = null;
    dom.gsapCtx = null;
    dom.setupRan = false;
    dom.hasSeeked = false;
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
    hydrateStageIcons(wrapper);
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
    const dom = {
      slot, customCode: true, host, shadow, wrapper, fn, compileError, runtimeError: null,
      gsapCtx: null, tl: null, setupRan: false, hasSeeked: false, scopedGsap: null,
      sfxEvents: [], sfxSeen: new Set(),
    };
    dom.dispose = () => disposeCustomCode(dom);
    return dom;
  }

  function seekCustomTimeline(dom, time, duration) {
    if (!dom.tl || !dom.gsapCtx) return;
    const clamped = Math.max(0, Math.min(duration, Number(time) || 0));
    dom.gsapCtx.seek(clamped);
  }

  function drawCustomCode(dom, shot, time, ctx) {
    if (dom.compileError || dom.runtimeError) {
      if (!dom.errorShown) {
        dom.errorShown = true;
        disposeCustomCode(dom);
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
    const gsapLib = ensureGsap();
    if (gsapLib && !dom.scopedGsap) dom.scopedGsap = createScopedGsap(gsapLib, dom);
    let seekedThisFrame = false;
    const ensureContext = () => {
      if (!gsapLib) throw new Error("离线 GSAP 动效引擎未加载。");
      if (!dom.gsapCtx) {
        const gCtx = gsapLib.context(() => {}, dom.wrapper);
        const tl = patchShadowTimeline(gsapLib.timeline({ paused: true }), gsapLib, dom.wrapper);
        gCtx.data.push(tl);
        gCtx.add("runBuilder", (builder) => {
          const ret = builder(tl, dom.scopedGsap);
          if (ret && ret !== tl && typeof ret.pause === "function" && typeof ret.totalTime === "function") {
            if (ret.parent !== tl) {
              ret.paused(false);
              tl.add(ret, 0);
            }
          }
          quarantineStrayAnimations(gCtx, tl, gsapLib);
        });
        gCtx.add("seek", (targetTime) => {
          tl.pause();
          tl.totalTime(targetTime, false);
          if (!dom.hasSeeked && targetTime === 0) {
            tl.render(0, false, true);
          }
          dom.hasSeeked = true;
        });
        dom.gsapCtx = gCtx;
        dom.tl = tl;
      }
    };
    const api = {
      ...helpers,
      width: ctx?.size?.w || 960,
      height: ctx?.size?.h || 540,
      cueIndex,
      cues,
      theme: ctx?.theme || "medical",
      gsap: dom.scopedGsap,
      q: (sel) => [...dom.shadow.querySelectorAll(sel)],
      icon: (name, attrs = "") => (global.StageIcons ? global.StageIcons.svg(name, attrs) : ""),
      icons: global.StageIcons ? [...global.StageIcons.names] : [],
      sfx: (atSeconds, type = "item-focus") => {
        const tVal = Number(atSeconds);
        const normType = normalizeSfxType(type);
        if (!normType || !Number.isFinite(tVal) || tVal < 0 || tVal >= duration) return;
        const key = `${Math.round(tVal * 1000)}:${normType}`;
        if (dom.sfxSeen.has(key) || dom.sfxEvents.length >= 12) return;
        dom.sfxSeen.add(key);
        dom.sfxEvents.push({ t: Number(tVal.toFixed(4)), type: normType });
        customEventsCache.set(shot, [...dom.sfxEvents]);
      },
      timeline: (vars) => {
        if (!gsapLib) throw new Error("离线 GSAP 动效引擎未加载。");
        return dom.scopedGsap.timeline(vars);
      },
      setup: (builder) => {
        if (typeof builder !== "function") return dom.tl;
        if (!dom.setupRan) {
          ensureContext();
          dom.gsapCtx.runBuilder(builder);
        }
        seekCustomTimeline(dom, time, duration);
        seekedThisFrame = true;
        return dom.tl;
      },
    };
    if (dom.fn) {
      try {
        dom.fn(dom.shadow, time, duration, api);
        if (dom.tl) {
          dom.setupRan = true;
          if (!seekedThisFrame) seekCustomTimeline(dom, time, duration);
        }
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
      StageSceneContent.animateDynamicScene(dom, shot, dom.meta, time, ctx);
    },
    events(shot, ctx) {
      if (shot?.code && typeof shot.code.html === "string" && shot.code.html.trim()) {
        return collectCustomCodeEvents(shot, ctx, false);
      }
      const form = resolveForm(shot);
      if (form) return form.events(formDataFor(form, shot), formContext(shot, ctx));
      return StageSceneContent.sceneEvents(shot, ctx.index, ctx.total);
    },
  };

  function collectCustomCodeEvents(shot, ctx, isSvg) {
    if (customEventsCache.has(shot)) return [...customEventsCache.get(shot)];
    const js = isSvg ? shot?.svgCode?.js : shot?.code?.js;
    if (typeof js !== "string" || !js.includes("sfx")) return [];
    const doc = global.document;
    if (!doc?.body) return [];
    const w = ctx?.size?.w || 960;
    const h = ctx?.size?.h || 540;
    const holder = doc.createElement("div");
    holder.style.cssText = `position:fixed;left:-9999px;top:0;width:${w}px;height:${h}px;visibility:hidden;pointer-events:none;overflow:hidden;`;
    doc.body.append(holder);
    let dom = null;
    try {
      const mountShot = isSvg
        ? { ...shot, code: { html: shot.svgCode.svg, css: `svg { display: block; width: 100%; height: 100%; }\n${shot.svgCode.css || ""}`, js: shot.svgCode.js || "" } }
        : shot;
      dom = mountCustomCode(holder, mountShot, ctx);
      drawCustomCode(dom, shot, 0, ctx);
      const list = [...dom.sfxEvents];
      customEventsCache.set(shot, list);
      return [...list];
    } catch {
      return [];
    } finally {
      try { dom?.dispose?.(); } catch {}
      holder.remove();
    }
  }

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
    events: (shot, ctx) => (
      shot?.svgCode && typeof shot.svgCode.svg === "string" && shot.svgCode.svg.trim()
        ? collectCustomCodeEvents(shot, ctx, true)
        : StageSvgContent.events(shot)
    ),
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
