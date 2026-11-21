"use strict";

(function (global) {
  const clamp = n => Math.min(1, Math.max(0, n));
  const easing = {
    linear: clamp,
    outCubic: n => 1 - (1 - clamp(n)) ** 3,
    outExpo: n => {
      const x = clamp(n);
      return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
    },
    outBack: n => {
      const x = clamp(n) - 1;
      return 1 + 2.70158 * x ** 3 + 1.70158 * x ** 2;
    },
    inOutCubic: n => {
      const x = clamp(n);
      return x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
    },
    wobble: n => {
      const x = clamp(n);
      return 1 - (1 - x) ** 2 * Math.cos(x * Math.PI * 5);
    },
  };

  function progress(t, start, end) {
    return clamp((t - start) / (end - start));
  }

  function sample(track, time, index = 0) {
    const { from, to, start, end, loop, stagger = 0, ease = "linear" } = track;
    const elapsed = (time - start - stagger * index) / (end - start);
    let phase = clamp(elapsed);
    if (loop && elapsed > 0) {
      const cycle = Math.floor(elapsed);
      phase = elapsed - cycle;
      if (loop === "pingpong" && cycle % 2) phase = 1 - phase;
    }
    return from + (to - from) * easing[ease](phase);
  }

  function evaluate(tracks, time) {
    const parts = new Map();
    for (const track of tracks) {
      if (!parts.has(track.part)) parts.set(track.part, new Map());
      const channels = parts.get(track.part);
      const effectiveStart = track.start + (track.stagger || 0) * (track.index || 0);
      const selected = channels.get(track.prop);
      if (!selected || (effectiveStart <= time
        ? selected.start > time || effectiveStart >= selected.start
        : selected.start > time && effectiveStart < selected.start)) {
        channels.set(track.prop, {track, start:effectiveStart});
      }
    }
    return new Map([...parts].map(([part, channels]) => [part, Object.fromEntries([...channels].map(
      ([prop, {track}]) => [prop, sample(track,time,track.index || 0)],
    ))]));
  }

  const track = (prop, from, to, start, end, ease = "linear", extra = {}) =>
    ({prop, from, to, start, end, ease, ...extra});

  const presets = {
    float: [track("translateY",24,0,0,.35,"outCubic"), track("opacity",0,1,0,.35,"outCubic")],
    pop: [track("scale",.72,1,0,.42,"outBack"), track("opacity",0,1,0,.2)],
    wipe: [track("clip",0,1,0,.35,"outCubic")],
    outline: [track("draw",0,1,0,.45,"outCubic")],
    letters: [track("opacity",0,1,0,.22,"outCubic",{stagger:.04}), track("translateY",9,0,0,.22,"outCubic",{stagger:.04})],
    pulse: [track("scale",1,1.07,0,.24,"outCubic",{loop:"pingpong"})],
    underline: [track("draw",0,1,0,.36,"outExpo")],
    highlight: [track("clip",0,1,0,.3,"outCubic"), track("opacity",.25,.8,0,.3)],
    exit: [track("opacity",1,0,.65,1,"inOutCubic"), track("translateY",0,-16,.65,1,"outCubic")],
    pushIn: [track("scale",1,1.08,0,1)],
    pan: [track("translateX",-3,3,0,1)],
    parallax: [track("translateX",-14,14,0,1,"inOutCubic"), track("translateY",6,-6,0,1,"inOutCubic")],
    count: [track("count",0,100,0,.65,"outCubic")],
  };

  function apply(el, state) {
    const transforms = [];
    for (const [property, unit] of [["translateX","px"],["translateY","px"],["rotate","deg"],["scale",""]]) {
      if (Object.hasOwn(state,property)) transforms.push(`${property}(${state[property]}${unit})`);
    }
    if (transforms.length) el.style.transform = transforms.join(" ");
    if (state.opacity !== undefined) el.style.opacity = String(clamp(state.opacity));
    if (state.clip !== undefined) el.style.clipPath = `inset(0 ${100 * (1 - clamp(state.clip))}% 0 0)`;
    if (state.draw !== undefined) {
      el.setAttribute("pathLength","100");
      el.style.strokeDasharray = "100";
      el.style.strokeDashoffset = String((1 - clamp(state.draw)) * 100);
    }
    if (state.blur !== undefined) el.style.filter = `blur(${Math.max(0,state.blur)}px)`;
    if (state.count !== undefined) el.textContent = String(Math.round(state.count));
  }

  function transition(slot, kind, p) {
    const t = clamp(p);
    if (t >= 1) {
      slot.style.opacity = kind === "fade" ? "1" : "";
      slot.style.transform = "";
      slot.style.clipPath = "";
      slot.style.filter = "";
      return;
    }
    const eOut = easing.outCubic(t);
    const eInOut = easing.inOutCubic(t);
    let opacity = "";
    let transform = "";
    let clipPath = "";
    let filter = "";
    if (kind === "fade") {
      opacity = String(t);
    } else if (kind === "wipe") {
      clipPath = `inset(0 ${100 * (1 - t)}% 0 0)`;
    } else if (kind === "wipe-up") {
      clipPath = `inset(${100 * (1 - eInOut)}% 0 0 0)`;
    } else if (kind === "iris") {
      clipPath = `circle(${80 * t}% at 50% 50%)`;
    } else if (kind === "slide") {
      transform = `translateX(${100 * (1 - t)}%)`;
      clipPath = `inset(0 ${100 * (1 - t)}% 0 0)`;
    } else if (kind === "push-left") {
      transform = `translateX(${100 * (1 - eOut)}%)`;
      clipPath = `inset(0 ${100 * (1 - eOut)}% 0 0)`;
    } else if (kind === "slide-up") {
      transform = `translateY(${100 * (1 - eOut)}%)`;
      clipPath = `inset(0 0 ${100 * (1 - eOut)}% 0)`;
    } else if (kind === "zoom-in") {
      opacity = String(clamp(t * 1.35));
      transform = `scale(${(0.92 + 0.08 * eOut).toFixed(4)})`;
      clipPath = "inset(0)";
    } else if (kind === "zoom-out") {
      opacity = String(clamp(t * 1.35));
      transform = `scale(${(1.08 - 0.08 * eOut).toFixed(4)})`;
      clipPath = "inset(0)";
    } else if (kind === "blur") {
      opacity = String(eInOut);
      filter = `blur(${(7 * (1 - eInOut)).toFixed(2)}px)`;
      clipPath = "inset(0)";
    } else {
      opacity = String(t);
    }
    slot.style.opacity = opacity;
    slot.style.transform = transform;
    slot.style.clipPath = clipPath;
    slot.style.filter = filter;
  }

  function transitionOut(slot, kind, p) {
    const t = clamp(p);
    const eOut = easing.outCubic(t);
    const eInOut = easing.inOutCubic(t);
    let opacity = "1";
    let transform = "";
    let clipPath = "";
    let filter = "";
    if (kind === "fade") {
      opacity = String(1 - t * 0.35);
    } else if (kind === "push-left") {
      transform = `translateX(${-100 * eOut}%)`;
      clipPath = `inset(0 0 0 ${100 * eOut}%)`;
    } else if (kind === "slide") {
      transform = `translateX(${-18 * t}%)`;
      clipPath = `inset(0 0 0 ${18 * t}%)`;
      opacity = String(1 - 0.35 * t);
    } else if (kind === "slide-up") {
      transform = `translateY(${-20 * eOut}%) scale(${(1 - 0.03 * eOut).toFixed(4)})`;
      clipPath = `inset(${20 * eOut}% 0 0 0)`;
      opacity = String(1 - 0.45 * eOut);
    } else if (kind === "zoom-in") {
      opacity = String(1 - eOut);
      transform = `scale(${(1 + 0.06 * eOut).toFixed(4)})`;
      clipPath = "inset(0)";
    } else if (kind === "zoom-out") {
      opacity = String(1 - eOut);
      transform = `scale(${(1 - 0.06 * eOut).toFixed(4)})`;
      clipPath = "inset(0)";
    } else if (kind === "blur") {
      opacity = String(1 - 0.65 * eInOut);
      filter = `blur(${(7 * eInOut).toFixed(2)}px)`;
      clipPath = "inset(0)";
    }
    slot.style.opacity = opacity;
    slot.style.transform = transform;
    slot.style.clipPath = clipPath;
    slot.style.filter = filter;
  }

  global.MgKit = { clamp, easing, progress, sample, evaluate, apply, presets, transition, transitionOut };
})(globalThis);
