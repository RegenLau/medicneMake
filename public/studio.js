"use strict";
const $ = (s, root = document) => root.querySelector(s);
const app = $("#app"),
  dialog = $("#dialog"),
  dialogBody = $("#dialog-body");

const styles = [
  "手绘动画风",
  "清新写实风",
  "科技数据风",
  "气泡讲解风",
  "玻璃拟态风",
  "3D质感风",
];

const examples = [
  "药盒上的有效期，应该怎么看？",
  "去药房咨询前，准备哪些信息？",
  "用药记录里，哪些信息值得记？",
  "看说明书时，哪里能找到答案？",
  "出门前，怎样整理随身药品？",
  "一起来认识药品的不同剂型",
];

const exampleLines = [
  [
    "拿到药盒时，你会先看哪里？",
    "找到标有“有效期”的位置，留意标注的年月或日期。",
    "把外盒和说明书放在一起，方便之后核对。",
    "日期模糊，或开封后保存时间不清楚时，带上包装问药师。",
  ],
  [
    "去药房咨询前，可以先整理几个问题。",
    "带上药品外盒或清晰的包装照片。",
    "记下正在使用的药品，以及最想问的事。",
    "向药师描述实际情况，核对你理解的答复。",
  ],
  [
    "想回顾自己的用药情况，可以从一条记录开始。",
    "先抄下外包装上的药名，核对是否完整。",
    "按实际情况记下时间和希望咨询的问题。",
    "就诊时带上记录，方便与医生或药师沟通。",
  ],
  [
    "打开药品说明书，先找到你想了解的栏目。",
    "核对药品名称、规格及手中的外包装。",
    "把尚未理解的词句圈出来，记下想问的问题。",
    "带着说明书向药师咨询，确认理解一致。",
  ],
  [
    "准备出门时，你的药品都整理好了吗？",
    "核对包装上的名称与储存条件。",
    "把药品清单和需要咨询的问题一起收好。",
    "遇到储存要求不明确的药品，出发前先问药师。",
  ],
  [
    "同一种药名，也可能有不同的剂型。",
    "从外包装和说明书上找到完整药品名称。",
    "核对剂型和规格，记录容易混淆的地方。",
    "关于使用方法的问题，带上实物与药师确认。",
  ],
];

const categories = [
  "慢病管理",
  "心脑血管",
  "内分泌代谢",
  "急诊安全",
  "消化系统",
  "家庭常备",
  "五官呼吸",
  "风湿免疫",
  "营养保健",
  "神经睡眠",
];

const drugs = [
  "阿托伐他汀钙片",
  "苯磺酸氨氯地平片",
  "盐酸二甲双胍缓释片",
  "布洛芬缓释胶囊",
  "对乙酰氨基酚片",
  "奥美拉唑肠溶胶囊",
  "氯雷他定片",
  "蒙脱石散",
  "左甲状腺素钠片",
  "阿莫西林胶囊",
  "玻璃酸钠滴眼液",
  "孟鲁司特钠咀嚼片",
];

const paths = {
  book: '<path d="M3 4.5c4-1 6-.7 9 1.5 3-2.2 5-2.5 9-1.5v14c-4-1-6-.6-9 1.5-3-2.1-5-2.5-9-1.5zM12 6v14"/>',
  film: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="m3 9 17-4M6 4l3 4m3-5 3 4m-4 5 4 2-4 3z"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  settings:
    '<path d="M3 6h5m4 0h9M3 12h10m4 0h4M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash:
    '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M4 19h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};

const ico = (key, cls = "icon") =>
  '<svg class="' +
  cls +
  '" viewBox="0 0 24 24" aria-hidden="true">' +
  paths[key] +
  "</svg>";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const asset = (i) => "/assets/style-" + (((i % 6) + 6) % 6) + ".webp";

const btn = (label, action, cls = "secondary", val = "", extra = "") =>
  '<button type="button" class="' +
  cls +
  '" data-action="' +
  action +
  '" data-val="' +
  esc(val) +
  '"' +
  (extra ? " " + extra : "") +
  ">" +
  label +
  "</button>";

const opts = (list, selected) =>
  list
    .map((x) => {
      const [v, l] = Array.isArray(x) ? x : [x, x];
      return (
        '<option value="' +
        esc(v) +
        '" ' +
        (v === selected ? "selected" : "") +
        ">" +
        esc(l) +
        "</option>"
      );
    })
    .join("");

const field = (label, key, options, value, wide = false) =>
  '<label class="field' +
  (wide ? " wide" : "") +
  '">' +
  label +
  '<select data-setting="' +
  key +
  '">' +
  opts(options, value) +
  "</select></label>";

const storeKey = "xixi-studio-v1";
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || {};
  } catch {
    return {};
  }
}

let data = loadState(),
  config,
  tab = "examples",
  filter = "全部",
  toastTimer,
  selectedTags = [],
  modalScope = null,
  modalType = null,
  regenModal = null,
  retryPayload = null,
  exampleCursor = 0;

const defaults = {
  mode: "ark",
  imageModel: "doubao-seedream-5-5-261028",
  imageSize: "2K",
  videoModel: "doubao-seedance-2-5-flash-261115",
  resolution: "720p",
  ratio: "9:16",
  duration: 30,
  watermark: true,
  voice: "女声",
};

data.settings = { ...defaults, ...data.settings };
data.works ||= [];
const watching = new Set();

// Resume image requests saved by previous sessions.
for (const w of data.works) {
  if (w.job?.target === "regenerate" && w.blocks?.[w.job.index]) {
    w.blocks[w.job.index].job = w.job;
    w.job = null;
  }
}

if (!data.arkDefaultApplied) {
  data.settings.mode = "ark";
  data.arkDefaultApplied = true;
  save();
}

function save() {
  localStorage.setItem(storeKey, JSON.stringify(data));
}

function notify(text) {
  const el = $("#notice");
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.textContent = "";
  }, 3400);
}

function navigate(target) {
  if (location.hash === "#" + target) render();
  else location.hash = target;
}

function route() {
  return decodeURIComponent(location.hash.slice(1) || "home").split("/");
}

function current() {
  return data.works.find((w) => w.id === route()[1]);
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60),
    s = Math.max(0, Math.round(sec % 60));
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function shotRanges(blocks) {
  let acc = 0;
  return blocks.map((b) => {
    const start = acc;
    acc += Number(b.seconds || 0);
    return fmtClock(start) + "–" + fmtClock(acc);
  });
}

function speechStats(text, seconds) {
  const chars = String(text || "").replace(/\s+/g, "").length;
  const est = chars ? Math.max(1, Math.round(chars / 4.2)) : 0;
  const over = seconds > 0 && chars > Math.round(seconds * 4.8);
  return {
    chars,
    est,
    over,
    label: !chars
      ? "待填写口播词"
      : over
        ? chars +
          " 字 · 约需 " +
          est +
          " 秒（超出 " +
          seconds +
          " 秒，合成将加速配音）"
        : chars + " 字 · 约 " + est + " 秒",
  };
}

function updateTopbar() {
  const gs = data.settings;
  const dotCls =
    gs.mode === "demo" ? "demo" : config?.keyPresent ? "" : "warn";
  const modeEl = $("#mode-indicator");
  if (modeEl) {
    modeEl.innerHTML =
      '<span class="dot ' +
      dotCls +
      '" aria-hidden="true"></span><span><span class="env-prefix">默认：</span>' +
      (gs.mode === "ark" ? "火山方舟" : "本地演示") +
      "</span>" +
      ico("settings");
  }
  const worksEl = $("#nav-works");
  if (worksEl) {
    worksEl.innerHTML =
      "我的作品" +
      (data.works.length
        ? ' <span class="count">' + data.works.length + "</span>"
        : "");
  }
}

function openModal(title, body, type = "generic") {
  modalType = type;
  dialogBody.innerHTML =
    '<div class="dialog-head"><h2>' +
    esc(title) +
    "</h2>" +
    btn(ico("close"), "close", "close", "", 'aria-label="关闭弹窗"') +
    "</div>" +
    body;
  if (!dialog.open) dialog.showModal();
}

function modeSegment(mode, actionName = "set-mode") {
  return (
    '<div class="seg" role="group" aria-label="生成方式">' +
    btn(
      "火山方舟 · 按量计费",
      actionName,
      "seg-btn" + (mode === "ark" ? " active" : ""),
      "ark",
      'aria-pressed="' + (mode === "ark") + '"',
    ) +
    btn(
      "本地演示 · 免费",
      actionName,
      "seg-btn" + (mode === "demo" ? " active" : ""),
      "demo",
      'aria-pressed="' + (mode === "demo") + '"',
    ) +
    "</div>"
  );
}

function arkKeyWarning(switchAction = "set-mode") {
  return !config.keyPresent
    ? '<div class="banner warn">未检测到 ARK_API_KEY，当前无法调用火山方舟。' +
      '<div class="banner-actions">' +
      btn("切换为本地演示（免费）", switchAction, "secondary", "demo") +
      "</div></div>"
    : "";
}

function settingsFields(s, which = "all", segAction = "set-mode") {
  const images = Object.entries(config.imageModels).map(([id, v]) => [
      id,
      v[0],
    ]),
    videos = Object.entries(config.videoModels).map(([id, v]) => [id, v[0]]);
  const isArk = s.mode === "ark";
  let h = modeSegment(s.mode, segAction);
  if (isArk) h += arkKeyWarning(segAction);

  h += '<div class="fields">';
  if (isArk) {
    h +=
      field("生图模型", "imageModel", images, s.imageModel, true) +
      field(
        "图片清晰度",
        "imageSize",
        config.imageModels[s.imageModel][1],
        s.imageSize,
      ) +
      field("画幅", "ratio", ["16:9", "3:4", "1:1", "9:16"], s.ratio);
    if (which !== "article") {
      h +=
        field("视频生成模型", "videoModel", videos, s.videoModel, true) +
        field(
          "视频分辨率",
          "resolution",
          config.videoModels[s.videoModel][1],
          s.resolution,
        ) +
        field("配音", "voice", ["女声", "男声", "无配音"], s.voice);
    }
    h += "</div>";
    h +=
      '<label class="switchline"><input type="checkbox" data-setting="watermark" ' +
      (s.watermark ? "checked" : "") +
      "><span>生成素材添加方舟水印</span></label>";
    if (config.keyPresent) {
      h +=
        '<p class="footmeta">已读取本机方舟 Key，仅在确认生成时按量计费。</p>';
    }
  } else {
    h += field(
      "画幅",
      "ratio",
      ["16:9", "3:4", "1:1", "9:16"],
      s.ratio,
      which === "article",
    );
    if (which !== "article") {
      h += field("配音", "voice", ["女声", "男声", "无配音"], s.voice);
    }
    h += "</div>";
    h +=
      '<div class="mode-box" style="margin-top:12px">使用内置示例图' +
      (which === "article"
        ? "生成可编辑图文草稿"
        : "与本机语音合成 480p 演示视频") +
      "，不消耗方舟额度。</div>";
  }
  return h;
}

function prefs(w) {
  modalScope = w?.id || "global";
  const s = w ? w.settings : data.settings;
  openModal(
    w ? "本作品生成参数" : "新作品默认参数",
    settingsFields(s, w ? w.type : "all", "modal-mode") +
      '<div style="margin-top:16px">' +
      btn("完成", "close", "primary widebtn") +
      "</div>",
    "settings",
  );
}

function newWork(type, example) {
  const id = crypto.randomUUID(),
    style = example ?? 0;
  const s = { ...data.settings };
  if (type === "article" && example == null && s.ratio === "9:16") {
    s.ratio = "16:9";
  }
  const w = {
    id,
    type,
    stage: "setup",
    title: "",
    topic: example == null ? "" : examples[style],
    layout: "通俗图解版",
    style,
    drug: "",
    tags: [],
    settings: s,
    blocks: [],
    created: Date.now(),
    updated: Date.now(),
    job: null,
  };
  data.works.unshift(w);
  save();
  navigate("work/" + id);
}

function stageName(w) {
  return w.job
    ? "生成中"
    : {
        setup: "待配置",
        script: "分镜草稿",
        draft: "成品草稿",
        review: "审核中",
      }[w.stage] || "草稿";
}

function home() {
  updateTopbar();
  const draftCount = data.works.filter((w) => w.stage !== "review").length;
  app.innerHTML =
    '<div class="topline"><h1>科普制作</h1>' +
    btn(
      ico("folder") +
        " 草稿箱" +
        (draftCount ? ' <span class="count">' + draftCount + "</span>" : ""),
      "drafts",
      "secondary",
    ) +
    '</div><div class="entry-grid">' +
    ["article", "video"]
      .map(
        (type, i) =>
          '<button type="button" class="entry' +
          (i ? " video" : "") +
          '" data-action="new" data-val="' +
          type +
          '"><span class="entry-symbol">' +
          ico(i ? "film" : "book") +
          "</span><h2>" +
          ["图文科普", "视频科普"][i] +
          "</h2><p>" +
          ["撰写文章、编辑段落与配图", "编写分镜、配音与合成视频"][i] +
          '</p><span class="jump">开始制作 ' +
          ico("arrow") +
          '</span><img alt="" src="/assets/entry-' +
          (i ? "video" : "article") +
          '.webp"></button>',
      )
      .join("") +
    '</div><div class="tabs" role="tablist" aria-label="内容切换">' +
    btn(
      "视频参考示例",
      "examples",
      "tab" + (tab === "examples" ? " active" : ""),
      "",
      'role="tab" aria-selected="' + (tab === "examples") + '"',
    ) +
    btn(
      '我的作品 <span class="count">' + data.works.length + "</span>",
      "works",
      "tab" + (tab === "works" ? " active" : ""),
      "",
      'role="tab" aria-selected="' + (tab === "works") + '"',
    ) +
    "</div>" +
    (tab === "examples"
      ? '<div class="gallery">' +
        styles
          .map(
            (s, i) =>
              '<button type="button" class="sample" data-action="sample" data-val="' +
              i +
              '"><div class="cover"><img src="' +
              asset(i) +
              '" alt="' +
              esc(s) +
              '示例封面"><span class="tag">' +
              s +
              '</span><span class="play">' +
              ico("arrow") +
              "</span></div><h3>" +
              examples[i] +
              '</h3><div class="meta">用这个风格创作视频</div></button>',
          )
          .join("") +
        "</div>"
      : worksList());
}

function worksList() {
  const counts = {
    全部: data.works.length,
    草稿: data.works.filter((w) => w.stage !== "review").length,
    审核中: data.works.filter((w) => w.stage === "review").length,
  };
  const list = data.works
    .filter(
      (w) =>
        filter === "全部" ||
        (filter === "审核中" ? w.stage === "review" : w.stage !== "review"),
    )
    .sort((a, b) => b.updated - a.updated);

  return (
    '<div class="flexwrap workFilters">' +
    ["全部", "草稿", "审核中"]
      .map((x) =>
        btn(
          x + " · " + counts[x],
          "filter",
          "chip" + (x === filter ? " selected" : ""),
          x,
        ),
      )
      .join("") +
    "</div>" +
    (list.length
      ? '<div class="gallery">' +
        list
          .map((w) => {
            const coverImg =
              w.blocks?.find((b) => b.image)?.image || asset(w.style || 0);
            const isVideo = w.type === "video";
            return (
              '<article class="work-card">' +
              '<button type="button" class="work-open" data-action="open" data-val="' +
              esc(w.id) +
              '"><div class="cover"><img alt="" src="' +
              esc(coverImg) +
              '"><span class="tag' +
              (w.stage === "review" ? " review" : "") +
              '">' +
              stageName(w) +
              "</span>" +
              (isVideo
                ? '<span class="play" aria-hidden="true">' +
                  ico("play") +
                  "</span>"
                : "") +
              "</div><h3>" +
              esc(w.title || w.topic || "未命名作品") +
              '</h3><div class="meta"><span>' +
              (isVideo
                ? "视频科普 · " + w.settings.duration + "秒"
                : "图文科普 · " + w.layout) +
              "</span>" +
              (w.drug ? '<span class="pill">' + esc(w.drug) + "</span>" : "") +
              "<span>" +
              new Date(w.updated).toLocaleDateString() +
              "</span></div></button>" +
              btn(
                ico("trash"),
                "ask-delete",
                "card-delete",
                w.id,
                'aria-label="删除作品" title="删除作品"',
              ) +
              "</article>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="empty"><h3>暂无' +
        (filter === "全部"
          ? "作品"
          : filter === "审核中"
            ? "审核中的作品"
            : "草稿") +
        '</h3><p>选择创作类型，立即开始一份用药科普。</p><div class="buttons" style="justify-content:center">' +
        btn(ico("book") + " 新建图文科普", "new", "primary", "article") +
        btn(ico("film") + " 新建视频科普", "new", "secondary", "video") +
        "</div></div>")
  );
}

function steps(w, activeIdx) {
  const vid = w.type === "video";
  const items = vid
    ? [
        { label: "设置主题", key: "setup", ok: !w.job && w.stage !== "review" },
        {
          label: "编辑分镜",
          key: "edit",
          ok: w.blocks.length > 0 && !w.job && w.stage !== "review",
        },
        {
          label: w.stage === "review" ? "作品审核中" : "成品与送审",
          key: "detail",
          ok: !!w.video && !w.job,
        },
      ]
    : [
        { label: "设置主题", key: "setup", ok: !w.job && w.stage !== "review" },
        {
          label: "编辑图文",
          key: "edit",
          ok: w.blocks.length > 0 && !w.job && w.stage !== "review",
        },
        {
          label: w.stage === "review" ? "作品审核中" : "成品与送审",
          key: "detail",
          ok: w.blocks.length > 0 && !!w.title?.trim() && !w.job,
        },
      ];

  return (
    '<ol class="stepbar" aria-label="制作步骤">' +
    items
      .map((item, j) => {
        const isNow = j === activeIdx;
        const isDone = j < activeIdx;
        const inner =
          (isDone
            ? ico("check")
            : '<span class="step-num">' +
              String(j + 1).padStart(2, "0") +
              "</span>") +
          "<span>" +
          item.label +
          "</span>";
        const cls =
          "step-item" + (isNow ? " now" : isDone ? " done" : "");
        const node =
          item.ok && !isNow
            ? btn(inner, "goto-step", cls, item.key)
            : '<span class="' +
              cls +
              '"' +
              (isNow ? ' aria-current="step"' : "") +
              ">" +
              inner +
              "</span>";
        return (
          "<li>" +
          (j > 0 ? ico("chevron", "icon step-sep") : "") +
          node +
          "</li>"
        );
      })
      .join("") +
    "</ol>"
  );
}

function shell(w, title, activeStep, html, rightHead = "") {
  updateTopbar();
  app.innerHTML =
    '<nav class="subnav" aria-label="工作台导航">' +
    btn(ico("back") + " 返回工作台", "home", "back") +
    rightHead +
    "</nav>" +
    '<div class="section-head"><h1>' +
    esc(title) +
    "</h1></div>" +
    steps(w, activeStep) +
    html;
  syncImageActions(w);
}

function choice(label, values, value, action) {
  return (
    '<div class="formrow"><span class="label">' +
    label +
    '</span><div class="flexwrap">' +
    values
      .map((x, i) =>
        btn(
          esc(x),
          action,
          "chip" + (x === value ? " selected" : ""),
          i,
          'aria-pressed="' + (x === value) + '"',
        ),
      )
      .join("") +
    "</div></div>"
  );
}

function setup(w) {
  const video = w.type === "video";
  const hasBlocks = w.blocks.length > 0;
  let left =
    '<div class="sheet"><div class="card-head"><h2>科普主题</h2>' +
    btn(w.topic.trim() ? "换个示例" : "填入示例", "fill", "textbtn") +
    '</div><div class="field-head"><label class="label" for="topic">你想讲解什么？</label><span class="small" id="chars">' +
    w.topic.length +
    ' / 300</span></div><textarea id="topic" data-bind="topic" maxlength="300" rows="4" placeholder="例如：教家人读懂药盒上的有效期、漏服降压药后怎么处理">' +
    esc(w.topic) +
    '</textarea><div class="dividerline"></div><div class="formrow"><span class="label">关联药品 <small>（选填）</small></span><div class="buttons">' +
    (w.drug
      ? '<span class="pill">' +
        esc(w.drug) +
        btn(
          ico("close"),
          "undrug",
          "pill-remove",
          "",
          'aria-label="移除关联药品"',
        ) +
        "</span>" +
        btn("更换药品", "drug", "textbtn")
      : btn("搜索或输入药品", "drug", "outline")) +
    "</div></div></div>";

  if (video) {
    left +=
      '<div class="sheet"><div class="card-head"><h2>视频设置</h2></div>' +
      choice("画面风格", styles, styles[w.style], "style") +
      choice(
        "目标总时长",
        ["30 秒", "45 秒", "60 秒", "90 秒", "120 秒"],
        w.settings.duration + " 秒",
        "duration",
      ) +
      choice(
        "出镜形象",
        ["无人物", "药师插画"],
        w.avatar || "无人物",
        "avatar",
      ) +
      "</div>";
  } else {
    left +=
      '<div class="sheet"><div class="card-head"><h2>文章排版</h2></div>' +
      choice(
        "内容风格",
        ["通俗图解版", "临床深度版", "避坑问答版"],
        w.layout,
        "layout",
      ) +
      "</div>";
  }

  const ctaArea = hasBlocks
    ? '<div class="stack-actions">' +
      btn(
        video ? "返回继续编辑分镜" : "返回继续编辑图文",
        "resume-edit",
        "primary widebtn",
      ) +
      btn(
        video ? "重新生成脚本与分镜" : "重新生成图文草稿",
        "regenerate-all",
        "secondary widebtn",
      ) +
      "</div>"
    : btn(
        video ? "生成脚本与分镜" : "生成图文草稿",
        "generate",
        "primary widebtn",
      );

  const right =
    '<div class="sheet"><div class="card-head"><h2>生成配置</h2></div>' +
    settingsFields(w.settings, w.type, "set-mode") +
    '<div class="dividerline"></div><div id="initial-generation">' +
    ctaArea +
    "</div></div>";

  shell(
    w,
    video ? "制作视频科普" : "制作图文科普",
    0,
    '<div class="layout"><div>' +
      left +
      '</div><aside class="aside">' +
      right +
      "</aside></div>",
    hasBlocks
      ? btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id)
      : "",
  );
  if (w.job?.target === "initial") updateJobView(w, w);
}

function seedBlocks(w) {
  const vid = w.type === "video",
    index = examples.indexOf(w.topic.trim());
  const lines =
    index >= 0
      ? exampleLines[index]
      : [
          "今天围绕“" + w.topic.trim() + "”整理几个需要核对的问题。",
          "先从药品外包装和说明书找到与主题相关的信息。",
          "记下尚未弄清的细节，把具体情形告诉药师。",
          "把核对过的信息记录下来，方便下次咨询。",
        ];
  w.title = w.topic.trim();
  w.lead =
    "围绕「" +
    w.title +
    "」，整理一份" +
    (w.layout === "避坑问答版" ? "便于核对的常见问答" : "给读者的药学阅读笔记") +
    "。";
  const count = vid
    ? Math.max(
        4,
        Math.ceil(
          w.settings.duration / config.videoModels[w.settings.videoModel][2],
        ),
      )
    : 3;
  const artNames =
    w.layout === "避坑问答版"
      ? ["先问什么？", "容易漏掉什么？", "还需要问谁？"]
      : w.layout === "临床深度版"
        ? ["问题与背景", "核对依据", "咨询要点"]
        : ["先看这里", "逐项核对", "药师提醒"];
  w.blocks = Array.from({ length: count }, (_, i) => {
    const name = vid
      ? i === 0
        ? "问题开场"
        : i === count - 1
          ? "收尾提醒"
          : "要点讲解 " + i
      : artNames[i];
    const line = vid
      ? lines[i % 4]
      : i === 0
        ? lines[0] + lines[1]
        : lines[i + 1];
    const scene = [
      "桌面上的药品外盒与放大镜",
      "包装上需要核对的位置特写",
      "笔记本和用药信息卡",
      "药师咨询台与整理好的药盒",
    ][i % 4];
    return {
      name,
      line,
      image: "",
      variant: 0,
      seconds: vid
        ? Math.floor(w.settings.duration / count) +
          (i < w.settings.duration % count ? 1 : 0)
        : 0,
      prompt: [
        styles[w.style],
        w.title,
        w.drug && "关联药品 " + w.drug,
        vid ? w.avatar || "无人物" : w.layout,
        scene,
        "无文字，无剂量数字",
      ]
        .filter(Boolean)
        .join("；"),
      motion: "镜头缓慢推进，保持主体和画面风格一致。",
    };
  });
}

function pictureControls(w, b, i) {
  const origin = b.image?.startsWith("/assets/")
    ? "本地示例图"
    : config.imageModels[b.imageModel]?.[0] || "火山方舟生成";
  return (
    '<div class="picture-slot" data-picture="' +
    i +
    '"><div class="picture-frame" data-ratio="' +
    esc(w.settings.ratio) +
    '">' +
    (b.image
      ? '<img class="picture" src="' +
        esc(b.image) +
        '" alt="第 ' +
        (i + 1) +
        ' 张配图">'
      : "") +
    (b.job && !b.job.error
      ? '<div class="picture-overlay" role="status"><span class="picture-busy"><span class="spinner" aria-hidden="true"></span>正在生成这张图</span></div>'
      : "") +
    "</div>" +
    (b.job
      ? b.job.error
        ? inlineJobError(b.job, i)
        : ""
      : '<div class="picture-bar">' +
        (b.image
          ? '<span class="small">' +
            esc(origin) +
            (b.imageSize ? " · " + esc(b.imageSize) : "") +
            "</span>"
          : '<span class="small">暂未添加配图</span>') +
        (w.stage === "review"
          ? ""
          : btn(
              b.image ? "重新生成这张图" : "为这段配图",
              "reimage",
              "outline",
              i,
            )) +
        "</div>") +
    "</div>"
  );
}

function inlineJobError(job, index = "") {
  return (
    '<div class="banner err" role="alert">配图生成未完成：' +
    esc(job.error) +
    '<div class="banner-actions">' +
    btn("重试", "retry", "secondary", index) +
    btn(index === "" ? "关闭提示" : "取消重做", "abort-job", "textbtn", index) +
    "</div></div>"
  );
}

function syncImageActions(w) {
  const pending = w.blocks.some((b) => b.job);
  for (const el of app.querySelectorAll(
    '[data-action="compose"], [data-action="submit"]',
  )) {
    el.disabled = pending || (el.dataset.action === "submit" && !!w.videoDirty);
    el.title = pending
      ? "请先等待单张配图完成或取消失败提示"
      : w.videoDirty
        ? "分镜已变更，请先重新合成视频"
        : "";
  }
  for (const el of app.querySelectorAll('[data-action="remove-block"]')) {
    el.disabled =
      w.blocks.length <= 2 || !!w.blocks[Number(el.dataset.val)]?.job;
  }
  const stale = app.querySelector("#video-stale");
  if (stale) stale.hidden = !w.videoDirty;
}

function updateJobView(w, owner, finished = false) {
  if (current() !== w) return;
  if (owner !== w) {
    const index = w.blocks.indexOf(owner);
    const slot = app.querySelector('[data-picture="' + index + '"]');
    if (slot) slot.outerHTML = pictureControls(w, owner, index);
    syncImageActions(w);
    return;
  }
  if (finished) {
    render();
    return;
  }
  if (w.job.target !== "initial") {
    jobView(w);
    return;
  }
  const area = $("#initial-generation");
  if (!area) return;
  area.innerHTML = w.job.error
    ? inlineJobError(w.job)
    : '<div class="inline-progress" role="status"><span class="spinner" aria-hidden="true"></span><span id="progress">' +
      esc(w.job.progress || "正在生成配图") +
      "</span></div>";
  app
    .querySelectorAll(
      '.layout input, .layout select, .layout textarea, .layout button:not([data-action="retry"]):not([data-action="abort-job"])',
    )
    .forEach((el) => {
      el.disabled = true;
    });
}

function renderPictureDialog(w) {
  const { index, mode, prompt, imageModel, imageSize } = regenModal;
  const block = w.blocks[index];
  const models = Object.entries(config.imageModels).map(([id, spec]) => [
    id,
    spec[0],
  ]);
  const label =
    w.type === "video" ? "分镜 " + (index + 1) : block.name || "段落 " + (index + 1);
  const isArk = mode === "ark";

  let body =
    modeSegment(mode, "regen-mode") +
    (isArk ? arkKeyWarning("regen-mode") : "") +
    '<label class="field">画面提示词<textarea id="imageprompt" rows="4" maxlength="1800">' +
    esc(prompt) +
    "</textarea></label>";

  if (isArk) {
    body +=
      '<div class="fields" style="margin-top:11px">' +
      '<label class="field">生图模型<select id="picture-model">' +
      opts(models, imageModel) +
      '</select></label><label class="field">清晰度<select id="picture-size">' +
      opts(config.imageModels[imageModel][1], imageSize) +
      "</select></label></div>" +
      '<p class="footmeta">仅生成这一张，成功后原位替换，按方舟实际用量计费。</p>' +
      (w.type === "video" && w.stage === "draft"
        ? '<p class="footmeta">换图后返回分镜编辑重新合成，即可更新视频画面。</p>'
        : "") +
      '<div style="margin-top:14px">' +
      btn(
        "确认用方舟生成 1 张",
        "regen",
        "primary widebtn",
        index,
        config.keyPresent ? "" : "disabled",
      ) +
      "</div>";
  } else {
    body +=
      '<div class="mode-box" style="margin-top:12px">切换下一张内置示例图并保存上方提示词，不消耗方舟额度。</div>' +
      '<div style="margin-top:14px">' +
      btn("更换本地示例图", "regen-demo", "primary widebtn", index) +
      "</div>";
  }

  openModal(
    label + " · " + (block.image ? "重新生成配图" : "添加配图"),
    body,
    "reimage",
  );
}

function openPictureDialog(w, index) {
  const block = w.blocks[index];
  regenModal = {
    index,
    mode: w.settings.mode,
    prompt: block.prompt,
    imageModel: w.settings.imageModel,
    imageSize: w.settings.imageSize,
  };
  renderPictureDialog(w);
}

function blockEditor(w, b, i, rangeStr) {
  const vid = w.type === "video";
  const stats = vid
    ? speechStats(b.line, b.seconds)
    : { chars: String(b.line || "").length, over: false };

  return (
    '<section class="shot"><div class="shothead">' +
    '<div class="shot-title-group">' +
    (vid ? '<span class="shot-badge">分镜 ' + (i + 1) + "</span>" : "") +
    '<input class="inline-title" maxlength="60" data-block="' +
    i +
    '" data-key="name" value="' +
    esc(b.name) +
    '" aria-label="' +
    (vid ? "第 " + (i + 1) + " 幕标题" : "第 " + (i + 1) + " 段小标题") +
    '">' +
    "</div>" +
    '<div class="row" style="gap:6px">' +
    (vid
      ? '<span class="time-range" id="timerange-' +
        i +
        '">' +
        rangeStr +
        " · " +
        b.seconds +
        "秒</span>"
      : "") +
    '<div class="shot-tools">' +
    btn(
      ico("up"),
      "move-block",
      "icon-btn",
      i + ":-1",
      (i === 0 ? "disabled " : "") + 'aria-label="上移" title="上移"',
    ) +
    btn(
      ico("down"),
      "move-block",
      "icon-btn",
      i + ":1",
      (i === w.blocks.length - 1 ? "disabled " : "") +
        'aria-label="下移" title="下移"',
    ) +
    btn(
      ico("trash"),
      "remove-block",
      "icon-btn danger",
      i,
      (w.blocks.length <= 2 ? "disabled " : "") +
        'aria-label="移除" title="移除"',
    ) +
    "</div></div></div>" +
    '<div class="field-head"><label class="label" for="line-' +
    i +
    '">' +
    (vid ? "口播台词" : "段落正文") +
    '</label><span class="pace' +
    (stats.over ? " warn" : "") +
    '" id="pace-' +
    i +
    '">' +
    (vid ? stats.label : stats.chars + " 字") +
    '</span></div><textarea id="line-' +
    i +
    '" rows="' +
    (vid ? 2 : 3) +
    '" maxlength="' +
    (vid ? 450 : 1800) +
    '" data-block="' +
    i +
    '" data-key="line" placeholder="' +
    (vid ? "填写这一幕药师讲解的口播句子" : "填写这一段的科普正文") +
    '">' +
    esc(b.line) +
    "</textarea>" +
    pictureControls(w, b, i) +
    (vid
      ? '<details class="shot-options"><summary>运镜要求与单镜时长（' +
        b.seconds +
        " 秒）</summary>" +
        '<label class="field">画面动作与运镜<textarea rows="2" maxlength="400" data-block="' +
        i +
        '" data-key="motion">' +
        esc(b.motion || "镜头缓慢推进，保持主体和画面风格一致。") +
        '</textarea></label><label class="field" style="margin-top:10px">单镜时长<select data-seconds="' +
        i +
        '">' +
        opts(
          Array.from(
            { length: config.videoModels[w.settings.videoModel][2] - 3 },
            (_, n) => [String(n + 4), n + 4 + " 秒"],
          ),
          String(b.seconds),
        ) +
        "</select></label></details>"
      : "") +
    "</section>"
  );
}

function editor(w) {
  const vid = w.type === "video";
  const s = w.settings;
  const ranges = vid ? shotRanges(w.blocks) : [];
  const totalSec = vid ? w.blocks.reduce((sum, b) => sum + b.seconds, 0) : 0;
  if (vid) w.settings.duration = totalSec;
  const missingImages = vid && w.blocks.some((b) => !b.image);

  const body =
    '<div class="sheet"><label class="field">作品标题<input maxlength="300" data-bind="title" value="' +
    esc(w.title) +
    '" placeholder="输入清晰易懂的科普标题"></label>' +
    (vid
      ? ""
      : '<label class="field" style="margin-top:14px">药师导读<textarea rows="2" maxlength="600" data-bind="lead" placeholder="用一两句话提炼核心阅读提示">' +
        esc(w.lead) +
        "</textarea></label>") +
    '</div><div class="sheet"><div class="card-head"><h2>' +
    (vid ? "分镜脚本" : "正文与配图") +
    '</h2><span class="small">共 ' +
    w.blocks.length +
    (vid ? " 幕 · " + totalSec + " 秒" : " 段") +
    "</span></div>" +
    w.blocks.map((b, i) => blockEditor(w, b, i, ranges[i])).join("") +
    '<div style="margin-top:12px">' +
    btn(
      ico("plus") + (vid ? " 添加一幕分镜" : " 添加一段正文"),
      "append",
      "secondary",
      "",
      vid && w.blocks.length >= 12 ? "disabled" : "",
    ) +
    "</div></div>";

  const summaryPills = [
    s.mode === "ark"
      ? vid
        ? config.videoModels[s.videoModel][0]
        : config.imageModels[s.imageModel][0]
      : "内置示例素材",
    "画幅 " + s.ratio,
    ...(vid
      ? [
          s.mode === "ark" ? s.resolution : "480p",
          s.voice,
          totalSec + " 秒",
        ]
      : s.mode === "ark"
        ? [s.imageSize]
        : []),
    ...(w.drug ? ["药品：" + w.drug] : []),
  ];

  const aside =
    '<div class="sheet"><div class="card-head"><h2>' +
    (vid ? "合成准备" : "保存修改") +
    '</h2><span class="status-pill">' +
    (s.mode === "ark" ? "火山方舟" : "本地演示") +
    '</span></div><div class="summary-kv">' +
    summaryPills.map((p) => '<span class="pill">' + esc(p) + "</span>").join("") +
    "</div>" +
    (s.mode === "ark" ? arkKeyWarning("set-mode") : "") +
    '<div style="margin-top:12px">' +
    btn("调整模型参数", "work-settings", "outline widebtn") +
    "</div>" +
    (missingImages && s.mode === "demo"
      ? '<div style="margin-top:8px">' +
        btn("补齐缺失示例图", "fill-demo-images", "secondary widebtn") +
        "</div>"
      : "") +
    '<div class="dividerline"></div><div class="stack-actions">' +
    btn(
      vid
        ? s.mode === "ark"
          ? "用方舟生成视频"
          : "合成本地演示视频"
        : "保存并预览",
      vid ? "compose" : "preview",
      "primary widebtn",
    ) +
    (vid && w.video && !w.videoDirty
      ? btn("查看已合成视频", "view-draft", "secondary widebtn")
      : "") +
    '</div><p class="footmeta">所有编辑实时保存在当前浏览器。</p></div>';

  shell(
    w,
    vid ? "编辑分镜脚本" : "编辑图文草稿",
    1,
    '<div class="layout"><div>' +
      body +
      '</div><aside class="aside">' +
      aside +
      "</aside></div>",
    btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
  );
}

function detail(w) {
  const vid = w.type === "video",
    reviewing = w.stage === "review";
  const ranges = vid ? shotRanges(w.blocks) : [];

  const metaPills = [
    vid ? "视频科普" : "图文科普 · " + w.layout,
    ...(w.drug ? ["关联药品：" + w.drug] : []),
    ...(vid
      ? [
          w.settings.ratio,
          w.settings.duration + " 秒",
          w.settings.voice,
          w.renderMode === "demo" ? "本地演示成片" : "方舟动态成片",
        ]
      : []),
  ];

  const body = vid
    ? '<div class="video-stage" data-ratio="' +
      esc(w.settings.ratio) +
      '"><video controls playsinline class="video-player" src="' +
      esc(w.video.url) +
      '" poster="' +
      esc(w.blocks[0]?.image || "") +
      '"><track default kind="subtitles" srclang="zh" label="中文" src="' +
      esc(w.video.captions) +
      '"></video></div>' +
      '<div id="video-stale" class="banner warn" hidden>分镜脚本或配图已修改。返回分镜编辑并重新合成后，上方成片才会同步更新。</div>' +
      '<div class="dividerline"></div><details class="transcript" open><summary>' +
      w.blocks.length +
      " 幕分镜与口播台词</summary>" +
      w.blocks
        .map(
          (b, i) =>
            '<section class="shot"><div class="shothead"><div class="shot-title-group"><span class="shot-badge">分镜 ' +
            (i + 1) +
            "</span><h3>" +
            esc(b.name) +
            '</h3></div><span class="time-range">' +
            ranges[i] +
            "</span></div><p>" +
            esc(b.line) +
            "</p>" +
            pictureControls(w, b, i) +
            "</section>",
        )
        .join("") +
      "</details>"
    : '<div class="prose"><div class="lead-box"><div class="lead-title">药师导读</div><p class="lead">' +
      esc(w.lead) +
      "</p></div>" +
      w.blocks
        .map(
          (b, i) =>
            '<section class="prose-section"><h3>' +
            esc(b.name) +
            "</h3><p>" +
            esc(b.line) +
            "</p>" +
            pictureControls(w, b, i) +
            "</section>",
        )
        .join("") +
      '<div class="ai-note">内容与配图由 AI 辅助生成，发布前请药师核对专业表述。</div></div>';

  const tagsHtml = w.tags.length
    ? '<div class="flexwrap" style="margin-bottom:12px">' +
      w.tags
        .map(
          (t) =>
            '<span class="pill">' +
            esc(t) +
            (reviewing
              ? ""
              : btn(
                  ico("close"),
                  "remove-tag",
                  "pill-remove",
                  t,
                  'aria-label="移除分类 ' + esc(t) + '"',
                )) +
            "</span>",
        )
        .join("") +
      "</div>"
    : '<p class="small" style="margin-bottom:12px">尚未选择作品分类（提交审核前必选）</p>';

  const safeDownloadName =
    (w.title || "科普视频").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) + ".mp4";

  const panel =
    '<div class="sheet"><div class="card-head"><h2>' +
    (reviewing ? "送审状态" : "发布准备") +
    '</h2><span class="status-pill">' +
    stageName(w) +
    '</span></div><div class="formrow"><span class="label">作品分类</span>' +
    tagsHtml +
    (reviewing
      ? ""
      : btn(
          w.tags.length ? "修改作品分类" : "选择作品分类",
          "tags",
          "secondary widebtn",
        )) +
    '</div><div class="dividerline"></div><div class="stack-actions">' +
    (reviewing
      ? '<p class="footmeta" style="margin-top:0">当前为本地模拟送审状态，作品已保存在「我的作品」。</p>' +
        btn("查看我的作品", "works", "primary widebtn") +
        btn("撤回至草稿继续修改", "withdraw", "secondary widebtn")
      : btn("提交审核", "submit", "primary widebtn") +
        btn(
          vid ? "返回分镜编辑" : "编辑正文与配图",
          "edit",
          "secondary widebtn",
        )) +
    '</div><div class="dividerline"></div><div class="stack-actions">' +
    (vid
      ? '<a class="outline widebtn" download="' +
        esc(safeDownloadName) +
        '" href="' +
        esc(w.video.url) +
        '">' +
        ico("download") +
        " 下载 MP4 视频</a>"
      : btn(
          ico("copy") + " 复制全文内容",
          "copy-article",
          "outline widebtn",
        )) +
    (!reviewing
      ? btn("调整模型参数", "work-settings", "textbtn")
      : "") +
    "</div></div>";

  shell(
    w,
    reviewing ? "作品审核中" : vid ? "视频成品草稿" : "图文成品草稿",
    2,
    '<div class="layout"><div class="sheet"><h2 class="articleTitle">' +
      esc(w.title) +
      '</h2><div class="article-meta">' +
      metaPills.map((m) => '<span class="pill">' + esc(m) + "</span>").join("") +
      "</div>" +
      body +
      '</div><aside class="aside">' +
      panel +
      "</aside></div>",
    btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
  );
}

function jobView(w) {
  const failed = !!w.job.error;
  shell(
    w,
    failed ? "生成任务需要处理" : "正在合成视频",
    1,
    '<div class="view-wrap sheet"><div class="row">' +
      (failed ? "" : '<span class="spinner" aria-hidden="true"></span>') +
      '<h2 id="progress">' +
      esc(failed ? "任务未完成" : w.job.progress || "准备处理任务") +
      '</h2></div><div class="' +
      (failed ? "banner err" : "mode-box") +
      '" style="margin-top:14px">' +
      esc(
        failed
          ? w.job.error
          : "合成期间可先返回工作台处理其他草稿，已完成的分镜会自动复用。",
      ) +
      '</div><div class="actions">' +
      (failed
        ? btn("继续此任务", "retry", "primary") +
          btn("返回分镜编辑", "abort-job", "secondary")
        : "") +
      btn("返回工作台", "home", "textbtn") +
      "</div></div>",
  );
}

async function jsonRequest(path, init) {
  const r = await fetch(path, init);
  let value;
  try {
    value = await r.json();
  } catch {
    throw Error("本地服务响应异常，请确认启动窗口仍在运行。");
  }
  if (!r.ok) throw Error(value.error || "请求失败");
  return value;
}

async function poll(w, owner = w) {
  const job = owner.job;
  if (!job || watching.has(job.payload.id)) return;
  watching.add(job.payload.id);
  try {
    while (owner.job === job && !job.error) {
      try {
        const result = await jsonRequest("/api/jobs/" + job.payload.id);
        if (owner.job !== job) return;
        if (result.status === "failed") throw Error(result.error);
        if (result.status === "done") {
          if (job.target === "compose") {
            w.video = result.output;
            w.renderMode = job.payload.mode;
            w.stage = "draft";
            w.videoDirty = false;
            w.viewingSetup = false;
          } else {
            const single = job.target === "regenerate";
            result.output.images.forEach((img, i) => {
              const block = single ? owner : w.blocks[i];
              if (!block) return;
              block.image = img;
              block.imageModel =
                job.payload.mode === "ark"
                  ? job.payload.settings.imageModel
                  : "";
              block.imageSize =
                job.payload.mode === "ark"
                  ? job.payload.settings.imageSize
                  : "";
              if (single) {
                block.prompt = job.prompt;
                block.variant = (block.variant || 0) + 1;
              }
            });
            if (single && w.type === "video" && w.video) w.videoDirty = true;
            if (!single) {
              w.stage = w.type === "video" ? "script" : "draft";
              w.editing = false;
              w.viewingSetup = false;
            }
          }
          owner.job = null;
          w.updated = Date.now();
          save();
          updateJobView(w, owner, true);
          return;
        }
        job.progress = result.progress;
        const el = owner === w && current() === w ? $("#progress") : null;
        if (el) el.textContent = result.progress;
      } catch (e) {
        job.error = e.message;
        save();
        updateJobView(w, owner);
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  } finally {
    watching.delete(job.payload.id);
  }
}

async function sendJob(w, owner = w) {
  const j = owner.job;
  j.error = "";
  save();
  updateJobView(w, owner);
  try {
    await jsonRequest("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(j.payload),
    });
    if (owner.job === j) poll(w, owner);
  } catch (e) {
    j.error = e.message;
    save();
    updateJobView(w, owner);
  }
}

async function startJob(w, target, items, extra = {}, settings = w.settings) {
  const owner = target === "regenerate" ? w.blocks[extra.index] : w;
  if (w.job || owner.job) return;
  const payload = {
    id: crypto.randomUUID(),
    mode: settings.mode,
    kind: target === "compose" ? "video" : "images",
    settings: { ...settings },
    style: w.style,
    items,
  };
  owner.job = { target, payload, ...extra };
  save();
  await sendJob(w, owner);
}

function authorize(w, count, kind, fn) {
  if (w.settings.mode === "demo") return fn();
  if (!config.keyPresent) {
    notify("尚未配置 ARK_API_KEY，可先切换为本地演示");
    return;
  }
  retryPayload = fn;
  openModal(
    "确认使用火山方舟生成",
    "<p>将按当前参数提交最多 <b>" +
      count +
      "</b> 个" +
      (kind === "video"
        ? "视频分镜（共 " + w.settings.duration + " 秒）"
        : "图片生成") +
      '任务，费用由当前方舟账号按量结算。</p><div class="summary-kv" style="margin-top:12px">' +
      '<span class="pill">' +
      esc(
        kind === "video"
          ? config.videoModels[w.settings.videoModel][0]
          : config.imageModels[w.settings.imageModel][0],
      ) +
      '</span><span class="pill">' +
      esc(kind === "video" ? w.settings.resolution : w.settings.imageSize) +
      '</span><span class="pill">画幅 ' +
      esc(w.settings.ratio) +
      '</span></div><div class="actions">' +
      btn("确认提交并计费", "confirm-paid", "primary") +
      btn("取消", "close", "secondary") +
      "</div>",
    "confirm",
  );
}

function generate(w) {
  if (!w.topic.trim()) {
    notify("请先填写科普主题");
    $("#topic")?.focus();
    return;
  }
  if (w.settings.mode === "ark" && !config.keyPresent) {
    notify("尚未配置 ARK_API_KEY，请先切换为本地演示或配置 Key");
    return;
  }
  seedBlocks(w);
  if (w.video) {
    w.video = null;
    w.videoDirty = false;
  }
  const items = (w.type === "video" ? w.blocks : w.blocks.slice(0, 2)).map(
    (b) => ({ prompt: b.prompt }),
  );
  authorize(w, items.length, "images", () => startJob(w, "initial", items));
}

function renderDrugList(query = "") {
  const q = query.trim();
  const matched = drugs.filter((x) => x.includes(q));
  const exact = drugs.includes(q);
  let html = "";
  if (q && !exact) {
    html += btn("使用「" + esc(q) + "」", "pickdrug", "chip selected", q);
  }
  html += matched.map((x) => btn(esc(x), "pickdrug", "chip", x)).join("");
  return html || '<span class="small">未匹配预设药名，可直接输入后按回车使用。</span>';
}

function openDrugModal(w) {
  openModal(
    "选择或输入关联药品",
    '<label class="field" for="drugquery">药品通用名或商品名<input id="drugquery" maxlength="60" value="' +
      esc(w.drug || "") +
      '" placeholder="搜索常见药品，或直接输入药名按回车"></label>' +
      '<div class="flexwrap" style="margin-top:14px" id="druglist">' +
      renderDrugList(w.drug || "") +
      "</div>",
    "drug",
  );
  const input = $("#drugquery", dialogBody);
  if (input) {
    input.focus();
    input.select();
  }
}

function tagsModal(w) {
  selectedTags = [...w.tags];
  showTags();
}

function showTags() {
  const all = [...new Set([...categories, ...selectedTags])];
  openModal(
    "选择作品分类",
    '<div class="flexwrap">' +
      all
        .map((t) =>
          btn(
            esc(t),
            "toggle-tag",
            "chip" + (selectedTags.includes(t) ? " selected" : ""),
            t,
            'aria-pressed="' + selectedTags.includes(t) + '"',
          ),
        )
        .join("") +
      '</div><div class="dividerline"></div><label class="field" for="newtag">自定义分类标签（最多 8 字）</label>' +
      '<div class="tag-input-row"><input maxlength="8" id="newtag" placeholder="输入标签后按回车或点添加">' +
      btn("添加", "customtag", "secondary") +
      '</div><div style="margin-top:16px">' +
      btn(
        "确定（已选 " + selectedTags.length + " 个）",
        "save-tags",
        "primary widebtn",
      ) +
      "</div>",
    "tags",
  );
}

function askDeleteModal(id) {
  const target = data.works.find((x) => x.id === id);
  if (!target) return;
  openModal(
    "删除这份作品？",
    "<p>将从当前浏览器移除「<b>" +
      esc(target.title || target.topic || "未命名作品") +
      '</b>」的草稿记录，此操作不可恢复。</p><div class="actions">' +
      btn("确认删除", "confirm-delete", "danger-outline", id) +
      btn("保留作品", "close", "secondary") +
      "</div>",
    "confirm",
  );
}

function askRegenAllModal(w) {
  if (!w.topic.trim()) {
    notify("请先填写科普主题");
    $("#topic")?.focus();
    return;
  }
  openModal(
    "重新生成整篇内容？",
    "<p>重新生成将覆盖当前已编辑的" +
      (w.type === "video" ? "分镜脚本与已合成成片" : "标题、导读与各段正文") +
      '。</p><div class="actions">' +
      btn("确认覆盖并重做", "confirm-regen-all", "primary") +
      btn("取消", "close", "secondary") +
      "</div>",
    "confirm",
  );
}

async function copyArticleText(w) {
  const text = [
    w.title,
    w.drug ? "关联药品：" + w.drug : "",
    "",
    "【药师导读】",
    w.lead,
    "",
    ...w.blocks.flatMap((b) => ["## " + b.name, b.line, ""]),
    "（内容由 AI 辅助生成，发布前请药师核对专业表述）",
  ]
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    notify("已复制全文到剪贴板");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    notify("已复制全文到剪贴板");
  }
}

function render(preserveScroll = false) {
  if (!config) return;
  const prevScroll = window.scrollY;
  const w = current();
  if (route()[0] !== "work" || !w) {
    home();
    if (!preserveScroll) window.scrollTo(0, 0);
    return;
  }
  if (w.job) {
    if (w.job.target === "initial") setup(w);
    else jobView(w);
    if (!w.job.error) poll(w);
    if (!preserveScroll) window.scrollTo(0, 0);
    return;
  }
  if (w.stage === "setup" || w.viewingSetup) setup(w);
  else if (w.stage === "script" || (w.stage === "draft" && w.editing))
    editor(w);
  else detail(w);
  for (const b of w.blocks) if (b.job && !b.job.error) poll(w, b);
  if (preserveScroll) window.scrollTo(0, prevScroll);
  else window.scrollTo(0, 0);
}

function changed(w) {
  w.updated = Date.now();
  save();
}

function applySettingMutation(s, key, val) {
  s[key] = val;
  if (!config.imageModels[s.imageModel][1].includes(s.imageSize)) {
    s.imageSize = config.imageModels[s.imageModel][1][0];
  }
  if (!config.videoModels[s.videoModel][1].includes(s.resolution)) {
    s.resolution = config.videoModels[s.videoModel][1][0];
  }
  save();
  updateTopbar();
}

document.addEventListener("input", (e) => {
  const w = current(),
    el = e.target;
  if (el.id === "drugquery") {
    const list = $("#druglist", dialogBody);
    if (list) list.innerHTML = renderDrugList(el.value);
    return;
  }
  if (el.id === "imageprompt" && regenModal) {
    regenModal.prompt = el.value;
    return;
  }
  if (!w) return;
  if (el.dataset.bind) {
    w[el.dataset.bind] = el.value;
    if (el.id === "topic") {
      const counter = $("#chars");
      if (counter) counter.textContent = el.value.length + " / 300";
    }
    changed(w);
  }
  if (el.dataset.block !== undefined) {
    const idx = Number(el.dataset.block);
    const block = w.blocks[idx];
    if (!block) return;
    block[el.dataset.key] = el.value;
    if (el.dataset.key === "line") {
      const paceEl = $("#pace-" + idx);
      if (paceEl) {
        if (w.type === "video") {
          const st = speechStats(el.value, block.seconds);
          paceEl.textContent = st.label;
          paceEl.classList.toggle("warn", st.over);
        } else {
          paceEl.textContent = el.value.length + " 字";
        }
      }
      if (w.type === "video" && w.video) w.videoDirty = true;
    }
    if (el.dataset.key === "motion" && w.type === "video" && w.video) {
      w.videoDirty = true;
    }
    changed(w);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const el = e.target,
    w = current();
  if (el.id === "drugquery" && w) {
    e.preventDefault();
    const val = el.value.trim();
    if (val) {
      w.drug = val;
      dialog.close();
      changed(w);
      render(true);
    }
  } else if (el.id === "newtag") {
    e.preventDefault();
    const t = el.value.trim();
    if (t && !selectedTags.includes(t)) selectedTags.push(t);
    showTags();
    $("#newtag", dialogBody)?.focus();
  }
});

document.addEventListener("change", (e) => {
  const el = e.target,
    w = current();
  if (el.id === "picture-model" && regenModal) {
    regenModal.imageModel = el.value;
    const choices = config.imageModels[el.value][1];
    if (!choices.includes(regenModal.imageSize)) {
      regenModal.imageSize = choices[0];
    }
    renderPictureDialog(w);
    return;
  }
  if (el.id === "picture-size" && regenModal) {
    regenModal.imageSize = el.value;
    return;
  }
  if (el.dataset.seconds !== undefined && w) {
    w.blocks[Number(el.dataset.seconds)].seconds = Number(el.value);
    w.settings.duration = w.blocks.reduce((sum, b) => sum + b.seconds, 0);
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return;
  }
  const k = el.dataset.setting;
  if (!k) return;
  const inside = dialog.contains(el);
  const s =
    inside && modalScope === "global"
      ? data.settings
      : w?.settings || data.settings;
  applySettingMutation(s, k, el.type === "checkbox" ? el.checked : el.value);
  if (w && s === w.settings) changed(w);
  if (inside) {
    prefs(modalScope === "global" ? null : w);
    if (w && modalScope !== "global") render(true);
  } else if (w) {
    render(true);
  }
});

dialog.addEventListener("click", (e) => {
  if (e.target === dialog && modalType !== "confirm") {
    dialog.close();
  }
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action,
    v = el.dataset.val,
    w = current();
  try {
    switch (action) {
      case "home":
        tab = "examples";
        navigate("home");
        break;
      case "works":
      case "drafts":
        tab = "works";
        filter = action === "drafts" ? "草稿" : "全部";
        navigate("home");
        break;
      case "examples":
        tab = "examples";
        home();
        break;
      case "filter":
        filter = v;
        home();
        break;
      case "new":
        newWork(v);
        break;
      case "sample":
        newWork("video", Number(v));
        break;
      case "open":
        navigate("work/" + v);
        break;
      case "close":
        dialog.close();
        break;
      case "global-settings":
        prefs(null);
        break;
      case "work-settings":
        if (w) prefs(w);
        else prefs(null);
        break;
      case "set-mode":
        if (w) {
          applySettingMutation(w.settings, "mode", v);
          changed(w);
          render(true);
        }
        break;
      case "modal-mode": {
        const s =
          modalScope === "global" ? data.settings : w?.settings || data.settings;
        applySettingMutation(s, "mode", v);
        if (w && s === w.settings) {
          changed(w);
          render(true);
        }
        prefs(modalScope === "global" ? null : w);
        break;
      }
      case "regen-mode":
        if (regenModal && w) {
          regenModal.mode = v;
          renderPictureDialog(w);
        }
        break;
      case "goto-step":
        if (!w || w.job) break;
        if (v === "setup") {
          w.viewingSetup = true;
        } else if (v === "edit") {
          w.viewingSetup = false;
          if (w.type === "video") w.stage = "script";
          else w.editing = true;
        } else if (v === "detail") {
          w.viewingSetup = false;
          if (w.type === "video" && w.video) w.stage = "draft";
          else w.editing = false;
        }
        changed(w);
        render();
        break;
      case "resume-edit":
        w.viewingSetup = false;
        changed(w);
        render();
        break;
      case "regenerate-all":
        askRegenAllModal(w);
        break;
      case "confirm-regen-all":
        dialog.close();
        w.viewingSetup = false;
        generate(w);
        break;
      case "fill": {
        const currentIdx = examples.indexOf(w.topic.trim());
        const nextIdx =
          currentIdx >= 0
            ? (currentIdx + 1) % examples.length
            : exampleCursor++ % examples.length;
        w.topic = examples[nextIdx];
        changed(w);
        render(true);
        break;
      }
      case "avatar":
        w.avatar = ["无人物", "药师插画"][Number(v)];
        changed(w);
        render(true);
        break;
      case "duration":
        w.settings.duration = [30, 45, 60, 90, 120][Number(v)];
        changed(w);
        render(true);
        break;
      case "style":
        w.style = Number(v);
        changed(w);
        render(true);
        break;
      case "layout":
        w.layout = ["通俗图解版", "临床深度版", "避坑问答版"][Number(v)];
        changed(w);
        render(true);
        break;
      case "drug":
        openDrugModal(w);
        break;
      case "pickdrug":
        w.drug = v;
        dialog.close();
        changed(w);
        render(true);
        break;
      case "undrug":
        w.drug = "";
        changed(w);
        render(true);
        break;
      case "generate":
        generate(w);
        break;
      case "edit":
        w.viewingSetup = false;
        if (w.type === "video") w.stage = "script";
        else w.editing = true;
        changed(w);
        render();
        break;
      case "view-draft":
        if (w.video) {
          w.viewingSetup = false;
          w.stage = "draft";
          changed(w);
          render();
        }
        break;
      case "preview":
        if (!w.title.trim()) {
          notify("请填写作品标题");
          return;
        }
        w.editing = false;
        w.viewingSetup = false;
        changed(w);
        render();
        break;
      case "fill-demo-images":
        w.blocks.forEach((b, idx) => {
          if (!b.image) {
            b.image = asset((w.style || 0) + idx);
            b.imageModel = "";
            b.imageSize = "";
          }
        });
        if (w.video) w.videoDirty = true;
        changed(w);
        render(true);
        notify("已补齐本地示例分镜图");
        break;
      case "compose": {
        if (!w.title.trim()) {
          notify("请先填写作品标题");
          return;
        }
        if (w.blocks.some((b) => !b.line.trim())) {
          notify("请补全每一幕的口播台词");
          return;
        }
        if (w.blocks.some((b) => !b.image)) {
          notify("还有分镜缺少配图，请先为该幕配图");
          return;
        }
        if (
          w.blocks.some(
            (b) => b.seconds > config.videoModels[w.settings.videoModel][2],
          )
        ) {
          notify("存在单镜时长超过当前模型上限，请调短单镜时长或切换 Seedance 2.5");
          return;
        }
        authorize(w, w.blocks.length, "video", () =>
          startJob(
            w,
            "compose",
            w.blocks.map(({ prompt, image, line, seconds, motion }) => ({
              prompt: prompt + "；" + (motion || "保持画面主体一致。"),
              image,
              line,
              seconds,
            })),
          ),
        );
        break;
      }
      case "confirm-paid": {
        const fn = retryPayload;
        retryPayload = null;
        dialog.close();
        if (fn) await fn();
        break;
      }
      case "append": {
        const vid = w.type === "video";
        if (vid && w.blocks.length >= 12) {
          notify("最多支持 12 幕分镜");
          return;
        }
        const idx = w.blocks.length;
        const sec = vid
          ? Math.min(8, config.videoModels[w.settings.videoModel][2])
          : 0;
        w.blocks.push({
          name: vid ? "要点讲解 " + idx : "补充要点 " + idx,
          line: "",
          prompt: [
            styles[w.style],
            w.title || w.topic,
            w.drug && "关联药品 " + w.drug,
            "清晰的科普配图，无文字，无剂量数字",
          ]
            .filter(Boolean)
            .join("；"),
          image: vid && w.settings.mode === "demo" ? asset(w.style + idx) : "",
          variant: 0,
          seconds: sec,
          motion: "镜头缓慢推进，保持主体和画面风格一致。",
        });
        if (vid) {
          w.settings.duration = w.blocks.reduce((sum, b) => sum + b.seconds, 0);
          if (w.video) w.videoDirty = true;
        }
        changed(w);
        render(true);
        break;
      }
      case "move-block": {
        const [rawIdx, rawDir] = v.split(":").map(Number);
        const nextIdx = rawIdx + rawDir;
        if (
          rawIdx < 0 ||
          nextIdx < 0 ||
          nextIdx >= w.blocks.length ||
          w.blocks[rawIdx]?.job ||
          w.blocks[nextIdx]?.job
        ) {
          return;
        }
        const [moved] = w.blocks.splice(rawIdx, 1);
        w.blocks.splice(nextIdx, 0, moved);
        if (w.type === "video" && w.video) w.videoDirty = true;
        changed(w);
        render(true);
        break;
      }
      case "remove-block": {
        const idx = Number(v);
        if (w.blocks[idx]?.job) return;
        if (w.blocks.length <= 2) {
          notify("至少保留两段内容");
          return;
        }
        w.blocks.splice(idx, 1);
        if (w.type === "video") {
          w.settings.duration = w.blocks.reduce((sum, b) => sum + b.seconds, 0);
          if (w.video) w.videoDirty = true;
        }
        changed(w);
        render(true);
        break;
      }
      case "reimage":
        openPictureDialog(w, Number(v));
        break;
      case "regen":
      case "regen-demo": {
        const i = Number(v),
          prompt = ($("#imageprompt", dialogBody)?.value || "").trim();
        if (!prompt) {
          notify("请填写画面提示词");
          return;
        }
        const isArk = action === "regen";
        const settings = {
          ...w.settings,
          mode: isArk ? "ark" : "demo",
          imageModel:
            $("#picture-model", dialogBody)?.value || w.settings.imageModel,
          imageSize:
            $("#picture-size", dialogBody)?.value || w.settings.imageSize,
        };
        if (isArk && !config.keyPresent) {
          notify("尚未配置 ARK_API_KEY");
          return;
        }
        dialog.close();
        await startJob(
          w,
          "regenerate",
          [{ prompt, variant: (w.blocks[i].variant || 0) + i + 1 }],
          { index: i, prompt },
          settings,
        );
        break;
      }
      case "retry": {
        const owner = v === "" || v == null ? w : w.blocks[Number(v)];
        const j = owner.job;
        authorize(
          { ...w, settings: j.payload.settings },
          j.payload.items.length,
          j.payload.kind,
          () => sendJob(w, owner),
        );
        break;
      }
      case "abort-job": {
        const owner = v === "" || v == null ? w : w.blocks[Number(v)];
        owner.job = null;
        changed(w);
        updateJobView(w, owner, true);
        break;
      }
      case "tags":
        tagsModal(w);
        break;
      case "toggle-tag":
        selectedTags = selectedTags.includes(v)
          ? selectedTags.filter((x) => x !== v)
          : [...selectedTags, v];
        showTags();
        break;
      case "customtag": {
        const t = ($("#newtag", dialogBody)?.value || "").trim();
        if (t && !selectedTags.includes(t)) selectedTags.push(t);
        showTags();
        break;
      }
      case "save-tags":
        w.tags = selectedTags;
        changed(w);
        dialog.close();
        render(true);
        break;
      case "remove-tag":
        w.tags = w.tags.filter((t) => t !== v);
        changed(w);
        render(true);
        break;
      case "submit":
        if (!w.tags.length) {
          tagsModal(w);
          notify("请先选择至少一个作品分类");
          break;
        }
        w.stage = "review";
        w.editing = false;
        w.viewingSetup = false;
        changed(w);
        render();
        notify("已提交本地模拟审核");
        break;
      case "withdraw":
        w.stage = "draft";
        w.editing = false;
        changed(w);
        render();
        notify("已撤回至成品草稿");
        break;
      case "copy-article":
        await copyArticleText(w);
        break;
      case "ask-delete":
        askDeleteModal(v);
        break;
      case "confirm-delete": {
        const idx = data.works.findIndex((x) => x.id === v);
        if (idx >= 0) {
          data.works.splice(idx, 1);
          save();
        }
        dialog.close();
        notify("作品已删除");
        if (route()[0] === "work" && route()[1] === v) {
          tab = "works";
          navigate("home");
        } else {
          render(true);
        }
        break;
      }
    }
  } catch (error) {
    notify(error.message);
  }
});

dialog.addEventListener("close", () => {
  if (dialog.open) return;
  retryPayload = null;
  regenModal = null;
  modalType = null;
  updateTopbar();
});

window.addEventListener("hashchange", () => render(false));

(async () => {
  try {
    config = await jsonRequest("/api/config");
    render();
  } catch {
    app.innerHTML =
      '<div class="empty"><h2>无法连接本地工作台</h2><p>请双击项目目录中的「启动工作台.cmd」启动本地服务后刷新页面。</p></div>';
  }
})();
