"use strict";

/* Workbench UI & synthesis glue for the 16:9 infographic template video mode. */
(function (global) {
  const cueSelection = new WeakMap();
  const slideSelection = new WeakMap();
  let exportingWorkId = null;

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
    slideSelection.set(w, idx);
    cueSelection.set(w, 0);
  }

  function getCueIndex(w) {
    return cueSelection.get(w) ?? 0;
  }

  function syncBlocksFromDeck(w) {
    if (!w.templateDeck) return;
    const slides = w.templateDeck.slides || [];
    w.title = w.templateDeck.title || w.title;
    w.blocks = slides.map((s, idx) => ({
      name: `${TemplateVideo.SLIDE_TYPES[s.type] || "讲解页"} · ${s.leftTop || "第 " + (idx + 1) + " 页"}`,
      line: s.line || "",
      seconds: Math.max(4, Number(s.seconds) || recommendedShotSeconds(spokenChars(s.line || ""))),
      image: s.image || "",
      prompt: s.spotPrompt || s.headline || "",
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
      w.templateDeck.theme = w.templateTheme || w.templateDeck.theme || "medical";
      w.templateDeck.presenter = w.templatePresenter || w.templateDeck.presenter || "digital";
      w.templateDeck.pharmacist = { ...pharmacist, ...(w.templateDeck.pharmacist || {}) };
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
      const slideIdx = idx === 0 ? 1 : 0; // Show comparison card for #1, warm cover for #2
      const frameHtml = TemplateVideo.renderFrameHtml(previewDeck, slideIdx);
      const badge = ex.theme === "warm" ? "模板讲解 · 暖色手绘" : "模板讲解 · 医疗白蓝";
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
        '</h3><div class="meta">用信息图模板创作 16:9 讲解视频</div></button>'
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
      '"><strong>信息图模板讲解 <span class="mode-badge">推荐</span></strong><span>左头像槽位（数字人/卡通/无形象）+ 右信息卡片 + 高亮字幕，16:9 成片快且零错字</span></button>' +
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
      '<div class="formrow"><span class="label">主讲人槽位（圆框免抠图）</span><div class="chips">' +
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
      '<div class="formrow"><span class="label">药师名片信息（自动带入片头与角标）</span><div class="tpl-profile-grid">' +
      '<label class="field">姓名<input maxlength="16" data-pharm="name" value="' +
      escFn(p.name) +
      '" placeholder="例如：李明远"></label>' +
      '<label class="field">医院 / 机构<input maxlength="24" data-pharm="hospital" value="' +
      escFn(p.hospital) +
      '" placeholder="例如：北京协和医院"></label>' +
      '<label class="field">职称<input maxlength="16" data-pharm="role" value="' +
      escFn(p.role) +
      '" placeholder="例如：主任药师"></label>' +
      "</div>" +
      (presenter === "digital"
        ? '<div class="tpl-avatar-upload">' +
          '<img class="tpl-avatar-thumb" src="' + escFn(avatarPreview) + '" alt="" />' +
          '<label class="outline" style="cursor:pointer;display:inline-flex;align-items:center;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600">' +
          '上传医生照片替换肖像<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="avatar" hidden></label>' +
          (p.avatarImage ? btnFn("恢复默认肖像", "tpl-reset-avatar", "textbtn") : "") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderSlideFieldsHtml(slide, idx, escFn) {
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
        '<label class="field">底部温和提示<input maxlength="120" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>' +
        '<div class="tpl-avatar-upload">' +
        '<label class="outline" style="cursor:pointer;display:inline-flex;align-items:center;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600">' +
        '替换封面局部插图<input type="file" accept="image/png,image/jpeg,image/webp" data-tpl-upload="cover" hidden></label>' +
        '<span class="small">建议使用纯白底无字医学小插图</span>' +
        "</div>";
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
            '<label class="field">适用角标<input maxlength="20" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="badge" value="' + escFn(col.badge || "") + '"></label>' +
            "</div>" +
            '<label class="field">要点列表（每行一条）<textarea rows="3" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="points">' + escFn(pts) + "</textarea></label>" +
            '<div class="tpl-two-col">' +
            '<label class="field">底栏标签<input maxlength="16" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="footLabel" value="' + escFn(col.footLabel || "") + '"></label>' +
            '<label class="field">底栏内容<input maxlength="36" data-tpl-slide="' + idx + '" data-tpl-col="' + ci + '" data-tpl-sub="footValue" value="' + escFn(col.footValue || "") + '"></label>' +
            "</div></div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部指南 / 说明书依据<input maxlength="140" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
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
            '<label class="field">红字强调<input maxlength="40" data-tpl-slide="' + idx + '" data-tpl-step="' + si + '" data-tpl-sub="key" value="' + escFn(st.key || "") + '"></label>' +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部 4 项自查标签（用中文顿号「、」分隔）<input maxlength="80" data-tpl-slide="' + idx + '" data-tpl-joined="checks" value="' + escFn(checks.join("、")) + '"></label>';
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
        '<label class="field">底部护理 / 避坑提醒<input maxlength="140" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    } else {
      const pts = Array.isArray(slide.points) ? slide.points : [];
      specific =
        '<div class="tpl-profile-grid">' +
        [0, 1, 2].map((pi) => {
          const item = pts[pi] || { title: "", desc: "" };
          return (
            '<div class="tpl-subcard"><span class="tpl-subcard-title">总结口诀 ' + (pi + 1) + "</span>" +
            '<label class="field">口诀标题<input maxlength="32" data-tpl-slide="' + idx + '" data-tpl-point="' + pi + '" data-tpl-sub="title" value="' + escFn(item.title || "") + '"></label>' +
            '<label class="field">补充说明<textarea rows="2" data-tpl-slide="' + idx + '" data-tpl-point="' + pi + '" data-tpl-sub="desc">' + escFn(item.desc || "") + "</textarea></label>" +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<label class="field">底部合规免责声明<input maxlength="120" data-tpl-slide="' + idx + '" data-tpl-field="footerNote" value="' + escFn(slide.footerNote || "") + '"></label>';
    }

    const chunks = TemplateVideo.splitSubtitleChunks(slide.line, 22);
    const currentCue = Math.min(getCueIndex(current()), Math.max(0, chunks.length - 1));

    return (
      '<div class="tpl-slide-form">' +
      '<div class="tpl-two-col">' +
      '<label class="field">本页主标题<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-field="headline" value="' + escFn(slide.headline || "") + '"></label>' +
      '<label class="field">标题变色强调短语<input maxlength="24" data-tpl-slide="' + idx + '" data-tpl-field="accentPhrase" value="' + escFn(slide.accentPhrase || "") + '" placeholder="填主标题中的一部分"></label>' +
      "</div>" +
      '<div class="tpl-two-col">' +
      '<label class="field">左侧上方短标题（≤7字）<input maxlength="18" data-tpl-slide="' + idx + '" data-tpl-field="leftTop" value="' + escFn(slide.leftTop || "") + '"></label>' +
      '<label class="field">左侧下方补充句（≤14字）<input maxlength="36" data-tpl-slide="' + idx + '" data-tpl-field="leftBottom" value="' + escFn(slide.leftBottom || "") + '"></label>' +
      "</div>" +
      specific +
      '<div class="dividerline"></div>' +
      '<label class="field">本页口播台词（自动配音与切分硬字幕）<textarea rows="3" maxlength="360" data-tpl-slide="' + idx + '" data-tpl-field="line">' + escFn(slide.line || "") + "</textarea></label>" +
      '<div class="tpl-two-col">' +
      '<label class="field">字幕高亮关键词（用中文顿号「、」分隔）<input maxlength="60" data-tpl-slide="' + idx + '" data-tpl-joined="highlightWords" value="' + escFn((slide.highlightWords || []).join("、")) + '"></label>' +
      '<label class="field">对应顶部章节<select data-tpl-slide="' + idx + '" data-tpl-chapter-idx="1">' +
      (current().templateDeck?.chapters || []).map((ch, ci) =>
        '<option value="' + ci + '"' + (Number(slide.chapterIndex) === ci ? " selected" : "") + ">" + escFn(ch) + "</option>"
      ).join("") +
      "</select></label>" +
      "</div>" +
      (chunks.length > 1
        ? '<div class="tpl-cue-strip"><span class="small">预览本页字幕分句：</span>' +
          chunks.map((c, ci) =>
            '<button type="button" class="chip' + (ci === currentCue ? " selected" : "") + '" data-action="tpl-cue" data-val="' + ci + '">第 ' + (ci + 1) + " 句</button>"
          ).join("") +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function templateEditorBodyHtml(w, dataStore, escFn) {
    const deck = buildDeckForWork(w, dataStore);
    const idx = getSlideIndex(w);
    const slide = deck.slides[idx];
    const chunks = TemplateVideo.splitSubtitleChunks(slide.line, 22);
    const cueIdx = Math.min(getCueIndex(w), Math.max(0, chunks.length - 1));
    const subText = chunks[cueIdx] ? chunks[cueIdx].text : slide.line || "";

    const switcherHtml =
      '<div class="scene-switcher" role="tablist" aria-label="模板页切换">' +
      deck.slides.map((s, si) =>
        '<button type="button" class="scene-choice" data-action="tpl-slide" data-val="' + si + '" aria-pressed="' + (si === idx) + '">' +
        '<div class="small">第 ' + (si + 1) + " 页 · " + escFn(TemplateVideo.SLIDE_TYPES[s.type] || "讲解页") + "</div>" +
        '<strong style="display:block;margin-top:3px;font-size:13px">' + escFn(s.leftTop || s.headline || "") + "</strong></button>"
      ).join("") +
      "</div>";

    return (
      '<div class="sheet">' +
      '<div class="tpl-preview-bar">' +
      '<div class="tpl-quick-group">' +
      TemplateVideo.THEMES.map((t) =>
        '<button type="button" class="chip' + (deck.theme === t.id ? " selected" : "") + '" data-action="tpl-theme" data-val="' + t.id + '">' + escFn(t.name) + "</button>"
      ).join("") +
      "</div>" +
      '<div class="tpl-quick-group">' +
      TemplateVideo.PRESENTERS.map((pr) =>
        '<button type="button" class="chip' + (deck.presenter === pr.id ? " selected" : "") + '" data-action="tpl-presenter" data-val="' + pr.id + '">' + escFn(pr.name) + "</button>"
      ).join("") +
      "</div></div>" +
      '<div class="tpl-preview-box" id="tpl-live-box"><div class="tpl-stage-scaler" id="tpl-live-scaler">' +
      TemplateVideo.renderFrameHtml(deck, idx, { subtitleText: subText }) +
      "</div></div></div>" +
      '<div class="sheet">' +
      '<div class="card-head"><h2>全局标题与顶部章节条</h2><span class="small">全片 ' + deck.slides.length + " 页 · 约 " + videoTotalSeconds(w) + " 秒</span></div>" +
      '<label class="field">顶部视频主标题<input maxlength="40" data-tpl-global="title" value="' + escFn(deck.title) + '"></label>' +
      '<div class="tpl-chapter-inputs">' +
      [0, 1, 2, 3].map((ci) =>
        '<label class="field">章节 ' + (ci + 1) + '<input maxlength="8" data-tpl-chap="' + ci + '" value="' + escFn(deck.chapters[ci] || "") + '"></label>'
      ).join("") +
      "</div></div>" +
      '<div class="sheet">' +
      '<div class="card-head"><h2>逐页内容与口播（修改后上方实时同步）</h2></div>' +
      switcherHtml +
      renderSlideFieldsHtml(slide, idx, escFn) +
      "</div>"
    );
  }

  function templateEditorAsideHtml(w, dataStore, escFn, btnFn, savedLabelFn) {
    const deck = buildDeckForWork(w, dataStore);
    const s = w.settings;
    const music = s.music ?? defaults.music;
    const themeObj = TemplateVideo.THEMES.find((t) => t.id === deck.theme);
    const presObj = TemplateVideo.PRESENTERS.find((p) => p.id === deck.presenter);
    const pills = [
      "16:9 1280×720",
      themeObj ? themeObj.name : "医疗白蓝风",
      "槽位：" + (presObj ? presObj.name : "数字人"),
      s.voice,
      music === "off" ? musicLabels.off : `配乐 · ${musicLabels[music]}`,
      "预计 " + videoTotalSeconds(w) + " 秒",
      ...(w.drug ? ["药品：" + w.drug] : []),
    ];
    const busy = exportingWorkId === w.id;
    return (
      '<div class="sheet"><div class="card-head"><h2>模板视频合成</h2><span class="status-pill">模板讲解</span></div>' +
      '<div class="summary-kv">' +
      pills.map((p) => '<span class="pill">' + escFn(p) + "</span>").join("") +
      "</div>" +
      '<div class="mode-box" style="margin-top:10px">由本地模板直接渲染 1280×720 高清画面与高亮硬字幕，<b>无需视频模型费用</b>；开启豆包配音时仅按口播字数结算语音费。</div>' +
      '<div style="margin-top:12px">' +
      btnFn("调整配音与配乐", "work-settings", "outline widebtn") +
      "</div>" +
      '<div class="dividerline"></div><div class="stack-actions">' +
      btnFn(
        busy ? "正在渲染高清模板帧..." : "合成模板视频 MP4",
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

  async function handleFileUpload(file, targetKind, w, dataStore, changedFn, renderFn, notifyFn) {
    if (!file) return;
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
    } else if (targetKind === "cover" && w?.templateDeck) {
      const cover = w.templateDeck.slides.find((s) => s.type === "cover");
      if (cover) {
        cover.image = url;
        syncBlocksFromDeck(w);
        if (w.video) w.videoDirty = true;
        changedFn(w);
        notifyFn("已更新封面局部插图", "ok");
        renderFn(true);
      }
    }
  }

  async function composeTemplateVideo(w, dataStore, hooks) {
    const deck = buildDeckForWork(w, dataStore);
    if (!deck.title.trim()) {
      hooks.notify("请先填写顶部视频主标题", "warn");
      return;
    }
    if (deck.slides.some((s) => !String(s.line || "").trim())) {
      hooks.notify("请补全每一页的口播台词", "warn");
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
          if (si === 0 && cues[0]) {
            w.blocks[0].image = cues[0].image; // Clean 16:9 poster for player
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
    handleFileUpload,
    composeTemplateVideo,
  };
})(window);
