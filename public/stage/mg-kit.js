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
    slot.style.opacity = kind === "fade" ? String(p) : "";
    slot.style.transform = kind === "slide" && p < 1 ? `translateX(${100 * (1 - p)}%)` : "";
    const clipping = {
      wipe: `inset(0 ${100 * (1 - p)}% 0 0)`,
      iris: `circle(${80 * p}% at 50% 50%)`,
      slide: `inset(0 ${100 * (1 - p)}% 0 0)`,
    };
    slot.style.clipPath = p < 1 ? clipping[kind] || "" : "";
  }

  global.MgKit = { clamp, easing, progress, sample, evaluate, apply, presets, transition };
})(globalThis);
