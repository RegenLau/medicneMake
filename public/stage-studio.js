"use strict";

/* Shared work data and editor for the infographic video modes. */
const StageStudio = (() => {
  const CLASSIC = "builtin:layout/info-classic";
  const kinds = {image: "AI 完整图", card: "信息图动效", scene: "代码动效场景", svg: "SVG 演示动画", asset: "素材库素材"};
  const layoutLoads = new Map();
  const selected = new WeakMap();
  const inspector = new WeakMap();
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
    shot.variants[shot.content.kind] = shot.content;
    shot.content = shot.variants[kind] || initialContent(kind, shot);
    shot.content.kind = kind;
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

  const activeLayouts = () => (config.stageLayouts || []).filter(item => item.aspect === "16:9");
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

  function samplePlan(layout, theme, kind, stage = "explain") {
    const title = "先核对说明书";
    const line = "读清楚手边这份资料，再记下需要核对的地方。";
    const points = [{title:"找到对应栏目", detail:"对照手里的外包装"}, {title:"记下疑问", detail:"带上说明书问药师"}];
    const slide = {name:title, headline:title, line, type:"steps", layoutMode:stage, chapterIndex:0,
      question:"说明书先看哪里？", answer:"先找到对应栏目", takeaway:"记下需要核对的地方",
      points:points.map(({title,detail}) => ({title,desc:detail})), steps:points.map(({title,detail}) => ({title,desc:detail}))};
    const shot = {...slide, kind, items:points, start:0, end:4, captions:[{start:0,end:4,text:line,focus:stage === "outro" ? "outro" : "all"}]};
    if (kind === "image") slide.contentImage = "/assets/template-info-tablet.jpg";
    if (kind === "scene") Object.assign(shot,{visual:"steps",motion:"flow",motif:"checklist",tone:"primary"});
    if (kind === "svg") {
      shot.beats = [{action:"leaflet",line,label:"看说明书"}];
      Object.assign(slide,{action:"leaflet",svgBeats:shot.beats});
    }
    if (kind === "asset") Object.assign(shot,{assetUrl:StudioAssets.url("builtin:svg/reading-list"),move:"zoom"});
    return {layout, previewStage:stage, deck:{title:"看懂用药信息",shortTitle:"用药信息",theme,presenter:"digital",
      pharmacist:{...TemplateStudio.ensurePharmacist(data)},chapters:["先核对","再记录"],slides:[slide]}, shots:[shot]};
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
    return layoutControls(w) + modeControls(w);
  }

  function submitDraft(w, replan) {
    const mode = w.stagePlan.mode;
    const job = createJob(w, "write-draft", [], {...w.settings, ratio:"16:9", duration:videoReferenceSeconds(w), textModel:resolveTextModel(w.settings)});
    job.stageDraft = replan ? "replan" : "stage";
    job.payload.draft = {type:"video", videoMode:"stage", presentation:mode, layoutId:w.stagePlan.layout.id,
      imageBudget:imageBudget(w), topic:w.topic.trim(), drug:w.drug, ...replan};
    w.job = job;
    return sendJob(w);
  }

  function requestDraft(w) {
    const mode = w.stagePlan.mode;
    const count = ["mix","svg"].includes(mode) ? 2 : 1;
    const detail = mode === "mix" ? "先写脚本，再为每幕编排呈现方式。" :
      mode === "svg" ? "先写脚本，再为每幕选择 SVG 道具动作。" : "生成口播、要点和字幕节拍。";
    const image = mode === "mix" ? `AI 出图上限 ${imageBudget(w)} 张，${imageEstimate(w,imageBudget(w))}。配图另行确认。` : "";
    return authorize(w, count, "draft", () => submitDraft(w), count, {detail, image});
  }

  function replan(w, targetIndex) {
    if (w.job || !w.stagePlan.shots.length) return;
    if (!config.deepseekKeyPresent) return openApiKeys("deepseek");
    if (w.stagePlan.shots.some(shot => !shot.name.trim() || !shot.line.trim())) return notify("请填写每幕标题和口播。", "warn");
    const p = w.stagePlan;
    let overwrite = false;
    retryPayload = () => submitDraft(w, {
      targetIndex,
      // The checkbox updates before the dialog closes so its value is available in the callback.
      overwriteUser: overwrite,
      script: {title:w.title, shortTitle:p.shortTitle, chapters:p.chapters, shots:p.shots.map(shot => ({
        name:shot.name, line:shot.line, seconds:shot.seconds, chapterIndex:shot.chapterIndex,
        points:shot.points, cues:shot.cues, content:{kind:shot.content.kind, decidedBy:shot.content.decidedBy},
      }))},
    });
    openModal(targetIndex === undefined ? "重新编排全片" : "本幕重新判断",
      "<p>使用 DeepSeek 提交 1 次编排请求，按 Token 计费。保留已写好的脚本和各方式的素材。</p>" +
      (targetIndex === undefined ? '<label class="stage-overwrite"><input type="checkbox" id="stage-overwrite-user"> 同时重排我改过的幕</label>' : '') +
      '<div class="actions dialog-actions">' + btn("取消","close","secondary") +
      btn("确认提交并计费","confirm-paid","primary") + '</div>', "confirm");
    $("#stage-overwrite-user")?.addEventListener("change", event => { overwrite = event.currentTarget.checked; });
  }

  function usePlan(shot, content) {
    const saved = shot.variants[content.kind] || {};
    const media = Object.fromEntries(["image","outroImage","focusRegions","libraryArtId","libraryArtName"]
      .filter(field => saved[field] !== undefined).map(field => [field,saved[field]]));
    shot.variants[shot.content.kind] = shot.content;
    const transition = content.transition ?? shot.content.transition;
    shot.content = {...content, ...media, ...(transition ? {transition} : {})};
    shot.variants[content.kind] = shot.content;
    delete shot.presentationStale;
  }

  function installDraft(w, mode, output) {
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

  function deck(w) {
    const p = w.stagePlan;
    return {title:w.title, shortTitle:p.shortTitle, chapters:p.chapters, disclaimer:p.disclaimer,
      theme:w.templateTheme || "medical", presenter:w.templatePresenter || "digital", pharmacist:{...TemplateStudio.ensurePharmacist(data)},
      slides:p.shots.map(shot => {
        const {points, content} = shot;
        const items = points.items.map(({title, detail}) => ({title, desc:detail}));
        return {...points, name:shot.name, line:shot.line, seconds:shot.seconds, chapterIndex:shot.chapterIndex,
          points:points.points || items, steps:points.steps || items, warnings:points.warnings || items, checks:points.checks || items,
          contentImage: content.kind === "image" ? content.image : "", outroImage:content.kind === "image" ? content.outroImage : "",
          focusRegions:content.focusRegions, motionStyle:content.motionStyle,
          ...(content.kind === "svg" ? {action:content.beats[0]?.action, svgBeats:content.beats, layoutMode:"explain"} : {}),
          ...(["card", "scene", "asset"].includes(content.kind) ? {layoutMode:"explain"} : {})};
      })};
  }

  function previewPlan(w, layout) {
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
        ...(content.assetId ? {assetUrl:StudioAssets.url(content.assetId)} : {})};
      start = end;
      return spec;
    });
    return {layout, deck:deck(w), shots, compatibility:w.stagePlan.compatibility, fontId:w.settings.fontId};
  }

  function select(name, field, values, current) {
    return `<label class="field">${name}<select data-stage-field="${field}">${opts(values, current)}</select></label>`;
  }

  function text(name, field, value, max = 60) {
    return `<label class="field">${name}<input data-stage-field="${field}" value="${esc(value || "")}" maxlength="${max}"></label>`;
  }

  function contentFields(shot) {
    const c = shot.content;
    const pair = list => list.map(({id,name}) => [id,name]);
    if (c.kind === "image") return '<div class="asset-inline">' +
      btn(c.image ? "从素材库换图" : "从素材库选图", "stage-choose", "outline", "image") +
      btn(c.image ? "重新生成本幕图" : "生成本幕配图", "stage-images", "outline", "one") +
      (c.image?.startsWith("/media/") ? btn("收入素材库", "stage-collect", "textbtn") : "") +
      (c.image ? btn("移除配图", "stage-clear", "textbtn", "image") : '<span class="small">待生成配图</span>') + '</div>' +
      text("配图描述", "imagePrompt", c.imagePrompt, 400);
    if (c.kind === "asset") return '<div class="asset-inline">' + btn(esc(c.assetName || "选择图片或 SVG"), "stage-choose", "outline", "asset") +
      (c.assetId ? btn("移除素材", "stage-clear", "textbtn", "asset") : "") + '</div>' +
      select("素材运动", "move", [["still", "静止"], ["zoom", "缓慢推近"], ["pan", "平移"]], c.move);
    if (c.kind === "card") return select("动效方式", "motionStyle", window.CODE_MOTION_MOTION_CHOICES, c.motionStyle);
    if (c.kind === "scene") return '<div class="tpl-two-col">' + select("分镜版式", "visual", pair(CODE_MOTION_VISUALS), c.visual) +
      select("动效方式", "motion", pair(CODE_MOTION_MOTIONS), c.motion) + select("主题图形", "motif", pair(CODE_MOTION_MOTIFS), c.motif) +
      select("强调色调", "tone", pair(CODE_MOTION_TONES), c.tone) + '</div><div class="asset-inline">' +
      btn(esc(c.libraryArtName || "选配图或 SVG"), "stage-choose", "outline", "art") +
      (c.libraryArtId ? btn("恢复内置图形", "stage-clear", "textbtn", "art") : "") + '</div>';
    return c.beats.map((beat, index) => `<fieldset class="svg-beat-fields"><legend>动作 ${index + 1}</legend>` +
      select("道具动作", "beat-action:" + index, Object.entries(config.svgMotion.actions), beat.action) +
      text("画面标签", "beat-label:" + index, beat.label, 10) + text("对应口播片段", "beat-line:" + index, beat.line, 55) +
      (c.beats.length > 1 ? btn("移除动作", "stage-beat-remove", "textbtn", index) : "") + '</fieldset>').join("") +
      (c.beats.length < 3 ? btn("添加动作", "stage-beat-add", "outline") : "");
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
    const index = Math.min(selected.get(w) || 0, shots.length - 1);
    const shot = shots[index];
    if (!shot) return setup(w);
    selected.set(w, index);
    const tabs = inspector.get(w) || "scene";
    const support = activeLayouts().find(item => item.id === w.stagePlan.layout.id)?.supports;
    const kindButtons = Object.entries(kinds).map(([kind,name]) => btn(name, "stage-kind", "chip" + (shot.content.kind === kind ? " selected" : ""),
      kind, `aria-pressed="${shot.content.kind === kind}" ${!support || support.includes(kind) ? "" : "disabled"}`)).join("");
    const isMix = w.stagePlan.mode === "mix";
    const settings = [layoutControls(w), modeControls(w), text("作品标题", "work-title", w.title, 40),
      text("标题短句", "work-shortTitle", w.stagePlan.shortTitle, 20),
      ...w.stagePlan.chapters.map((name,i) => text(`章节 ${i+1}`, "work-chapter:"+i, name, 10)),
      text("底部参考声明", "work-disclaimer", w.stagePlan.disclaimer, 60),
      TemplateStudio.templateSetupHtml(w,data,esc,btn), renderMusicStudioCard(w, {showModeChips:true}), soundControls(w),
      select("全片字体", "font", [["", "默认"], ["builtin:font/noto-sans-sc", "Noto Sans SC"]], w.settings.fontId)].join("");
    const items = shot.points.items.map(item => [item.title,item.detail,item.tag].filter(Boolean).join("｜")).join("\n");
    const decision = isMix ? '<div class="stage-decision">' +
      (shot.content.reason ? `<p>${esc(shot.content.reason)}</p>` : "") +
      (shot.content.adjusted ? `<p class="small stage-adjusted">${esc(shot.content.adjusted)}</p>` : "") +
      '<p class="small" id="stage-stale"' + (shot.presentationStale ? "" : " hidden") + '>内容已改，可重新判断呈现方式</p>' +
      btn("本幕重新判断", "stage-replan", "outline", "one") + '</div>' : "";
    const scene = '<span class="label">本幕制作方式</span><div class="chips">' + kindButtons + '</div>' + decision +
      text("本幕标题", "name", shot.name) + `<label class="field">本幕口播<textarea data-stage-field="line" maxlength="450" rows="3">${esc(shot.line)}</textarea></label>` +
      '<div class="tpl-two-col">' + text("预览时长（秒）", "seconds", shot.seconds, 4) +
      select("所属章节", "chapterIndex", w.stagePlan.chapters.map((name,index) => [String(index),name]), String(shot.chapterIndex)) + '</div>' +
      select("要点结构", "point-type", Object.keys(pointVisual()).map(type => [type, TemplateVideo.SLIDE_TYPES[type]?.name || codeMotionVisualSpec(pointVisual()[type]).name]), shot.points.type) +
      text("屏显要点标题", "point-headline", shot.points.headline) + text("画面结语", "point-takeaway", shot.points.takeaway) +
      `<label class="field">要点（每行一条，可用「｜」分隔说明和标签）<textarea data-stage-field="point-items" rows="3">${esc(items)}</textarea></label>` +
      `<details class="shot-options"><summary>字幕节拍（${shot.cues.length}）</summary>${shot.cues.map((cue,i) =>
        '<div class="tpl-two-col">' + text("字幕", "cue-text:"+i, cue.text, 240) +
        select("聚焦", "cue-focus:"+i, [["all","全幕"],["0","第一项"],["1","第二项"],["2","第三项"],["3","第四项"],["top","上方"],["bottom","下方"],["question","问题"],["answer","答复"],["action","行动"],["outro","片尾"]], cue.focus || "all") + '</div>').join("")}</details>` +
      contentFields(shot) + '<div class="asset-inline">' + btn("本幕前移", "stage-move", "outline", "-1", index === 0 ? "disabled" : "") +
      btn("本幕后移", "stage-move", "outline", 1, index === shots.length - 1 ? "disabled" : "") +
      btn("删除本幕", "stage-remove", "textbtn danger", "", shots.length === 1 ? "disabled" : "") + '</div><div class="asset-inline">' +
      btn(esc(shot.sfxName || "选出场音效"),"stage-choose","outline","sfx") +
      (shot.sfxId ? btn("移除出场音效","stage-clear","textbtn","sfx") : "") + '</div>';
    const actions = (isMix ? btn("重新编排全片","stage-replan","outline","all") : "") +
      btn("全片模型与配音", "work-settings", "outline") +
      (shots.some(shot => shot.content.kind === "image" && !shot.content.image) ? btn("生成缺失配图", "stage-images", "outline", "missing") : "") +
      btn("合成视频", "stage-compose", "primary");
    const strip = shots.map((s,i) => `<button type="button" class="scene-choice" data-action="stage-select" data-val="${i}" aria-pressed="${i === index}"${isMix && s.content.reason ? ` title="${esc(s.content.reason)}"` : ""}>
      <span class="scene-choice-title">${i + 1} ${esc(s.name)}</span><span class="scene-choice-meta"><span class="stage-kind-badge">${kinds[s.content.kind]}</span>${s.seconds} 秒${isMix && s.content.adjusted ? ' · 已调整' : ''}</span></button>`).join("");
    shell(w, "编辑视频分镜", 1, `<div class="vstudio"><div class="sheet vstudio-bar"><div class="vstudio-summary">
      <span class="vstudio-metric">共 ${shots.length} 幕 · ${Math.round(shots.reduce((n,s)=>n+s.seconds,0))} 秒</span></div><div class="vstudio-actions">${actions}</div></div>
      <div class="vstudio-grid"><section class="sheet vstudio-stage-card"><div class="vstudio-stage-head"><strong>${esc(shot.name)}</strong>
      <span id="stage-preview-state" role="status">载入预览…</span></div><iframe id="stage-preview" src="/stage.html" title="分镜预览"></iframe>
      <div class="asset-inline"><button type="button" class="outline" id="stage-play" disabled>播放本幕</button>
      ${shot.content.kind === "svg" && w.settings.voice !== "无配音" ? btn("试听本幕口播","stage-speech","outline") : ""}
      ${soundSettings(w).pack !== "off" || shot.sfxId ? btn("试听音效","stage-audition","outline") : ""}
      <input type="range" aria-label="本幕播放进度" min="0" max="${shot.seconds}" step="0.01" value="${Math.min(1,shot.seconds/2)}" id="stage-seek"></div>
      <div class="stage-rail">${strip}${btn("添加一幕", "stage-add", "outline", "", shots.length >= 12 ? "disabled" : "")}</div></section>
      <aside class="sheet"><div class="vstudio-tabs" role="tablist" aria-label="分镜设置">${["scene","global"].map(id =>
        btn(id === "scene" ? "本幕内容" : "全片设置", "stage-inspector", "vstudio-tab", id, `role="tab" aria-selected="${id===tabs}"`)).join("")}</div>
      <div class="stage-fields" role="tabpanel">${tabs === "scene" ? scene : settings}</div></aside></div></div>`);
    bindPreview(w, index);
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
      const layout = await getLayout(w.stagePlan.layout.id);
      if (!iframe.isConnected) return;
      player = iframe.contentWindow;
      plan = previewPlan(w, layout);
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

  function prepareImages(w, mode) {
    const p = w.stagePlan;
    const indices = mode === "one" ? [selected.get(w) || 0] : p.shots.flatMap((shot,i) => shot.content.kind === "image" && !shot.content.image ? [i] : []);
    if (!indices.length || w.job || indices.some(i => p.shots[i].content.kind !== "image")) return;
    if (p.mode === "mix" && countImages(w) > imageBudget(w)) return notify("请先调整 AI 出图上限。", "warn");
    return authorize(w, indices.length, "images", () => {
      const data = deck(w);
      const items = indices.map((index,i) => ({prompt:TemplateVideo.buildCardImagePrompt(data,index,p.shots[index].content.imagePrompt,w.drug), variant:i + 1}));
      const job = createJob(w, "stage-images", items, {...w.settings, ratio:"16:9"});
      delete job.payload.storyboard;
      Object.assign(job.payload, {template:true, styleReference:false});
      job.stageImageSlots = indices;
      w.job = job;
      return sendJob(w);
    });
  }

  function installImages(w, indices, output) {
    indices.forEach((index,i) => {
      const shot = w.stagePlan.shots[index];
      if (shot?.content.kind === "image" && output.images[i]) {
        shot.content.image = output.images[i];
        shot.variants.image = shot.content;
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
    if (p.shots.some(shot => !shot.name.trim() || !shot.line.trim())) return notify("请填写每幕标题和口播", "warn");
    if (p.shots.some(shot => shot.content.kind === "image" && !shot.content.image)) return notify("请补齐 AI 完整图，或切换本幕方式。", "warn");
    if (p.shots.some(shot => shot.content.kind === "asset" && !shot.content.assetId)) return notify("请选择每一幕的素材。", "warn");
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
        disclaimer:p.disclaimer,chapters:p.chapters,appearance:{theme:appearance.theme,presenter:appearance.presenter,pharmacist:appearance.pharmacist},
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
    if (action === "stage-layout") {
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
    else if (action === "stage-kind" && shot && Object.hasOwn(kinds,value) && shot.content.kind !== value) {
      if (p.mode === "mix" && value === "image" && countImages(w) >= imageBudget(w)) {
        notify("已达 AI 出图上限，可在全片设置中调整。","warn");
        return true;
      }
      selectKind(w, shot, value);
      delete shot.content.reason;
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
      StudioAssets.pick(value === "sfx" ? ["sfx"] : value === "image" ? ["image"] : ["image", "svg"], item => {
        if (value === "image") content.image = item.url;
        else if (value === "asset") { content.assetId=item.id; content.assetName=item.name; }
        else if (value === "sfx") { shot.sfxId=item.id; shot.sfxName=item.name; }
        else { content.libraryArtId=item.id; content.libraryArtName=item.name; }
        shot.variants[content.kind] = content;
        touch(w,true); render(true);
      });
      return true;
    } else if (action === "stage-clear" && shot) {
      if (value === "sfx") { delete shot.sfxId; delete shot.sfxName; }
      for (const key of ({image:["image"],asset:["assetId","assetName"],art:["libraryArtId","libraryArtName"]}[value] || [])) delete shot.content[key];
      touch(w,true);
    } else if (action === "stage-collect" && shot?.content.image) {
      StudioAssets.collect(shot.content.image,{name:shot.name,topic:w.topic,ratio:"16:9",style:w.templateTheme || "medical",prompt:shot.content.imagePrompt || ""});
      return true;
    } else if (action === "stage-beat-add" && shot?.content.beats?.length < 3) {
      shot.content.beats.push({action:"log",label:"核对记录",line:shot.line.slice(-55) || "核对记录"}); touch(w,true);
    } else if (action === "stage-beat-remove" && shot?.content.beats?.length > 1) {
      shot.content.beats.splice(Number(value),1); touch(w,true);
    } else if (action === "stage-images") { prepareImages(w,value); return true; }
    else if (action === "stage-audition") { $("#stage-preview")?.audition?.(); return true; }
    else if (action === "stage-speech") { prepareSpeech(w,index); return true; }
    else if (action === "stage-compose") { compose(w); return true; }
    render(true);
    return true;
  }

  return {applies,isActive,normalizeWork,initWork,setupControls,samplePlan,requestDraft,installDraft,installImages,installSpeech,editor,handleInput,handleAction};
})();
