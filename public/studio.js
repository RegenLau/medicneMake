"use strict";
const $ = (s, root = document) => root.querySelector(s);
const app = $("#app"),
  dialog = $("#dialog"),
  dialogBody = $("#dialog-body");

const visualStyles = [
  ["手绘动画风", "彩色铅笔和蜡笔质感的手绘插画，略带抖动的深色手绘轮廓线，柔和的粉彩上色，米色纸张纹理背景，温暖亲切的绘本感。"],
  ["清新写实风", "写实摄影质感，明亮柔和的自然窗光，白色与薄荷绿为主的低饱和配色，浅景深，干净整洁的家居或药房环境。"],
  ["科技数据风", "深海军蓝背景，青蓝色发光线条，半透明全息几何体、细网格和光点，层次分明；只用抽象图形和图标表示信息，不画图表刻度。"],
  ["气泡讲解风", "扁平矢量插画，明快的黄、青、蓝和珊瑚红色块，圆润的对话气泡里只放简洁图标，轮廓干净，画面饱满活泼。"],
  ["玻璃拟态风", "浅紫到浅青的柔和渐变背景，磨砂半透明玻璃面板和玻璃质感图标，边缘有细微的彩虹折射与柔光，主体轮廓清楚。"],
  ["3D质感风", "柔和的三维渲染，圆润造型，半透明塑料与哑光材质，粉色、柠檬黄等糖果色，柔和影棚光和浅色纯净背景。"],
];
const styles = visualStyles.map(([name]) => name);

// 旧草稿使用这个值保存出镜选项。
const pharmacistAvatar = "药师插画";
// 旧草稿和真人拒绝后的替换首帧都以这句开头，用来识别只拍物品的分镜。
const objectOnlyFrame = "本幕只拍与主题有关的物品，画面中无人物。";
const noTextFrame = "画面中没有任何文字、字母和数字；药盒、药瓶、纸张、标签和屏幕表面只用纯色块、简单线条或无字图标表示。";
const medicalSafeFrame = "药品用常见外形表现，不画品牌标识和红十字，需要医疗标识时用绿色十字或胶囊图标；不画出具体剂量、片数和刻度读数。";
const defaultMotion = "镜头缓慢推近主体，画面中的道具保持原位。";
const genericMotions = new Set([defaultMotion, "镜头缓慢推进，保持主体和画面风格一致。"]);

const articleLayouts = [
  {
    name: "通俗图解版",
    description: "配图步骤与药师提醒，示例约 500 字",
    preview:
      '<strong>读懂药盒</strong><img src="/assets/style-0.webp" alt=""><i></i>',
  },
  {
    name: "临床深度版",
    description: "背景、核对依据和案例，示例约 1,000 字",
    preview:
      '<strong>问题与背景</strong><i></i><b>核对依据</b><i></i><b>咨询要点</b><i></i>',
  },
  {
    name: "避坑问答版",
    description: "按常见问题逐条回答，示例约 500 字",
    preview:
      '<strong>常见问题</strong><b class="layout-question">问</b><b class="layout-answer">答</b><b class="layout-question">问</b><b class="layout-answer">答</b>',
  },
];

const examples = [
  "药盒上的有效期，应该怎么看？",
  "去药房咨询前，准备哪些信息？",
  "用药记录里，哪些信息值得记？",
  "看说明书时，哪里能找到答案？",
  "出门前，怎样整理随身药品？",
  "一起来认识药品的不同剂型",
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

const defaultVoice = "流畅女声 2.0";
const voiceOptions = [defaultVoice, ["女声", "小何 2.0"], ["男声", "云舟 2.0"], "无配音"];
const musicLabels = { off: "无背景音乐", auto: "自动搭配", calm: "舒缓钢琴", light: "轻快木琴" };

const defaults = {
  mode: "ark",
  imageModel: "doubao-seedream-5-5-261028",
  imageSize: "2K",
  videoModel: "doubao-seedance-2-5-flash-261115",
  resolution: "720p",
  ratio: "9:16",
  duration: null,
  watermark: true,
  voice: defaultVoice,
  music: "off",
};

data.settings = { ...defaults, ...data.settings };
data.works ||= [];
const watching = new Set();
const submitting = new Set();
const selectedScenes = new WeakMap();
const rejectedPortraitFrames = new WeakMap();
const maxArticleImages = 16;

// Resume image requests saved by previous sessions.
for (const w of data.works) {
  if (w.job?.target === "regenerate" && w.blocks?.[w.job.index]) {
    w.blocks[w.job.index].job = w.job;
    w.job = null;
  }
  if (!w.costTracking) {
    w.legacyCostMedia ??= workMedia(w);
    w.legacyCostJobs ??= workJobIds(w);
  }
}

if (!data.fluentVoiceDefaultApplied) {
  data.settings.voice = defaultVoice;
  data.fluentVoiceDefaultApplied = true;
  save();
}

if (!data.arkDefaultApplied) {
  data.settings.mode = "ark";
  data.arkDefaultApplied = true;
  save();
}

if (!data.musicOffDefaultApplied) {
  if (data.settings.music === "auto") data.settings.music = defaults.music;
  data.musicOffDefaultApplied = true;
  save();
}

function save() {
  localStorage.setItem(storeKey, JSON.stringify(data));
}

function notify(text, tone = "") {
  const el = $("#notice");
  el.textContent = text;
  el.className = tone;
  void el.offsetWidth;
  el.classList.add("show");
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

function workMedia(w) {
  return [w.video?.url, ...(w.blocks ?? []).map((block) => block.image)]
    .filter((url) => url?.startsWith("/media/"));
}

function workJobIds(w) {
  return [w.job, ...(w.blocks ?? []).map((block) => block.job)]
    .flatMap((job) => job?.payload?.id ? [job.payload.id] : []);
}

const feeAmount = new Intl.NumberFormat("zh-CN", {
  style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 6,
});

function renderWorkCosts(w, result) {
  const partial = !w.costTracking || result.unresolved || result.rows.some((row) => row.amount === null);
  const total = result.total ?? (!partial && result.rows.length === 0 ? 0 : null);
  const summary = total === null ? "暂无法估算" : feeAmount.format(total);
  const rows = result.rows.map(({ label, model, usage, amount }) => (
    '<div class="cost-line"><dt><strong>' + esc(label) + '</strong><span>' +
    esc([model, usage].filter(Boolean).join(" · ")) + '</span></dt><dd>' +
    (amount === null ? "待核对" : feeAmount.format(Number(amount))) + '</dd></div>'
  )).join("");
  return '<p class="cost-work-title">' + esc(w.title || w.topic || "未命名作品") + '</p>' +
    '<div class="cost-total"><span>' + (partial ? "可估算项目小计" : "估算费用合计") +
    '</span><strong>' + summary + '</strong></div>' +
    (rows ? '<dl class="cost-lines">' + rows + '</dl>' : '<p class="small">暂无可核对的费用明细。</p>') +
    (!w.costTracking ? '<p class="footmeta">旧作品可能缺少早期文字用量，或缺少已替换素材的任务记录。</p>' : '') +
    (result.unresolved ? '<p class="footmeta">部分任务的用量仍待核对。</p>' : '') +
    '<p class="footmeta">按公开按量单价估算，账户折扣、资源包与实付金额以服务商账单为准。</p>' +
    '<p class="cost-sources small">' + esc(result.priceDate) + ' 核对单价' +
    '<a href="' + esc(result.arkPrice) + '" target="_blank" rel="noopener noreferrer">方舟价格</a>' +
    '<a href="' + esc(result.speechPrice) + '" target="_blank" rel="noopener noreferrer">语音价格</a></p>';
}

async function openWorkCosts(w) {
  openModal("费用详情", '<div id="cost-content"><p class="small" role="status">正在读取费用明细…</p></div>', "work-costs");
  const panel = $("#cost-content", dialogBody);
  try {
    const result = await jsonRequest("/api/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workId: w.id,
        jobIds: [...new Set([...workJobIds(w), ...(w.legacyCostJobs ?? [])])],
        media: [...new Set([...workMedia(w), ...(w.legacyCostMedia ?? [])])],
      }),
    });
    if (dialog.open && panel.isConnected) panel.innerHTML = renderWorkCosts(w, result);
  } catch (error) {
    if (dialog.open && panel.isConnected) {
      panel.innerHTML = '<p class="banner err" role="alert">' + esc(error.message) + '</p>' +
        btn("重新读取", "work-costs", "secondary", w.id);
    }
  }
}

function videoMusic(w) {
  if (!config.videoBackgroundMusic) return "off";
  const choice = w.settings.music ?? defaults.music;
  if (choice !== "auto") return choice;
  const topic = `${w.title} ${w.topic}`;
  const narration = w.blocks.map((block) => block.line).join(" ");
  if (/急救|急症|误服|中毒|呼吸困难|昏迷|胸痛|心梗|卒中|严重不良反应/.test(`${topic} ${narration}`)) return "calm";
  return /清单|整理|出门|认识|记录|读懂|怎么看|怎么读/.test(topic) ? "light" : "calm";
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
  const chars = spokenChars(String(text || ""));
  const est = chars ? Math.max(1, Math.round(chars / videoSpeechRate)) : 0;
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
      '" aria-hidden="true"></span><span class="mode-label">默认：' +
      (gs.mode === "ark" ? "火山方舟" : "本地演示") +
      "</span>" +
      ico("settings");
  }
  const worksEl = $("#nav-works");
  if (worksEl) {
    const onWorks = route()[0] !== "work" && tab === "works";
    worksEl.classList.toggle("active", onWorks);
    if (onWorks) worksEl.setAttribute("aria-current", "page");
    else worksEl.removeAttribute("aria-current");
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

function openApiKeys(focus = "ark") {
  const storageHint = {
    "mac-keychain": "保存到当前用户的 macOS 钥匙串，重启后自动读取。",
    "windows-dpapi": "使用当前 Windows 用户凭据加密保存，重启后自动读取。",
  }[config.keyStorage];
  const serviceHint = config.keyStorage === undefined
    ? "当前服务仍使用旧版保存方式。下次启动工作台后，请重新填写需要保存在本机的 Key。"
    : storageHint;
  openModal(
    "API Key 管理",
    (serviceHint ? '<p class="footmeta">' + serviceHint + "</p>" : "") +
    '<form id="ark-key-form" class="credential-form">' +
      '<div class="card-head"><h3>文字、图片与视频 · 火山方舟</h3><span class="small" data-key-status>' +
      (config.keySaved ? "已保存到本机" : config.keyPresent ? "已配置" : "未配置") + "</span></div>" +
      '<label class="field" for="ark-key">方舟 API Key</label>' +
      '<input type="password" id="ark-key" required maxlength="512" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="ark-key-hint">' +
      '<p class="footmeta" id="ark-key-hint">' +
      esc(config.keyWarning || "") +
      (config.keySource === "environment" ? "当前使用环境变量中的 Key。" : "") +
      '验证时只查询模型列表，成功后保存。</p>' +
      '<p class="banner err" id="ark-key-error" role="alert" hidden></p>' +
      '<button type="submit" class="primary">验证并连接</button></form>' +
      '<form id="speech-key-form" class="credential-form">' +
      '<div class="card-head"><h3>配音 · 豆包语音</h3><span class="small" data-key-status>' +
      (config.speechKeySaved ? "已保存到本机" : config.speechKeyPresent ? "已配置" : "未配置") + "</span></div>" +
      '<label class="field" for="speech-key">豆包语音 API Key</label>' +
      '<input type="password" id="speech-key" required maxlength="512" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="speech-key-hint">' +
      (config.speechKeyWarning ? '<p class="banner warn" data-storage-warning>' + esc(config.speechKeyWarning) + "</p>" : "") +
      '<p class="footmeta" id="speech-key-hint">' +
      (storageHint ? "" : "语音 Key 仅在本次运行中使用。") +
      '使用已开通语音合成 2.0 的项目 Key，提交配音时校验并按字符计费。<a href="https://console.volcengine.com/speech/new/setting/apikeys" target="_blank" rel="noopener noreferrer">获取语音 Key</a></p>' +
      '<p class="banner err" id="speech-key-error" role="alert" hidden></p>' +
      '<button type="submit" class="primary">保存语音 Key</button></form>',
    "api-keys",
  );
  $(focus === "speech" ? "#speech-key" : "#ark-key").focus();
}

dialog.addEventListener("submit", async (event) => {
  const form = event.target;
  const speech = form.id === "speech-key-form";
  if (!speech && form.id !== "ark-key-form") return;
  event.preventDefault();
  const input = form.querySelector(speech ? "#speech-key" : "#ark-key");
  const feedback = form.querySelector(speech ? "#speech-key-error" : "#ark-key-error");
  const submit = form.querySelector('button[type="submit"]');
  const buttonLabel = submit.textContent;
  if (submit.disabled) return;
  submit.disabled = true;
  submit.textContent = speech ? "正在保存…" : "正在验证…";
  input.readOnly = true;
  feedback.hidden = true;
  try {
    const status = await jsonRequest(speech ? "/api/speech-key" : "/api/ark-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: input.value.trim() }),
    });
    Object.assign(config, status);
    input.value = "";
    if (form.isConnected) {
      form.querySelector("[data-storage-warning]")?.remove();
      const saved = speech ? status.speechKeySaved : status.keySaved;
      form.querySelector("[data-key-status]").textContent = saved ? "已保存到本机" : "已配置";
      if (!speech) {
        $("#ark-key-hint", form).textContent = status.keySaved
          ? "验证通过，Key 已保存到本机。"
          : "验证通过，Key 仅在本次运行中使用。";
      }
    }
    render(true);
    notify(
      speech
        ? "已保存火山语音 Key"
        : status.keySaved
          ? "已连接火山方舟，Key 已保存到本机"
          : "已连接火山方舟，本次运行可用",
      "ok",
    );
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
    input.readOnly = false;
    input.focus();
  } finally {
    input.readOnly = false;
    submit.disabled = false;
    submit.textContent = buttonLabel;
  }
});

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
      "本地演示",
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
    ? '<div class="banner warn">连接火山方舟后可生成自定义文字和图片或视频素材。' +
        '<div class="banner-actions">' +
        btn("连接火山方舟", "connect-ark", "secondary") +
        btn("切换为本地演示", switchAction, "secondary", "demo") +
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
  const musicField = which !== "article" && config.videoBackgroundMusic
    ? field("背景音乐", "music", Object.entries(musicLabels), s.music ?? defaults.music, true)
    : "";
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
        field("配音", "voice", voiceOptions, s.voice);
    }
    h += musicField + "</div>";
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
      h += field("配音", "voice", voiceOptions, s.voice);
    }
    h += musicField + "</div>";
    h +=
      '<div class="mode-box" style="margin-top:12px">使用内置示例图' +
      (which === "article"
        ? "生成图文演示"
        : "合成 480p 演示视频。启用配音时，火山语音按字符计费") +
      "。内置主题可用本地稿件演示，自定义内容由方舟生成，确认后按量计费。</div>";
  }
  if (which === "video" && !config.speechKeyPresent) {
    h += '<div class="banner-actions">' +
      btn("配置火山语音", "configure-speech", "secondary") +
      "</div>";
  }
  return h;
}

function prefs(w) {
  modalScope = w?.id || "global";
  const s = w ? w.settings : data.settings;
  const styleField = w ? field(w.type === "video" ? "画面风格" : "插图风格", "imageStyle",
    styles.map((label, i) => [String(i), label]), String(w.style)) : "";
  openModal(
    w ? "本作品生成参数" : "新作品默认参数",
    settingsFields(s, w ? w.type : "all", "modal-mode") +
      (styleField ? '<div class="formrow">' + styleField + "</div>" : "") +
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
    layout: articleLayouts[0].name,
    style,
    drug: "",
    tags: [],
    settings: s,
    costTracking: !!config.workCosts,
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
    '<div class="topline"><div><h1>科普制作</h1><p class="subtitle">选择内容形式，生成可编辑、可核对的用药科普草稿。</p></div>' +
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
              '"><span class="tag st-' +
              (w.job ? "job" : w.stage) +
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
                ? (w.blocks.length ? `视频科普 · ${videoTotalSeconds(w)} 秒` : "视频科普")
                : "图文科普 · " + w.layout) +
              "</span>" +
              (w.drug ? '<span class="pill">' + esc(w.drug) + "</span>" : "") +
              "<span>" +
              new Date(w.updated).toLocaleDateString() +
              "</span></div></button>" +
              (config.workCosts ? btn("费用详情", "work-costs", "textbtn card-costs", w.id) : "") +
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
          '<span class="step-num" aria-hidden="true">' +
          (isDone ? ico("check") : j + 1) +
          "</span>" +
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
          (j > 0 ? '<span class="step-sep" aria-hidden="true"></span>' : "") +
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
  const actions = (config.workCosts ? btn("费用详情", "work-costs", "textbtn", w.id) : "") + rightHead;
  app.innerHTML =
    '<nav class="subnav" aria-label="工作台导航">' +
    btn(ico("back") + " 返回工作台", "home", "back") +
    (actions ? '<div class="buttons">' + actions + '</div>' : "") +
    "</nav>" +
    '<div class="section-head"><h1>' +
    esc(title) +
    "</h1></div>" +
    steps(w, activeStep) +
    html;
  app.querySelectorAll("textarea.autogrow").forEach(autoGrow);
  syncImageActions(w);
}

function autoGrow(el) {
  if (CSS.supports?.("field-sizing", "content") || !el.offsetParent) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
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

function styleChoice(value, label) {
  return (
    '<div class="formrow">' + (label ? '<span class="label">' + esc(label) + "</span>" : "") + '<div class="style-grid">' +
    styles
      .map((s, i) =>
        btn(
          '<img src="' + asset(i) + '" alt=""><span>' + esc(s) + "</span>",
          "style",
          "style-opt" + (i === value ? " selected" : ""),
          i,
          'aria-pressed="' + (i === value) + '"',
        ),
      )
      .join("") +
    "</div></div>"
  );
}

function layoutChoice(value) {
  const selected = articleLayouts.find(({ name }) => name === value);
  return (
    '<div class="formrow"><span class="label">内容风格</span><div class="style-grid article-layout-grid">' +
    articleLayouts
      .map(({ name, preview }, i) =>
        btn(
          '<span class="article-layout-preview" aria-hidden="true">' +
            preview +
            '</span><span class="style-label">' +
            esc(name) +
            "</span>",
          "layout",
          "style-opt" + (name === value ? " selected" : ""),
          i,
          'aria-pressed="' + (name === value) + '"' +
            (name === value ? ' aria-describedby="article-layout-detail"' : ""),
        ),
      )
      .join("") +
    '</div><p id="article-layout-detail" class="small article-layout-detail">' +
    esc(selected?.description || "") + "</p></div>"
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
    ' / 300</span></div><textarea id="topic" data-bind="topic" maxlength="300" rows="4" placeholder="' + (video
      ? "例如：给第一次用滴眼液的患者讲清使用前后要注意什么；开头用一个常见错误引入，结尾提醒有疑问问药师"
      : "例如：给家里有老人的读者讲清药盒上的有效期怎么看；开封后的药怎样核对（可换行列出要点）") + '">' +
    esc(w.topic) +
    '</textarea><p class="field-error" id="topic-error" hidden>请先填写科普主题，再开始生成。</p><div class="dividerline"></div><div class="formrow"><span class="label">关联药品 <small>（选填）</small></span><div class="buttons">' +
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
    const reference = videoReferenceSeconds(w);
    left +=
      '<div class="sheet"><div class="card-head"><h2>视频设置</h2></div>' +
      styleChoice(w.style, "画面风格") +
      choice(
        "参考时长",
        videoReferenceDurations.map((seconds) => seconds === null ? "自动" : `${seconds} 秒`),
        reference === null ? "自动" : `${reference} 秒`,
        "duration",
      ) +
      choice(
        "出镜形象",
        ["无人物", "药师出镜"],
        w.avatar === pharmacistAvatar ? "药师出镜" : "无人物",
        "avatar",
      ) +
      "</div>";
  } else {
    left +=
      '<div class="sheet"><div class="card-head"><h2>文章排版</h2></div>' +
      layoutChoice(w.layout) +
      '</div><div class="sheet"><div class="card-head"><h2>插图风格</h2></div>' +
      styleChoice(w.style) +
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
        video ? "重新生成分镜脚本" : "重新生成图文草稿",
        "regenerate-all",
        "secondary widebtn",
      ) +
      "</div>"
    : btn(
        video ? "生成分镜脚本" : "生成图文草稿",
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

function sceneDescription(w, prompt) {
  const value = prompt.trim();
  const legacy = styles.find((name) => value.startsWith(name + "；"));
  const scene = legacy ? value.slice(legacy.length + 1).trim() : value;
  if (w.type !== "video") return scene;
  return scene.split("；").filter((part) => {
    const label = part.trim();
    return label !== pharmacistAvatar && label !== "无人物";
  }).join("；").trim();
}

function visualStyleRule(w) {
  const [name, treatment] = visualStyles[w.style];
  return `画风：「${name}」，${treatment}`;
}

function framing(w) {
  const ratio = w.settings.ratio;
  const shape = { "16:9": "横构图", "1:1": "方构图" }[ratio] || "竖构图";
  if (w.type !== "video") return `构图：${shape}，主体清楚，背景简洁，适合在手机上阅读。`;
  return `构图：${shape}，主体集中在画面中部，下方约${ratio === "9:16" ? "四分之一" : "五分之一"}保持简洁，留给后期字幕。`;
}

function presenterRule(w, objectOnly, moving) {
  if (objectOnly) return "人物：画面中没有人物和手，只拍物品。";
  if (w.avatar === pharmacistAvatar) {
    return moving
      ? "人物：保持同一位药师的发型、服装和外观，不新增其他人物；药师用手势或道具讲解，嘴巴自然闭合，不说话。"
      : "人物：同一位药师，发型、服装和外观与全片一致，用手势或道具讲解，不对着镜头说话。";
  }
  return moving
    ? "人物：不出现人脸和身体；动作需要时只出现一双手。"
    : "人物：不出现人脸和身体；需要动作时只画一双自然的手，没有动作时只画物品。";
}

function storyboardPrompt(w, index, prompt, matchNext) {
  const block = w.blocks[index];
  const scene = sceneDescription(w, prompt);
  const objectOnly = scene.startsWith(objectOnlyFrame);
  const motion = objectOnly ? "镜头缓慢推近，依次聚焦本幕的物品。" : (block.motion || "").trim() || defaultMotion;
  const line = block.line.trim().replace(/\s+/g, " ");
  return [
    `本幕动作：${motion}`,
    genericMotions.has(motion) && line && `本幕讲解内容（只用来理解动作，不出现在画面中）：${line.slice(0, 200)}`,
    "节奏：动作幅度小、速度平缓，一个动作做完再开始下一个；镜头运动平稳，不切换场景。",
    scene && `首帧内容：${scene.slice(0, 240)}`,
    "保持首帧的场景、光线、道具外观和画风，不新增其他物品。",
    presenterRule(w, objectOnly, true),
    matchNext
      ? "动作完成后，沿同一件道具或同一方向平稳过渡到给定尾帧。尾帧只用来衔接，下一幕的动作留到下一幕。"
      : "动作完成后，镜头平稳停住。",
    `画风：保持「${styles[w.style]}」。`,
    "画面中不出现文字、字幕和数字，包装和屏幕保持无字。",
  ].filter(Boolean).join("\n").slice(0, 2050);
}
function sceneImageState(block) {
  if (block.job?.error) return "配图失败";
  if (block.job?.referenceAfter) return "等待基准图";
  if (block.job) return "生成中";
  return block.image ? "已配图" : "待配图";
}

function storyboardSwitcher(w, selected) {
  return '<nav class="scene-switcher" aria-label="切换分镜">' +
    w.blocks.map((block, i) => btn(
      '<span class="scene-name"><b>' + (i + 1) + '</b><span data-scene-name>' +
      esc(block.name.trim() || "未命名分镜") + '</span></span><span class="scene-state" data-scene-state>' +
      sceneImageState(block) + '</span>',
      "select-scene", "scene-choice", i, 'aria-pressed="' + (i === selected) + '"',
    )).join("") + '</nav>';
}

function selectScene(w, index) {
  if (!w.blocks[index]) return;
  selectedScenes.set(w, w.blocks[index]);
  render(true);
  app.querySelector('.scene-choice[aria-pressed="true"]')?.focus({ preventScroll: true });
}

function revealSelectedScene() {
  const selected = app.querySelector('.scene-choice[aria-pressed="true"]');
  if (!selected) return;
  const rail = selected.parentElement;
  const start = selected.offsetLeft - 3;
  const end = selected.offsetLeft + selected.offsetWidth + 3;
  if (start < rail.scrollLeft) rail.scrollLeft = start;
  else if (end > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = end - rail.clientWidth;
}

function pictureControls(w, b, i, quiet = false) {
  const origin = b.image?.startsWith("/assets/")
    ? "本地示例图"
    : config.imageModels[b.imageModel]?.[0] || "火山方舟生成";
  return (
    '<div class="picture-slot" data-picture="' +
    i +
    '"' +
    (quiet ? ' data-quiet="1"' : "") +
    '><div class="picture-frame" data-ratio="' +
    esc(w.settings.ratio) +
    '">' +
    (b.image
      ? '<img class="picture" src="' +
        esc(b.image) +
        '" alt="第 ' +
        (i + 1) +
        ' 张配图">'
      : w.type === "video" && (!b.job || b.job.error)
        ? '<span class="picture-placeholder">待生成分镜图</span>'
        : "") +
    (b.job && !b.job.error
      ? '<div class="picture-overlay" role="status"><span class="picture-busy"><span class="spinner" aria-hidden="true"></span>' +
        (b.job.referenceAfter ? "等待基准图" : "正在生成这张图") + '</span></div>'
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
            (styles[b.imageStyle] ? " · " + esc(styles[b.imageStyle]) : "") +
            "</span>"
          : '<span class="small">暂未添加配图</span>') +
        (w.stage === "review"
          ? ""
          : btn(
              b.image ? "重新生成这张图" : w.type === "video" ? "生成这张分镜图" :
                b.suggestedImage ? "生成本段建议配图" : "为这段配图",
              "reimage",
              quiet ? "textbtn" : "outline",
              i,
            )) +
        "</div>") +
    "</div>"
  );
}

function inlineJobError(job, index = "") {
  const dismiss = job.target === "initial-image"
    ? "跳过这张图"
    : index === "" ? "关闭提示" : "取消重做";
  return (
    '<div class="banner err" role="alert">配图生成未完成：' +
    esc(job.error) +
    '<div class="banner-actions">' +
    btn("重试", "retry", "secondary", index) +
    btn(dismiss, "abort-job", "textbtn", index) +
    "</div></div>"
  );
}

function syncImageActions(w) {
  const pending = w.blocks.some((b) => b.job);
  const missing = w.type === "video" && w.blocks.some((b) => !b.image);
  for (const el of app.querySelectorAll(
    '[data-action="compose"], [data-action="submit"]',
  )) {
    const composing = el.dataset.action === "compose";
    el.disabled = pending || (composing ? missing : !!w.videoDirty);
    el.title = pending
      ? "请等待配图完成，或处理失败的配图"
      : composing && missing
        ? "请先为全部分镜生成配图"
        : !composing && w.videoDirty
        ? "分镜已变更，请先重新合成视频"
        : "";
  }
  for (const el of app.querySelectorAll('[data-action="remove-block"]')) {
    el.disabled =
      w.blocks.length <= 2 || !!w.blocks[Number(el.dataset.val)]?.job;
  }
  for (const el of app.querySelectorAll('[data-action="move-block"]')) {
    const [index, direction] = el.dataset.val.split(":").map(Number);
    const neighbor = w.blocks[index + direction];
    el.disabled = !neighbor || !!neighbor.job || !!w.blocks[index]?.job;
  }
  const regenerate = app.querySelector('[data-action="regenerate-all"]');
  if (regenerate) {
    regenerate.disabled = w.blocks.some((b) => b.job && !b.job.error);
  }
  const stale = app.querySelector("#video-stale");
  if (stale) stale.hidden = !w.videoDirty;
  const suggested = app.querySelector('[data-action="fill-article-images"]');
  if (suggested) {
    const count = missingBlockImages(w).length;
    suggested.hidden = !count;
    suggested.textContent = `生成建议配图（${count} 张）`;
  }
  const restyle = app.querySelector('[data-action="restyle-images"]');
  if (restyle) {
    const count = w.blocks.filter((block) => block.image).length;
    restyle.hidden = count < 2;
    restyle.disabled = pending;
    restyle.textContent = `统一重做配图（${count} 张）`;
  }
  const imageProgress = app.querySelector("#storyboard-image-progress");
  if (imageProgress) {
    const ready = w.blocks.filter((b) => b.image).length;
    const failed = w.blocks.filter((b) => b.job?.error).length;
    const progress = `分镜配图 ${ready} / ${w.blocks.length}` +
      (failed ? ` · ${failed} 张失败` : "");
    if (imageProgress.textContent !== progress) imageProgress.textContent = progress;
    const fill = app.querySelector('[data-action="fill-video-images"]');
    fill.hidden = !missing;
    fill.disabled = !w.blocks.some((b) => !b.image && !b.job);
    for (const el of app.querySelectorAll(".scene-choice")) {
      const state = el.querySelector("[data-scene-state]");
      const label = sceneImageState(w.blocks[Number(el.dataset.val)]);
      if (state.textContent !== label) state.textContent = label;
      state.dataset.state = label;
    }
  }
}

function updateJobView(w, owner, finished = false) {
  if (current() !== w) return;
  if (owner !== w) {
    const index = w.blocks.indexOf(owner);
    const slot = app.querySelector('[data-picture="' + index + '"]');
    if (slot) {
      slot.outerHTML = pictureControls(w, owner, index, !!slot.dataset.quiet);
    }
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
  const { index, mode, prompt, imageModel, imageSize, reference } = regenModal;
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
    '<label class="field">' + (w.type === "video" ? "本幕首帧画面（选填）" : "画面描述（选填）") +
    '<textarea id="imageprompt" rows="3" maxlength="1800" placeholder="例如：近景，一只手把药盒转到侧面，手指停在印日期的位置">' +
    esc(prompt) +
    "</textarea></label>";

  if (isArk) {
    body +=
      '<details class="shot-options"><summary>查看完整生成提示词</summary>' +
      '<textarea id="generated-image-prompt" rows="5" readonly aria-label="提交给方舟的提示词">' +
      esc(picturePrompt(w, index, prompt, reference)) + '</textarea></details>' +
      '<div class="fields" style="margin-top:11px">' +
      '<label class="field">生图模型<select id="picture-model">' +
      opts(models, imageModel) +
      '</select></label><label class="field">清晰度<select id="picture-size">' +
      opts(config.imageModels[imageModel][1], imageSize) +
      "</select></label></div>" +
      '<p class="footmeta">沿用所选风格「' + esc(styles[w.style]) + '」。仅生成这一张，成功后原位替换，按方舟实际用量计费。</p>' +
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
      '<div class="mode-box" style="margin-top:12px">使用「' + esc(styles[w.style]) + '」的内置样图并保存提示词。</div>' +
      '<div style="margin-top:14px">' +
      btn("使用所选风格样图", "regen-demo", "primary widebtn", index) +
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
  const needsReplacement = rejectedPortraitFrames.get(w)?.has(block.image);
  const prompt = needsReplacement ? objectOnlyFrame + "用道具近景表现本幕口播中的核对要点。" : sceneDescription(w, block.prompt);
  regenModal = {
    index,
    mode: w.settings.mode,
    prompt,
    reference: prompt.startsWith(objectOnlyFrame) ? "" : pictureReference(w, [block]),
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
    '<span class="shot-badge">' +
    (vid ? "分镜 " : "第 ") +
    (i + 1) +
    (vid ? "" : " 段") +
    "</span>" +
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
    '<div class="shot-body"><div class="shot-main">' +
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
    '" class="autogrow" data-block="' +
    i +
    '" data-key="line" placeholder="' +
    (vid ? "填写这一幕药师讲解的口播句子" : "填写这一段的科普正文") +
    '">' +
    esc(b.line) +
    "</textarea>" +
    (vid
      ? '<details class="shot-options"><summary>运镜要求与单镜时长（' +
        b.seconds +
        " 秒）</summary>" +
        '<label class="field">画面动作与镜头衔接<textarea rows="2" maxlength="400" data-block="' +
        i +
        '" data-key="motion">' +
        esc(b.motion || defaultMotion) +
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
    '</div><div class="shot-media">' +
    pictureControls(w, b, i) +
    "</div></div></section>"
  );
}

// Use the same reading surface in the editor and the finished draft.
function articlePaper(w, editable) {
  const qa = w.layout === "避坑问答版";
  const deep = w.layout === "临床深度版";
  function field(value, label, binding, limit, tag, cls) {
    if (!editable) return `<${tag} class="${cls}">${esc(value)}</${tag}>`;
    return `<textarea rows="1" class="autogrow ${cls}" aria-label="${label}" placeholder="${label}" maxlength="${limit}" ${binding}>${esc(value)}</textarea>`;
  }
  const sections = w.blocks.map((b, i) => {
    const binding = `data-block="${i}"`;
    const heading = field(b.name, `第 ${i + 1} 段小标题`, binding + ' data-key="name"', 60, "h3", "paper-heading");
    const text = field(b.line, `第 ${i + 1} 段正文`, binding + ' data-key="line"', 1800, "p", "paper-text");
    const tools = editable ? '<div class="paper-tools">' +
      btn(ico("up"), "move-block", "icon-btn", i + ":-1", 'aria-label="上移本段"') +
      btn(ico("down"), "move-block", "icon-btn", i + ":1", 'aria-label="下移本段"') +
      btn(ico("trash"), "remove-block", "icon-btn danger", i, 'aria-label="移除本段"') + "</div>" : "";
    const marker = qa ? "问" : deep ? "" : String(i + 1).padStart(2, "0");
    return '<section class="paper-section"><div class="paper-section-head">' +
      (marker ? '<span class="paper-marker" aria-hidden="true">' + marker + "</span>" : "") +
      heading + tools + '</div><div class="paper-copy">' +
      (qa ? '<span class="paper-answer">答</span>' : "") + text + "</div>" +
      pictureControls(w, b, i, true) + "</section>";
  }).join("");
  return '<article class="sheet article-paper"><header><span class="paper-edition">' + esc(w.layout) +
    "</span>" + field(w.title, "作品标题", 'data-bind="title"', 300, "h2", "paper-title") +
    '</header><div class="paper-intro"><b>药师导读</b>' +
    field(w.lead, "药师导读", 'data-bind="lead"', 600, "p", "paper-lead") + "</div>" + sections +
    (editable ? btn(ico("plus") + " 添加一段正文", "append", "textbtn") :
      '<p class="ai-note">内容与配图由 AI 辅助生成，发布前请药师核对专业表述。</p>') +
    "</article>";
}

function editor(w) {
  const vid = w.type === "video";
  const s = w.settings;
  const music = s.music ?? defaults.music;
  const ranges = vid ? shotRanges(w.blocks) : [];
  const totalSec = vid ? videoTotalSeconds(w) : 0;
  const selected = Math.max(0, w.blocks.indexOf(selectedScenes.get(w)));

  const body = vid
    ? '<div class="sheet"><label class="field">作品标题<input maxlength="300" data-bind="title" value="' +
      esc(w.title) + '" placeholder="输入清晰易懂的科普标题"></label>' +
      '<label class="field" style="margin-top:10px">全片场景与道具<textarea rows="2" maxlength="240" class="autogrow" data-bind="setting" placeholder="例如：家中客厅的浅色木桌，桌上有白色药箱、一盒浅蓝色药盒和米色记录本">' +
      esc(w.setting || "") + '</textarea></label><p class="footmeta">生成分镜图时沿用这里的场景，让各幕道具保持一致。</p></div>' +
      '<div class="sheet"><div class="card-head"><h2>分镜脚本</h2><span class="small">共 ' +
      w.blocks.length + " 幕 · " + totalSec + " 秒</span></div>" +
      storyboardSwitcher(w, selected) +
      (w.blocks[selected] ? blockEditor(w, w.blocks[selected], selected, ranges[selected]) : "") +
      '<div class="flexwrap" style="margin-top:12px">' +
      btn(ico("plus") + " 添加一幕分镜", "append", "secondary", "", w.blocks.length >= maxVideoShots ? "disabled" : "") +
      btn("按口播调整时长", "time-shots", "secondary") +
      "</div></div>"
    : articlePaper(w, true);

  const summaryPills = [
    s.mode === "ark"
      ? vid
        ? config.videoModels[s.videoModel][0]
        : config.imageModels[s.imageModel][0]
      : "内置示例素材",
    "画幅 " + s.ratio,
    styles[w.style],
    ...(vid
      ? [s.mode === "ark" ? s.resolution : "480p", s.voice, totalSec + " 秒"]
      : s.mode === "ark"
        ? [s.imageSize]
        : []),
    ...(vid && config.videoBackgroundMusic ? [music === "off" ? musicLabels.off : `配乐 · ${musicLabels[music]}`] : []),
    ...(w.drug ? ["药品：" + w.drug] : []),
  ];

  const aside =
    '<div class="sheet"><div class="card-head"><h2>' +
    (vid ? "合成准备" : "预览与发布") +
    '</h2><span class="status-pill">' +
    (s.mode === "ark" ? "火山方舟" : "本地演示") +
    '</span></div><div class="summary-kv">' +
    summaryPills.map((p) => '<span class="pill">' + esc(p) + "</span>").join("") +
    "</div>" +
    (s.mode === "ark" ? arkKeyWarning("set-mode") : "") +
    '<div style="margin-top:12px">' +
    btn("调整模型参数", "work-settings", "outline widebtn") +
    "</div>" +
    (vid
      ? '<div class="storyboard-progress stack-actions">' +
        '<p class="small" id="storyboard-image-progress" role="status"></p>' +
        btn("生成缺失配图", "fill-video-images", "primary widebtn") +
        "</div>"
      : btn("生成建议配图", "fill-article-images", "secondary widebtn", "", 'hidden style="margin-top:12px"')) +
    btn("统一重做配图", "restyle-images", "outline widebtn", "", 'hidden style="margin-top:8px"') +
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
    '</div><p class="footmeta save-state" id="save-state">' +
    savedLabel(w) +
    "</p></div>";

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

const reviewChecks = [
  "药品名称、规格与说明书或外包装一致",
  "未给出个体化剂量，或替代医嘱的用药建议",
  "风险提示与就医、咨询药师的提醒表述完整",
  "配图与字幕中没有错误文字或剂量数字",
];

function savedLabel(w) {
  return (
    "已自动保存到当前浏览器 · " +
    new Date(w.updated).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  );
}

function contentSig(w) {
  const s = JSON.stringify([
    w.title,
    w.lead,
    w.drug,
    w.blocks.map((b) => [b.name, b.line, b.image]),
    w.video?.url,
  ]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Checks only count for the exact content they were ticked against.
function activeChecks(w) {
  return w.checksFor === contentSig(w) ? w.checks || [] : [];
}

function checklist(w) {
  const checks = activeChecks(w);
  const done = reviewChecks.filter((_, i) => checks[i]).length;
  return (
    '<div class="formrow checklist" id="checklist"><div class="field-head"><span class="label">发布前药师自查</span><span class="pace' +
    (done === reviewChecks.length ? " ok" : "") +
    '" id="check-count">' +
    done +
    " / " +
    reviewChecks.length +
    "</span></div>" +
    reviewChecks
      .map(
        (t, i) =>
          '<label class="checkline"><input type="checkbox" data-check="' +
          i +
          '"' +
          (checks[i] ? " checked" : "") +
          "><span>" +
          esc(t) +
          "</span></label>",
      )
      .join("") +
    '<p class="footmeta">修改内容或配图后需重新自查。</p></div>'
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
      ? []
      : (() => {
          const chars = [w.lead, ...w.blocks.map((b) => b.name + b.line)]
            .join("")
            .replace(/\s+/g, "").length;
          return [chars + " 字 · 约 " + Math.max(1, Math.ceil(chars / 400)) + " 分钟读完"];
        })()),
    ...(vid
      ? [
          w.settings.ratio,
          videoTotalSeconds(w) + " 秒",
          w.settings.voice,
          ...(musicLabels[w.video.music] ? [musicLabels[w.video.music]] : []),
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
      '<div id="video-stale" class="banner warn" hidden>分镜或背景音乐已修改。返回分镜编辑并重新合成后，成片会同步更新。</div>' +
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
            pictureControls(w, b, i, true) +
            "</section>",
        )
        .join("") +
      "</details>"
    : articlePaper(w, false);

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
    "</div>" +
    (reviewing ? "" : '<div class="dividerline"></div>' + checklist(w)) +
    '<div class="dividerline"></div><div class="stack-actions">' +
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
      : btn(ico("copy") + " 复制全文内容", "copy-article", "outline widebtn")) +
    (!reviewing ? btn("调整模型参数", "work-settings", "textbtn") : "") +
    "</div></div>";

  shell(
    w,
    reviewing ? "作品审核中" : vid ? "视频成品草稿" : "图文成品草稿",
    2,
    '<div class="layout"><div>' +
      (vid ? '<div class="sheet"><h2 class="articleTitle">' + esc(w.title) +
        '</h2><div class="article-meta">' +
        metaPills.map((m) => '<span class="pill">' + esc(m) + "</span>").join("") +
        "</div>" + body + "</div>" : body + '<div class="article-meta paper-meta">' +
        metaPills.map((m) => '<span class="pill">' + esc(m) + "</span>").join("") + "</div>") +
      '</div><aside class="aside">' +
      panel +
      "</aside></div>",
    btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
  );
}

function portraitRejected(job) {
  return job?.target === "compose" && job.payload.mode === "ark" &&
    /InputImageSensitiveContentDetected\.PrivacyInformation|input image[^\n]*may contain real person/i.test(job.error || "");
}

function rejectedFrameIndex(w) {
  const position = /^制作分镜\s+(\d+)\s*\//.exec(w.job?.progress || "");
  if (!position) return -1;
  const currentIndex = Number(position[1]) - 1;
  const tailRejected = w.job.payload.items[currentIndex]?.matchNext && /content\[2\]/i.test(w.job.error || "");
  const index = currentIndex + (tailRejected ? 1 : 0);
  const image = w.job.payload.items[index]?.image;
  if (!image) return -1;
  return w.blocks[index]?.image === image ? index : w.blocks.findIndex((block) => block.image === image);
}

function rememberRejectedFrame(w) {
  const index = rejectedFrameIndex(w);
  if (index < 0) return;
  const images = rejectedPortraitFrames.get(w) || new Set();
  images.add(w.blocks[index].image);
  rejectedPortraitFrames.set(w, images);
}

function jobView(w) {
  const failed = !!w.job.error;
  const writing = w.job.target === "write-draft";
  const rejected = portraitRejected(w.job);
  const rejectedIndex = rejected ? rejectedFrameIndex(w) : -1;
  const portraitMessage = rejected &&
    (rejectedIndex >= 0 ? `方舟判定第 ${rejectedIndex + 1} 幕的首帧可能含真人。` : "方舟判定本次使用的首帧可能含真人。") +
    "换成无人物画面后再合成。想保留现有图片，也可以返回编辑页切换到本地演示，合成静帧视频。";
  const recovery = rejected
    ? (rejectedIndex >= 0 ? btn(`重做第 ${rejectedIndex + 1} 幕无人物首帧`, "replace-portrait-frame", "primary") : "")
    : btn(w.job.partial ? "重试配图规划" : "继续此任务", "retry", "primary");
  shell(
    w,
    failed ? "生成任务需要处理" : writing ? (w.type === "article" ? "正在生成文章" : "正在生成分镜脚本") : "正在合成视频",
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
          ? (rejected ? portraitMessage : w.job.error)
          : writing ? "生成完成后，草稿会保存在「我的作品」。" : "合成期间可先返回工作台处理其他草稿，已完成的分镜会自动复用。",
      ) +
      '</div>' + (rejected ? '<details class="shot-options"><summary>查看方舟原始报错</summary><p class="footmeta">' +
        esc(w.job.error) + "</p></details>" : "") + '<div class="actions">' +
      (failed
        ? recovery +
          (w.job.partial ? btn("保留正文，稍后配图", "keep-written-article", "secondary") : "") +
          btn(writing ? "返回主题设置" : "返回分镜编辑", "abort-job", "secondary")
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

async function recoverFinishedJob(w) {
  const job = w.job;
  let result;
  try {
    result = await jsonRequest("/api/jobs/" + job.payload.id);
  } catch {
    return; // Keep the saved failure and its retry controls while offline.
  }
  if (w.job !== job || !job.error) return;
  if (result.status === "done") {
    job.error = "";
    poll(w);
  } else if (result.status === "failed" && portraitRejected(job) && result.progress && job.progress !== result.progress) {
    job.progress = result.progress;
    save();
    updateJobView(w, w);
  } else if (job.target === "write-draft" && result.status === "failed" && result.output?.sections && !job.partial) {
    job.partial = result.output;
    job.error = result.error;
    save();
    updateJobView(w, w);
  }
}

async function poll(w, owner = w) {
  const job = owner.job;
  if (!job || job.referenceAfter || submitting.has(job.payload.id) || watching.has(job.payload.id)) {
    return;
  }
  watching.add(job.payload.id);
  try {
    while (owner.job === job && !job.error) {
      try {
        const result = await jsonRequest("/api/jobs/" + job.payload.id);
        if (owner.job !== job) return;
        if (result.status === "failed") {
          job.progress = result.progress || job.progress;
          if (job.target === "write-draft" && result.output?.sections) job.partial = result.output;
          throw Error(result.error);
        }
        if (result.status === "done") {
          let ready = [];
          if (job.target === "compose") {
            w.video = result.output;
            if (result.output.shotSeconds?.length === w.blocks.length) {
              result.output.shotSeconds.forEach((seconds, index) => { w.blocks[index].seconds = seconds; });
            }
            w.renderMode = job.payload.mode;
            w.stage = "draft";
            w.videoDirty = false;
            w.viewingSetup = false;
          } else if (job.target === "write-draft") {
            applyWrittenDraft(w, result.output);
          } else {
            const single = owner !== w;
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
              block.imageStyle = job.payload.styleReference ? job.payload.style : undefined;
              block.storyboardFrame = job.payload.storyboard === true && job.payload.mode === "ark";
              if (job.target === "regenerate") {
                block.prompt = job.prompt;
                block.variant = (block.variant || 0) + 1;
              }
            });
            if (job.referenceLeader) {
              ready = w.blocks.filter((block) => block.job?.referenceAfter === job.payload.id);
              for (const block of ready) {
                block.job.payload.items[0].reference = owner.image;
                delete block.job.referenceAfter;
                block.job.readyToSend = true;
              }
            }
            if (single && w.type === "video" && w.video) w.videoDirty = true;
            if (!single) {
              w.stage = w.type === "video" ? "script" : "draft";
              w.editing = false;
              w.viewingSetup = false;
            }
          }
          owner.job = null;
          w.updated = Date.now();
          if (job.articleImages && data.works.includes(w)) {
            queueBlockImages(w, missingBlockImages(w), job.articleImages);
          } else {
            save();
          }
          updateJobView(w, owner, true);
          for (const block of ready) sendJob(w, block);
          return;
        }
        job.progress = result.progress;
        const el = owner === w && current() === w ? $("#progress") : null;
        if (el) el.textContent = result.progress;
      } catch (e) {
        if (owner.job !== job) return;
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
  if (!j || j.referenceAfter) return;
  const { id } = j.payload;
  if (submitting.has(id)) return;
  submitting.add(id);
  delete j.readyToSend;
  j.error = "";
  save();
  updateJobView(w, owner);
  try {
    await jsonRequest("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(j.payload),
    });
  } catch (e) {
    if (owner.job === j) {
      j.error = e.message;
      save();
      updateJobView(w, owner);
    }
  } finally {
    submitting.delete(id);
  }
  if (owner.job === j && !j.error) poll(w, owner);
}

function createJob(w, target, items, settings = w.settings, id = crypto.randomUUID()) {
  const payload = {
    id,
    mode: settings.mode,
    kind: target === "compose" ? "video" : target === "write-draft" ? "draft" : "images",
    settings: { ...settings },
    style: w.style,
    items,
  };
  if (config.workCosts) payload.workId = w.id;
  if (payload.kind === "images" && config.imageStyleReference) payload.styleReference = true;
  if (w.type === "video" && payload.kind !== "draft") payload.storyboard = true;
  return { target, payload };
}

async function startJob(w, target, items, extra = {}, settings = w.settings) {
  const owner = target === "regenerate" ? w.blocks[extra.index] : w;
  if (w.job || owner.job) return;
  owner.job = { ...createJob(w, target, items, settings), ...extra };
  await sendJob(w, owner);
}

function authorize(w, count, kind, fn, voicedCount = count) {
  const writing = kind === "draft";
  const isArk = writing || w.settings.mode === "ark";
  const usesSpeech = kind === "video" && w.settings.voice !== "无配音" && voicedCount > 0;
  if (!isArk && !usesSpeech) return fn();
  if (writing && !config.textModel) {
    notify("请重启本地工作台，再刷新页面以启用方舟文字生成。", "warn");
    return;
  }
  if (isArk && !config.keyPresent) {
    openApiKeys();
    return;
  }
  if (usesSpeech && !config.speechKeyPresent) {
    openApiKeys("speech");
    return;
  }
  retryPayload = fn;
  const reference = videoReferenceSeconds(w);
  const articlePictures = writing && w.type === "article"
    ? (w.job ? w.job.articleImages?.settings : w.settings)
    : null;
  const pictureSummary = articlePictures?.mode === "ark"
    ? `<p>正文完成后自动生成建议配图，每段最多 1 张，全篇最多 ${maxArticleImages} 张，按实际生成张数计费。</p>`
    : articlePictures ? "<p>正文完成后自动使用所选风格的本地样图。</p>" : "";
  const textSummary = writing ? "<p>将使用方舟" +
    (w.type === "video" ? (reference === null
      ? "按主题生成完整口播，再根据口播安排分镜时长。"
      : `参考 ${reference} 秒生成完整口播，再根据口播安排分镜时长。`) :
      w.job?.partial ? "根据已生成的正文规划配图。" : "生成完整文章，再按正文决定哪些段落需要配图。") +
    "预计提交 " + count + " 次文本请求，按 token 计费。</p>" + pictureSummary +
    '<span class="pill">' + esc(config.textModel) + "</span>" : "";
  const arkSummary = !isArk || writing ? "" : (
    "<p>将按当前参数提交最多 <b>" +
      count +
      "</b> 个" +
      (kind === "video"
        ? "视频分镜（预计 " + videoTotalSeconds(w) + " 秒，自动分镜会按配音调整）"
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
      "</span></div>"
  );
  const speechSummary = usesSpeech
    ? "<p>最多为 <b>" + voicedCount + "</b> 个分镜生成火山语音配音，按口播字符数计费。</p>"
    : "";
  openModal(
    isArk ? "确认使用火山方舟生成" : "确认使用火山语音配音",
    textSummary + arkSummary + speechSummary + '<div class="actions dialog-actions">' +
      btn("取消", "close", "secondary") +
      btn("确认提交并计费", "confirm-paid", "primary") +
      "</div>",
    "confirm",
  );
}

function topicMissing() {
  const el = $("#topic");
  if (!el) {
    notify("请先填写科普主题", "warn");
    return;
  }
  el.classList.add("invalid");
  el.setAttribute("aria-invalid", "true");
  el.setAttribute("aria-describedby", "topic-error");
  $("#topic-error").hidden = false;
  el.focus();
}

function generate(w) {
  if (!w.topic.trim()) {
    topicMissing();
    return;
  }
  if (w.job || w.blocks.some((b) => b.job && !b.job.error)) return;
  const localExample = w.settings.mode === "demo" && examples.includes(w.topic.trim());
  if (!localExample) {
    return authorize(w, w.type === "article" ? 2 : 1, "draft", () => {
      const settings = { ...w.settings, mode: "ark" };
      if (w.type === "video") settings.duration = videoReferenceSeconds(w);
      const job = createJob(w, "write-draft", [], settings);
      job.payload.draft = { type: w.type, topic: w.topic.trim(), layout: w.layout, drug: w.drug };
      if (w.type === "video") job.payload.draft.pharmacist = w.avatar === pharmacistAvatar;
      else {
        // Keep the confirmed image settings and reuse the same request IDs when resuming this draft.
        job.articleImages = {
          settings: { ...w.settings },
          jobIds: Array.from({ length: maxArticleImages }, () => crypto.randomUUID()),
        };
      }
      w.job = job;
      return sendJob(w);
    });
  }
  if (w.type === "article") {
    const plan = planArticle(w);
    const images = plan.blocks.filter((block) => block.suggestedImage);
    installDraft(w, plan);
    changed(w);
    queueBlockImages(w, images);
  } else {
    installDraft(w, planVideo(w, config.videoModels[w.settings.videoModel][2]));
    changed(w);
  }
  render();
  app.focus({ preventScroll: true });
}

function installDraft(w, plan) {
  Object.assign(w, plan);
  w.viewingSetup = false;
  w.editing = w.type === "article";
  w.stage = w.editing ? "draft" : "script";
  if (w.type === "video") {
    w.video = null;
    w.videoDirty = false;
    selectedScenes.delete(w);
  }
}

function applyWrittenDraft(w, output) {
  const { title } = output;
  if (w.type === "video") {
    installDraft(w, { title, setting: output.setting || "", blocks: videoBlocks(output.shots) });
  } else {
    const visuals = new Map((output.images || []).map(({ section, scene }) => [section, scene]));
    const sections = output.sections.map(({ name, line }, i) => [name, line, visuals.get(i + 1)]);
    installDraft(w, { title, lead: output.lead, blocks: articleBlocks(sections) });
  }
}

function missingBlockImages(w) {
  return w.blocks.filter((b) => (w.type === "video" || b.suggestedImage) && !b.image && !b.job);
}

function pictureReference(w, targets) {
  if (!config.imageStyleReference) return "";
  return w.blocks.find((block) =>
    block.image?.startsWith("/media/") && block.imageStyle === w.style &&
    (w.type !== "video" || block.storyboardFrame) && !targets.includes(block)
  )?.image || "";
}

function picturePrompt(w, index, prompt, useReference) {
  const block = w.blocks[index];
  const scene = sceneDescription(w, prompt);
  const summary = block.line.trim().replace(/\s+/g, " ");
  if (w.type === "video") {
    const objectOnly = scene.startsWith(objectOnlyFrame);
    const first = index > 0 && w.blocks[0]?.prompt ? sceneDescription(w, w.blocks[0].prompt) : "";
    const setting = w.setting?.trim() || (first && !first.startsWith(objectOnlyFrame) ? `与第一幕相同（${first.slice(0, 120)}）` : "");
    return [
      `画面：短视频第 ${index + 1} 幕的起始画面。` + (scene || `用一个画面表现本幕要点「${block.name.trim()}」。`),
      !scene && summary && `本幕讲解（只用来构思画面，不写进画面）：${summary.slice(0, 120)}`,
      !objectOnly && setting && `全片场景：${setting.slice(0, 160)}`,
      presenterRule(w, objectOnly, false),
      useReference && !objectOnly && "参考图是本片已完成的分镜，沿用其中的场景、光线、道具外观和人物外观，按本幕内容调整景别和摆放。",
      framing(w), visualStyleRule(w), noTextFrame, medicalSafeFrame,
    ].filter(Boolean).join("\n").slice(0, 2200);
  }
  const title = (w.title.trim() || w.topic.trim()).slice(0, 80);
  const source = [title && `文章「${title}」`, block.name.trim() && `小节「${block.name.trim().slice(0, 40)}」`].filter(Boolean).join("的");
  return [
    scene ? `画面：${scene}` : "画面：画出最能帮读者看懂本段的一件物品或一个动作。",
    !scene && summary && `本段大意（只用来构思画面，不写进画面）：${summary.slice(0, 160)}`,
    source && `用途：用药科普${source}的配图。`,
    w.drug && `涉及药品：${w.drug}，只用来确定药品外形，不在画面上写药名。`,
    framing(w), visualStyleRule(w),
    config.imageStyleReference && "参考图一是画风样图，只参考配色、笔触和材质，不沿用其中的人物、物品和构图。",
    useReference && "参考图二是本篇已完成的配图，沿用其中反复出现的人物外观和道具。",
    noTextFrame, medicalSafeFrame,
  ].filter(Boolean).join("\n").slice(0, 2200);
}
function pictureItem(w, index, prompt, variant, reference, referenceAfter) {
  if (w.type === "video" && sceneDescription(w, prompt).startsWith(objectOnlyFrame)) reference = "";
  return {
    prompt: picturePrompt(w, index, prompt, reference || referenceAfter),
    variant,
    ...(reference ? { reference } : {}),
  };
}

function fillBlockImages(w) {
  if (w.job) return;
  const missing = missingBlockImages(w);
  if (!missing.length) return;
  authorize(w, missing.length, "images", () => queueBlockImages(w, missing));
}

function restyleBlockImages(w) {
  if (w.job || w.blocks.some((block) => block.job)) return;
  const existing = w.blocks.filter((block) => block.image);
  if (existing.length < 2) return;
  authorize(w, existing.length, "images", () => queueBlockImages(w, existing, { replacing: true }));
}

function queueBlockImages(w, blocks, { replacing = false, settings = w.settings, jobIds } = {}) {
  const reference = pictureReference(w, blocks);
  const needsLeader = w.type === "video" && settings.mode === "ark" && config.imageStyleReference && !reference;
  let leader = needsLeader ? w.blocks.find(({ job }) => job?.referenceLeader && !job.error &&
    job.payload.storyboard && job.payload.style === w.style)?.job : null;
  const queued = [];
  for (const block of blocks) {
    const index = w.blocks.indexOf(block);
    if (index < 0 || block.job || Boolean(block.image) !== replacing) continue;
    if (jobIds && !jobIds[index]) continue;
    const prompt = sceneDescription(w, block.prompt);
    const variant = w.type === "video" ? index : queued.length;
    const objectOnly = w.type === "video" && prompt.startsWith(objectOnlyFrame);
    const referenceAfter = objectOnly ? undefined : leader?.payload.id;
    block.job = createJob(
      w,
      replacing ? "regenerate" : "initial-image",
      [pictureItem(w, index, prompt, variant, reference, referenceAfter)],
      settings,
      jobIds?.[index],
    );
    if (replacing) block.job.prompt = prompt;
    if (referenceAfter) {
      block.job.referenceAfter = referenceAfter;
    } else {
      block.job.readyToSend = true;
      queued.push(block);
      if (needsLeader && !objectOnly) {
        leader = block.job;
        leader.referenceLeader = true;
      }
    }
  }
  save();
  for (const block of queued) sendJob(w, block);
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
  return (
    html ||
    '<span class="small">未匹配预设药名，可直接输入后按回车使用。</span>'
  );
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
      '</b>」的草稿记录，此操作不可恢复。</p><div class="actions dialog-actions">' +
      btn("保留作品", "close", "secondary") +
      btn("确认删除", "confirm-delete", "danger-solid", id) +
      "</div>",
    "confirm",
  );
}

function askRegenAllModal(w) {
  if (!w.topic.trim()) {
    topicMissing();
    return;
  }
  openModal(
    w.type === "video" ? "重新生成分镜脚本？" : "重新生成整篇内容？",
    "<p>重新生成将覆盖当前已编辑的" +
      (w.type === "video" ? "分镜脚本、配图和已合成成片" : "标题、导读、各段正文和配图") +
      '。</p><div class="actions dialog-actions">' +
      btn("取消", "close", "secondary") +
      btn("确认覆盖并重做", "confirm-regen-all", "primary") +
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
    notify("已复制全文到剪贴板", "ok");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    notify("已复制全文到剪贴板", "ok");
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
    else if (w.job.target === "compose" || w.job.target === "write-draft") recoverFinishedJob(w);
    if (!preserveScroll) window.scrollTo(0, 0);
    return;
  }
  if (w.stage === "setup" || w.viewingSetup) setup(w);
  else if (w.stage === "script" || (w.stage === "draft" && w.editing))
    editor(w);
  else detail(w);
  for (const b of w.blocks) {
    if (!b.job || b.job.error || b.job.referenceAfter) continue;
    if (b.job.readyToSend) sendJob(w, b);
    else poll(w, b);
  }
  revealSelectedScene();
  if (preserveScroll) window.scrollTo(0, prevScroll);
  else window.scrollTo(0, 0);
}

function changed(w) {
  w.updated = Date.now();
  save();
  const state = $("#save-state");
  if (state) state.textContent = savedLabel(w);
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
    const preview = $("#generated-image-prompt", dialogBody);
    if (w && preview) preview.value = picturePrompt(w, regenModal.index, el.value, regenModal.reference);
    return;
  }
  if (el.classList.contains("autogrow")) autoGrow(el);
  if (!w) return;
  if (el.dataset.bind) {
    w[el.dataset.bind] = el.value;
    if (el.id === "topic") {
      const counter = $("#chars");
      if (counter) counter.textContent = el.value.length + " / 300";
      if (el.value.trim() && el.classList.contains("invalid")) {
        el.classList.remove("invalid");
        el.removeAttribute("aria-invalid");
        $("#topic-error").hidden = true;
      }
    }
    changed(w);
  }
  if (el.dataset.block !== undefined) {
    const idx = Number(el.dataset.block);
    const block = w.blocks[idx];
    if (!block) return;
    block[el.dataset.key] = el.value;
    if (el.dataset.key === "name" && w.type === "video") {
      const sceneName = app.querySelector('.scene-choice[data-val="' + idx + '"] [data-scene-name]');
      if (sceneName) sceneName.textContent = el.value.trim() || "未命名分镜";
      if (w.video) w.videoDirty = true;
    }
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
  const scene = e.target.closest(".scene-choice");
  if (scene && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    const index = Number(scene.dataset.val);
    const targets = scene.parentElement.children;
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: targets.length - 1 }[e.key];
    targets[Math.max(0, Math.min(targets.length - 1, next))].click();
    return;
  }
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
  if (el.dataset.check !== undefined && w) {
    w.checks = [...activeChecks(w)];
    w.checks[Number(el.dataset.check)] = el.checked;
    w.checksFor = contentSig(w);
    changed(w);
    const done = reviewChecks.filter((_, i) => w.checks[i]).length;
    const count = $("#check-count");
    count.textContent = done + " / " + reviewChecks.length;
    count.classList.toggle("ok", done === reviewChecks.length);
    $("#checklist").classList.remove("attention");
    return;
  }
  if (el.dataset.seconds !== undefined && w) {
    const block = w.blocks[Number(el.dataset.seconds)];
    block.seconds = Number(el.value);
    block.manualSeconds = true;
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
    return;
  }
  const k = el.dataset.setting;
  if (!k) return;
  if (k === "imageStyle" && w && modalScope === w.id) {
    w.style = Number(el.value);
    changed(w);
    prefs(w);
    render(true);
    return;
  }
  const inside = dialog.contains(el);
  const s =
    inside && modalScope === "global"
      ? data.settings
      : w?.settings || data.settings;
  if (k === "music" && s === w?.settings && w.video && (s.music ?? defaults.music) !== el.value) w.videoDirty = true;
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
      case "connect-ark":
        if (config) openApiKeys();
        break;
      case "configure-speech":
        if (config) openApiKeys("speech");
        break;
      case "work-settings":
        if (w) prefs(w);
        else prefs(null);
        break;
      case "work-costs": {
        const work = data.works.find((item) => item.id === v);
        if (work) await openWorkCosts(work);
        break;
      }
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
        if (w.type === "article") w.editing = true;
        changed(w);
        render();
        break;
      case "regenerate-all":
        askRegenAllModal(w);
        break;
      case "confirm-regen-all":
        dialog.close();
        if (w.type === "video") w.viewingSetup = false;
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
        w.avatar = ["无人物", pharmacistAvatar][Number(v)];
        changed(w);
        render(true);
        break;
      case "duration":
        w.settings.duration = videoReferenceDurations[Number(v)];
        changed(w);
        render(true);
        break;
      case "style":
        w.style = Number(v);
        changed(w);
        render(true);
        app.querySelector('[data-action="style"][aria-pressed="true"]')?.focus({ preventScroll: true });
        break;
      case "layout":
        w.layout = articleLayouts[Number(v)].name;
        changed(w);
        render(true);
        app.querySelector('[data-action="layout"][aria-pressed="true"]')?.focus();
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
          notify("请填写作品标题", "warn");
          return;
        }
        w.editing = false;
        w.viewingSetup = false;
        changed(w);
        render();
        break;
      case "select-scene":
        selectScene(w, Number(v));
        break;
      case "fill-video-images":
      case "fill-article-images":
        fillBlockImages(w);
        break;
      case "restyle-images":
        restyleBlockImages(w);
        break;
      case "compose": {
        if (!w.title.trim()) {
          notify("请先填写作品标题", "warn");
          return;
        }
        if (w.blocks.some((b) => !b.line.trim())) {
          notify("请补全每一幕的口播台词", "warn");
          return;
        }
        if (w.blocks.some((b) => !b.image)) {
          notify("还有分镜缺少配图，请先为该幕配图", "warn");
          return;
        }
        if (w.settings.mode === "ark") {
          const rejected = rejectedPortraitFrames.get(w);
          const index = rejected ? w.blocks.findIndex((block) => rejected.has(block.image)) : -1;
          if (index >= 0) {
            notify(`第 ${index + 1} 幕的首帧已被方舟拒绝，请换图后再合成。`, "warn");
            selectScene(w, index);
            return;
          }
        }
        if (
          w.blocks.some(
            (b) => b.seconds > config.videoModels[w.settings.videoModel][2],
          )
        ) {
          notify(
            "存在单镜时长超过当前模型上限，请调短单镜时长或切换 Seedance 2.5",
            "warn",
          );
          return;
        }
        authorize(w, w.blocks.length, "video", () =>
          startJob(
            w,
            "compose",
            w.blocks.map(({ prompt, image, line, seconds, manualSeconds }, index) => {
              const matchNext = index + 1 < w.blocks.length && !sceneDescription(w, prompt).startsWith(objectOnlyFrame);
              return { prompt: storyboardPrompt(w, index, prompt, matchNext), image, line, seconds, matchNext,
                autoDuration: !manualSeconds };
            }),
            {},
            { ...w.settings, music: videoMusic(w) },
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
      case "time-shots": {
        const maxSeconds = config.videoModels[w.settings.videoModel][2];
        const chars = w.blocks.map((block) => spokenChars(block.line));
        const over = chars.findIndex((count) => count / videoSpeechRate > maxSeconds);
        if (over >= 0) {
          notify(`第 ${over + 1} 幕的口播超过模型的单镜时长上限，请缩短或拆成两幕。`, "warn");
          selectScene(w, over);
          return;
        }
        const seconds = w.blocks.map((block, i) => chars[i]
          ? Math.min(maxSeconds, recommendedShotSeconds(chars[i])) : block.seconds);
        if (w.blocks.every((block, i) => block.seconds === seconds[i] && !block.manualSeconds)) {
          notify("当前分镜时长已与口播估时一致");
          return;
        }
        w.blocks.forEach((block, i) => { block.seconds = seconds[i]; delete block.manualSeconds; });
        if (w.video) w.videoDirty = true;
        changed(w);
        render(true);
        notify(`已按口播调整分镜，共 ${videoTotalSeconds(w)} 秒`, "ok");
        break;
      }
      case "append": {
        const vid = w.type === "video";
        if (vid && w.blocks.length >= maxVideoShots) {
          notify(`最多支持 ${maxVideoShots} 幕分镜`, "warn");
          return;
        }
        const idx = w.blocks.length;
        const sec = vid
          ? Math.min(8, config.videoModels[w.settings.videoModel][2])
          : 0;
        w.blocks.push({
          name: vid ? "要点讲解 " + idx : "补充要点 " + idx,
          line: "",
          prompt: "",
          image: "",
          variant: 0,
          seconds: sec,
          motion: defaultMotion,
        });
        if (vid && w.video) w.videoDirty = true;
        changed(w);
        if (vid) selectScene(w, idx);
        else render(true);
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
        if (w.type === "video") selectScene(w, nextIdx);
        else render(true);
        break;
      }
      case "remove-block": {
        const idx = Number(v);
        if (w.blocks[idx]?.job) return;
        if (w.blocks.length <= 2) {
          notify("至少保留两段内容", "warn");
          return;
        }
        w.blocks.splice(idx, 1);
        if (w.type === "video" && w.video) w.videoDirty = true;
        changed(w);
        if (w.type === "video") selectScene(w, Math.min(idx, w.blocks.length - 1));
        else render(true);
        break;
      }
      case "reimage":
        openPictureDialog(w, Number(v));
        break;
      case "regen":
      case "regen-demo": {
        const i = Number(v),
          prompt = sceneDescription(w, $("#imageprompt", dialogBody)?.value || "");
        const reference = regenModal?.reference || "";
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
          openApiKeys();
          return;
        }
        dialog.close();
        await startJob(
          w,
          "regenerate",
          [pictureItem(w, i, prompt, (w.blocks[i].variant || 0) + i + 1, reference)],
          { index: i, prompt },
          settings,
        );
        break;
      }
      case "retry": {
        const owner = v === "" || v == null ? w : w.blocks[Number(v)];
        const j = owner.job;
        if (portraitRejected(j)) return;
        if (j.target === "write-draft") {
          authorize(w, w.type === "article" && !j.partial ? 2 : 1, "draft", () => sendJob(w));
          break;
        }
        authorize(
          { ...w, settings: j.payload.settings },
          j.payload.items.length,
          j.payload.kind,
          () => sendJob(w, owner),
          j.payload.items.filter((item) => item.line?.trim()).length,
        );
        break;
      }
      case "abort-job": {
        const owner = v === "" || v == null ? w : w.blocks[Number(v)];
        if (owner.job?.target === "write-draft") w.viewingSetup = true;
        if (owner === w && portraitRejected(owner.job)) rememberRejectedFrame(w);
        const leaderId = owner.job?.referenceLeader ? owner.job.payload.id : "";
        if (leaderId) {
          for (const block of w.blocks) {
            if (block.job?.referenceAfter === leaderId) block.job = null;
          }
        }
        owner.job = null;
        changed(w);
        if (leaderId) render(true);
        else updateJobView(w, owner, true);
        break;
      }
      case "replace-portrait-frame": {
        if (!portraitRejected(w.job)) break;
        const index = rejectedFrameIndex(w);
        if (index < 0) break;
        rememberRejectedFrame(w);
        w.job = null;
        w.stage = "script";
        w.viewingSetup = false;
        changed(w);
        selectScene(w, index);
        openPictureDialog(w, index);
        break;
      }
      case "keep-written-article":
        if (!w.job?.partial) break;
        applyWrittenDraft(w, w.job.partial);
        w.job = null;
        changed(w);
        render();
        break;
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
          notify("请先选择至少一个作品分类", "warn");
          break;
        }
        if (activeChecks(w).filter(Boolean).length < reviewChecks.length) {
          const box = $("#checklist");
          box?.classList.add("attention");
          box?.scrollIntoView({ block: "center", behavior: "smooth" });
          notify("请先完成发布前药师自查", "warn");
          break;
        }
        w.stage = "review";
        w.editing = false;
        w.viewingSetup = false;
        changed(w);
        render();
        notify("已提交本地模拟审核", "ok");
        break;
      case "withdraw":
        w.stage = "draft";
        w.editing = false;
        changed(w);
        render();
        notify("已撤回至成品草稿", "ok");
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
        notify("作品已删除", "ok");
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
    notify(error.message, "err");
  }
});

dialog.addEventListener("close", () => {
  if (dialog.open) return;
  if (modalType === "api-keys") dialogBody.replaceChildren();
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
