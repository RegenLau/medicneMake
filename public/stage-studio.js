"use strict";

/* Shared work data and editor for the infographic video modes. */
const StageStudio = (() => {
  const CLASSIC = "builtin:layout/info-classic";
  const kinds = {image: "AI 完整图", card: "信息图动效", scene: "代码动效场景", clip: "AI 视频", svg: "旧版 SVG", asset: "旧版素材", mg: "旧版 MG"};
  const kindLabel = c => c?.kind === "clip" ? (c.clipStyle === "mg" ? "AI MG 动画" : "AI 演示视频") : (kinds[c?.kind] || "");
  const layoutLoads = new Map();
  const themeLoads = new Map();
  const stickerTagsCache = new Map();
  const selected = new WeakMap();
  const inspector = new WeakMap();
  const mgPanels = new WeakMap();
  const pointVisual = () => config.stageCatalog.pointVisuals;
  const copy = value => structuredClone(value);
  const fixedKinds = ["image", "card", "scene"];
  const draftModes = [["mix","Mix 模式（推荐）"], ...fixedKinds.map(kind => [kind,kinds[kind]])];
  let soundContext;
  const decodedSounds = new Map();
  const soundSettings = w => {
    const raw = w.stagePlan.audio?.sfx || {};
    return {pack: raw.pack || "off", gainDb: raw.gainDb ?? -14, stickerSfx: raw.stickerSfx !== false};
  };
  const soundPack = id => (config.sfxPacks || []).find(pack => pack.id === id);
  const clipEstimate = (model, resolution, seconds, dims, includeFrame, w) => {
    const rate = config.videoRates?.[model]?.[resolution];
    const [dw, dh] = dims || [1280, 720];
    const videoYuan = rate ? (Number(seconds) * dw * dh * 24 / 1024) * Number(rate) / 1_000_000 : null;
    const frameRate = includeFrame ? Number(config.imageRates?.[w.settings.imageModel]?.[w.settings.imageSize] || 0) : 0;
    return { videoYuan, frameYuan: frameRate, totalYuan: videoYuan !== null ? videoYuan + frameRate : null };
  };
  const clipDimensions = (resolution, slot) => {
    const short = parseInt(String(resolution || "720p"), 10) || 720;
    const ar = slot?.w && slot?.h ? Math.max(0.5, Math.min(2.2, slot.w / slot.h)) : 16 / 9;
    return ar >= 1
      ? [Math.round(short * ar / 2) * 2, Math.round(short / 2) * 2]
      : [Math.round(short / 2) * 2, Math.round(short / ar / 2) * 2];
  };

  function applies(w) {
    return Boolean(config?.stageRender && w?.type === "video" && ["template", "code-motion", "svg"].includes(w.videoMode));
  }

  function hasLegacyImageJobs(w) {
    return w.blocks.some(block => block.job) || Boolean(w.templateDeck?.slides?.some(slide => slide.job || slide.outroJob));
  }

  function isActive(w) {
    return Boolean(applies(w) && w.stagePlan && !hasLegacyImageJobs(w));
  }

  function authoredCues(line, words = []) {
    return TemplateVideo.splitSubtitleChunks(line, 22).map(cue => ({...cue, focus: "all", highlightWords: words}));
  }

  function initialContent(kind, shot, clipStyle = "demo") {
    if (kind === "scene") {
      const visual = pointVisual()[shot.points.type];
      return { kind, visual, ...config.stageCatalog.sceneDefaults[visual] };
    }
    if (kind === "svg") return { kind, beats: [{action:config.stageCatalog.svgDefault, label:shot.name.slice(0, 10) || "用药要点", line:shot.line.slice(0, 55) || "请核对用药信息"}] };
    if (kind === "card") return { kind, motionStyle: "auto" };
    if (kind === "clip") return { kind, clipStyle, clipPrompt: "", clipFirstFrame: "", clip: "", clipPoster: "", overlay: "points", clipSpeed: "normal" };
    if (kind === "asset") return { kind, move: "still" };
    if (kind === "mg") return {kind,fit:"auto",overlay:"points"};
    return { kind, image: "", imagePrompt: "" };
  }

  function oldKind(w) {
    if (w.videoMode === "svg") return "svg";
    if (w.videoMode === "code-motion") return "scene";
    return w.templateContent === "code-motion" ? "card" : "image";
  }

  function pointsFrom(raw, kind) {
    const type = kind === "scene" ? Object.keys(pointVisual()).find(type => pointVisual()[type] === raw.visual) : raw.type;
    const items = raw.items || raw.points || raw.steps || raw.checks || raw.columns || raw.warnings || [];
    return {
      type: type || "explain", headline: raw.headline || raw.name, lead: raw.lead || "", accentPhrase: raw.accentPhrase || "",
      question: raw.question || "", answer: raw.answer || "",
      verdictTone: ["ok", "no", "warn"].includes(raw.verdictTone) ? raw.verdictTone : "",
      items: items.map(item => typeof item === "string" ? {title: item, detail:"", tag:""}
        : {title: item.title || item.label || item.head || "", detail: item.detail || item.desc || "", tag: item.tag || ""}),
      takeaway: raw.takeaway || raw.footerNote || "", highlightWords: raw.highlightWords || raw.labels || [],
      ...(raw.layoutMode ? { layoutMode: raw.layoutMode } : {}),
      ...Object.fromEntries(["points", "columns", "steps", "warnings", "checks", "pills", "footerNote", "outroNote", "listTitle"]
        .filter(key => raw[key] !== undefined).map(key => [key, copy(raw[key])])),
    };
  }

  function fromLegacy(raw, kind, i) {
    const name = raw.name || raw.headline || `第 ${i + 1} 幕`;
    const line = raw.line || "";
    const points = pointsFrom(raw, kind);
    const cues = raw.type ? TemplateVideo.getSlideCues(raw, 22) : authoredCues(line, points.highlightWords);
    const shot = {name, line, points, seconds: Math.max(kind === "svg" ? 2 : 4, Number(raw.seconds) || 5),
      chapterIndex: Math.max(0, Math.min(4, Number(raw.chapterIndex) || 0)), cues: copy(cues), variants: {}};
    const image = raw.contentImage || raw.image || "";
    if (kind === "image" || kind === "card" || image) {
      shot.variants.image = {kind:"image", image, imagePrompt: raw.imagePrompt || raw.prompt || "", focusRegions:raw.focusRegions || {}, outroImage:raw.outroImage || ""};
    }
    if (kind === "svg") {
      shot.variants.svg = {kind, action:raw.action || "leaflet",
        beats: raw.beats?.length ? copy(raw.beats) : [{action:raw.action || "leaflet", line:line.slice(0, 55), label:name.slice(0, 10)}],
        ...(raw.beats?.length ? {} : {singleAction: true})};
      if (raw.svgSpeech) shot.speech = copy(raw.svgSpeech);
    }
    if (kind === "scene") {
      shot.variants.scene = {kind, visual:raw.visual, motion:raw.motion, motif:raw.motif, tone:raw.tone, libraryArtId:raw.libraryArtId};
      shot.beats = copy(raw.beats || []);
      if (raw.sfxId) { shot.sfxId = raw.sfxId; shot.sfxName = raw.sfxName; }
    }
    if (kind === "card") shot.variants.card = {kind, motionStyle:raw.motionStyle || "auto"};
    shot.content = shot.variants[kind] || initialContent(kind, shot);
    return shot;
  }

  function migrateLegacyAssetShots(plan) {
    if (!plan?.shots) return;
    for (const shot of plan.shots) {
      if (shot?.content?.kind !== "asset") continue;
      const old = shot.content;
      const form = window.InfoForms ? InfoForms.mapLegacyForm({}, shot) : undefined;
      const formData = form && window.InfoForms ? InfoForms.fromPoints(form, shot) : undefined;
      shot.content = {
        kind: "card",
        motionStyle: "auto",
        ...(form ? { form, variant: "solid", formData } : {}),
        ...(old.transition ? { transition: old.transition } : {}),
        ...(old.decidedBy ? { decidedBy: old.decidedBy } : {}),
      };
      shot.variants = { ...(shot.variants || {}), card: shot.content };
      if (old.assetId) {
        shot.stickers = Array.isArray(shot.stickers) ? shot.stickers.slice(0, 1) : [];
        shot.stickers.push({
          assetId: old.assetId,
          cue: 0,
          keyword: "",
          anchor: "media-br",
          size: "l",
          enter: "pop",
          hold: "stay",
          sfx: "auto",
        });
      }
    }
  }

  function normalizeWork(w) {
    if (!applies(w) || w.job || hasLegacyImageJobs(w)) return w.stagePlan;
    if (w.stagePlan) {
      migrateLegacyAssetShots(w.stagePlan);
      return w.stagePlan;
    }
    const kind = oldKind(w);
    const slides = TemplateStudio.isTemplateVideo(w) && w.blocks.length
      ? TemplateStudio.buildDeckForWork(w, data) : null;
    if (kind === "scene" && w.blocks.length) normalizeCodeMotionWork(w);
    const meta = slides || w.motionMeta || {};
    w.stagePlan = {
      layout: {id: CLASSIC}, mode: w.blocks.length ? kind : "mix", autoStickers: true, audio: {}, shots: (slides?.slides || w.blocks).map((shot, i) => fromLegacy(shot, kind, i)),
      ...(w.blocks.length ? {compatibility: kind} : {}),
      shortTitle: meta.shortTitle || "", chapters: meta.chapters || ["先看要点", "用药提醒"],
      disclaimer: meta.disclaimer ?? TemplateVideo.DEFAULT_DISCLAIMER,
    };
    return w.stagePlan;
  }

  function initWork(w) {
    const plan = normalizeWork(w);
    const pack = soundPack("builtin:sfx-pack/soft");
    if (plan && pack) plan.audio.sfx = {pack:pack.id, gainDb:pack.gainDb, stickerSfx:true};
  }

  function syncBlocks(w) {
    w.blocks = w.stagePlan.shots.map(shot => ({ name:shot.name, line:shot.line, seconds:shot.seconds,
      image:shot.variants.image?.image || "", ...(shot.speech ? {svgSpeech:shot.speech} : {}) }));
  }

  function touch(w, structural = false) {
    if (structural) delete w.stagePlan.compatibility;
    syncBlocks(w);
    if (w.video) w.videoDirty = true;
    changed(w);
  }

  function selectKind(w, shot, kind, clipStyle) {
    const transition = shot.content.transition;
    const from = shot.content;
    const variantKey = from.kind === "clip" ? `clip:${from.clipStyle || "demo"}` : from.kind;
    shot.variants[variantKey] = from;
    const nextKey = kind === "clip" ? `clip:${clipStyle || "demo"}` : kind;
    shot.content = shot.variants[nextKey] || shot.variants[kind] || initialContent(kind, shot, clipStyle || "demo");
    shot.content.kind = kind;
    if (kind === "clip") shot.content.clipStyle = clipStyle || shot.content.clipStyle || "demo";
    if (artKinds.has(kind) && artKinds.has(from.kind) && !shot.content.art && !shot.content.artPrompt) {
      for (const key of ["art", "artName", "artPrompt", "artMediaSize"]) if (from[key]) shot.content[key] = from[key];
    }
    if (transition !== undefined) shot.content.transition = transition;
    shot.variants[nextKey] = shot.content;
  }

  function getLayout(layoutId) {
    if (!layoutLoads.has(layoutId)) {
      const pending = jsonRequest(StudioAssets.url(layoutId)).catch(error => {
        layoutLoads.delete(layoutId);
        throw error;
      });
      layoutLoads.set(layoutId, pending);
    }
    return layoutLoads.get(layoutId);
  }

  function getTheme(themeId) {
    if (!themeLoads.has(themeId)) {
      const pending = jsonRequest(StudioAssets.url(themeId)).catch(error => {
        themeLoads.delete(themeId);
        throw error;
      });
      themeLoads.set(themeId, pending);
    }
    return themeLoads.get(themeId);
  }

  const layoutResolved = new Map();
  const activeLayouts = () => (config.stageLayouts || []).filter(item => item.aspect === "16:9");
  const activeThemes = () => config.stageThemes || [];
  const defaultThemeId = w => w.templateTheme === "warm" ? "builtin:theme/warm" : "builtin:theme/medical";
  const themeIdFor = w => w.stagePlan?.themeId || defaultThemeId(w);
  const currentThemeDef = w => activeThemes().find(item => item.id === themeIdFor(w)) || null;
  const currentLayoutDef = w => {
    const id = w.stagePlan?.layout?.id || CLASSIC;
    return activeLayouts().find(item => item.id === id) || layoutResolved.get(id) || null;
  };
  async function resolveWorkLayout(w) {
    const cached = currentLayoutDef(w);
    if (cached?.regions) return cached;
    const id = w.stagePlan?.layout?.id || CLASSIC;
    try {
      const loaded = await getLayout(id);
      layoutResolved.set(id, loaded);
      return loaded;
    } catch {
      return cached;
    }
  }
  function mediaRatioMismatched(savedSize, currentSlot) {
    if (!savedSize?.w || !savedSize?.h || !currentSlot?.w || !currentSlot?.h) return false;
    const savedAr = savedSize.w / savedSize.h;
    const slotAr = currentSlot.w / currentSlot.h;
    return Math.abs(savedAr - slotAr) / slotAr > 0.12;
  }
  const themeName = w => {
    const id = themeIdFor(w);
    return activeThemes().find(item => item.id === id)?.name
      || TemplateVideo.THEMES.find(item => item.id === (w.templateTheme || "medical"))?.name
      || "医疗白蓝风";
  };
  const allowsMode = (layout, mode) => !layout?.supports || (mode === "mix"
    ? ["card","scene"].some(kind => layout.supports.includes(kind)) : layout.supports.includes(mode));

  function defaultKind(w, type) {
    const preferred = config.stageCatalog.pointDefaults[type];
    const layout = activeLayouts().find(item => item.id === w.stagePlan.layout.id);
    return allowsMode(layout,preferred) ? preferred : ["card","scene"].find(kind => allowsMode(layout,kind));
  }

  function layoutControls(w) {
    const id = w.stagePlan.layout.id;
    const choices = activeLayouts();
    return '<div class="formrow"><span class="label">布局模板</span><div class="stage-layout-grid">' + choices.map(item =>
      `<button type="button" class="mode-card" data-action="stage-layout" data-val="${esc(item.id)}" aria-pressed="${id === item.id}">
      ${StudioAssets.layoutDiagram(item)}<strong>${esc(item.name)}</strong></button>`).join("") +
      '<button type="button" class="mode-card stage-layout-manage" data-action="stage-manage-layouts">管理布局</button>' +
      (choices.some(item => item.id === id) ? "" : '<span class="small">当前作品保留已下架布局</span>') + '</div></div>';
  }

  function themeControls(w) {
    const id = themeIdFor(w);
    const choices = activeThemes();
    if (!choices.length) return "";
    return '<div class="formrow"><span class="label">视觉主题</span><div class="stage-theme-grid">' + choices.map(item =>
      `<button type="button" class="mode-card stage-theme-card" data-action="stage-theme" data-val="${esc(item.id)}" aria-pressed="${id === item.id}">
      ${StudioAssets.themeSwatch(item)}<strong>${esc(item.name)}</strong></button>`).join("") +
      '<button type="button" class="mode-card stage-theme-manage" data-action="stage-manage-themes">管理主题</button>' +
      (w.stagePlan.themeId && !choices.some(item => item.id === id) ? '<span class="small">当前作品保留已下架主题</span>' : "") + '</div></div>';
  }

  function samplePlan(layout, theme, kind, stage = "explain") {
    const title = "漏服了，也只吃一次";
    const line = "间隔还不到一半，想起来就补上，千万不要吃双倍。";
    const points = [
      {title:"先判断离下次服药还有多久", detail:"看是否超过服药间隔的一半"},
      {title:"没过半时想起来就补一次", detail:"按常规剂量补服，次日照常吃"},
      {title:"已经过半就跳过这一次", detail:"等到下次服药时间再按常规吃"},
      {title:"千万不要一次吃双倍剂量", detail:"避免血药浓度骤升引发低血压"},
    ];
    const slide = {
      name:"漏服如何处理", headline:title, accentPhrase:"也只吃一次",
      lead:"不论补服还是到点服药，每次都只吃平时的常规剂量。",
      line, type:"steps", layoutMode:stage, chapterIndex:1,
      question:"昨天忘吃降压药，今天吃两片补回来，行吗？",
      answer:"不行，只吃常规剂量", verdictTone:"no",
      takeaway:"一次只吃常规量，漏服绝不加倍补",
      highlightWords:["想起来就补上","吃双倍"],
      points:points.map(({title,detail}) => ({title,desc:detail})),
      steps:points.slice(0,3).map(({title,detail}) => ({title,desc:detail})),
    };
    const shot = {
      ...slide, kind, items:points, start:0, end:4,
      captions:[{start:0,end:4,text:"间隔还不到一半，想起来就补上",focus:stage === "outro" ? "outro" : "1",highlightWords:["想起来就补上"]}],
    };
    if (kind === "image") slide.contentImage = "/assets/template-info-tablet.jpg";
    if (kind === "scene") Object.assign(shot,{visual:"steps",motion:"flow",motif:"checklist",tone:"primary"});
    if (kind === "svg") {
      shot.beats = [{action:"leaflet",line,label:"看说明书"}];
      Object.assign(slide,{action:"leaflet",svgBeats:shot.beats});
    }
    if (kind === "asset") Object.assign(shot,{assetUrl:StudioAssets.url("builtin:svg/reading-list"),move:"zoom"});
    if (kind === "mg") Object.assign(shot,{motionAssetUrl:StudioAssets.motionUrl("builtin:lottie/capsule"),fit:"auto",overlay:"points"});
    const themeDeck = theme && typeof theme === "object"
      ? {
          theme: theme.base === "warm" ? "warm" : "medical",
          ...(theme.id ? { themeId: theme.id } : {}),
          themeVars: theme.vars,
          themeGlass: Boolean(theme.glass),
          ...(theme.fadeColor ? { themeFadeColor: theme.fadeColor } : {}),
          ...(theme.background?.assetId
            ? { themeBackground: theme.background.url || StudioAssets.url(theme.background.assetId) }
            : {}),
        }
      : { theme: theme === "warm" ? "warm" : "medical" };
    return {
      layout, previewStage:stage,
      deck:{
        title:"降压药忘吃了，要不要补？", shortTitle:"降压药漏服怎么补？",
        drug:"硝苯地平缓释片", drugTags:["缓释片","处方药"],
        ...themeDeck, presenter:"digital",
        pharmacist:{...TemplateStudio.ensurePharmacist(data)},
        chapters:["先判断时间","补还是不补","千万别加倍","何时问药师"],
        slides:[slide],
      },
      shots:[shot],
    };
  }

  function modeControls(w) {
    const p = w.stagePlan;
    const layout = activeLayouts().find(item => item.id === p.layout.id);
    const displayMode = ["svg", "mg"].includes(p.mode) ? "mix" : p.mode;
    return '<div class="formrow"><span class="label">制作方式</span><div class="chips">' +
      draftModes.map(([kind,label]) => btn(label, "stage-mode", "chip" + (displayMode === kind ? " selected" : ""), kind,
        `aria-pressed="${displayMode === kind}" ${allowsMode(layout,kind) ? "" : "disabled"}`)).join("") + '</div></div>' +
      (displayMode === "mix" ? `<label class="stage-overwrite"><input type="checkbox" data-stage-field="autoStickers"${p.autoStickers !== false ? " checked" : ""}> Mix 编排后自动匹配贴纸</label>` : "");
  }

  function setupControls(w) {
    return layoutControls(w) + themeControls(w) + modeControls(w);
  }

  function submitDraft(w, draft = {}, stageDraft = "stage", shotIndex) {
    if (w.job) return;
    const job = createJob(w, "write-draft", [], {...w.settings, ratio:"16:9", duration:videoReferenceSeconds(w), textModel:resolveTextModel(w.settings)});
    job.stageDraft = stageDraft;
    if (shotIndex !== undefined) job.stageShotIndex = shotIndex;
    const presentation = ["svg", "mg"].includes(w.stagePlan.mode) ? "mix" : w.stagePlan.mode;
    job.payload.draft = {type:"video", videoMode:"stage", presentation, layoutId:w.stagePlan.layout.id,
      autoStickers:w.stagePlan.autoStickers !== false, workId:w.id,
      topic:w.topic.trim(), drug:w.drug, ...draft};
    w.job = job;
    return sendJob(w);
  }

  function requestDraft(w) {
    const mode = ["svg", "mg"].includes(w.stagePlan.mode) ? "mix" : w.stagePlan.mode;
    const autoStickers = mode === "mix" && w.stagePlan.autoStickers !== false;
    const count = mode === "mix" ? (autoStickers ? 3 : 2) : 1;
    const detail = mode === "mix"
      ? (autoStickers ? "先写脚本，再编排每幕版式，最后自动匹配贴纸。" : "先写脚本，再为每幕编排呈现方式与版式。")
      : "生成口播、要点、字幕节拍与自动版式。";
    const image = mode === "mix" ? "编排不自动出图，若包含 AI 完整图，配图将在分镜页另行确认后生成。" : "";
    return authorize(w, count, "draft", () => submitDraft(w), count, {detail, image});
  }

  function showShotIssue(w, index, message, focus) {
    selected.set(w, index);
    inspector.set(w, "scene");
    render(true);
    $(`.stage-rail [data-action="stage-select"][data-val="${index}"]`)?.scrollIntoView({block:"nearest",inline:"nearest"});
    $(focus)?.focus();
    notify(message, "warn");
  }

  function checkShotText(w, indices) {
    for (const index of indices) {
      const {name, line} = w.stagePlan.shots[index];
      if (name.trim() && line.trim()) continue;
      const missing = !name.trim() && !line.trim() ? "标题和口播" : name.trim() ? "口播" : "标题";
      const label = name.trim() ? `第 ${index + 1} 幕「${name.trim()}」` : `第 ${index + 1} 幕`;
      showShotIssue(w, index, `${label}缺少${missing}，请补齐。`,
        `[data-stage-field="${name.trim() ? "line" : "name"}"]`);
      return false;
    }
    return true;
  }

  function shotScript({name, line, seconds, chapterIndex, points, cues}) {
    return {name, line, seconds, chapterIndex, points, cues};
  }

  function replan(w, targetIndex) {
    if (w.job || !w.stagePlan.shots.length) return;
    const p = w.stagePlan;
    const indices = targetIndex !== undefined && config.stageShotProduction ? [targetIndex] : p.shots.map((_, index) => index);
    if (!checkShotText(w, indices)) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    let overwrite = false;
    retryPayload = () => submitDraft(w, {
      targetIndex,
      // The checkbox updates before the dialog closes so its value is available in the callback.
      overwriteUser: overwrite,
      script: {title:w.title, shortTitle:p.shortTitle, chapters:p.chapters, shots:p.shots.map(shot => ({
        ...shotScript(shot), content:{kind:shot.content.kind, decidedBy:shot.content.decidedBy},
      }))},
    }, "replan");
    openModal(targetIndex === undefined ? "重新编排全片" : "本幕重新判断",
      "<p>使用 DeepSeek 提交 1 次编排请求，按 Token 计费。保留已写好的脚本和各方式的素材。</p>" +
      (targetIndex === undefined ? '<label class="stage-overwrite"><input type="checkbox" id="stage-overwrite-user"> 同时重排我改过的幕</label>' : '') +
      '<div class="actions dialog-actions">' + btn("取消","close","secondary") +
      btn("确认提交并计费","confirm-paid","primary") + '</div>', "confirm");
    $("#stage-overwrite-user")?.addEventListener("change", event => { overwrite = event.currentTarget.checked; });
  }

  function produceShot(w, shot, index) {
    if (!config.stageShotProduction || w.job || !checkShotText(w, [index])) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    const kind = shot.content.kind;
    if (kind === "image" || kind === "clip") return;
    const options = config.stageCatalog.presenters[kind].options;
    const previousParams = Object.fromEntries(Object.keys(options).filter(key => shot.content[key] !== undefined)
      .map(key => [key, shot.content[key]]));
    const title = productionTitle(shot.content);
    const revisionCount = (shot.content._revCount || 0) + 1;
    retryPayload = () => submitDraft(w, {
      presentation:kind, produceShot:{shot:shotScript(shot), previousParams, revisionCount, revision:$("#stage-production-revision").value.trim()},
    }, "produce", index);
    openModal(title, `<p>用 DeepSeek 按第 ${index + 1} 幕的口播和要点，用「${kinds[kind]}」设计新画面。保留口播、要点和其他幕。</p>
      <label class="field">画面要求（选填）<textarea id="stage-production-revision" maxlength="200" rows="3" placeholder="想先展示哪个要点，或想演示哪个动作？"></textarea></label>
      <p class="small">提交 1 次文本请求，按 Token 计费。</p>
      <div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认提交并计费","confirm-paid","primary")}</div>`, "confirm");
  }

  function planStickers(w, targetIndex) {
    if (w.job || !w.stagePlan.shots.length) return;
    const p = w.stagePlan;
    const indices = targetIndex !== undefined ? [targetIndex] : p.shots.map((_, i) => i);
    if (!checkShotText(w, indices)) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    retryPayload = () => submitDraft(w, {
      planStickers: true,
      ...(targetIndex !== undefined ? { targetIndex } : {}),
      script: {title: w.title, shortTitle: p.shortTitle, chapters: p.chapters, shots: p.shots.map(shotScript)},
    }, "stickers", targetIndex);
    openModal(targetIndex === undefined ? "全片自动加贴纸" : "为本幕重新配贴纸",
      "<p>使用 DeepSeek 提交 1 次文本请求，为关键提醒、数值或转折自动匹配贴纸与时机（不替换主画面）。按 Token 计费。</p>" +
      '<div class="actions dialog-actions">' + btn("取消","close","secondary") +
      btn("确认提交并计费","confirm-paid","primary") + '</div>', "confirm");
  }

  function requestClipPrompt(w, shot, index) {
    if (w.job || !checkShotText(w, [index])) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    const clipStyle = shot.content.clipStyle || "demo";
    retryPayload = () => submitDraft(w, {
      clipPrompt: { shot: shotScript(shot), clipStyle },
    }, "clip-prompt", index);
    openModal("AI 写视频描述",
      `<p>用 DeepSeek 按第 ${index + 1} 幕的口播和要点，撰写适合「${clipStyle === "mg" ? "AI MG 动画" : "AI 演示视频"}」的画面动作描述（不含文字、品牌和医生形象）。提交 1 次文本请求，按 Token 计费。</p>` +
      '<div class="actions dialog-actions">' + btn("取消","close","secondary") +
      btn("确认提交并计费","confirm-paid","primary") + '</div>', "confirm");
  }

  function usePlan(shot, content) {
    const saved = shot.content.kind === content.kind ? shot.content : shot.variants[content.kind] || {};
    const fields = ["image","outroImage","focusRegions","libraryArtId","libraryArtName","art","artName"];
    if (content.kind === "mg" && content.mgRequest && !content.assetId) fields.push("assetId","assetName","fit","overlay");
    const media = Object.fromEntries(fields
      .filter(field => saved[field] !== undefined).map(field => [field,saved[field]]));
    shot.variants[shot.content.kind] = shot.content;
    const transition = content.transition ?? shot.content.transition;
    shot.content = {...content, ...media, ...(transition ? {transition} : {})};
    shot.variants[content.kind] = shot.content;
    delete shot.presentationStale;
  }

  function installDraft(w, mode, output, job) {
    if (mode === "stickers") {
      const map = output.stickersByShot || {};
      let added = 0;
      for (const [k, list] of Object.entries(map)) {
        const idx = Number(k);
        const shot = w.stagePlan.shots[idx];
        if (!shot || !Array.isArray(list)) continue;
        shot.stickers = list;
        added += list.length;
      }
      touch(w, true);
      if (current() === w) notify(added ? `已自动匹配 ${added} 个贴纸` : "本轮未新增贴纸，可手动从素材库添加", "ok");
      return;
    }
    if (mode === "clip-prompt") {
      const index = job.stageShotIndex;
      const shot = w.stagePlan.shots[index];
      if (shot?.content.kind === "clip" && output.clipPrompt) {
        shot.content.clipPrompt = output.clipPrompt;
        shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
        touch(w);
        if (current() === w) notify(`第 ${index + 1} 幕视频描述已生成`, "ok");
      }
      selected.set(w, index);
      return;
    }
    if (mode === "produce") {
      const index = job.stageShotIndex;
      const shot = w.stagePlan.shots[index];
      const expected = job.payload.draft.produceShot.shot;
      if (shot?.content.kind === output.content.kind && shot.name === expected.name && shot.line === expected.line) {
        output.content._revCount = (shot.content._revCount || 0) + 1;
        usePlan(shot, output.content);
        touch(w, true);
        if (current() === w) notify(output.content.mgRequest ? `第 ${index + 1} 幕已准备 MG 草稿建议` : `第 ${index + 1} 幕画面已制作`, "ok");
      }
      selected.set(w, index);
      return;
    }
    if (output.notice) notify(output.notice, "warn");
    if (mode === "replan") {
      for (const index of output.plannedIndices) usePlan(w.stagePlan.shots[index], output.shots[index].content);
      if (output.plannedIndices.length) touch(w, true);
      return;
    }
    w.stagePlan.shots = mode === "stage" ? output.shots.map(shot => ({
      ...shot, variants:{[shot.content.kind]:shot.content},
    })) : (output.slides || output.scenes || output.shots).map((row, index) => fromLegacy(row, mode, index));
    if (fixedKinds.includes(mode)) w.stagePlan.mode = mode;
    w.stagePlan.shortTitle = output.shortTitle || "";
    w.stagePlan.chapters = output.chapters || ["先看要点", "用药提醒"];
    w.stagePlan.disclaimer = output.disclaimer ?? TemplateVideo.DEFAULT_DISCLAIMER;
    if (Array.isArray(output.drugTags)) {
      w.stagePlan.drugTags = output.drugTags.map(t => String(t || "").trim().slice(0, 6)).filter(Boolean).slice(0, 2);
    } else delete w.stagePlan.drugTags;
    delete w.stagePlan.compatibility;
    w.title = output.title;
    w.stage = "script";
    w.viewingSetup = false;
    w.editing = false;
    w.video = null;
    w.videoDirty = false;
    selected.set(w, 0);
    syncBlocks(w);
  }

  function deck(w, themeDef) {
    const p = w.stagePlan;
    const themeProps = themeDef
      ? {
          theme: themeDef.base === "warm" ? "warm" : "medical",
          ...(p.themeId ? { themeId: p.themeId } : {}),
          themeVars: themeDef.vars,
          themeGlass: Boolean(themeDef.glass),
          ...(themeDef.fadeColor ? { themeFadeColor: themeDef.fadeColor } : {}),
          ...(themeDef.background?.assetId ? { themeBackground: StudioAssets.url(themeDef.background.assetId) } : {}),
        }
      : { theme: w.templateTheme || "medical" };
    const drug = String(w.drug || "").trim().slice(0, 20);
    const drugTags = Array.isArray(p.drugTags)
      ? p.drugTags.map(t => String(t || "").trim().slice(0, 6)).filter(Boolean).slice(0, 2)
      : [];
    return {title:w.title, shortTitle:p.shortTitle, chapters:p.chapters, disclaimer:p.disclaimer,
      ...(drug ? { drug } : {}), ...(drugTags.length ? { drugTags } : {}),
      ...themeProps, presenter:w.templatePresenter || "digital", pharmacist:{...TemplateStudio.ensurePharmacist(data)},
      slides:p.shots.map(shot => {
        const {points, content} = shot;
        const items = points.items.map(({title, detail}) => ({title, desc:detail}));
        return {...points, name:shot.name, line:shot.line, seconds:shot.seconds, chapterIndex:shot.chapterIndex,
          points:points.points || items, steps:points.steps || items, warnings:points.warnings || items, checks:points.checks || items,
          contentImage: content.kind === "image" ? content.image : "", outroImage:content.kind === "image" ? content.outroImage : "",
          focusRegions:content.focusRegions, motionStyle:content.motionStyle,
          ...(content.kind === "svg" ? {action:content.beats[0]?.action, svgBeats:content.beats, layoutMode:"explain"} : {}),
          ...(["card", "scene", "asset", "mg", "clip"].includes(content.kind) ? {layoutMode:"explain"} : {})};
      })};
  }

  function previewPlan(w, layout, themeDef) {
    let start = 0;
    const shots = w.stagePlan.shots.map(shot => {
      const cues = shot.cues.length ? shot.cues : authoredCues(shot.line);
      const weight = cues.reduce((sum, cue) => sum + (Number(cue.weight) || 1), 0) || 1;
      const end = start + shot.seconds;
      let cursor = start;
      const captions = cues.map(cue => {
        const start = cursor;
        cursor += shot.seconds * (Number(cue.weight) || 1) / weight;
        return {...cue, start, end:cursor};
      });
      if (captions.length) captions.at(-1).end = end;
      const content = shot.content;
      const stickers = Array.isArray(shot.stickers) && shot.stickers.length
        ? shot.stickers.slice(0, 2).map(st => ({
            ...st,
            url: StudioAssets.url(st.assetId),
            tags: stickerTagsCache.get(st.assetId) || st.tags || [],
          }))
        : undefined;
      const spec = {...content, kind:content.kind, name:shot.name, line:shot.line, items:shot.points.items,
        takeaway:shot.points.takeaway, listTitle:shot.points.listTitle, labels:shot.points.highlightWords, start, end, captions,
        ...(stickers ? { stickers } : {}),
        ...(content.libraryArtId ? {libraryArtUrl:StudioAssets.url(content.libraryArtId)} : {}),
        ...(artKinds.has(content.kind) && content.art ? {artUrl:content.art} : {}),
        ...(content.assetId ? (content.kind === "mg"
          ? {motionAssetUrl:StudioAssets.motionUrl(content.assetId)} : {assetUrl:StudioAssets.url(content.assetId)}) : {})};
      start = end;
      return spec;
    });
    return {layout, deck:deck(w, themeDef), shots, compatibility:w.stagePlan.compatibility, fontId:w.settings.fontId};
  }

  function select(name, field, values, current) {
    return `<label class="field">${name}<select data-stage-field="${field}">${opts(values, current)}</select></label>`;
  }

  function text(name, field, value, max = 60) {
    return `<label class="field">${name}<input data-stage-field="${field}" value="${esc(value || "")}" maxlength="${max}"></label>`;
  }

  function formPickerFields(shot, slot) {
    if (!window.InfoForms) return "";
    const c = shot.content;
    const groups = InfoForms.listByRelation(slot);
    const currentForm = c.form || "";
    const optionsHtml = `<option value="">默认（传统版式）</option>` + groups.map(g =>
      `<optgroup label="${esc(g.label)}">${g.forms.map(f =>
        `<option value="${esc(f.id)}"${f.id === currentForm ? " selected" : ""}>${esc(f.label)}</option>`
      ).join("")}</optgroup>`
    ).join("");
    const quickKeys = [
      ["answer", "核心结论", 24], ["question", "患者提问", 24], ["value", "核心数值", 10],
      ["unit", "单位", 8], ["condition", "适用条件", 18], ["interval", "间隔时间", 12],
      ["myth", "常见误区", 22], ["fact", "正确做法", 22], ["motto", "口诀金句", 22],
      ["label", "说明标签", 16], ["note", "底部提醒", 28],
    ];
    const quickInputs = currentForm && c.formData
      ? quickKeys.filter(([k]) => c.formData[k] !== undefined && typeof c.formData[k] !== "object")
        .map(([k, lbl, max]) => text(lbl, "formData:" + k, String(c.formData[k]), max)).join("")
      : "";
    return `<fieldset class="svg-beat-fields stage-form-fields"><legend>信息版式</legend>` +
      `<div class="asset-inline" style="margin-top:0"><label class="field" style="flex:1">版式<select data-stage-field="form">${optionsHtml}</select></label>` +
      btn("换个版式", "stage-next-form", "outline") +
      (currentForm ? btn("按要点刷新", "stage-sync-form", "textbtn") : "") + `</div>` +
      (currentForm ? `<div class="tpl-two-col">${select("视觉变体", "variant", [["solid","柔和填充"],["outline","清晰描边"],["split","左侧色条"]], c.variant || "solid")}</div>` : "") +
      (quickInputs ? `<div class="tpl-two-col">${quickInputs}</div>` : "") +
      `</fieldset>`;
  }

  function clipFields(w, shot, slot) {
    const c = shot.content;
    const style = c.clipStyle || "demo";
    const models = Object.entries(config.videoModels || {});
    const modelId = c.clipModel && config.videoModels?.[c.clipModel] ? c.clipModel : (w.settings.videoModel || models[0]?.[0] || "doubao-seedance-2-5-flash-261115");
    const modelSpec = config.videoModels?.[modelId] || ["Seedance", ["480p", "720p"], 15];
    const resList = modelSpec[1] || ["480p", "720p"];
    const resolution = resList.includes(c.clipResolution) ? c.clipResolution : (resList.includes("720p") ? "720p" : resList[0]);
    const maxSec = modelSpec[2] || 15;
    const defaultSec = Math.max(4, Math.min(maxSec, Math.ceil(shot.seconds || 5)));
    const seconds = c.clipSeconds && c.clipSeconds >= 4 && c.clipSeconds <= maxSec ? c.clipSeconds : defaultSec;
    const dims = clipDimensions(resolution, slot);
    const est = clipEstimate(modelId, resolution, seconds, dims, !c.clipFirstFrame, w);
    const estText = est.totalYuan !== null ? `预计 ¥${est.totalYuan.toFixed(2)}（按方舟实际用量结算）` : "按方舟实际用量结算";
    const costInfo = c.clip
      ? `<p class="small">已生成视频（${esc(config.videoModels?.[c.clipModel]?.[0] || c.clipModel || "视频片段")} · ${c.clipSeconds || Math.round(c.clipDuration || shot.seconds)} 秒${c.clipCost ? ` · 实际 ¥${Number(c.clipCost).toFixed(2)}` : ""}）。</p>`
      : "";
    return `<fieldset class="svg-beat-fields stage-clip-fields"><legend>${style === "mg" ? "AI MG 动画（视频生成）" : "AI 演示视频（视频生成）"}</legend>` +
      `<label class="field">画面动作描述（不含文字、品牌与医生形象）<textarea data-stage-field="clipPrompt" maxlength="400" rows="3" placeholder="${style === "mg" ? "例如：扁平 2D 动效，柔和蓝色背景上胶囊溶解并释放微粒…" : "例如：近景柔和光线，一只手用带刻度滴管量取退烧混悬液…"}">${esc(c.clipPrompt || "")}</textarea></label>` +
      `<div class="asset-inline">${btn("AI 写视频描述", "stage-clip-prompt", "outline")}</div>` +
      `<div class="stage-clip-frame-row">` +
      (c.clipFirstFrame ? `<img class="stage-clip-thumb" src="${esc(c.clipFirstFrame)}" alt="首帧预览">` : `<span class="small">尚未设置首帧（按内容区 ${slot ? `${slot.w}×${slot.h}` : "16:9"} 生成）</span>`) +
      `<div class="asset-inline">${btn(c.clipFirstFrame ? "重新生成首帧" : "生成首帧", "stage-clip-frame", "outline")}` +
      btn(c.clipFirstFrame ? "换素材库首帧" : "从素材库选首帧", "stage-choose", "outline", "clip-frame") + `</div></div>` +
      `<div class="tpl-two-col">` +
      select("视频模型", "clipModel", models.map(([id, spec]) => [id, spec[0]]), modelId) +
      select("分辨率", "clipResolution", resList.map(r => [r, r]), resolution) +
      `<label class="field">视频秒数（4–${maxSec} 秒）<input type="number" min="4" max="${maxSec}" step="1" data-stage-field="clipSeconds" value="${seconds}"></label>` +
      select("文字叠加", "overlay", [["points","标题和要点"],["title","只显示标题"],["off","关闭"]], c.overlay || "points") +
      select("短片时长适配", "clipSpeed", [["normal","不足时定格尾帧"],["slow","轻度慢放至 0.85×"]], c.clipSpeed || "normal") +
      `</div>` +
      `<div class="asset-inline">${btn(c.clip ? "重新生成 AI 视频" : "生成 AI 视频", "stage-clip-generate", "primary")}` +
      btn("从素材库选视频", "stage-choose", "outline", "clip-video") +
      (c.clip?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn", "clip") : "") +
      (c.clip ? btn("移除视频", "stage-clear", "textbtn", "clip") : "") + `</div>` +
      `<p class="small">${estText}</p>${costInfo}</fieldset>`;
  }

  function stickerFields(w, shot) {
    const list = Array.isArray(shot.stickers) ? shot.stickers : [];
    const cues = shot.cues?.length ? shot.cues : authoredCues(shot.line);
    const anchors = [["media-tl","左上"],["media-tr","右上"],["media-bl","左下"],["media-br","右下"],["headline-end","标题旁"],["item-0","要点1"],["item-1","要点2"]];
    const sfxChoices = [["auto","自动匹配"],["none","静音"],
      ["builtin:sfx/soft-pop","轻柔弹出"],["builtin:sfx/check","勾选提示"],["builtin:sfx/transition","柔和过渡"],
      ["builtin:sfx/kenney-pop","轻弹提示"],["builtin:sfx/kenney-confirm","清脆确认"]];
    const cards = list.map((st, i) => `
      <div class="stage-sticker-card">
        <div class="stage-sticker-head">
          <img class="stage-sticker-thumb" src="${esc(StudioAssets.url(st.assetId))}" alt="">
          <span class="small" style="flex:1">贴纸 ${i + 1}${st.reason ? ` · ${esc(st.reason)}` : ""}</span>
          ${btn("删除", "stage-sticker-remove", "textbtn danger", i)}
        </div>
        <div class="tpl-two-col">
          ${select("出现字幕", "sticker-cue:" + i, cues.map((c, ci) => [String(ci), `第${ci + 1}句：${c.text.slice(0, 14)}`]), String(st.cue ?? 0))}
          ${text("精确关键词（选填）", "sticker-keyword:" + i, st.keyword || "", 20)}
        </div>
        <div class="asset-inline" style="margin-top:4px"><span class="small">锚点：</span>${anchors.map(([id, lbl]) =>
          btn(lbl, "stage-sticker-anchor", "chip" + ((st.anchor || "media-tr") === id ? " selected" : ""), `${i}:${id}`)).join("")}</div>
        <div class="tpl-two-col">
          ${select("大小", "sticker-size:" + i, [["s","小"],["m","中"],["l","大"]], st.size || "m")}
          ${select("入场动效", "sticker-enter:" + i, [["pop","弹出"],["bounce","弹跳"],["slide","滑入"],["stamp","盖章"],["float","漂浮"]], st.enter || "pop")}
          ${select("停留时长", "sticker-hold:" + i, [["stay","留到本幕结束"],["cue","仅该句期间"]], st.hold || "stay")}
          ${select("贴纸音效", "sticker-sfx:" + i, sfxChoices, st.sfx || "auto")}
        </div>
      </div>`).join("");
    return `<fieldset class="svg-beat-fields stage-sticker-fields"><legend>贴纸叠加（${list.length}/2，不替换主画面）</legend>${cards}` +
      `<div class="asset-inline">${list.length < 2 ? btn("从素材库添加贴纸", "stage-choose", "outline", "sticker") : ""}` +
      btn("重新配贴纸", "stage-plan-stickers", "outline", "one") + `</div></fieldset>`;
  }

  function contentFields(w, shot, slot) {
    const c = shot.content;
    const pair = list => list.map(({id,name}) => [id,name]);
    if (c.kind === "image") {
      const sizeHint = slot ? `<p class="small">当前模板内容区 ${slot.w}×${slot.h}（${esc(slot.ratioLabel)}），生成配图将自动匹配该尺寸。` +
        (c.image && mediaRatioMismatched(c.imageMediaSize, slot) ? "当前配图与现布局比例不同，建议重新生成以铺满画幅。" : "") + "</p>" : "";
      return (c.image ? '<div class="asset-inline">' +
        (c.image?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn") : "") +
        btn("移除配图", "stage-clear", "textbtn", "image") + '</div>' : "") +
        text("配图描述", "imagePrompt", c.imagePrompt, 400) + sizeHint;
    }
    if (c.kind === "clip") return clipFields(w, shot, slot);
    if (c.kind === "asset") return (c.assetId ? '<div class="asset-inline">' + btn("移除素材", "stage-clear", "textbtn", "asset") + '</div>' : "") +
      select("素材运动", "move", [["still", "静止"], ["zoom", "缓慢推近"], ["pan", "平移"]], c.move);
    if (c.kind === "mg") return (c.assetId ? '<div class="asset-inline">' + btn("移除动画","stage-clear","textbtn","mg") + '</div>' : "") +
      select("文字叠加", "overlay", [["points","标题和要点"],["title","只显示标题"],["off","关闭"]], c.overlay || "points") +
      select("时长适配", "fit", [["auto","自动适配"],["hold","原速并定格"]], c.fit || "auto");
    if (c.kind === "card") return formPickerFields(shot, slot) + (c.form ? "" : select("动效方式", "motionStyle", window.CODE_MOTION_MOTION_CHOICES, c.motionStyle));
    if (c.kind === "scene") return formPickerFields(shot, slot) + (c.form ? "" : '<div class="tpl-two-col">' + select("分镜版式", "visual", pair(CODE_MOTION_VISUALS), c.visual) +
      select("动效方式", "motion", pair(CODE_MOTION_MOTIONS), c.motion) + select("主题图形", "motif", pair(CODE_MOTION_MOTIFS), c.motif) +
      select("强调色调", "tone", pair(CODE_MOTION_TONES), c.tone) + '</div>' + (c.art ? "" : '<div class="asset-inline">' +
      btn(esc(c.libraryArtName || "选配图或 SVG"), "stage-choose", "outline", "art") +
      (c.libraryArtId ? btn("恢复内置图形", "stage-clear", "textbtn", "art") : "") + '</div>'));
    return c.beats.map((beat, index) => `<fieldset class="svg-beat-fields"><legend>动作 ${index + 1}</legend>` +
      select("道具动作", "beat-action:" + index, Object.entries(config.svgMotion.actions), beat.action) +
      text("画面标签", "beat-label:" + index, beat.label, 10) + text("对应口播片段", "beat-line:" + index, beat.line, 55) +
      (c.beats.length > 1 ? btn("移除动作", "stage-beat-remove", "textbtn", index) : "") + '</fieldset>').join("") +
      (c.beats.length < 3 ? btn("添加动作", "stage-beat-add", "outline") : "");
  }

  const productionTitle = content => content.reason || content.assetId ? "重新制作本幕" : "制作本幕";
  const artKinds = new Set(["card", "scene"]);
  const missingArt = w => w.stagePlan.shots.flatMap((shot, i) =>
    artKinds.has(shot.content.kind) && shot.content.artPrompt?.trim() && !shot.content.art ? [i] : []);

  function artFields(c, slot) {
    const art = slot?.art;
    const placeText = art?.placement === "top"
      ? "画面上方显示横幅插画，下方逐条显示要点。"
      : "画面左侧显示插画，右侧逐条显示要点。";
    const sizeText = art ? `插画区 ${art.w}×${art.h}（${esc(art.ratioLabel)}）。` : "";
    const mismatch = c.art && art && mediaRatioMismatched(c.artMediaSize, art)
      ? "当前插画与现布局比例不同，建议重新生成。" : "";
    const note = (c.art ? (c.artName ? `已选素材：${esc(c.artName)}。` : "已生成插画。") : "生成后，") +
      placeText + sizeText + mismatch + (c.art ? "" : "插画由火山方舟按张计费。");
    return '<fieldset class="svg-beat-fields stage-art-fields"><legend>本幕插画</legend>' +
      `<label class="field">插画描述<textarea data-stage-field="artPrompt" maxlength="300" rows="3" placeholder="例如：妈妈用带刻度的量杯给孩子倒退烧药混悬液">${esc(c.artPrompt || "")}</textarea></label>` +
      '<div class="asset-inline">' + btn(c.art ? "重新生成插画" : "生成本幕插画", "stage-art", c.art ? "outline" : "primary", "one") +
      btn(c.art ? "从素材库换插画" : "从素材库选插画", "stage-choose", "outline", "art-image") +
      (c.art?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn", "art") : "") +
      (c.art ? btn("移除插画", "stage-clear", "textbtn", "art-image") : "") + '</div>' +
      `<p class="small">${note}</p></fieldset>`;
  }

  function illustrationPrompt(w, shot, layout, themeDef) {
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const art = slot.art;
    const theme = themeDef || currentThemeDef(w);
    const themeId = theme?.id || themeIdFor(w);
    const isDark = themeId === "builtin:theme/night" || Boolean(theme?.vars && LayoutEngine.isDarkTheme({ themeVars: theme.vars }));
    const warm = (w.templateTheme || "medical") === "warm" || themeId === "builtin:theme/illus";
    const items = shot.points.items.map(item => item.title).filter(Boolean).join("、");
    const subject = shot.content.artPrompt?.trim() || `表现「${shot.name}」：${items || shot.line.slice(0, 80)}`;
    const orientLabel = art.orientation === "landscape" ? "横幅" : art.orientation === "portrait" ? "竖幅" : "方形";
    const placeLine = art.placement === "top"
      ? `插画放在画面上方的${orientLabel}区域（${art.w}×${art.h}，比例 ${art.ratioLabel}），文字由程序另外叠加在下方`
      : `插画放在画面左侧的${orientLabel}区域（${art.w}×${art.h}，比例 ${art.ratioLabel}），文字由程序另外叠加在右侧`;
    const styleLine = isDark
      ? "风格：深色护眼扁平矢量医学插画，深蓝灰纯色背景（#162236），柔和天蓝（#62b4ff）、薄荷绿（#5ee2a0）与暖珊瑚（#ff7d6b）点缀，线条清晰干净、对比柔和。"
      : themeId === "builtin:theme/mint"
        ? "风格：清新临床薄荷扁平矢量医学插画，淡薄荷浅绿纯色背景（#edf8f4），以青绿（#0d9488）与深墨绿（#12322d）为主色，柔和暖橙点缀，线条圆润干净。"
        : warm
          ? "风格：温暖亲切的扁平手绘医学插画，柔和暖米白纯色背景（#fdf5e7），深炭蓝细描边（#2c3e50），暖砖红（#cf5228）、柔和草绿（#5c9145）与淡琥珀色点缀，色块干净，轻微纸张质感。"
          : "风格：现代清爽的扁平矢量医学插画，极浅蓝纯色背景（#eef5fd），以医学蓝（#1466cc）和深藏青（#122d4c）为主色，少量珊瑚橙（#e6592d）点缀，柔和渐变与轻阴影，线条圆润干净。";
    const compLine = art.orientation === "landscape"
      ? `构图：严格 ${art.ratioLabel} 横幅构图，核心主体居中或微偏中舒展排布，高度占画幅 65%–75%，左右留出均匀空白；背景纯色铺满，不画边框、卡片、画框或分栏。`
      : art.orientation === "portrait"
        ? `构图：严格 ${art.ratioLabel} 竖幅构图，一个清晰主体位于画面中央，约占画面 60%–65%，上下与左右留出均匀安全空白；背景纯色铺满，不画边框、卡片、画框或分栏。`
        : `构图：严格 ${art.ratioLabel} 方形构图，一个清晰主体位于中央，约占画面 60%，四周留出均匀空白；背景纯色铺满，不画边框、卡片、画框或分栏。`;
    return [
      `用途：医院药师用药科普短视频的配图插画。${placeLine}，插画本身不含任何文字。`,
      `画面内容：${subject}`,
      styleLine,
      compLine,
      w.drug && `涉及药品：${w.drug}（通用外观，不画品牌名、商品 Logo 和价格）。`,
      "禁止：画面中不出现任何文字、汉字、字母、数字、标签、对话框文字、品牌名、Logo 或水印；不画医生或主讲人头像；不画红十字标志；不做信息图排版。",
    ].filter(Boolean).join("\n").slice(0, 2100);
  }

  function hasProductionJob(w) {
    return isActive(w) && Boolean(w.job?.stageImageSlots || w.job?.stageClipShot !== undefined || ["produce", "stickers", "clip-prompt"].includes(w.job?.stageDraft));
  }

  function updateProductionJob(w) {
    const area = $("#stage-production-job");
    if (!area || !hasProductionJob(w)) return;
    const job = w.job;
    const picture = job.stageClipFrame ? "首帧" : job.stageArt ? "插画" : "配图";
    const subject = job.stageClipShot !== undefined ? `第 ${job.stageClipShot + 1} 幕 AI 视频`
      : job.stageDraft === "stickers" ? "贴纸匹配"
      : job.stageDraft === "clip-prompt" ? `第 ${job.stageShotIndex + 1} 幕视频描述`
      : job.stageShotIndex === undefined ? "缺失" + picture : `第 ${job.stageShotIndex + 1} 幕${job.stageImageSlots ? picture : "画面"}`;
    area.hidden = false;
    area.innerHTML = job.error
      ? `<div class="banner err" role="alert">${subject}未制作完成。${esc(job.error)}<div class="banner-actions">` +
        btn("继续此任务", "retry", "secondary") + btn("关闭提示", "abort-job", "textbtn") + '</div></div>'
      : `<div class="inline-progress" role="status"><span class="spinner" aria-hidden="true"></span><span id="progress">${esc(job.progress || `正在制作${subject}…`)}</span></div>`;
    app.querySelectorAll('[data-stage-production-lock], .stage-rail button').forEach(control => { control.disabled = true; });
  }

  function productionButtons(content, slot) {
    const {kind} = content;
    let actions = "";
    if (kind === "image") {
      actions = btn(content.image ? "重新生成本幕图" : "生成本幕配图", "stage-images", "primary", "one") +
        btn(content.image ? "从素材库换图" : "从素材库选图", "stage-choose", "outline", "image");
    } else if (kind === "asset") {
      actions = btn(esc(content.assetName || "选择图片或 SVG"), "stage-choose", "primary", "asset");
    } else if (kind === "mg") {
      actions = btn(esc(content.assetName || "选择 MG 动画"), "stage-choose", "primary", "mg") +
        (config.mgGeneration ? btn(content.assetId ? "重新制作 MG 草稿" : "制作 MG 草稿", "stage-create-mg", "outline") : "");
    }
    if (!["image", "clip"].includes(kind) && config.stageShotProduction) {
      actions += btn(productionTitle(content), "stage-produce", actions ? "outline" : "primary");
    }
    return (actions ? '<div class="asset-inline">' + actions + '</div>' : "") + (artKinds.has(kind) ? artFields(content, slot) : "");
  }

  function soundControls(w) {
    const settings = soundSettings(w);
    return '<div class="tpl-two-col">' +
      select("画面事件音效", "sfx-pack", [["off","关闭"], ...(config.sfxPacks || []).map(pack => [pack.id,pack.name])], settings.pack) +
      `<label class="field">音效音量
        <input type="range" min="-30" max="-6" step="1" data-stage-field="sfx-gain" value="${settings.gainDb}"
          ${settings.pack === "off" && !settings.stickerSfx ? "disabled" : ""}>
        <output id="stage-sfx-gain">${settings.gainDb} dB</output></label></div>` +
      `<label class="stage-overwrite"><input type="checkbox" data-stage-field="sfx-sticker"${settings.stickerSfx ? " checked" : ""}> 贴纸音效（贴纸出现时播放对应提示音）</label>`;
  }

  function bufferFor(id) {
    if (!decodedSounds.has(id)) {
      const pending = fetch(StudioAssets.url(id)).then(response => {
        if (!response.ok) throw Error("音效素材未加载。");
        return response.arrayBuffer();
      }).then(bytes => soundContext.decodeAudioData(bytes)).catch(error => {
        decodedSounds.delete(id);
        throw error;
      });
      decodedSounds.set(id, pending);
    }
    return decodedSounds.get(id);
  }

  function editor(w) {
    const shots = w.stagePlan.shots;
    const index = Math.min(selected.get(w) ?? w.job?.stageShotIndex ?? 0, shots.length - 1);
    const shot = shots[index];
    if (!shot) return setup(w);
    selected.set(w, index);
    const tabs = inspector.get(w) || "scene";
    const layoutMeta = currentLayoutDef(w);
    const slotDesc = LayoutEngine.describeMediaSlot(layoutMeta);
    const support = layoutMeta?.supports;
    const layoutId = w.stagePlan.layout.id;
    const isQaLayout = layoutId === "builtin:layout/qa-chat" || layoutMeta?.regions?.header?.variant === "question" || Boolean(layoutMeta?.regions?.answer);
    const isHeadlineLayout = layoutId === "builtin:layout/headline" || Boolean(layoutMeta?.regions?.headline);
    const isTakeawayLayout = layoutId === "builtin:layout/takeaway" || Boolean(layoutMeta?.regions?.keypoints);
    const editorModes = [
      ["image", "AI 完整图", shot.content.kind === "image", !support || support.includes("image")],
      ["card", "信息图动效", shot.content.kind === "card", !support || support.includes("card")],
      ["scene", "代码动效场景", shot.content.kind === "scene", !support || support.includes("scene")],
      ["clip:demo", "AI 演示视频", shot.content.kind === "clip" && (shot.content.clipStyle || "demo") === "demo", !support || support.includes("clip") || support.includes("image")],
      ["clip:mg", "AI MG 动画", shot.content.kind === "clip" && shot.content.clipStyle === "mg", !support || support.includes("clip") || support.includes("image")],
    ];
    const legacyTag = ["svg", "mg"].includes(shot.content.kind)
      ? `<span class="stage-legacy-badge" title="旧作品兼容保留，可预览导出或切换为新方式">旧版 ${shot.content.kind.toUpperCase()}</span>` +
        btn("改用 AI 视频", "stage-legacy-to-clip", "outline")
      : "";
    const kindButtons = editorModes.map(([val, name, active, allowed]) =>
      btn(name, "stage-kind", "chip" + (active ? " selected" : ""), val, `aria-pressed="${active}" ${allowed ? "" : "disabled"}`)
    ).join("") + legacyTag;
    const isMix = ["mix", "svg", "mg"].includes(w.stagePlan.mode);
    const settings = [layoutControls(w), themeControls(w), modeControls(w), text("作品标题", "work-title", w.title, 40),
      text("标题短句", "work-shortTitle", w.stagePlan.shortTitle, 20),
      text("关联药品", "work-drug", w.drug, 20),
      text("药品标签（最多 2 个，逗号分隔，每个 ≤6 字）", "work-drugTags", (w.stagePlan.drugTags || []).join("，"), 20),
      ...w.stagePlan.chapters.map((name,i) => text(`章节 ${i+1}`, "work-chapter:"+i, name, 10)),
      text("底部参考声明", "work-disclaimer", w.stagePlan.disclaimer, 60),
      TemplateStudio.templateSetupHtml(w,data,esc,btn,{hideTheme:true}), renderMusicStudioCard(w, {showModeChips:true}), soundControls(w),
      select("全片字体", "font", [["", "默认"], ["builtin:font/noto-sans-sc", "Noto Sans SC"]], w.settings.fontId)].join("");
    const items = shot.points.items.map(item => [item.title,item.detail,item.tag].filter(Boolean).join("｜")).join("\n");
    const layoutFields = (isQaLayout
      ? text("提问（≤30 字）", "point-question", shot.points.question, 30) +
        text("结论（≤16 字）", "point-answer", shot.points.answer, 16) +
        select("结论语气", "point-verdictTone", [["", "默认（正确 ✓）"], ["ok", "正确 / 推荐（✓）"], ["no", "否定 / 禁止（✗）"], ["warn", "提醒 / 注意（!）"]], shot.points.verdictTone || "")
      : "") +
      (isHeadlineLayout
        ? text("强调短语（须在标题中，≤8 字）", "point-accentPhrase", shot.points.accentPhrase, 8) +
          text("一句解释（≤30 字）", "point-lead", shot.points.lead, 30)
        : "");
    const decision = isMix || shot.content.reason || shot.content.adjusted || shot.content.mgRequest || shot.content.clipSuggestion ? '<div class="stage-decision">' +
      (shot.content.reason ? `<p>${esc(shot.content.reason)}</p>` : "") +
      (shot.content.adjusted ? `<p class="small stage-adjusted">${esc(shot.content.adjusted)}</p>` : "") +
      (shot.content.clipSuggestion && shot.content.kind !== "clip"
        ? `<p class="small">建议用 AI 视频：${esc(shot.content.clipSuggestion)}</p>` +
          `<div class="asset-inline">${btn("改用 AI 演示视频", "stage-use-clip-suggestion", "outline", "demo")}${btn("改用 AI MG 动画", "stage-use-clip-suggestion", "outline", "mg")}</div>`
        : "") +
      (shot.content.kind === "mg" && shot.content.mgRequest ? `<p class="small">MG 草稿建议：${esc(shot.content.mgRequest)}</p>` : "") +
      '<p class="small" id="stage-stale"' + (shot.presentationStale ? "" : " hidden") + '>口播或要点已更新，可重做画面。</p>' +
      (isMix ? btn("本幕重新判断", "stage-replan", "outline", "one") : "") + '</div>' : "";
    const scene = '<span class="label">本幕制作方式</span><div class="chips">' + kindButtons + '</div>' + productionButtons(shot.content, slotDesc) + decision +
      '<div id="stage-mg-panel" hidden></div>' +
      (index ? select("幕间转场", "transition", Object.entries(config.stageCatalog.transitions || {fade:"淡入"}), shot.content.transition || "fade") : "") +
      text("本幕标题", "name", shot.name) + `<label class="field">本幕口播<textarea data-stage-field="line" maxlength="450" rows="3">${esc(shot.line)}</textarea></label>` +
      '<div class="tpl-two-col">' + text("预览时长（秒）", "seconds", shot.seconds, 4) +
      select("所属章节", "chapterIndex", w.stagePlan.chapters.map((name,index) => [String(index),name]), String(shot.chapterIndex)) + '</div>' +
      select("要点结构", "point-type", Object.keys(pointVisual()).map(type => [type, TemplateVideo.SLIDE_TYPES[type]?.name || codeMotionVisualSpec(pointVisual()[type]).name]), shot.points.type) +
      text(isHeadlineLayout ? "大标题" : "屏显要点标题", "point-headline", shot.points.headline) +
      layoutFields +
      text(isTakeawayLayout ? "记住这一句" : "画面结语", "point-takeaway", shot.points.takeaway) +
      `<label class="field">要点（每行一条，可用「｜」分隔说明和标签）<textarea data-stage-field="point-items" rows="3">${esc(items)}</textarea></label>` +
      `<details class="shot-options"><summary>字幕节拍（${shot.cues.length}）</summary>${shot.cues.map((cue,i) =>
        '<div class="tpl-two-col">' + text("字幕", "cue-text:"+i, cue.text, 240) +
        select("聚焦", "cue-focus:"+i, [["all","全幕"],["0","第一项"],["1","第二项"],["2","第三项"],["3","第四项"],["top","上方"],["bottom","下方"],["question","问题"],["answer","答复"],["action","行动"],["outro","片尾"]], cue.focus || "all") + '</div>').join("")}</details>` +
      contentFields(w, shot, slotDesc) + stickerFields(w, shot) + '<div class="asset-inline">' + btn("本幕前移", "stage-move", "outline", "-1", index === 0 ? "disabled" : "") +
      btn("本幕后移", "stage-move", "outline", 1, index === shots.length - 1 ? "disabled" : "") +
      btn("删除本幕", "stage-remove", "textbtn danger", "", shots.length === 1 ? "disabled" : "") + '</div><div class="asset-inline">' +
      btn(esc(shot.sfxName || "选出场音效"),"stage-choose","outline","sfx") +
      (shot.sfxId ? btn("移除出场音效","stage-clear","textbtn","sfx") : "") + '</div>';
    const actions = (isMix ? btn("重新编排全片","stage-replan","outline","all") : "") +
      btn("自动加贴纸", "stage-plan-stickers", "outline", "all") +
      btn("全片模型与配音", "work-settings", "outline") +
      (shots.some(shot => shot.content.kind === "image" && !shot.content.image) ? btn("生成缺失配图", "stage-images", "outline", "missing") : "") +
      (missingArt(w).length ? btn("生成缺失插画", "stage-art", "outline", "missing") : "") +
      btn("合成视频", "stage-compose", "primary");
    const strip = shots.map((s,i) => `<button type="button" class="scene-choice" data-action="stage-select" data-val="${i}" aria-pressed="${i === index}"${isMix && s.content.reason ? ` title="${esc(s.content.reason)}"` : ""}>
      <span class="scene-choice-title">${i + 1} ${esc(s.name)}</span><span class="scene-choice-meta"><span class="stage-kind-badge">${kindLabel(s.content)}</span>${s.seconds} 秒${isMix && s.content.adjusted ? ' · 已调整' : ''}</span></button>`).join("");
    shell(w, "编辑视频分镜", 1, `<div class="vstudio"><div class="sheet vstudio-bar"><div class="vstudio-summary">
      <span class="vstudio-metric">共 ${shots.length} 幕 · ${Math.round(shots.reduce((n,s)=>n+s.seconds,0))} 秒</span></div><fieldset class="vstudio-actions stage-edit-fields" data-stage-production-lock>${actions}</fieldset></div>
      <div class="vstudio-grid"><section class="sheet vstudio-stage-card"><div class="vstudio-stage-head"><strong>${esc(shot.name)}</strong>
      <span id="stage-preview-state" role="status">载入预览…</span></div><iframe id="stage-preview" src="/stage.html" title="分镜预览"></iframe>
      <div id="stage-production-job" hidden></div>
      <div class="asset-inline"><button type="button" class="outline" id="stage-play" disabled>播放本幕</button>
      ${shot.content.kind === "svg" && w.settings.voice !== "无配音" ? btn("试听本幕口播","stage-speech","outline") : ""}
      ${soundSettings(w).pack !== "off" || soundSettings(w).stickerSfx || shot.sfxId ? btn("试听音效","stage-audition","outline") : ""}
      <input type="range" aria-label="本幕播放进度" min="0" max="${shot.seconds}" step="0.01" value="${Math.min(1,shot.seconds/2)}" id="stage-seek"></div>
      <div class="stage-rail">${strip}${btn("添加一幕", "stage-add", "outline", "", shots.length >= 12 ? "disabled" : "")}</div></section>
      <aside class="sheet"><div class="vstudio-tabs" role="tablist" aria-label="分镜设置">${["scene","global"].map(id =>
        btn(id === "scene" ? "本幕内容" : "全片设置", "stage-inspector", "vstudio-tab", id, `role="tab" aria-selected="${id===tabs}"`)).join("")}</div>
      <div role="tabpanel"><fieldset class="stage-fields stage-edit-fields" data-stage-production-lock>${tabs === "scene" ? scene : settings}</fieldset></div></aside></div></div>`);
    bindPreview(w, index);
    updateProductionJob(w);
    const panel = mgPanels.get(shot);
    const host = $("#stage-mg-panel");
    if (host && panel) {
      host.append(panel);
      host.hidden = false;
    }
  }

  function bindPreview(w, index) {
    const iframe = $("#stage-preview"), button = $("#stage-play"), seek = $("#stage-seek"), status = $("#stage-preview-state");
    let frame, player, plan, audio, playing = false;
    let run = 0;
    const sources = new Set();
    function pause() {
      run++;
      playing = false;
      audio?.pause();
      cancelAnimationFrame(frame);
      for (const source of sources) source.stop();
      sources.clear();
      button.textContent = "播放本幕";
    }
    async function soundTimeline() {
      const settings = soundSettings(w);
      const events = soundPack(settings.pack)?.events || {};
      const shot = plan.shots[index];
      const sounds = [];
      for (const event of player.collectStageEvents()) {
        if (event.shot !== index) continue;
        if (event.type === "sticker" && event.sfxId) {
          if (settings.stickerSfx) sounds.push({assetId: event.sfxId, time: event.t - shot.start, gainDb: settings.gainDb});
        } else if (events[event.type]) {
          sounds.push({assetId: events[event.type], time: event.t - shot.start, gainDb: settings.gainDb});
        }
      }
      const manual = w.stagePlan.shots[index]?.sfxId;
      if (manual) sounds.push({assetId:manual, time:.16, gainDb:-12});
      if (!sounds.length) return [];
      soundContext ||= new AudioContext();
      await soundContext.resume();
      return await Promise.all(sounds.map(async sound => ({...sound, buffer:await bufferFor(sound.assetId)})));
    }
    function schedule(sounds, scale = 1) {
      if (!sounds.length) return;
      const start = soundContext.currentTime;
      for (const sound of sounds) {
        const source = soundContext.createBufferSource();
        const gain = soundContext.createGain();
        source.buffer = sound.buffer;
        gain.gain.value = 10 ** (sound.gainDb / 20);
        source.connect(gain).connect(soundContext.destination);
        source.addEventListener("ended", () => sources.delete(source), {once:true});
        source.start(start + sound.time * scale);
        sources.add(source);
      }
    }
    function draw(offset) {
      const shot = plan.shots[index];
      player.drawFrame(Math.min(shot.end - .001, shot.start + offset));
    }
    async function prepare() {
      const [layout, themeDef] = await Promise.all([
        getLayout(w.stagePlan.layout.id),
        w.stagePlan.themeId ? getTheme(w.stagePlan.themeId) : null,
      ]);
      if (!iframe.isConnected) return;
      player = iframe.contentWindow;
      plan = previewPlan(w, layout, themeDef);
      seek.max = String(w.stagePlan.shots[index].seconds);
      await player.setPlan(plan);
      draw(Number(seek.value));
      status.textContent = "";
      button.disabled = false;
    }
    iframe.addEventListener("load", () => prepare().catch(error => {status.textContent = error.message;}), {once:true});
    iframe.refreshStage = () => { if (player) prepare().catch(error => {status.textContent = error.message;}); };
    iframe.playSpeech = async speech => {
      if (!player) return;
      pause();
      const ticket = run;
      audio = new Audio(speech.url);
      playing = true;
      button.textContent = "暂停";
      const tick = () => {
        if (!iframe.isConnected || audio.ended || !playing) return pause();
        const position = Math.min(Number(seek.max), audio.currentTime / speech.seconds * Number(seek.max));
        seek.value = String(position);
        draw(position);
        frame = requestAnimationFrame(tick);
      };
      try {
        const sounds = await soundTimeline();
        if (ticket !== run || !iframe.isConnected) return;
        await audio.play();
        if (ticket !== run || !iframe.isConnected) return;
        schedule(sounds, speech.seconds / Number(seek.max));
        tick();
      } catch (error) {
        pause();
        notify(error.message, "warn");
      }
    };
    seek.addEventListener("input", () => { pause(); if (player) draw(Number(seek.value)); });
    async function play(audition) {
      if (!player) return;
      if (playing) { pause(); return; }
      playing = true;
      const ticket = ++run;
      button.textContent = "暂停";
      let sounds;
      try {
        sounds = await soundTimeline();
      } catch (error) {
        pause();
        notify(error.message,"warn");
        return;
      }
      if (ticket !== run || !iframe.isConnected) return;
      if (audition && !sounds.length) notify("本幕没有需要试听的音效。");
      schedule(sounds);
      const start = performance.now();
      function tick(now) {
        if (!iframe.isConnected) return pause();
        const time = Math.min(Number(seek.max), (now - start) / 1000);
        seek.value = String(time);
        draw(time);
        if (time < Number(seek.max)) frame = requestAnimationFrame(tick);
        else pause();
      }
      tick(start);
    }
    iframe.audition = () => play(true);
    button.addEventListener("click", () => play(false));
  }

  function handleInput(w, el) {
    const field = el.dataset.stageField;
    if (!isActive(w) || !field) return false;
    const shot = w.stagePlan.shots[selected.get(w) || 0];
    const [key, rawIndex] = field.split(":");
    const value = el.value;
    if (key === "sfx-pack" || key === "sfx-gain" || key === "sfx-sticker") {
      const options = {...soundSettings(w)};
      if (key === "sfx-pack") {
        options.pack = value;
        if (value !== "off" && !soundPack(value)) return true;
      } else if (key === "sfx-sticker") {
        options.stickerSfx = Boolean(el.checked);
      } else {
        options.gainDb = Number(value);
        $("#stage-sfx-gain").value = `${value} dB`;
      }
      (w.stagePlan.audio ||= {}).sfx = options;
      touch(w);
      if (key !== "sfx-gain") render(true);
      return true;
    }
    if (key === "autoStickers") {
      w.stagePlan.autoStickers = Boolean(el.checked);
      touch(w);
      return true;
    }
    if (key === "work-title") w.title = value;
    else if (key === "work-drug") w.drug = value.slice(0, 20);
    else if (key === "work-drugTags") {
      const tags = value.split(/[，,、\s]+/).map(t => t.trim().slice(0, 6)).filter(Boolean).slice(0, 2);
      if (tags.length) w.stagePlan.drugTags = tags;
      else delete w.stagePlan.drugTags;
    }
    else if (key === "work-chapter") w.stagePlan.chapters[Number(rawIndex)] = value;
    else if (key.startsWith("work-")) w.stagePlan[key.slice(5)] = value;
    else if (key === "font") {
      if (value) w.settings.fontId = value;
      else delete w.settings.fontId;
    } else if (key === "line") {
      shot.line = value;
      shot.cues = authoredCues(value, shot.points.highlightWords);
      delete shot.speech;
    } else if (key === "name") shot.name = value;
    else if (key === "seconds") {
      if (Number(value) >= 2 && Number(value) <= 60) shot.seconds = Number(value);
    } else if (key === "chapterIndex") shot.chapterIndex = Number(value);
    else if (key === "point-items") {
      shot.points.items = value.split("\n").filter(Boolean).slice(0, 4).map(row => {
        const [title,detail="",tag=""] = row.split("｜");
        return {title,detail,tag};
      });
      for (const field of ["points","steps","warnings","columns","checks"]) delete shot.points[field];
    } else if (key === "form") {
      if (!value) {
        delete shot.content.form;
        delete shot.content.formData;
        delete shot.content.variant;
      } else {
        shot.content.form = value;
        shot.content.variant = shot.content.variant || "solid";
        shot.content.formData = window.InfoForms ? InfoForms.fromPoints(value, shot) : {};
      }
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
      render(true);
      return true;
    } else if (key === "formData" && rawIndex) {
      shot.content.formData ||= {};
      const oldVal = shot.content.formData[rawIndex];
      shot.content.formData[rawIndex] = typeof oldVal === "number" ? (Number(value) || oldVal) : value;
      shot.variants[shot.content.kind] = shot.content;
    } else if (key === "clipSeconds") {
      const n = Math.round(Number(value));
      if (n >= 4 && n <= 30) shot.content.clipSeconds = n;
    } else if (key === "clipModel" || key === "clipResolution") {
      shot.content[key] = value;
      touch(w);
      render(true);
      return true;
    } else if (key.startsWith("sticker-") && rawIndex !== undefined) {
      const st = shot.stickers?.[Number(rawIndex)];
      if (st) {
        const sub = key.slice(8);
        st[sub] = sub === "cue" ? Number(value) : value;
      }
    } else if (key.startsWith("point-")) shot.points[key.slice(6)] = value;
    else if (key.startsWith("cue-")) shot.cues[Number(rawIndex)][key.slice(4)] = value;
    else if (key.startsWith("beat-")) shot.content.beats[Number(rawIndex)][key.slice(5)] = value;
    else shot.content[key] = value;
    if (shot && (["line","name"].includes(key) || key.startsWith("point-"))) {
      shot.presentationStale = true;
      const stale = $("#stage-stale");
      if (stale) stale.hidden = false;
    }
    touch(w, key !== "font");
    $("#stage-preview")?.refreshStage?.();
    return true;
  }

  async function prepareImages(w, mode) {
    const p = w.stagePlan;
    const indices = mode === "one" ? [selected.get(w) || 0] : p.shots.flatMap((shot,i) => shot.content.kind === "image" && !shot.content.image ? [i] : []);
    if (!indices.length || w.job || indices.some(i => p.shots[i].content.kind !== "image")) return;
    if (!checkShotText(w, indices)) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, slot.w, slot.h);
    const settings = { ...w.settings, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
    const authSettings = { ...settings, sizeLabel: `${slot.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, indices.length, "images", () => {
      const data = deck(w, themeDef);
      const items = indices.map((index,i) => ({
        prompt: TemplateVideo.buildCardImagePrompt(data, index, p.shots[index].content.imagePrompt, w.drug, layout, themeDef),
        variant: i + 1,
      }));
      const job = createJob(w, "stage-images", items, settings);
      delete job.payload.storyboard;
      Object.assign(job.payload, {template:true, styleReference:false});
      job.stageImageSlots = indices;
      if (mode === "one") job.stageShotIndex = indices[0];
      w.job = job;
      return sendJob(w);
    });
  }

  async function prepareArt(w, mode) {
    const p = w.stagePlan;
    const indices = mode === "one" ? [selected.get(w) || 0] : missingArt(w);
    if (!indices.length || w.job || indices.some(i => !artKinds.has(p.shots[i].content.kind))) return;
    if (!checkShotText(w, indices)) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const art = slot.art;
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, art.w, art.h);
    const settings = { ...w.settings, ratio: art.arkRatio, targetSize: { w: art.w, h: art.h } };
    const authSettings = { ...settings, sizeLabel: `${art.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, indices.length, "images", () => {
      const items = indices.map((index,i) => ({prompt:illustrationPrompt(w, p.shots[index], layout, themeDef), variant:i + 1}));
      const job = createJob(w, "stage-images", items, settings);
      delete job.payload.storyboard;
      Object.assign(job.payload, {template:true, styleReference:false});
      job.stageImageSlots = indices;
      job.stageArt = true;
      if (mode === "one") job.stageShotIndex = indices[0];
      w.job = job;
      return sendJob(w);
    });
  }

  function clipFirstFramePrompt(w, shot, style, layout, themeDef) {
    const slot = LayoutEngine.describeMediaSlot(layout || currentLayoutDef(w));
    const desc = shot.content.clipPrompt?.trim() || `表现「${shot.name}」：${shot.line.slice(0, 100)}`;
    const prefix = style === "mg"
      ? "风格：扁平 2D 医学科普动态图形首帧，几何构图清晰、柔和干净纯色背景、矢量质感。"
      : "风格：柔和自然光线的写实/半写实生活场景首帧，主体清晰居中，适合接续生成短视频演示。";
    return [
      `用途：用药科普短视频第 ${slot.ratioLabel}（${slot.w}×${slot.h}）内容区的 AI 视频首帧。`,
      `画面内容：${desc}`,
      prefix,
      w.drug && `涉及药品：${w.drug}（通用外观，不画品牌名与商标）。`,
      "禁止：画面不出现任何文字、数字、品牌 Logo、水印或医生正面肖像。",
    ].filter(Boolean).join("\n").slice(0, 1800);
  }

  async function prepareClipFrame(w) {
    const index = selected.get(w) || 0;
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || w.job) return;
    if (!checkShotText(w, [index])) return;
    const layout = await resolveWorkLayout(w);
    const themeDef = currentThemeDef(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const pxSize = LayoutEngine.imagePixelSize(w.settings.imageSize, slot.w, slot.h);
    const settings = { ...w.settings, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
    const authSettings = { ...settings, sizeLabel: `${slot.ratioLabel} · ${pxSize}` };
    return authorize({ ...w, settings: authSettings }, 1, "images", () => {
      const items = [{ prompt: clipFirstFramePrompt(w, shot, shot.content.clipStyle || "demo", layout, themeDef), variant: 1 }];
      const job = createJob(w, "stage-images", items, settings);
      delete job.payload.storyboard;
      Object.assign(job.payload, { template: true, styleReference: false });
      job.stageImageSlots = [index];
      job.stageClipFrame = true;
      job.stageShotIndex = index;
      w.job = job;
      return sendJob(w);
    });
  }

  async function prepareClipVideo(w) {
    const index = selected.get(w) || 0;
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || w.job) return;
    const c = shot.content;
    if (!c.clipPrompt?.trim()) return notify("请先填写或 AI 生成视频描述。", "warn");
    if (!c.clipFirstFrame) return notify("请先生成或从素材库选择首帧图片。", "warn");
    if (!config.keyPresent) return openApiKeys("ark");
    const layout = await resolveWorkLayout(w);
    const slot = LayoutEngine.describeMediaSlot(layout);
    const models = Object.keys(config.videoModels || {});
    const modelId = c.clipModel && config.videoModels?.[c.clipModel] ? c.clipModel : (w.settings.videoModel || models[0] || "doubao-seedance-2-5-flash-261115");
    const modelSpec = config.videoModels?.[modelId] || ["Seedance", ["480p", "720p"], 15];
    const resList = modelSpec[1] || ["480p", "720p"];
    const resolution = resList.includes(c.clipResolution) ? c.clipResolution : (resList.includes("720p") ? "720p" : resList[0]);
    const maxSec = modelSpec[2] || 15;
    const seconds = Math.max(4, Math.min(maxSec, Math.round(c.clipSeconds || Math.ceil(shot.seconds || 5))));
    const dims = clipDimensions(resolution, slot);
    const est = clipEstimate(modelId, resolution, seconds, dims, false, w);
    const costLine = est.totalYuan !== null
      ? `预计 <strong>¥${est.totalYuan.toFixed(2)}</strong>，按方舟实际用量结算`
      : "按方舟实际用量结算";
    retryPayload = () => {
      const settings = { ...w.settings, videoModel: modelId, resolution, ratio: slot.arkRatio, targetSize: { w: slot.w, h: slot.h } };
      const job = createJob(w, "stage-clip", [], settings);
      delete job.payload.storyboard;
      job.payload.clip = {
        shotIndex: index,
        clipStyle: c.clipStyle || "demo",
        prompt: c.clipPrompt.trim(),
        image: c.clipFirstFrame,
        seconds,
      };
      job.stageClipShot = index;
      job.stageShotIndex = index;
      w.job = job;
      return sendJob(w);
    };
    openModal("确认生成 AI 视频片段",
      `<p>将调用 <strong>${esc(modelSpec[0])}</strong>（${esc(resolution)} · ${seconds} 秒 · ${dims[0]}×${dims[1]}）为第 ${index + 1} 幕生成视频。</p>` +
      `<p>${costLine}。</p>` +
      `<div class="actions dialog-actions">${btn("取消", "close", "secondary")}${btn("确认提交并计费", "confirm-paid", "primary")}</div>`, "confirm");
  }

  function installClip(w, index, output, job) {
    const shot = w.stagePlan.shots[index];
    if (!shot || shot.content.kind !== "clip" || !output?.clip) return;
    Object.assign(shot.content, {
      clip: output.clip,
      clipPoster: output.clipPoster || shot.content.clipPoster || "",
      clipModel: output.clipModel || shot.content.clipModel,
      clipResolution: output.clipResolution || shot.content.clipResolution,
      clipSeconds: output.clipSeconds || shot.content.clipSeconds,
      clipDuration: output.clipDuration || output.clipSeconds || shot.seconds,
      clipCost: output.clipCost ?? shot.content.clipCost,
    });
    shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
    touch(w, true);
    if (current() === w) notify(`第 ${index + 1} 幕 AI 视频已生成`, "ok");
  }

  function installImages(w, indices, output, job) {
    const art = Boolean(job?.stageArt);
    const clipFrame = Boolean(job?.stageClipFrame);
    const targetSize = job?.payload?.settings?.targetSize;
    indices.forEach((index,i) => {
      const shot = w.stagePlan.shots[index];
      if (clipFrame && shot?.content.kind === "clip" && output.images[i]) {
        shot.content.clipFirstFrame = output.images[i];
        shot.variants[`clip:${shot.content.clipStyle || "demo"}`] = shot.content;
        return;
      }
      const fits = art ? artKinds.has(shot?.content.kind) : shot?.content.kind === "image";
      if (fits && output.images[i]) {
        if (art) {
          shot.content.art = output.images[i];
          if (targetSize) shot.content.artMediaSize = { w: targetSize.w, h: targetSize.h };
          delete shot.content.artName;
        } else {
          shot.content.image = output.images[i];
          if (targetSize) shot.content.imageMediaSize = { w: targetSize.w, h: targetSize.h };
        }
        shot.variants[shot.content.kind] = shot.content;
      }
    });
    touch(w);
  }

  function prepareSpeech(w, index) {
    const shot = w.stagePlan.shots[index];
    const cached = shot.speech;
    if (cached?.line === shot.line.trim() && cached.voice === w.settings.voice) {
      return $("#stage-preview")?.playSpeech?.(cached);
    }
    if (!shot.line.trim() || shot.line.trim().length > 100) return notify("逐幕试听口播须为 1–100 字。","warn");
    return confirmSvgJob(w, () => {
      const {line,seconds,name} = shot;
      const action = shot.content.beats[0]?.action || "leaflet";
      const job = createJob(w,"svg-speech",[{line:line.trim(),seconds:Math.min(35,seconds),name,action,index}]);
      job.stageSpeechIndex = index;
      job.payload.workId = w.id;
      w.job = job;
      return sendJob(w);
    },true);
  }

  function installSpeech(w, index, job, output) {
    const shot = w.stagePlan.shots[index];
    if (shot?.line.trim() === job.payload.items[0].line) {
      shot.speech = {...output,line:shot.line.trim(),voice:job.payload.settings.voice};
      syncBlocks(w);
    }
  }

  async function compose(w) {
    if (w.job) return;
    if (!config.codeMotionReady) return notify("合成需要 Node.js、Playwright、Chrome 和 FFmpeg。", "warn");
    const p = w.stagePlan;
    if (!checkShotText(w, p.shots.map((_, index) => index))) return;
    const missing = p.shots.findIndex(({content}) => content.kind === "image" ? !content.image
      : content.kind === "clip" ? !content.clip
      : ["asset","mg"].includes(content.kind) && !content.assetId);
    if (missing !== -1) {
      const {name, content:{kind}} = p.shots[missing];
      const label = `第 ${missing + 1} 幕「${name.trim()}」`;
      return showShotIssue(w, missing, `${label}缺少${kind === "image" ? "配图" : kind === "clip" ? "AI 视频片段" : "素材"}，请补齐或切换制作方式。`,
        kind === "image" ? '[data-action="stage-images"][data-val="one"]'
        : kind === "clip" ? '[data-action="stage-clip-generate"]'
        : `[data-action="stage-choose"][data-val="${kind}"]`);
    }
    const appearance = deck(w);
    const avatarMode = w.videoMode === "svg" ? "static"
      : w.videoMode === "code-motion" ? codeMotionAvatarMode(w) : resolveAvatarMode(w.settings.avatarMode);
    const avatar = w.settings.voice !== "无配音" && appearance.presenter !== "none" && avatarMode !== "static"
      ? {enabled:true,model:avatarMode,resolution:w.settings.avatarResolution || "480P",presenter:appearance.presenter,image:TemplateVideo.resolveAvatarSrc(appearance)} : null;
    const send = () => {
      const items = p.shots.map(({variants,speech,...shot}) => ({...shot, tailPause:shot.cues.some(cue => cue.focus === "outro") ? 1.15 : 0.55}));
      const job = createJob(w,"compose",items,{...w.settings,...videoMusicSettings(w),ratio:"16:9"});
      delete job.payload.storyboard;
      delete job.payload.codeMotion;
      delete job.payload.svg;
      delete job.payload.svgLayout;
      Object.assign(job.payload,{stage:true,layoutId:p.layout.id,title:w.title,shortTitle:p.shortTitle || undefined,
        ...(w.drug?.trim() ? {drug:w.drug.trim().slice(0, 20)} : {}),
        ...(p.drugTags?.length ? {drugTags:p.drugTags.slice(0, 2)} : {}),
        disclaimer:p.disclaimer,chapters:p.chapters,appearance:{theme:appearance.theme,presenter:appearance.presenter,pharmacist:appearance.pharmacist,
          ...(p.themeId ? {themeId:p.themeId} : {})},
        compatibility:p.compatibility,audio:p.audio,...(avatar ? {avatar} : {}),...(w.video?.url ? {previousVideo:w.video.url} : {})});
      // Drop optional absent values before saving so the replay payload is byte-stable.
      job.payload = JSON.parse(JSON.stringify(job.payload));
      w.job = job;
      return sendJob(w);
    };
    if (w.settings.voice !== "无配音" || avatar) {
      if (!config.speechKeyPresent && !w.video) return openApiKeys("speech");
      if (avatar && !config.dashscopeKeyPresent && !w.video) return openApiKeys("dashscope");
      return authorizeSpeechOnly(w,p.shots.length,send,{usesAvatar:Boolean(avatar),avatarModel:avatar?.model,reuseSpeech:Boolean(w.video)});
    }
    retryPayload = send;
    const pictures = p.shots.filter(shot => shot.content.kind === "image").length;
    openModal("确认合成视频", `<p>${pictures ? `复用 ${pictures} 张已有配图。` : ""}本地渲染，无模型画面费用。</p><div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认合成 MP4","confirm-paid","primary")}</div>`, "confirm");
  }

  function handleAction(w, action, value) {
    if (!isActive(w) || !action.startsWith("stage-")) return false;
    const p = w.stagePlan;
    const index = selected.get(w) || 0;
    const shot = p.shots[index];
    if (action === "stage-manage-layouts") { StudioAssets.manageLayouts(); return true; }
    if (action === "stage-manage-themes") { StudioAssets.manageThemes(); return true; }
    if (action === "stage-theme") {
      const theme = activeThemes().find(item => item.id === value);
      if (!theme || value === themeIdFor(w)) return true;
      p.themeId = value;
      w.templateTheme = theme.base === "warm" ? "warm" : "medical";
      touch(w, true);
    }
    else if (action === "stage-layout") {
      const layout = activeLayouts().find(item => item.id === value);
      if (!layout || value === p.layout.id) return true;
      if (layout.supports && p.shots.some(row => !layout.supports.includes(row.content.kind))) {
        notify("所选布局缺少本片使用的制作方式。","warn");
        return true;
      }
      if (!allowsMode(layout, p.mode)) {
        const allowed = draftModes.find(([kind]) => allowsMode(layout,kind));
        if (!allowed) { notify("所选布局不支持脚本制作方式。","warn"); return true; }
        p.mode = allowed[0];
      }
      p.layout.id = value;
      touch(w, true);
    }
    else if (action === "stage-mode" && ["mix", ...fixedKinds].includes(value) && p.mode !== value) {
      p.mode = value;
      p.shots.forEach(shot => {
        selectKind(w, shot, value === "mix" ? defaultKind(w, shot.points.type) : value);
        for (const key of ["decidedBy","reason","adjusted"]) delete shot.content[key];
      });
      touch(w, true);
    } else if (action === "stage-inspector") inspector.set(w, value);
    else if (action === "stage-select") { selected.set(w, Number(value)); inspector.set(w, "scene"); }
    else if (action === "stage-replan" && p.mode === "mix") { replan(w, value === "one" ? index : undefined); return true; }
    else if (action === "stage-produce" && shot) { produceShot(w, shot, index); return true; }
    else if (action === "stage-create-mg" && shot && (shot.content.kind === "mg" || shot.content.mgRequest)) {
      if (!config.deepseekKeyPresent) { openApiKeys("deepseek"); return true; }
      const existing = mgPanels.get(shot);
      if (existing) { existing.querySelector("textarea, video")?.focus(); return true; }
      const host = $("#stage-mg-panel");
      if (!host) return true;
      const panel = document.createElement("section");
      panel.className = "stage-mg-production";
      mgPanels.set(shot, panel);
      host.append(panel);
      host.hidden = false;
      const content = shot.content;
      const description = content.mgRequest || (shot.line.trim()
        ? `根据这段口播制作无字动画，按口播顺序展示动作：${shot.line.trim().slice(0,160)}` : "");
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.generateMG({
        description, workId: w.id, theme: w.templateTheme || "medical", panel,
        mediaSize: { w: slot.w, h: slot.h }, ratioLabel: slot.ratioLabel,
        onClose:() => {
          mgPanels.delete(shot);
          if (panel.parentElement) panel.parentElement.hidden = true;
          panel.replaceChildren();
          panel.remove();
        },
        onAdopt:item => {
          if (!w.stagePlan.shots.includes(shot) || shot.content !== content) return;
          selectKind(w,shot,"mg");
          Object.assign(shot.content,{assetId:item.id,assetName:item.name,decidedBy:"user"});
          delete shot.content.adjusted;
          delete shot.presentationStale;
          touch(w,true);
          if (current() === w) render(true);
        }});
      return true;
    }
    else if (action === "stage-kind" && shot) {
      const [rawKind, clipStyle] = String(value).split(":");
      if (!Object.hasOwn(kinds, rawKind)) return true;
      const same = shot.content.kind === rawKind && (rawKind !== "clip" || (shot.content.clipStyle || "demo") === (clipStyle || "demo"));
      if (same) return true;
      selectKind(w, shot, rawKind, clipStyle);
      if (shot.content.decidedBy !== "user") delete shot.content.reason;
      delete shot.content.adjusted;
      shot.content.decidedBy = "user";
      delete shot.presentationStale;
      touch(w,true);
    }
    else if (action === "stage-legacy-to-clip" && shot) {
      const seed = shot.content.mgRequest || shot.line.trim().slice(0, 160);
      const targetStyle = shot.content.kind === "mg" ? "mg" : "demo";
      selectKind(w, shot, "clip", targetStyle);
      if (!shot.content.clipPrompt && seed) shot.content.clipPrompt = seed;
      shot.content.decidedBy = "user";
      touch(w, true);
    }
    else if (action === "stage-use-clip-suggestion" && shot) {
      const sug = shot.content.clipSuggestion || shot.line.trim().slice(0, 160);
      selectKind(w, shot, "clip", value === "mg" ? "mg" : "demo");
      shot.content.clipPrompt = sug;
      shot.content.decidedBy = "user";
      touch(w, true);
    }
    else if (action === "stage-next-form" && shot && artKinds.has(shot.content.kind) && window.InfoForms) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      const curForm = shot.content.form || InfoForms.mapLegacyForm(shot.content, shot, slot);
      const nextForm = InfoForms.nextInRelation(curForm, slot);
      shot.content.form = nextForm;
      shot.content.variant = shot.content.variant || "solid";
      shot.content.formData = InfoForms.fromPoints(nextForm, shot);
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
    }
    else if (action === "stage-sync-form" && shot && shot.content.form && window.InfoForms) {
      shot.content.formData = InfoForms.fromPoints(shot.content.form, shot);
      shot.variants[shot.content.kind] = shot.content;
      touch(w, true);
    }
    else if (action === "stage-plan-stickers") {
      planStickers(w, value === "one" ? index : undefined);
      return true;
    }
    else if (action === "stage-sticker-remove" && shot) {
      shot.stickers?.splice(Number(value), 1);
      if (!shot.stickers?.length) delete shot.stickers;
      touch(w, true);
    }
    else if (action === "stage-sticker-anchor" && shot) {
      const [si, anchor] = String(value).split(":");
      const st = shot.stickers?.[Number(si)];
      if (st && anchor) { st.anchor = anchor; touch(w, true); }
    }
    else if (action === "stage-clip-prompt" && shot) { requestClipPrompt(w, shot, index); return true; }
    else if (action === "stage-clip-frame" && shot) { prepareClipFrame(w); return true; }
    else if (action === "stage-clip-generate" && shot) { prepareClipVideo(w); return true; }
    else if (action === "stage-add" && p.shots.length < 12) {
      const next = fromLegacy({name:`第 ${p.shots.length + 1} 幕`, line:"", seconds:5}, p.mode === "mix" ? defaultKind(w,"explain") : p.mode, p.shots.length);
      p.shots.push(next); selected.set(w,p.shots.length-1); touch(w,true);
    } else if (action === "stage-remove" && p.shots.length > 1) {
      p.shots.splice(index,1); selected.set(w,Math.min(index,p.shots.length-1)); touch(w,true);
    } else if (action === "stage-move") {
      const to = index+Number(value);
      if (to >= 0 && to < p.shots.length) {
        p.shots.splice(to,0,p.shots.splice(index,1)[0]); selected.set(w,to); touch(w,true);
      }
    } else if (action === "stage-choose" && shot) {
      const content = shot.content;
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      const hints = {
        topic: w.topic,
        style: w.templateTheme || "medical",
        ratio: value === "art-image" ? slot.art.ratioLabel : slot.ratioLabel,
        ...(value === "sticker" ? { query: "贴纸" } : {}),
      };
      const pickKinds = value === "sfx" ? ["sfx"]
        : value === "clip-video" ? ["video"]
        : ["image", "art-image", "sticker", "clip-frame"].includes(value) ? ["image"]
        : value === "mg" ? ["lottie","mg"] : ["image", "svg"];
      StudioAssets.pick(pickKinds, item => {
        if (value === "image") { content.image = item.url; delete content.imageMediaSize; }
        else if (value === "art-image") { content.art = item.url; content.artName = item.name; delete content.artMediaSize; }
        else if (value === "clip-frame") { content.clipFirstFrame = item.url; }
        else if (value === "clip-video") { content.clip = item.url; content.clipPoster = item.thumbnailUrl || ""; delete content.clipCost; }
        else if (value === "sticker") {
          stickerTagsCache.set(item.id, item.tags || []);
          shot.stickers = Array.isArray(shot.stickers) ? shot.stickers.slice(0, 1) : [];
          shot.stickers.push({ assetId: item.id, tags: item.tags || [], cue: 0, keyword: "", anchor: "media-tr", size: "m", enter: "pop", hold: "stay", sfx: "auto" });
        }
        else if (value === "asset" || value === "mg") {
          content.assetId=item.id;
          content.assetName=item.name;
          delete content.adjusted;
        }
        else if (value === "sfx") { shot.sfxId=item.id; shot.sfxName=item.name; }
        else { content.libraryArtId=item.id; content.libraryArtName=item.name; }
        const vKey = content.kind === "clip" ? `clip:${content.clipStyle || "demo"}` : content.kind;
        shot.variants[vKey] = content;
        touch(w,true); render(true);
      }, hints);
      return true;
    } else if (action === "stage-clear" && shot) {
      if (value === "sfx") { delete shot.sfxId; delete shot.sfxName; }
      for (const key of ({image:["image","imageMediaSize"],asset:["assetId","assetName"],mg:["assetId","assetName"],art:["libraryArtId","libraryArtName"],"art-image":["art","artName","artMediaSize"],clip:["clip","clipPoster","clipDuration","clipCost"]}[value] || [])) delete shot.content[key];
      touch(w,true);
    } else if (action === "stage-collect" && value === "clip" && shot?.content.clip) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collectVideo(shot.content.clip, { name: shot.name, topic: w.topic, ratio: slot.ratioLabel, style: shot.content.clipStyle || "demo", model: shot.content.clipModel || "", prompt: shot.content.clipPrompt || "" });
      return true;
    } else if (action === "stage-collect" && value === "art" && shot?.content.art) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collect(shot.content.art,{name:shot.name,topic:w.topic,ratio:slot.art.ratioLabel,style:w.templateTheme || "medical",prompt:shot.content.artPrompt || ""});
      return true;
    } else if (action === "stage-collect" && shot?.content.image) {
      const slot = LayoutEngine.describeMediaSlot(currentLayoutDef(w));
      StudioAssets.collect(shot.content.image,{name:shot.name,topic:w.topic,ratio:slot.ratioLabel,style:w.templateTheme || "medical",prompt:shot.content.imagePrompt || ""});
      return true;
    } else if (action === "stage-beat-add" && shot?.content.beats?.length < 3) {
      shot.content.beats.push({action:"log",label:"核对记录",line:shot.line.slice(-55) || "核对记录"}); touch(w,true);
    } else if (action === "stage-beat-remove" && shot?.content.beats?.length > 1) {
      shot.content.beats.splice(Number(value),1); touch(w,true);
    } else if (action === "stage-images") { prepareImages(w,value); return true; }
    else if (action === "stage-art") { prepareArt(w,value); return true; }
    else if (action === "stage-audition") { $("#stage-preview")?.audition?.(); return true; }
    else if (action === "stage-speech") { prepareSpeech(w,index); return true; }
    else if (action === "stage-compose") { compose(w); return true; }
    render(true);
    return true;
  }

  return {applies,isActive,normalizeWork,initWork,setupControls,themeName,samplePlan,requestDraft,installDraft,installImages,installClip,installSpeech,editor,hasProductionJob,updateProductionJob,handleInput,handleAction};
})();
