"use strict";

(function (global) {
  const prepared = new WeakMap();
  const disposed = new WeakSet();
  const base = (mark, fallback) => mark.d > 0 ? mark.d : fallback - mark.t;

  function timing(asset, duration, fit = "auto") {
    if (asset.kind === "mg" && fit === "auto") {
      return [{from:0,to:duration,source:0,span:asset.duration,rate:asset.duration/duration}];
    }
    const intro = asset.markers.find(mark => mark.name === "intro");
    const loop = asset.markers.find(mark => mark.name === "loop");
    const outro = asset.markers.find(mark => mark.name === "outro");
    const introLength = intro && loop ? base(intro,loop.t) : 0;
    const loopLength = loop && outro ? base(loop,outro.t) : 0;
    const outroLength = outro ? base(outro,asset.duration) : 0;
    if (fit === "auto" && introLength > 0 && loopLength >= 1 / (asset.animation?.fr || 24) &&
        outroLength > 0 && intro.t + introLength <= loop.t && loop.t + loopLength <= outro.t) {
      const scale = Math.min(1,duration / (introLength + outroLength));
      const first = introLength * scale;
      const last = duration - outroLength * scale;
      return [
        {from:0,to:first,source:intro.t,span:introLength,rate:1/scale},
        {from:first,to:last,source:loop.t,span:loopLength,rate:1,loop:true},
        {from:last,to:duration,source:outro.t,span:outroLength,rate:1/scale},
      ];
    }
    const speed = fit === "hold" ? 1 : Math.max(.75,Math.min(1.5,asset.duration / duration));
    if (fit !== "hold" && asset.duration / duration > 1.5) {
      const hold = Math.max(0,duration - 1 / 24);
      return [{from:0,to:hold,source:0,rate:speed,span:asset.duration},
        {from:hold,to:duration,source:asset.duration,rate:0,span:0}];
    }
    return [{from:0,to:duration,source:0,rate:speed,span:asset.duration}];
  }

  function animationTime(segments, time) {
    const segment = segments.find(row => time < row.to) || segments.at(-1);
    const elapsed = Math.max(0,time - segment.from) * segment.rate;
    return segment.source + (segment.loop ? elapsed % segment.span : Math.min(segment.span,elapsed));
  }

  function markerEvents(asset, segments) {
    return segments.flatMap(segment => {
      if (!segment.rate || segment.from >= segment.to) return [];
      return asset.markers.filter(mark => mark.name.startsWith("sfx:") &&
        mark.t >= segment.source && mark.t < segment.source + segment.span).flatMap(mark => {
        const first = segment.from + (mark.t - segment.source) / segment.rate;
        const step = segment.loop ? segment.span / segment.rate : Infinity;
        const events = [];
        for (let t = first; t < segment.to - 1e-9; t += step) events.push({t,type:mark.name.slice(4)});
        return events;
      });
    });
  }

  const hex = numbers => "#" + numbers.slice(0,3).map(channel =>
    Math.round(255 * Math.max(0,Math.min(1,channel))).toString(16).padStart(2,"0")).join("");
  const rgb = color => [1,3,5].map(index => parseInt(color.slice(index,index+2),16)/255);

  function currentPalette(map, theme) {
    const shell = document.createElement("span");
    shell.className = "pt-frame theme-" + (theme === "warm" ? "warm" : "medical");
    shell.hidden = true;
    shell.style.display = "none";
    document.body.append(shell);
    const computed = getComputedStyle(shell);
    const palette = Object.fromEntries(Object.entries(map || {}).map(([ink,variable]) => [ink,computed.getPropertyValue(variable).trim()]));
    shell.remove();
    return palette;
  }

  function applyPalette(source, palette) {
    const animation = structuredClone(source);
    function colors(node, edit) {
      if (Array.isArray(node)) {
        if (node.length && node.every(Number.isFinite)) edit(node);
        else node.forEach(value=>colors(value,edit));
      } else if (node && typeof node === "object") {
        for (const field of ["k","s","e"]) colors(node[field],edit);
      }
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      const swap = (array,index) => {
        const to = palette[hex(array.slice(index,index+3))];
        if (to) array.splice(index,3,...rgb(to));
      };
      if (["fl","st"].includes(node.ty)) colors(node.c, color => { if (color.length >= 3) swap(color,0); });
      if (["gf","gs"].includes(node.ty)) colors(node.g?.k, color => {
        for (let i=0;i<node.g.p*4 && i+3<color.length;i+=4) swap(color,i+1);
      });
      if (typeof node.sc === "string") node.sc = palette[node.sc.toLowerCase()] || node.sc;
      for (const entry of Object.values(node)) walk(entry);
    }
    walk(animation);
    return animation;
  }

  async function attachAnimation(host, asset, theme) {
    if (!global.lottie) throw Error("离线 Lottie 播放器未加载。");
    const animation = global.lottie.loadAnimation({container:host,renderer:"svg",autoplay:false,loop:false,
      animationData:applyPalette(asset.animation,currentPalette(asset.palette,theme)),
      rendererSettings:{preserveAspectRatio:"xMidYMid meet", progressiveLoad:false}});
    animation.setSubframe(false);
    try {
      await new Promise((resolve,reject) => {
        const timeout = setTimeout(() => reject(Error("Lottie 预览加载超时。")),4000);
        function finish(error) { clearTimeout(timeout); if (error) reject(error); else resolve(); }
        if (animation.isLoaded) finish();
        else {
          animation.addEventListener("DOMLoaded",()=>finish());
          animation.addEventListener("data_failed",()=>finish(Error("Lottie 预览无法载入。")));
          animation.addEventListener("error",()=>finish(Error("Lottie 图层无法渲染。")));
        }
      });
      return {
        draw(time) {
          const last = Math.ceil(asset.duration * asset.animation.fr) - 1;
          animation.goToAndStop(Math.max(0,Math.min(last,Math.floor(time * asset.animation.fr + 1e-8))),true);
        },
        dispose: () => animation.destroy(),
      };
    } catch (error) {
      animation.destroy();
      throw error;
    }
  }

  function attachSpec(host, asset) {
    const svg = new DOMParser().parseFromString(asset.svg,"image/svg+xml").documentElement;
    if (svg.localName !== "svg") throw Error("MG 动画 SVG 无效。");
    host.append(document.importNode(svg,true));
    const parts = new Map([...host.querySelectorAll("[data-part]")].map(node => [node.dataset.part,node]));
    return {
      draw(time) {
        for (const [name,state] of MgKit.evaluate(asset.tracks,time/asset.duration)) {
          MgKit.apply(parts.get(name),state);
        }
      },
      dispose: () => host.replaceChildren(),
    };
  }

  function overlay(slot, shot, slide) {
    if (shot.overlay === "off") return [];
    const wrapper = document.createElement("div");
    wrapper.className = "stage-mg-overlay";
    const heading = document.createElement("h2");
    heading.textContent = slide.headline || shot.name;
    wrapper.append(heading);
    const words = [];
    if (shot.overlay !== "title") {
      const list = document.createElement("ul");
      for (const point of (shot.items || []).slice(0,4)) {
        const item = document.createElement("li");
        item.textContent = point.title;
        list.append(item);
        words.push(item);
      }
      if (words.length) wrapper.append(list);
    }
    slot.append(wrapper);
    return [heading,...words];
  }

  async function prepare(shot, {theme}) {
    disposed.delete(shot);
    const asset = shot.motionAsset || (shot.motionAssetUrl ? await fetch(shot.motionAssetUrl).then(response => {
      if (!response.ok) throw Error("MG 动画素材未找到。");
      return response.json();
    }) : null);
    if (!asset) return;
    const host = document.createElement("div");
    host.className = "stage-mg-art";
    const player = asset.kind === "mg" ? attachSpec(host,asset) : await attachAnimation(host,asset,theme);
    if (disposed.has(shot)) { player.dispose(); return; }
    prepared.set(shot,{host,asset,player,segments:timing(asset,shot.end-shot.start,shot.fit)});
  }

  function mount(slot, shot, {slide}) {
    const motion = prepared.get(shot);
    if (!motion) {
      slot.innerHTML = TemplateVideo.renderFallbackCard(slide,"all");
      return {};
    }
    slot.append(motion.host);
    return {motion, text:overlay(slot,shot,slide)};
  }

  function draw(dom, shot, time) {
    if (!dom.motion) return;
    const {segments, player} = dom.motion;
    player.draw(animationTime(segments,time));
    dom.text.forEach((element,index) => {
      const tracks = index === 0 ? MgKit.presets.float : MgKit.presets.letters;
      MgKit.apply(element,Object.fromEntries(tracks.map(track=>[track.prop,MgKit.sample(track,time,index)])));
    });
  }

  function events(shot) {
    const motion = prepared.get(shot);
    return motion ? markerEvents(motion.asset,motion.segments) : [];
  }

  function dispose(shot) {
    disposed.add(shot);
    prepared.get(shot)?.player.dispose();
    prepared.delete(shot);
  }

  global.StageMotion = {timing,animationTime,applyPalette,markerEvents,attachAnimation};
  if (global.Contents) global.Contents.mg = {prepare,mount,draw,events,dispose};
})(globalThis);
