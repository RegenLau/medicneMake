"use strict";

/* Shared work data and editor for the infographic video modes. */
const StageStudio = (() => {
  const CLASSIC = "builtin:layout/info-classic";
  const kinds = {image: "AI 完整图", card: "信息图动效", scene: "代码动效场景", svg: "SVG 演示动画", asset: "素材库素材", mg: "MG 动画"};
  const layoutLoads = new Map();
  const themeLoads = new Map();
  const selected = new WeakMap();
  const inspector = new WeakMap();
  const mgPanels = new WeakMap();
  const pointVisual = () => config.stageCatalog.pointVisuals;
  const copy = value => structuredClone(value);
  const fixedKinds = Object.keys(kinds).filter(kind => kind !== "asset");
  const draftModes = [["mix","Mix 模式（推荐）"], ...fixedKinds.map(kind => [kind,kinds[kind]])];
  let soundContext;
  const decodedSounds = new Map();
  const soundSettings = w => w.stagePlan.audio?.sfx || {pack:"off", gainDb:-14};
  const soundPack = id => (config.sfxPacks || []).find(pack => pack.id === id);
  const imageBudget = w => w.stagePlan.imageBudget ?? 2;
  const countImages = w => w.stagePlan.shots.filter(shot => shot.content.kind === "image").length;
  const imageEstimate = (w,count) => {
    if (count === 0) return "本地渲染，无模型画面费用";
    const rate = config.imageRates?.[w.settings.imageModel]?.[w.settings.imageSize];
    return rate ? `最多 ¥${(count * Number(rate)).toFixed(2)}` : `最多 ${count} 张，按方舟实际用量结算`;
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

  function initialContent(kind, shot) {
    if (kind === "scene") {
      const visual = pointVisual()[shot.points.type];
      return { kind, visual, ...config.stageCatalog.sceneDefaults[visual] };
    }
    if (kind === "svg") return { kind, beats: [{action:config.stageCatalog.svgDefault, label:shot.name.slice(0, 10) || "用药要点", line:shot.line.slice(0, 55) || "请核对用药信息"}] };
    if (kind === "card") return { kind, motionStyle: "auto" };
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

  function normalizeWork(w) {
    if (!applies(w) || w.job || hasLegacyImageJobs(w) || w.stagePlan) return w.stagePlan;
    const kind = oldKind(w);
    const slides = TemplateStudio.isTemplateVideo(w) && w.blocks.length
      ? TemplateStudio.buildDeckForWork(w, data) : null;
    if (kind === "scene" && w.blocks.length) normalizeCodeMotionWork(w);
    const meta = slides || w.motionMeta || {};
    w.stagePlan = {
      layout: {id: CLASSIC}, mode: w.blocks.length ? kind : "mix", imageBudget: 2, audio: {}, shots: (slides?.slides || w.blocks).map((shot, i) => fromLegacy(shot, kind, i)),
      ...(w.blocks.length ? {compatibility: kind} : {}),
      shortTitle: meta.shortTitle || "", chapters: meta.chapters || ["先看要点", "用药提醒"],
      disclaimer: meta.disclaimer ?? TemplateVideo.DEFAULT_DISCLAIMER,
    };
    return w.stagePlan;
  }

  function initWork(w) {
    const plan = normalizeWork(w);
    const pack = soundPack("builtin:sfx-pack/soft");
    if (plan && pack) plan.audio.sfx = {pack:pack.id, gainDb:pack.gainDb};
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

  function selectKind(w, shot, kind) {
    const transition = shot.content.transition;
    const from = shot.content;
    shot.variants[shot.content.kind] = shot.content;
    shot.content = shot.variants[kind] || initialContent(kind, shot);
    shot.content.kind = kind;
    if (artKinds.has(kind) && artKinds.has(from.kind) && !shot.content.art && !shot.content.artPrompt) {
      for (const key of ["art", "artName", "artPrompt", "artMediaSize"]) if (from[key]) shot.content[key] = from[key];
    }
    if (transition !== undefined) shot.content.transition = transition;
    shot.variants[kind] = shot.content;
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
    ? ["card","scene","svg"].some(kind => layout.supports.includes(kind)) : layout.supports.includes(mode));

  function defaultKind(w, type) {
    const preferred = config.stageCatalog.pointDefaults[type];
    const layout = activeLayouts().find(item => item.id === w.stagePlan.layout.id);
    return allowsMode(layout,preferred) ? preferred : ["card","scene","svg"].find(kind => allowsMode(layout,kind));
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
    return '<div class="formrow"><span class="label">制作方式</span><div class="chips">' +
      draftModes.map(([kind,label]) => btn(label, "stage-mode", "chip" + (p.mode === kind ? " selected" : ""), kind,
        `aria-pressed="${p.mode === kind}" ${allowsMode(layout,kind) ? "" : "disabled"}`)).join("") + '</div></div>' +
      (p.mode === "mix" ? `<label class="field stage-budget">AI 出图上限
        <input type="number" data-stage-field="imageBudget" min="0" max="4" step="1" value="${imageBudget(w)}">
        <span class="small" id="stage-image-estimate" aria-live="polite">${imageEstimate(w,imageBudget(w))}</span></label>` : "");
  }

  function setupControls(w) {
    return layoutControls(w) + themeControls(w) + modeControls(w);
  }

  function submitDraft(w, draft = {}, stageDraft = "stage", shotIndex) {
    if (w.job) return;
    const job = createJob(w, "write-draft", [], {...w.settings, ratio:"16:9", duration:videoReferenceSeconds(w), textModel:resolveTextModel(w.settings)});
    job.stageDraft = stageDraft;
    if (shotIndex !== undefined) job.stageShotIndex = shotIndex;
    job.payload.draft = {type:"video", videoMode:"stage", presentation:w.stagePlan.mode, layoutId:w.stagePlan.layout.id,
      imageBudget:imageBudget(w), topic:w.topic.trim(), drug:w.drug, ...draft};
    w.job = job;
    return sendJob(w);
  }

  function requestDraft(w) {
    const mode = w.stagePlan.mode;
    const count = ["mix","svg","mg"].includes(mode) ? 2 : 1;
    const detail = mode === "mix" ? "先写脚本，再为每幕编排呈现方式。" :
      mode === "svg" ? "先写脚本，再为每幕选择 SVG 道具动作。" :
      mode === "mg" ? "先写脚本，再为每幕匹配 MG 素材或给出草稿建议。制作新素材时另行确认。" : "生成口播、要点和字幕节拍。";
    const image = mode === "mix" ? `AI 出图上限 ${imageBudget(w)} 张，${imageEstimate(w,imageBudget(w))}。配图另行确认。` : "";
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
    if (kind === "image") return;
    const options = config.stageCatalog.presenters[kind].options;
    const previousParams = Object.fromEntries(Object.keys(options).filter(key => shot.content[key] !== undefined)
      .map(key => [key, shot.content[key]]));
    const title = productionTitle(shot.content);
    retryPayload = () => submitDraft(w, {
      presentation:kind, produceShot:{shot:shotScript(shot), previousParams, revision:$("#stage-production-revision").value.trim()},
    }, "produce", index);
    openModal(title, `<p>用 DeepSeek 按第 ${index + 1} 幕的口播和要点，用「${kinds[kind]}」设计新画面。保留口播、要点和其他幕。</p>
      <label class="field">画面要求（选填）<textarea id="stage-production-revision" maxlength="200" rows="3" placeholder="想先展示哪个要点，或想演示哪个动作？"></textarea></label>
      <p class="small">提交 1 次文本请求，按 Token 计费。</p>
      <div class="actions dialog-actions">${btn("取消","close","secondary")}${btn("确认提交并计费","confirm-paid","primary")}</div>`, "confirm");
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
    if (mode === "produce") {
      const index = job.stageShotIndex;
      const shot = w.stagePlan.shots[index];
      const expected = job.payload.draft.produceShot.shot;
      if (shot?.content.kind === output.content.kind && shot.name === expected.name && shot.line === expected.line) {
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
          ...(["card", "scene", "asset", "mg"].includes(content.kind) ? {layoutMode:"explain"} : {})};
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
      const spec = {...content, kind:content.kind, name:shot.name, line:shot.line, items:shot.points.items,
        takeaway:shot.points.takeaway, listTitle:shot.points.listTitle, labels:shot.points.highlightWords, start, end, captions,
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

  function contentFields(shot, slot) {
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
    if (c.kind === "asset") return (c.assetId ? '<div class="asset-inline">' + btn("移除素材", "stage-clear", "textbtn", "asset") + '</div>' : "") +
      select("素材运动", "move", [["still", "静止"], ["zoom", "缓慢推近"], ["pan", "平移"]], c.move);
    if (c.kind === "mg") return (c.assetId ? '<div class="asset-inline">' + btn("移除动画","stage-clear","textbtn","mg") + '</div>' : "") +
      select("文字叠加", "overlay", [["points","标题和要点"],["title","只显示标题"],["off","关闭"]], c.overlay || "points") +
      select("时长适配", "fit", [["auto","自动适配"],["hold","原速并定格"]], c.fit || "auto");
    if (c.kind === "card") return select("动效方式", "motionStyle", window.CODE_MOTION_MOTION_CHOICES, c.motionStyle);
    if (c.kind === "scene") return '<div class="tpl-two-col">' + select("分镜版式", "visual", pair(CODE_MOTION_VISUALS), c.visual) +
      select("动效方式", "motion", pair(CODE_MOTION_MOTIONS), c.motion) + select("主题图形", "motif", pair(CODE_MOTION_MOTIFS), c.motif) +
      select("强调色调", "tone", pair(CODE_MOTION_TONES), c.tone) + '</div>' + (c.art ? "" : '<div class="asset-inline">' +
      btn(esc(c.libraryArtName || "选配图或 SVG"), "stage-choose", "outline", "art") +
      (c.libraryArtId ? btn("恢复内置图形", "stage-clear", "textbtn", "art") : "") + '</div>');
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
    return isActive(w) && Boolean(w.job?.stageImageSlots || w.job?.stageDraft === "produce");
  }

  function updateProductionJob(w) {
    const area = $("#stage-production-job");
    if (!area || !hasProductionJob(w)) return;
    const job = w.job;
    const picture = job.stageArt ? "插画" : "配图";
    const subject = job.stageShotIndex === undefined ? "缺失" + picture : `第 ${job.stageShotIndex + 1} 幕${job.stageImageSlots ? picture : "画面"}`;
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
    if (kind !== "image" && config.stageShotProduction) {
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
          ${settings.pack === "off" ? "disabled" : ""}>
        <output id="stage-sfx-gain">${settings.gainDb} dB</output></label></div>`;
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
    const kindButtons = Object.entries(kinds).map(([kind,name]) => btn(name, "stage-kind", "chip" + (shot.content.kind === kind ? " selected" : ""),
      kind, `aria-pressed="${shot.content.kind === kind}" ${!support || support.includes(kind) ? "" : "disabled"}`)).join("");
    const isMix = w.stagePlan.mode === "mix";
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
    const decision = isMix || shot.content.reason || shot.content.adjusted || shot.content.mgRequest ? '<div class="stage-decision">' +
      (shot.content.reason ? `<p>${esc(shot.content.reason)}</p>` : "") +
      (shot.content.adjusted ? `<p class="small stage-adjusted">${esc(shot.content.adjusted)}</p>` : "") +
      (shot.content.kind === "mg" && shot.content.mgRequest ? `<p class="small">MG 草稿建议：${esc(shot.content.mgRequest)}</p>` : "") +
      '<p class="small" id="stage-stale"' + (shot.presentationStale ? "" : " hidden") + '>口播或要点已更新，可重做画面。</p>' +
      (isMix ? btn("本幕重新判断", "stage-replan", "outline", "one") : "") +
      (isMix && shot.content.kind !== "mg" && shot.content.mgRequest && config.mgGeneration && (!support || support.includes("mg")) ? `<p class="small">${esc(shot.content.mgRequest)}</p>` +
        btn("可以用 AI 制作 MG 素材","stage-create-mg","outline") : "") + '</div>' : "";
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
      contentFields(shot, slotDesc) + '<div class="asset-inline">' + btn("本幕前移", "stage-move", "outline", "-1", index === 0 ? "disabled" : "") +
      btn("本幕后移", "stage-move", "outline", 1, index === shots.length - 1 ? "disabled" : "") +
      btn("删除本幕", "stage-remove", "textbtn danger", "", shots.length === 1 ? "disabled" : "") + '</div><div class="asset-inline">' +
      btn(esc(shot.sfxName || "选出场音效"),"stage-choose","outline","sfx") +
      (shot.sfxId ? btn("移除出场音效","stage-clear","textbtn","sfx") : "") + '</div>';
    const actions = (isMix ? btn("重新编排全片","stage-replan","outline","all") : "") +
      btn("全片模型与配音", "work-settings", "outline") +
      (shots.some(shot => shot.content.kind === "image" && !shot.content.image) ? btn("生成缺失配图", "stage-images", "outline", "missing") : "") +
      (missingArt(w).length ? btn("生成缺失插画", "stage-art", "outline", "missing") : "") +
      btn("合成视频", "stage-compose", "primary");
    const strip = shots.map((s,i) => `<button type="button" class="scene-choice" data-action="stage-select" data-val="${i}" aria-pressed="${i === index}"${isMix && s.content.reason ? ` title="${esc(s.content.reason)}"` : ""}>
      <span class="scene-choice-title">${i + 1} ${esc(s.name)}</span><span class="scene-choice-meta"><span class="stage-kind-badge">${kinds[s.content.kind]}</span>${s.seconds} 秒${isMix && s.content.adjusted ? ' · 已调整' : ''}</span></button>`).join("");
    shell(w, "编辑视频分镜", 1, `<div class="vstudio"><div class="sheet vstudio-bar"><div class="vstudio-summary">
      <span class="vstudio-metric">共 ${shots.length} 幕 · ${Math.round(shots.reduce((n,s)=>n+s.seconds,0))} 秒</span></div><fieldset class="vstudio-actions stage-edit-fields" data-stage-production-lock>${actions}</fieldset></div>
      <div class="vstudio-grid"><section class="sheet vstudio-stage-card"><div class="vstudio-stage-head"><strong>${esc(shot.name)}</strong>
      <span id="stage-preview-state" role="status">载入预览…</span></div><iframe id="stage-preview" src="/stage.html" title="分镜预览"></iframe>
      <div id="stage-production-job" hidden></div>
      <div class="asset-inline"><button type="button" class="outline" id="stage-play" disabled>播放本幕</button>
      ${shot.content.kind === "svg" && w.settings.voice !== "无配音" ? btn("试听本幕口播","stage-speech","outline") : ""}
      ${soundSettings(w).pack !== "off" || shot.sfxId ? btn("试听音效","stage-audition","outline") : ""}
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
      const sounds = player.collectStageEvents().filter(event => event.shot === index && events[event.type])
        .map(event => ({assetId:events[event.type], time:event.t - shot.start, gainDb:settings.gainDb}));
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
    if (key === "sfx-pack" || key === "sfx-gain") {
      const options = {...soundSettings(w)};
      if (key === "sfx-pack") {
        options.pack = value;
        if (value !== "off" && !soundPack(value)) return true;
      } else {
        options.gainDb = Number(value);
        $("#stage-sfx-gain").value = `${value} dB`;
      }
      (w.stagePlan.audio ||= {}).sfx = options;
      touch(w);
      if (key === "sfx-pack") render(true);
      return true;
    }
    if (key === "imageBudget") {
      if (value === "" || !el.validity.valid) return true;
      const budget = Number(value);
      const active = w.stagePlan.shots.filter(shot => shot.content.kind === "image");
      const manual = active.filter(shot => shot.content.decidedBy === "user");
      if (manual.length > budget) {
        el.value = imageBudget(w);
        notify(`请先切换部分手动保留的 AI 完整图幕（当前 ${manual.length} 幕）。`, "warn");
        return true;
      }
      w.stagePlan.imageBudget = budget;
      const adjusted = active.filter(shot => shot.content.decidedBy !== "user").slice(budget - manual.length);
      for (const shot of adjusted) {
        selectKind(w, shot, defaultKind(w, shot.points.type));
        shot.content.adjusted = "因 AI 出图上限调整为默认方式";
      }
      touch(w, adjusted.length > 0);
      if (adjusted.length) render(true);
      else $("#stage-image-estimate").textContent = imageEstimate(w,budget);
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
    if (p.mode === "mix" && countImages(w) > imageBudget(w)) return notify("请先调整 AI 出图上限。", "warn");
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

  function installImages(w, indices, output, job) {
    const art = Boolean(job?.stageArt);
    const targetSize = job?.payload?.settings?.targetSize;
    indices.forEach((index,i) => {
      const shot = w.stagePlan.shots[index];
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
      : ["asset","mg"].includes(content.kind) && !content.assetId);
    if (missing !== -1) {
      const {name, content:{kind}} = p.shots[missing];
      const label = `第 ${missing + 1} 幕「${name.trim()}」`;
      return showShotIssue(w, missing, `${label}缺少${kind === "image" ? "配图" : "素材"}，请补齐或切换制作方式。`,
        kind === "image" ? '[data-action="stage-images"][data-val="one"]' : `[data-action="stage-choose"][data-val="${kind}"]`);
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
    else if (action === "stage-kind" && shot && Object.hasOwn(kinds,value) && shot.content.kind !== value) {
      if (p.mode === "mix" && value === "image" && countImages(w) >= imageBudget(w)) {
        notify("已达 AI 出图上限，可在全片设置中调整。","warn");
        return true;
      }
      selectKind(w, shot, value);
      if (shot.content.decidedBy !== "user") delete shot.content.reason;
      delete shot.content.adjusted;
      shot.content.decidedBy = "user";
      delete shot.presentationStale;
      touch(w,true);
    }
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
      };
      StudioAssets.pick(value === "sfx" ? ["sfx"] : value === "image" || value === "art-image" ? ["image"] : value === "mg" ? ["lottie","mg"] : ["image", "svg"], item => {
        if (value === "image") { content.image = item.url; delete content.imageMediaSize; }
        else if (value === "art-image") { content.art = item.url; content.artName = item.name; delete content.artMediaSize; }
        else if (value === "asset" || value === "mg") {
          content.assetId=item.id;
          content.assetName=item.name;
          delete content.adjusted;
        }
        else if (value === "sfx") { shot.sfxId=item.id; shot.sfxName=item.name; }
        else { content.libraryArtId=item.id; content.libraryArtName=item.name; }
        shot.variants[content.kind] = content;
        touch(w,true); render(true);
      }, hints);
      return true;
    } else if (action === "stage-clear" && shot) {
      if (value === "sfx") { delete shot.sfxId; delete shot.sfxName; }
      for (const key of ({image:["image","imageMediaSize"],asset:["assetId","assetName"],mg:["assetId","assetName"],art:["libraryArtId","libraryArtName"],"art-image":["art","artName","artMediaSize"]}[value] || [])) delete shot.content[key];
      touch(w,true);
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

  return {applies,isActive,normalizeWork,initWork,setupControls,themeName,samplePlan,requestDraft,installDraft,installImages,installSpeech,editor,hasProductionJob,updateProductionJob,handleInput,handleAction};
})();
