"use strict";

const codeMotionActs = ["轨道引入", "点阵讲解", "双轨提示", "清单做法", "盾牌收尾"];

function codeMotionAppearance(w) {
  return {
    theme: w.templateTheme || "medical",
    presenter: w.templatePresenter || "digital",
    pharmacist: { ...TemplateStudio.ensurePharmacist(data) },
  };
}

function codeMotionAvatarMode(w) {
  return w.templatePresenter ? resolveAvatarMode(w.settings.avatarMode ?? defaults.avatarMode) : "static";
}

function templateMotionData(deck) {
  const { title, shortTitle, chapters, disclaimer, theme, presenter, pharmacist } = deck;
  const visualFields = ["type", "name", "headline", "accentPhrase", "lead", "answer", "pills", "points",
    "columns", "steps", "warnings", "checks", "footerNote", "chapterIndex"];
  return {
    title, templateInfo: { shortTitle, chapters, disclaimer }, appearance: { theme, presenter, pharmacist },
    items: deck.slides.map(slide => {
      const cues = TemplateVideo.getSlideCues(slide, 22);
      return {
        line: slide.line.trim(), seconds: slide.seconds,
        tailPause: cues.some(cue => cue.focus === "outro") ? 1.15 : 0.55,
        visual: Object.fromEntries(visualFields.map(key => [key, slide[key]])),
        cues,
      };
    }),
  };
}

function adoptCodeMotionDeck(w) {
  const avatarMode = codeMotionAvatarMode(w);
  const appearance = codeMotionAppearance(w);
  w.templatePresenter = appearance.presenter;
  w.settings.avatarMode = avatarMode;
  const types = ["cover", "explain", "compare", "steps", "summary"];
  w.templateDeck = TemplateVideo.normalizeDeck({
    ...appearance, title: w.title, chapters: ["先看要点", "用药提醒"],
    slides: w.blocks.map((block, index) => ({
      ...block, type: types[index], headline: block.name, chapterIndex: index < 3 ? 0 : 1,
      layoutMode: "explain", lead: block.takeaway, footerNote: block.takeaway,
      points: (block.labels.length ? block.labels : [block.takeaway]).map(title => ({ title })),
      columns: block.labels.map(title => ({ title, points: [] })),
      steps: block.labels.map(title => ({ title })),
    })),
  });
  w.videoMode = "template";
  TemplateStudio.syncBlocksFromDeck(w);
}

function codeMotionPreviewHtml() {
  return `<div class="video-stage code-motion-preview"><iframe id="code-motion-preview" src="/code-motion.html" title="本幕画面预览"></iframe></div>
    <div class="code-motion-controls">
      <button type="button" class="outline" id="code-motion-play" disabled>播放本幕</button>
      <input type="range" id="code-motion-seek" min="0" max="5.96" step="0.04" value="4.2" aria-label="本幕播放进度" disabled>
    </div>`;
}

function refreshCodeMotionPreview(w, index, frame = app.querySelector("#code-motion-preview")) {
  const player = frame?.contentWindow;
  if (!player?.setMotionPlan) return;
  const template = TemplateStudio.isTemplateVideo(w) ? templateMotionData(w.templateDeck) : null;
  let start = 0;
  const shots = (template?.items || w.blocks).map(block => {
    const seconds = template ? block.seconds : 6;
    const chunks = template ? block.cues : TemplateVideo.splitSubtitleChunks(block.line, 23);
    const total = chunks.reduce((sum, cue) => sum + cue.weight, 0);
    let cursor = start;
    const captions = chunks.map(cue => {
      const end = cursor + seconds * cue.weight / total;
      const entry = { ...cue, start: cursor, end };
      cursor = end;
      return entry;
    });
    const end = start + seconds;
    if (captions.length) captions.at(-1).end = end;
    const shot = { ...block, start, end, captions };
    start = end;
    return shot;
  });
  player.setMotionPlan({ title: template?.title || w.title, shots, appearance: template?.appearance || codeMotionAppearance(w),
    templateInfo: template?.templateInfo });
  const seek = app.querySelector("#code-motion-seek");
  const shot = shots[index];
  seek.dataset.start = shot.start;
  seek.max = (shot.end - shot.start - 0.04).toFixed(2);
  player.drawMotionFrame(shot.start + Number(seek.value));
}

function bindCodeMotionPreview(w, index) {
  const frame = app.querySelector("#code-motion-preview");
  const seek = app.querySelector("#code-motion-seek");
  const play = app.querySelector("#code-motion-play");
  let animation;
  let resume = false;
  const draw = time => frame.contentWindow.drawMotionFrame(Number(seek.dataset.start) + time);
  const pause = () => {
    cancelAnimationFrame(animation);
    animation = undefined;
    play.textContent = "播放本幕";
  };
  frame.addEventListener("load", () => {
    refreshCodeMotionPreview(w, index, frame);
    play.disabled = false;
    seek.disabled = false;
  }, { once: true });
  seek.addEventListener("input", () => {
    pause();
    resume = true;
    draw(Number(seek.value));
  });
  play.addEventListener("click", () => {
    if (animation !== undefined) {
      pause();
      return;
    }
    const offset = resume && Number(seek.value) < Number(seek.max) ? Number(seek.value) : 0;
    resume = true;
    const start = performance.now();
    play.textContent = "暂停";
    const advance = now => {
      if (!frame.isConnected) return;
      const time = Math.min(Number(seek.max), offset + (now - start) / 1000);
      seek.value = time;
      draw(time);
      if (time < Number(seek.max)) animation = requestAnimationFrame(advance);
      else pause();
    };
    animation = requestAnimationFrame(advance);
  });
}

function codeMotionEditor(w) {
  const selected = Math.max(0, w.blocks.indexOf(selectedScenes.get(w)));
  const block = w.blocks[selected];
  const labelFields = block.labels.map((label, index) =>
    `<label class="field">图形文字 ${index + 1}<input maxlength="12" data-motion-label="${index}" data-motion-scene="${selected}" value="${esc(label)}"></label>`
  ).join("");
  const tabs = codeMotionActs.map((act, index) =>
    btn(`${index + 1}. ${act}`, "select-scene",
      "chip" + (selected === index ? " selected" : ""), index,
      `aria-pressed="${selected === index}"`)
  ).join("");
  shell(
    w, "编辑模板分镜", 1,
    `<div class="layout"><section class="sheet">
      <div class="card-head"><h2>五幕分镜</h2></div>
      <div class="chips code-motion-tabs" aria-label="选择分镜">${tabs}</div>
      ${codeMotionPreviewHtml()}
      <label class="field code-motion-title">作品标题<input maxlength="16" data-motion-title value="${esc(w.title)}"></label>
    </section><aside class="aside"><div class="sheet">
      <div class="card-head"><h2>第 ${selected + 1} 幕 · ${codeMotionActs[selected]}</h2></div>
      <div class="stack-actions">
        <label class="field">本幕标题<input maxlength="18" data-motion-scene="${selected}" data-motion-field="name" value="${esc(block.name)}"></label>
        <label class="field">口播台词<textarea maxlength="42" rows="3" data-motion-scene="${selected}" data-motion-field="line">${esc(block.line)}</textarea></label>
        <label class="field">屏显要点<input maxlength="24" data-motion-scene="${selected}" data-motion-field="takeaway" value="${esc(block.takeaway)}"></label>
        ${labelFields}
      </div>
      <div class="dividerline"></div>
      <div class="stack-actions">
        ${btn("合成 MP4", "code-motion-compose", "primary widebtn")}
        ${w.video && !w.videoDirty ? btn("查看成片", "view-draft", "secondary widebtn") : ""}
        ${btn("模型配置", "work-settings", "secondary widebtn")}
        ${btn("返回主题设置", "goto-step", "textbtn", "setup")}
      </div>
    </div></aside></div>`,
    btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
  );
  bindCodeMotionPreview(w, selected);
}

function authorizeCodeMotion(w, count, run, avatar, reuseSpeech = false) {
  if ((avatar || reuseSpeech) && w.settings.voice !== "无配音" && config.codeMotionReady) {
    if (!config.speechKeyPresent && !reuseSpeech) return openApiKeys("speech");
    if (avatar && !config.dashscopeKeyPresent && !reuseSpeech) return openApiKeys("dashscope");
    return authorizeSpeechOnly(w, count, run, {
      usesAvatar: Boolean(avatar), avatarModel: avatar?.model, avatarResolution: avatar?.resolution, reuseSpeech,
      presenterLabel: TemplateVideo.PRESENTERS.find(presenter => presenter.id === avatar?.presenter)?.name,
    });
  }
  return authorize(w, count, "code-motion", run);
}

function composeTemplateMotion(w) {
  const plan = templateMotionData(TemplateStudio.buildDeckForWork(w, data));
  if (w.job) return;
  if (plan.items.some(item => !item.line)) {
    notify("请补全每一页的口播台词", "warn");
    return;
  }
  return sendCodeMotion(w, plan);
}

function composeCodeMotion(w) {
  if (w.job) return;
  if (!w.title.trim()) {
    notify("请先填写作品标题", "warn");
    return;
  }
  const incomplete = w.blocks.findIndex(block =>
    [block.name, block.line, block.takeaway, ...block.labels].some(text => !text.trim())
  );
  if (incomplete >= 0) {
    selectScene(w, incomplete);
    notify(`请补全第 ${incomplete + 1} 幕的标题、口播和画面文字`, "warn");
    return;
  }
  const items = w.blocks.map(({ name, line, takeaway, labels }) => ({
    name: name.trim(), line: line.trim(), takeaway: takeaway.trim(), labels: labels.map(text => text.trim()),
  }));
  return sendCodeMotion(w, { title: w.title.trim(), items, appearance: codeMotionAppearance(w) });
}

function sendCodeMotion(w, { title, items, appearance, templateInfo }) {
  const avatarMode = templateInfo ? resolveAvatarMode(w.settings.avatarMode ?? defaults.avatarMode) : codeMotionAvatarMode(w);
  const avatar = w.settings.voice !== "无配音" && appearance.presenter !== "none" && avatarMode !== "static"
    ? { enabled: true, model: avatarMode, resolution: w.settings.avatarResolution || "480P",
        presenter: appearance.presenter, image: TemplateVideo.resolveAvatarSrc(appearance) }
    : null;
  return authorizeCodeMotion(w, items.length, () => {
    const job = createJob(w, "compose", items, { ...w.settings, ratio: "16:9", ...videoMusicSettings(w) });
    delete job.payload.storyboard;
    job.payload.codeMotion = true;
    job.payload.title = title.trim();
    job.payload.appearance = appearance;
    if (templateInfo) job.payload.templateInfo = templateInfo;
    if (w.video?.url) job.payload.previousVideo = w.video.url;
    if (avatar) job.payload.avatar = avatar;
    w.job = job;
    return sendJob(w);
  }, avatar, Boolean(w.video));
}
