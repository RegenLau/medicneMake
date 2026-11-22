"use strict";

const StudioRecreate = (() => {
  const POINT_LABELS = {
    cover: "开场钩子",
    explain: "原理解析",
    compare: "对错对比",
    steps: "分步操作",
    timeline: "时间间隔",
    warning: "风险警示",
    checklist: "核对清单",
    summary: "权威收口",
  };
  const KIND_LABELS = {
    scene: "代码动效场景",
    svg: "SVG 动画",
    image: "AI 完整图",
  };
  const TRANS_LABELS = {
    fade: "柔和淡入",
    slide: "轻推左移",
    "zoom-in": "微幅推进",
    "zoom-out": "微幅拉远",
    wipe: "柔和擦除",
    "push-left": "左推切换",
    "slide-up": "上滑揭示",
    "wipe-up": "自下擦除",
    blur: "柔焦过渡",
    iris: "圆形展开",
  };

  let historyItems = [];
  let active = null;
  let loadingList = false;
  let uploading = false;
  let generating = false;
  let shotNotes = {};
  let draftForm = { title: "", notes: "", transcript: "", targetTopic: "", targetDrug: "" };

  function fmtClock(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function layoutLabel(id) {
    const found = (config?.stageLayouts || []).find((x) => x.id === id);
    return found ? found.name : (id || "信息图模板").replace(/^builtin:layout\//, "");
  }

  function themeLabel(id) {
    const found = (config?.stageThemes || []).find((x) => x.id === id);
    return found ? found.name : (id || "医疗白蓝风").replace(/^builtin:theme\//, "");
  }

  function hydrateDraftFromActive() {
    shotNotes = {};
    if (!active) {
      draftForm = { title: "", notes: "", transcript: "", targetTopic: "", targetDrug: "" };
      return;
    }
    draftForm = {
      title: active.title || "",
      notes: active.notes || "",
      transcript: active.transcript || "",
      targetTopic: active.targetTopic || "",
      targetDrug: active.targetDrug || "",
    };
    for (const sh of active.shots || []) {
      shotNotes[String(sh.index)] = sh.note || "";
    }
  }

  async function refreshHistory({ selectFirst = false } = {}) {
    loadingList = true;
    try {
      const res = await jsonRequest("/api/recreate/list");
      historyItems = Array.isArray(res?.items) ? res.items : [];
      if (active) {
        const updated = historyItems.find((x) => x.id === active.id);
        if (updated) active = updated;
      } else if (selectFirst && historyItems.length) {
        active = historyItems[0];
        hydrateDraftFromActive();
      }
    } catch (err) {
      notify(err.message || "读取拆解历史失败");
    } finally {
      loadingList = false;
      renderPage();
    }
  }

  async function handleFileUpload(file) {
    if (!file || uploading) return;
    if (file.size > 80 * 1024 * 1024) {
      notify("参考视频大小请控制在 80 MB 以内");
      return;
    }
    uploading = true;
    renderPage();
    try {
      const res = await fetch("/api/recreate/upload", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name || "reference.mp4"),
        },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "参考视频解析失败");
      active = data.item;
      hydrateDraftFromActive();
      historyItems = [active, ...historyItems.filter((x) => x.id !== active.id)];
      notify(`已自动切分 ${(active.shots || []).length} 个参考镜头并抽取关键帧`);
    } catch (err) {
      notify(err.message || "参考视频上传解析失败");
    } finally {
      uploading = false;
      renderPage();
    }
  }

  async function runBlueprint() {
    if (generating) return;
    if (!config?.deepseekKeyPresent) {
      openApiKeys("deepseek");
      return;
    }
    if (!active && !draftForm.notes.trim() && !draftForm.transcript.trim()) {
      notify("请先上传参考视频，或填写参考画面特点/口播文案");
      return;
    }
    generating = true;
    renderPage();
    try {
      const textModel = typeof resolveTextModel === "function" ? resolveTextModel(data.settings) : "";
      const res = await jsonRequest("/api/recreate/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(active?.id ? { id: active.id } : {}),
          title: draftForm.title.trim(),
          notes: draftForm.notes.trim(),
          transcript: draftForm.transcript.trim(),
          targetTopic: draftForm.targetTopic.trim(),
          targetDrug: draftForm.targetDrug.trim(),
          shotNotes,
          ...(textModel ? { textModel } : {}),
        }),
      });
      active = res.item;
      hydrateDraftFromActive();
      historyItems = [active, ...historyItems.filter((x) => x.id !== active.id)];
      notify("已生成 Motion.md 拆解蓝图，可直接套用新建科普视频");
    } catch (err) {
      notify(err.message || "拆解蓝图生成失败");
    } finally {
      generating = false;
      renderPage();
    }
  }

  async function removeRecord(id) {
    try {
      await jsonRequest("/api/recreate/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      historyItems = historyItems.filter((x) => x.id !== id);
      if (active?.id === id) {
        active = historyItems[0] || null;
        hydrateDraftFromActive();
      }
      notify("已删除拆解记录");
    } catch (err) {
      notify(err.message || "删除失败");
    }
    renderPage();
  }

  function downloadText(filename, content) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`已复制${label}`);
    } catch {
      notify("复制失败，请手动选中复制");
    }
  }

  function renderTimelineHtml() {
    if (!active?.shots?.length) return "";
    const meta = active.meta || {};
    const pills = [
      `${meta.width || 1280}×${meta.height || 720}`,
      meta.aspect || "16:9",
      `总时长 ${Number(meta.duration || 0).toFixed(1)}s`,
      `${active.shots.length} 幕切分`,
    ];
    return `<section class="recreate-panel">
      <div class="recreate-panel-head">
        <div>
          <h3>自动镜头切分与关键帧</h3>
          <p class="small">FFmpeg 已自动识别镜头切点并抽取每幕代表帧；可顺手在帧下方补一句观察笔记，帮助 AI 更准拆解。</p>
        </div>
        <div class="recreate-meta-pills">${pills.map((p) => `<span class="recreate-pill">${esc(p)}</span>`).join("")}</div>
      </div>
      <div class="recreate-frames-grid">
        ${active.shots.map((sh) => `<article class="recreate-frame-card">
          <div class="recreate-frame-img-wrap">
            ${sh.frameUrl ? `<img src="${esc(sh.frameUrl)}" alt="第 ${sh.index + 1} 幕关键帧" loading="lazy">` : '<div class="recreate-frame-empty">无缩略图</div>'}
            <span class="recreate-frame-time">#${sh.index + 1} · ${fmtClock(sh.start)}–${fmtClock(sh.end)} (${sh.seconds}s)</span>
          </div>
          <input type="text" class="recreate-shot-note" data-recreate-shot-note="${sh.index}" maxlength="240"
            value="${esc(shotNotes[String(sh.index)] || "")}"
            placeholder="可选：标注这一幕的画面特点（如：左药盒+右红叉对比）">
        </article>`).join("")}
      </div>
    </section>`;
  }

  function renderBlueprintHtml() {
    const bp = active?.blueprint;
    if (!bp) return "";
    const tags = (bp.styleTags || []).map((t) => `<span class="recreate-tag">${esc(t)}</span>`).join("");
    const portraitBox = bp.portraitLayoutDraft
      ? `<details class="recreate-details"><summary>查看 9:16 竖屏安全区布局草案 JSON（适合抖音/视频号/Shorts 拓展）</summary>
          <div class="recreate-code-actions">
            <button type="button" class="outline" data-recreate-copy-portrait>复制竖屏布局 JSON</button>
          </div>
          <pre class="recreate-md-pre">${esc(JSON.stringify(bp.portraitLayoutDraft, null, 2))}</pre>
        </details>`
      : "";
    return `<section class="recreate-panel recreate-result-panel">
      <div class="recreate-panel-head">
        <div>
          <h3>拆解蓝图 · ${esc(bp.title || active.title)}</h3>
          <div class="recreate-tags">${tags}</div>
        </div>
        <div class="recreate-result-actions">
          <button type="button" class="primary" data-recreate-apply>套用此节奏，新建科普视频</button>
          <button type="button" class="outline" data-recreate-copy-md>复制 Motion.md</button>
          <button type="button" class="outline" data-recreate-download-md>下载 .md</button>
        </div>
      </div>

      <div class="recreate-diagnosis-grid">
        <div class="recreate-diag-card">
          <span class="recreate-diag-label">开场吸睛（Hook）</span>
          <p>${esc(bp.hookStrategy || "—")}</p>
        </div>
        <div class="recreate-diag-card">
          <span class="recreate-diag-label">整体节奏</span>
          <p>${esc(bp.pacingSummary || "—")}</p>
        </div>
        <div class="recreate-diag-card">
          <span class="recreate-diag-label">视觉风格与适配方案</span>
          <p>${esc(bp.visualStyle || "—")}</p>
          <div class="recreate-match-row">
            <span class="recreate-pill">推荐布局：${esc(layoutLabel(bp.recommendedLayoutId))}</span>
            <span class="recreate-pill">推荐主题：${esc(themeLabel(bp.recommendedTheme))}</span>
          </div>
        </div>
      </div>

      <div class="recreate-shots-list">
        ${(bp.shots || []).map((sh, i) => `<article class="recreate-shot-row">
          <div class="recreate-shot-head">
            <strong>第 ${i + 1} 幕 · ${esc(sh.name)}</strong>
            <span class="recreate-pill">${sh.seconds}s</span>
            <span class="recreate-pill">${esc(POINT_LABELS[sh.pointType] || sh.pointType)}</span>
            <span class="recreate-pill">${esc(KIND_LABELS[sh.kind] || sh.kind)}</span>
            <span class="recreate-pill">转场：${esc(TRANS_LABELS[sh.transition] || sh.transition)}</span>
          </div>
          ${sh.narrationRole ? `<p class="recreate-shot-meta"><b>叙事作用：</b>${esc(sh.narrationRole)}</p>` : ""}
          ${sh.choreography ? `<p class="recreate-shot-meta"><b>GSAP 动效节奏：</b>${esc(sh.choreography)}</p>` : ""}
          ${sh.shotPrompt ? `<p class="recreate-shot-meta"><b>画面构思提示词：</b>${esc(sh.shotPrompt)}</p>` : ""}
          ${sh.sampleLine ? `<p class="recreate-shot-line"><b>参考口播：</b>${esc(sh.sampleLine)}</p>` : ""}
        </article>`).join("")}
      </div>

      <details class="recreate-details">
        <summary>查看完整 Motion.md 蓝图原文</summary>
        <pre class="recreate-md-pre">${esc(active.motionMd || "")}</pre>
      </details>
      ${portraitBox}
    </section>`;
  }

  function renderHistoryHtml() {
    if (loadingList && !historyItems.length) {
      return '<p class="small" role="status">正在读取历史拆解记录…</p>';
    }
    if (!historyItems.length) {
      return '<p class="small">暂无历史拆解记录。上传一条参考视频或输入爆款脚本笔记，即可沉淀为可复用节奏模板。</p>';
    }
    return `<div class="recreate-history-list">${historyItems.map((it) => {
      const thumb = it.shots?.find((s) => s.frameUrl)?.frameUrl || "";
      const isSelected = active?.id === it.id;
      const meta = it.meta || {};
      const shotCount = (it.blueprint?.shots || it.shots || []).length;
      return `<article class="recreate-history-item${isSelected ? " is-active" : ""}">
        <button type="button" class="recreate-history-main" data-recreate-select="${esc(it.id)}">
          ${thumb ? `<img class="recreate-history-thumb" src="${esc(thumb)}" alt="">` : '<span class="recreate-history-thumb is-text">MD</span>'}
          <span class="recreate-history-info">
            <strong>${esc(it.blueprint?.title || it.title || "参考拆解")}</strong>
            <small>${esc(meta.aspect || "16:9")} · ${shotCount} 幕 · ${it.blueprint ? "已生成蓝图" : "待拆解"}</small>
          </span>
        </button>
        <button type="button" class="textbtn recreate-history-del" data-recreate-delete="${esc(it.id)}" aria-label="删除拆解记录">删除</button>
      </article>`;
    }).join("")}</div>`;
  }

  function renderPage() {
    if (route()[0] !== "recreate") return;
    app.innerHTML = `<div class="recreate-shell">
      <div class="topline">
        <div>
          <h1>参考视频拆解 · Motion.md 工作台</h1>
          <p class="subtitle">上传一条爆款科普参考片（或粘贴脚本笔记），自动切分镜头节奏、生成可复用的 Motion.md 蓝图，并一键套用创建新的用药科普视频。</p>
        </div>
        <div class="recreate-top-btns">
          <button type="button" class="outline" data-recreate-new>新建空白拆解</button>
          ${btn("返回首页", "home", "secondary")}
        </div>
      </div>

      <div class="recreate-layout">
        <div class="recreate-main">
          <section class="recreate-panel">
            <div class="recreate-upload-zone${uploading ? " is-busy" : ""}" data-recreate-dropzone>
              <input type="file" id="recreate-video-input" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden>
              <div class="recreate-upload-copy">
                <strong>${uploading ? "正在用本地 FFmpeg 切分镜头并抽取关键帧…" : "拖拽参考视频到此处，或点击选择本地 MP4 / MOV / WebM"}</strong>
                <p class="small">上限 80 MB，全部在本机解析不上传第三方视频服务；抽取关键帧后自动清理大体积原片，仅保留关键帧与拆解蓝图。</p>
              </div>
              <button type="button" class="primary" data-recreate-pick ${uploading ? "disabled" : ""}>${uploading ? "解析中…" : "选择参考视频"}</button>
            </div>
          </section>

          ${renderTimelineHtml()}

          <section class="recreate-panel">
            <div class="recreate-panel-head">
              <div>
                <h3>拆解目标与补充笔记</h3>
                <p class="small">不上传视频也可直接粘贴爆款口播/画面笔记；填写「套用新主题」后，AI 会直接生成贴合新选题的合规示例口播与画面提示词。</p>
              </div>
            </div>
            <div class="recreate-form-grid">
              <label class="field">拆解模板名称
                <input type="text" data-recreate-field="title" maxlength="60" value="${esc(draftForm.title)}" placeholder="例如：丁香医生·误区反转三步节奏">
              </label>
              <label class="field">套用到新科普主题（选填）
                <input type="text" data-recreate-field="targetTopic" maxlength="120" value="${esc(draftForm.targetTopic)}" placeholder="例如：孩子发烧退烧药怎么吃才安全">
              </label>
              <label class="field">新视频关联药品（选填）
                <input type="text" data-recreate-field="targetDrug" maxlength="60" value="${esc(draftForm.targetDrug)}" placeholder="例如：对乙酰氨基酚片">
              </label>
              <label class="field recreate-span-all">参考视频的视觉/节奏特点（选填）
                <textarea data-recreate-field="notes" rows="2" maxlength="2000" placeholder="例如：前 3 秒红字强反差提问，中段左右对错对比，结尾底部药师提醒条收口">${esc(draftForm.notes)}</textarea>
              </label>
              <label class="field recreate-span-all">参考口播文案或分镜脚本（选填，不上传视频时必填其一）
                <textarea data-recreate-field="transcript" rows="3" maxlength="4000" placeholder="可粘贴参考视频的逐句口播，便于精准识别信息结构与转场节拍">${esc(draftForm.transcript)}</textarea>
              </label>
            </div>
            <div class="recreate-submit-row">
              <button type="button" class="primary" data-recreate-generate ${generating || uploading ? "disabled" : ""}>
                ${generating ? "DeepSeek 正在拆解节奏与生成 Motion.md…" : "生成 Motion.md 拆解蓝图"}
              </button>
              <span class="small">仅调用 1 次 DeepSeek 文本请求，按 Token 计费。</span>
            </div>
          </section>

          ${renderBlueprintHtml()}
        </div>

        <aside class="recreate-sidebar">
          <section class="recreate-panel">
            <h3>已拆解模板库（${historyItems.length}）</h3>
            ${renderHistoryHtml()}
          </section>
        </aside>
      </div>
    </div>`;
    bindEvents();
  }

  function bindEvents() {
    const fileInput = $("#recreate-video-input", app);
    const dropzone = $("[data-recreate-dropzone]", app);
    $("[data-recreate-pick]", app)?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) handleFileUpload(f);
    });
    if (dropzone) {
      dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
        const f = e.dataTransfer?.files?.[0];
        if (f) handleFileUpload(f);
      });
    }
    $("[data-recreate-new]", app)?.addEventListener("click", () => {
      active = null;
      hydrateDraftFromActive();
      renderPage();
    });
    $("[data-recreate-generate]", app)?.addEventListener("click", runBlueprint);
    $("[data-recreate-copy-md]", app)?.addEventListener("click", () => {
      if (active?.motionMd) copyText(active.motionMd, " Motion.md");
    });
    $("[data-recreate-download-md]", app)?.addEventListener("click", () => {
      if (!active?.motionMd) return;
      const slug = (active.blueprint?.title || active.title || "motion-blueprint").replace(/[\\/:*?"<>|\s]+/g, "-");
      downloadText(`${slug}.Motion.md`, active.motionMd);
    });
    $("[data-recreate-copy-portrait]", app)?.addEventListener("click", () => {
      if (active?.blueprint?.portraitLayoutDraft) {
        copyText(JSON.stringify(active.blueprint.portraitLayoutDraft, null, 2), " 9:16 竖屏布局草案 JSON");
      }
    });
    $("[data-recreate-apply]", app)?.addEventListener("click", () => {
      if (!active?.blueprint) return;
      if (typeof createWorkFromRecreateBlueprint === "function") {
        createWorkFromRecreateBlueprint(active, draftForm);
      }
    });
    for (const fieldEl of app.querySelectorAll("[data-recreate-field]")) {
      fieldEl.addEventListener("input", () => {
        draftForm[fieldEl.dataset.recreateField] = fieldEl.value;
      });
    }
    for (const noteEl of app.querySelectorAll("[data-recreate-shot-note]")) {
      noteEl.addEventListener("input", () => {
        shotNotes[noteEl.dataset.recreateShotNote] = noteEl.value;
      });
    }
    for (const selBtn of app.querySelectorAll("[data-recreate-select]")) {
      selBtn.addEventListener("click", () => {
        const found = historyItems.find((x) => x.id === selBtn.dataset.recreateSelect);
        if (found) {
          active = found;
          hydrateDraftFromActive();
          renderPage();
        }
      });
    }
    for (const delBtn of app.querySelectorAll("[data-recreate-delete]")) {
      delBtn.addEventListener("click", () => removeRecord(delBtn.dataset.recreateDelete));
    }
  }

  function page() {
    renderPage();
    refreshHistory({ selectFirst: !active });
  }

  return { page };
})();
