"use strict";

(function (global) {
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const easeOutCubic = (n) => 1 - (1 - clamp(n)) ** 3;
  const easeOutExpo = (n) => {
    const x = clamp(n);
    return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const DEFAULT_BY_VISUAL = {
    hook: { motion: "focus-zoom", motif: "pill", tone: "primary" },
    mechanism: { motion: "reveal", motif: "pill", tone: "primary" },
    compare: { motion: "contrast", motif: "none", tone: "primary" },
    steps: { motion: "flow", motif: "none", tone: "primary" },
    timeline: { motion: "flow", motif: "clock", tone: "warm" },
    checklist: { motion: "spotlight", motif: "checklist", tone: "safe" },
    warning: { motion: "pulse", motif: "alert", tone: "caution" },
    summary: { motion: "focus-zoom", motif: "shield", tone: "safe" },
  };

  const LEGACY_FIVE = ["hook", "mechanism", "compare", "checklist", "summary"];

  function normalizeItems(shot) {
    if (Array.isArray(shot.items) && shot.items.length) {
      return shot.items.slice(0, 4).map((it) =>
        typeof it === "string"
          ? { title: it.trim(), detail: "", tag: "" }
          : {
              title: String(it?.title || "").trim(),
              detail: String(it?.detail || "").trim(),
              tag: String(it?.tag || "").trim(),
            }
      ).filter((it) => it.title);
    }
    if (Array.isArray(shot.labels) && shot.labels.length) {
      return shot.labels.slice(0, 4).map((l) => ({ title: String(l || "").trim(), detail: "", tag: "" })).filter((it) => it.title);
    }
    return [];
  }

  function resolveSceneMeta(shot, index, total) {
    const items = normalizeItems(shot);
    let visual = shot.visual;
    if (!visual || !DEFAULT_BY_VISUAL[visual]) {
      if (total === 5 && !shot.visual) visual = LEGACY_FIVE[index];
      else if (index === 0) visual = "hook";
      else if (index === total - 1 && items.length === 0) visual = "summary";
      else visual = items.length >= 2 ? "checklist" : "mechanism";
    }
    const fallback = DEFAULT_BY_VISUAL[visual];
    return {
      visual,
      motion: shot.motion || fallback.motion,
      motif: shot.motif || fallback.motif,
      tone: shot.tone || fallback.tone,
      items,
      listTitle: String(shot.listTitle || "").trim(),
      takeaway: String(shot.takeaway || "").trim(),
    };
  }

  /* ===== 12 Cohesive Medical Vector Motifs (theme-aware & time-driven) ===== */
  function motifMarkup(motif, uid) {
    switch (motif) {
      case "pill":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <linearGradient id="cm-pill-a-${uid}" x2="1" y2="1"><stop stop-color="var(--v-primary-soft)"/><stop offset="1" stop-color="var(--v-primary)"/></linearGradient>
            <linearGradient id="cm-pill-b-${uid}" x2="1" y2="1"><stop stop-color="var(--v-coral-soft)"/><stop offset="1" stop-color="var(--v-coral)"/></linearGradient>
          </defs>
          <g fill="none">
            <circle cx="110" cy="110" r="88" stroke="var(--v-card-border)" stroke-width="2"/>
            <circle cx="110" cy="110" r="66" stroke="var(--cm-accent)" stroke-dasharray="3 6" stroke-width="2"/>
          </g>
          <g data-motif-part="orbit">
            <circle cx="176" cy="110" r="4.5" fill="var(--v-primary)"/>
            <circle cx="110" cy="44" r="3.5" fill="var(--v-coral)"/>
            <circle cx="62" cy="156" r="4" fill="var(--v-green)"/>
          </g>
          <g data-motif-part="capsule">
            <path d="M58 110a26 26 0 0 1 26-26h26v52H84a26 26 0 0 1-26-26Z" fill="url(#cm-pill-a-${uid})"/>
            <path d="M110 84h26a26 26 0 1 1 0 52h-26Z" fill="url(#cm-pill-b-${uid})"/>
            <path d="M76 99q5-6 15-6h38" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-opacity=".55" stroke-linecap="round"/>
          </g>
        </svg>`;

      case "bottle":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <g data-motif-part="carton">
            <rect x="44" y="42" width="132" height="142" rx="18" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
            <rect x="60" y="60" width="100" height="32" rx="8" fill="var(--cm-accent-soft)"/>
            <path d="M62 112h82M62 130h66M62 148h74" stroke="var(--v-ink-soft)" stroke-width="4" stroke-linecap="round" opacity=".55"/>
            <rect data-motif-part="scan" x="56" y="102" width="108" height="58" rx="10" fill="none" stroke="var(--cm-accent)" stroke-width="3.5" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          </g>
          <g data-motif-part="lens">
            <line x1="158" y1="154" x2="184" y2="180" stroke="var(--v-ink)" stroke-width="8" stroke-linecap="round"/>
            <circle cx="140" cy="136" r="24" fill="var(--v-primary-soft)" fill-opacity=".45" stroke="var(--v-ink)" stroke-width="3.5"/>
          </g>
        </svg>`;

      case "clock":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="82" fill="var(--v-card-bg)" stroke="var(--v-card-border)" stroke-width="3"/>
          <circle data-motif-part="arc" cx="110" cy="110" r="68" fill="none" stroke="var(--cm-accent)" stroke-width="8" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 110 110)" opacity=".32"/>
          <path d="M110 40v12M180 110h-12M110 180v-12M40 110h12" stroke="var(--v-ink-soft)" stroke-width="3.5" stroke-linecap="round"/>
          <line data-motif-part="hour" x1="110" y1="110" x2="144" y2="128" stroke="var(--v-ink)" stroke-width="6" stroke-linecap="round"/>
          <g data-motif-part="minute"><line x1="110" y1="118" x2="110" y2="56" stroke="var(--cm-accent)" stroke-width="5" stroke-linecap="round"/></g>
          <circle cx="110" cy="110" r="7" fill="var(--v-ink)"/>
        </svg>`;

      case "dropper":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <g data-motif-part="bottle">
            <rect x="84" y="24" width="52" height="58" rx="14" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
            <path d="M97 82h26l-6 26h-14Z" fill="var(--cm-accent-soft)" stroke="var(--v-ink)" stroke-width="3" stroke-linejoin="round"/>
            <rect x="95" y="38" width="30" height="24" rx="6" fill="var(--cm-accent)"/>
          </g>
          <line x1="110" y1="114" x2="110" y2="174" stroke="var(--v-card-border)" stroke-width="2" stroke-dasharray="4 5"/>
          <path data-motif-part="drop" d="M110 118c9 14 14 21 14 28a14 14 0 1 1-28 0c0-7 5-14 14-28Z" fill="var(--v-primary)"/>
          <ellipse data-motif-part="ripple1" cx="110" cy="184" rx="42" ry="11" fill="none" stroke="var(--v-primary)" stroke-width="2.5"/>
          <ellipse data-motif-part="ripple2" cx="110" cy="184" rx="64" ry="16" fill="none" stroke="var(--v-primary)" stroke-width="2" opacity=".45"/>
        </svg>`;

      case "thermometer":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <rect x="88" y="28" width="44" height="122" rx="22" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
          <circle cx="110" cy="162" r="32" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
          <rect x="101" y="54" width="18" height="106" rx="9" fill="var(--v-coral-soft)"/>
          <rect data-motif-part="mercury" x="101" y="54" width="18" height="106" rx="9" fill="var(--v-coral)" style="transform-origin:110px 160px"/>
          <circle cx="110" cy="162" r="21" fill="var(--v-coral)"/>
          <path d="M142 54h16M142 74h12M142 94h16M142 114h12" stroke="var(--v-ink-soft)" stroke-width="3" stroke-linecap="round"/>
          <path data-motif-part="heat" d="M50 74q-10 16 0 32M66 64q-10 16 0 32" fill="none" stroke="var(--v-coral)" stroke-width="3" stroke-linecap="round"/>
        </svg>`;

      case "heart":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <circle data-motif-part="ring" cx="110" cy="110" r="84" fill="none" stroke="var(--v-card-border)" stroke-width="2" stroke-dasharray="4 6"/>
          <g data-motif-part="heart">
            <path d="M110 170c-38-25-64-50-64-80a35 35 0 0 1 64-19 35 35 0 0 1 64 19c0 30-26 55-64 80Z" fill="var(--v-coral-soft)" stroke="var(--v-coral)" stroke-width="3.5" stroke-linejoin="round"/>
          </g>
          <path data-motif-part="ecg" d="M40 112h36l11-24 14 48 14-36 10 12h55" fill="none" stroke="var(--v-primary)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        </svg>`;

      case "stomach":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <path d="M44 134c18 32 50 46 84 40 28-5 48-24 52-52" fill="none" stroke="var(--v-primary)" stroke-width="5" stroke-linecap="round"/>
          <path data-motif-part="coat" d="M56 122c14 24 40 34 68 29 21-4 36-18 40-39" fill="none" stroke="var(--v-green)" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          <g data-motif-part="pilldrop">
            <rect x="86" y="42" width="48" height="26" rx="13" fill="var(--cm-accent)" stroke="var(--v-card-bg)" stroke-width="2.5"/>
            <line x1="110" y1="42" x2="110" y2="68" stroke="#ffffff" stroke-width="2.5" opacity=".7"/>
          </g>
          <circle cx="72" cy="86" r="6" fill="var(--v-amber)" opacity=".65"/>
          <circle cx="152" cy="82" r="5" fill="var(--v-primary)" opacity=".55"/>
        </svg>`;

      case "body":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <rect x="34" y="42" width="152" height="136" rx="22" fill="var(--v-card-bg)" stroke="var(--v-card-border)" stroke-width="2.5"/>
          <path data-motif-part="wave1" d="M52 92q28-24 58 0t58 0" fill="none" stroke="var(--v-primary)" stroke-width="4.5" stroke-linecap="round"/>
          <path data-motif-part="wave2" d="M52 128q28 24 58 0t58 0" fill="none" stroke="var(--v-coral)" stroke-width="4.5" stroke-linecap="round"/>
          <g data-motif-part="ion1">
            <circle cx="76" cy="70" r="16" fill="var(--v-primary-soft)" stroke="var(--v-primary)" stroke-width="2.5"/>
            <text x="76" y="75" text-anchor="middle" font-size="13" font-weight="800" fill="var(--v-primary-deep)">Ca</text>
          </g>
          <g data-motif-part="ion2">
            <circle cx="146" cy="148" r="16" fill="var(--v-amber-soft)" stroke="var(--v-amber)" stroke-width="2.5"/>
            <text x="146" y="153" text-anchor="middle" font-size="13" font-weight="800" fill="#9c5609">K</text>
          </g>
        </svg>`;

      case "alert":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <circle data-motif-part="radar1" cx="110" cy="116" r="54" fill="none" stroke="var(--v-coral)" stroke-width="2.5"/>
          <circle data-motif-part="radar2" cx="110" cy="116" r="76" fill="none" stroke="var(--v-coral)" stroke-width="2"/>
          <g data-motif-part="tri">
            <path d="M110 42 178 164H42Z" fill="var(--v-coral-soft)" stroke="var(--v-coral)" stroke-width="4" stroke-linejoin="round"/>
            <path data-motif-part="bang" d="M110 86v42" stroke="var(--v-coral)" stroke-width="7" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
            <circle cx="110" cy="144" r="4.8" fill="var(--v-coral)"/>
          </g>
        </svg>`;

      case "shield":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <linearGradient id="cm-shield-${uid}" x2="0" y2="1"><stop stop-color="var(--cm-accent-soft)"/><stop offset="1" stop-color="var(--v-card-bg)"/></linearGradient>
          </defs>
          <g data-motif-part="rings" fill="none">
            <circle cx="110" cy="110" r="88" stroke="var(--v-card-border)" stroke-width="2"/>
            <circle cx="110" cy="110" r="70" stroke="var(--cm-accent)" stroke-dasharray="3 6" stroke-width="2"/>
          </g>
          <g data-motif-part="shield">
            <path d="M110 38 168 62v46c0 40-26 65-58 79-32-14-58-39-58-79V62Z" fill="url(#cm-shield-${uid})" stroke="var(--cm-accent)" stroke-width="3.5" stroke-linejoin="round"/>
            <path data-motif-part="check" d="M84 112l19 19 36-38" fill="none" stroke="var(--cm-accent)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dashoffset="100" stroke-dasharray="100"/>
          </g>
        </svg>`;

      case "checklist":
        return `<svg viewBox="0 0 220 220" aria-hidden="true">
          <rect x="46" y="38" width="128" height="150" rx="16" fill="var(--v-card-bg)" stroke="var(--v-ink)" stroke-width="3"/>
          <rect x="82" y="26" width="56" height="22" rx="7" fill="var(--cm-accent)"/>
          <path data-motif-part="tick1" d="M68 84l7 7 14-15" fill="none" stroke="var(--v-green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          <path data-motif-part="tick2" d="M68 118l7 7 14-15" fill="none" stroke="var(--v-green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          <path data-motif-part="tick3" d="M68 152l7 7 14-15" fill="none" stroke="var(--v-green)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
          <path d="M100 84h54M100 118h54M100 152h42" stroke="var(--v-ink-soft)" stroke-width="4.5" stroke-linecap="round" opacity=".5"/>
        </svg>`;

      default:
        return "";
    }
  }

  function animateMotif(container, motif, time) {
    if (!container || motif === "none") return;
    const part = (name) => container.querySelector(`[data-motif-part="${name}"]`);
    const setDash = (el, p) => {
      if (el) el.setAttribute("stroke-dashoffset", String((100 * (1 - easeOutCubic(p))).toFixed(2)));
    };
    if (motif === "pill") {
      const orbit = part("orbit");
      const cap = part("capsule");
      if (orbit) orbit.setAttribute("transform", `rotate(${(time * 24).toFixed(2)} 110 110)`);
      if (cap) cap.setAttribute("transform", `translate(0 ${(Math.sin(time * 2.2) * 5).toFixed(2)}) rotate(${(-24 + Math.sin(time * 1.4) * 5).toFixed(2)} 110 110)`);
    } else if (motif === "bottle") {
      const carton = part("carton");
      const lens = part("lens");
      if (carton) carton.setAttribute("transform", `rotate(${(-4 + 6 * easeOutCubic(time / 0.9)).toFixed(2)} 110 110)`);
      setDash(part("scan"), (time - 0.25) / 0.9);
      if (lens) {
        const slide = easeOutCubic((time - 0.15) / 0.85);
        lens.setAttribute("transform", `translate(${((1 - slide) * 24).toFixed(2)} ${((1 - slide) * 18 + Math.sin(time * 2) * 3).toFixed(2)})`);
      }
    } else if (motif === "clock") {
      const minute = part("minute");
      if (minute) minute.setAttribute("transform", `rotate(${(18 + 115 * easeOutCubic(time / 1.4) + time * 12).toFixed(2)} 110 110)`);
      setDash(part("arc"), (time - 0.15) / 1.1);
    } else if (motif === "dropper") {
      const bottle = part("bottle");
      const drop = part("drop");
      const r1 = part("ripple1");
      const r2 = part("ripple2");
      if (bottle) bottle.setAttribute("transform", `rotate(${(Math.sin(time * 2.2) * 4).toFixed(2)} 110 60)`);
      const cycle = (time * 0.55) % 1;
      const fall = easeOutCubic(Math.min(1, cycle * 1.35));
      if (drop) {
        drop.setAttribute("transform", `translate(0 ${(fall * 42).toFixed(2)}) scale(${(0.82 + 0.18 * Math.min(1, cycle * 3)).toFixed(3)})`);
        drop.style.opacity = String(cycle > 0.82 ? Math.max(0, 1 - (cycle - 0.82) / 0.18) : 1);
      }
      if (r1) r1.style.opacity = String((0.35 + 0.65 * Math.max(0, Math.sin(cycle * Math.PI))).toFixed(2));
      if (r2) r2.style.opacity = String((0.15 + 0.45 * Math.max(0, Math.sin((cycle - 0.12) * Math.PI))).toFixed(2));
    } else if (motif === "thermometer") {
      const mercury = part("mercury");
      const heat = part("heat");
      const level = 0.35 + 0.52 * easeOutCubic(time / 1.1) + 0.04 * Math.sin(time * 2.5);
      if (mercury) mercury.style.transform = `scaleY(${clamp(level).toFixed(3)})`;
      if (heat) heat.style.opacity = String((0.45 + 0.45 * Math.sin(time * 3)).toFixed(2));
    } else if (motif === "heart") {
      const heart = part("heart");
      const ring = part("ring");
      const beat = 1 + 0.035 * Math.max(0, Math.sin(time * 4.2));
      if (heart) heart.setAttribute("transform", `translate(110 112) scale(${beat.toFixed(3)}) translate(-110 -112)`);
      if (ring) ring.setAttribute("transform", `rotate(${(time * 14).toFixed(2)} 110 110)`);
      setDash(part("ecg"), (time - 0.1) / 1.15);
    } else if (motif === "stomach") {
      const pill = part("pilldrop");
      const descend = easeOutCubic(time / 1.0);
      if (pill) pill.setAttribute("transform", `translate(0 ${(descend * 44 + Math.sin(time * 2.4) * 3.5).toFixed(2)})`);
      setDash(part("coat"), (time - 0.25) / 1.0);
    } else if (motif === "body") {
      const i1 = part("ion1");
      const i2 = part("ion2");
      if (i1) i1.setAttribute("transform", `translate(${(Math.sin(time * 1.8) * 5).toFixed(2)} ${(Math.cos(time * 2.1) * 4).toFixed(2)})`);
      if (i2) i2.setAttribute("transform", `translate(${(Math.cos(time * 1.7) * 5).toFixed(2)} ${(Math.sin(time * 2.0) * 4).toFixed(2)})`);
    } else if (motif === "alert") {
      const r1 = part("radar1");
      const r2 = part("radar2");
      const p1 = (time * 0.55) % 1;
      const p2 = (time * 0.55 + 0.5) % 1;
      if (r1) {
        r1.setAttribute("transform", `translate(110 116) scale(${(0.8 + p1 * 0.48).toFixed(3)}) translate(-110 -116)`);
        r1.style.opacity = String(((1 - p1) * 0.65).toFixed(2));
      }
      if (r2) {
        r2.setAttribute("transform", `translate(110 116) scale(${(0.76 + p2 * 0.42).toFixed(3)}) translate(-110 -116)`);
        r2.style.opacity = String(((1 - p2) * 0.45).toFixed(2));
      }
      setDash(part("bang"), (time - 0.12) / 0.55);
    } else if (motif === "shield") {
      const enter = easeOutExpo(time / 0.85);
      const pulse = 1 + 0.018 * Math.sin(time * 2.8);
      const shield = part("shield");
      const rings = part("rings");
      if (shield) shield.setAttribute("transform", `translate(110 110) scale(${((0.84 + 0.16 * enter) * pulse).toFixed(3)}) translate(-110 -110)`);
      if (rings) rings.setAttribute("transform", `rotate(${(time * 10).toFixed(2)} 110 110)`);
      setDash(part("check"), (time - 0.35) / 0.75);
    } else if (motif === "checklist") {
      setDash(part("tick1"), (time - 0.18) / 0.5);
      setDash(part("tick2"), (time - 0.65) / 0.5);
      setDash(part("tick3"), (time - 1.12) / 0.5);
    }
  }

  /* ===== 8 Content-Adaptive Scene DOM Builders ===== */
  function buildDynamicSceneHtml(shot, index, total) {
    const meta = resolveSceneMeta(shot, index, total);
    const { visual, motif, tone, items, listTitle, takeaway } = meta;
    const uid = `s${index}`;
    const hasMotif = Boolean(shot.libraryArtUrl) || motif !== "none";
    const motifHtml = shot.libraryArtUrl
      ? `<img class="cm-library-art" src="${esc(shot.libraryArtUrl)}" alt="">`
      : hasMotif ? motifMarkup(motif, uid) : "";
    const count = items.length;
    const headerInline = hasMotif && ["compare", "steps", "timeline", "warning"].includes(visual);

    const headerHtml = visual === "hook"
      ? ""
      : `<div class="cm-header${headerInline ? " is-left" : ""}">
          ${headerInline ? `<div class="cm-inline-motif" data-cm-motif>${motifHtml}</div>` : ""}
          <h2 class="cm-heading" data-cm-heading>${esc(shot.name)}</h2>
        </div>`;

    let bodyHtml = "";

    if (visual === "hook") {
      bodyHtml = `<div class="cm-hook-wrap${hasMotif ? "" : " no-motif"}">
        ${hasMotif ? `<div class="cm-hook-motif-box" data-cm-motif>${motifHtml}</div>` : ""}
        <div class="cm-hook-copy">
          <h2 class="cm-hook-question" data-cm-heading>${esc(shot.name)}</h2>
          ${takeaway ? `<div class="cm-hook-answer" data-cm-answer>${esc(takeaway)}</div>` : ""}
          ${count ? `<div class="cm-hook-pills">${items.map((it, i) => `
            <span class="cm-hook-pill" data-cm-item="${i}">
              <span class="cm-hook-pill-dot"></span>
              <span>${esc(it.title)}</span>
            </span>`).join("")}</div>` : ""}
        </div>
      </div>`;
    } else if (visual === "mechanism") {
      if (hasMotif && count >= 1 && count <= 3) {
        const yMap = count === 1 ? [135] : count === 2 ? [92, 178] : [48, 135, 222];
        const paths = yMap.map((y, i) =>
          `<path data-cm-connector="${i}" d="M 0 135 C 24 135, 24 ${y}, 52 ${y}" fill="none" stroke="var(--cm-accent)" stroke-width="3" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>` +
          `<circle data-cm-dot="${i}" cx="52" cy="${y}" r="4.5" fill="var(--cm-accent)"/>`
        ).join("");
        bodyHtml = `<div class="cm-mech-split">
          <div class="cm-mech-motif" data-cm-motif>${motifHtml}</div>
          <svg class="cm-mech-links" viewBox="0 0 52 270" aria-hidden="true">${paths}</svg>
          <div class="cm-mech-stack">${items.map((it, i) => `
            <div class="cm-item cm-mech-card" data-cm-item="${i}">
              <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
              <div class="cm-mech-head">
                <div class="cm-mech-title-wrap">
                  <span class="cm-mech-index">${i + 1}</span>
                  <h3>${esc(it.title)}</h3>
                </div>
                ${it.tag ? `<span class="cm-tag">${esc(it.tag)}</span>` : ""}
              </div>
              ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
            </div>`).join("")}</div>
        </div>`;
      } else {
        bodyHtml = `<div class="cm-mech-grid count-${Math.max(1, count)}">${items.map((it, i) => `
          <div class="cm-item cm-mech-card" data-cm-item="${i}">
            <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
            <div class="cm-mech-head">
              <div class="cm-mech-title-wrap">
                <span class="cm-mech-index">${i + 1}</span>
                <h3>${esc(it.title)}</h3>
              </div>
              ${it.tag ? `<span class="cm-tag">${esc(it.tag)}</span>` : ""}
            </div>
            ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
          </div>`).join("")}</div>`;
      }
    } else if (visual === "compare") {
      const colCount = Math.max(2, Math.min(3, count));
      const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>`;
      bodyHtml = `<div class="cm-compare-wrap count-${colCount}">
        ${colCount === 2 ? `<div class="cm-compare-divider" data-cm-divider></div>` : ""}
        ${items.slice(0, colCount).map((it, i) => {
          const parts = it.detail ? it.detail.split(/[；;\n]+/).map((p) => p.trim()).filter(Boolean) : [];
          return `<div class="cm-item cm-compare-col col-${i}" data-cm-item="${i}">
            <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
            <div class="cm-compare-head">
              <span class="cm-compare-chip">${esc(it.title)}</span>
              ${it.tag ? `<span class="cm-compare-badge">${esc(it.tag)}</span>` : ""}
            </div>
            ${parts.length > 1
              ? `<ul class="cm-compare-list">${parts.map((p) => `<li>${checkSvg}<span>${esc(p)}</span></li>`).join("")}</ul>`
              : parts.length === 1
                ? `<p class="cm-compare-single">${esc(parts[0])}</p>`
                : ""}
          </div>`;
        }).join("")}
      </div>`;
    } else if (visual === "steps") {
      const stepCount = Math.max(2, Math.min(4, count));
      const centers = Array.from({ length: stepCount }, (_, i) => ((i + 0.5) * 896) / stepCount);
      const railStart = centers[0];
      const railEnd = centers[stepCount - 1];
      const trackSvg = `<svg viewBox="0 0 896 46" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <line x1="${railStart}" y1="23" x2="${railEnd}" y2="23" stroke="var(--v-card-border)" stroke-width="5" stroke-linecap="round"/>
        <line data-cm-progress-rail x1="${railStart}" y1="23" x2="${railEnd}" y2="23" stroke="var(--cm-accent)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        ${centers.map((cx, i) => `
          <circle data-cm-node="${i}" cx="${cx}" cy="23" r="14" fill="var(--v-card-bg)" stroke="var(--cm-accent)" stroke-width="4"/>
          <circle data-cm-node-fill="${i}" cx="${cx}" cy="23" r="6.5" fill="var(--cm-accent)"/>
        `).join("")}
      </svg>`;
      bodyHtml = `<div class="cm-steps-wrap">
        <div class="cm-steps-track">${trackSvg}</div>
        <div class="cm-steps-cards count-${stepCount}">${items.slice(0, stepCount).map((it, i) => `
          <div class="cm-item cm-step-card" data-cm-item="${i}">
            <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
            <div class="cm-step-top">
              <span class="cm-step-num">第 ${i + 1} 步</span>
            </div>
            <h3>${esc(it.title)}</h3>
            ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
            ${it.tag ? `<div class="cm-step-tag">${esc(it.tag)}</div>` : ""}
          </div>`).join("")}</div>
      </div>`;
    } else if (visual === "timeline") {
      const nodeCount = Math.max(2, Math.min(4, count));
      const centers = Array.from({ length: nodeCount }, (_, i) => ((i + 0.5) * 896) / nodeCount);
      const axisSvg = `<svg viewBox="0 0 896 44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <line x1="${centers[0]}" y1="18" x2="${centers[nodeCount - 1]}" y2="18" stroke="var(--v-card-border)" stroke-width="5" stroke-linecap="round"/>
        <line data-cm-progress-rail x1="${centers[0]}" y1="18" x2="${centers[nodeCount - 1]}" y2="18" stroke="var(--cm-accent)" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
        ${centers.map((cx, i) => `
          <line data-cm-drop="${i}" x1="${cx}" y1="22" x2="${cx}" y2="44" stroke="var(--cm-accent)" stroke-width="3" stroke-dasharray="3 3"/>
          <circle data-cm-node="${i}" cx="${cx}" cy="18" r="11" fill="var(--v-card-bg)" stroke="var(--cm-accent)" stroke-width="4"/>
          <circle data-cm-node-fill="${i}" cx="${cx}" cy="18" r="5" fill="var(--cm-accent)"/>
        `).join("")}
      </svg>`;
      bodyHtml = `<div class="cm-timeline-wrap">
        <div class="cm-timeline-tags count-${nodeCount}">${items.slice(0, nodeCount).map((it, i) => `
          <div><span class="cm-time-pill" data-cm-pill="${i}">${esc(it.tag || `时机 ${i + 1}`)}</span></div>`).join("")}</div>
        <div class="cm-timeline-axis">${axisSvg}</div>
        <div class="cm-timeline-cards count-${nodeCount}">${items.slice(0, nodeCount).map((it, i) => `
          <div class="cm-item cm-time-card" data-cm-item="${i}">
            <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
            <h3>${esc(it.title)}</h3>
            ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
          </div>`).join("")}</div>
      </div>`;
    } else if (visual === "checklist") {
      bodyHtml = `<div class="cm-check-layout">
        ${hasMotif ? `<div class="cm-check-motif" data-cm-motif>${motifHtml}</div>` : ""}
        <div class="cm-check-card">
          <div class="cm-check-head">${esc(listTitle || "核心核对要点")}</div>
          <div class="cm-check-rows">${items.map((it, i) => `
            <div class="cm-item cm-check-row" data-cm-item="${i}">
              <svg class="cm-check-box" viewBox="0 0 30 30" aria-hidden="true">
                <rect x="2" y="2" width="26" height="26" rx="8" fill="var(--v-green-soft)" stroke="var(--v-green)" stroke-width="2"/>
                <path data-cm-check="${i}" d="M8.5 15.5 13 20l9-10" fill="none" stroke="var(--v-green)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>
              </svg>
              <div class="cm-check-text">
                <strong>${esc(it.title)}</strong>
                ${it.detail ? `<span>${esc(it.detail)}</span>` : ""}
              </div>
              ${it.tag ? `<span class="cm-tag">${esc(it.tag)}</span>` : ""}
            </div>`).join("")}</div>
        </div>
      </div>`;
    } else if (visual === "warning") {
      const warnIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></svg>`;
      bodyHtml = `<div class="cm-warn-grid count-${Math.max(1, count)}">${items.map((it, i) => `
        <div class="cm-item cm-warn-card" data-cm-item="${i}">
          <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
          <div class="cm-warn-icon">${warnIcon}</div>
          <div class="cm-warn-body">
            <div class="cm-warn-head">
              <h3>${esc(it.title)}</h3>
              ${it.tag ? `<span class="cm-tag">${esc(it.tag)}</span>` : ""}
            </div>
            ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
          </div>
        </div>`).join("")}</div>`;
    } else {
      // summary
      if (count === 0) {
        bodyHtml = `<div class="cm-summary-hero">
          ${hasMotif ? `<div class="cm-summary-emblem" data-cm-motif>${motifHtml}</div>` : ""}
        </div>`;
      } else {
        bodyHtml = `<div class="cm-summary-split">
          ${hasMotif ? `<div class="cm-summary-side" data-cm-motif>${motifHtml}</div>` : ""}
          <div class="cm-summary-list">${items.map((it, i) => `
            <div class="cm-item cm-summary-row" data-cm-item="${i}">
              <span class="cm-item-accent-bar" data-cm-bar="${i}"></span>
              <span class="cm-summary-num">${i + 1}</span>
              <div class="cm-summary-copy">
                <strong>${esc(it.title)}</strong>
                ${it.detail ? `<span>${esc(it.detail)}</span>` : ""}
              </div>
              ${it.tag ? `<span class="cm-tag">${esc(it.tag)}</span>` : ""}
            </div>`).join("")}</div>
        </div>`;
      }
    }

    const showBottomTakeaway = Boolean(takeaway) && visual !== "hook";
    return `<div class="cm-stage tone-${esc(tone)}">
      <section class="cm-scene visual-${esc(visual)}" data-cm-scene>
        ${headerHtml}
        <div class="cm-body">${bodyHtml}</div>
        ${showBottomTakeaway ? `<div class="cm-takeaway" data-cm-takeaway>${esc(takeaway)}</div>` : ""}
      </section>
    </div>`;
  }

  /* ===== Beat & Choreography Timing Helpers ===== */
  function resolveActiveFocus(shot, localTime, itemCount, motion) {
    const duration = Math.max(0.5, shot.end - shot.start);
    const absTime = shot.start + localTime;
    const captions = shot.captions || [];
    const cue = captions.find((c) => absTime < c.end) || captions.at(-1);
    let focus = cue?.focus || "all";

    // Find when the first non-opening beat starts (for two-stage hook/reveal transitions)
    const distinctFocuses = [];
    for (const c of captions) {
      const f = c.focus || "all";
      if (!distinctFocuses.length || distinctFocuses.at(-1).focus !== f) {
        distinctFocuses.push({ focus: f, start: c.start - shot.start });
      }
    }
    const secondBeatStart = distinctFocuses.length > 1
      ? distinctFocuses[1].start
      : Math.min(duration * 0.45, Math.max(1.2, (captions[1]?.start ?? (shot.start + duration * 0.45)) - shot.start));

    // When focus is "all" on spotlight/flow/contrast with multiple items, infer progressive item focus cleanly
    let focusedIndices = null;
    if (focus === "top") focusedIndices = new Set([0, 1]);
    else if (focus === "bottom") focusedIndices = new Set([2, 3]);
    else if (/^[0-3]$/.test(focus)) focusedIndices = new Set([Number(focus)]);
    else if (focus === "all" && itemCount >= 2 && (motion === "spotlight" || motion === "contrast") && localTime > 0.55) {
      const span = Math.max(0.6, duration - 1.0);
      const progress = (localTime - 0.45) / span;
      if (progress < 0.92) {
        focusedIndices = new Set([Math.min(itemCount - 1, Math.floor(progress * itemCount))]);
      }
    }

    return { cue, focus, distinctFocuses, secondBeatStart, focusedIndices, duration };
  }

  /* ===== Apply 6 Distinct Motion Choreographies to Dynamic Scene ===== */
  function animateDynamicScene(dom, shot, meta, localTime) {
    const { visual, motion, motif, items } = meta;
    const itemCount = items.length;
    const { focus, secondBeatStart, focusedIndices, duration } = resolveActiveFocus(shot, localTime, itemCount, motion);

    // 1. Scene-level crisp entrance
    const sceneEnter = easeOutExpo(localTime / 0.34);
    dom.scene.style.opacity = String(sceneEnter.toFixed(3));

    // 2. Motif animation (continuous + entrance)
    if (dom.motif) {
      const mEnter = easeOutExpo((localTime - 0.05) / 0.55);
      dom.motif.style.opacity = String(mEnter.toFixed(3));
      const mScale = 0.9 + 0.1 * mEnter;
      dom.motif.style.transform = `scale(${mScale.toFixed(3)})`;
      animateMotif(dom.motif, motif, localTime);
    }

    // 3. Heading entrance tailored to motion
    if (dom.heading) {
      const hEnter = easeOutExpo(localTime / 0.46);
      if (motion === "reveal") {
        const rightClip = (100 * (1 - hEnter)).toFixed(1);
        dom.heading.style.clipPath = `inset(0 ${rightClip}% 0 0)`;
        dom.heading.style.opacity = "1";
        dom.heading.style.transform = "none";
      } else if (motion === "focus-zoom") {
        dom.heading.style.clipPath = "none";
        dom.heading.style.opacity = String(hEnter.toFixed(3));
        dom.heading.style.transform = `translateY(${((1 - hEnter) * 14).toFixed(2)}px) scale(${(0.95 + 0.05 * hEnter).toFixed(3)})`;
      } else {
        dom.heading.style.clipPath = "none";
        dom.heading.style.opacity = String(hEnter.toFixed(3));
        dom.heading.style.transform = `translateY(${((1 - hEnter) * 12).toFixed(2)}px)`;
      }
    }

    // 4. Hook answer reveal (two-stage question -> answer choreography)
    if (dom.answer) {
      const answerAt = focus === "question" ? duration + 1 : Math.min(secondBeatStart, duration * 0.42);
      const revealAt = shot.captions?.some((c) => c.focus === "question") ? secondBeatStart : Math.min(0.65, answerAt);
      const aProg = easeOutExpo((localTime - revealAt + 0.12) / 0.54);
      dom.answer.style.opacity = String(aProg.toFixed(3));
      dom.answer.style.transform = `translateY(${((1 - aProg) * 16).toFixed(2)}px) scale(${(0.96 + 0.04 * aProg).toFixed(3)})`;
    }

    // 5. Divider & progress rail animations
    if (dom.divider) {
      const dProg = easeOutExpo((localTime - 0.18) / 0.55);
      dom.divider.style.transform = `scaleY(${dProg.toFixed(3)})`;
    }
    if (dom.progressRail) {
      const span = Math.max(1.2, duration * 0.72);
      const rProg = easeOutCubic((localTime - 0.22) / span);
      dom.progressRail.setAttribute("stroke-dashoffset", String((100 * (1 - rProg)).toFixed(2)));
    }
    dom.connectors.forEach((path, i) => {
      const cProg = easeOutCubic((localTime - 0.24 - i * 0.22) / 0.55);
      path.setAttribute("stroke-dashoffset", String((100 * (1 - cProg)).toFixed(2)));
    });
    dom.dots.forEach((dot, i) => {
      const dProg = easeOutCubic((localTime - 0.55 - i * 0.22) / 0.28);
      dot.style.opacity = String(dProg.toFixed(3));
    });
    dom.nodes.forEach((node, i) => {
      const at = 0.18 + i * Math.min(0.45, (duration * 0.55) / Math.max(1, itemCount));
      const nProg = easeOutExpo((localTime - at) / 0.35);
      node.style.opacity = String(nProg.toFixed(3));
      const fill = dom.nodeFills[i];
      if (fill) {
        const active = !focusedIndices || focusedIndices.has(i);
        fill.style.opacity = String((nProg * (active ? 1 : 0.35)).toFixed(3));
      }
    });
    dom.pills.forEach((pill, i) => {
      const at = 0.14 + i * 0.2;
      const pProg = easeOutExpo((localTime - at) / 0.42);
      pill.style.opacity = String(pProg.toFixed(3));
      pill.style.transform = `translateY(${((1 - pProg) * -8).toFixed(2)}px)`;
    });

    // 6. Item choreography by `motion`
    const stepWindow = Math.min(0.55, Math.max(0.18, (duration * 0.52) / Math.max(1, itemCount)));
    dom.items.forEach((el, i) => {
      const isFocused = focusedIndices ? focusedIndices.has(i) : false;
      const isDimmed = Boolean(focusedIndices && !isFocused);
      el.classList.toggle("is-active", isFocused);

      let opacity = 1;
      let transform = "none";
      let clipPath = "none";
      let filter = "none";

      if (motion === "reveal") {
        const at = 0.16 + i * 0.22;
        const p = easeOutExpo((localTime - at) / 0.55);
        opacity = (isDimmed ? 0.48 : 1) * p;
        transform = `translateY(${((1 - p) * 14).toFixed(2)}px)`;
        clipPath = `inset(0 0 ${(100 * (1 - p)).toFixed(1)}% 0)`;
      } else if (motion === "spotlight") {
        const p = easeOutExpo((localTime - 0.08 - i * 0.08) / 0.42);
        const dim = isDimmed ? 0.44 : 1;
        const scale = isFocused ? 1.024 : isDimmed ? 0.985 : 1;
        opacity = p * dim;
        transform = `translateY(${((1 - p) * 10).toFixed(2)}px) scale(${scale.toFixed(3)})`;
        filter = isDimmed ? "saturate(0.58)" : "none";
      } else if (motion === "flow") {
        const at = 0.16 + i * stepWindow;
        const p = easeOutExpo((localTime - at) / 0.5);
        const dim = isDimmed ? 0.52 : 1;
        const scale = isFocused ? 1.02 : 0.96 + 0.04 * p;
        opacity = p * dim;
        transform = `translateX(${((1 - p) * -22).toFixed(2)}px) scale(${scale.toFixed(3)})`;
      } else if (motion === "contrast") {
        const at = 0.14 + i * 0.22;
        const p = easeOutExpo((localTime - at) / 0.54);
        const dir = itemCount === 3 && i === 1 ? 0 : i % 2 === 0 ? -1 : 1;
        const dim = isDimmed ? 0.52 : 1;
        const scale = isFocused ? 1.022 : 1;
        opacity = p * dim;
        transform = `translateX(${((1 - p) * dir * 32).toFixed(2)}px) scale(${scale.toFixed(3)})`;
        filter = isDimmed ? "saturate(0.62)" : "none";
      } else if (motion === "pulse") {
        const at = 0.14 + i * 0.18;
        const p = easeOutExpo((localTime - at) / 0.46);
        const pulseScale = isFocused || (!focusedIndices && p >= 0.95)
          ? 1 + 0.012 * (0.5 + 0.5 * Math.sin(localTime * 3.4 - i * 0.8))
          : 1;
        const dim = isDimmed ? 0.48 : 1;
        opacity = p * dim;
        transform = `scale(${((0.95 + 0.05 * p) * pulseScale).toFixed(3)})`;
      } else {
        // focus-zoom
        const baseDelay = visual === "hook"
          ? (shot.captions?.some((c) => c.focus === "question") ? secondBeatStart + 0.08 : 0.5)
          : 0.16;
        const at = baseDelay + i * 0.14;
        const p = easeOutExpo((localTime - at) / 0.48);
        const dim = isDimmed ? 0.5 : 1;
        opacity = p * dim;
        transform = `translateY(${((1 - p) * 16).toFixed(2)}px) scale(${(0.93 + 0.07 * p).toFixed(3)})`;
      }

      el.style.opacity = String(opacity.toFixed(3));
      el.style.transform = transform;
      el.style.clipPath = clipPath;
      el.style.filter = filter;

      // Top accent bar sweep per item (clean full-width sweep, dimmed opacity rather than partial stub)
      const bar = dom.bars[i];
      if (bar) {
        const barProg = isFocused
          ? 1
          : easeOutCubic((localTime - (0.24 + i * 0.2)) / 0.5);
        bar.style.transform = `scaleX(${clamp(barProg).toFixed(3)})`;
        bar.style.opacity = isDimmed ? "0.28" : "1";
      }

      // Checklist SVG checkmark draw synced to item entrance / beat
      const check = dom.checks[i];
      if (check) {
        const checkAt = 0.28 + i * stepWindow;
        const cProg = isFocused ? 1 : easeOutCubic((localTime - checkAt) / 0.46);
        check.setAttribute("stroke-dashoffset", String((100 * (1 - cProg)).toFixed(2)));
      }
    });

    // 7. Bottom takeaway bar reveal
    if (dom.takeaway) {
      const actionBeat = shot.captions?.find((c) => c.focus === "action");
      const takeawayAt = actionBeat
        ? Math.max(0.25, actionBeat.start - shot.start - 0.1)
        : Math.min(Math.max(0.65, secondBeatStart - 0.15), duration * 0.62);
      const tProg = easeOutExpo((localTime - takeawayAt) / 0.52);
      if (motion === "pulse") {
        dom.takeaway.style.opacity = String(Math.min(1, tProg * 1.4).toFixed(3));
        dom.takeaway.style.clipPath = `inset(0 ${(100 * (1 - tProg)).toFixed(1)}% 0 0)`;
        dom.takeaway.style.transform = "none";
      } else {
        dom.takeaway.style.clipPath = "none";
        dom.takeaway.style.opacity = String(tProg.toFixed(3));
        dom.takeaway.style.transform = `translateY(${((1 - tProg) * 12).toFixed(2)}px)`;
      }
    }
  }

  /* ===== Content-Adapted Choreography for Template Decks switched to Code Motion ===== */
  function resolveTemplateMotion(slide) {
    const explicit = slide?.motionStyle;
    if (explicit && explicit !== "auto") return explicit;
    switch (slide?.type) {
      case "cover": return "focus-zoom";
      case "compare": return "contrast";
      case "steps": return "flow";
      case "warning": return "pulse";
      case "summary": return "flow";
      default: return (slide?.points?.length || 0) >= 2 ? "spotlight" : "reveal";
    }
  }

  function animateTemplateCard(dom, slide, localTime, focus, duration) {
    const motion = resolveTemplateMotion(slide);
    if (dom.headline) {
      const h = easeOutExpo(localTime / 0.45);
      dom.headline.style.opacity = String(h.toFixed(3));
      if (motion === "reveal") {
        dom.headline.style.clipPath = `inset(0 ${(100 * (1 - h)).toFixed(1)}% 0 0)`;
        dom.headline.style.transform = "none";
      } else {
        dom.headline.style.clipPath = "none";
        dom.headline.style.transform = `translateY(${((1 - h) * 10).toFixed(2)}px)`;
      }
    }
    const items = dom.targets;
    const count = items.length;
    const stepDelay = Math.min(0.28, Math.max(0.09, (duration * 0.35) / Math.max(1, count)));

    items.forEach((el, i) => {
      const isDimmed = el.classList.contains("is-dimmed");
      const isFocused = el.classList.contains("is-focused");
      const baseOpacity = isDimmed ? 0.38 : 1;

      if (motion === "contrast") {
        const p = easeOutExpo((localTime - 0.1 - i * 0.14) / 0.5);
        const dir = count === 3 && i === 1 ? 0 : i % 2 === 0 ? -1 : 1;
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `translateX(${((1 - p) * dir * 28).toFixed(2)}px) scale(${isFocused ? "1.02" : "1"})`;
        el.style.clipPath = "none";
      } else if (motion === "flow") {
        const p = easeOutExpo((localTime - 0.12 - i * stepDelay) / 0.48);
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `translateX(${((1 - p) * -20).toFixed(2)}px) scale(${(0.96 + 0.04 * p).toFixed(3)})`;
        el.style.clipPath = "none";
      } else if (motion === "pulse") {
        const p = easeOutExpo((localTime - 0.1 - i * 0.12) / 0.44);
        const pulse = isFocused || focus === "all"
          ? 1 + 0.011 * (0.5 + 0.5 * Math.sin(localTime * 3.2 - i * 0.7))
          : 1;
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `scale(${((0.95 + 0.05 * p) * pulse).toFixed(3)})`;
        el.style.clipPath = "none";
      } else if (motion === "reveal") {
        const p = easeOutExpo((localTime - 0.12 - i * 0.16) / 0.52);
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `translateY(${((1 - p) * 12).toFixed(2)}px)`;
        el.style.clipPath = `inset(0 0 ${(100 * (1 - p)).toFixed(1)}% 0)`;
      } else if (motion === "focus-zoom") {
        const p = easeOutExpo((localTime - 0.12 - i * 0.12) / 0.48);
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `translateY(${((1 - p) * 14).toFixed(2)}px) scale(${(0.93 + 0.07 * p).toFixed(3)})`;
        el.style.clipPath = "none";
      } else {
        // spotlight
        const p = easeOutExpo((localTime - 0.08 - i * 0.09) / 0.42);
        const scale = isFocused ? 1.022 : isDimmed ? 0.985 : 1;
        el.style.opacity = String((baseOpacity * p).toFixed(3));
        el.style.transform = `translateY(${((1 - p) * 10).toFixed(2)}px) scale(${scale.toFixed(3)})`;
        el.style.clipPath = "none";
      }
    });

    if (dom.tipBar) {
      const tipAt = focus === "action" ? 0.1 : Math.min(0.65, duration * 0.45);
      const tp = easeOutExpo((localTime - tipAt) / 0.48);
      dom.tipBar.style.opacity = String(tp.toFixed(3));
      if (motion === "pulse") {
        dom.tipBar.style.clipPath = `inset(0 ${(100 * (1 - tp)).toFixed(1)}% 0 0)`;
        dom.tipBar.style.transform = "none";
      } else {
        dom.tipBar.style.clipPath = "none";
        dom.tipBar.style.transform = `translateY(${((1 - tp) * 10).toFixed(2)}px)`;
      }
    }
  }

  global.StageSceneContent = { resolveSceneMeta, resolveActiveFocus, buildDynamicSceneHtml, animateDynamicScene, animateTemplateCard };
})(globalThis);
