"use strict";

const CODE_MOTION_VISUALS = [
  { id: "hook", name: "破题直答", short: "破题", minItems: 0, maxItems: 3, defaultMotion: "focus-zoom", defaultMotif: "pill", defaultTone: "primary" },
  { id: "mechanism", name: "原理解析", short: "原理", minItems: 1, maxItems: 4, defaultMotion: "reveal", defaultMotif: "pill", defaultTone: "primary" },
  { id: "compare", name: "对比辨析", short: "对比", minItems: 2, maxItems: 3, defaultMotion: "contrast", defaultMotif: "none", defaultTone: "primary" },
  { id: "steps", name: "实操步骤", short: "步骤", minItems: 2, maxItems: 4, defaultMotion: "flow", defaultMotif: "none", defaultTone: "primary" },
  { id: "timeline", name: "时间决策", short: "时机", minItems: 2, maxItems: 4, defaultMotion: "flow", defaultMotif: "clock", defaultTone: "warm" },
  { id: "checklist", name: "核对清单", short: "清单", minItems: 2, maxItems: 4, defaultMotion: "spotlight", defaultMotif: "checklist", defaultTone: "safe" },
  { id: "warning", name: "风险警示", short: "警示", minItems: 1, maxItems: 4, defaultMotion: "pulse", defaultMotif: "alert", defaultTone: "caution" },
  { id: "summary", name: "收口守护", short: "收口", minItems: 0, maxItems: 4, defaultMotion: "focus-zoom", defaultMotif: "shield", defaultTone: "safe" },
];

const CODE_MOTION_MOTIONS = [
  { id: "focus-zoom", name: "聚焦揭晓", short: "聚焦" },
  { id: "reveal", name: "渐进揭示", short: "揭示" },
  { id: "spotlight", name: "逐项聚光", short: "聚光" },
  { id: "flow", name: "递进串联", short: "串联" },
  { id: "contrast", name: "左右对冲", short: "对冲" },
  { id: "pulse", name: "警示节律", short: "警示" },
];

const CODE_MOTION_MOTIFS = [
  { id: "none", name: "无额外图形（纯排版）" },
  { id: "pill", name: "胶囊药片" },
  { id: "bottle", name: "药盒扫描" },
  { id: "clock", name: "服药时钟" },
  { id: "dropper", name: "滴管滴眼液" },
  { id: "thermometer", name: "临床体温计" },
  { id: "heart", name: "心血管波形" },
  { id: "stomach", name: "胃肠护膜" },
  { id: "body", name: "肌骨电解质" },
  { id: "alert", name: "警示雷达" },
  { id: "shield", name: "安心盾牌" },
  { id: "checklist", name: "核对记录板" },
];

const CODE_MOTION_TONES = [
  { id: "primary", name: "医疗主色" },
  { id: "warm", name: "温和提醒" },
  { id: "caution", name: "警示珊瑚" },
  { id: "safe", name: "安心防护" },
];

window.CODE_MOTION_MOTION_CHOICES = [
  ["auto", "自动按内容匹配"],
  ...CODE_MOTION_MOTIONS.map((m) => [m.id, m.name]),
];

const LEGACY_FIVE_VISUALS = ["hook", "mechanism", "compare", "checklist", "summary"];
const codeMotionInspectorTab = new WeakMap();

function codeMotionVisualSpec(id) {
  return CODE_MOTION_VISUALS.find((v) => v.id === id) || CODE_MOTION_VISUALS[1];
}

function codeMotionMotionSpec(id) {
  return CODE_MOTION_MOTIONS.find((m) => m.id === id) || CODE_MOTION_MOTIONS[1];
}

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

function normalizeCodeMotionBlock(block, index, total, chapterCount) {
  const rawItems = Array.isArray(block.items) && block.items.length
    ? block.items
    : Array.isArray(block.labels)
      ? block.labels.map((title) => ({ title: String(title || ""), detail: "", tag: "" }))
      : [];
  let visual = block.visual;
  if (!CODE_MOTION_VISUALS.some((v) => v.id === visual)) {
    if (total === 5 && !block.visual) visual = LEGACY_FIVE_VISUALS[index];
    else if (index === 0) visual = "hook";
    else if (index === total - 1 && !rawItems.length) visual = "summary";
    else visual = rawItems.length >= 2 ? "checklist" : "mechanism";
  }
  const spec = codeMotionVisualSpec(visual);
  const items = rawItems.slice(0, spec.maxItems).map((it) =>
    typeof it === "string"
      ? { title: it, detail: "", tag: "" }
      : { title: String(it?.title ?? ""), detail: String(it?.detail ?? ""), tag: String(it?.tag ?? "") }
  );
  const motion = CODE_MOTION_MOTIONS.some((m) => m.id === block.motion) ? block.motion : spec.defaultMotion;
  const motif = CODE_MOTION_MOTIFS.some((m) => m.id === block.motif) ? block.motif : spec.defaultMotif;
  const tone = CODE_MOTION_TONES.some((t) => t.id === block.tone) ? block.tone : spec.defaultTone;
  const line = String(block.line || "");
  const fallbackChap = total === 5 && chapterCount === 2
    ? (index < 3 ? 0 : 1)
    : Math.min(Math.max(0, chapterCount - 1), Math.floor((index * chapterCount) / Math.max(1, total)));
  const chapterIndex = Number.isInteger(block.chapterIndex)
    ? Math.max(0, Math.min(Math.max(0, chapterCount - 1), block.chapterIndex))
    : fallbackChap;
  const seconds = Math.max(4, Number(block.seconds) || recommendedShotSeconds(spokenChars(line)));
  block.name = String(block.name || `第 ${index + 1} 幕`);
  block.chapterIndex = chapterIndex;
  block.visual = visual;
  block.motion = motion;
  block.motif = motif;
  block.tone = tone;
  block.line = line;
  block.takeaway = String(block.takeaway || "");
  block.listTitle = String(block.listTitle || "");
  block.items = items;
  block.labels = items.map((it) => it.title);
  block.seconds = seconds;
  if (!Array.isArray(block.beats)) block.beats = [];
  return block;
}

function normalizeCodeMotionWork(w) {
  const defaultShort = String(w.title || w.topic || "用药科普").replace(/[？?！!。，,：:]+/g, " ").trim().slice(0, 12);
  w.motionMeta ||= {};
  if (!Array.isArray(w.motionMeta.chapters) || w.motionMeta.chapters.length < 2) {
    w.motionMeta.chapters = ["先看要点", "用药提醒"];
  }
  w.motionMeta.chapters = w.motionMeta.chapters.slice(0, 5);
  if (w.motionMeta.shortTitle === undefined) w.motionMeta.shortTitle = defaultShort;
  if (w.motionMeta.disclaimer === undefined) w.motionMeta.disclaimer = TemplateVideo.DEFAULT_DISCLAIMER;
  const total = w.blocks.length;
  const chapCount = w.motionMeta.chapters.length;
  w.blocks.forEach((block, idx) => normalizeCodeMotionBlock(block, idx, total, chapCount));
  return w.motionMeta;
}

function installCodeMotionDraft(w, output) {
  const chapters = Array.isArray(output.chapters) && output.chapters.length >= 2
    ? output.chapters.slice(0, 5)
    : ["先看要点", "用药提醒"];
  const blocks = (output.scenes || []).map((scene, index, list) =>
    normalizeCodeMotionBlock({ ...scene }, index, list.length, chapters.length)
  );
  installDraft(w, {
    title: output.title,
    motionMeta: {
      shortTitle: output.shortTitle || "",
      chapters,
      disclaimer: output.disclaimer || TemplateVideo.DEFAULT_DISCLAIMER,
    },
    blocks,
  });
}

function templateMotionData(deck) {
  const { title, shortTitle, chapters, disclaimer, theme, presenter, pharmacist } = deck;
  const visualFields = ["type", "name", "headline", "accentPhrase", "lead", "answer", "pills", "points",
    "columns", "steps", "warnings", "checks", "footerNote", "chapterIndex", "motionStyle"];
  return {
    title, templateInfo: { shortTitle, chapters, disclaimer }, appearance: { theme, presenter, pharmacist },
    items: deck.slides.map((slide) => {
      const cues = TemplateVideo.getSlideCues(slide, 22);
      return {
        line: slide.line.trim(), seconds: slide.seconds,
        tailPause: cues.some((cue) => cue.focus === "outro") ? 1.15 : 0.55,
        visual: Object.fromEntries(visualFields.map((key) => [key, slide[key]])),
        cues,
      };
    }),
  };
}

function adoptCodeMotionDeck(w) {
  const meta = normalizeCodeMotionWork(w);
  const avatarMode = codeMotionAvatarMode(w);
  const appearance = codeMotionAppearance(w);
  w.templatePresenter = appearance.presenter;
  w.settings.avatarMode = avatarMode;
  const visualToType = {
    hook: "cover",
    mechanism: "explain",
    compare: "compare",
    steps: "steps",
    timeline: "steps",
    checklist: "explain",
    warning: "warning",
    summary: "summary",
  };
  w.templateDeck = TemplateVideo.normalizeDeck({
    ...appearance,
    title: w.title,
    shortTitle: meta.shortTitle || w.title,
    chapters: [...meta.chapters],
    disclaimer: meta.disclaimer || TemplateVideo.DEFAULT_DISCLAIMER,
    slides: w.blocks.map((block) => {
      const type = visualToType[block.visual] || "explain";
      const items = block.items || [];
      return {
        type,
        name: block.name,
        headline: block.name,
        chapterIndex: block.chapterIndex,
        layoutMode: type === "cover" ? "hook" : "explain",
        question: type === "cover" ? block.name : "",
        answer: type === "cover" ? block.takeaway : "",
        lead: block.takeaway,
        footerNote: block.takeaway,
        pills: type === "cover" ? items.map((it) => it.title).slice(0, 3) : [],
        points: (items.length ? items : [{ title: block.takeaway || block.name, detail: "", tag: "" }])
          .map((it) => ({ title: it.title, desc: it.detail, tag: it.tag })),
        columns: items.map((it) => ({
          title: it.title,
          badge: it.tag,
          points: it.detail ? it.detail.split(/[；;\n]+/).map((s) => s.trim()).filter(Boolean) : [],
        })),
        steps: items.map((it) => ({ title: it.title, desc: it.detail, key: it.tag })),
        warnings: items.map((it) => ({ title: it.title, desc: it.detail })),
        line: block.line,
        beats: block.beats,
        seconds: block.seconds,
        motionStyle: block.motion || "auto",
      };
    }),
  });
  w.videoMode = "template";
  TemplateStudio.syncBlocksFromDeck(w);
}

function codeMotionPreviewHtml() {
  return `<div class="video-stage code-motion-preview"><iframe id="code-motion-preview" src="/code-motion.html" title="本幕画面预览"></iframe></div>
    <div class="code-motion-controls">
      <button type="button" class="outline" id="code-motion-play" disabled>播放本幕</button>
      <input type="range" id="code-motion-seek" min="0" max="5.96" step="0.04" value="2.2" aria-label="本幕播放进度" disabled>
      <span class="code-motion-clock" id="code-motion-clock">0.0s / 6.0s</span>
    </div>`;
}

function buildCodeMotionPreviewShots(w, template) {
  let start = 0;
  return (template?.items || w.blocks).map((block) => {
    const seconds = template
      ? Math.max(4, Number(block.seconds) || 6)
      : Math.max(4, Number(block.seconds) || recommendedShotSeconds(spokenChars(block.line || "")));
    let captions = [];
    if (template) {
      const chunks = block.cues;
      const total = chunks.reduce((sum, cue) => sum + cue.weight, 0) || 1;
      let cursor = start;
      captions = chunks.map((cue) => {
        const end = cursor + (seconds * cue.weight) / total;
        const entry = { ...cue, start: cursor, end };
        cursor = end;
        return entry;
      });
    } else if (Array.isArray(block.beats) && block.beats.length) {
      const raw = [];
      block.beats.forEach((beat, bi) => {
        const chunks = TemplateVideo.splitSubtitleChunks(beat.line, 22);
        const list = chunks.length ? chunks : [{ text: beat.line || "", weight: 1 }];
        list.forEach((chunk) => {
          raw.push({
            text: chunk.text,
            weight: chunk.weight,
            focus: beat.focus || "all",
            beatIndex: bi,
            highlightWords: beat.highlightWords || [],
          });
        });
      });
      const total = raw.reduce((sum, cue) => sum + cue.weight, 0) || 1;
      let cursor = start;
      captions = raw.map((cue) => {
        const end = cursor + (seconds * cue.weight) / total;
        const entry = { ...cue, start: cursor, end };
        cursor = end;
        return entry;
      });
    } else {
      const chunks = TemplateVideo.splitSubtitleChunks(block.line, 23);
      const list = chunks.length ? chunks : [{ text: block.line || "", weight: 1 }];
      const total = list.reduce((sum, cue) => sum + cue.weight, 0) || 1;
      let cursor = start;
      captions = list.map((cue) => {
        const end = cursor + (seconds * cue.weight) / total;
        const entry = { ...cue, start: cursor, end };
        cursor = end;
        return entry;
      });
    }
    const end = start + seconds;
    if (captions.length) captions.at(-1).end = end;
    const shot = {
      ...block, start, end, captions,
      ...(block.libraryArtId ? { libraryArtUrl: StudioAssets.url(block.libraryArtId) } : {}),
    };
    start = end;
    return shot;
  });
}

function updateCodeMotionClock(offset, maxSec) {
  const clock = app.querySelector("#code-motion-clock");
  if (clock) clock.textContent = `${Number(offset).toFixed(1)}s / ${Number(maxSec).toFixed(1)}s`;
}

function refreshCodeMotionPreview(w, index, frame = app.querySelector("#code-motion-preview")) {
  const player = frame?.contentWindow;
  if (!player?.setMotionPlan) return;
  const template = TemplateStudio.isTemplateVideo(w) ? templateMotionData(w.templateDeck) : null;
  const meta = template ? null : normalizeCodeMotionWork(w);
  const shots = buildCodeMotionPreviewShots(w, template);
  const safeIndex = Math.max(0, Math.min(shots.length - 1, index));
  player.setMotionPlan({
    title: template?.title || w.title,
    shortTitle: template ? undefined : (meta.shortTitle || w.title),
    chapters: template ? undefined : meta.chapters,
    disclaimer: template ? undefined : meta.disclaimer,
    shots,
    appearance: template?.appearance || codeMotionAppearance(w),
    templateInfo: template?.templateInfo,
    fontId: template ? undefined : w.settings.fontId,
  });
  const seek = app.querySelector("#code-motion-seek");
  const shot = shots[safeIndex];
  if (!shot || !seek) return;
  const duration = Math.max(0.2, shot.end - shot.start);
  const maxVal = Math.max(0.04, duration - 0.04);
  seek.dataset.start = String(shot.start);
  seek.dataset.duration = String(duration);
  seek.max = maxVal.toFixed(2);
  if (Number(seek.value) > maxVal) seek.value = Math.min(maxVal, duration * 0.55).toFixed(2);
  const offset = Number(seek.value);
  updateCodeMotionClock(offset, duration);
  player.drawMotionFrame(shot.start + offset);
}

function bindCodeMotionPreview(w, index) {
  const frame = app.querySelector("#code-motion-preview");
  const seek = app.querySelector("#code-motion-seek");
  const play = app.querySelector("#code-motion-play");
  if (!frame || !seek || !play) return;
  let animation;
  let resume = false;
  const sfx = !TemplateStudio.isTemplateVideo(w) && w.blocks[index]?.sfxId;
  const sound = sfx ? new Audio(StudioAssets.url(sfx)) : null;
  const draw = (time) => {
    const start = Number(seek.dataset.start || 0);
    const dur = Number(seek.dataset.duration || seek.max || 6);
    updateCodeMotionClock(time, dur);
    frame.contentWindow?.drawMotionFrame?.(start + time);
  };
  const pause = () => {
    sound?.pause();
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
    const maxVal = Number(seek.max);
    const offset = resume && Number(seek.value) < maxVal ? Number(seek.value) : 0;
    let soundPending = Boolean(sound && offset <= 0.16);
    if (sound) sound.currentTime = 0;
    resume = true;
    const start = performance.now();
    play.textContent = "暂停";
    const advance = (now) => {
      if (!frame.isConnected) {
        pause();
        return;
      }
      const time = Math.min(maxVal, offset + (now - start) / 1000);
      seek.value = time.toFixed(2);
      draw(time);
      if (soundPending && time >= 0.16) {
        soundPending = false;
        sound.volume = 10 ** (-12 / 20);
        sound.play().catch(() => {});
      }
      if (time < maxVal) animation = requestAnimationFrame(advance);
      else pause();
    };
    animation = requestAnimationFrame(advance);
  });
}

function codeMotionEditor(w) {
  const meta = normalizeCodeMotionWork(w);
  const selected = Math.max(0, Math.min(w.blocks.length - 1, w.blocks.indexOf(selectedScenes.get(w))));
  selectedScenes.set(w, w.blocks[selected]);
  const block = w.blocks[selected];
  const spec = codeMotionVisualSpec(block.visual);
  const total = w.blocks.length;
  const activeTab = codeMotionInspectorTab.get(w) || "scene";
  const pace = speechStats(block.line, block.seconds);
  const appearance = codeMotionAppearance(w);
  const themeName = TemplateVideo.THEMES.find((t) => t.id === appearance.theme)?.name || "医疗白蓝风";
  const presName = TemplateVideo.PRESENTERS.find((pr) => pr.id === appearance.presenter)?.name || "数字人";
  const avatarMode = codeMotionAvatarMode(w);
  const p = TemplateStudio.ensurePharmacist(data);
  const avatarPreview = p.avatarImage || "/assets/template-doctor-digital.jpg";
  const avatarLabel = appearance.presenter === "none"
    ? ""
    : (avatarMode === "static" || w.settings.voice === "无配音"
      ? "静态肖像"
      : (avatarMode === "wan2.2-s2v" ? "万相数字人" : "声动人像对口型"));
  const metaItems = [
    "16:9",
    themeName,
    avatarLabel ? `${presName} · ${avatarLabel}` : presName,
    voiceLabel(w.settings.voice),
    StudioMusic.musicSummaryLabel(w),
    ...(w.drug ? ["药品：" + w.drug] : []),
  ];

  const topBarHtml =
    '<div class="sheet vstudio-bar">' +
    '<div class="vstudio-summary">' +
    '<div class="vstudio-metrics">' +
    '<span class="status-pill">代码动效</span>' +
    `<span class="vstudio-metric" data-cm-total-meta>共 ${total} 幕 · 约 ${videoTotalSeconds(w)} 秒</span>` +
    '<span class="vstudio-stat">按内容动态编排</span>' +
    '</div><div class="vstudio-meta-line">' +
    `<span>${esc(metaItems.join(" · "))}</span>` +
    '<span class="vstudio-meta-dot" aria-hidden="true">·</span>' +
    `<span class="save-state" id="save-state">${savedLabel(w)}</span>` +
    '</div></div><div class="vstudio-actions">' +
    btn(ico("settings") + " 模型与配音", "work-settings", "outline") +
    btn("返回主题设置", "goto-step", "outline", "setup") +
    (w.video && !w.videoDirty ? btn("查看成片", "view-draft", "secondary") : "") +
    btn("合成动效 MP4", "code-motion-compose", "primary") +
    "</div></div>";

  const filmstripHtml =
    '<div class="vstudio-rail">' +
    '<div class="vstudio-rail-head">' +
    `<span class="vstudio-rail-label">动态分镜（${total} 幕 · 支持 ← → 切换）</span>` +
    btn(ico("plus") + " 添加一幕", "cm-scene-add", "textbtn", "", total >= 12 ? "disabled" : "") +
    '</div><nav class="scene-switcher vstudio-filmstrip" role="tablist" aria-label="逐幕切换">' +
    w.blocks.map((b, idx) => {
      const vs = codeMotionVisualSpec(b.visual);
      const ms = codeMotionMotionSpec(b.motion);
      return `<button type="button" class="scene-choice" data-action="select-scene" data-val="${idx}" aria-pressed="${selected === idx}">` +
        `<span class="scene-top"><span class="scene-name"><b>${idx + 1}</b><span data-cm-tab-name="${idx}">${esc(b.name || `第 ${idx + 1} 幕`)}</span></span>` +
        `<span class="scene-sec" data-cm-tab-sec="${idx}">${b.seconds}s</span></span>` +
        `<span class="scene-state">${esc(vs.short)} · ${esc(ms.short)}</span></button>`;
    }).join("") +
    "</nav></div>";

  const stageHtml =
    '<div class="vstudio-stage"><div class="sheet vstudio-stage-card">' +
    '<div class="vstudio-stage-head"><div class="vstudio-pager">' +
    btn(ico("prev"), "select-scene", "icon-btn", selected - 1, (selected === 0 ? "disabled " : "") + 'aria-label="上一幕" title="上一幕"') +
    `<span class="shot-badge">第 ${selected + 1} / ${total} 幕</span>` +
    btn(ico("next"), "select-scene", "icon-btn", selected + 1, (selected >= total - 1 ? "disabled " : "") + 'aria-label="下一幕" title="下一幕"') +
    `<span class="vstudio-stage-title" data-stage-title>${esc(block.name)}</span>` +
    `<span class="time-range" data-stage-time>约 ${block.seconds} 秒</span>` +
    '</div><div class="shot-tools">' +
    btn(ico("arrowLeft"), "cm-scene-move", "icon-btn", `${selected}:-1`, (selected === 0 ? "disabled " : "") + 'aria-label="本幕前移" title="本幕前移"') +
    btn(ico("arrowRight"), "cm-scene-move", "icon-btn", `${selected}:1`, (selected >= total - 1 ? "disabled " : "") + 'aria-label="本幕后移" title="本幕后移"') +
    btn(ico("trash"), "cm-scene-remove", "icon-btn danger", selected, (total <= 2 ? "disabled " : "") + 'aria-label="删除本幕" title="删除本幕"') +
    "</div></div>" +
    codeMotionPreviewHtml() +
    filmstripHtml +
    "</div></div>";

  const itemsHtml =
    '<div class="cm-items-head">' +
    `<span class="label">画面条目 <small>（${block.items.length} / ${spec.maxItems}，最少 ${spec.minItems} 条）</small></span>` +
    btn(ico("plus") + " 添加条目", "cm-item-add", "textbtn", selected, block.items.length >= spec.maxItems ? "disabled" : "") +
    "</div>" +
    (block.items.length
      ? '<div class="cm-items-list">' +
        block.items.map((it, ii) =>
          '<div class="tpl-subcard cm-item-card">' +
          `<div class="cm-item-card-head"><span class="tpl-subcard-title">条目 ${ii + 1}</span>` +
          (block.items.length > spec.minItems
            ? btn("移除", "cm-item-remove", "textbtn danger", `${selected}:${ii}`)
            : "") +
          '</div><div class="tpl-two-col">' +
          `<label class="field">主文字<input maxlength="18" data-motion-scene="${selected}" data-motion-item="${ii}" data-motion-sub="title" value="${esc(it.title)}"></label>` +
          `<label class="field">小标签 <small>（选填）</small><input maxlength="12" data-motion-scene="${selected}" data-motion-item="${ii}" data-motion-sub="tag" value="${esc(it.tag)}" placeholder="${block.visual === "timeline" ? "如：刚忘不久" : "选填"}"></label>` +
          "</div>" +
          `<label class="field">补充短说明 <small>（选填，分号可换行）</small><input maxlength="40" data-motion-scene="${selected}" data-motion-item="${ii}" data-motion-sub="detail" value="${esc(it.detail)}"></label>` +
          "</div>"
        ).join("") +
        "</div>"
      : '<p class="footmeta" style="margin-top:4px">当前版式可不放条目，突出核心标题与图形；也可按需添加。</p>');

  const scenePanelHtml =
    '<div class="vstudio-panel">' +
    '<section class="vstudio-section">' +
    `<div class="field-head"><label class="label" for="cm-line-${selected}">本幕口播台词</label>` +
    `<span class="pace" id="cm-pace-${selected}">${esc(pace.label)}</span></div>` +
    `<textarea id="cm-line-${selected}" maxlength="180" rows="3" data-motion-scene="${selected}" data-motion-field="line">${esc(block.line)}</textarea>` +
    "</section>" +
    '<section class="vstudio-section">' +
    '<span class="label">分镜与动效配置</span>' +
    '<div class="tpl-two-col" style="margin-top:8px">' +
    `<label class="field">分镜版式<select data-motion-scene="${selected}" data-motion-select="visual">` +
    opts(CODE_MOTION_VISUALS.map((v) => [v.id, v.name]), block.visual) +
    "</select></label>" +
    `<label class="field">动效方式<select data-motion-scene="${selected}" data-motion-select="motion">` +
    opts(CODE_MOTION_MOTIONS.map((m) => [m.id, m.name]), block.motion) +
    "</select></label>" +
    `<label class="field">主题图形<select data-motion-scene="${selected}" data-motion-select="motif">` +
    opts(CODE_MOTION_MOTIFS.map((m) => [m.id, m.name]), block.motif) +
    "</select></label>" +
    `<label class="field">强调色调<select data-motion-scene="${selected}" data-motion-select="tone">` +
    opts(CODE_MOTION_TONES.map((t) => [t.id, t.name]), block.tone) +
    "</select></label>" +
    "</div>" +
    '<div class="asset-inline">' +
    btn(esc(block.libraryArtName || "选配图或 SVG"), "cm-pick-asset", "outline", "art") +
    (block.libraryArtId ? btn("移除配图", "cm-remove-asset", "textbtn", "art") : "") +
    btn(esc(block.sfxName || "选出场音效"), "cm-pick-asset", "outline", "sfx") +
    (block.sfxId ? btn("移除音效", "cm-remove-asset", "textbtn", "sfx") : "") +
    "</div>" +
    `<label class="field" style="margin-top:8px">对应顶部章节<select data-motion-scene="${selected}" data-motion-select="chapterIndex">` +
    meta.chapters.map((ch, ci) => `<option value="${ci}"${block.chapterIndex === ci ? " selected" : ""}>${esc(ch || `章节 ${ci + 1}`)}</option>`).join("") +
    "</select></label>" +
    "</section>" +
    '<section class="vstudio-section">' +
    `<label class="field">本幕标题<input maxlength="24" data-motion-scene="${selected}" data-motion-field="name" value="${esc(block.name)}"></label>` +
    `<label class="field" style="margin-top:8px">${block.visual === "hook" ? "直接结论 / 关键答复" : "底部屏显要点 / 结论"}<input maxlength="36" data-motion-scene="${selected}" data-motion-field="takeaway" value="${esc(block.takeaway)}"></label>` +
    (block.visual === "checklist"
      ? `<label class="field" style="margin-top:8px">清单卡片标题<input maxlength="16" data-motion-scene="${selected}" data-motion-field="listTitle" value="${esc(block.listTitle)}" placeholder="例如：核对这三项"></label>`
      : "") +
    '<div style="margin-top:12px">' + itemsHtml + "</div>" +
    "</section></div>";

  const globalPanelHtml =
    '<div class="vstudio-panel">' +
    '<section class="vstudio-section">' +
    '<span class="label">模板视觉风格</span><div class="tpl-theme-grid">' +
    TemplateVideo.THEMES.map((t) =>
      `<button type="button" class="tpl-theme-card" data-action="tpl-theme" data-val="${t.id}" aria-pressed="${appearance.theme === t.id}">` +
      `<span class="tpl-theme-swatch ${t.id}"></span><span><strong>${esc(t.name)}</strong><small>${esc(t.desc)}</small></span></button>`
    ).join("") +
    '</div><span class="label" style="margin-top:12px">左侧主讲槽位</span><div class="chips">' +
    TemplateVideo.PRESENTERS.map((pr) =>
      `<button type="button" class="chip${appearance.presenter === pr.id ? " selected" : ""}" data-action="tpl-presenter" data-val="${pr.id}" aria-pressed="${appearance.presenter === pr.id}">${esc(pr.name)}</button>`
    ).join("") +
    "</div>" +
    (appearance.presenter !== "none"
      ? '<span class="label" style="margin-top:12px">人物口型动效（阿里云百炼）</span><div class="chips">' +
        `<button type="button" class="chip${avatarMode === "videoretalk" ? " selected" : ""}" data-action="tpl-avatar-mode" data-val="videoretalk" aria-pressed="${avatarMode === "videoretalk"}">声动人像（整片）</button>` +
        `<button type="button" class="chip${avatarMode === "wan2.2-s2v" ? " selected" : ""}" data-action="tpl-avatar-mode" data-val="wan2.2-s2v" aria-pressed="${avatarMode === "wan2.2-s2v"}">万相数字人（生动）</button>` +
        `<button type="button" class="chip${avatarMode === "static" ? " selected" : ""}" data-action="tpl-avatar-mode" data-val="static" aria-pressed="${avatarMode === "static"}">静态肖像</button></div>`
      : "") +
    '<div class="asset-inline"><span class="small">视频字体</span>' +
    btn(esc(w.settings.fontName || "选择字体"), "cm-pick-asset", "outline", "font") +
    (w.settings.fontId ? btn("恢复默认", "cm-remove-asset", "textbtn", "font") : "") +
    "</div></section>" +
    '<section class="vstudio-section"><span class="label">背景音乐</span>' +
    StudioMusic.renderMusicStudioCard(w, { showModeChips: true }) +
    "</section>" +
    '<section class="vstudio-section">' +
    `<label class="field">作品完整标题<input maxlength="40" data-motion-title value="${esc(w.title)}"></label>` +
    `<label class="field" style="margin-top:8px">左上胶囊短主题 <small>（建议 ≤12 字）</small><input maxlength="20" data-motion-meta="shortTitle" value="${esc(meta.shortTitle || "")}"></label>` +
    '<div class="cm-items-head" style="margin-top:10px">' +
    `<span class="label">顶部章节（${meta.chapters.length} 个）</span>` +
    '<div class="buttons">' +
    btn("增章", "cm-chapter-add", "textbtn", "", meta.chapters.length >= 5 ? "disabled" : "") +
    btn("减章", "cm-chapter-remove", "textbtn danger", "", meta.chapters.length <= 2 ? "disabled" : "") +
    "</div></div>" +
    '<div class="tpl-chapter-grid">' +
    meta.chapters.map((ch, ci) =>
      `<label class="field">章节 ${ci + 1}<input maxlength="10" data-motion-chap="${ci}" value="${esc(ch)}"></label>`
    ).join("") +
    "</div></section>" +
    '<section class="vstudio-section"><span class="label">药师权威名片</span>' +
    '<div class="tpl-two-col">' +
    `<label class="field">姓名<input maxlength="16" data-pharm="name" value="${esc(p.name)}"></label>` +
    `<label class="field">职称<input maxlength="16" data-pharm="role" value="${esc(p.role)}"></label>` +
    "</div>" +
    `<label class="field" style="margin-top:8px">医院 / 科室<input maxlength="24" data-pharm="hospital" value="${esc(p.hospital)}"></label>` +
    (appearance.presenter === "digital"
      ? `<div class="tpl-avatar-upload"><img class="tpl-avatar-thumb" src="${esc(avatarPreview)}" alt="" />` +
        `<label class="outline tpl-upload-btn">上传医生肖像<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="avatar" hidden></label>` +
        (p.avatarImage ? btn("恢复默认", "tpl-reset-avatar", "textbtn") : "") + "</div>"
      : "") +
    `<label class="field" style="margin-top:10px">底部免责声明<input maxlength="60" data-motion-meta="disclaimer" value="${esc(meta.disclaimer || "")}"></label>` +
    "</section></div>";

  const inspectorHtml =
    '<aside class="vstudio-inspector"><div class="sheet vstudio-inspector-card">' +
    '<div class="vstudio-tabs" role="tablist" aria-label="编辑面板切换">' +
    `<button type="button" class="vstudio-tab" role="tab" data-action="cm-inspector-tab" data-val="scene" aria-selected="${activeTab === "scene"}">本幕内容 <span class="vstudio-tab-sub">第 ${selected + 1} 幕</span></button>` +
    `<button type="button" class="vstudio-tab" role="tab" data-action="cm-inspector-tab" data-val="global" aria-selected="${activeTab === "global"}">全片设置 <span class="vstudio-tab-sub">${esc(themeName)}</span></button>` +
    "</div>" +
    (activeTab === "global" ? globalPanelHtml : scenePanelHtml) +
    "</div></aside>";

  shell(
    w, "编辑代码动效分镜", 1,
    `<div class="vstudio">${topBarHtml}<div class="vstudio-grid">${stageHtml}${inspectorHtml}</div></div>`,
    btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
  );
  bindCodeMotionPreview(w, selected);
}

function handleCodeMotionInput(w, el) {
  const meta = normalizeCodeMotionWork(w);
  const selected = Number(el.dataset.motionScene ?? Math.max(0, w.blocks.indexOf(selectedScenes.get(w))));
  if (el.hasAttribute("data-motion-title")) {
    w.title = el.value;
  } else if (el.dataset.motionMeta) {
    meta[el.dataset.motionMeta] = el.value;
  } else if (el.dataset.motionChap !== undefined) {
    const ci = Number(el.dataset.motionChap);
    meta.chapters[ci] = el.value;
    const opt = app.querySelector(`select[data-motion-select="chapterIndex"] option[value="${ci}"]`);
    if (opt) opt.textContent = el.value.trim() || `章节 ${ci + 1}`;
  } else if (el.dataset.motionItem !== undefined) {
    const block = w.blocks[selected];
    const ii = Number(el.dataset.motionItem);
    const sub = el.dataset.motionSub;
    if (block?.items?.[ii] && sub) {
      block.items[ii][sub] = el.value;
      block.labels = block.items.map((it) => it.title);
    }
  } else if (el.dataset.motionLabel !== undefined) {
    const block = w.blocks[selected];
    const ii = Number(el.dataset.motionLabel);
    if (block) {
      block.items ||= [];
      block.items[ii] ||= { title: "", detail: "", tag: "" };
      block.items[ii].title = el.value;
      block.labels = block.items.map((it) => it.title);
    }
  } else if (el.dataset.motionField) {
    const block = w.blocks[selected];
    if (!block) return false;
    const key = el.dataset.motionField;
    block[key] = el.value;
    if (key === "name") {
      const label = el.value.trim() || `第 ${selected + 1} 幕`;
      const tabName = app.querySelector(`[data-cm-tab-name="${selected}"]`);
      if (tabName) tabName.textContent = label;
      const stageTitle = app.querySelector("[data-stage-title]");
      if (stageTitle) stageTitle.textContent = label;
    }
    if (key === "line") {
      if (Array.isArray(block.beats) && block.beats.length) {
        const joined = block.beats.map((b) => b.line || "").join("");
        if (joined !== el.value) block.beats = [];
      }
      block.seconds = Math.max(4, recommendedShotSeconds(spokenChars(el.value)));
      const paceEl = $(`#cm-pace-${selected}`);
      if (paceEl) paceEl.textContent = speechStats(el.value, block.seconds).label;
      const tabSec = app.querySelector(`[data-cm-tab-sec="${selected}"]`);
      if (tabSec) tabSec.textContent = `${block.seconds}s`;
      const stageTime = app.querySelector("[data-stage-time]");
      if (stageTime) stageTime.textContent = `约 ${block.seconds} 秒`;
      const totalMeta = app.querySelector("[data-cm-total-meta]");
      if (totalMeta) totalMeta.textContent = `共 ${w.blocks.length} 幕 · 约 ${videoTotalSeconds(w)} 秒`;
    }
  } else {
    return false;
  }
  if (w.video) w.videoDirty = true;
  changed(w);
  refreshCodeMotionPreview(w, selected);
  return true;
}

function handleCodeMotionChange(w, el) {
  const selectKey = el.dataset.motionSelect;
  if (!selectKey) return false;
  const meta = normalizeCodeMotionWork(w);
  const selected = Number(el.dataset.motionScene ?? Math.max(0, w.blocks.indexOf(selectedScenes.get(w))));
  const block = w.blocks[selected];
  if (!block) return false;
  if (selectKey === "chapterIndex") {
    block.chapterIndex = Math.max(0, Math.min(meta.chapters.length - 1, Number(el.value) || 0));
  } else if (selectKey === "visual") {
    const spec = codeMotionVisualSpec(el.value);
    block.visual = spec.id;
    block.motion = spec.defaultMotion;
    block.tone = spec.defaultTone;
    if (block.items.length < spec.minItems) {
      while (block.items.length < spec.minItems) {
        block.items.push({ title: `要点 ${block.items.length + 1}`, detail: "", tag: "" });
      }
    } else if (block.items.length > spec.maxItems) {
      block.items = block.items.slice(0, spec.maxItems);
    }
    block.labels = block.items.map((it) => it.title);
  } else if (selectKey === "motion" || selectKey === "motif" || selectKey === "tone") {
    block[selectKey] = el.value;
  } else {
    return false;
  }
  if (w.video) w.videoDirty = true;
  changed(w);
  render(true);
  return true;
}

function handleCodeMotionAction(w, action, val) {
  if (action === "cm-pick-asset" || action === "cm-remove-asset") {
    const fields = {
      art: ["libraryArt", ["image", "svg"]],
      sfx: ["sfx", ["sfx"]],
      font: ["font", ["font"]],
    }[val];
    const target = val === "font" ? w.settings : selectedScenes.get(w);
    if (!fields || !target) return true;
    const [key, kinds] = fields;
    const change = (item) => {
      if (item) {
        target[key + "Id"] = item.id;
        target[key + "Name"] = item.name;
      } else {
        delete target[key + "Id"];
        delete target[key + "Name"];
      }
      editedLibraryChoice(w);
    };
    if (action === "cm-remove-asset") change(null);
    else StudioAssets.pick(kinds, change, { topic: w.topic, ratio: w.settings.ratio });
    return true;
  }
  if (!isCodeMotion(w)) return false;
  const meta = normalizeCodeMotionWork(w);
  if (action === "cm-inspector-tab") {
    codeMotionInspectorTab.set(w, val === "global" ? "global" : "scene");
    render(true);
    return true;
  }
  if (action === "cm-scene-add") {
    if (w.blocks.length >= 12) {
      notify("最多支持 12 幕代码动效分镜", "warn");
      return true;
    }
    const last = w.blocks.at(-1);
    const nextIdx = w.blocks.length + 1;
    const block = normalizeCodeMotionBlock({
      name: `补充要点 ${nextIdx}`,
      chapterIndex: last?.chapterIndex ?? 0,
      visual: "mechanism",
      motion: "reveal",
      motif: "none",
      tone: "primary",
      line: "",
      takeaway: "按说明书和医嘱核对细节",
      items: [
        { title: "要点一", detail: "填写关键科普说明", tag: "" },
        { title: "要点二", detail: "补充易错提醒", tag: "" },
      ],
      seconds: 6,
    }, w.blocks.length, w.blocks.length + 1, meta.chapters.length);
    w.blocks.push(block);
    selectedScenes.set(w, block);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-scene-move") {
    const [rawIdx, rawDir] = String(val).split(":").map(Number);
    const nextIdx = rawIdx + rawDir;
    if (rawIdx < 0 || nextIdx < 0 || nextIdx >= w.blocks.length) return true;
    const [moved] = w.blocks.splice(rawIdx, 1);
    w.blocks.splice(nextIdx, 0, moved);
    selectedScenes.set(w, moved);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-scene-remove") {
    const idx = Number(val);
    if (w.blocks.length <= 2) {
      notify("代码动效分镜至少保留 2 幕", "warn");
      return true;
    }
    w.blocks.splice(idx, 1);
    selectedScenes.set(w, w.blocks[Math.min(idx, w.blocks.length - 1)]);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-item-add") {
    const idx = Number(val);
    const block = w.blocks[idx];
    if (!block) return true;
    const spec = codeMotionVisualSpec(block.visual);
    if (block.items.length >= spec.maxItems) return true;
    block.items.push({ title: `要点 ${block.items.length + 1}`, detail: "", tag: "" });
    block.labels = block.items.map((it) => it.title);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-item-remove") {
    const [sIdx, iIdx] = String(val).split(":").map(Number);
    const block = w.blocks[sIdx];
    if (!block) return true;
    const spec = codeMotionVisualSpec(block.visual);
    if (block.items.length <= spec.minItems) return true;
    block.items.splice(iIdx, 1);
    block.labels = block.items.map((it) => it.title);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-chapter-add") {
    if (meta.chapters.length >= 5) return true;
    meta.chapters.push(`章节 ${meta.chapters.length + 1}`);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  if (action === "cm-chapter-remove") {
    if (meta.chapters.length <= 2) return true;
    meta.chapters.pop();
    w.blocks.forEach((b) => {
      if (b.chapterIndex >= meta.chapters.length) b.chapterIndex = meta.chapters.length - 1;
    });
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return true;
  }
  return false;
}

function authorizeCodeMotion(w, count, run, avatar, reuseSpeech = false) {
  if ((avatar || reuseSpeech) && w.settings.voice !== "无配音" && config.codeMotionReady) {
    if (!config.speechKeyPresent && !reuseSpeech) return openApiKeys("speech");
    if (avatar && !config.dashscopeKeyPresent && !reuseSpeech) return openApiKeys("dashscope");
    return authorizeSpeechOnly(w, count, run, {
      usesAvatar: Boolean(avatar), avatarModel: avatar?.model, avatarResolution: avatar?.resolution, reuseSpeech,
      presenterLabel: TemplateVideo.PRESENTERS.find((presenter) => presenter.id === avatar?.presenter)?.name,
    });
  }
  return authorize(w, count, "code-motion", run);
}

function composeTemplateMotion(w) {
  const plan = templateMotionData(TemplateStudio.buildDeckForWork(w, data));
  if (w.job) return;
  if (plan.items.some((item) => !item.line)) {
    notify("请补全每一页的口播台词", "warn");
    return;
  }
  return sendCodeMotion(w, plan);
}

function composeCodeMotion(w) {
  if (w.job) return;
  const meta = normalizeCodeMotionWork(w);
  if (!w.title.trim()) {
    notify("请先填写作品标题", "warn");
    return;
  }
  for (let i = 0; i < w.blocks.length; i++) {
    const block = w.blocks[i];
    const spec = codeMotionVisualSpec(block.visual);
    const items = (block.items || []).map((it) => ({
      title: String(it.title || "").trim(),
      detail: String(it.detail || "").trim(),
      tag: String(it.tag || "").trim(),
    }));
    const validItems = items.filter((it) => it.title);
    if (!block.name.trim() || !block.line.trim() || (!block.takeaway.trim() && !validItems.length)) {
      selectScene(w, i);
      notify(`请补全第 ${i + 1} 幕的标题、口播和核心画面文字`, "warn");
      return;
    }
    if (items.some((it) => !it.title) || validItems.length < spec.minItems) {
      selectScene(w, i);
      notify(`第 ${i + 1} 幕（${spec.name}）需填全 ${spec.minItems}–${spec.maxItems} 条画面条目`, "warn");
      return;
    }
  }
  const chapters = meta.chapters.map((c, idx) => String(c || "").trim() || `章节${idx + 1}`);
  const items = w.blocks.map((block) => {
    const cleanItems = (block.items || []).map((it) => ({
      title: it.title.trim(),
      detail: (it.detail || "").trim(),
      tag: (it.tag || "").trim(),
    }));
    return {
      name: block.name.trim(),
      chapterIndex: block.chapterIndex,
      visual: block.visual,
      motion: block.motion,
      motif: block.motif,
      tone: block.tone,
      line: block.line.trim(),
      takeaway: block.takeaway.trim(),
      ...(block.listTitle?.trim() ? { listTitle: block.listTitle.trim() } : {}),
      items: cleanItems,
      labels: cleanItems.map((it) => it.title),
      ...(block.beats?.length ? { beats: block.beats } : {}),
      ...(block.libraryArtId ? { libraryArtId: block.libraryArtId } : {}),
      ...(block.sfxId ? { sfxId: block.sfxId } : {}),
      seconds: block.seconds,
    };
  });
  return sendCodeMotion(w, {
    title: w.title.trim(),
    shortTitle: (meta.shortTitle || "").trim(),
    chapters,
    disclaimer: (meta.disclaimer || "").trim(),
    items,
    appearance: codeMotionAppearance(w),
  });
}

function sendCodeMotion(w, { title, shortTitle, chapters, disclaimer, items, appearance, templateInfo }) {
  const avatarMode = templateInfo ? resolveAvatarMode(w.settings.avatarMode ?? defaults.avatarMode) : codeMotionAvatarMode(w);
  const avatar = w.settings.voice !== "无配音" && appearance.presenter !== "none" && avatarMode !== "static"
    ? {
        enabled: true,
        model: avatarMode,
        resolution: w.settings.avatarResolution || "480P",
        presenter: appearance.presenter,
        image: TemplateVideo.resolveAvatarSrc(appearance),
      }
    : null;
  return authorizeCodeMotion(w, items.length, () => {
    const job = createJob(w, "compose", items, { ...w.settings, ratio: "16:9", ...videoMusicSettings(w) });
    delete job.payload.storyboard;
    job.payload.codeMotion = true;
    job.payload.title = title.trim();
    if (shortTitle) job.payload.shortTitle = shortTitle;
    if (chapters) job.payload.chapters = chapters;
    if (disclaimer) job.payload.disclaimer = disclaimer;
    job.payload.appearance = appearance;
    if (templateInfo) job.payload.templateInfo = templateInfo;
    if (w.video?.url) job.payload.previousVideo = w.video.url;
    if (avatar) job.payload.avatar = avatar;
    w.job = job;
    return sendJob(w);
  }, avatar, Boolean(w.video));
}
