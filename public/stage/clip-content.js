"use strict";

(function (global) {
  const prepared = new WeakMap();
  const disposed = new WeakSet();

  function clipTime(localTime, clipDuration, shotDuration, clipSpeed = "normal") {
    const t = Math.max(0, Number(localTime) || 0);
    const dur = Number(clipDuration) || 0;
    if (dur <= 0) return t;
    const rate = clipSpeed === "slow" && dur < shotDuration
      ? Math.max(0.85, dur / Math.max(0.5, shotDuration))
      : 1;
    return Math.min(Math.max(0, dur - 1 / 30), t * rate);
  }

  function buildOverlay(slot, shot, slide) {
    if (shot.overlay === "off") return [];
    const wrapper = slot.ownerDocument.createElement("div");
    wrapper.className = "stage-mg-overlay stage-clip-overlay";
    const heading = slot.ownerDocument.createElement("h2");
    heading.dataset.anchor = "headline-end";
    heading.dataset.stickerAvoid = "";
    heading.textContent = slide?.headline || shot.name || "";
    wrapper.append(heading);
    const words = [];
    if (shot.overlay !== "title") {
      const list = slot.ownerDocument.createElement("ul");
      for (const [i, point] of (shot.items || []).slice(0, 4).entries()) {
        const item = slot.ownerDocument.createElement("li");
        item.dataset.anchor = `item-${i}`;
        item.dataset.stickerAvoid = "";
        item.textContent = point.title || "";
        if (item.textContent) {
          list.append(item);
          words.push(item);
        }
      }
      if (words.length) wrapper.append(list);
    }
    slot.append(wrapper);
    return [heading, ...words];
  }

  async function prepare(shot, { mapSrc }) {
    disposed.delete(shot);
    if (shot.clipFramesDir && shot.clipFrameCount > 0) {
      prepared.set(shot, {
        mode: "frames",
        dir: shot.clipFramesDir,
        count: shot.clipFrameCount,
        fps: shot.clipFps || 24,
        duration: shot.clipDuration || (shot.clipFrameCount / (shot.clipFps || 24)),
      });
      return;
    }
    const src = shot.clipUrl || (shot.clip ? (mapSrc ? mapSrc(shot.clip) : shot.clip) : "");
    if (!src) return;
    const video = document.createElement("video");
    video.className = "stage-clip-video";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    video.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      const done = () => { clearTimeout(timer); resolve(); };
      if (video.readyState >= 1) return done();
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("error", done, { once: true });
    });
    if (disposed.has(shot)) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    prepared.set(shot, {
      mode: "video",
      video,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (Number(shot.clipDuration) || 0),
    });
  }

  function mount(slot, shot, { slide, mapSrc }) {
    const info = prepared.get(shot);
    if (!info) {
      const poster = shot.clipPoster ? (mapSrc ? mapSrc(shot.clipPoster) : shot.clipPoster) : "";
      if (poster) {
        slot.innerHTML = `<img class="stage-clip-poster" src="${poster.replace(/"/g, "&quot;")}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`;
        return { text: buildOverlay(slot, shot, slide) };
      }
      slot.innerHTML = TemplateVideo.renderFallbackCard(slide, "all");
      return {};
    }
    if (info.mode === "frames") {
      const img = slot.ownerDocument.createElement("img");
      img.className = "stage-clip-frame";
      img.alt = "";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
      img.src = `${info.dir}/frame-00000.jpg`;
      slot.append(img);
      return { info, img, lastIdx: -1, text: buildOverlay(slot, shot, slide) };
    }
    slot.append(info.video);
    return { info, video: info.video, text: buildOverlay(slot, shot, slide) };
  }

  function draw(dom, shot, localTime) {
    const shotDur = Math.max(0.5, (Number(shot.end) || 4) - (Number(shot.start) || 0));
    if (dom.info?.mode === "frames" && dom.img) {
      const t = clipTime(localTime, dom.info.duration, shotDur, shot.clipSpeed);
      const idx = Math.max(0, Math.min(dom.info.count - 1, Math.floor(t * dom.info.fps + 1e-6)));
      if (idx !== dom.lastIdx) {
        dom.img.src = `${dom.info.dir}/frame-${String(idx).padStart(5, "0")}.jpg`;
        dom.lastIdx = idx;
      }
    } else if (dom.video) {
      const target = clipTime(localTime, dom.info.duration, shotDur, shot.clipSpeed);
      if (dom.video.readyState >= 1 && Math.abs(dom.video.currentTime - target) > 0.12) {
        try { dom.video.currentTime = target; } catch {}
      }
    }
    (dom.text || []).forEach((element, index) => {
      if (!global.MgKit) return;
      const tracks = index === 0 ? MgKit.presets.float : MgKit.presets.letters;
      MgKit.apply(element, Object.fromEntries(tracks.map((track) => [track.prop, MgKit.sample(track, localTime, index)])));
    });
  }

  function dispose(shot) {
    disposed.add(shot);
    const info = prepared.get(shot);
    if (info?.video) {
      info.video.removeAttribute("src");
      info.video.load();
    }
    prepared.delete(shot);
  }

  global.StageClip = { clipTime };
  if (global.Contents) {
    global.Contents.clip = { prepare, mount, draw, isStatic: () => false, events: () => [], dispose };
  }
})(globalThis);
