"use strict";

const svgVideoLabel = "SVG 演示动画";
let stopSvgPlayback = null;

function isSvgVideo(w) {
  return w?.type === "video" && w.videoMode === "svg";
}

function svgShotSpec(w, block) {
  return {
    title: w.title,
    name: block.name || "未命名分镜",
    action: block.action,
    ...(block.beats?.length ? { beats: block.beats.map(beat => ({
      action: beat.action, label: beat.label.trim(), line: beat.line.trim(),
    })) } : {}),
  };
}

function svgTemplateLayout(w) {
  return {
    title: w.title,
    theme: w.templateTheme || "medical",
    presenter: w.templatePresenter || "digital",
    pharmacist: { ...TemplateStudio.ensurePharmacist(data) },
  };
}

function svgTemplateDeck(w) {
  return SvgMotion.templateDeck(svgTemplateLayout(w),
    w.blocks.map(block => ({ ...svgShotSpec(w, block), line: block.line, seconds: block.seconds })));
}

function svgSpeechFor(w, block) {
  const audio = block.svgSpeech;
  return audio?.line === block.line.trim() && audio?.voice === w.settings.voice ? audio : null;
}

function svgBeatFields(block, shotIndex) {
  const options = Object.entries(config.svgMotion.actions);
  return block.beats.map((beat, index) => {
    const target = ' data-svg-shot="' + shotIndex + '" data-svg-beat="' + index + '"';
    return '<fieldset class="svg-beat-fields"><legend>动作 ' + (index + 1) + '</legend>' +
      '<label class="field">道具动作<select' + target + ' data-svg-field="action">' +
      opts(options, beat.action) + '</select></label>' +
      btn("从素材库选动效", "library-pick-motion", "textbtn", `${shotIndex}:${index}`) +
      '<label class="field">画面标签<input maxlength="10"' + target + ' data-svg-field="label" value="' +
      esc(beat.label) + '"></label>' +
      '<label class="field">口播台词<textarea rows="2" maxlength="55"' + target + ' data-svg-field="line">' +
      esc(beat.line) + '</textarea></label></fieldset>';
  }).join("");
}

function updateSvgBeat(w, el) {
  const block = w.blocks[Number(el.dataset.svgShot)];
  const beat = block?.beats?.[Number(el.dataset.svgBeat)];
  const field = el.dataset.svgField;
  if (!beat || !["action", "label", "line"].includes(field)) return;
  if (field === "action" && !Object.hasOwn(config.svgMotion.actions, el.value)) return;
  beat[field] = el.value;
  block.action = block.beats[0].action;
  block.line = block.beats.map(part => part.line.trim()).join("");
  if (w.video) w.videoDirty = true;
  changed(w);
  refreshSvgStage(w);
}

function svgShotReady(block) {
  return block.line.trim() && block.line.trim().length <= 100 &&
    !block.beats?.some(beat => !beat.label.trim() || !beat.line.trim());
}

function svgStageHtml(w, block, index) {
  const speech = svgSpeechFor(w, block);
  return '<div class="svg-stage">' +
    '<div class="tpl-preview-box" id="tpl-live-box"><div class="tpl-stage-scaler" id="tpl-live-scaler">' +
    SvgMotion.frame(svgTemplateDeck(w), index) + '</div></div>' +
    '<div class="svg-stage-controls">' +
    btn("播放动画", "svg-play", "outline", index) +
    (w.settings.voice === "无配音" ? "" :
      btn(speech ? "播放口播动画" : "生成本幕口播试听", "svg-speech", "outline", index)) +
    '<span class="small" role="status" id="svg-play-state">' +
    (speech ? '本幕口播 ' + speech.seconds.toFixed(1) + ' 秒' : '') + '</span>' +
    '<audio id="svg-play-audio" preload="none"></audio></div></div>';
}

function refreshSvgStage(w) {
  const stage = $(".svg-stage");
  if (!stage) return;
  if (stopSvgPlayback) stopSvgPlayback();
  const index = Math.max(0, w.blocks.indexOf(selectedScenes.get(w)));
  stage.outerHTML = svgStageHtml(w, w.blocks[index], index);
  TemplateStudio.fitTemplatePreviews();
}

function svgPreview(w, block, button, speech = null) {
  if (stopSvgPlayback) {
    stopSvgPlayback();
    return;
  }
  const frame = $("#tpl-live-scaler");
  const slot = frame.querySelector(".pt-media-slot");
  const subtitle = frame.querySelector(".pt-subtitle");
  const ring = frame.querySelector(".pt-avatar-ring");
  const status = $("#svg-play-state");
  const audio = $("#svg-play-audio");
  const deck = svgTemplateDeck(w);
  const index = w.blocks.indexOf(block);
  const label = button.textContent;
  const duration = speech?.seconds || block.seconds;
  const begin = performance.now();
  let request = 0;
  let lastSubtitle;
  function stop(complete = false) {
    cancelAnimationFrame(request);
    audio.pause();
    button.textContent = label;
    status.textContent = complete ? "播放完成" : "";
    stopSvgPlayback = null;
  }
  stopSvgPlayback = stop;
  button.textContent = "停止预览";
  status.textContent = speech ? "正在播放口播" : "正在播放动画";
  function tick(now) {
    if (!frame.isConnected) return stop();
    const seconds = speech ? audio.currentTime : (now - begin) / 1000;
    const values = SvgMotion.frameOptions(deck, index, seconds / duration, { subtitles: speech?.subtitles });
    slot.innerHTML = values.renderMedia();
    if (subtitle && lastSubtitle !== values.subtitleText) {
      subtitle.innerHTML = TemplateVideo.highlightText(values.subtitleText, deck.slides[index].highlightWords, "pt-sub-hl");
      lastSubtitle = values.subtitleText;
    }
    if (ring) {
      ring.querySelector(".pt-avatar-progress")?.remove();
      ring.insertAdjacentHTML("afterbegin", TemplateVideo.renderAvatarProgress(values.progress, 3.45));
    }
    if (seconds >= duration || (speech && audio.ended)) stop(true);
    else request = requestAnimationFrame(tick);
  }
  if (speech) {
    audio.src = speech.url;
    audio.currentTime = 0;
    audio.play().then(() => {
      if (stopSvgPlayback === stop) request = requestAnimationFrame(tick);
    }).catch(() => {
      if (stopSvgPlayback !== stop) return;
      stop();
      notify("无法播放本幕口播，请重试。", "warn");
    });
  } else {
    request = requestAnimationFrame(tick);
  }
}

function confirmSvgJob(w, fn, preview = false) {
  const voiced = w.settings.voice !== "无配音";
  if (voiced && !config.speechKeyPresent) {
    openApiKeys("speech");
    return;
  }
  retryPayload = fn;
  openModal(
    preview ? "确认生成本幕口播" : "确认导出 SVG 视频",
    '<p>' + (preview
      ? "豆包语音按口播字符计费。本幕配音可在导出时复用。"
      : voiced
        ? "按配音实际时长对齐每幕动画。已有口播复用，缺少配音的分镜按字符计费。"
        : "按分镜时长渲染 1280×720 MP4。") +
    '</p><div class="actions dialog-actions">' +
    btn("取消", "close", "secondary") +
    btn(preview ? "确认生成口播" : "确认导出 MP4", "confirm-paid", "primary") + "</div>",
    "confirm",
  );
}

function prepareSvgSpeech(w, index, button) {
  const block = w.blocks[index];
  const speech = svgSpeechFor(w, block);
  if (speech) return svgPreview(w, block, button, speech);
  if (!svgShotReady(block)) return notify("请补全动作标签和口播，本幕口播最多 100 字。", "warn");
  confirmSvgJob(w, () =>
    startJob(w, "svg-speech", [{ ...svgShotSpec(w, block), index, line: block.line.trim(), seconds: block.seconds }]),
    true,
  );
}

function composeSvgVideo(w) {
  if (!config.svgMotion?.exportReady) {
    notify("SVG 导出需要 Chrome、Node.js 和 FFmpeg。详见使用说明。", "warn");
    return;
  }
  if (w.blocks.some(block => !block.name.trim() || !svgShotReady(block))) {
    notify("请补全分镜标题、动作标签和口播，每幕口播最多 100 字。", "warn");
    return;
  }
  confirmSvgJob(w, () => startJob(
    w,
    "compose",
    w.blocks.map(block => ({ ...svgShotSpec(w, block), line: block.line.trim(), seconds: block.seconds })),
    {},
    { ...w.settings, ...videoMusicSettings(w), ratio: "16:9", resolution: "720p" },
  ));
}
