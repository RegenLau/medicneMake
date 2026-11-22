"use strict";

(function (global) {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v) => (global.MgKit ? global.MgKit.clamp(v) : Math.max(0, Math.min(1, Number(v) || 0)));
  const easeOutCubic = (v) => (global.MgKit ? global.MgKit.easing.outCubic(v) : 1 - Math.pow(1 - clamp(v), 3));
  const easeOutExpo = (v) => (global.MgKit ? global.MgKit.easing.outExpo(v) : clamp(v) >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(v)));
  const icon = (name, attrs = "") => (global.StageIcons ? global.StageIcons.svg(name, attrs) : "");

  const RELATIONS = {
    hook: "开场结论",
    number: "数值剂量",
    time: "时间节律",
    steps: "操作步骤",
    compare: "对比权衡",
    warning: "警示误区",
    checklist: "核对清单",
    mechanism: "作用原理",
    summary: "要点收口",
  };

  const POINT_TYPE_RELATIONS = {
    cover: "hook", explain: "mechanism", compare: "compare", steps: "steps",
    warning: "warning", summary: "summary", timeline: "time", checklist: "checklist",
  };

  const LEGACY_VISUAL_MAP = {
    hook: "big-answer", mechanism: "cause-chain", compare: "table-compare", steps: "flow-h",
    timeline: "timeline-h", checklist: "check-list", warning: "alert-list", summary: "three-points",
  };

  function resolveSlot(ctx) {
    if (ctx?.slotDesc) return ctx.slotDesc;
    if (ctx?.layout && global.LayoutEngine?.describeMediaSlot) {
      return global.LayoutEngine.describeMediaSlot(ctx.layout, ctx.stage || "explain");
    }
    const w = ctx?.size?.w || 960;
    const h = ctx?.size?.h || 540;
    const aspect = w / h;
    const shape = aspect < 0.85 ? "portrait"
      : aspect >= 2.2 && h <= 420 ? "shallow-wide"
        : aspect >= 2.2 ? "ultrawide"
          : w <= 720 ? "narrow"
            : h <= 420 ? "shallow"
              : (w <= 860 || h <= 480) ? "compact" : "standard";
    return { w, h, aspect, shape, hasHeadline: false, hasAnswer: false, hasKeypoints: false };
  }

  function shotDuration(ctx) {
    const shot = ctx?.shot;
    return shot ? Math.max(0.8, (Number(shot.end) || 4) - (Number(shot.start) || 0)) : 4;
  }

  // Cue-aware staggered reveal times for N items so points enter along narration beats
  function itemBeatTimes(count, ctx, baseDelay = 0.25) {
    const dur = shotDuration(ctx);
    const captions = ctx?.shot?.captions || [];
    const start0 = Number(ctx?.shot?.start) || 0;
    const times = [];
    for (let i = 0; i < count; i++) {
      const cue = captions.find((c) => String(c.focus) === String(i));
      if (cue && Number.isFinite(cue.start)) {
        times.push(Math.max(0.12, cue.start - start0));
      } else {
        const span = Math.max(0.6, Math.min(dur * 0.62, count * 0.65));
        times.push(baseDelay + (count > 1 ? (i / count) * span : 0));
      }
    }
    return times;
  }

  function activeItemSet(count, t, ctx) {
    if (!ctx?.shot || !global.StageSceneContent?.resolveActiveFocus) return null;
    const res = global.StageSceneContent.resolveActiveFocus(ctx.shot, t, count, ctx.shot.motion || "spotlight");
    return res.focusedIndices;
  }

  function parseLeadNumber(val) {
    const str = String(val ?? "");
    const m = /(-?\d+(?:\.\d+)?)/.exec(str);
    if (!m) return null;
    const num = Number(m[1]);
    const decimals = m[1].includes(".") ? m[1].split(".")[1].length : 0;
    return {
      prefix: str.slice(0, m.index),
      target: num,
      decimals,
      suffix: str.slice(m.index + m[0].length),
    };
  }

  function formatCountNumber(parsed, progress) {
    if (!parsed) return "";
    const cur = parsed.target * easeOutCubic(progress);
    const text = parsed.decimals > 0 ? cur.toFixed(parsed.decimals) : String(Math.round(cur));
    return parsed.prefix + text + parsed.suffix;
  }

  function wrapStage(form, data, ctx, innerHtml, { skipHeader = false, handlesOwnArt = false } = {}) {
    const slot = resolveSlot(ctx);
    const variant = form.variants.includes(ctx?.variant) ? ctx.variant : form.variants[0];
    const headline = data?.headline || ctx?.shot?.name || "";
    const showHeader = !skipHeader && Boolean(headline) && !slot.hasHeadline;
    const artUrl = !handlesOwnArt && ctx?.artUrl ? ctx.artUrl : "";
    const body = artUrl
      ? `<div class="if-body has-side-art"><figure class="if-side-art cm-art-panel" data-if-art><img src="${esc(artUrl)}" alt=""></figure><div class="if-main">${innerHtml}</div></div>`
      : `<div class="if-body"><div class="if-main">${innerHtml}</div></div>`;
    const cardNoArt = ctx?.shot?.kind === "card" && !ctx?.artUrl ? " pt-card-fallback" : "";
    return `<div class="if-stage form-${esc(form.id)} rel-${esc(form.relation)} var-${esc(variant)}${cardNoArt}" data-if-stage>
      ${showHeader ? `<header class="if-header"><h2 class="if-headline" data-if-heading data-anchor="headline-end" data-sticker-avoid>${esc(headline)}</h2>${data?.tag ? `<span class="if-tag">${esc(data.tag)}</span>` : ""}</header>` : ""}
      ${body}
    </div>`;
  }

  function animateCommon(dom, t, ctx) {
    const hasTransition = Boolean(ctx?.hasTransition);
    const leadT = hasTransition ? t + 0.18 : t;
    const stage = dom.querySelector("[data-if-stage]");
    if (stage) stage.style.opacity = hasTransition ? "1" : String(easeOutExpo(t / 0.28).toFixed(3));
    const heading = dom.querySelector("[data-if-heading]");
    if (heading) {
      const hp = easeOutExpo(leadT / 0.42);
      heading.style.opacity = String(hp.toFixed(3));
      heading.style.transform = `translateY(${((1 - hp) * 10).toFixed(2)}px)`;
    }
    const art = dom.querySelector("[data-if-art]");
    if (art) {
      const ap = easeOutExpo(leadT / 0.65);
      art.style.opacity = String(ap.toFixed(3));
      art.style.transform = `translateX(${((1 - ap) * -22).toFixed(2)}px)`;
    }
    const note = dom.querySelector("[data-if-note]");
    if (note) {
      const dur = shotDuration(ctx);
      const np = easeOutExpo((t - Math.min(0.85, dur * 0.45)) / 0.45);
      note.style.opacity = String(np.toFixed(3));
      note.style.transform = `translateY(${((1 - np) * 10).toFixed(2)}px)`;
    }
  }

  function animateItems(dom, selector, t, ctx, { axis = "y", dist = 16, baseDelay = 0.22 } = {}) {
    const els = [...dom.querySelectorAll(selector)];
    const times = itemBeatTimes(els.length, ctx, baseDelay);
    const focused = activeItemSet(els.length, t, ctx);
    els.forEach((el, i) => {
      const p = easeOutExpo((t - times[i]) / 0.46);
      const isF = focused ? focused.has(i) : false;
      const isD = Boolean(focused && !isF);
      el.classList.toggle("is-active", isF);
      const alpha = p * (isD ? 0.55 : 1);
      const shift = (1 - p) * dist;
      const scale = isF ? 1.02 : 0.96 + 0.04 * p;
      el.style.opacity = String(alpha.toFixed(3));
      el.style.transform = axis === "x"
        ? `translateX(${(-shift).toFixed(2)}px) scale(${scale.toFixed(3)})`
        : `translateY(${shift.toFixed(2)}px) scale(${scale.toFixed(3)})`;
    });
    return times;
  }

  function itemFocusEvents(count, ctx, type = "item-focus", baseDelay = 0.22) {
    return itemBeatTimes(count, ctx, baseDelay).map((t) => ({ t, type }));
  }

  function clip(s, n) { return String(s || "").trim().slice(0, n); }
  function getItems(shot) {
    const raw = shot?.points?.items || shot?.items || [];
    const out = raw.map((it) => typeof it === "string"
      ? { title: it.trim(), detail: "", tag: "" }
      : { title: String(it?.title || "").trim(), detail: String(it?.detail || it?.desc || "").trim(), tag: String(it?.tag || "").trim() }
    ).filter((it) => it.title);
    if (out.length) return out;
    return [{ title: clip(shot?.name || "核心要点", 12), detail: clip(shot?.points?.takeaway || shot?.takeaway || "", 16), tag: "" }];
  }
  function firstNum(shot) {
    const src = [shot?.name, shot?.line, shot?.points?.headline, shot?.points?.takeaway, ...(shot?.points?.items || []).map((i) => `${i.title || ""} ${i.detail || ""}`)].join(" ");
    const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z%℃度毫克升次天小时分钟周月岁公斤kgml]+)?/.exec(src);
    return m ? [m[1], (m[2] || "").slice(0, 8)] : ["1", ""];
  }

  const FORMS = {};
  function register(def) {
    FORMS[def.id] = {
      variants: ["solid", "outline", "split"],
      shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide", "shallow"],
      fits(slotOrSize, data) {
        const slot = slotOrSize?.shape ? slotOrSize : resolveSlot({ size: slotOrSize });
        if (!this.shapes.includes(slot.shape)) return false;
        if (this.avoidOuter?.some((flag) => slot[flag])) return false;
        const count = data ? (data.items || data.steps || data.nodes || data.rows || data.groups || data.callouts || data.times || []).length : 0;
        if (slot.shape === "narrow" && this.maxItemsNarrow && count > this.maxItemsNarrow) return false;
        if ((slot.shape === "shallow" || slot.shape === "shallow-wide") && this.maxItemsShallow && count > this.maxItemsShallow) return false;
        return true;
      },
      ...def,
    };
  }

  /* ==================== 1–4. HOOK ==================== */
  register({
    id: "big-answer", relation: "hook", label: "大字结论", preferredKind: "card",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide", "shallow", "portrait"],
    fromPoints(shot) {
      const p = shot?.points || {};
      const it = getItems(shot)[0];
      return {
        headline: clip(p.headline || shot?.name, 18),
        answer: clip(p.answer || p.takeaway || shot?.takeaway || it.title, 20),
        note: clip(p.lead || it.detail || "", 28),
        tag: clip(it.tag || "", 8),
      };
    },
    html(data, ctx) {
      const chars = [...String(data.answer || "")].map((ch, i) => `<span class="if-char" data-if-char="${i}">${esc(ch)}</span>`).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-big-answer">
          <div class="if-big-answer-hero" data-anchor="item-0" data-sticker-avoid>${chars}</div>
          <div class="if-big-answer-bar" data-if-bar></div>
          ${data.note ? `<p class="if-big-answer-sub" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const chars = [...dom.querySelectorAll("[data-if-char]")];
      const step = Math.min(0.055, 0.55 / Math.max(1, chars.length));
      chars.forEach((el, i) => {
        const p = easeOutExpo((t - 0.12 - i * step) / 0.34);
        el.style.opacity = String(p.toFixed(3));
        el.style.transform = `translateY(${((1 - p) * -18).toFixed(2)}px)`;
      });
      const bar = dom.querySelector("[data-if-bar]");
      if (bar) bar.style.transform = `scaleX(${easeOutCubic((t - 0.35) / 0.55).toFixed(3)})`;
    },
    events() { return [{ t: 0.4, type: "item-focus" }]; },
  });

  register({
    id: "qa-flip", relation: "hook", label: "问答翻转", preferredKind: "card",
    avoidOuter: ["hasAnswer"],
    fromPoints(shot) {
      const p = shot?.points || {};
      const it = getItems(shot)[0];
      return {
        question: clip(p.question || p.headline || shot?.name, 24),
        answer: clip(p.answer || p.takeaway || shot?.takeaway || it.title, 20),
        note: clip(p.lead || it.detail || "", 26),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-qa-wrap">
          <div class="if-qa-card" data-if-flip>
            <div class="if-qa-face is-front" data-if-front data-anchor="item-0" data-sticker-avoid>
              <span class="if-qa-pill">常见疑问</span>
              <div class="if-qa-text">${esc(data.question)}</div>
            </div>
            <div class="if-qa-face is-back" data-if-back data-anchor="item-1" data-sticker-avoid>
              <span class="if-qa-pill">药师直答</span>
              <div class="if-qa-text">${esc(data.answer)}</div>
              ${data.note ? `<div class="if-qa-note">${esc(data.note)}</div>` : ""}
            </div>
          </div>
        </div>`, { skipHeader: true });
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const dur = shotDuration(ctx);
      const qCue = (ctx?.shot?.captions || []).find((c) => c.focus === "answer");
      const flipAt = qCue ? Math.max(0.6, qCue.start - ctx.shot.start) : Math.min(1.3, dur * 0.36);
      const p = easeOutCubic((t - flipAt) / 0.62);
      const front = dom.querySelector("[data-if-front]");
      const back = dom.querySelector("[data-if-back]");
      const deg = 180 * p;
      if (front) {
        front.style.transform = `rotateY(${deg.toFixed(1)}deg)`;
        front.style.opacity = deg < 90 ? "1" : "0";
      }
      if (back) {
        back.style.transform = `rotateY(${(deg - 180).toFixed(1)}deg)`;
        back.style.opacity = deg >= 90 ? "1" : "0";
      }
    },
    events(data, ctx) {
      const dur = shotDuration(ctx);
      const qCue = (ctx?.shot?.captions || []).find((c) => c.focus === "answer");
      const flipAt = qCue ? Math.max(0.6, qCue.start - ctx.shot.start) : Math.min(1.3, dur * 0.36);
      return [{ t: flipAt + 0.15, type: "flip" }];
    },
  });

  register({
    id: "stat-hero", relation: "hook", label: "核心数字", preferredKind: "card",
    fromPoints(shot) {
      const [val, unit] = firstNum(shot);
      const it = getItems(shot)[0];
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        value: val, unit: unit || "项", label: clip(it.title, 16),
        note: clip(shot?.points?.takeaway || it.detail || "", 24),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-stat-hero">
          <div class="if-stat-num-row" data-anchor="item-0" data-sticker-avoid>
            <span class="if-stat-val" data-if-counter>${esc(data.value)}</span>
            ${data.unit ? `<span class="if-stat-unit">${esc(data.unit)}</span>` : ""}
          </div>
          <svg class="if-stat-line" viewBox="0 0 240 10" aria-hidden="true">
            <line data-if-draw x1="10" y1="5" x2="230" y2="5" stroke="var(--if-accent)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          </svg>
          <div class="if-stat-label" data-if-label data-sticker-avoid>${esc(data.label)}</div>
          ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const counter = dom.querySelector("[data-if-counter]");
      const parsed = parseLeadNumber(data.value);
      const cp = clamp((t - 0.15) / 0.9);
      if (counter && parsed) counter.textContent = formatCountNumber(parsed, cp);
      const line = dom.querySelector("[data-if-draw]");
      if (line) line.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.3) / 0.65))).toFixed(2)));
      const label = dom.querySelector("[data-if-label]");
      if (label) {
        const lp = easeOutExpo((t - 0.35) / 0.45);
        label.style.opacity = String(lp.toFixed(3));
        label.style.transform = `translateY(${((1 - lp) * 12).toFixed(2)}px)`;
      }
    },
    events() { return [{ t: 1.05, type: "count" }]; },
  });

  register({
    id: "art-answer", relation: "hook", label: "插画结论", preferredKind: "scene",
    variants: ["split", "solid", "outline"],
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const p = shot?.points || {};
      const items = getItems(shot).slice(0, 3).map((it) => ({ title: clip(it.title, 12), detail: clip(it.detail, 18) }));
      return { headline: clip(p.headline || shot?.name, 16), answer: clip(p.answer || p.takeaway || items[0].title, 24), items };
    },
    html(data, ctx) {
      const items = data.items || [];
      const artHtml = ctx?.artUrl
        ? `<img src="${esc(ctx.artUrl)}" alt="">`
        : `<div class="if-art-placeholder">${icon("pill")}<span>用药要点图解</span></div>`;
      const slot = resolveSlot(ctx);
      return wrapStage(this, data, ctx, `
        <div class="if-art-split">
          <figure class="if-art-box cm-art-panel" data-if-art>${artHtml}</figure>
          <div class="if-art-right">
            ${!slot.hasHeadline && data.headline ? `<h2 class="if-headline" data-if-heading data-anchor="headline-end" data-sticker-avoid>${esc(data.headline)}</h2>` : ""}
            <div class="if-art-answer-box" data-if-answer data-anchor="item-0" data-sticker-avoid>${esc(data.answer)}</div>
            ${items.length ? `<div class="if-v-list">${items.map((it, i) => `
              <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                <span class="if-v-num">${i + 1}</span>
                <div class="if-v-copy"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
              </div>`).join("")}</div>` : ""}
          </div>
        </div>`, { skipHeader: true, handlesOwnArt: true });
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const ans = dom.querySelector("[data-if-answer]");
      if (ans) {
        const p = easeOutExpo((t - 0.18) / 0.45);
        ans.style.opacity = String(p.toFixed(3));
        ans.style.transform = `translateY(${((1 - p) * 14).toFixed(2)}px)`;
      }
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 18, baseDelay: 0.35 });
    },
    events(data, ctx) { return itemFocusEvents((data.items || []).length || 1, ctx, "item-focus", 0.35); },
  });

  /* ==================== 5–8. NUMBER ==================== */
  register({
    id: "dose-card", relation: "number", label: "剂量卡", preferredKind: "card",
    fromPoints(shot) {
      const [val, unit] = firstNum(shot);
      const it = getItems(shot)[0];
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        value: val, unit: unit || "次", condition: clip(it.title, 18),
        note: clip(shot?.points?.takeaway || it.detail || "", 24),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-card if-dose-card" data-if-card data-anchor="item-0" data-sticker-avoid>
          <div class="if-dose-badge">
            <span class="if-dose-num" data-if-counter>${esc(data.value)}</span>
            <span class="if-dose-unit">${esc(data.unit)}</span>
          </div>
          <div class="if-dose-info">
            <div class="if-dose-cond">${esc(data.condition)}</div>
            <svg viewBox="0 0 240 8" style="width:100%;height:8px" aria-hidden="true">
              <line data-if-draw x1="0" y1="4" x2="240" y2="4" stroke="var(--if-accent)" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            </svg>
            ${data.note ? `<p class="if-note" data-if-note>${esc(data.note)}</p>` : ""}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const card = dom.querySelector("[data-if-card]");
      if (card) {
        const p = easeOutExpo((t - 0.1) / 0.45);
        card.style.opacity = String(p.toFixed(3));
        card.style.transform = `scale(${(0.94 + 0.06 * p).toFixed(3)})`;
      }
      const counter = dom.querySelector("[data-if-counter]");
      const parsed = parseLeadNumber(data.value);
      if (counter && parsed) counter.textContent = formatCountNumber(parsed, (t - 0.18) / 0.8);
      const line = dom.querySelector("[data-if-draw]");
      if (line) line.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.45) / 0.6))).toFixed(2)));
    },
    events() { return [{ t: 0.95, type: "count" }, { t: 1.05, type: "draw" }]; },
  });

  register({
    id: "weight-table", relation: "number", label: "体重剂量表", preferredKind: "card",
    shapes: ["standard", "compact", "narrow", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const rows = items.map((it, i) => ({ a: clip(it.title, 12), b: clip(it.detail || it.tag || "按说明书", 14), highlight: i === 0 }));
      while (rows.length < 2) rows.push({ a: "常规档", b: "按说明书核对", highlight: false });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), colA: "体重 / 情形", colB: "参考用量", rows };
    },
    html(data, ctx) {
      const rows = data.rows || [];
      return wrapStage(this, data, ctx, `
        <div class="if-table">
          <div class="if-table-head"><span>${esc(data.colA)}</span><span>${esc(data.colB)}</span></div>
          ${rows.map((r, i) => `
            <div class="if-table-row" data-if-row="${i}" data-if-hl="${r.highlight ? "1" : "0"}" data-anchor="item-${i}" data-sticker-avoid>
              <strong>${esc(r.a)}</strong><span>${esc(r.b)}</span>
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = animateItems(dom, "[data-if-row]", t, ctx, { axis: "y", dist: 14, baseDelay: 0.2 });
      const hlAt = (times.at(-1) || 0.8) + 0.35;
      dom.querySelectorAll("[data-if-row]").forEach((row) => {
        if (row.dataset.ifHl === "1") row.classList.toggle("is-hl", t >= hlAt);
      });
    },
    events(data, ctx) {
      const rows = data.rows || [];
      const times = itemBeatTimes(rows.length, ctx, 0.2);
      const evs = times.map((t) => ({ t, type: "item-focus" }));
      evs.push({ t: (times.at(-1) || 0.8) + 0.35, type: "check" });
      return evs;
    },
  });

  register({
    id: "measure-scale", relation: "number", label: "量杯刻度", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const [valStr, unit] = firstNum(shot);
      const val = Math.max(0.1, Number(valStr) || 5);
      const it = getItems(shot)[0];
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        value: val, max: Math.max(val * 1.5, 10), unit: unit || "ml",
        label: clip(it.title, 16), note: clip(shot?.points?.takeaway || it.detail || "", 22),
      };
    },
    html(data, ctx) {
      const max = Math.max(Number(data.max) || 10, Number(data.value) || 1);
      const ticks = [0.25, 0.5, 0.75, 1].map((r) => {
        const y = (195 - r * 145).toFixed(1);
        const v = (max * r).toFixed(max < 5 ? 1 : 0);
        return `<line x1="60" y1="${y}" x2="80" y2="${y}" stroke="var(--v-ink-soft)" stroke-width="2.5" stroke-linecap="round"/>` +
          `<text x="86" y="${Number(y) + 4}" font-size="11" font-weight="700" fill="var(--v-ink-soft)">${v}</text>`;
      }).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-measure-wrap">
          <svg class="if-cup-svg" viewBox="0 0 180 220" aria-hidden="true">
            <defs><clipPath id="if-cup-clip-${ctx?.index || 0}"><path d="M46 36h88l-10 162a10 10 0 0 1-10 9H66a10 10 0 0 1-10-9L46 36Z"/></clipPath></defs>
            <path d="M46 36h88l-10 162a10 10 0 0 1-10 9H66a10 10 0 0 1-10-9L46 36Z" fill="var(--if-accent-soft)" stroke="var(--v-ink)" stroke-width="3.5" stroke-linejoin="round"/>
            <g clip-path="url(#if-cup-clip-${ctx?.index || 0})">
              <rect data-if-liquid x="40" y="195" width="100" height="0" fill="var(--if-accent)" opacity="0.82"/>
            </g>
            ${ticks}
            <line data-if-target x1="42" y1="195" x2="138" y2="195" stroke="var(--v-coral)" stroke-width="3" stroke-dasharray="5 4"/>
          </svg>
          <div class="if-measure-copy" data-anchor="item-0" data-sticker-avoid>
            <div class="if-stat-num-row" style="justify-content:flex-start">
              <span class="if-stat-val" data-if-counter>${esc(data.value)}</span>
              <span class="if-stat-unit">${esc(data.unit)}</span>
            </div>
            <div class="if-dose-cond">${esc(data.label)}</div>
            ${data.note ? `<p class="if-note" data-if-note>${esc(data.note)}</p>` : ""}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const val = Number(data.value) || 1;
      const max = Math.max(Number(data.max) || val * 1.5, val);
      const ratio = clamp(val / max);
      const fillP = easeOutCubic((t - 0.2) / 1.0);
      const h = 145 * ratio * fillP;
      const y = 195 - h;
      const liq = dom.querySelector("[data-if-liquid]");
      if (liq) { liq.setAttribute("y", y.toFixed(1)); liq.setAttribute("height", (h + 15).toFixed(1)); }
      const targetY = (195 - 145 * ratio).toFixed(1);
      const line = dom.querySelector("[data-if-target]");
      if (line) { line.setAttribute("y1", targetY); line.setAttribute("y2", targetY); line.style.opacity = String(easeOutExpo((t - 0.1) / 0.35).toFixed(2)); }
      const counter = dom.querySelector("[data-if-counter]");
      if (counter) {
        const cur = val * fillP;
        counter.textContent = Number.isInteger(val) ? String(Math.round(cur)) : cur.toFixed(1);
      }
    },
    events() { return [{ t: 1.15, type: "count" }, { t: 1.25, type: "check" }]; },
  });

  register({
    id: "count-icons", relation: "number", label: "次数图标", preferredKind: "card",
    fromPoints(shot) {
      const [valStr, unit] = firstNum(shot);
      const cnt = Math.max(1, Math.min(6, Math.round(Number(valStr) || getItems(shot).length)));
      const it = getItems(shot)[0];
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        count: cnt, max: Math.max(cnt, Math.min(6, cnt + 1)), icon: "pill",
        unit: clip(unit || "次", 12), note: clip(shot?.points?.takeaway || it.title, 22),
      };
    },
    html(data, ctx) {
      const count = Math.max(1, Math.min(6, Number(data.count) || 1));
      const total = Math.max(count, Math.min(6, Number(data.max) || count));
      const cells = Array.from({ length: total }, (_, i) => `
        <div class="if-count-cell" data-if-cell="${i}" data-if-active="${i < count ? "1" : "0"}" data-anchor="item-${Math.min(i, 3)}" data-sticker-avoid>
          ${icon(data.icon || "pill")}
        </div>`).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-count-wrap">
          <div class="if-count-row">${cells}</div>
          <div class="if-count-caption" data-if-caption data-sticker-avoid>${count} ${esc(data.unit)}</div>
          ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const count = Math.max(1, Math.min(6, Number(data.count) || 1));
      const step = Math.min(0.28, 1.2 / Math.max(1, count));
      dom.querySelectorAll("[data-if-cell]").forEach((cell, i) => {
        const isActive = cell.dataset.ifActive === "1";
        const p = easeOutExpo((t - 0.15 - i * step) / 0.35);
        cell.classList.toggle("is-lit", isActive && p > 0.35);
        cell.style.opacity = String((isActive ? p : 0.4 * easeOutExpo(t / 0.4)).toFixed(3));
        cell.style.transform = `scale(${(0.8 + 0.2 * (isActive ? p : 1)).toFixed(3)})`;
      });
    },
    events(data) {
      const count = Math.max(1, Math.min(6, Number(data.count) || 1));
      const step = Math.min(0.28, 1.2 / Math.max(1, count));
      const evs = Array.from({ length: Math.min(3, count) }, (_, i) => ({ t: 0.2 + i * step, type: "item-focus" }));
      evs.push({ t: 0.25 + count * step, type: "count" });
      return evs;
    },
  });

  /* ==================== 9–12. TIME ==================== */
  register({
    id: "timeline-h", relation: "time", label: "横向时间轴", preferredKind: "scene",
    maxItemsNarrow: 3,
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const nodes = items.map((it, i) => ({ time: clip(it.tag || `阶段${i + 1}`, 10), title: clip(it.title, 12), detail: clip(it.detail, 16) }));
      while (nodes.length < 2) nodes.push({ time: "下一步", title: "按医嘱核对", detail: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), nodes };
    },
    html(data, ctx) {
      const nodes = (data.nodes || []).slice(0, 4);
      const n = Math.max(2, nodes.length);
      const dots = nodes.map((_, i) => {
        const cx = (10 + (80 * i) / Math.max(1, n - 1)).toFixed(1);
        return `<circle data-if-dot="${i}" cx="${cx}" cy="12" r="5" fill="var(--if-accent)"/>`;
      }).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-h-flow">
          <svg class="if-h-track-svg" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            <line x1="10" y1="12" x2="90" y2="12" stroke="var(--v-card-border)" stroke-width="3.5" stroke-linecap="round"/>
            <line data-if-rail x1="10" y1="12" x2="90" y2="12" stroke="var(--if-accent)" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            ${dots}
          </svg>
          <div class="if-h-grid c-${n}">
            ${nodes.map((nd, i) => `
              <div class="if-card if-h-card" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                <span class="if-step-badge">${esc(nd.time)}</span>
                <strong>${esc(nd.title)}</strong>
                ${nd.detail ? `<span>${esc(nd.detail)}</span>` : ""}
              </div>`).join("")}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const dur = shotDuration(ctx);
      const rail = dom.querySelector("[data-if-rail]");
      if (rail) rail.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.15) / Math.max(0.9, dur * 0.6)))).toFixed(2)));
      const times = animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 16, baseDelay: 0.2 });
      dom.querySelectorAll("[data-if-dot]").forEach((dot, i) => {
        dot.style.opacity = String(easeOutExpo((t - (times[i] || 0.2)) / 0.25).toFixed(2));
      });
    },
    events(data, ctx) { return [{ t: 0.4, type: "draw" }, ...itemFocusEvents((data.nodes || []).length, ctx, "item-focus", 0.2)]; },
  });

  register({
    id: "clock-24", relation: "time", label: "24小时时钟", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const hours = [8, 14, 20, 22];
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        times: items.map((it, i) => ({ hour: hours[i % hours.length], label: clip(it.title, 10) })),
        note: clip(shot?.points?.takeaway || "", 22),
      };
    },
    html(data, ctx) {
      const times = (data.times || []).slice(0, 4);
      const marks = times.map((tm, i) => {
        const ang = (tm.hour / 24) * 360 - 90;
        const rad = (ang * Math.PI) / 180;
        const x = (110 + 76 * Math.cos(rad)).toFixed(1);
        const y = (110 + 76 * Math.sin(rad)).toFixed(1);
        return `<circle data-if-mark="${i}" cx="${x}" cy="${y}" r="8" fill="var(--if-accent)" stroke="var(--v-card-bg)" stroke-width="2.5"/>`;
      }).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-clock-wrap">
          <svg class="if-clock-svg" viewBox="0 0 220 220" aria-hidden="true">
            <circle cx="110" cy="110" r="90" fill="var(--v-card-bg)" stroke="var(--v-card-border)" stroke-width="3"/>
            <circle data-if-arc cx="110" cy="110" r="76" fill="none" stroke="var(--if-accent)" stroke-width="10" stroke-linecap="round" opacity="0.28" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 110 110)"/>
            <text x="110" y="34" text-anchor="middle" font-size="12" font-weight="800" fill="var(--v-ink-soft)">0h</text>
            <text x="188" y="114" text-anchor="middle" font-size="12" font-weight="800" fill="var(--v-ink-soft)">6h</text>
            <text x="110" y="194" text-anchor="middle" font-size="12" font-weight="800" fill="var(--v-ink-soft)">12h</text>
            <text x="32" y="114" text-anchor="middle" font-size="12" font-weight="800" fill="var(--v-ink-soft)">18h</text>
            <line data-if-hand x1="110" y1="110" x2="110" y2="48" stroke="var(--v-ink)" stroke-width="4.5" stroke-linecap="round"/>
            <circle cx="110" cy="110" r="6" fill="var(--v-ink)"/>
            ${marks}
          </svg>
          <div class="if-clock-list">
            ${times.map((tm, i) => `
              <div class="if-card if-clock-row" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                <span class="if-clock-hour">${String(tm.hour).padStart(2, "0")}:00</span>
                <strong>${esc(tm.label)}</strong>
              </div>`).join("")}
            ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = data.times || [];
      const maxHour = times.length ? Math.max(...times.map((x) => x.hour)) : 12;
      const sweep = easeOutCubic((t - 0.15) / 1.1);
      const hand = dom.querySelector("[data-if-hand]");
      if (hand) hand.setAttribute("transform", `rotate(${((maxHour / 24) * 360 * sweep).toFixed(1)} 110 110)`);
      const arc = dom.querySelector("[data-if-arc]");
      if (arc) arc.setAttribute("stroke-dashoffset", String((100 - 100 * (maxHour / 24) * sweep).toFixed(2)));
      const itemTs = animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 16, baseDelay: 0.25 });
      dom.querySelectorAll("[data-if-mark]").forEach((m, i) => {
        m.style.opacity = String(easeOutExpo((t - (itemTs[i] || 0.25)) / 0.3).toFixed(2));
      });
    },
    events(data, ctx) { return [{ t: 0.5, type: "draw" }, ...itemFocusEvents((data.times || []).length, ctx, "check", 0.3)]; },
  });

  register({
    id: "interval-bar", relation: "time", label: "间隔时间条", preferredKind: "scene",
    fromPoints(shot) {
      const [valStr, unit] = firstNum(shot);
      const items = getItems(shot);
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        interval: clip(valStr ? `${valStr}${unit || "小时"}` : (items[0].tag || items[0].title), 12),
        startLabel: clip(items[0]?.title || "第一次服药", 10),
        endLabel: clip(items[1]?.title || "下一次服药", 10),
        note: clip(shot?.points?.takeaway || "", 24),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-interval-wrap">
          <div class="if-interval-row">
            <div class="if-interval-end" data-if-end="0" data-anchor="item-0" data-sticker-avoid>${esc(data.startLabel)}</div>
            <div class="if-interval-track">
              <span class="if-interval-pill" data-if-pill data-sticker-avoid>${esc(data.interval)}</span>
              <div class="if-interval-bar-bg"><div class="if-interval-bar-fill" data-if-fill></div></div>
            </div>
            <div class="if-interval-end" data-if-end="1" data-anchor="item-1" data-sticker-avoid>${esc(data.endLabel)}</div>
          </div>
          ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const fill = dom.querySelector("[data-if-fill]");
      if (fill) fill.style.transform = `scaleX(${easeOutCubic((t - 0.25) / 0.95).toFixed(3)})`;
      const pill = dom.querySelector("[data-if-pill]");
      if (pill) {
        const p = easeOutExpo((t - 0.45) / 0.45);
        pill.style.opacity = String(p.toFixed(3));
        pill.style.transform = `scale(${(0.85 + 0.15 * p).toFixed(3)})`;
      }
      dom.querySelectorAll("[data-if-end]").forEach((el, i) => {
        const p = easeOutExpo((t - 0.15 - i * 0.55) / 0.4);
        el.style.opacity = String(p.toFixed(3));
      });
    },
    events() { return [{ t: 0.4, type: "draw" }, { t: 1.15, type: "count" }]; },
  });

  register({
    id: "meal-band", relation: "time", label: "饭前饭后带", preferredKind: "scene",
    fromPoints(shot) {
      const src = `${shot?.name || ""} ${shot?.line || ""}`;
      const active = /饭前|空腹/.test(src) ? "before" : /饭中|随餐/.test(src) ? "during" : /睡前/.test(src) ? "bedtime" : "after";
      const it = getItems(shot)[0];
      return { headline: clip(shot?.points?.headline || shot?.name, 14), active, label: clip(it.title, 16), note: clip(shot?.points?.takeaway || it.detail, 24) };
    },
    html(data, ctx) {
      const slots = [
        ["before", "饭前 / 空腹", "clock"],
        ["during", "饭中 / 随餐", "meal"],
        ["after", "饭后服用", "sun"],
        ["bedtime", "睡前服用", "moon"],
      ];
      return wrapStage(this, data, ctx, `
        <div class="if-meal-wrap">
          <div class="if-meal-track">
            ${slots.map(([id, text, ic], i) => `
              <div class="if-meal-slot" data-if-slot="${id}" data-anchor="item-${i}" data-sticker-avoid>
                ${icon(ic)}<span>${text}</span>
              </div>`).join("")}
          </div>
          <div class="if-meal-pointer" data-if-pointer></div>
          <div class="if-card" data-if-label data-sticker-avoid><strong>${esc(data.label)}</strong></div>
          ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const order = ["before", "during", "after", "bedtime"];
      const idx = Math.max(0, order.indexOf(data.active));
      const slide = easeOutCubic((t - 0.25) / 0.75);
      const ptr = dom.querySelector("[data-if-pointer]");
      if (ptr) ptr.style.transform = `translateX(${(idx * 105 * slide).toFixed(1)}%)`;
      dom.querySelectorAll("[data-if-slot]").forEach((el) => {
        el.classList.toggle("is-selected", el.dataset.ifSlot === data.active && slide > 0.7);
      });
    },
    events() { return [{ t: 0.35, type: "item-focus" }, { t: 0.95, type: "check" }]; },
  });

  /* ==================== 13–16. STEPS ==================== */
  register({
    id: "flow-h", relation: "steps", label: "横向流程", preferredKind: "scene",
    maxItemsNarrow: 3,
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const steps = items.map((it) => ({ title: clip(it.title, 10), detail: clip(it.detail, 16), icon: "check" }));
      while (steps.length < 2) steps.push({ title: "核对要点", detail: "", icon: "check" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), steps };
    },
    html(data, ctx) {
      const steps = (data.steps || []).slice(0, 4);
      const n = Math.max(2, steps.length);
      return wrapStage(this, data, ctx, `
        <div class="if-h-flow">
          <svg class="if-h-track-svg" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            <line x1="8" y1="12" x2="92" y2="12" stroke="var(--v-card-border)" stroke-width="3.5" stroke-linecap="round"/>
            <line data-if-rail x1="8" y1="12" x2="92" y2="12" stroke="var(--if-accent)" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          </svg>
          <div class="if-h-grid c-${n}">
            ${steps.map((st, i) => `
              <div class="if-card if-h-card" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                  <span class="if-step-badge">第 ${i + 1} 步</span>
                  <span class="if-icon" style="width:30px;height:30px">${icon(st.icon || "check")}</span>
                </div>
                <strong>${esc(st.title)}</strong>
                ${st.detail ? `<span>${esc(st.detail)}</span>` : ""}
              </div>`).join("")}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const rail = dom.querySelector("[data-if-rail]");
      if (rail) rail.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.15) / Math.max(0.9, shotDuration(ctx) * 0.6)))).toFixed(2)));
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 18, baseDelay: 0.2 });
    },
    events(data, ctx) { return [{ t: 0.35, type: "draw" }, ...itemFocusEvents((data.steps || []).length, ctx, "item-focus", 0.2)]; },
  });

  register({
    id: "steps-v", relation: "steps", label: "纵向步骤卡", preferredKind: "card",
    shapes: ["standard", "compact", "narrow", "ultrawide"],
    maxItemsShallow: 3,
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const steps = items.map((it) => ({ title: clip(it.title, 12), detail: clip(it.detail, 18), tag: clip(it.tag, 8) }));
      while (steps.length < 2) steps.push({ title: "核对要点", detail: "", tag: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), steps };
    },
    html(data, ctx) {
      const steps = (data.steps || []).slice(0, 4);
      return wrapStage(this, data, ctx, `
        <div class="if-v-list">
          ${steps.map((st, i) => `
            <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <span class="if-v-num">${i + 1}</span>
              <div class="if-v-copy"><strong>${esc(st.title)}</strong>${st.detail ? `<span>${esc(st.detail)}</span>` : ""}</div>
              ${st.tag ? `<span class="if-tag">${esc(st.tag)}</span>` : ""}
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 18, baseDelay: 0.2 });
    },
    events(data, ctx) { return itemFocusEvents((data.steps || []).length, ctx, "item-focus", 0.2); },
  });

  register({
    id: "art-steps", relation: "steps", label: "插画步骤分屏", preferredKind: "scene",
    variants: ["split", "solid", "outline"],
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const steps = getItems(shot).slice(0, 4).map((it) => ({ title: clip(it.title, 12), detail: clip(it.detail, 16) }));
      return { headline: clip(shot?.points?.headline || shot?.name, 14), steps, note: clip(shot?.points?.takeaway || "", 22) };
    },
    html(data, ctx) {
      const steps = (data.steps || []).slice(0, 4);
      const artHtml = ctx?.artUrl
        ? `<img data-if-art-img src="${esc(ctx.artUrl)}" alt="">`
        : `<div class="if-art-placeholder">${icon("bottle")}<span>操作示意插画</span></div>`;
      const slot = resolveSlot(ctx);
      return wrapStage(this, data, ctx, `
        <div class="if-art-split">
          <figure class="if-art-box cm-art-panel" data-if-art>${artHtml}</figure>
          <div class="if-art-right">
            ${!slot.hasHeadline && data.headline ? `<h2 class="if-headline" data-if-heading data-anchor="headline-end" data-sticker-avoid>${esc(data.headline)}</h2>` : ""}
            <div class="if-v-list">
              ${steps.map((st, i) => `
                <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                  <span class="if-v-num">${i + 1}</span>
                  <div class="if-v-copy"><strong>${esc(st.title)}</strong>${st.detail ? `<span>${esc(st.detail)}</span>` : ""}</div>
                </div>`).join("")}
            </div>
            ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
          </div>
        </div>`, { skipHeader: true, handlesOwnArt: true });
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const img = dom.querySelector("[data-if-art-img]");
      if (img) {
        const drift = clamp(t / shotDuration(ctx));
        img.style.transform = `scale(${(1.02 + 0.06 * drift).toFixed(4)})`;
      }
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 16, baseDelay: 0.25 });
    },
    events(data, ctx) { return itemFocusEvents((data.steps || []).length, ctx, "item-focus", 0.25); },
  });

  register({
    id: "cycle", relation: "steps", label: "环形循环", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4).map((it) => ({ title: clip(it.title, 8), detail: clip(it.detail, 14) }));
      while (items.length < 3) items.push({ title: `步骤${items.length + 1}`, detail: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), center: clip(shot?.name || "循环步骤", 8), steps: items };
    },
    html(data, ctx) {
      const steps = (data.steps || []).slice(0, 4);
      const pos3 = [{ left: "50%", top: "4%", tx: "-50%", ty: "0" }, { left: "78%", top: "68%", tx: "-50%", ty: "0" }, { left: "22%", top: "68%", tx: "-50%", ty: "0" }];
      const pos4 = [{ left: "50%", top: "2%", tx: "-50%", ty: "0" }, { left: "82%", top: "40%", tx: "-50%", ty: "0" }, { left: "50%", top: "76%", tx: "-50%", ty: "0" }, { left: "18%", top: "40%", tx: "-50%", ty: "0" }];
      const pos = steps.length === 4 ? pos4 : pos3;
      return wrapStage(this, data, ctx, `
        <div class="if-cycle-wrap" style="margin:0 auto">
          <svg class="if-cycle-svg" viewBox="0 0 220 220" aria-hidden="true">
            <circle cx="110" cy="110" r="78" fill="none" stroke="var(--v-card-border)" stroke-width="5"/>
            <circle data-if-ring cx="110" cy="110" r="78" fill="none" stroke="var(--if-accent)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 110 110)"/>
          </svg>
          <div class="if-cycle-center">${esc(data.center || "循环步骤")}</div>
          ${steps.map((st, i) => `
            <div class="if-card if-cycle-node" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid style="left:${pos[i].left};top:${pos[i].top}">
              <strong>${i + 1}. ${esc(st.title)}</strong>${st.detail ? `<span>${esc(st.detail)}</span>` : ""}
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const ring = dom.querySelector("[data-if-ring]");
      if (ring) ring.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.15) / 1.25))).toFixed(2)));
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 12, baseDelay: 0.22 });
    },
    events(data, ctx) { return [{ t: 0.45, type: "draw" }, ...itemFocusEvents((data.steps || []).length, ctx, "item-focus", 0.22)]; },
  });

  /* ==================== 17–20. COMPARE ==================== */
  register({
    id: "do-dont", relation: "compare", label: "对错对照", preferredKind: "scene",
    fromPoints(shot) {
      const items = getItems(shot);
      const doList = [], dontList = [];
      for (const it of items) {
        if (/别|不要|勿|禁止|不能|误|错|忌/.test(it.title)) dontList.push(clip(it.title, 16));
        else doList.push(clip(it.title, 16));
      }
      if (!doList.length) doList.push(clip(shot?.points?.takeaway || items[0].title, 16));
      if (!dontList.length) dontList.push(clip(items[1]?.title || "避免自行加减量", 16));
      return { headline: clip(shot?.points?.headline || shot?.name, 14), do: doList.slice(0, 3), dont: dontList.slice(0, 3) };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-two-cols">
          <div class="if-col-box is-do" data-if-col="do" data-anchor="item-0" data-sticker-avoid>
            <div class="if-col-head">${icon("check")}<span>正确做法</span></div>
            <ul class="if-col-list">${(data.do || []).map((t, i) => `<li data-if-do="${i}"><span class="if-col-mark" style="color:var(--v-green)">✓</span><span>${esc(t)}</span></li>`).join("")}</ul>
          </div>
          <div class="if-col-box is-dont" data-if-col="dont" data-anchor="item-1" data-sticker-avoid>
            <div class="if-col-head">${icon("cross")}<span>避免误区</span></div>
            <ul class="if-col-list">${(data.dont || []).map((t, i) => `<li data-if-dont="${i}"><span class="if-col-mark" style="color:var(--v-coral)">✗</span><span>${esc(t)}</span></li>`).join("")}</ul>
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const doCol = dom.querySelector('[data-if-col="do"]');
      const dontCol = dom.querySelector('[data-if-col="dont"]');
      const p1 = easeOutExpo((t - 0.15) / 0.45);
      const p2 = easeOutExpo((t - 0.42) / 0.45);
      if (doCol) { doCol.style.opacity = String(p1.toFixed(3)); doCol.style.transform = `translateX(${((1 - p1) * -22).toFixed(2)}px)`; }
      if (dontCol) { dontCol.style.opacity = String(p2.toFixed(3)); dontCol.style.transform = `translateX(${((1 - p2) * 22).toFixed(2)}px)`; }
      dom.querySelectorAll("[data-if-do]").forEach((el, i) => { el.style.opacity = String(easeOutExpo((t - 0.25 - i * 0.2) / 0.35).toFixed(3)); });
      dom.querySelectorAll("[data-if-dont]").forEach((el, i) => { el.style.opacity = String(easeOutExpo((t - 0.55 - i * 0.2) / 0.35).toFixed(3)); });
    },
    events() { return [{ t: 0.3, type: "check" }, { t: 0.65, type: "cross" }]; },
  });

  register({
    id: "table-compare", relation: "compare", label: "多属性对比表", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4);
      const rows = items.map((it, i) => ({ attr: clip(it.tag || `维度${i + 1}`, 6), left: clip(it.title, 14), right: clip(it.detail || "按医嘱", 14) }));
      while (rows.length < 2) rows.push({ attr: "提醒", left: "按说明书", right: "问药师" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), leftTitle: clip(items[0]?.title || "方案一", 10), rightTitle: clip(items[1]?.title || "方案二", 10), rows };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-table is-3col">
          <div class="if-table-head"><span>对比项</span><span>${esc(data.leftTitle)}</span><span>${esc(data.rightTitle)}</span></div>
          ${(data.rows || []).map((r, i) => `
            <div class="if-table-row" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <span class="if-table-attr">${esc(r.attr)}</span>
              <span>${esc(r.left)}</span>
              <span>${esc(r.right)}</span>
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 18, baseDelay: 0.2 });
    },
    events(data, ctx) { return itemFocusEvents((data.rows || []).length, ctx, "item-focus", 0.2); },
  });

  register({
    id: "before-after", relation: "compare", label: "前后对比", preferredKind: "scene",
    fromPoints(shot) {
      const items = getItems(shot);
      const half = Math.max(1, Math.floor(items.length / 2));
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        beforeTitle: "改变前", beforeItems: items.slice(0, half).map((i) => clip(i.title, 16)),
        afterTitle: "改变后", afterItems: (items.slice(half).length ? items.slice(half) : items).map((i) => clip(i.title, 16)),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-ba-stage">
          <div class="if-ba-pane is-before" data-anchor="item-0" data-sticker-avoid>
            <div class="if-col-head" style="color:var(--v-coral)">${esc(data.beforeTitle)}</div>
            <ul class="if-col-list">${(data.beforeItems || []).map((s) => `<li><span>•</span><span>${esc(s)}</span></li>`).join("")}</ul>
          </div>
          <div class="if-ba-pane is-after" data-if-after data-anchor="item-1" data-sticker-avoid>
            <div class="if-col-head" style="color:var(--v-green)">${esc(data.afterTitle)}</div>
            <ul class="if-col-list">${(data.afterItems || []).map((s) => `<li><span style="color:var(--v-green)">✓</span><span>${esc(s)}</span></li>`).join("")}</ul>
          </div>
          <div class="if-ba-divider" data-if-wipe></div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const p = easeOutCubic((t - 0.35) / 0.85);
      const after = dom.querySelector("[data-if-after]");
      if (after) after.style.clipPath = `inset(0 0 0 ${(100 * (1 - p)).toFixed(1)}%)`;
      const div = dom.querySelector("[data-if-wipe]");
      if (div) div.style.left = `${(50 + 50 * (1 - p)).toFixed(1)}%`;
    },
    events() { return [{ t: 0.4, type: "flip" }, { t: 1.15, type: "check" }]; },
  });

  register({
    id: "balance", relation: "compare", label: "取舍天平", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot);
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        leftTitle: clip(items[0]?.title || "获益", 10), leftDesc: clip(items[0]?.detail || items[0]?.title || "", 18),
        rightTitle: clip(items[1]?.title || "风险注意", 10), rightDesc: clip(items[1]?.detail || shot?.points?.takeaway || "", 18),
        tilt: "even",
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-balance-wrap">
          <svg class="if-balance-svg" viewBox="0 0 420 96" aria-hidden="true">
            <path d="M180 88h60M210 24v64" stroke="var(--v-ink-soft)" stroke-width="5" stroke-linecap="round"/>
            <g data-if-beam>
              <line x1="66" y1="30" x2="354" y2="30" stroke="var(--if-accent)" stroke-width="6" stroke-linecap="round"/>
              <circle cx="66" cy="30" r="8" fill="var(--v-primary)"/>
              <circle cx="354" cy="30" r="8" fill="var(--v-amber)"/>
            </g>
            <circle cx="210" cy="30" r="9" fill="var(--v-ink)"/>
          </svg>
          <div class="if-balance-cards">
            <div class="if-card" data-if-item="0" data-anchor="item-0" data-sticker-avoid>
              <div class="if-col-head" style="color:var(--v-primary);margin-bottom:6px">${esc(data.leftTitle)}</div>
              <div style="font-size:17px;color:var(--v-ink-soft);line-height:1.4">${esc(data.leftDesc)}</div>
            </div>
            <div class="if-card" data-if-item="1" data-anchor="item-1" data-sticker-avoid>
              <div class="if-col-head" style="color:var(--v-amber);margin-bottom:6px">${esc(data.rightTitle)}</div>
              <div style="font-size:17px;color:var(--v-ink-soft);line-height:1.4">${esc(data.rightDesc)}</div>
            </div>
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const targetAngle = data.tilt === "left" ? -7 : data.tilt === "right" ? 7 : 0;
      const sway = Math.sin(t * 2.4) * 3 * Math.max(0, 1 - t / 2.2);
      const angle = targetAngle * easeOutCubic((t - 0.2) / 0.8) + sway;
      const beam = dom.querySelector("[data-if-beam]");
      if (beam) beam.setAttribute("transform", `rotate(${angle.toFixed(2)} 210 30)`);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 14, baseDelay: 0.25 });
    },
    events() { return [{ t: 0.35, type: "flip" }, { t: 0.9, type: "item-focus" }]; },
  });

  /* ==================== 21–23. WARNING ==================== */
  register({
    id: "myth-fact", relation: "warning", label: "误区纠偏", preferredKind: "scene",
    fromPoints(shot) {
      const items = getItems(shot);
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14),
        myth: clip(items[0].title, 22),
        fact: clip(shot?.points?.takeaway || items[1]?.title || items[0].detail || shot?.name, 22),
        note: clip(items[0].detail || "", 24),
      };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-myth-wrap">
          <div class="if-myth-box" data-if-myth data-anchor="item-0" data-sticker-avoid>
            <span class="if-icon" style="background:var(--v-coral);color:#fff">${icon("cross")}</span>
            <div class="if-myth-text">${esc(data.myth)}<span class="if-myth-strike" data-if-strike></span></div>
          </div>
          <div class="if-fact-box" data-if-fact data-anchor="item-1" data-sticker-avoid>
            <span class="if-icon" style="background:var(--v-green);color:#fff">${icon("check")}</span>
            <div class="if-fact-text">${esc(data.fact)}</div>
          </div>
          ${data.note ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.note)}</p>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const strike = dom.querySelector("[data-if-strike]");
      const sp = easeOutCubic((t - 0.45) / 0.45);
      if (strike) strike.style.transform = `scaleX(${sp.toFixed(3)})`;
      const myth = dom.querySelector("[data-if-myth]");
      if (myth) myth.style.opacity = String((1 - 0.35 * sp).toFixed(3));
      const fact = dom.querySelector("[data-if-fact]");
      if (fact) {
        const fp = easeOutExpo((t - 0.9) / 0.5);
        fact.style.opacity = String(fp.toFixed(3));
        fact.style.transform = `translateY(${((1 - fp) * 18).toFixed(2)}px) scale(${(0.96 + 0.04 * fp).toFixed(3)})`;
      }
    },
    events() { return [{ t: 0.5, type: "cross" }, { t: 0.95, type: "flip" }, { t: 1.25, type: "check" }]; },
  });

  register({
    id: "alert-list", relation: "warning", label: "分级警示列表", preferredKind: "scene",
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4).map((it, i) => ({
        title: clip(it.title, 12), detail: clip(it.detail, 18), level: i === 0 ? "high" : "mid",
      }));
      return { headline: clip(shot?.points?.headline || shot?.name, 14), items };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-v-list">
          ${(data.items || []).slice(0, 4).map((it, i) => {
            const lvl = it.level === "high" ? "high" : "mid";
            return `<div class="if-card if-v-item level-${lvl}" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <span class="if-icon" style="color:${lvl === "high" ? "var(--v-coral)" : "var(--v-amber)"}">${icon("warning")}</span>
              <div class="if-v-copy"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
              <span class="if-alert-badge">${lvl === "high" ? "高警示" : "注意"}</span>
            </div>`;
          }).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 24, baseDelay: 0.16 });
    },
    events(data, ctx) { return [{ t: 0.12, type: "warning" }, ...itemFocusEvents((data.items || []).length, ctx, "item-focus", 0.25)]; },
  });

  register({
    id: "who-not", relation: "warning", label: "禁忌人群网格", preferredKind: "scene",
    fromPoints(shot) {
      const icons = ["baby", "pregnant", "elder", "heart"];
      const groups = getItems(shot).slice(0, 4).map((it, i) => ({ label: clip(it.title, 10), icon: icons[i % 4], reason: clip(it.detail, 14) }));
      while (groups.length < 2) groups.push({ label: "特殊人群", icon: "warning", reason: "用药前先咨询" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), groups };
    },
    html(data, ctx) {
      const groups = (data.groups || []).slice(0, 4);
      const gClass = groups.length === 3 ? "g-3" : "g-2";
      return wrapStage(this, data, ctx, `
        <div class="if-icon-grid ${gClass}">
          ${groups.map((gr, i) => `
            <div class="if-card if-grid-card" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <span class="if-icon">${icon(gr.icon || "warning")}</span>
              <div style="min-width:0;padding-right:26px"><strong>${esc(gr.label)}</strong>${gr.reason ? `<span>${esc(gr.reason)}</span>` : ""}</div>
              <span class="if-ban-stamp" data-if-ban="${i}">${icon("ban")}</span>
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 14, baseDelay: 0.18 });
      dom.querySelectorAll("[data-if-ban]").forEach((el, i) => {
        const bp = easeOutExpo((t - (times[i] || 0.2) - 0.22) / 0.3);
        el.style.opacity = String(bp.toFixed(3));
        el.style.transform = `scale(${(1.5 - 0.5 * bp).toFixed(3)})`;
      });
    },
    events(data, ctx) { return [{ t: 0.15, type: "warning" }, ...itemFocusEvents((data.groups || []).length, ctx, "cross", 0.38)]; },
  });

  /* ==================== 24–26. CHECKLIST ==================== */
  register({
    id: "check-list", relation: "checklist", label: "勾选清单", preferredKind: "card",
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 4).map((it) => ({ title: clip(it.title, 12), detail: clip(it.detail, 16), tag: clip(it.tag, 8) }));
      while (items.length < 2) items.push({ title: "核对说明书", detail: "", tag: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), items };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-v-list">
          ${(data.items || []).slice(0, 4).map((it, i) => `
            <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <svg class="if-check-svg" viewBox="0 0 30 30" aria-hidden="true">
                <rect x="2" y="2" width="26" height="26" rx="8" fill="var(--v-green-soft)" stroke="var(--v-green)" stroke-width="2"/>
                <path data-if-check="${i}" d="M8.5 15.5 13 20l9-10" fill="none" stroke="var(--v-green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
              </svg>
              <div class="if-v-copy"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
              ${it.tag ? `<span class="if-tag">${esc(it.tag)}</span>` : ""}
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 12, baseDelay: 0.16 });
      dom.querySelectorAll("[data-if-check]").forEach((path, i) => {
        const cp = easeOutCubic((t - (times[i] || 0.2) - 0.15) / 0.4);
        path.setAttribute("stroke-dashoffset", String((100 * (1 - cp)).toFixed(2)));
      });
    },
    events(data, ctx) { return itemFocusEvents((data.items || []).length, ctx, "check", 0.3); },
  });

  register({
    id: "icon-grid", relation: "checklist", label: "图标网格", preferredKind: "card",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const icons = ["pill", "clock", "shield", "check", "water", "bulb"];
      const items = getItems(shot).slice(0, 6).map((it, i) => ({ title: clip(it.title, 10), detail: clip(it.detail, 14), icon: icons[i % 6] }));
      while (items.length < 2) items.push({ title: "核对要点", detail: "", icon: "check" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), items };
    },
    html(data, ctx) {
      const items = (data.items || []).slice(0, 6);
      const gClass = items.length === 3 || items.length >= 5 ? "g-3" : "g-2";
      return wrapStage(this, data, ctx, `
        <div class="if-icon-grid ${gClass}">
          ${items.map((it, i) => `
            <div class="if-card if-grid-card" data-if-item="${i}" data-anchor="item-${Math.min(i, 3)}" data-sticker-avoid>
              <span class="if-icon">${icon(it.icon || "pill")}</span>
              <div style="min-width:0"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
            </div>`).join("")}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 16, baseDelay: 0.16 });
    },
    events(data, ctx) { return itemFocusEvents(Math.min(4, (data.items || []).length), ctx, "item-focus", 0.18); },
  });

  register({
    id: "label-locate", relation: "checklist", label: "说明书定位", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide"],
    fromPoints(shot) {
      const items = getItems(shot);
      const prop = /药盒|外包装/.test(`${shot?.name || ""} ${shot?.line || ""}`) ? "carton" : "leaflet";
      return {
        headline: clip(shot?.points?.headline || shot?.name, 14), prop,
        section: clip(items[0].tag || "用法用量", 10),
        highlight: clip(items[0].title, 20),
        items: items.slice(1, 4).map((i) => clip(i.title, 14)),
      };
    },
    html(data, ctx) {
      const isCarton = data.prop === "carton";
      return wrapStage(this, data, ctx, `
        <div class="if-locate-wrap">
          <svg class="if-locate-svg" viewBox="0 0 220 210" aria-hidden="true">
            ${isCarton
              ? `<rect x="28" y="34" width="144" height="142" rx="16" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
                 <rect x="44" y="50" width="112" height="28" rx="7" fill="var(--if-accent-soft)"/>`
              : `<rect x="40" y="18" width="128" height="174" rx="14" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
                 <path d="M58 46h90M58 66h72M58 148h84M58 166h64" stroke="var(--v-ink-soft)" stroke-width="4" stroke-linecap="round" opacity="0.45"/>`}
            <rect data-if-box x="48" y="86" width="112" height="48" rx="9" fill="var(--if-accent-soft)" stroke="var(--if-accent)" stroke-width="3.5" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <text x="104" y="116" text-anchor="middle" font-size="14" font-weight="800" fill="var(--v-ink)">${esc(clip(data.section, 7))}</text>
            <g data-if-lens>
              <line x1="158" y1="146" x2="188" y2="176" stroke="var(--v-ink)" stroke-width="8" stroke-linecap="round"/>
              <circle cx="138" cy="126" r="26" fill="var(--v-primary-soft)" fill-opacity="0.45" stroke="var(--v-ink)" stroke-width="3.5"/>
            </g>
          </svg>
          <div class="if-locate-copy">
            <span class="if-step-badge">${esc(data.section)}</span>
            <div class="if-card" data-anchor="item-0" data-sticker-avoid><strong style="font-size:22px">${esc(data.highlight)}</strong></div>
            ${(data.items || []).map((s, i) => `<div class="if-card" style="padding:9px 14px" data-if-item="${i}" data-anchor="item-${i + 1}" data-sticker-avoid><span>${esc(s)}</span></div>`).join("")}
          </div>
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const lens = dom.querySelector("[data-if-lens]");
      const lp = easeOutCubic((t - 0.15) / 0.75);
      if (lens) lens.setAttribute("transform", `translate(${((1 - lp) * 34).toFixed(1)} ${((1 - lp) * 28).toFixed(1)})`);
      const box = dom.querySelector("[data-if-box]");
      if (box) box.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic((t - 0.5) / 0.55))).toFixed(2)));
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 14, baseDelay: 0.45 });
    },
    events() { return [{ t: 0.65, type: "draw" }, { t: 1.05, type: "check" }]; },
  });

  /* ==================== 27–28. MECHANISM ==================== */
  register({
    id: "cause-chain", relation: "mechanism", label: "因果链", preferredKind: "scene",
    maxItemsNarrow: 3,
    fromPoints(shot) {
      const icons = ["pill", "arrow", "shield", "check"];
      const nodes = getItems(shot).slice(0, 4).map((it, i) => ({ title: clip(it.title, 10), detail: clip(it.detail, 16), icon: icons[i % 4] }));
      while (nodes.length < 2) nodes.push({ title: "产生作用", detail: "", icon: "shield" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), nodes };
    },
    html(data, ctx) {
      const nodes = (data.nodes || []).slice(0, 4);
      const parts = nodes.map((nd, i) => {
        const card = `<div class="if-card if-chain-node" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
          <span class="if-icon">${icon(nd.icon || "pill")}</span>
          <strong style="font-size:19px">${esc(nd.title)}</strong>
          ${nd.detail ? `<span style="font-size:14.5px;color:var(--v-ink-soft)">${esc(nd.detail)}</span>` : ""}
        </div>`;
        const arrow = i < nodes.length - 1
          ? `<div class="if-chain-arrow"><svg viewBox="0 0 32 24" aria-hidden="true"><path data-if-arrow="${i}" d="M2 12h24m-6-6 6 6-6 6" fill="none" stroke="var(--if-accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg></div>`
          : "";
        return card + arrow;
      }).join("");
      return wrapStage(this, data, ctx, `<div class="if-chain-row">${parts}</div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 16, baseDelay: 0.18 });
      dom.querySelectorAll("[data-if-arrow]").forEach((arr, i) => {
        const ap = easeOutCubic((t - (times[i] || 0.2) - 0.18) / 0.42);
        arr.setAttribute("stroke-dashoffset", String((100 * (1 - ap)).toFixed(2)));
      });
    },
    events(data, ctx) { return [{ t: 0.45, type: "draw" }, ...itemFocusEvents((data.nodes || []).length, ctx, "item-focus", 0.2)]; },
  });

  register({
    id: "body-callout", relation: "mechanism", label: "部位引线标注", preferredKind: "scene",
    shapes: ["standard", "compact", "narrow", "ultrawide"],
    fromPoints(shot) {
      const src = `${shot?.name || ""} ${shot?.line || ""}`;
      const organ = /胃/.test(src) ? "stomach" : /心|血压/.test(src) ? "heart" : /眼/.test(src) ? "eye" : /体|身/.test(src) ? "body" : "pill";
      const callouts = getItems(shot).slice(0, 3).map((it) => ({ title: clip(it.title, 10), detail: clip(it.detail, 16) }));
      while (callouts.length < 2) callouts.push({ title: "作用部位", detail: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), organ, callouts };
    },
    html(data, ctx) {
      const callouts = (data.callouts || []).slice(0, 3);
      const yMap = callouts.length === 2 ? [75, 165] : [45, 120, 195];
      const visual = ctx?.artUrl ? `<img src="${esc(ctx.artUrl)}" alt="">` : icon(data.organ === "body" ? "shield" : (data.organ || "pill"));
      return wrapStage(this, data, ctx, `
        <div class="if-callout-wrap">
          <div class="if-callout-visual" data-if-art>${visual}</div>
          <svg class="if-callout-links" viewBox="0 0 56 240" aria-hidden="true">
            ${yMap.map((y, i) => `<path data-if-link="${i}" d="M0 120 C24 120, 28 ${y}, 54 ${y}" fill="none" stroke="var(--if-accent)" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>` +
              `<circle cx="52" cy="${y}" r="4" fill="var(--if-accent)"/>`).join("")}
          </svg>
          <div class="if-callout-list">
            ${callouts.map((c, i) => `
              <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
                <span class="if-v-num">${i + 1}</span>
                <div class="if-v-copy"><strong>${esc(c.title)}</strong>${c.detail ? `<span>${esc(c.detail)}</span>` : ""}</div>
              </div>`).join("")}
          </div>
        </div>`, { handlesOwnArt: true });
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const times = animateItems(dom, "[data-if-item]", t, ctx, { axis: "x", dist: 16, baseDelay: 0.25 });
      dom.querySelectorAll("[data-if-link]").forEach((p, i) => {
        const prog = easeOutCubic((t - Math.max(0.1, (times[i] || 0.25) - 0.12)) / 0.45);
        p.setAttribute("stroke-dashoffset", String((100 * (1 - prog)).toFixed(2)));
      });
    },
    events(data, ctx) { return [{ t: 0.35, type: "draw" }, ...itemFocusEvents((data.callouts || []).length, ctx, "item-focus", 0.28)]; },
  });

  /* ==================== 29–30. SUMMARY ==================== */
  register({
    id: "three-points", relation: "summary", label: "三要点收口", preferredKind: "card",
    fromPoints(shot) {
      const items = getItems(shot).slice(0, 3).map((it) => ({ title: clip(it.title, 12), detail: clip(it.detail, 16) }));
      while (items.length < 2) items.push({ title: "拿不准先问药师", detail: "" });
      return { headline: clip(shot?.points?.headline || shot?.name, 14), items, takeaway: clip(shot?.points?.takeaway || "", 22) };
    },
    html(data, ctx) {
      return wrapStage(this, data, ctx, `
        <div class="if-v-list" data-if-group>
          ${(data.items || []).slice(0, 3).map((it, i) => `
            <div class="if-card if-v-item" data-if-item="${i}" data-anchor="item-${i}" data-sticker-avoid>
              <span class="if-v-num">${i + 1}</span>
              <div class="if-v-copy"><strong>${esc(it.title)}</strong>${it.detail ? `<span>${esc(it.detail)}</span>` : ""}</div>
            </div>`).join("")}
        </div>
        ${data.takeaway ? `<p class="if-note" data-if-note data-sticker-avoid>${esc(data.takeaway)}</p>` : ""}`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      animateItems(dom, "[data-if-item]", t, ctx, { axis: "y", dist: 16, baseDelay: 0.18 });
      const grp = dom.querySelector("[data-if-group]");
      const dur = shotDuration(ctx);
      if (grp) {
        const gather = easeOutCubic((t - Math.max(1.2, dur * 0.65)) / 0.55);
        grp.style.transform = `scale(${(1 - 0.02 * gather).toFixed(4)})`;
      }
    },
    events(data, ctx) {
      const evs = itemFocusEvents((data.items || []).length, ctx, "item-focus", 0.18);
      evs.push({ t: Math.max(1.2, shotDuration(ctx) * 0.65), type: "check" });
      return evs;
    },
  });

  register({
    id: "motto", relation: "summary", label: "口诀卡", preferredKind: "card",
    shapes: ["standard", "compact", "narrow", "shallow-wide", "ultrawide", "shallow", "portrait"],
    fromPoints(shot) {
      const p = shot?.points || {};
      const it = getItems(shot)[0];
      return {
        headline: clip(p.headline || shot?.name, 14),
        motto: clip(p.takeaway || shot?.takeaway || it.title || shot?.name, 22),
        sub: clip(p.lead || it.detail || "", 24),
      };
    },
    html(data, ctx) {
      const chars = [...String(data.motto || "")].map((c, i) => `<span class="if-char" data-if-char="${i}">${esc(c)}</span>`).join("");
      return wrapStage(this, data, ctx, `
        <div class="if-motto-wrap" style="margin:0 auto" data-anchor="item-0" data-sticker-avoid>
          <span class="if-icon" style="width:46px;height:46px">${icon("shield")}</span>
          <div class="if-motto-quote">${chars}</div>
          ${data.sub ? `<div style="font-size:19px;color:var(--v-ink-soft);font-weight:650" data-if-note>${esc(data.sub)}</div>` : ""}
        </div>`);
    },
    animate(dom, data, t, ctx) {
      animateCommon(dom, t, ctx);
      const chars = [...dom.querySelectorAll("[data-if-char]")];
      const step = Math.min(0.06, 0.7 / Math.max(1, chars.length));
      chars.forEach((el, i) => {
        const p = easeOutExpo((t - 0.15 - i * step) / 0.34);
        el.style.opacity = String(p.toFixed(3));
        el.style.transform = `scale(${(0.82 + 0.18 * p).toFixed(3)}) translateY(${((1 - p) * 10).toFixed(2)}px)`;
      });
    },
    events() { return [{ t: 0.75, type: "check" }]; },
  });

  /* ==================== Registry API ==================== */
  const list = () => Object.values(FORMS);
  const get = (id) => FORMS[id] || null;
  const has = (id) => Object.prototype.hasOwnProperty.call(FORMS, id);

  function listByRelation(slotDesc) {
    const groups = [];
    for (const [rel, label] of Object.entries(RELATIONS)) {
      const forms = list().filter((f) => f.relation === rel && (!slotDesc || f.fits(slotDesc)));
      if (forms.length) groups.push({ relation: rel, label, forms });
    }
    return groups;
  }

  function nextInRelation(currentId, slotDesc) {
    const cur = get(currentId);
    const rel = cur ? cur.relation : "hook";
    const candidates = list().filter((f) => f.relation === rel && (!slotDesc || f.fits(slotDesc)));
    if (!candidates.length) return currentId || "big-answer";
    const idx = candidates.findIndex((f) => f.id === currentId);
    return candidates[(idx + 1) % candidates.length].id;
  }

  function fromPoints(formId, shot) {
    const form = get(formId) || get("big-answer");
    return form.fromPoints(shot);
  }

  function mapLegacyForm(content, shot, slotDesc) {
    if (content?.form && has(content.form)) return content.form;
    const visual = content?.visual;
    const mapped = visual && LEGACY_VISUAL_MAP[visual];
    if (mapped && (!slotDesc || get(mapped).fits(slotDesc))) return mapped;
    const rel = POINT_TYPE_RELATIONS[shot?.points?.type || "explain"] || "mechanism";
    const first = list().find((f) => f.relation === rel && (!slotDesc || f.fits(slotDesc)));
    return first ? first.id : "big-answer";
  }

  global.InfoForms = {
    RELATIONS, POINT_TYPE_RELATIONS, LEGACY_VISUAL_MAP,
    list, get, has, listByRelation, nextInRelation, fromPoints, mapLegacyForm, resolveSlot,
  };
})(globalThis);
