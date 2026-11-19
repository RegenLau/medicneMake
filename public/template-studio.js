"use strict";

/* Workbench UI, per-card image generation & MP4 synthesis glue for the 16:9 infographic template video mode. */
(function (global) {
  const cueSelection = new WeakMap();
  const slideSelection = new WeakMap();
  const inspectorTabSelection = new WeakMap();
  const pollingJobs = new Set();
  const submittingJobs = new Set();
  let exportingWorkId = null;
  let imageModalState = null;
  let liveBoxObserver = null;
  let observedLiveBox = null;

  function isTemplateVideo(w) {
    return Boolean(w && w.type === "video" && w.videoMode === "template");
  }

  function ensurePharmacist(dataStore) {
    if (!dataStore.pharmacist || typeof dataStore.pharmacist !== "object") {
      dataStore.pharmacist = { ...TemplateVideo.DEFAULT_PHARMACIST };
    }
    return dataStore.pharmacist;
  }

  function getSlideIndex(w) {
    const slides = w.templateDeck?.slides || [];
    const idx = slideSelection.get(w) ?? 0;
    return Math.max(0, Math.min(Math.max(0, slides.length - 1), idx));
  }

  function setSlideIndex(w, idx) {
    const slides = w.templateDeck?.slides || [];
    const clamped = Math.max(0, Math.min(Math.max(0, slides.length - 1), Number(idx) || 0));
    slideSelection.set(w, clamped);
    cueSelection.set(w, 0);
  }

  function getCueIndex(w) {
    return cueSelection.get(w) ?? 0;
  }

  function getInspectorTab(w) {
    return inspectorTabSelection.get(w) || "slide";
  }

  function setInspectorTab(w, tabName) {
    inspectorTabSelection.set(w, tabName === "global" ? "global" : "slide");
  }

  function isDefaultHookCover(slide) {
    return Boolean(slide && slide.type === "cover" && slide.layoutMode === "hook" && !slide.contentImage);
  }

  function slideHasOutro(slide) {
    return Boolean(TemplateVideo.slideHasOutroBeat && TemplateVideo.slideHasOutroBeat(slide));
  }

  function slideImageState(slide) {
    if (slide.job?.error) return "配图失败";
    if (slide.job) return "生成中";
    if (slide.contentImage) {
      if (slide.imageSource === "ark") return "AI 配图";
      if (slide.imageSource === "upload" || slide.contentImage.startsWith("/media/")) return "自定义图";
      return "预设信息图";
    }
    if (isDefaultHookCover(slide)) return "开场模版卡";
    return "文字排版卡";
  }

  function outroImageState(slide) {
    if (slide.outroJob?.error) return "配图失败";
    if (slide.outroJob) return "生成中";
    if (slide.outroImage) {
      if (slide.outroImageSource === "ark") return "AI 配图";
      if (slide.outroImageSource === "upload" || slide.outroImage.startsWith("/media/")) return "自定义图";
      return "预设结尾图";
    }
    return "结尾模版卡";
  }

  function collectBatchImageTargets(deck, mode) {
    const out = [];
    (deck.slides || []).forEach((sl, si) => {
      const mainBusy = Boolean(sl.job && !sl.job.error);
      if (mode === "all") {
        if (!mainBusy) out.push({ index: si, slot: "main" });
      } else if (!sl.contentImage && !sl.job) {
        out.push({ index: si, slot: "main" });
      }
      if (slideHasOutro(sl)) {
        const outroBusy = Boolean(sl.outroJob && !sl.outroJob.error);
        if (mode === "all") {
          if (!outroBusy) out.push({ index: si, slot: "outro" });
        } else if (!sl.outroImage && !sl.outroJob) {
          out.push({ index: si, slot: "outro" });
        }
      }
    });
    return out;
  }

  function syncBlocksFromDeck(w) {
    if (!w.templateDeck) return;
    const slides = w.templateDeck.slides || [];
    w.title = w.templateDeck.title || w.title;
    w.blocks = slides.map((s, idx) => ({
      name: s.name || s.headline || `第 ${idx + 1} 页`,
      line: s.line || "",
      seconds: Math.max(4, Number(s.seconds) || recommendedShotSeconds(spokenChars(s.line || ""))),
      image: s.contentImage || w.blocks?.[idx]?.image || "",
      prompt: s.imagePrompt || s.headline || "",
    }));
  }

  function buildDeckForWork(w, dataStore) {
    const pharmacist = ensurePharmacist(dataStore);
    if (!w.templateDeck) {
      const sample = TemplateVideo.cloneExample(0);
      w.templateDeck = TemplateVideo.normalizeDeck({
        ...sample,
        theme: w.templateTheme || sample.theme,
        presenter: w.templatePresenter || sample.presenter,
        pharmacist: { ...pharmacist },
      });
    } else {
      const normalized = TemplateVideo.normalizeDeck({
        ...w.templateDeck,
        theme: w.templateTheme || w.templateDeck.theme || "medical",
        presenter: w.templatePresenter || w.templateDeck.presenter || "digital",
        pharmacist: { ...pharmacist, ...(w.templateDeck.pharmacist || {}) },
      }, w.title || w.topic);
      // Preserve slide object references & live job state when already normalized
      if (Array.isArray(w.templateDeck.slides) && w.templateDeck.slides.length === normalized.slides.length) {
        w.templateDeck.theme = normalized.theme;
        w.templateDeck.presenter = normalized.presenter;
        w.templateDeck.title = normalized.title;
        w.templateDeck.shortTitle = normalized.shortTitle;
        w.templateDeck.chapters = normalized.chapters;
        w.templateDeck.pharmacist = normalized.pharmacist;
        w.templateDeck.disclaimer = normalized.disclaimer;
        w.templateDeck.slides.forEach((slide, idx) => {
          const n = normalized.slides[idx];
          slide.type = n.type;
          slide.layoutMode = n.layoutMode;
          slide.name = n.name;
          slide.chapterIndex = n.chapterIndex;
          slide.headline = n.headline;
          slide.accentPhrase = n.accentPhrase;
          slide.contentImage = n.contentImage;
          slide.imagePrompt = n.imagePrompt;
          slide.highlightWords = n.highlightWords;
          slide.line = n.line;
          slide.beats = n.beats;
          slide.focusRegions = n.focusRegions;
          slide.question = n.question;
          slide.answer = n.answer;
          slide.outroNote = n.outroNote;
          slide.outroImage = n.outroImage;
          slide.outroImagePrompt = n.outroImagePrompt;
          slide.seconds = n.seconds;
        });
      } else {
        w.templateDeck = normalized;
      }
    }
    return w.templateDeck;
  }

  function installTemplateDeck(w, deckData, dataStore) {
    const pharmacist = ensurePharmacist(dataStore);
    w.videoMode = "template";
    w.templateTheme = deckData.theme || w.templateTheme || "medical";
    w.templatePresenter = deckData.presenter || w.templatePresenter || "digital";
    w.settings.ratio = "16:9";
    w.templateDeck = TemplateVideo.normalizeDeck({
      ...deckData,
      theme: w.templateTheme,
      presenter: w.templatePresenter,
      pharmacist: { ...pharmacist },
    }, w.topic);
    w.title = w.templateDeck.title;
    syncBlocksFromDeck(w);
    w.viewingSetup = false;
    w.editing = false;
    w.stage = "script";
    w.video = null;
    w.videoDirty = false;
    setSlideIndex(w, 0);
  }

  function templateSampleCardsHtml(escFn, icoFn) {
    return TemplateVideo.EXAMPLES.map((ex, idx) => {
      const previewDeck = TemplateVideo.normalizeDeck({
        ...ex,
        pharmacist: TemplateVideo.DEFAULT_PHARMACIST,
      });
      const slideIdx = Number.isInteger(ex.previewSlideIndex) ? ex.previewSlideIndex : 0;
      const frameHtml = TemplateVideo.renderFrameHtml(previewDeck, slideIdx);
      const badge = `${ex.category || "模板讲解"} · ${ex.theme === "warm" ? "暖色手绘" : "医疗白蓝"}`;
      const presLabel = ex.presenter === "cartoon" ? "卡通形象" : ex.presenter === "none" ? "名片卡" : "数字人";
      return (
        '<button type="button" class="sample template-sample" data-action="tpl-sample" data-val="' +
        idx +
        '"><div class="cover"><div class="tpl-mini-scaler">' +
        frameHtml +
        '</div><span class="tag tpl-tag">' +
        escFn(badge) +
        '</span><span class="play">' +
        icoFn("arrow") +
        "</span></div><h3>" +
        escFn(ex.topic) +
        '</h3><div class="meta">16:9 模板讲解 · ' +
        escFn(presLabel) +
        "</div></button>"
      );
    }).join("");
  }

  function modeSwitcherHtml(w) {
    const isTpl = isTemplateVideo(w);
    return (
      '<div class="formrow" style="margin-bottom:4px"><span class="label">视频形式</span></div>' +
      '<div class="mode-cards">' +
      '<button type="button" class="mode-card" data-action="tpl-video-mode" data-val="template" aria-pressed="' +
      isTpl +
      '"><strong>信息图模板讲解 <span class="mode-badge">推荐</span></strong><span>左药师栏（数字人/卡通/名片卡）+ 右严格 16:9 科普信息图 + 明黄高亮字幕，每张卡片图都可重新生成</span></button>' +
      '<button type="button" class="mode-card" data-action="tpl-video-mode" data-val="storyboard" aria-pressed="' +
      !isTpl +
      '"><strong>AI 分镜动画</strong><span>6 种全屏画风 + Seedance 图生视频，适合纯视觉分镜表达</span></button>' +
      "</div>"
    );
  }

  function templateSetupHtml(w, dataStore, escFn, btnFn) {
    const theme = w.templateTheme || "medical";
    const presenter = w.templatePresenter || "digital";
    const rawAvatarMode = w.settings?.avatarMode ?? dataStore.settings?.avatarMode ?? defaults.avatarMode;
    const avatarMode = typeof resolveAvatarMode === "function" ? resolveAvatarMode(rawAvatarMode) : (rawAvatarMode === "static" ? "static" : "videoretalk");
    const cfg = typeof config !== "undefined" ? config : global.config;
    const p = ensurePharmacist(dataStore);
    const avatarPreview = p.avatarImage || "/assets/template-doctor-digital.jpg";

    return (
      '<div class="formrow"><span class="label">模板视觉风格</span><div class="tpl-theme-grid">' +
      TemplateVideo.THEMES.map(
        (t) =>
          '<button type="button" class="tpl-theme-card" data-action="tpl-theme" data-val="' +
          t.id +
          '" aria-pressed="' +
          (theme === t.id) +
          '"><span class="tpl-theme-swatch ' +
          t.id +
          '"></span><span><strong>' +
          escFn(t.name) +
          "</strong><small>" +
          escFn(t.desc) +
          "</small></span></button>",
      ).join("") +
      "</div></div>" +
      '<div class="formrow"><span class="label">主讲人槽位（左侧恒定栏，不挤压右图）</span><div class="chips">' +
      TemplateVideo.PRESENTERS.map(
        (pr) =>
          '<button type="button" class="chip' +
          (presenter === pr.id ? " selected" : "") +
          '" data-action="tpl-presenter" data-val="' +
          pr.id +
          '" aria-pressed="' +
          (presenter === pr.id) +
          '">' +
          escFn(pr.name) +
          "</button>",
      ).join("") +
      "</div>" +
      (presenter !== "none"
        ? '<div class="chips" style="margin-top:8px">' +
          '<button type="button" class="chip' + (avatarMode === "videoretalk" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="videoretalk" aria-pressed="' + (avatarMode === "videoretalk") + '">声动人像（整片省钱）</button>' +
          '<button type="button" class="chip' + (avatarMode === "wan2.2-s2v" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="wan2.2-s2v" aria-pressed="' + (avatarMode === "wan2.2-s2v") + '">万相数字人（表情生动）</button>' +
          '<button type="button" class="chip' + (avatarMode === "static" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="static" aria-pressed="' + (avatarMode === "static") + '">静态肖像</button>' +
          (avatarMode !== "static" && cfg && !cfg.dashscopeKeyPresent
            ? btnFn("配置阿里云百炼 Key", "connect-dashscope", "textbtn")
            : "") +
          "</div>"
        : "") +
      "</div>" +
      '<div class="formrow"><span class="label">药师权威名片（显示在左侧主讲区）</span><div class="tpl-profile-grid">' +
      '<label class="field">姓名<input maxlength="16" data-pharm="name" value="' +
      escFn(p.name) +
      '" placeholder="例如：李明远"></label>' +
      '<label class="field">职称<input maxlength="16" data-pharm="role" value="' +
      escFn(p.role) +
      '" placeholder="例如：主任药师"></label>' +
      '<label class="field">医院 / 科室<input maxlength="24" data-pharm="hospital" value="' +
      escFn(p.hospital) +
      '" placeholder="例如：北京协和医院"></label>' +
      "</div>" +
      (presenter === "digital"
        ? '<div class="tpl-avatar-upload">' +
          '<img class="tpl-avatar-thumb" src="' + escFn(avatarPreview) + '" alt="" />' +
          '<label class="outline tpl-upload-btn">' +
          '上传医生照片替换肖像<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="avatar" hidden></label>' +
          (p.avatarImage ? btnFn("恢复默认肖像", "tpl-reset-avatar", "textbtn") : "") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderFallbackFieldsHtml(slide, idx, escFn) {
    const type = slide.type || "steps";
    let specific = "";

    if (type === "cover") {
      const pills = Array.isArray(slide.pills) ? slide.pills : ["", "", ""];
      specific =
        '<label class="field">开场核心问题（第 1 拍大字展示）<input maxlength="50" data-tpl-slide="' + idx + '" data-tpl-field="question" value="' + escFn(slide.question || slide.headline || "") + '"></label>' +
        '<label class="field">直接结论（第 2 拍直给答案）<input maxlength="90" data-tpl-slide="' + idx + '" data-tpl-field="answer" value="' + escFn(slide.answer || slide.lead || "") + '"></label>' +
        '<div class="tpl-profile-grid">' +
        [0, 1, 2].map((pi) =>
          '<label class="field">要点标签 ' + (pi + 1) + '<input maxlength="20" data-tpl-slide="' + idx + '" data-tpl-arr="pills" data-tpl-i="' + pi + '" value="' + escFn(pills[pi] || "") + '"></label>'
        ).join("") +
        "</div>" +
        '<label class="field">底部提示条<input maxlength="120" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    } else if (type === "compare") {
      const cols = Array.isArray(slide.columns) ? slide.columns : [];
      specific =
        '<div class="tpl-two-col">' +
        [0, 1].map((ci) => {
          const col = cols[ci] || { title: "", badge: "", points: ["", "", ""], footLabel: "", footValue: "" };
          const pts = (Array.isArray(col.points) ? col.points : []).join("\n");
          return (
            '<div class="tpl-subcard"><span class="tpl-subcard-title">对比栏 ' + (ci + 1) + "</span>" +
            '<div class="tpl-two-col">' +
            '<label class="field">栏标题<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="title" value="' + escFn(col.title || "") + '"></label>' +
            '<label class="field">角标<input maxlength="20" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="badge" value="' + escFn(col.badge || "") + '"></label>' +
            "</div>" +
            '<label class="field">要点列表（每行一条）<textarea rows="3" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="points">' + escFn(pts) + "</textarea></label>" +
            '<div class="tpl-two-col">' +
            '<label class="field">底栏标签<input maxlength="16" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="footLabel" value="' + escFn(col.footLabel || "") + '"></label>' +
            '<label class="field">底栏内容<input maxlength="36" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="footValue" value="' + escFn(col.footValue || "") + '"></label>' +
            "</div></div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部提示条<input maxlength="140" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    } else if (type === "steps") {
      const steps = Array.isArray(slide.steps) ? slide.steps : [];
      const checks = Array.isArray(slide.checks) ? slide.checks : [];
      specific =
        '<div class="tpl-profile-grid">' +
        [0, 1, 2].map((si) => {
          const st = steps[si] || { title: "", desc: "", key: "" };
          return (
            '<div class="tpl-subcard"><span class="tpl-subcard-title">第 ' + (si + 1) + " 步</span>" +
            '<label class="field">标题<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-step="' + si + '" data-tpl-sub="title" value="' + escFn(st.title || "") + '"></label>' +
            '<label class="field">说明<textarea rows="2" data-tpl-slide="' + idx + '" data-tpl-step="' + si + '" data-tpl-sub="desc">' + escFn(st.desc || "") + "</textarea></label>" +
            '<label class="field">重点提醒<input maxlength="40" data-tpl-slide="' + idx + '" data-tpl-step="' + si + '" data-tpl-sub="key" value="' + escFn(st.key || "") + '"></label>' +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部 4 项自查标签（顿号分隔）<input maxlength="80" data-tpl-slide="' + idx + '" data-tpl-joined="checks" value="' + escFn(checks.join("、")) + '"></label>';
    } else if (type === "warning") {
      const warns = Array.isArray(slide.warnings) ? slide.warnings : [];
      specific =
        '<div class="tpl-two-col">' +
        [0, 1, 2, 3].map((wi) => {
          const item = warns[wi] || { title: "", desc: "" };
          return (
            '<div class="tpl-subcard"><span class="tpl-subcard-title">警示信号 ' + (wi + 1) + "</span>" +
            '<label class="field">标题<input maxlength="28" data-tpl-slide="' + idx + '" data-tpl-warn="' + wi + '" data-tpl-sub="title" value="' + escFn(item.title || "") + '"></label>' +
            '<label class="field">说明<textarea rows="2" data-tpl-slide="' + idx + '" data-tpl-warn="' + wi + '" data-tpl-sub="desc">' + escFn(item.desc || "") + "</textarea></label>" +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部提示条<input maxlength="140" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    } else {
      const pts = Array.isArray(slide.points) ? slide.points : [];
      specific =
        '<div class="tpl-profile-grid">' +
        [0, 1, 2].map((pi) => {
          const item = pts[pi] || { title: "", desc: "" };
          return (
            '<div class="tpl-subcard"><span class="tpl-subcard-title">总结要点 ' + (pi + 1) + "</span>" +
            '<label class="field">标题<input maxlength="32" data-tpl-slide="' + idx + '" data-tpl-point="' + pi + '" data-tpl-sub="title" value="' + escFn(item.title || "") + '"></label>' +
            '<label class="field">补充说明<textarea rows="2" data-tpl-slide="' + idx + '" data-tpl-point="' + pi + '" data-tpl-sub="desc">' + escFn(item.desc || "") + "</textarea></label>" +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">结尾定格行动提醒（最后 1.5 秒展示）<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-field="outroNote" value="' + escFn(slide.outroNote || "") + '" placeholder="例如：每天固定时间按医嘱服药，有异常及时就医问药师"></label>' +
        '<label class="field">底部提示条<input maxlength="120" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    }

    return (
      '<div class="tpl-slide-form" style="margin-top:8px">' +
      '<div class="tpl-two-col">' +
      '<label class="field">卡片大标题<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-field="headline" value="' + escFn(slide.headline || "") + '"></label>' +
      '<label class="field">标题变色强调短语<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-field="accentPhrase" value="' + escFn(slide.accentPhrase || "") + '" placeholder="填大标题中的一部分"></label>' +
      "</div>" +
      specific +
      "</div>"
    );
  }

  function slideOriginLabel(slide) {
    if (!slide.contentImage) {
      if (isDefaultHookCover(slide)) return "开场模版卡 · 可 AI 生成 16:9 开场封面图";
      return "文字排版卡 · 可生成 16:9 科普信息图";
    }
    if (slide.imageSource === "ark") {
      const cfg = typeof config !== "undefined" ? config : global.config;
      const modelName = cfg?.imageModels?.[slide.imageModel]?.[0] || "火山方舟 AI 生成";
      return `${modelName}${slide.imageSize ? " · " + slide.imageSize : ""}`;
    }
    if (slide.imageSource === "upload" || slide.contentImage.startsWith("/media/")) {
      return "本地上传图 · 16:9 恒定槽位";
    }
    return "内置示例信息图 · 可 AI 重做或上传替换";
  }

  function outroOriginLabel(slide) {
    if (!slide.outroImage) return "结尾模版卡 · 可 AI 生成 16:9 结尾收口图";
    if (slide.outroImageSource === "ark") {
      const cfg = typeof config !== "undefined" ? config : global.config;
      const modelName = cfg?.imageModels?.[slide.outroImageModel]?.[0] || "火山方舟 AI 生成";
      return `${modelName}${slide.outroImageSize ? " · " + slide.outroImageSize : ""}`;
    }
    if (slide.outroImageSource === "upload" || slide.outroImage.startsWith("/media/")) {
      return "本地上传图 · 16:9 结尾槽位";
    }
    return "预设结尾图 · 可 AI 重做或上传替换";
  }

  function renderCueButtonsHtml(cues, cueIdx, escFn) {
    if (cues.length <= 1) return "";
    const esc = escFn || ((s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]));
    return (
      '<span class="vstudio-cue-label">字幕分句预览（' + (cueIdx + 1) + "/" + cues.length + '）</span>' +
      '<div class="vstudio-cue-pills">' +
      cues.map((cue, ci) => {
        const tag = cue.beatLabel ? ` · ${cue.beatLabel}` : "";
        return '<button type="button" class="vstudio-cue-btn' + (ci === cueIdx ? " selected" : "") + '" data-action="tpl-cue" data-val="' + ci + '">第 ' + (ci + 1) + " 句" + esc(tag) + "</button>";
      }).join("") +
      "</div>"
    );
  }

  function renderBeatsEditorHtml(slide, idx, escFn) {
    const beats = Array.isArray(slide.beats) ? slide.beats : [];
    const showBeats = isDefaultHookCover(slide) || beats.some((b) => b && b.focus === "outro");
    if (!beats.length || !showBeats) return "";
    return (
      '<details class="shot-options" style="margin-top:10px"><summary>分段口播微调（共 ' + beats.length + ' 段）</summary>' +
      '<div class="tpl-slide-form" style="margin-top:8px">' +
      beats.map((b, bi) =>
        '<div class="tpl-subcard">' +
        '<label class="field">第 ' + (bi + 1) + ' 段口播' + (b.label ? "（" + escFn(b.label) + "）" : "") +
        '<input maxlength="120" data-tpl-slide="' + idx + '" data-tpl-beat="' + bi + '" data-tpl-bsub="line" value="' + escFn(b.line || "") + '"></label>' +
        "</div>"
      ).join("") +
      "</div></details>"
    );
  }

  function templateEditorHtml(w, dataStore, escFn, btnFn, icoFn, savedLabelFn) {
    const deck = buildDeckForWork(w, dataStore);
    const idx = getSlideIndex(w);
    const slide = deck.slides[idx];
    const total = deck.slides.length;
    const cues = TemplateVideo.getSlideCues(slide, 22);
    const cueIdx = Math.min(getCueIndex(w), Math.max(0, cues.length - 1));
    const activeCue = cues[cueIdx] || { text: slide.line || "", focus: "all", beatIndex: 0, highlightWords: slide.highlightWords || [] };
    const busy = Boolean(slide.job && !slide.job.error);
    const outroBusy = Boolean(slide.outroJob && !slide.outroJob.error);
    const slideAnyBusy = busy || outroBusy;
    const stageBusy = activeCue.focus === "outro" ? outroBusy : busy;
    const anyBusy = deck.slides.some((s) => (s.job && !s.job.error) || (s.outroJob && !s.outroJob.error));
    const pace = speechStats(slide.line, slide.seconds);
    const slideSec = Math.max(4, Number(slide.seconds) || recommendedShotSeconds(spokenChars(slide.line || "")));
    const p = ensurePharmacist(dataStore);
    const avatarPreview = p.avatarImage || "/assets/template-doctor-digital.jpg";
    const activeTab = getInspectorTab(w);

    const s = w.settings;
    const music = s.music ?? defaults.music;
    const rawAvatarMode = s.avatarMode ?? dataStore.settings?.avatarMode ?? defaults.avatarMode;
    const avatarMode = typeof resolveAvatarMode === "function" ? resolveAvatarMode(rawAvatarMode) : (rawAvatarMode === "static" ? "static" : "videoretalk");
    const cfg = typeof config !== "undefined" ? config : global.config;
    const themeObj = TemplateVideo.THEMES.find((t) => t.id === deck.theme);
    const presObj = TemplateVideo.PRESENTERS.find((pr) => pr.id === deck.presenter);
    const themeName = themeObj ? themeObj.name : "医疗白蓝风";
    const presName = presObj ? presObj.name : "数字人";
    const outroSlides = deck.slides.filter((sl) => slideHasOutro(sl));
    const withImage = deck.slides.filter((sl) => Boolean(sl.contentImage)).length +
      outroSlides.filter((sl) => Boolean(sl.outroImage)).length;
    const targetTotal = deck.slides.length + outroSlides.length;
    const missingCount = collectBatchImageTargets(deck, "missing").length;
    const pendingImages = anyBusy;
    const failedImages = deck.slides.filter((sl) => sl.job?.error).length +
      outroSlides.filter((sl) => sl.outroJob?.error).length;
    const composeBusy = exportingWorkId === w.id || pendingImages;
    const imageSummary = `信息图 ${withImage}/${targetTotal}` +
      (pendingImages ? " · 生成中" : "") +
      (failedImages ? ` · ${failedImages} 张失败` : "");
    const statTone = failedImages ? "is-err" : pendingImages ? "is-busy" : missingCount === 0 ? "is-ok" : "";
    const avatarLabel = deck.presenter === "none"
      ? ""
      : (avatarMode === "static" || s.voice === "无配音"
        ? "静态肖像"
        : (avatarMode === "wan2.2-s2v" ? "万相数字人" : "声动人像对口型"));
    const metaItems = [
      "16:9",
      themeName,
      avatarLabel ? `${presName} · ${avatarLabel}` : presName,
      typeof voiceLabel === "function" ? voiceLabel(s.voice) : s.voice,
      typeof StudioMusic !== "undefined" ? StudioMusic.musicSummaryLabel(w) : (music === "off" ? musicLabels.off : `配乐：${musicLabels[music]}`),
      ...(w.drug ? ["药品：" + w.drug] : []),
    ];

    const topBarHtml =
      '<div class="sheet vstudio-bar">' +
      '<div class="vstudio-summary">' +
      '<div class="vstudio-metrics">' +
      '<span class="status-pill">信息图模板</span>' +
      '<span class="vstudio-metric" data-tpl-total-meta>共 ' + total + " 页 · 约 " + videoTotalSeconds(w) + " 秒</span>" +
      '<span class="vstudio-stat ' + statTone + '" id="tpl-image-progress" role="status">' + escFn(imageSummary) + "</span>" +
      "</div>" +
      '<div class="vstudio-meta-line">' +
      '<span>' + escFn(metaItems.join(" · ")) + "</span>" +
      '<span class="vstudio-meta-dot" aria-hidden="true">·</span>' +
      '<span class="save-state" id="save-state">' + savedLabelFn(w) + "</span>" +
      "</div></div>" +
      '<div class="vstudio-actions">' +
      btnFn(icoFn("settings") + " 模型与配音", "work-settings", "outline") +
      (missingCount > 0
        ? btnFn(`补齐缺图 (${missingCount})`, "tpl-fill-images", "secondary", "", pendingImages ? "disabled" : "")
        : "") +
      btnFn("重做全套图", "tpl-restyle-images", "outline", "", pendingImages ? "disabled" : "") +
      (w.video && !w.videoDirty ? btnFn("查看成片", "view-draft", "secondary") : "") +
      btnFn(
        exportingWorkId === w.id ? "正在渲染高清帧..." : pendingImages ? "等待配图完成..." : "合成模板视频 MP4",
        "tpl-compose",
        "primary",
        "",
        composeBusy ? "disabled" : "",
      ) +
      "</div></div>" +
      '<p class="tpl-export-status" id="tpl-export-status" role="status"></p>';

    const filmstripHtml =
      '<div class="vstudio-rail">' +
      '<div class="vstudio-rail-head">' +
      '<span class="vstudio-rail-label">页面分镜（' + total + ' 页 · 支持 ← → 切换）</span>' +
      btnFn(
        icoFn("plus") + " 添加一页",
        "tpl-slide-add",
        "textbtn",
        "",
        total >= 12 || anyBusy ? "disabled" : "",
      ) +
      "</div>" +
      '<nav class="scene-switcher vstudio-filmstrip" role="tablist" aria-label="逐页内容与口播切换">' +
      deck.slides.map((sl, si) => {
        const st = slideImageState(sl);
        const sec = Math.max(4, Number(sl.seconds) || recommendedShotSeconds(spokenChars(sl.line || "")));
        return (
          '<button type="button" class="scene-choice" data-action="tpl-slide" data-val="' +
          si +
          '" aria-pressed="' +
          (si === idx) +
          '">' +
          '<span class="scene-top"><span class="scene-name"><b>' +
          (si + 1) +
          '</b><span data-scene-name>' +
          escFn(sl.name || sl.headline || `第 ${si + 1} 页`) +
          '</span></span><span class="scene-sec" data-slide-sec="' + si + '">' + sec + 's</span></span>' +
          '<span class="scene-state" data-scene-state data-state="' +
          escFn(st) +
          '">' +
          escFn(st) +
          "</span></button>"
        );
      }).join("") +
      "</nav></div>";

    const slideErrorHtml =
      (slide.job?.error
        ? '<div class="banner err" role="alert" style="margin-top:12px">本页卡片配图生成未完成：' +
          escFn(slide.job.error) +
          '<div class="banner-actions">' +
          btnFn("重试生成", "tpl-retry-image", "secondary", idx) +
          btnFn("关闭提示", "tpl-abort-image", "textbtn", idx) +
          "</div></div>"
        : "") +
      (slide.outroJob?.error
        ? '<div class="banner err" role="alert" style="margin-top:12px">结尾定格卡配图生成未完成：' +
          escFn(slide.outroJob.error) +
          '<div class="banner-actions">' +
          btnFn("重试结尾图", "tpl-retry-outro-image", "secondary", idx) +
          btnFn("关闭提示", "tpl-abort-outro-image", "textbtn", idx) +
          "</div></div>"
        : "");

    const cueInner = renderCueButtonsHtml(cues, cueIdx, escFn);
    const cueStripHtml =
      '<div class="tpl-cue-strip" id="tpl-cue-strip"' + (cueInner ? "" : " hidden") + ">" +
      cueInner +
      "</div>";

    const stageHtml =
      '<div class="vstudio-stage"><div class="sheet vstudio-stage-card">' +
      '<div class="vstudio-stage-head">' +
      '<div class="vstudio-pager">' +
      btnFn(
        icoFn("prev"),
        "tpl-slide",
        "icon-btn",
        idx - 1,
        (idx === 0 ? "disabled " : "") + 'aria-label="上一页" title="上一页"',
      ) +
      '<span class="shot-badge">第 ' + (idx + 1) + " / " + total + " 页</span>" +
      btnFn(
        icoFn("next"),
        "tpl-slide",
        "icon-btn",
        idx + 1,
        (idx >= total - 1 ? "disabled " : "") + 'aria-label="下一页" title="下一页"',
      ) +
      '<span class="vstudio-stage-title" data-stage-title>' +
      escFn(slide.name || slide.headline || `第 ${idx + 1} 页`) +
      "</span>" +
      '<span class="time-range" data-stage-time>约 ' + slideSec + " 秒</span>" +
      "</div>" +
      '<div class="shot-tools">' +
      btnFn(
        icoFn("arrowLeft"),
        "tpl-slide-move",
        "icon-btn",
        idx + ":-1",
        (idx === 0 || slideAnyBusy ? "disabled " : "") + 'aria-label="本页前移" title="本页前移"',
      ) +
      btnFn(
        icoFn("arrowRight"),
        "tpl-slide-move",
        "icon-btn",
        idx + ":1",
        (idx >= total - 1 || slideAnyBusy ? "disabled " : "") + 'aria-label="本页后移" title="本页后移"',
      ) +
      btnFn(
        icoFn("trash"),
        "tpl-slide-remove",
        "icon-btn danger",
        idx,
        (total <= 2 || slideAnyBusy ? "disabled " : "") + 'aria-label="删除本页" title="删除本页"',
      ) +
      "</div></div>" +
      '<div class="tpl-preview-box" id="tpl-live-box" data-tpl-dropzone="' + idx + '"' + (activeCue.focus === "outro" ? ' data-tpl-drop-slot="outro"' : "") + '><div class="tpl-stage-scaler" id="tpl-live-scaler">' +
      TemplateVideo.renderFrameHtml(deck, idx, {
        subtitleText: activeCue.text,
        focus: activeCue.focus,
        beatIndex: activeCue.beatIndex,
        highlightWords: activeCue.highlightWords,
        cueIndex: cueIdx,
      }) +
      "</div>" +
      (stageBusy
        ? '<div class="tpl-media-busy" role="status"><span class="picture-busy"><span class="spinner" aria-hidden="true"></span>' + (activeCue.focus === "outro" ? "正在生成结尾定格卡配图…" : `正在生成第 ${idx + 1} 页卡片配图…`) + '</span></div>'
        : "") +
      "</div>" +
      slideErrorHtml +
      cueStripHtml +
      filmstripHtml +
      "</div></div>";

    const stLabel = slideImageState(slide);
    const hasOutro = slideHasOutro(slide);
    const outroStLabel = hasOutro ? outroImageState(slide) : "";
    const outroCardSectionHtml = hasOutro
      ? '<section class="vstudio-section">' +
        '<div class="tpl-image-panel" data-tpl-dropzone="' + idx + '" data-tpl-drop-slot="outro">' +
        '<div class="tpl-image-panel-head">' +
        '<div class="tpl-image-meta"><span class="vstudio-section-title">结尾定格卡</span>' +
        '<span class="vstudio-origin-badge" data-state="' + escFn(outroStLabel) + '">' + escFn(outroStLabel) + "</span></div>" +
        '<span class="small">' + escFn(outroOriginLabel(slide)) + "</span>" +
        "</div>" +
        '<div class="tpl-image-actions">' +
        btnFn(
          slide.outroImage ? "AI 重新生成" : "AI 生成结尾图",
          "tpl-reimage-outro",
          slide.outroImage ? "outline" : "primary",
          idx,
          outroBusy ? "disabled" : "",
        ) +
        '<label class="outline tpl-upload-btn' + (outroBusy ? " is-disabled" : "") + '">' +
        '上传本地图<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="slide-outro-image" data-tpl-slide="' + idx + '"' + (outroBusy ? " disabled" : "") + " hidden></label>" +
        (slide.outroImage ? btnFn("改用结尾模版卡", "tpl-clear-outro-image", "textbtn", idx, outroBusy ? "disabled" : "") : "") +
        "</div>" +
        '<label class="field" style="margin-top:10px">结尾卡配图描述 <small>（AI 生成结尾收口卡时使用，支持直接拖图）</small>' +
        '<textarea rows="2" maxlength="400" class="autogrow" data-tpl-slide="' + idx + '" data-tpl-field="outroImagePrompt" placeholder="例如：温暖安心的16:9医疗结尾卡片，居中突出核心行动金句，配简洁健康盾牌与药盒插画">' +
        escFn(slide.outroImagePrompt || "") +
        "</textarea></label>" +
        "</div></section>"
      : "";

    const slidePanelHtml =
      '<div class="vstudio-panel">' +
      '<section class="vstudio-section">' +
      '<div class="field-head"><label class="label" for="tpl-line-' + idx + '">本页口播台词</label>' +
      '<span class="pace" id="tpl-pace-' + idx + '">' + escFn(pace.label) + "</span></div>" +
      '<textarea id="tpl-line-' + idx + '" rows="3" maxlength="360" data-tpl-slide="' + idx + '" data-tpl-field="line" placeholder="填写本页药师口播，将自动配音并切分明黄高亮字幕">' +
      escFn(slide.line || "") +
      "</textarea>" +
      '<label class="field" style="margin-top:10px">字幕明黄高亮关键词 <small>（顿号或空格分隔）</small>' +
      '<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-joined="highlightWords" value="' +
      escFn((slide.highlightWords || []).join("、")) +
      '" placeholder="例如：对乙酰氨基酚、布洛芬、交替"></label>' +
      renderBeatsEditorHtml(slide, idx, escFn) +
      "</section>" +
      '<section class="vstudio-section">' +
      '<div class="tpl-image-panel" data-tpl-dropzone="' + idx + '">' +
      '<div class="tpl-image-panel-head">' +
      '<div class="tpl-image-meta"><span class="vstudio-section-title">' + (slide.type === "cover" ? "开场封面卡片" : "主视觉卡片") + '</span>' +
      '<span class="vstudio-origin-badge" data-state="' + escFn(stLabel) + '">' + escFn(stLabel) + "</span></div>" +
      '<span class="small">' + escFn(slideOriginLabel(slide)) + "</span>" +
      "</div>" +
      '<div class="tpl-image-actions">' +
      btnFn(
        slide.contentImage ? "AI 重新生成" : (slide.type === "cover" ? "AI 生成开场图" : "AI 生成配图"),
        "tpl-reimage",
        slide.contentImage ? "outline" : "primary",
        idx,
        busy ? "disabled" : "",
      ) +
      '<label class="outline tpl-upload-btn' + (busy ? " is-disabled" : "") + '">' +
      '上传本地图<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="slide-image" data-tpl-slide="' + idx + '"' + (busy ? " disabled" : "") + " hidden></label>" +
      (slide.contentImage ? btnFn(slide.type === "cover" && slide.layoutMode === "hook" ? "改用开场模版卡" : "改用文字排版卡", "tpl-clear-image", "textbtn", idx, busy ? "disabled" : "") : "") +
      "</div>" +
      '<label class="field" style="margin-top:10px">卡片配图描述 <small>（AI 重做时使用，支持直接拖图到预览或此处）</small>' +
      '<textarea rows="2" maxlength="400" class="autogrow" data-tpl-slide="' + idx + '" data-tpl-field="imagePrompt" placeholder="例如：左右双栏对比图，顶部大标题……左侧……右侧……">' +
      escFn(slide.imagePrompt || "") +
      "</textarea></label>" +
      (slide.contentImage
        ? '<details class="shot-options"><summary>备选文字排版卡内容（切回文字卡时展示）</summary>' +
          renderFallbackFieldsHtml(slide, idx, escFn) +
          "</details>"
        : '<div class="vstudio-fallback-box"><div class="vstudio-fallback-title">' + (isDefaultHookCover(slide) ? "当前开场模版内容" : "当前文字排版卡内容") + '</div>' +
          renderFallbackFieldsHtml(slide, idx, escFn) +
          "</div>") +
      "</div></section>" +
      outroCardSectionHtml +
      '<section class="vstudio-section">' +
      '<div class="tpl-two-col">' +
      '<label class="field">本页版式模式<select data-tpl-slide="' + idx + '" data-tpl-layout-mode="1">' +
      (TemplateVideo.LAYOUT_MODES || []).map((m) =>
        '<option value="' + escFn(m.id) + '"' + (slide.layoutMode === m.id ? " selected" : "") + ">" + escFn(m.name) + "</option>"
      ).join("") +
      "</select></label>" +
      '<label class="field">对应顶部章节<select data-tpl-slide="' + idx + '" data-tpl-chapter-idx="1">' +
      deck.chapters.map((ch, ci) =>
        '<option value="' + ci + '"' + (Number(slide.chapterIndex) === ci ? " selected" : "") + ">" + escFn(ch || `章节${ci + 1}`) + "</option>"
      ).join("") +
      "</select></label>" +
      "</div>" +
      '<label class="field" style="margin-top:10px">本页页签名称<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-field="name" value="' + escFn(slide.name || "") + '" placeholder="用于下方分镜栏"></label>' +
      "</section></div>";

    const globalPanelHtml =
      '<div class="vstudio-panel">' +
      '<section class="vstudio-section">' +
      '<span class="label">模板视觉风格</span>' +
      '<div class="tpl-theme-grid">' +
      TemplateVideo.THEMES.map((t) =>
        '<button type="button" class="tpl-theme-card" data-action="tpl-theme" data-val="' +
        t.id +
        '" aria-pressed="' +
        (deck.theme === t.id) +
        '"><span class="tpl-theme-swatch ' +
        t.id +
        '"></span><span><strong>' +
        escFn(t.name) +
        "</strong><small>" +
        escFn(t.desc) +
        "</small></span></button>"
      ).join("") +
      "</div>" +
      '<span class="label" style="margin-top:12px">左侧主讲槽位</span>' +
      '<div class="chips">' +
      TemplateVideo.PRESENTERS.map((pr) =>
        '<button type="button" class="chip' + (deck.presenter === pr.id ? " selected" : "") + '" data-action="tpl-presenter" data-val="' + pr.id + '" aria-pressed="' + (deck.presenter === pr.id) + '">' + escFn(pr.name) + "</button>"
      ).join("") +
      "</div>" +
      (deck.presenter !== "none"
        ? '<span class="label" style="margin-top:12px">人物口型动效（阿里云百炼）</span>' +
          '<div class="chips">' +
          '<button type="button" class="chip' + (avatarMode === "videoretalk" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="videoretalk" aria-pressed="' + (avatarMode === "videoretalk") + '">声动人像（整片）</button>' +
          '<button type="button" class="chip' + (avatarMode === "wan2.2-s2v" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="wan2.2-s2v" aria-pressed="' + (avatarMode === "wan2.2-s2v") + '">万相数字人（生动）</button>' +
          '<button type="button" class="chip' + (avatarMode === "static" ? " selected" : "") + '" data-action="tpl-avatar-mode" data-val="static" aria-pressed="' + (avatarMode === "static") + '">静态肖像</button>' +
          "</div>" +
          (deck.presenter === "cartoon" && avatarMode === "videoretalk"
            ? '<p class="footmeta" style="margin-top:6px">卡通形象如遇人脸检测不通过，可切换「万相数字人」（原生支持卡通）。</p>'
            : "") +
          (avatarMode !== "static" && cfg && !cfg.dashscopeKeyPresent
            ? '<p class="footmeta" style="margin-top:6px">尚未配置阿里云百炼 Key，' + btnFn("去数字人服务配置", "connect-dashscope", "textbtn") + "</p>"
            : "")
        : "") +
      "</section>" +
      (typeof StudioMusic !== "undefined"
        ? '<section class="vstudio-section">' +
          '<span class="label">背景音乐</span>' +
          StudioMusic.renderMusicStudioCard(w, { showModeChips: true }) +
          "</section>"
        : "") +
      '<section class="vstudio-section">' +
      '<label class="field">左上胶囊短主题 <small>（建议 ≤12 字，不与首屏大问题重复）</small><input maxlength="20" data-tpl-global="shortTitle" value="' + escFn(deck.shortTitle || "") + '" placeholder="例如：阿托伐他汀 · 服用时间"></label>' +
      '<label class="field" style="margin-top:10px">作品完整标题<input maxlength="40" data-tpl-global="title" value="' + escFn(deck.title) + '"></label>' +
      '<span class="label" style="margin-top:10px">顶部 4 个章节导航</span>' +
      '<div class="tpl-chapter-grid">' +
      [0, 1, 2, 3].map((ci) =>
        '<label class="field">章节 ' + (ci + 1) + '<input maxlength="8" data-tpl-chap="' + ci + '" value="' + escFn(deck.chapters[ci] || "") + '"></label>'
      ).join("") +
      "</div></section>" +
      '<section class="vstudio-section">' +
      '<span class="label">药师权威名片</span>' +
      '<div class="tpl-two-col">' +
      '<label class="field">姓名<input maxlength="16" data-pharm="name" value="' + escFn(p.name) + '"></label>' +
      '<label class="field">职称<input maxlength="16" data-pharm="role" value="' + escFn(p.role) + '"></label>' +
      "</div>" +
      '<label class="field" style="margin-top:10px">医院 / 科室<input maxlength="24" data-pharm="hospital" value="' + escFn(p.hospital) + '"></label>' +
      (deck.presenter === "digital"
        ? '<div class="tpl-avatar-upload">' +
          '<img class="tpl-avatar-thumb" src="' + escFn(avatarPreview) + '" alt="" />' +
          '<label class="outline tpl-upload-btn">' +
          '上传医生肖像<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="avatar" hidden></label>' +
          (p.avatarImage ? btnFn("恢复默认", "tpl-reset-avatar", "textbtn") : "") +
          "</div>"
        : "") +
      '<label class="field" style="margin-top:12px">底部免责声明<input maxlength="60" data-tpl-global="disclaimer" value="' + escFn(deck.disclaimer || "") + '" placeholder="例如：科普内容仅供参考，具体诊疗与用药请遵医嘱"></label>' +
      "</section></div>";

    const inspectorHtml =
      '<aside class="vstudio-inspector"><div class="sheet vstudio-inspector-card">' +
      '<div class="vstudio-tabs" role="tablist" aria-label="编辑面板切换">' +
      '<button type="button" class="vstudio-tab" role="tab" data-action="tpl-inspector-tab" data-val="slide" aria-selected="' + (activeTab === "slide") + '">本页内容 <span class="vstudio-tab-sub">第 ' + (idx + 1) + " 页</span></button>" +
      '<button type="button" class="vstudio-tab" role="tab" data-action="tpl-inspector-tab" data-val="global" aria-selected="' + (activeTab === "global") + '">全片设置 <span class="vstudio-tab-sub">' + escFn(themeName) + "</span></button>" +
      "</div>" +
      (activeTab === "global" ? globalPanelHtml : slidePanelHtml) +
      "</div></aside>";

    return '<div class="vstudio">' + topBarHtml + '<div class="vstudio-grid">' + stageHtml + inspectorHtml + "</div></div>";
  }

  function templateEditorBodyHtml(w, dataStore, escFn, btnFn, icoFn) {
    return templateEditorHtml(w, dataStore, escFn, btnFn, icoFn, () => "");
  }

  function templateEditorAsideHtml() {
    return "";
  }

  function selectOutroCue(w, slide) {
    if (!w || !slide) return;
    const cues = TemplateVideo.getSlideCues(slide, 22);
    const outroIdx = cues.findIndex((c) => c.focus === "outro");
    if (outroIdx >= 0) cueSelection.set(w, outroIdx);
  }

  function refreshLivePreview(w, dataStore) {
    const scaler = document.getElementById("tpl-live-scaler");
    if (!scaler || !isTemplateVideo(w)) return;
    const deck = buildDeckForWork(w, dataStore);
    const idx = getSlideIndex(w);
    const slide = deck.slides[idx];
    const cues = TemplateVideo.getSlideCues(slide, 22);
    const cueIdx = Math.min(getCueIndex(w), Math.max(0, cues.length - 1));
    const activeCue = cues[cueIdx] || { text: slide.line || "", focus: "all", beatIndex: 0, highlightWords: slide.highlightWords || [] };
    scaler.innerHTML = TemplateVideo.renderFrameHtml(deck, idx, {
      subtitleText: activeCue.text,
      focus: activeCue.focus,
      beatIndex: activeCue.beatIndex,
      highlightWords: activeCue.highlightWords,
      cueIndex: cueIdx,
    });
    const liveBox = document.getElementById("tpl-live-box");
    if (liveBox) {
      if (activeCue.focus === "outro") liveBox.dataset.tplDropSlot = "outro";
      else delete liveBox.dataset.tplDropSlot;
      const stageBusy = activeCue.focus === "outro"
        ? Boolean(slide.outroJob && !slide.outroJob.error)
        : Boolean(slide.job && !slide.job.error);
      let busyEl = liveBox.querySelector(".tpl-media-busy");
      if (stageBusy) {
        if (!busyEl) {
          busyEl = document.createElement("div");
          busyEl.className = "tpl-media-busy";
          busyEl.setAttribute("role", "status");
          liveBox.appendChild(busyEl);
        }
        busyEl.innerHTML = '<span class="picture-busy"><span class="spinner" aria-hidden="true"></span>' +
          (activeCue.focus === "outro" ? "正在生成结尾定格卡配图…" : `正在生成第 ${idx + 1} 页卡片配图…`) +
          "</span>";
      } else if (busyEl) {
        busyEl.remove();
      }
    }
    const cueStrip = document.getElementById("tpl-cue-strip");
    if (cueStrip) {
      const cueInner = renderCueButtonsHtml(cues, cueIdx);
      cueStrip.hidden = !cueInner;
      cueStrip.innerHTML = cueInner;
    }
    fitTemplatePreviews();
  }

  function syncLiveBoxScale(liveBox, liveScaler) {
    if (!liveBox || !liveScaler) return;
    const width = liveBox.clientWidth || liveBox.offsetWidth;
    if (width <= 0) return;
    const scale = width / 1280;
    liveScaler.style.transform = `scale(${scale})`;
    const busyEl = liveBox.querySelector(".tpl-media-busy");
    if (busyEl) {
      const slotEl = liveScaler.querySelector(".pt-media-slot");
      if (slotEl) {
        const boxRect = liveBox.getBoundingClientRect();
        const slotRect = slotEl.getBoundingClientRect();
        if (slotRect.width > 0 && slotRect.height > 0) {
          const radius = (parseFloat(getComputedStyle(slotEl).borderRadius) || 22) * scale;
          busyEl.style.left = `${slotRect.left - boxRect.left - liveBox.clientLeft}px`;
          busyEl.style.top = `${slotRect.top - boxRect.top - liveBox.clientTop}px`;
          busyEl.style.width = `${slotRect.width}px`;
          busyEl.style.height = `${slotRect.height}px`;
          busyEl.style.borderRadius = `${radius}px`;
        }
      } else {
        busyEl.style.left = "0px";
        busyEl.style.top = "0px";
        busyEl.style.width = "100%";
        busyEl.style.height = "100%";
        busyEl.style.borderRadius = "0px";
      }
    }
  }

  function fitTemplatePreviews() {
    const liveBox = document.getElementById("tpl-live-box");
    const liveScaler = document.getElementById("tpl-live-scaler");
    syncLiveBoxScale(liveBox, liveScaler);
    if (typeof ResizeObserver !== "undefined" && liveBox && liveBox !== observedLiveBox) {
      if (liveBoxObserver) liveBoxObserver.disconnect();
      observedLiveBox = liveBox;
      liveBoxObserver = new ResizeObserver(() => {
        syncLiveBoxScale(
          document.getElementById("tpl-live-box"),
          document.getElementById("tpl-live-scaler"),
        );
      });
      liveBoxObserver.observe(liveBox);
    }
    document.querySelectorAll(".sample.template-sample .cover").forEach((cover) => {
      const scaler = cover.querySelector(".tpl-mini-scaler");
      if (scaler && cover.offsetWidth > 0) {
        const scale = Math.max(cover.offsetWidth / 1280, cover.offsetHeight / 720);
        scaler.style.transform = `scale(${scale})`;
      }
    });
  }

  // ===== Per-Slide Card Image Generation & Regeneration =====

  function renderImageDialog(w, hooks) {
    if (!imageModalState) return;
    const deck = buildDeckForWork(w, hooks.data);
    const { index, slot, prompt, imageModel, imageSize } = imageModalState;
    const isOutro = slot === "outro";
    const slide = deck.slides[index];
    if (!slide) return;
    const cfg = hooks.config;
    const models = Object.entries(cfg.imageModels).map(([id, spec]) => [id, spec[0]]);
    const themeLabel = deck.theme === "warm" ? "暖色手绘风" : "医疗白蓝风";
    const fullPrompt = isOutro
      ? TemplateVideo.buildOutroImagePrompt(deck, index, prompt, w.drug)
      : TemplateVideo.buildCardImagePrompt(deck, index, prompt, w.drug);
    const hasExisting = isOutro ? Boolean(slide.outroImage) : Boolean(slide.contentImage);

    const body =
      hooks.arkKeyWarning() +
      '<label class="field">' + (isOutro ? "结尾卡画面与金句描述（选填，留空自动按结尾提醒构思）" : "卡片画面与文字描述（选填，留空自动按本页要点构思）") +
      '<textarea id="tpl-image-prompt" rows="3" maxlength="400" placeholder="' + (isOutro ? "例如：温暖安心的16:9结尾卡片，居中突出核心行动金句，配简洁健康盾牌与药盒插画" : "例如：左右双栏对比科普图，标题……，左栏……，右栏……，底部提示条……") + '">' +
      hooks.esc(prompt) +
      "</textarea></label>" +
      '<details class="shot-options"><summary>查看完整生成提示词</summary>' +
      '<textarea id="tpl-generated-prompt" rows="5" readonly aria-label="提交给方舟的提示词">' +
      hooks.esc(fullPrompt) +
      "</textarea></details>" +
      '<div class="fields" style="margin-top:11px">' +
      '<label class="field">生图模型<select id="tpl-picture-model">' +
      hooks.opts(models, imageModel) +
      '</select></label><label class="field">清晰度<select id="tpl-picture-size">' +
      hooks.opts(cfg.imageModels[imageModel][1], imageSize) +
      "</select></label></div>" +
      '<p class="footmeta">沿用当前模板风格「' +
      hooks.esc(themeLabel) +
      '」，生成严格 16:9 满画幅' + (isOutro ? "结尾收口卡片" : "带中文字科普信息图") + '并平铺填入右侧 16:9 内容槽位（标准 1360×765 比例，不拉伸不裁切），按方舟实际用量计费。</p>' +
      '<div style="margin-top:14px">' +
      hooks.btn(
        "确认用方舟生成 1 张",
        "tpl-regen-ark",
        "primary widebtn",
        isOutro ? `${index}:outro` : String(index),
        cfg.keyPresent ? "" : "disabled",
      ) +
      "</div>";

    hooks.openModal(
      isOutro
        ? `第 ${index + 1} 页「结尾定格卡」· ${hasExisting ? "重新生成结尾图" : "AI 生成结尾定格图"}`
        : `第 ${index + 1} 页「${slide.name || slide.headline || "卡片"}」· ${hasExisting ? "重新生成配图" : (slide.type === "cover" ? "AI 生成开场封面图" : "AI 生成卡片配图")}`,
      body,
      "tpl-reimage",
    );
  }

  function openImageDialog(w, slideIndex, hooks, slotKind) {
    const slot = slotKind === "outro" ? "outro" : "main";
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    const activeJob = slot === "outro" ? slide?.outroJob : slide?.job;
    if (!slide || (activeJob && !activeJob.error)) return;
    if (slot === "outro" && getSlideIndex(w) === slideIndex) {
      selectOutroCue(w, slide);
      refreshLivePreview(w, hooks.data);
    }
    imageModalState = {
      index: slideIndex,
      slot,
      prompt: slot === "outro" ? (slide.outroImagePrompt || "") : (slide.imagePrompt || ""),
      imageModel: w.settings.imageModel,
      imageSize: w.settings.imageSize,
    };
    renderImageDialog(w, hooks);
  }

  function updateImageModalField(w, kind, value, hooks) {
    if (!imageModalState) return false;
    if (kind === "prompt") {
      imageModalState.prompt = value;
      const preview = document.getElementById("tpl-generated-prompt");
      if (preview && w) {
        const deck = buildDeckForWork(w, hooks.data);
        preview.value = imageModalState.slot === "outro"
          ? TemplateVideo.buildOutroImagePrompt(deck, imageModalState.index, value, w.drug)
          : TemplateVideo.buildCardImagePrompt(deck, imageModalState.index, value, w.drug);
      }
      return true;
    }
    if (kind === "model") {
      imageModalState.imageModel = value;
      const sizes = hooks.config.imageModels[value]?.[1] || ["2K"];
      if (!sizes.includes(imageModalState.imageSize)) imageModalState.imageSize = sizes[0];
      renderImageDialog(w, hooks);
      return true;
    }
    if (kind === "size") {
      imageModalState.imageSize = value;
      return true;
    }
    return false;
  }

  function clearImageModal() {
    imageModalState = null;
  }

  function buildSlideImagePayload(w, deck, slideIndex, rawPrompt, settings, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const slide = deck.slides[slideIndex];
    const fullPrompt = isOutro
      ? TemplateVideo.buildOutroImagePrompt(deck, slideIndex, rawPrompt, w.drug)
      : TemplateVideo.buildCardImagePrompt(deck, slideIndex, rawPrompt, w.drug);
    const payload = {
      id: crypto.randomUUID(),
      mode: "ark",
      kind: "images",
      template: true,
      styleReference: false,
      settings: { ...settings, mode: "ark", ratio: "16:9" },
      style: w.style || 0,
      items: [
        {
          prompt: fullPrompt,
          variant: (isOutro ? (slide.outroVariant || 0) + 100 : (slide.variant || 0)) + slideIndex + 1,
        },
      ],
    };
    if (hooks.config?.workCosts) payload.workId = w.id;
    return payload;
  }

  async function pollSlideJob(w, slide, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const jobKey = isOutro ? "outroJob" : "job";
    const job = slide[jobKey];
    if (!job || job.error || submittingJobs.has(job.payload.id) || pollingJobs.has(job.payload.id)) return;
    pollingJobs.add(job.payload.id);
    try {
      while (slide[jobKey] === job && !job.error) {
        try {
          const result = await hooks.jsonRequest("/api/jobs/" + job.payload.id);
          if (slide[jobKey] !== job) return;
          if (result.status === "failed") {
            throw new Error(result.error || (isOutro ? "生成结尾定格图失败" : "生成卡片配图失败"));
          }
          if (result.status === "done") {
            const url = result.output?.images?.[0] || "";
            if (url) {
              if (isOutro) {
                slide.outroImage = url;
                slide.outroImageSource = "ark";
                slide.outroImageModel = job.payload.settings.imageModel;
                slide.outroImageSize = job.payload.settings.imageSize;
                if (job.rawPrompt !== undefined) slide.outroImagePrompt = job.rawPrompt;
                slide.outroVariant = (slide.outroVariant || 0) + 1;
              } else {
                slide.contentImage = url;
                slide.imageSource = "ark";
                slide.imageModel = job.payload.settings.imageModel;
                slide.imageSize = job.payload.settings.imageSize;
                slide.focusRegions = {};
                if (job.rawPrompt !== undefined) slide.imagePrompt = job.rawPrompt;
                slide.variant = (slide.variant || 0) + 1;
              }
            }
            slide[jobKey] = null;
            syncBlocksFromDeck(w);
            if (w.video) w.videoDirty = true;
            hooks.changed(w);
            if (hooks.current() === w) {
              hooks.render(true);
              hooks.notify(isOutro ? "结尾定格图已更新" : "卡片配图已更新", "ok");
            }
            return;
          }
        } catch (err) {
          if (slide[jobKey] !== job) return;
          job.error = err.message || (isOutro ? "结尾定格图生成失败" : "卡片配图生成失败");
          hooks.changed(w);
          if (hooks.current() === w) hooks.render(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    } finally {
      pollingJobs.delete(job.payload.id);
    }
  }

  async function sendSlideJob(w, slide, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const jobKey = isOutro ? "outroJob" : "job";
    const job = slide[jobKey];
    if (!job) return;
    const id = job.payload.id;
    if (submittingJobs.has(id)) return;
    submittingJobs.add(id);
    job.error = "";
    hooks.changed(w);
    if (hooks.current() === w) hooks.render(true);
    try {
      await hooks.jsonRequest("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.payload),
      });
    } catch (err) {
      if (slide[jobKey] === job) {
        job.error = err.message || "提交生图任务失败";
        hooks.changed(w);
        if (hooks.current() === w) hooks.render(true);
      }
    } finally {
      submittingJobs.delete(id);
    }
    if (slide[jobKey] === job && !job.error) {
      pollSlideJob(w, slide, hooks, isOutro ? "outro" : "main");
    }
  }

  async function startSlideImageJob(w, slideIndex, rawPrompt, settings, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const jobKey = isOutro ? "outroJob" : "job";
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    if (!slide || (slide[jobKey] && !slide[jobKey].error)) return;
    const promptStr = String(rawPrompt ?? (isOutro ? slide.outroImagePrompt : slide.imagePrompt) ?? "").trim();
    if (isOutro) slide.outroImagePrompt = promptStr;
    else slide.imagePrompt = promptStr;
    const payload = buildSlideImagePayload(w, deck, slideIndex, promptStr, settings, hooks, isOutro ? "outro" : "main");
    slide[jobKey] = { target: isOutro ? "tpl-outro-image" : "tpl-image", payload, rawPrompt: promptStr };
    await sendSlideJob(w, slide, hooks, isOutro ? "outro" : "main");
  }

  function queueBatchSlideImages(w, slideEntries, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const normalized = (slideEntries || [])
      .map((entry) => (typeof entry === "number" ? { index: entry, slot: "main" } : entry))
      .filter((entry) => {
        const sl = deck.slides[entry?.index];
        if (!sl) return false;
        const job = entry.slot === "outro" ? sl.outroJob : sl.job;
        return !(job && !job.error);
      });
    if (!normalized.length) return;
    const run = () => {
      for (const item of normalized) {
        const sl = deck.slides[item.index];
        const rawPrompt = item.slot === "outro" ? (sl.outroImagePrompt || "") : (sl.imagePrompt || "");
        startSlideImageJob(w, item.index, rawPrompt, w.settings, hooks, item.slot);
      }
    };
    hooks.authorize({ ...w, settings: { ...w.settings, ratio: "16:9" } }, normalized.length, "images", run);
  }

  function resumeSlideJobs(w, hooks) {
    if (!isTemplateVideo(w) || !w.templateDeck?.slides) return;
    for (const slide of w.templateDeck.slides) {
      if (slide.job && !slide.job.error) {
        pollSlideJob(w, slide, hooks, "main");
      }
      if (slide.outroJob && !slide.outroJob.error) {
        pollSlideJob(w, slide, hooks, "outro");
      }
    }
  }

  function retrySlideImage(w, slideIndex, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    const job = isOutro ? slide?.outroJob : slide?.job;
    if (!job) return;
    const payload = job.payload;
    hooks.authorize({ ...w, settings: payload.settings }, 1, "images", () =>
      sendSlideJob(w, slide, hooks, isOutro ? "outro" : "main")
    );
  }

  function abortSlideImage(w, slideIndex, hooks, slotKind) {
    const isOutro = slotKind === "outro";
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    const jobKey = isOutro ? "outroJob" : "job";
    if (!slide?.[jobKey]) return;
    slide[jobKey] = null;
    hooks.changed(w);
    hooks.render(true);
  }

  // ===== Slide List Mutations =====

  function addSlide(w, dataStore, changedFn, renderFn, notifyFn) {
    const deck = buildDeckForWork(w, dataStore);
    if (deck.slides.length >= 12) {
      notifyFn("最多支持 12 页模板卡片", "warn");
      return;
    }
    const lastChap = deck.slides[deck.slides.length - 1]?.chapterIndex ?? 0;
    const newNum = deck.slides.length + 1;
    deck.slides.push({
      type: "steps",
      name: `补充要点 ${newNum}`,
      chapterIndex: lastChap,
      headline: `补充科普要点 ${newNum}`,
      accentPhrase: "",
      contentImage: "",
      imagePrompt: "",
      steps: [
        { title: "核对要点一", desc: "填写具体可执行的用药核对方法。", key: "原则：以说明书与医嘱为准" },
        { title: "核对要点二", desc: "补充常见注意事项或易错细节。", key: "" },
        { title: "何时问药师", desc: "遇到拿不准的情况及时咨询药师或医生。", key: "" },
      ],
      checks: ["核对完整药名", "按说明书执行", "留意异常反应", "有疑问问药师"],
      highlightWords: [],
      line: "",
      seconds: 8,
    });
    syncBlocksFromDeck(w);
    if (w.video) w.videoDirty = true;
    setSlideIndex(w, deck.slides.length - 1);
    changedFn(w);
    renderFn(true);
  }

  function moveSlide(w, rawIdx, rawDir, dataStore, changedFn, renderFn) {
    const deck = buildDeckForWork(w, dataStore);
    const nextIdx = rawIdx + rawDir;
    if (rawIdx < 0 || nextIdx < 0 || nextIdx >= deck.slides.length) return;
    if (deck.slides[rawIdx]?.job || deck.slides[nextIdx]?.job || deck.slides[rawIdx]?.outroJob || deck.slides[nextIdx]?.outroJob) return;
    const [moved] = deck.slides.splice(rawIdx, 1);
    deck.slides.splice(nextIdx, 0, moved);
    syncBlocksFromDeck(w);
    if (w.video) w.videoDirty = true;
    setSlideIndex(w, nextIdx);
    changedFn(w);
    renderFn(true);
  }

  function removeSlide(w, idx, dataStore, changedFn, renderFn, notifyFn) {
    const deck = buildDeckForWork(w, dataStore);
    if (deck.slides[idx]?.job || deck.slides[idx]?.outroJob) return;
    if (deck.slides.length <= 2) {
      notifyFn("模板视频至少保留 2 页内容", "warn");
      return;
    }
    deck.slides.splice(idx, 1);
    syncBlocksFromDeck(w);
    if (w.video) w.videoDirty = true;
    setSlideIndex(w, Math.min(idx, deck.slides.length - 1));
    changedFn(w);
    renderFn(true);
  }

  // ===== Upload & MP4 Export =====

  async function uploadDataUrl(dataUrl) {
    let res;
    try {
      res = await fetch("/api/upload-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
    } catch {
      throw new Error("无法连接模板合成接口：请关闭旧的「启动工作台」窗口后，重新双击 启动工作台.cmd 再试。");
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error("当前运行的是旧版后台服务：请关闭旧的「启动工作台」窗口后，重新双击 启动工作台.cmd 再试。");
    }
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || "上传模板画面失败");
    return out.url;
  }

  async function handleFileUpload(file, targetKind, w, dataStore, changedFn, renderFn, notifyFn, slideIndex) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notifyFn("请选择 PNG、JPEG 或 WebP 格式的图片", "warn");
      return;
    }
    if (file.size > 4_500_000) {
      notifyFn("图片不能超过 4.5MB", "warn");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
    const url = await uploadDataUrl(dataUrl);
    if (targetKind === "avatar") {
      const p = ensurePharmacist(dataStore);
      p.avatarImage = url;
      if (w?.templateDeck) w.templateDeck.pharmacist.avatarImage = url;
      if (w?.video) w.videoDirty = true;
      if (w) changedFn(w);
      else save();
      notifyFn("已更新医生肖像", "ok");
      renderFn(true);
    } else if (targetKind === "slide-outro-image" && w?.templateDeck) {
      const idx = Number.isInteger(slideIndex) ? slideIndex : getSlideIndex(w);
      const slide = w.templateDeck.slides[idx];
      if (slide) {
        slide.outroImage = url;
        slide.outroImageSource = "upload";
        slide.outroImageModel = "";
        slide.outroImageSize = "";
        slide.outroJob = null;
        if (getSlideIndex(w) === idx) selectOutroCue(w, slide);
        if (w.video) w.videoDirty = true;
        changedFn(w);
        notifyFn("已替换结尾定格卡图片", "ok");
        renderFn(true);
      }
    } else if ((targetKind === "slide-image" || targetKind === "cover") && w?.templateDeck) {
      const idx = Number.isInteger(slideIndex) ? slideIndex : getSlideIndex(w);
      const slide = w.templateDeck.slides[idx];
      if (slide) {
        slide.contentImage = url;
        slide.imageSource = "upload";
        slide.imageModel = "";
        slide.imageSize = "";
        slide.focusRegions = {};
        slide.job = null;
        syncBlocksFromDeck(w);
        if (w.video) w.videoDirty = true;
        changedFn(w);
        notifyFn(`已替换第 ${idx + 1} 页卡片图片`, "ok");
        renderFn(true);
      }
    }
  }

  async function composeTemplateVideo(w, dataStore, hooks) {
    const deck = buildDeckForWork(w, dataStore);
    if (!deck.title.trim()) {
      hooks.notify("请先填写左上内容主标题", "warn");
      return;
    }
    if (deck.slides.some((s) => !String(s.line || "").trim())) {
      hooks.notify("请补全每一页的口播台词", "warn");
      return;
    }
    if (deck.slides.some((s) => (s.job && !s.job.error) || (s.outroJob && !s.outroJob.error))) {
      hooks.notify("请等待卡片配图生成完成", "warn");
      return;
    }
    if (w.job || exportingWorkId) return;

    const usesSpeech = w.settings.voice !== "无配音";
    const rawAvatarMode = w.settings.avatarMode ?? dataStore.settings?.avatarMode ?? defaults.avatarMode;
    const avatarMode = typeof resolveAvatarMode === "function" ? resolveAvatarMode(rawAvatarMode) : (rawAvatarMode === "static" ? "static" : "videoretalk");
    const avatarResolution = w.settings.avatarResolution || dataStore.settings?.avatarResolution || defaults.avatarResolution || "480P";
    const usesAvatar = usesSpeech && deck.presenter !== "none" && avatarMode !== "static";

    const runSynthesis = async () => {
      exportingWorkId = w.id;
      const statusEl = document.getElementById("tpl-export-status");
      const setStatus = (msg) => {
        const el = document.getElementById("tpl-export-status") || statusEl;
        if (el) el.textContent = msg;
      };
      hooks.render(true);
      try {
        const items = [];
        let firstAvatarBox = null;
        for (let si = 0; si < deck.slides.length; si++) {
          const slide = deck.slides[si];
          setStatus(`正在导出第 ${si + 1} / ${deck.slides.length} 页 1280×720 模板画面...`);
          const cueList = TemplateVideo.getSlideCues(slide, 22);
          const cues = [];
          for (let ci = 0; ci < cueList.length; ci++) {
            const cue = cueList[ci];
            const measured = deck.presenter !== "none"
              ? TemplateVideo.measureCueAvatarRect(deck, si, cue)
              : null;
            if (usesAvatar && measured && !firstAvatarBox) firstAvatarBox = measured.box;
            const ring = measured?.ring || null;
            const exportOpts = {};
            if (usesAvatar && measured) {
              exportOpts.cutoutAvatar = true;
              exportOpts.cutoutRect = measured;
            }
            if (ring) {
              // Base PNG carries the soft track ring; FFmpeg animates the smooth 24fps progress arc on top.
              exportOpts.progress = 0;
            }
            const pngDataUrl = await TemplateVideo.exportSlideCuePng(
              deck,
              si,
              { ...cue, cueIndex: ci },
              Object.keys(exportOpts).length ? exportOpts : undefined,
            );
            const uploadedUrl = await uploadDataUrl(pngDataUrl);
            const outCue = {
              image: uploadedUrl,
              weight: cue.weight,
              transition: cue.transition || "cut",
            };
            if (usesAvatar) {
              outCue.avatarRect = measured ? measured.box : null;
            }
            if (ring) {
              outCue.progressRing = ring;
            }
            if (cue.holdSeconds && cue.holdSeconds > 0) {
              outCue.holdSeconds = cue.holdSeconds;
            }
            cues.push(outCue);
          }
          if (si === 0 && cues[0] && w.blocks[0]) {
            if (usesAvatar || cues[0].progressRing) {
              // Export a clean cover frame so Works cards & player poster show the portrait and progress arc.
              const posterDataUrl = await TemplateVideo.exportSlideCuePng(deck, 0, { ...cueList[0], cueIndex: 0 });
              w.blocks[0].image = await uploadDataUrl(posterDataUrl);
            } else {
              w.blocks[0].image = cues[0].image; // Clean 16:9 poster for player & works card
            }
          }
          const hasOutro = cueList.some((c) => c.focus === "outro");
          items.push({
            line: slide.line.trim(),
            seconds: Math.max(4, Number(slide.seconds) || recommendedShotSeconds(spokenChars(slide.line))),
            tailPause: hasOutro ? 1.15 : 0.55,
            cues,
          });
        }
        setStatus(usesAvatar ? "画面已就绪，正在后台生成数字人对口型与 MP4..." : "画面已就绪，正在后台合成配音与 MP4...");
        const payload = {
          id: crypto.randomUUID(),
          mode: "ark",
          kind: "video",
          template: true,
          settings: {
            ...w.settings,
            mode: "ark",
            ratio: "16:9",
            ...hooks.videoMusicSettings(w),
            avatarMode,
            avatarResolution,
          },
          style: w.style || 0,
          items,
        };
        if (usesAvatar && firstAvatarBox) {
          payload.avatar = {
            enabled: true,
            model: avatarMode,
            resolution: avatarResolution,
            presenter: deck.presenter,
            image: TemplateVideo.resolveAvatarSrc(deck),
            rect: firstAvatarBox,
          };
        }
        if (hooks.workCostsEnabled) payload.workId = w.id;
        w.job = { target: "compose", payload };
        exportingWorkId = null;
        await hooks.sendJob(w, w);
      } catch (err) {
        exportingWorkId = null;
        hooks.notify(err.message || "导出模板画面失败", "warn");
        hooks.render(true);
      }
    };

    if (usesSpeech) {
      if (!hooks.speechKeyPresent) {
        hooks.openApiKeys("speech");
        return;
      }
      if (usesAvatar && !hooks.dashscopeKeyPresent) {
        hooks.openApiKeys("dashscope");
        return;
      }
      hooks.authorizeSpeechOnly(w, deck.slides.length, runSynthesis, {
        usesAvatar,
        avatarModel: avatarMode,
        avatarResolution,
        presenterLabel: deck.presenter === "cartoon" ? "卡通形象" : "数字人",
      });
    } else {
      await runSynthesis();
    }
  }

  window.addEventListener("resize", fitTemplatePreviews);

  global.TemplateStudio = {
    isTemplateVideo,
    isDefaultHookCover,
    slideHasOutro,
    ensurePharmacist,
    getSlideIndex,
    setSlideIndex,
    getCueIndex,
    setCueIndex: (w, idx) => cueSelection.set(w, idx),
    getInspectorTab,
    setInspectorTab,
    slideImageState,
    outroImageState,
    collectBatchImageTargets,
    syncBlocksFromDeck,
    buildDeckForWork,
    installTemplateDeck,
    templateSampleCardsHtml,
    modeSwitcherHtml,
    templateSetupHtml,
    templateEditorHtml,
    templateEditorBodyHtml,
    templateEditorAsideHtml,
    refreshLivePreview,
    fitTemplatePreviews,
    openImageDialog,
    renderImageDialog,
    updateImageModalField,
    clearImageModal,
    getImageModalState: () => imageModalState,
    startSlideImageJob,
    queueBatchSlideImages,
    resumeSlideJobs,
    retrySlideImage,
    abortSlideImage,
    addSlide,
    moveSlide,
    removeSlide,
    handleFileUpload,
    composeTemplateVideo,
  };
})(window);
