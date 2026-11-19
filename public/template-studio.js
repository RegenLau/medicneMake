"use strict";

/* Workbench UI, per-card image generation & MP4 synthesis glue for the 16:9 infographic template video mode. */
(function (global) {
  const cueSelection = new WeakMap();
  const slideSelection = new WeakMap();
  const pollingJobs = new Set();
  const submittingJobs = new Set();
  let exportingWorkId = null;
  let imageModalState = null;

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

  function slideImageState(slide) {
    if (slide.job?.error) return "配图失败";
    if (slide.job) return "生成中";
    if (slide.contentImage) {
      if (slide.imageSource === "ark") return "AI 配图";
      if (slide.imageSource === "upload" || slide.contentImage.startsWith("/media/")) return "自定义图";
      return "预设信息图";
    }
    return "文字排版卡";
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
        w.templateDeck.chapters = normalized.chapters;
        w.templateDeck.pharmacist = normalized.pharmacist;
        w.templateDeck.disclaimer = normalized.disclaimer;
        w.templateDeck.slides.forEach((slide, idx) => {
          const n = normalized.slides[idx];
          slide.type = n.type;
          slide.name = n.name;
          slide.chapterIndex = n.chapterIndex;
          slide.headline = n.headline;
          slide.accentPhrase = n.accentPhrase;
          slide.contentImage = n.contentImage;
          slide.imagePrompt = n.imagePrompt;
          slide.highlightWords = n.highlightWords;
          slide.line = n.line;
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
      '"><strong>信息图模板讲解 <span class="mode-badge">推荐</span></strong><span>左药师栏（数字人/卡通/名片卡）+ 右 884×544 科普信息图 + 明黄高亮字幕，每张卡片图都可重新生成</span></button>' +
      '<button type="button" class="mode-card" data-action="tpl-video-mode" data-val="storyboard" aria-pressed="' +
      !isTpl +
      '"><strong>AI 分镜动画</strong><span>6 种全屏画风 + Seedance 图生视频，适合纯视觉分镜表达</span></button>' +
      "</div>"
    );
  }

  function templateSetupHtml(w, dataStore, escFn, btnFn) {
    const theme = w.templateTheme || "medical";
    const presenter = w.templatePresenter || "digital";
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
      "</div></div>" +
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
        '<label class="field">副标题导语<input maxlength="90" data-tpl-slide="' + idx + '" data-tpl-field="lead" value="' + escFn(slide.lead || "") + '"></label>' +
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
    if (!slide.contentImage) return "当前展示文字排版卡（可 AI 生成 884×544 带字信息图）";
    if (slide.imageSource === "ark") {
      const cfg = typeof config !== "undefined" ? config : global.config;
      const modelName = cfg?.imageModels?.[slide.imageModel]?.[0] || "火山方舟 AI 生成";
      return `AI 信息图 · ${modelName}${slide.imageSize ? " · " + slide.imageSize : ""}`;
    }
    if (slide.imageSource === "upload" || slide.contentImage.startsWith("/media/")) {
      return "本地上传卡片图（884×544 恒定槽位）";
    }
    return "内置示例信息图（可重新生成或上传替换）";
  }

  function templateEditorBodyHtml(w, dataStore, escFn, btnFn, icoFn) {
    const deck = buildDeckForWork(w, dataStore);
    const idx = getSlideIndex(w);
    const slide = deck.slides[idx];
    const chunks = TemplateVideo.splitSubtitleChunks(slide.line, 22);
    const cueIdx = Math.min(getCueIndex(w), Math.max(0, chunks.length - 1));
    const subText = chunks[cueIdx] ? chunks[cueIdx].text : slide.line || "";
    const busy = Boolean(slide.job && !slide.job.error);
    const anyBusy = deck.slides.some((s) => s.job && !s.job.error);
    const pace = speechStats(slide.line, slide.seconds);
    const p = ensurePharmacist(dataStore);
    const avatarPreview = p.avatarImage || "/assets/template-doctor-digital.jpg";

    const switcherHtml =
      '<nav class="scene-switcher tpl-page-tabs" role="tablist" aria-label="逐页内容与口播切换">' +
      deck.slides.map((s, si) => {
        const st = slideImageState(s);
        return (
          '<button type="button" class="scene-choice" data-action="tpl-slide" data-val="' +
          si +
          '" aria-pressed="' +
          (si === idx) +
          '">' +
          '<span class="scene-name"><b>' +
          (si + 1) +
          '</b><span data-scene-name>' +
          escFn(s.name || s.headline || `第 ${si + 1} 页`) +
          '</span></span><span class="scene-state" data-scene-state data-state="' +
          escFn(st) +
          '">' +
          escFn(st) +
          "</span></button>"
        );
      }).join("") +
      "</nav>";

    const slideErrorHtml = slide.job?.error
      ? '<div class="banner err" role="alert" style="margin-top:12px">本页卡片配图生成未完成：' +
        escFn(slide.job.error) +
        '<div class="banner-actions">' +
        btnFn("重试生成", "tpl-retry-image", "secondary", idx) +
        btnFn("关闭提示", "tpl-abort-image", "textbtn", idx) +
        "</div></div>"
      : "";

    const cueStripHtml =
      '<div class="tpl-cue-strip" id="tpl-cue-strip"' + (chunks.length > 1 ? "" : " hidden") + ">" +
      (chunks.length > 1
        ? '<span class="small">字幕分句预览（共 ' + chunks.length + ' 句）：</span>' +
          chunks.map((_, ci) =>
            '<button type="button" class="chip' + (ci === cueIdx ? " selected" : "") + '" data-action="tpl-cue" data-val="' + ci + '">第 ' + (ci + 1) + " 句</button>"
          ).join("")
        : "") +
      "</div>";

    return (
      /* Sheet 1: Top Page Tabs -> Live Card Preview -> Current Card Image & Narration */
      '<div class="sheet">' +
      '<div class="card-head"><h2>逐页内容与口播</h2><div class="row" style="gap:10px"><span class="small">共 ' +
      deck.slides.length +
      " 页 · 约 " +
      videoTotalSeconds(w) +
      " 秒</span>" +
      btnFn(
        icoFn("plus") + " 添加一页",
        "tpl-slide-add",
        "textbtn",
        "",
        deck.slides.length >= 12 || anyBusy ? "disabled" : "",
      ) +
      "</div></div>" +
      switcherHtml +
      '<div class="tpl-preview-bar">' +
      '<div class="tpl-quick-group">' +
      TemplateVideo.THEMES.map((t) =>
        '<button type="button" class="chip' + (deck.theme === t.id ? " selected" : "") + '" data-action="tpl-theme" data-val="' + t.id + '">' + escFn(t.name) + "</button>"
      ).join("") +
      '<span class="tpl-bar-sep" aria-hidden="true"></span>' +
      TemplateVideo.PRESENTERS.map((pr) =>
        '<button type="button" class="chip' + (deck.presenter === pr.id ? " selected" : "") + '" data-action="tpl-presenter" data-val="' + pr.id + '">' + escFn(pr.name) + "</button>"
      ).join("") +
      "</div>" +
      '<div class="shot-tools">' +
      btnFn(
        icoFn("up"),
        "tpl-slide-move",
        "icon-btn",
        idx + ":-1",
        (idx === 0 || busy ? "disabled " : "") + 'aria-label="前移本页" title="前移本页"',
      ) +
      btnFn(
        icoFn("down"),
        "tpl-slide-move",
        "icon-btn",
        idx + ":1",
        (idx === deck.slides.length - 1 || busy ? "disabled " : "") + 'aria-label="后移本页" title="后移本页"',
      ) +
      btnFn(
        icoFn("trash"),
        "tpl-slide-remove",
        "icon-btn danger",
        idx,
        (deck.slides.length <= 2 || busy ? "disabled " : "") + 'aria-label="删除本页" title="删除本页"',
      ) +
      "</div></div>" +
      '<div class="tpl-preview-box" id="tpl-live-box"><div class="tpl-stage-scaler" id="tpl-live-scaler">' +
      TemplateVideo.renderFrameHtml(deck, idx, { subtitleText: subText }) +
      "</div>" +
      (busy
        ? '<div class="tpl-media-busy" role="status"><span class="picture-busy"><span class="spinner" aria-hidden="true"></span>正在生成第 ' + (idx + 1) + ' 页卡片配图…</span></div>'
        : "") +
      "</div>" +
      slideErrorHtml +
      cueStripHtml +
      '<div class="tpl-image-panel" data-tpl-dropzone="' + idx + '">' +
      '<div class="tpl-image-panel-head">' +
      '<div class="tpl-image-meta"><span class="shot-badge">第 ' + (idx + 1) + ' 页卡片图</span><span class="small">' +
      escFn(slideOriginLabel(slide)) +
      "</span></div>" +
      '<div class="buttons">' +
      btnFn(
        slide.contentImage ? "重新生成这张图" : "AI 生成这张图",
        "tpl-reimage",
        slide.contentImage ? "outline" : "primary",
        idx,
        busy ? "disabled" : "",
      ) +
      '<label class="outline tpl-upload-btn' + (busy ? " is-disabled" : "") + '">' +
      '上传本地图<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="slide-image" data-tpl-slide="' + idx + '"' + (busy ? " disabled" : "") + " hidden></label>" +
      (slide.contentImage ? btnFn("切回文字排版卡", "tpl-clear-image", "textbtn", idx, busy ? "disabled" : "") : "") +
      "</div></div>" +
      '<label class="field" style="margin-top:10px">卡片配图描述（AI 重新生成本页右侧信息图时使用，也支持拖入本地图）' +
      '<textarea rows="2" maxlength="400" class="autogrow" data-tpl-slide="' + idx + '" data-tpl-field="imagePrompt" placeholder="例如：左右双栏对比图，顶部大标题……左侧……右侧……，底部提示条……">' +
      escFn(slide.imagePrompt || "") +
      "</textarea></label></div>" +
      '<div class="tpl-slide-form">' +
      '<div class="tpl-two-col">' +
      '<label class="field">本页页签标题<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-field="name" value="' + escFn(slide.name || "") + '" placeholder="用于上方页签切换"></label>' +
      '<label class="field">对应顶部章节<select data-tpl-slide="' + idx + '" data-tpl-chapter-idx="1">' +
      deck.chapters.map((ch, ci) =>
        '<option value="' + ci + '"' + (Number(slide.chapterIndex) === ci ? " selected" : "") + ">" + escFn(ch || `章节${ci + 1}`) + "</option>"
      ).join("") +
      "</select></label>" +
      "</div>" +
      '<div><div class="field-head"><label class="label" for="tpl-line-' + idx + '">本页口播台词（自动配音与切分明黄高亮字幕）</label>' +
      '<span class="pace" id="tpl-pace-' + idx + '">' + escFn(pace.label) + "</span></div>" +
      '<textarea id="tpl-line-' + idx + '" rows="3" maxlength="360" data-tpl-slide="' + idx + '" data-tpl-field="line">' +
      escFn(slide.line || "") +
      "</textarea></div>" +
      '<label class="field">字幕明黄高亮关键词（用中文顿号「、」或空格分隔）' +
      '<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-joined="highlightWords" value="' +
      escFn((slide.highlightWords || []).join("、")) +
      '" placeholder="例如：对乙酰氨基酚、布洛芬、交替"></label>' +
      '<details class="shot-options"' + (slide.contentImage ? "" : " open") + "><summary>" +
      (slide.contentImage ? "编辑文字排版卡备选内容（未用图片时展示）" : "编辑当前文字排版卡内容") +
      "</summary>" +
      renderFallbackFieldsHtml(slide, idx, escFn) +
      "</details>" +
      "</div></div>" +

      /* Sheet 2: Global Parameters (shared across all slides, aligned with 科普视频参数模板.html) */
      '<div class="sheet">' +
      '<div class="card-head"><h2>全片级参数（整条视频共用）</h2><span class="small">修改后自动同步到全部页面</span></div>' +
      '<label class="field">左上内容主标题<input maxlength="40" data-tpl-global="title" value="' + escFn(deck.title) + '"></label>' +
      '<div class="tpl-chapter-inputs">' +
      [0, 1, 2, 3].map((ci) =>
        '<label class="field">顶部章节 ' + (ci + 1) + '<input maxlength="8" data-tpl-chap="' + ci + '" value="' + escFn(deck.chapters[ci] || "") + '"></label>'
      ).join("") +
      "</div>" +
      '<div class="dividerline"></div>' +
      '<div class="formrow"><span class="label">药师权威名片</span><div class="tpl-profile-grid">' +
      '<label class="field">姓名<input maxlength="16" data-pharm="name" value="' + escFn(p.name) + '"></label>' +
      '<label class="field">职称<input maxlength="16" data-pharm="role" value="' + escFn(p.role) + '"></label>' +
      '<label class="field">医院 / 科室<input maxlength="24" data-pharm="hospital" value="' + escFn(p.hospital) + '"></label>' +
      "</div>" +
      (deck.presenter === "digital"
        ? '<div class="tpl-avatar-upload">' +
          '<img class="tpl-avatar-thumb" src="' + escFn(avatarPreview) + '" alt="" />' +
          '<label class="outline tpl-upload-btn">' +
          '上传医生肖像替换圆框<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="avatar" hidden></label>' +
          (p.avatarImage ? btnFn("恢复默认肖像", "tpl-reset-avatar", "textbtn") : "") +
          "</div>"
        : "") +
      "</div>" +
      '<label class="field" style="margin-top:12px">免责声明（显示在左侧主讲区下方）' +
      '<input maxlength="60" data-tpl-global="disclaimer" value="' + escFn(deck.disclaimer || "") + '" placeholder="例如：科普内容仅供参考，具体诊疗与用药请遵医嘱"></label>' +
      "</div>"
    );
  }

  function templateEditorAsideHtml(w, dataStore, escFn, btnFn, savedLabelFn) {
    const deck = buildDeckForWork(w, dataStore);
    const s = w.settings;
    const music = s.music ?? defaults.music;
    const themeObj = TemplateVideo.THEMES.find((t) => t.id === deck.theme);
    const presObj = TemplateVideo.PRESENTERS.find((p) => p.id === deck.presenter);
    const total = deck.slides.length;
    const withImage = deck.slides.filter((sl) => Boolean(sl.contentImage)).length;
    const missingCount = deck.slides.filter((sl) => !sl.contentImage && !sl.job).length;
    const pendingImages = deck.slides.some((sl) => sl.job && !sl.job.error);
    const failedImages = deck.slides.filter((sl) => sl.job?.error).length;
    const pills = [
      "16:9 1280×720",
      themeObj ? themeObj.name : "医疗白蓝风",
      "槽位：" + (presObj ? presObj.name : "数字人"),
      s.voice,
      music === "off" ? musicLabels.off : `配乐 · ${musicLabels[music]}`,
      "预计 " + videoTotalSeconds(w) + " 秒",
      ...(w.drug ? ["药品：" + w.drug] : []),
    ];
    const busy = exportingWorkId === w.id || pendingImages;
    const imageSummary = `卡片信息图 ${withImage} / ${total}` +
      (pendingImages ? " · 生成中…" : "") +
      (failedImages ? ` · ${failedImages} 张失败` : "");

    return (
      '<div class="sheet"><div class="card-head"><h2>模板视频合成</h2><span class="status-pill">信息图模板</span></div>' +
      '<div class="summary-kv">' +
      pills.map((p) => '<span class="pill">' + escFn(p) + "</span>").join("") +
      "</div>" +
      '<div class="mode-box" style="margin-top:10px">右侧卡片支持 AI 生成或上传 884×544 信息图，也可用文字排版卡直接成片；合成 MP4 <b>无需视频模型费用</b>。</div>' +
      '<div class="storyboard-progress stack-actions">' +
      '<p class="small" id="tpl-image-progress" role="status">' + escFn(imageSummary) + "</p>" +
      (missingCount > 0
        ? btnFn(`一键生成缺失卡片图（${missingCount} 张）`, "tpl-fill-images", "secondary widebtn", "", pendingImages ? "disabled" : "")
        : "") +
      btnFn("全部卡片重新生成配图", "tpl-restyle-images", "outline widebtn", "", pendingImages ? "disabled" : "") +
      "</div>" +
      '<div style="margin-top:10px">' +
      btnFn("调整模型与配音参数", "work-settings", "outline widebtn") +
      "</div>" +
      '<div class="dividerline"></div><div class="stack-actions">' +
      btnFn(
        exportingWorkId === w.id ? "正在渲染高清模板帧..." : pendingImages ? "等待卡片配图完成..." : "合成模板视频 MP4",
        "tpl-compose",
        "primary widebtn",
        "",
        busy ? "disabled" : "",
      ) +
      (w.video && !w.videoDirty ? btnFn("查看已合成视频", "view-draft", "secondary widebtn") : "") +
      "</div>" +
      '<p class="tpl-export-status" id="tpl-export-status" role="status"></p>' +
      '<p class="footmeta save-state" id="save-state">' + savedLabelFn(w) + "</p></div>"
    );
  }

  function refreshLivePreview(w, dataStore) {
    const scaler = document.getElementById("tpl-live-scaler");
    if (!scaler || !isTemplateVideo(w)) return;
    const deck = buildDeckForWork(w, dataStore);
    const idx = getSlideIndex(w);
    const slide = deck.slides[idx];
    const chunks = TemplateVideo.splitSubtitleChunks(slide.line, 22);
    const cueIdx = Math.min(getCueIndex(w), Math.max(0, chunks.length - 1));
    const subText = chunks[cueIdx] ? chunks[cueIdx].text : slide.line || "";
    scaler.innerHTML = TemplateVideo.renderFrameHtml(deck, idx, { subtitleText: subText });
    const cueStrip = document.getElementById("tpl-cue-strip");
    if (cueStrip) {
      if (chunks.length > 1) {
        cueStrip.hidden = false;
        cueStrip.innerHTML =
          '<span class="small">字幕分句预览（共 ' + chunks.length + ' 句）：</span>' +
          chunks.map((_, ci) =>
            '<button type="button" class="chip' + (ci === cueIdx ? " selected" : "") + '" data-action="tpl-cue" data-val="' + ci + '">第 ' + (ci + 1) + " 句</button>"
          ).join("");
      } else {
        cueStrip.hidden = true;
        cueStrip.innerHTML = "";
      }
    }
    fitTemplatePreviews();
  }

  function fitTemplatePreviews() {
    const liveBox = document.getElementById("tpl-live-box");
    const liveScaler = document.getElementById("tpl-live-scaler");
    if (liveBox && liveScaler && liveBox.offsetWidth > 0) {
      liveScaler.style.transform = `scale(${liveBox.offsetWidth / 1280})`;
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
    const { index, mode, prompt, imageModel, imageSize } = imageModalState;
    const slide = deck.slides[index];
    if (!slide) return;
    const cfg = hooks.config;
    const models = Object.entries(cfg.imageModels).map(([id, spec]) => [id, spec[0]]);
    const isArk = mode === "ark";
    const themeLabel = deck.theme === "warm" ? "暖色手绘风" : "医疗白蓝风";

    let body =
      hooks.modeSegment(mode, "tpl-regen-mode") +
      (isArk ? hooks.arkKeyWarning("tpl-regen-mode") : "") +
      '<label class="field">卡片画面与文字描述（选填，留空自动按本页要点构思）' +
      '<textarea id="tpl-image-prompt" rows="3" maxlength="400" placeholder="例如：左右双栏对比科普图，标题……，左栏……，右栏……，底部提示条……">' +
      hooks.esc(prompt) +
      "</textarea></label>";

    if (isArk) {
      const fullPrompt = TemplateVideo.buildCardImagePrompt(deck, index, prompt, w.drug);
      body +=
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
        '」，生成 16:9 带中文字科普信息图并填入右侧 884×544 卡片槽位，按方舟实际用量计费。</p>' +
        '<div style="margin-top:14px">' +
        hooks.btn(
          "确认用方舟生成 1 张",
          "tpl-regen-ark",
          "primary widebtn",
          index,
          cfg.keyPresent ? "" : "disabled",
        ) +
        "</div>";
    } else {
      body +=
        '<div class="formrow" style="margin-top:12px"><span class="label">选用内置示例信息图（点击即刻替换）</span>' +
        '<div class="tpl-demo-grid">' +
        TemplateVideo.SAMPLE_INFOGRAPHICS.map((item) =>
          '<button type="button" class="tpl-demo-opt' +
          (slide.contentImage === item.src ? " selected" : "") +
          '" data-action="tpl-pick-demo-img" data-val="' +
          hooks.esc(`${index}|${item.src}`) +
          '"><img src="' +
          hooks.esc(item.src) +
          '" alt=""><span>' +
          hooks.esc(item.label) +
          "</span></button>"
        ).join("") +
        "</div></div>" +
        '<div style="margin-top:12px">' +
        hooks.btn("本地演示生成（保存描述并自动配图）", "tpl-regen-demo", "secondary widebtn", index) +
        "</div>";
    }

    hooks.openModal(
      `第 ${index + 1} 页「${slide.name || slide.headline || "卡片"}」· ${slide.contentImage ? "重新生成配图" : "AI 生成卡片配图"}`,
      body,
      "tpl-reimage",
    );
  }

  function openImageDialog(w, slideIndex, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    if (!slide || (slide.job && !slide.job.error)) return;
    imageModalState = {
      index: slideIndex,
      mode: w.settings.mode,
      prompt: slide.imagePrompt || "",
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
        preview.value = TemplateVideo.buildCardImagePrompt(deck, imageModalState.index, value, w.drug);
      }
      return true;
    }
    if (kind === "mode") {
      imageModalState.mode = value;
      renderImageDialog(w, hooks);
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

  function buildSlideImagePayload(w, deck, slideIndex, rawPrompt, settings, hooks) {
    const slide = deck.slides[slideIndex];
    const fullPrompt = TemplateVideo.buildCardImagePrompt(deck, slideIndex, rawPrompt, w.drug);
    const pool = TemplateVideo.SAMPLE_INFOGRAPHICS;
    const fallback = pool[(slideIndex + (slide.variant || 0)) % pool.length]?.src || "/assets/template-info-fever.jpg";
    const payload = {
      id: crypto.randomUUID(),
      mode: settings.mode,
      kind: "images",
      template: true,
      styleReference: false,
      settings: { ...settings, ratio: "16:9" },
      style: w.style || 0,
      items: [
        {
          prompt: fullPrompt,
          variant: (slide.variant || 0) + slideIndex + 1,
          fallbackImage: fallback,
        },
      ],
    };
    if (hooks.config?.workCosts) payload.workId = w.id;
    return payload;
  }

  async function pollSlideJob(w, slide, hooks) {
    const job = slide.job;
    if (!job || job.error || submittingJobs.has(job.payload.id) || pollingJobs.has(job.payload.id)) return;
    pollingJobs.add(job.payload.id);
    try {
      while (slide.job === job && !job.error) {
        try {
          const result = await hooks.jsonRequest("/api/jobs/" + job.payload.id);
          if (slide.job !== job) return;
          if (result.status === "failed") {
            throw new Error(result.error || "生成卡片配图失败");
          }
          if (result.status === "done") {
            const url = result.output?.images?.[0] || "";
            if (url) {
              slide.contentImage = url;
              slide.imageSource = job.payload.mode === "ark" ? "ark" : "preset";
              slide.imageModel = job.payload.mode === "ark" ? job.payload.settings.imageModel : "";
              slide.imageSize = job.payload.mode === "ark" ? job.payload.settings.imageSize : "";
              if (job.rawPrompt !== undefined) slide.imagePrompt = job.rawPrompt;
              slide.variant = (slide.variant || 0) + 1;
            }
            slide.job = null;
            syncBlocksFromDeck(w);
            if (w.video) w.videoDirty = true;
            hooks.changed(w);
            if (hooks.current() === w) {
              hooks.render(true);
              hooks.notify("卡片配图已更新", "ok");
            }
            return;
          }
        } catch (err) {
          if (slide.job !== job) return;
          job.error = err.message || "卡片配图生成失败";
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

  async function sendSlideJob(w, slide, hooks) {
    const job = slide.job;
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
      if (slide.job === job) {
        job.error = err.message || "提交生图任务失败";
        hooks.changed(w);
        if (hooks.current() === w) hooks.render(true);
      }
    } finally {
      submittingJobs.delete(id);
    }
    if (slide.job === job && !job.error) {
      pollSlideJob(w, slide, hooks);
    }
  }

  async function startSlideImageJob(w, slideIndex, rawPrompt, settings, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    if (!slide || (slide.job && !slide.job.error)) return;
    slide.imagePrompt = String(rawPrompt ?? slide.imagePrompt ?? "").trim();
    const payload = buildSlideImagePayload(w, deck, slideIndex, slide.imagePrompt, settings, hooks);
    slide.job = { target: "tpl-image", payload, rawPrompt: slide.imagePrompt };
    await sendSlideJob(w, slide, hooks);
  }

  function queueBatchSlideImages(w, slideIndices, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const targets = slideIndices.filter((i) => deck.slides[i] && !(deck.slides[i].job && !deck.slides[i].job.error));
    if (!targets.length) return;
    const isArk = w.settings.mode === "ark";
    const run = () => {
      for (const si of targets) {
        startSlideImageJob(w, si, deck.slides[si].imagePrompt || "", w.settings, hooks);
      }
    };
    if (!isArk) {
      run();
      return;
    }
    hooks.authorize({ ...w, settings: { ...w.settings, ratio: "16:9" } }, targets.length, "images", run);
  }

  function resumeSlideJobs(w, hooks) {
    if (!isTemplateVideo(w) || !w.templateDeck?.slides) return;
    for (const slide of w.templateDeck.slides) {
      if (slide.job && !slide.job.error) {
        pollSlideJob(w, slide, hooks);
      }
    }
  }

  function retrySlideImage(w, slideIndex, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    if (!slide?.job) return;
    const payload = slide.job.payload;
    if (payload.mode === "ark") {
      hooks.authorize({ ...w, settings: payload.settings }, 1, "images", () => sendSlideJob(w, slide, hooks));
    } else {
      sendSlideJob(w, slide, hooks);
    }
  }

  function abortSlideImage(w, slideIndex, hooks) {
    const deck = buildDeckForWork(w, hooks.data);
    const slide = deck.slides[slideIndex];
    if (!slide?.job) return;
    slide.job = null;
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
    if (deck.slides[rawIdx]?.job || deck.slides[nextIdx]?.job) return;
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
    if (deck.slides[idx]?.job) return;
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
    } else if ((targetKind === "slide-image" || targetKind === "cover") && w?.templateDeck) {
      const idx = Number.isInteger(slideIndex) ? slideIndex : getSlideIndex(w);
      const slide = w.templateDeck.slides[idx];
      if (slide) {
        slide.contentImage = url;
        slide.imageSource = "upload";
        slide.imageModel = "";
        slide.imageSize = "";
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
    if (deck.slides.some((s) => s.job && !s.job.error)) {
      hooks.notify("请等待卡片配图生成完成", "warn");
      return;
    }
    if (w.job || exportingWorkId) return;

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
        for (let si = 0; si < deck.slides.length; si++) {
          const slide = deck.slides[si];
          setStatus(`正在导出第 ${si + 1} / ${deck.slides.length} 页 1280×720 模板画面...`);
          const chunks = TemplateVideo.splitSubtitleChunks(slide.line, 22);
          const cueList = chunks.length ? chunks : [{ text: slide.line || "", weight: 1 }];
          const cues = [];
          for (let ci = 0; ci < cueList.length; ci++) {
            const pngDataUrl = await TemplateVideo.exportSlideCuePng(deck, si, cueList[ci].text);
            const uploadedUrl = await uploadDataUrl(pngDataUrl);
            cues.push({ image: uploadedUrl, weight: cueList[ci].weight });
          }
          if (si === 0 && cues[0] && w.blocks[0]) {
            w.blocks[0].image = cues[0].image; // Clean 16:9 poster for player & works card
          }
          items.push({
            line: slide.line.trim(),
            seconds: Math.max(4, Number(slide.seconds) || recommendedShotSeconds(spokenChars(slide.line))),
            cues,
          });
        }
        setStatus("画面已就绪，正在后台合成配音与 MP4...");
        const payload = {
          id: crypto.randomUUID(),
          mode: w.settings.mode,
          kind: "video",
          template: true,
          settings: {
            ...w.settings,
            ratio: "16:9",
            music: hooks.videoMusic(w),
          },
          style: w.style || 0,
          items,
        };
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

    const usesSpeech = w.settings.voice !== "无配音";
    if (usesSpeech) {
      if (!hooks.speechKeyPresent) {
        hooks.openApiKeys("speech");
        return;
      }
      hooks.authorizeSpeechOnly(w, deck.slides.length, runSynthesis);
    } else {
      await runSynthesis();
    }
  }

  window.addEventListener("resize", fitTemplatePreviews);

  global.TemplateStudio = {
    isTemplateVideo,
    ensurePharmacist,
    getSlideIndex,
    setSlideIndex,
    getCueIndex,
    setCueIndex: (w, idx) => cueSelection.set(w, idx),
    slideImageState,
    syncBlocksFromDeck,
    buildDeckForWork,
    installTemplateDeck,
    templateSampleCardsHtml,
    modeSwitcherHtml,
    templateSetupHtml,
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
