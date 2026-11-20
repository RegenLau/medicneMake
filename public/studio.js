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
  arrowLeft: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  prev: '<path d="m15 6-6 6 6 6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
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
  exampleFilter = "all",
  filter = "全部",
  toastTimer,
  selectedTags = [],
  modalScope = null,
  modalType = null,
  regenModal = null,
  retryPayload = null,
  exampleCursor = 0;

const defaultVoice = "男声";
const voiceOptions = [["男声", "男声 · 云舟 2.0"], "流畅女声 2.0", ["女声", "小何 2.0"], "无配音"];
const voiceLabels = Object.fromEntries(voiceOptions.map((item) => Array.isArray(item) ? item : [item, item]));
const voiceLabel = (v) => voiceLabels[v] || v || "";
const musicLabels = { auto: "自动搭配", off: "无背景音乐", calm: "舒缓钢琴", light: "轻快木琴" };
const avatarModeOptions = [
  ["videoretalk", "声动人像 VideoRetalk（整片省钱 · ¥0.08/秒）"],
  ["wan2.2-s2v", "万相数字人 Wan2.2-S2V（表情生动 · ¥0.50/秒）"],
  ["static", "静态肖像（免费）"],
];
const avatarResolutionOptions = [
  ["480P", "480P（¥0.50/秒 · 圆框推荐）"],
  ["720P", "720P（¥0.90/秒）"],
];
function resolveAvatarMode(raw) {
  if (raw === "static" || raw === "videoretalk" || raw === "wan2.2-s2v") return raw;
  return "videoretalk";
}
function avatarRatePerSecond(mode, resolution) {
  if (mode === "videoretalk") return 0.08;
  if (mode === "wan2.2-s2v") return resolution === "720P" ? 0.9 : 0.5;
  return 0;
}

const defaults = {
  mode: "ark",
  textModel: "deepseek-flash",
  imageModel: "doubao-seedream-5-5-261028",
  imageSize: "2K",
  videoModel: "doubao-seedance-2-5-flash-261115",
  resolution: "720p",
  ratio: "9:16",
  duration: null,
  watermark: true,
  voice: defaultVoice,
  music: "auto",
  avatarMode: "videoretalk",
  avatarResolution: "480P",
};

function textModelMap() {
  if (config?.textModels && Object.keys(config.textModels).length) return config.textModels;
  const fallback = config?.textModel || defaults.textModel;
  return { [fallback]: fallback };
}

function resolveTextModel(s) {
  const map = textModelMap();
  const chosen = s?.textModel;
  if (chosen && Object.prototype.hasOwnProperty.call(map, chosen)) return chosen;
  if (config?.textModel && Object.prototype.hasOwnProperty.call(map, config.textModel)) return config.textModel;
  return Object.keys(map)[0];
}

function textModelLabel(id) {
  return textModelMap()[id] || id || "";
}

data.settings = { ...defaults, ...data.settings, mode: "ark" };
if (data.settings.avatarMode === "liveportrait") {
  data.settings.avatarMode = "videoretalk";
}
data.works ||= [];
const watching = new Set();
const submitting = new Set();
let autoMusicRules = [];
const selectedScenes = new WeakMap();
const storyboardTabs = new WeakMap();
const rejectedPortraitFrames = new WeakMap();
const maxArticleImages = 16;

// Resume image requests saved by previous sessions.
let migratedLegacyMode = false;
for (const w of data.works) {
  if (w.settings && w.settings.mode !== "ark") {
    w.settings.mode = "ark";
    migratedLegacyMode = true;
  }
  if (w.settings && w.settings.avatarMode === "liveportrait") {
    w.settings.avatarMode = "videoretalk";
    migratedLegacyMode = true;
  }
  if (w.job?.target === "regenerate" && w.blocks?.[w.job.index]) {
    w.blocks[w.job.index].job = w.job;
    w.job = null;
  }
  if (!w.costTracking) {
    w.legacyCostMedia ??= workMedia(w);
    w.legacyCostJobs ??= workJobIds(w);
  }
}

if (!data.yunzhouVoiceAutoMusicDefaultApplied) {
  data.settings.voice = defaultVoice;
  data.settings.music = defaults.music;
  data.fluentVoiceDefaultApplied = true;
  data.musicOffDefaultApplied = true;
  data.yunzhouVoiceAutoMusicDefaultApplied = true;
  save();
}

if (migratedLegacyMode) save();

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
  return [
    w.video?.url,
    ...(w.blocks ?? []).map((block) => block.image),
    ...(w.templateDeck?.slides ?? []).flatMap((slide) => [slide.contentImage, slide.outroImage]),
    w.templateDeck?.pharmacist?.avatarImage,
  ].filter((url) => url?.startsWith("/media/"));
}

function workJobIds(w) {
  return [
    w.job,
    ...(w.blocks ?? []).map((block) => block.job),
    ...(w.templateDeck?.slides ?? []).flatMap((slide) => [slide.job, slide.outroJob]),
  ].flatMap((job) => job?.payload?.id ? [job.payload.id] : []);
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
    (result.deepseekPrice ? '<a href="' + esc(result.deepseekPrice) + '" target="_blank" rel="noopener noreferrer">DeepSeek 价格</a>' : '') +
    '<a href="' + esc(result.arkPrice) + '" target="_blank" rel="noopener noreferrer">方舟价格</a>' +
    '<a href="' + esc(result.speechPrice) + '" target="_blank" rel="noopener noreferrer">语音价格</a>' +
    (result.dashscopePrice ? '<a href="' + esc(result.dashscopePrice) + '" target="_blank" rel="noopener noreferrer">百炼价格</a>' : '') +
    (result.murekaPrice ? '<a href="' + esc(result.murekaPrice) + '" target="_blank" rel="noopener noreferrer">Mureka 价格</a>' : '') + '</p>';
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
  if (!config?.videoBackgroundMusic) return "off";
  return w?.settings?.music ?? defaults.music;
}

function videoMusicSettings(w) {
  const choice = videoMusic(w);
  if (choice !== "auto") return { music: choice };
  const track = automaticMusicTrack(w);
  return { music: track ? "library:" + track.id : "off" };
}

function musicLibrary() {
  return (config?.musicLibrary || []).filter((track) => !track.archived);
}

function findLibraryTrack(choice) {
  if (typeof choice !== "string" || !choice.startsWith("library:")) return null;
  const id = choice.slice("library:".length);
  return (config?.musicLibrary || []).find((t) => t.id === id) || null;
}

function automaticMusicTrack(w) {
  const topic = w?.topic?.trim() || w?.templateDeck?.title?.trim() || w?.title?.trim() || "";
  const available = autoMusicRules
    .map((rule) => ({ keywords: rule.keywords, track: findLibraryTrack("library:" + rule.trackId) }))
    .filter(({ track }) => track && !track.archived);
  const selected = available.find(({ keywords }) => keywords.some((word) => topic.includes(word))) ?? available.at(-1);
  return selected?.track ?? null;
}

function musicFieldHtml(currentVal, label = "配乐方式") {
  const selected = findLibraryTrack(currentVal);
  const lib = selected?.archived ? [...musicLibrary(), selected] : musicLibrary();
  const builtins = Object.entries(musicLabels)
    .map(([v, text]) => `<option value="${esc(v)}"${v === currentVal ? " selected" : ""}>${esc(text)}</option>`)
    .join("");
  const savedGroup = lib.length
    ? '<optgroup label="项目已存配乐（免费复用）">' +
      lib
        .map((t) => {
          const val = "library:" + t.id;
          const dur = t.duration ? ` · ${Math.round(t.duration)}秒` : "";
          const mood = t.mood ? ` · ${t.mood}` : "";
          return `<option value="${esc(val)}"${val === currentVal ? " selected" : ""}>${esc(t.title + mood + dur)}</option>`;
        })
        .join("") +
      "</optgroup>"
    : "";
  return `<label class="field">${esc(label)}<select data-setting="music">${builtins}${savedGroup}</select></label>`;
}

function musicSummaryLabel(w) {
  const choice = videoMusic(w);
  if (choice === "off") return musicLabels.off;
  if (choice.startsWith("library:")) {
    const track = findLibraryTrack(choice);
    return track ? `配乐：${track.title}` : "配乐：项目已存配乐";
  }
  if (choice === "auto") {
    const track = automaticMusicTrack(w);
    return track ? `自动搭配 · ${track.title}` : "自动搭配 · 无可用曲目";
  }
  return `配乐：${musicLabels[choice] || choice}`;
}

function videoMusicBadge(video) {
  if (!video?.music || video.music === "off") return "";
  if (video.music.startsWith("library:")) {
    const track = findLibraryTrack(video.music);
    const title = video.musicMeta?.title || track?.title;
    return title ? `配乐：${title}` : "项目配乐";
  }
  if (video.music === "auto") {
    return video.musicMeta?.title ? `配乐：${video.musicMeta.title}` : "Mureka AI 配乐";
  }
  return musicLabels[video.music] || "";
}

function renderLibraryPickerHtml(choice) {
  const lib = musicLibrary();
  if (!lib.length) return "";
  return (
    '<label class="field bgm-reuse-field">复用项目已存配乐 <small>（共 ' + lib.length + ' 首 · 已存项目目录 · 免费复用）</small>' +
    '<select data-reuse-bgm="1">' +
    '<option value=""' + (!choice.startsWith("library:") ? " selected" : "") + ">— 选择已有配乐直接复用 —</option>" +
    lib
      .map((t) => {
        const val = "library:" + t.id;
        const suffix = [t.mood, t.duration ? Math.round(t.duration) + "秒" : ""].filter(Boolean).join(" · ");
        return `<option value="${esc(val)}"${val === choice ? " selected" : ""}>${esc(t.title + (suffix ? "（" + suffix + "）" : ""))}</option>`;
      })
      .join("") +
    "</select></label>"
  );
}

function renderLibraryTrackCard(track, { compact = false, automatic = false } = {}) {
  if (!track) {
    return (
      '<div class="bgm-card' + (compact ? " is-compact" : "") + '">' +
      '<div class="bgm-card-head"><strong>已选项目配乐未找到</strong><span class="bgm-badge is-warn">文件已移除</span></div>' +
      '<p class="bgm-desc">该音频文件可能已从项目目录移除，请从曲库重新选择，或切换到「自动搭配」。</p>' +
      "</div>"
    );
  }
  const tags = [track.mood, track.styleLabel, track.model, track.bpm ? track.bpm + " BPM" : "", track.duration ? Math.round(track.duration) + "秒" : ""].filter(Boolean);
  return (
    '<div class="bgm-card' + (compact ? " is-compact" : "") + '">' +
    '<div class="bgm-card-head">' +
    "<strong>" + esc(track.title) + "</strong>" +
    '<span class="bgm-badge is-ok">' + (automatic ? "自动搭配" : "项目已存 · 免费复用") + "</span>" +
    "</div>" +
    (tags.length ? '<div class="bgm-meta">' + tags.map((t) => '<span class="bgm-tag">' + esc(t) + "</span>").join("") + "</div>" : "") +
    (track.description ? '<p class="bgm-desc">' + esc(track.description) + "</p>" : "") +
    (track.filename ? '<p class="bgm-file-path">文件：public/assets/music/generated/' + esc(track.filename) + "</p>" : "") +
    '<audio class="bgm-audio" controls preload="metadata" src="' + esc(track.url) + '"></audio>' +
    '<div class="bgm-library-actions">' +
    btn("重命名", "rename-bgm", "outline", track.id) +
    (track.archived ? '<span class="small">已下架 · 旧作品仍可使用</span>' : btn("下架", "delete-bgm", "textbtn", track.id)) +
    "</div>" +
    "</div>"
  );
}

function renderMusicStudioCard(w, { compact = false, showModeChips = false } = {}) {
  if (!config?.videoBackgroundMusic || !w) return "";
  const choice = videoMusic(w);
  const pickHtml = '<div class="asset-inline">' + btn("从素材库选曲", "library-pick-music", "outline") + '</div>';
  const chipsHtml = showModeChips
    ? '<div class="chips" style="margin-top:6px">' +
      Object.entries(musicLabels)
        .map(([k, label]) =>
          '<button type="button" class="chip' + (choice === k ? " selected" : "") +
          '" data-action="set-video-music" data-val="' + k +
          '" aria-pressed="' + (choice === k) + '">' +
          esc(label) +
          "</button>"
        )
        .join("") +
      "</div>" +
      renderLibraryPickerHtml(choice)
    : "";

  if (choice === "off") return chipsHtml + pickHtml;

  if (choice.startsWith("library:")) {
    return chipsHtml + pickHtml + renderLibraryTrackCard(findLibraryTrack(choice), { compact });
  }

  if (choice === "calm" || choice === "light") {
    return (
      chipsHtml + pickHtml +
      '<div class="bgm-card is-preset' + (compact ? " is-compact" : "") + '">' +
      '<div class="bgm-card-head"><strong>内置配乐 · ' + esc(musicLabels[choice]) + "</strong>" +
      '<span class="bgm-badge">预设曲目</span></div>' +
      '<audio class="bgm-audio" controls preload="none" src="/assets/music/' + esc(choice) + '.flac"></audio>' +
      "</div>"
    );
  }

  const track = automaticMusicTrack(w);
  return chipsHtml + pickHtml + (track
    ? renderLibraryTrackCard(track, { compact, automatic: true })
    : '<p class="bgm-desc">自动搭配曲目暂不可用。可手动选曲，否则成片无背景音乐。</p>');
}

async function refreshMusicLibrary() {
  try {
    const res = await jsonRequest("/api/music-library");
    if (Array.isArray(res?.tracks)) {
      config.musicLibrary = res.tracks;
    }
  } catch {
    // ignore transient refresh failures
  }
}

async function renameLibraryMusic(trackId) {
  const track = musicLibrary().find((t) => t.id === trackId);
  if (!track) return;
  const nextTitle = window.prompt("请输入新的背景音乐名称（将同步更新项目内文件名）：", track.title);
  if (nextTitle === null) return;
  const trimmed = nextTitle.trim();
  if (!trimmed || trimmed === track.title) return;
  try {
    const res = await jsonRequest("/api/music-library/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: trackId, title: trimmed }),
    });
    if (Array.isArray(res.library)) config.musicLibrary = res.library;
    for (const work of data.works) {
      if (work.customMusic?.id === trackId && res.track) {
        work.customMusic = { ...work.customMusic, ...res.track };
      }
      if (work.video?.musicMeta?.id === trackId && res.track) {
        work.video.musicMeta = { ...work.video.musicMeta, ...res.track };
      }
    }
    save();
    if (dialog.open && modalType === "settings") {
      const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
      prefs(scope);
    }
    render(true);
    notify(`已重命名为：${res.track?.title || trimmed}`, "ok");
  } catch (error) {
    notify(error.message || "重命名失败", "err");
  }
}

async function archiveMusic(trackId) {
  const res = await jsonRequest("/api/music-library/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: trackId }),
  });
  config.musicLibrary = res.library;
}

async function deleteLibraryMusic(trackId) {
  const track = musicLibrary().find((t) => t.id === trackId);
  if (!track || !window.confirm(`下架「${track.title}」？已使用的作品仍可导出。`)) return;
  await archiveMusic(trackId);
  if (dialog.open && modalType === "settings") {
    const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
    prefs(scope);
  }
  render(true);
  notify(`已下架背景音乐：${track.title}`, "ok");
}

window.StudioMusic = {
  videoMusic,
  videoMusicSettings,
  musicSummaryLabel,
  renderMusicStudioCard,
};

function fmtClock(sec) {
  const duration = Math.max(0, Math.round(sec));
  const m = Math.floor(duration / 60),
    s = duration % 60;
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
  const keysReady = config && config.deepseekKeyPresent && config.keyPresent;
  const dotCls = keysReady ? "" : "warn";
  const modeEl = $("#mode-indicator");
  if (modeEl) {
    modeEl.innerHTML =
      '<span class="dot ' +
      dotCls +
      '" aria-hidden="true"></span><span class="mode-label">模型配置</span>' +
      ico("settings");
  }
  const worksEl = $("#nav-works");
  const onLibrary = route()[0] === "library";
  const libraryEl = $("#nav-library");
  libraryEl.classList.toggle("active", onLibrary);
  if (onLibrary) libraryEl.setAttribute("aria-current", "page");
  else libraryEl.removeAttribute("aria-current");
  if (worksEl) {
    const onWorks = route()[0] !== "work" && !onLibrary && tab === "works";
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

const keyProviders = {
  deepseek: {
    title: "DeepSeek",
    label: "DeepSeek API Key",
    endpoint: "/api/deepseek-key",
    submit: "验证并连接",
    link: ["https://platform.deepseek.com/api_keys", "获取 Key"],
    status: () => [config.deepseekKeySaved, config.deepseekKeyPresent, config.deepseekKeySource, config.deepseekKeyWarning],
  },
  ark: {
    title: "火山方舟",
    label: "方舟 API Key",
    endpoint: "/api/ark-key",
    submit: "验证并连接",
    link: ["https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey", "获取 Key"],
    status: () => [config.keySaved, config.keyPresent, config.keySource, config.keyWarning],
  },
  speech: {
    title: "豆包语音",
    label: "豆包语音 API Key",
    endpoint: "/api/speech-key",
    submit: "保存",
    link: ["https://console.volcengine.com/speech/new/setting/apikeys", "获取 Key"],
    status: () => [config.speechKeySaved, config.speechKeyPresent, "", config.speechKeyWarning],
  },
  dashscope: {
    title: "阿里云百炼",
    label: "阿里云百炼 API Key",
    endpoint: "/api/dashscope-key",
    submit: "验证并连接",
    link: ["https://bailian.console.aliyun.com/?tab=model#/api-key", "获取 Key"],
    status: () => [config.dashscopeKeySaved, config.dashscopeKeyPresent, config.dashscopeKeySource, config.dashscopeKeyWarning],
  },
};

function keyStatusText(kind) {
  const [saved, present] = keyProviders[kind].status();
  return saved ? "已保存到本机" : present ? "已配置" : "未配置";
}

let editingKeyKind = null;

function keyForm(kind) {
  const p = keyProviders[kind];
  const [, present, source, warning] = p.status();
  const notes = [
    source === "environment" ? "当前使用环境变量中的 Key。" : "",
    !config.keyStorage || config.keyStorage === "session" ? "Key 仅在本次运行中使用。" : "",
  ].join("");

  if (present && editingKeyKind !== kind) {
    return (
      '<div class="credential-form" data-key-kind="' + kind + '">' +
      '<div class="card-head"><h3>' + p.title + ' Key</h3><span class="key-status ok" data-key-status>' +
      keyStatusText(kind) + "</span></div>" +
      '<div class="key-saved-row">' +
      '<span class="small">已安全保存，不再显示；填入新密钥才会替换</span>' +
      btn("更换 Key", "replace-key", "outline", kind) +
      "</div>" +
      (warning ? '<p class="banner warn" data-storage-warning>' + esc(warning) + "</p>" : "") +
      (notes
        ? '<p class="footmeta">' + notes +
          '<a href="' + p.link[0] + '" target="_blank" rel="noopener noreferrer">' + p.link[1] + "</a></p>"
        : "") +
      "</div>"
    );
  }

  const submitLabel = present ? (kind === "speech" ? "确认替换" : "验证并替换") : p.submit;
  return (
    '<form id="' + kind + '-key-form" class="credential-form" data-key-kind="' + kind + '" autocomplete="off">' +
    '<div class="card-head"><h3>' + p.title + ' Key</h3><span class="key-status' + (present ? " ok" : "") +
    '" data-key-status>' + keyStatusText(kind) + "</span></div>" +
    '<div class="key-row">' +
    '<input type="text" class="secret-input" id="' + kind + '-key" name="xixi-api-' + kind +
    '" required maxlength="1024" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" aria-label="' +
    p.label + '" placeholder="' + (present ? "粘贴新的 " + p.label : "粘贴 " + p.label) + '">' +
    '<button type="submit" class="primary">' + submitLabel + "</button>" +
    (present ? btn("取消", "cancel-replace-key", "secondary") : "") +
    "</div>" +
    (warning ? '<p class="banner warn" data-storage-warning>' + esc(warning) + "</p>" : "") +
    '<p class="footmeta">' + notes +
    '<a href="' + p.link[0] + '" target="_blank" rel="noopener noreferrer">' + p.link[1] + "</a></p>" +
    '<p class="banner err" id="' + kind + '-key-error" role="alert" hidden></p>' +
    "</form>"
  );
}

// Which tab of the model settings is open. Shared by the dialog and the setup page.
let settingsTab = "text";
const settingsTabLabels = { text: "文本", image: "图片", video: "视频", voice: "配音", music: "背景音乐", avatar: "数字人服务" };

function settingsTabsFor(which) {
  if (which === "article") return ["text", "image"];
  if (which === "video") return ["text", "image", "video", "voice", "music"];
  if (which === "svg-video") return ["text", "voice", "music"];
  if (which === "code-motion") return ["text", "voice", "music", "avatar"];
  if (which === "template-video") return ["text", "image", "video", "voice", "music", "avatar"];
  return ["text", "image", "video", "voice", "music", "avatar"];
}

function isCodeMotion(w) {
  return w?.type === "video" && w.videoMode === "code-motion";
}

function workSettingsKind(w) {
  if (isCodeMotion(w)) return "code-motion";
  if (isSvgVideo(w)) return "svg-video";
  return TemplateStudio.isTemplateVideo(w) ? "template-video" : w?.type || "all";
}

function openApiKeys(focus = "deepseek") {
  settingsTab =
    focus === "deepseek"
      ? "text"
      : focus === "speech"
        ? "voice"
        : focus === "mureka" || focus === "music"
          ? "music"
          : focus === "dashscope"
            ? "avatar"
            : "image";
  const w = route()[0] === "work" ? current() : null;
  const available = settingsTabsFor(workSettingsKind(w));
  if (!available.includes(settingsTab)) prefs(null);
  else prefs(w);
  const inputId = focus === "music" ? "mureka" : focus;
  $("#" + inputId + "-key", dialogBody)?.focus();
}

dialog.addEventListener("submit", async (event) => {
  const form = event.target;
  const kind = form.dataset.keyKind;
  if (!keyProviders[kind]) return;
  event.preventDefault();
  const input = form.querySelector("#" + kind + "-key");
  const feedback = form.querySelector("#" + kind + "-key-error");
  const submit = form.querySelector('button[type="submit"]');
  const buttonLabel = submit.textContent;
  const nextKey = input.value.trim();
  if (submit.disabled || !nextKey) return;
  submit.disabled = true;
  submit.textContent = kind === "speech" ? "正在保存…" : "正在验证…";
  input.readOnly = true;
  feedback.hidden = true;
  try {
    const status = await jsonRequest(keyProviders[kind].endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: nextKey }),
    });
    Object.assign(config, status);
    input.value = "";
    editingKeyKind = null;
    const saved = keyProviders[kind].status()[0];
    if (dialog.open && modalType === "settings") {
      const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
      prefs(scope);
    }
    render(true);
    const extra = kind === "deepseek" ? `，已同步 ${Object.keys(textModelMap()).length} 个模型` : "";
    notify(
      (kind === "speech" ? "已保存豆包语音 Key" : "已连接" + keyProviders[kind].title) +
        (saved ? "，已保存到本机" : "，本次运行可用") + extra,
      "ok",
    );
  } catch (error) {
    feedback.textContent = error.message;
    feedback.hidden = false;
    input.readOnly = false;
    input.focus();
  } finally {
    if (submit.isConnected) {
      input.readOnly = false;
      submit.disabled = false;
      submit.textContent = buttonLabel;
    }
  }
});

function keyWarning(kind, text, extra = "") {
  return (
    '<div class="banner warn">' + text +
    '<div class="banner-actions">' +
    btn("填写" + keyProviders[kind].title + " Key", "connect-" + kind, "secondary") +
    extra +
    "</div></div>"
  );
}

function arkKeyWarning() {
  return config.keyPresent ? "" : keyWarning("ark", "连接火山方舟后可生成图片与视频素材。");
}

// inDialog: the dialog shows key forms inline; the setup page shows warnings that open the dialog.
function settingsFields(s, which = "all", { inDialog = false, styleField = "", work = null } = {}) {
  const texts = Object.entries(textModelMap()),
    images = Object.entries(config.imageModels).map(([id, v]) => [id, v[0]]),
    videos = Object.entries(config.videoModels).map(([id, v]) => [id, v[0]]);
  const isTplVideo = which === "template-video";
  const ratioField = field("画幅", "ratio", ["16:9", "3:4", "1:1", "9:16"], s.ratio);
  const musicMode = s.music ?? defaults.music;
  const tabs = settingsTabsFor(which);
  if (!tabs.includes(settingsTab)) settingsTab = tabs[0];

  // 文本
  let text = '<div class="fields">' +
    field("文案与分镜模型", "textModel", texts, resolveTextModel(s), true) + "</div>";
  if (inDialog) text += keyForm("deepseek");
  else if (!config.deepseekKeyPresent) text += keyWarning("deepseek", "连接 DeepSeek 后可生成自定义文章与分镜脚本。");

  // 图片
  let image = '<div class="fields">' +
    field("生图模型", "imageModel", images, s.imageModel, true) +
    field("图片清晰度", "imageSize", config.imageModels[s.imageModel][1], s.imageSize) +
    (isTplVideo ? "" : ratioField + styleField) + "</div>" +
    '<label class="switchline"><input type="checkbox" data-setting="watermark" ' +
    (s.watermark ? "checked" : "") + "><span>生成素材添加方舟水印</span></label>";
  if (isTplVideo) {
    image += '<div class="mode-box" style="margin-top:12px">用于生成或重新生成模板右侧严格 16:9（标准 1360×765 比例）满画幅带中文字科普信息图，沿用医疗白蓝或暖色手绘风格。</div>';
  }
  if (inDialog) image += keyForm("ark");
  else if (!config.keyPresent) {
    image += keyWarning("ark", "连接火山方舟后可生成图片与视频素材。");
  }

  // 视频
  let video = "";
  const selectedLibTrack = findLibraryTrack(musicMode);
  const autoTrack = musicMode === "auto" && work ? automaticMusicTrack(work) : null;
  const currentMusicText = autoTrack
    ? `自动搭配 · ${autoTrack.title}`
    : selectedLibTrack?.title || musicLabels[musicMode] || musicMode;
  if (isTplVideo) {
    video +=
      '<div class="mode-box">模板讲解固定输出 16:9（1280×720）。DeepSeek 生成脚本，右侧卡片支持 Seedream 生成或本地上传，画面与字幕由本地合成，<b>不消耗视频模型费用</b>。</div>' +
      '<p class="key-shared">当前配音：' + esc(voiceLabel(s.voice)) + " · " + keyStatusText("speech") + " " +
      btn("去配音页设置", "settings-tab", "textbtn", "voice") + "</p>" +
      '<p class="key-shared">当前背景音乐：' + esc(currentMusicText) + " " +
      btn("去背景音乐页设置", "settings-tab", "textbtn", "music") + "</p>";
  } else {
    video += '<div class="fields">' +
      field("视频生成模型", "videoModel", videos, s.videoModel, true) +
      field("视频分辨率", "resolution", config.videoModels[s.videoModel][1], s.resolution) +
      ratioField + "</div>";
    if (inDialog) {
      video += '<p class="key-shared">' + "火山方舟 Key：" + keyStatusText("ark") +
        (config.keyPresent ? "" : " " + btn("去填写", "settings-tab", "textbtn", "image")) + "</p>";
    } else if (!config.keyPresent) {
      video += keyWarning("ark", "连接火山方舟后可生成视频分镜。");
    }
  }

  // 配音
  let voice = '<div class="fields">' +
    field("配音音色", "voice", voiceOptions, s.voice, true) +
    "</div>" +
    '<div class="mode-box" style="margin-top:12px">采用<b>豆包语音合成 2.0</b>（约 ¥0.0003/字，相同台词与音色自动复用本地缓存）。如只需画面与背景音乐，可选择「无配音」。</div>';
  if (inDialog) voice += keyForm("speech");
  else if (s.voice !== "无配音" && !config.speechKeyPresent) {
    voice += keyWarning("speech", "配置豆包语音后可为视频生成配音。");
  }

  // 背景音乐
  let music = '<div class="fields">' + musicFieldHtml(musicMode) + "</div>";
  if (inDialog && work && work.type === "video") {
    music += renderMusicStudioCard(work, { compact: true });
  } else if (inDialog && musicMode.startsWith("library:")) {
    music += renderLibraryTrackCard(selectedLibTrack, { compact: true });
  } else if (musicMode === "auto") {
    music += '<p class="small">自动搭配按视频主题从本地曲库选曲。</p>';
  }

  // 数字人服务
  const avatarMode = resolveAvatarMode(s.avatarMode ?? defaults.avatarMode);
  const avatarResolution = s.avatarResolution || defaults.avatarResolution;
  let avatar = '<div class="fields">' +
    field("数字人模型", "avatarMode", avatarModeOptions, avatarMode, avatarMode !== "wan2.2-s2v") +
    (avatarMode === "wan2.2-s2v" ? field("生成清晰度", "avatarResolution", avatarResolutionOptions, avatarResolution) : "") +
    "</div>" +
    '<div class="mode-box" style="margin-top:12px">' +
    (avatarMode === "wan2.2-s2v"
      ? '<b>万相数字人（Wan2.2-S2V）</b>：支持<b>真人与卡通形象</b>，具备自然眨眼、头部微动与丰富表情；单段上限 20 秒，后台自动按页边界分片衔接并本地缓存复用（480P 约 ¥0.50/秒）。'
      : '<b>声动人像（VideoRetalk）</b>：支持最长 <b>120 秒整片一次对口型</b>（约 ¥0.08/秒，60 秒约 ¥4.8），写实人像性价比最高；相同头像与台词自动复用本地缓存。如需更丰富表情或卡通形象，可切「万相数字人」。') +
    "</div>";
  if (inDialog) avatar += keyForm("dashscope");
  else if (avatarMode !== "static" && !config.dashscopeKeyPresent) {
    avatar += keyWarning("dashscope", "配置阿里云百炼 Key 后可启用信息图模板的 AI 对口型。");
  }

  const panels = { text, image, video, voice, music, avatar };
  const missing = {
    text: !config.deepseekKeyPresent,
    image: !config.keyPresent,
    video: !isTplVideo && !config.keyPresent,
    voice: s.voice !== "无配音" && !config.speechKeyPresent,
    avatar: avatarMode !== "static" && !config.dashscopeKeyPresent,
  };
  return (
    '<div class="settings-tabs-root">' +
    '<div class="settings-tabs" role="tablist" aria-label="模型类型">' +
    tabs.map((t) => btn(
      settingsTabLabels[t] + (missing[t] ? '<span class="tab-dot" aria-label="缺少 Key"></span>' : ""),
      "settings-tab",
      "settings-tab" + (t === settingsTab ? " active" : ""),
      t,
      'role="tab" aria-selected="' + (t === settingsTab) + '"',
    )).join("") +
    "</div>" +
    tabs.map((t) =>
      '<div class="settings-panel" role="tabpanel" data-panel="' + t + '"' + (t === settingsTab ? "" : " hidden") + ">" +
      panels[t] + "</div>",
    ).join("") +
    "</div>"
  );
}

function showSettingsTab(name) {
  settingsTab = name;
  for (const root of document.querySelectorAll(".settings-tabs-root")) {
    for (const tabBtn of root.querySelectorAll(".settings-tab")) {
      const on = tabBtn.dataset.val === name;
      tabBtn.classList.toggle("active", on);
      tabBtn.setAttribute("aria-selected", String(on));
    }
    for (const panel of root.querySelectorAll(".settings-panel")) {
      panel.hidden = panel.dataset.panel !== name;
    }
  }
}

function prefs(w) {
  modalScope = w?.id || "global";
  const s = w ? w.settings : data.settings;
  const which = workSettingsKind(w);
  const styleField = w && !["template-video", "svg-video", "code-motion"].includes(which) ? field(w.type === "video" ? "画面风格" : "插图风格", "imageStyle",
    styles.map((label, i) => [String(i), label]), String(w.style), true) : "";
  openModal(
    w ? "模型配置 · 本作品" : "模型配置 · 新作品默认",
    settingsFields(s, which, { inDialog: true, styleField, work: w }) +
      '<div style="margin-top:20px">' +
      btn("完成", "close", "primary widebtn") +
      "</div>",
    "settings",
  );
}

function newWork(type, example, videoMode, tplSampleIdx) {
  const id = crypto.randomUUID(),
    style = example ?? 0;
  const s = { ...data.settings };
  const effectiveVideoMode = type === "video"
    ? (videoMode || (example == null ? "template" : "storyboard"))
    : undefined;
  if (type === "article" && example == null && s.ratio === "9:16") {
    s.ratio = "16:9";
  }
  if (effectiveVideoMode === "template" || effectiveVideoMode === "svg") {
    s.ratio = "16:9";
  }
  if (effectiveVideoMode === "svg") s.resolution = "720p";
  const tplSample = tplSampleIdx != null ? TemplateVideo.EXAMPLES[tplSampleIdx] : null;
  const w = {
    id,
    type,
    ...(effectiveVideoMode ? { videoMode: effectiveVideoMode } : {}),
    ...(effectiveVideoMode === "template"
      ? {
          templateTheme: tplSample ? tplSample.theme : "medical",
          templatePresenter: tplSample ? tplSample.presenter : "digital",
        }
      : {}),
    stage: "setup",
    title: "",
    topic: tplSample ? tplSample.topic : (example == null ? "" : examples[style]),
    layout: articleLayouts[0].name,
    style,
    drug: tplSample?.drug || "",
    tags: [],
    settings: s,
    costTracking: !!config.workCosts,
    blocks: [],
    created: Date.now(),
    updated: Date.now(),
    job: null,
  };
  StageStudio.initWork(w);
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
  const svgEx = Boolean(config?.svgMotion);
  const svgExample = svgEx && (exampleFilter === "all" || exampleFilter === "svg")
    ? '<button type="button" class="sample template-sample" data-action="svg-sample"><div class="cover">' +
      '<div class="tpl-mini-scaler">' + SvgMotion.frame(SvgMotion.templateDeck({title: "用药说明书"}, [
        { name: "查看对应栏目", action: "leaflet", line: "先看说明书的对应栏目。" },
      ]), 0, 0.85) + '</div><span class="tag tpl-tag">' + svgVideoLabel +
      '</span></div><h3>看说明书时，哪里能找到答案？</h3></button>'
    : "";
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
      ? '<div class="flexwrap workFilters">' +
        [
          ["all", `全部示例 · ${TemplateVideo.EXAMPLES.length + styles.length + Number(svgEx)}`],
          ["template", `信息图模板讲解 · ${TemplateVideo.EXAMPLES.length}`],
          ["storyboard", `AI 分镜动画 · ${styles.length}`],
          ...(svgEx ? [["svg", svgVideoLabel + " · 1"]] : []),
        ]
          .map(([k, label]) =>
            btn(
              label,
              "example-filter",
              "chip" + (exampleFilter === k ? " selected" : ""),
              k,
            ),
          )
          .join("") +
        '</div><div class="gallery">' +
        (["all", "template"].includes(exampleFilter)
          ? TemplateStudio.templateSampleCardsHtml(esc, ico)
          : "") +
        (["all", "storyboard"].includes(exampleFilter)
          ? styles
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
              .join("")
          : "") + svgExample +
        "</div>"
      : worksList());
  if (tab === "examples") requestAnimationFrame(() => TemplateStudio.fitTemplatePreviews());
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
  const stageVideo = StageStudio.isActive(w);
  const isTpl = TemplateStudio.isTemplateVideo(w);
  const isSvg = isSvgVideo(w);
  const motion = isCodeMotion(w);
  const scriptButton = stageVideo ? "生成视频脚本" : motion ? "生成代码动效脚本" : isTpl ? "生成模板分镜脚本" : "生成分镜脚本";
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
    '</textarea><p class="field-error" id="topic-error" hidden>请先填写科普主题，再开始生成。</p>' +
    '<div class="dividerline"></div><div class="formrow"><span class="label">关联药品 <small>（选填）</small></span><div class="buttons">' +
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
      TemplateStudio.modeSwitcherHtml(w, btn) +
      (stageVideo ? StageStudio.setupControls(w) : "") +
      choice(
        "参考时长",
        videoReferenceDurations.map((seconds) => seconds === null ? "自动" : `${seconds} 秒`),
        reference === null ? "自动" : `${reference} 秒`,
        "duration",
      ) +
      (motion || isTpl || isSvg
        ? TemplateStudio.templateSetupHtml(w, data, esc, btn, { hideTheme: stageVideo })
        : styleChoice(w.style, "画面风格") +
          choice(
            "出镜形象",
            ["无人物", "药师出镜"],
            w.avatar === pharmacistAvatar ? "药师出镜" : "无人物",
            "avatar",
          )) +
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
        video ? (isTpl ? "返回继续编辑模板页" : "返回继续编辑分镜") : "返回继续编辑图文",
        "resume-edit",
        "primary widebtn",
      ) +
      btn(
        video ? "重新" + scriptButton : "重新生成图文草稿",
        "regenerate-all",
        "secondary widebtn",
      ) +
      "</div>"
    : btn(
        video ? scriptButton : "生成图文草稿",
        "generate",
        "primary widebtn",
      );

  const themeName = stageVideo
    ? StageStudio.themeName(w)
    : (TemplateVideo.THEMES.find((t) => t.id === (w.templateTheme || "medical"))?.name || "医疗白蓝风");
  const presName = TemplateVideo.PRESENTERS.find((p) => p.id === (w.templatePresenter || "digital"))?.name || "数字人";
  const refSeconds = video ? videoReferenceSeconds(w) : null;
  const summaryRows = stageVideo ? [
    ["视频形式", "信息图模板讲解"], ["视觉风格", themeName], ["主讲形象", presName], ["输出画面", "16:9 · 1280×720"],
  ] : video
    ? motion
      ? [
          ["视频形式", "信息图模板讲解"],
          ["右侧内容", "代码动效"],
          ["参考时长", refSeconds === null ? "自动" : `${refSeconds} 秒`],
          ["视觉风格", themeName],
          ["主讲形象", presName],
          ["输出画面", "16:9 · 1280×720"],
          ["脚本结构", "按内容与时长动态编排分镜与动效"],
        ]
      : isTpl
      ? [
          ["视频形式", "信息图模板讲解"],
          ["右侧内容", TemplateStudio.usesCodeMotion(w) ? "代码动效" : "AI 完整图"],
          ["参考时长", refSeconds === null ? "自动" : `${refSeconds} 秒`],
          ["视觉风格", themeName],
          ["主讲形象", presName],
          ["输出画面", "16:9 · 1280×720"],
          ["脚本结构", "按时长与主题灵活排页 + 口播字幕"],
        ]
      : isSvg ? [
          ["视频效果", svgVideoLabel],
          ["模板风格", themeName],
          ["主讲人", presName],
          ["分镜模型", textModelLabel(resolveTextModel(w.settings))],
          ["输出画面", "16:9 · 1280×720"],
          ["配音", voiceLabel(w.settings.voice)],
        ] : [
          ["视频形式", "AI 分镜动画"],
          ["画面风格", styles[w.style]],
          ["参考时长", refSeconds === null ? "自动" : `${refSeconds} 秒`],
          ["出镜形象", w.avatar === pharmacistAvatar ? "药师出镜" : "无人物"],
          ["画幅", w.settings.ratio],
        ]
    : [
        ["内容风格", w.layout],
        ["插图风格", styles[w.style]],
        ["配图画幅", w.settings.ratio],
      ];
  if (w.drug) summaryRows.push(["关联药品", w.drug]);
  const topicText = w.topic.trim();

  const right =
    '<div class="sheet setup-panel">' +
    '<div class="card-head"><h2>' + (video ? "生成视频脚本" : "生成图文草稿") + "</h2></div>" +
    '<div class="setup-topic' + (topicText ? "" : " empty") + '">' +
    '<span class="small">科普主题</span>' +
    "<p>" + esc(topicText || "尚未填写主题，请在左侧输入或选择推荐主题") + "</p></div>" +
    '<dl class="setup-summary">' +
    summaryRows
      .map(([k, val]) => '<div class="setup-summary-row"><dt>' + esc(k) + "</dt><dd>" + esc(val) + "</dd></div>")
      .join("") +
    "</dl>" +
    '<div id="initial-generation">' +
    ctaArea +
    "</div>" +
    '<p class="footmeta setup-footnote">' +
    (motion ? "生成后可自由增删分镜，并逐幕调整版式、动效、图形与口播。" : video
      ? "生成后可在编辑页逐页修改文字、口播与配图。"
      : "生成后可逐段修改正文，并为段落重做配图。") +
    " 可随时调整" +
    btn("模型配置", "work-settings", "textbtn inline-link") +
    "</p>" +
    "</div>";

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
  return '<nav class="scene-switcher vstudio-filmstrip" aria-label="切换分镜">' +
    w.blocks.map((block, i) => {
      const st = isSvgVideo(w) ? "SVG" : sceneImageState(block);
      const thumb = block.image
        ? '<img class="scene-thumb" src="' + esc(block.image) + '" alt="" loading="lazy">'
        : "";
      return btn(
        '<span class="scene-top"><span class="scene-name"><b>' + (i + 1) + '</b><span data-scene-name>' +
        esc(block.name.trim() || "未命名分镜") + '</span></span><span class="scene-sec">' + Number(block.seconds.toFixed(1)) + 's</span></span>' +
        '<span class="scene-foot">' + thumb + '<span class="scene-state" data-scene-state data-state="' + esc(st) + '">' +
        st + '</span></span>',
        "select-scene", "scene-choice", i, 'aria-pressed="' + (i === selected) + '"',
      );
    }).join("") + '</nav>';
}

function selectScene(w, index) {
  if (!w.blocks[index]) return;
  selectedScenes.set(w, w.blocks[index]);
  render(true);
  app.querySelector('.scene-choice[aria-pressed="true"], .code-motion-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
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
  const origin = b.image?.startsWith("/library/") ? "素材库复用" : (config.imageModels[b.imageModel]?.[0] || "火山方舟生成");
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
        '<div class="asset-inline">' +
        (b.image?.startsWith("/media/") ? btn("收入素材库", "library-collect-picture", "textbtn", i) : "") +
        (w.stage === "review"
          ? ""
          : btn("从素材库选择", "library-pick-picture", "outline", i) + btn(
              b.image ? "重新生成这张图" : w.type === "video" ? "生成这张分镜图" :
                b.suggestedImage ? "生成本段建议配图" : "为这段配图",
              "reimage",
              quiet ? "textbtn" : "outline",
              i,
            )) +
        "</div></div>") +
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
  const pending = w.blocks.some((b) => b.job) ||
    Boolean(w.templateDeck?.slides?.some((s) => s.job || s.outroJob));
  const missing = w.type === "video" && !TemplateStudio.isTemplateVideo(w) && !isSvgVideo(w) && w.blocks.some((b) => !b.image);
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
    regenerate.disabled = w.blocks.some((b) => b.job && !b.job.error) ||
      Boolean(w.templateDeck?.slides?.some((s) => (s.job && !s.job.error) || (s.outroJob && !s.outroJob.error)));
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
  const imageProgress = isSvgVideo(w) ? null : app.querySelector("#storyboard-image-progress");
  if (imageProgress) {
    const ready = w.blocks.filter((b) => b.image).length;
    const failed = w.blocks.filter((b) => b.job?.error).length;
    const working = w.blocks.some((b) => b.job && !b.job.error);
    const progress = `分镜配图 ${ready}/${w.blocks.length}` +
      (working ? " · 生成中" : "") +
      (failed ? ` · ${failed} 张失败` : "");
    if (imageProgress.textContent !== progress) imageProgress.textContent = progress;
    imageProgress.classList.toggle("is-err", failed > 0);
    imageProgress.classList.toggle("is-busy", !failed && working);
    imageProgress.classList.toggle("is-ok", !failed && !working && ready === w.blocks.length);
    const fill = app.querySelector('[data-action="fill-video-images"]');
    if (fill) {
      fill.hidden = !missing;
      fill.disabled = !w.blocks.some((b) => !b.image && !b.job);
    }
    for (const el of app.querySelectorAll(".scene-choice")) {
      const state = el.querySelector("[data-scene-state]");
      const block = w.blocks[Number(el.dataset.val)];
      if (!state || !block) continue;
      const label = sceneImageState(block);
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
    if (w.type === "video" && owner.image) {
      const choice = app.querySelector('.scene-choice[data-val="' + index + '"] .scene-foot');
      if (choice) {
        let thumb = choice.querySelector(".scene-thumb");
        if (!thumb) {
          thumb = document.createElement("img");
          thumb.className = "scene-thumb";
          thumb.alt = "";
          choice.prepend(thumb);
        }
        thumb.src = owner.image;
      }
    }
    syncImageActions(w);
    return;
  }
  if (finished) {
    render(Boolean($("#stage-production-job")));
    return;
  }
  if (StageStudio.hasProductionJob(w)) {
    StageStudio.updateProductionJob(w);
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
  const { index, prompt, imageModel, imageSize, reference } = regenModal;
  const block = w.blocks[index];
  const models = Object.entries(config.imageModels).map(([id, spec]) => [
    id,
    spec[0],
  ]);
  const label =
    w.type === "video" ? "分镜 " + (index + 1) : block.name || "段落 " + (index + 1);

  const body =
    '<div class="asset-inline">' + btn("从素材库选择", "library-pick-picture", "outline", index) + "</div>" + arkKeyWarning() +
    '<label class="field">' + (w.type === "video" ? "本幕首帧画面（选填）" : "画面描述（选填）") +
    '<textarea id="imageprompt" rows="3" maxlength="1800" placeholder="例如：近景，一只手把药盒转到侧面，手指停在印日期的位置">' +
    esc(prompt) +
    "</textarea></label>" +
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

function templateHooks() {
  return {
    data,
    config,
    esc,
    btn,
    opts,
    openModal,
    arkKeyWarning,
    jsonRequest,
    changed,
    render,
    notify,
    current,
    authorize,
    openApiKeys,
  };
}

function editor(w) {
  const vid = w.type === "video";
  if (StageStudio.isActive(w)) return StageStudio.editor(w);
  if (isCodeMotion(w)) {
    codeMotionEditor(w);
    return;
  }
  if (TemplateStudio.isTemplateVideo(w)) {
    shell(
      w,
      "编辑模板分镜",
      1,
      TemplateStudio.templateEditorHtml(w, data, esc, btn, ico, savedLabel),
      btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
    );
    if (TemplateStudio.usesCodeMotion(w)) bindCodeMotionPreview(w, TemplateStudio.getSlideIndex(w));
    else requestAnimationFrame(() => TemplateStudio.fitTemplatePreviews());
    return;
  }
  const s = w.settings;
  const music = s.music ?? defaults.music;
  if (vid) {
    const ranges = shotRanges(w.blocks);
    const totalSec = Number(videoTotalSeconds(w).toFixed(1));
    const selected = Math.max(0, w.blocks.indexOf(selectedScenes.get(w)));
    const block = w.blocks[selected];
    const total = w.blocks.length;
    const activeTab = storyboardTabs.get(w) || "shot";
    const isSvg = isSvgVideo(w);
    const stats = block ? speechStats(block.line, block.seconds) : { label: "", over: false };
    const metaItems = [
      ...(isSvg ? [textModelLabel(resolveTextModel(s)), "16:9", "720p"] :
        [config.videoModels[s.videoModel][0], s.ratio, styles[w.style], s.resolution]),
      voiceLabel(s.voice),
      ...(config.videoBackgroundMusic ? [musicSummaryLabel(w)] : []),
      ...(w.drug ? ["药品：" + w.drug] : []),
    ];

    const topBar =
      '<div class="sheet vstudio-bar">' +
      '<div class="vstudio-summary">' +
      '<div class="vstudio-metrics">' +
      '<span class="status-pill">' + (isSvg ? svgVideoLabel : "AI 分镜动画") + "</span>" +
      '<span class="vstudio-metric">共 ' + total + " 幕 · " + totalSec + " 秒</span>" +
      (isSvg ? '' : '<span class="vstudio-stat" id="storyboard-image-progress" role="status"></span>') +
      "</div>" +
      '<div class="vstudio-meta-line">' +
      "<span>" + esc(metaItems.join(" · ")) + "</span>" +
      '<span class="vstudio-meta-dot" aria-hidden="true">·</span>' +
      '<span class="save-state" id="save-state">' + savedLabel(w) + "</span>" +
      "</div></div>" +
      '<div class="vstudio-actions">' +
      btn(ico("settings") + " 模型与参数", "work-settings", "outline") +
      (isSvg ? "" : btn("生成缺失配图", "fill-video-images", "secondary") +
        btn("统一重做配图", "restyle-images", "outline", "", "hidden")) +
      (w.video && !w.videoDirty ? btn("查看成片", "view-draft", "secondary") : "") +
      btn(isSvg ? "导出 MP4" : "用方舟生成视频", "compose", "primary") +
      "</div></div>" +
      (isSvg ? "" : arkKeyWarning());

    const stage =
      '<div class="vstudio-stage"><div class="sheet vstudio-stage-card">' +
      '<div class="vstudio-stage-head">' +
      '<div class="vstudio-pager">' +
      btn(
        ico("prev"),
        "select-scene",
        "icon-btn",
        selected - 1,
        (selected === 0 ? "disabled " : "") + 'aria-label="上一幕" title="上一幕"',
      ) +
      '<span class="shot-badge">分镜 ' + (selected + 1) + " / " + total + "</span>" +
      btn(
        ico("next"),
        "select-scene",
        "icon-btn",
        selected + 1,
        (selected >= total - 1 ? "disabled " : "") + 'aria-label="下一幕" title="下一幕"',
      ) +
      '<span class="vstudio-stage-title" data-stage-title>' +
      esc((block?.name || "").trim() || "未命名分镜") +
      "</span>" +
      (block
        ? '<span class="time-range" id="timerange-' + selected + '">' + ranges[selected] + " · " + Number(block.seconds.toFixed(1)) + "秒</span>"
        : "") +
      "</div>" +
      '<div class="shot-tools">' +
      btn(
        ico("arrowLeft"),
        "move-block",
        "icon-btn",
        selected + ":-1",
        (selected === 0 ? "disabled " : "") + 'aria-label="本幕前移" title="本幕前移"',
      ) +
      btn(
        ico("arrowRight"),
        "move-block",
        "icon-btn",
        selected + ":1",
        (selected >= total - 1 ? "disabled " : "") + 'aria-label="本幕后移" title="本幕后移"',
      ) +
      btn(
        ico("trash"),
        "remove-block",
        "icon-btn danger",
        selected,
        (total <= 2 ? "disabled " : "") + 'aria-label="移除本幕" title="移除本幕"',
      ) +
      "</div></div>" +
      (block ? '<div class="vstudio-storyboard-canvas">' +
        (isSvg ? svgStageHtml(w, block, selected) : pictureControls(w, block, selected)) + "</div>" : "") +
      '<div class="vstudio-rail">' +
      '<div class="vstudio-rail-head">' +
      '<span class="vstudio-rail-label">分镜顺序（' + total + ' 幕 · 支持 ← → 切换）</span>' +
      '<div class="row" style="gap:10px">' +
      (isSvg ? "" : btn("按口播校准时长", "time-shots", "textbtn")) +
      btn(ico("plus") + " 添加一幕", "append", "textbtn", "", total >= maxVideoShots ? "disabled" : "") +
      "</div></div>" +
      storyboardSwitcher(w, selected) +
      "</div></div></div>";

    const hasSvgBeats = isSvg && Boolean(block?.beats?.length);
    const svgActionPanel = isSvg && block && !hasSvgBeats
      ? '<label class="field">道具动作<select data-svg-action="' + selected + '">' +
        opts(Object.entries(config.svgMotion.actions), block.action) + '</select></label>' +
        btn("从素材库选动效", "library-pick-motion", "textbtn", selected)
      : "";
    const shotPanel = block
      ? '<div class="vstudio-panel">' +
        '<section class="vstudio-section">' +
        '<label class="field">本幕标题<input maxlength="60" data-block="' + selected + '" data-key="name" value="' + esc(block.name) + '" placeholder="例如：核对药盒有效期"></label>' +
        (hasSvgBeats ? svgBeatFields(block, selected) : '<div style="margin-top:12px"><div class="field-head"><label class="label" for="line-' + selected + '">口播台词</label>' +
        '<span class="pace' + (!isSvg && stats.over ? " warn" : "") + '" id="pace-' + selected + '">' + esc(isSvg ? "按实际口播对齐" : stats.label) + "</span></div>" +
        '<textarea id="line-' + selected + '" rows="4" maxlength="' + (isSvg ? 100 : 450) +
        '" class="autogrow" data-block="' + selected + '" data-key="line" placeholder="填写这一幕药师讲解的口播句子">' +
        esc(block.line) +
        "</textarea></div>") + "</section>" +
        (hasSvgBeats ? "" : '<section class="vstudio-section">' +
        (isSvg ? svgActionPanel : '<div class="tpl-two-col">' +
        '<label class="field">单镜时长<select data-seconds="' + selected + '">' +
        opts(
          Array.from(
            { length: config.videoModels[w.settings.videoModel][2] - 3 },
            (_, n) => [String(n + 4), n + 4 + " 秒"],
          ),
          String(block.seconds),
        ) +
        "</select></label>" +
        '<div class="vstudio-time-helper"><span class="label">自动估时</span>' +
        btn("按口播校准全片", "time-shots", "outline widebtn") +
        "</div></div>" +
        '<label class="field" style="margin-top:12px">画面动作与镜头衔接<textarea rows="3" maxlength="400" data-block="' + selected + '" data-key="motion">' +
        esc(block.motion || defaultMotion) +
        "</textarea></label>") +
        "</section>") + "</div>"
      : "";

    const globalPanel =
      '<div class="vstudio-panel">' +
      '<section class="vstudio-section">' +
      '<label class="field">作品标题<input maxlength="300" data-bind="title" value="' + esc(w.title) + '" placeholder="输入清晰易懂的科普标题"></label>' +
      (isSvg ? TemplateStudio.templateSetupHtml(w, data, esc, btn) : '<label class="field" style="margin-top:12px">全片场景与道具<textarea rows="3" maxlength="240" class="autogrow" data-bind="setting" placeholder="例如：家中客厅的浅色木桌，桌上有白色药箱、一盒浅蓝色药盒和米色记录本">' +
      esc(w.setting || "") +
      '</textarea></label><p class="footmeta">生成分镜图时沿用这里的场景与道具描述，让各幕视觉保持连贯。</p>') +
      "</section>" +
      '<section class="vstudio-section">' +
      '<span class="label">背景音乐</span>' +
      renderMusicStudioCard(w, { showModeChips: true }) +
      "</section>" +
      '<section class="vstudio-section">' +
      '<span class="label">当前画风与生成规格</span>' +
      '<div class="summary-kv" style="margin-top:6px">' +
      metaItems.map((m) => '<span class="pill">' + esc(m) + "</span>").join("") +
      "</div>" +
      '<div style="margin-top:12px">' + btn("调整画风、模型与配音", "work-settings", "outline widebtn") + "</div>" +
      "</section></div>";

    const inspector =
      '<aside class="vstudio-inspector"><div class="sheet vstudio-inspector-card">' +
      '<div class="vstudio-tabs" role="tablist" aria-label="分镜编辑面板切换">' +
      '<button type="button" class="vstudio-tab" role="tab" data-action="sb-inspector-tab" data-val="shot" aria-selected="' + (activeTab === "shot") + '">本幕脚本 <span class="vstudio-tab-sub">分镜 ' + (selected + 1) + "</span></button>" +
      '<button type="button" class="vstudio-tab" role="tab" data-action="sb-inspector-tab" data-val="global" aria-selected="' + (activeTab === "global") + '">全片设定 <span class="vstudio-tab-sub">' + esc(isSvg ? svgVideoLabel : styles[w.style]) + "</span></button>" +
      "</div>" +
      (activeTab === "global" ? globalPanel : shotPanel) +
      "</div></aside>";

    shell(
      w,
      "编辑分镜脚本",
      1,
      '<div class="vstudio">' + topBar + '<div class="vstudio-grid">' + stage + inspector + "</div></div>",
      btn(ico("trash") + " 删除作品", "ask-delete", "textbtn danger", w.id),
    );
    if (isSvg) TemplateStudio.fitTemplatePreviews();
    return;
  }

  const body = articlePaper(w, true);

  const summaryPills = [
    config.imageModels[s.imageModel][0],
    "画幅 " + s.ratio,
    styles[w.style],
    s.imageSize,
    ...(w.drug ? ["药品：" + w.drug] : []),
  ];

  const aside =
    '<div class="sheet"><div class="card-head"><h2>预览与发布</h2><span class="status-pill">火山方舟</span></div><div class="summary-kv">' +
    summaryPills.map((p) => '<span class="pill">' + esc(p) + "</span>").join("") +
    "</div>" +
    arkKeyWarning() +
    '<div style="margin-top:12px">' +
    btn("调整模型参数", "work-settings", "outline widebtn") +
    "</div>" +
    btn("生成建议配图", "fill-article-images", "secondary widebtn", "", 'hidden style="margin-top:12px"') +
    btn("统一重做配图", "restyle-images", "outline widebtn", "", 'hidden style="margin-top:8px"') +
    '<div class="dividerline"></div><div class="stack-actions">' +
    btn("保存并预览", "preview", "primary widebtn") +
    '</div><p class="footmeta save-state" id="save-state">' +
    savedLabel(w) +
    "</p></div>";

  shell(
    w,
    "编辑图文草稿",
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
    w.blocks.map((b) => isCodeMotion(w) ? [b.name, b.line, b.takeaway, b.visual, b.motion, b.motif, b.tone, b.items, b.labels] :
      isSvgVideo(w) ? [b.name, b.line, b.action, b.beats] : [b.name, b.line, b.image]),
    isCodeMotion(w) ? w.motionMeta : null,
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
    isTpl = TemplateStudio.isTemplateVideo(w),
    isSvg = isSvgVideo(w),
    reviewing = w.stage === "review";
  const ranges = vid ? shotRanges(w.blocks) : [];
  const motion = isCodeMotion(w);

  const metaPills = [
    vid ? (motion ? "代码动效" : isTpl ? "信息图模板视频" : isSvg ? svgVideoLabel : "视频科普") : "图文科普 · " + w.layout,
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
          Number(videoTotalSeconds(w).toFixed(1)) + " 秒",
          voiceLabel(w.settings.voice),
          ...(videoMusicBadge(w.video) ? [videoMusicBadge(w.video)] : []),
          motion || isTpl ? "1280×720 模板成片" : isSvg ? "1280×720 SVG 成片" : "方舟动态成片",
        ]
      : []),
  ];

  const videoAssets = w.video?.assetVersions || w.video?.assets || [];
  const body = vid
    ? '<div class="video-stage" data-ratio="' +
      esc(w.settings.ratio) +
      '"><video controls playsinline class="video-player" src="' +
      esc(w.video.url) +
      '" poster="' +
      esc(w.video.poster || w.blocks[0]?.image || "") +
      '">' +
      (isTpl || w.video.burnedCaptions
        ? ""
        : '<track default kind="subtitles" srclang="zh" label="中文" src="' +
          esc(w.video.captions) +
          '">') +
      "</video></div>" +
      '<div id="video-stale" class="banner warn" hidden>内容或背景音乐已修改。返回编辑并重新合成后，成片会同步更新。</div>' +
      (videoAssets.some((item) => item.credit) ?
        '<details class="transcript"><summary>素材署名</summary><ul>' +
        videoAssets.filter((item) => item.credit).map((item) =>
          `<li>${esc(item.credit)} · ${esc(item.license)}${item.termsUrl ? ` · <a href="${esc(item.termsUrl)}" target="_blank" rel="noopener">授权详情</a>` : ""}</li>`).join("") +
        '</ul></details>' : "") +
      '<div class="dividerline"></div><details class="transcript" open><summary>' +
      w.blocks.length +
      (isTpl ? " 页模板与口播台词" : " 幕分镜与口播台词") +
      "</summary>" +
      w.blocks
        .map(
          (b, i) =>
            '<section class="shot"><div class="shothead"><div class="shot-title-group"><span class="shot-badge">' +
            (isTpl ? "第 " + (i + 1) + " 页" : "分镜 " + (i + 1)) +
            "</span><h3>" +
            esc(b.name) +
            '</h3></div><span class="time-range">' +
            ranges[i] +
            "</span></div><p>" +
            esc(b.line) +
            "</p>" +
            (isTpl || motion ? "" : pictureControls(w, b, i, true)) +
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
          vid ? (isTpl && !StageStudio.isActive(w) ? "返回模板编辑" : "返回分镜编辑") : "编辑正文与配图",
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
  return job?.target === "compose" &&
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
  const makingShot = w.job.stageShotIndex !== undefined;
  const replanning = w.job.stageDraft === "replan";
  const rejected = portraitRejected(w.job);
  const rejectedIndex = rejected ? rejectedFrameIndex(w) : -1;
  const portraitMessage = rejected &&
    (rejectedIndex >= 0 ? `方舟判定第 ${rejectedIndex + 1} 幕的首帧可能含真人。` : "方舟判定本次使用的首帧可能含真人。") +
    "换成无人物画面后再合成。";
  const recovery = rejected
    ? (rejectedIndex >= 0 ? btn(`重做第 ${rejectedIndex + 1} 幕无人物首帧`, "replace-portrait-frame", "primary") : "")
    : btn(w.job.partial ? "重试配图规划" : "继续此任务", "retry", "primary");
  shell(
    w,
    failed ? "生成任务需要处理" :
      w.job.target === "svg-speech" ? "正在生成口播试听" :
      makingShot ? `正在制作第 ${w.job.stageShotIndex + 1} 幕画面` :
      replanning ? "正在编排分镜画面" :
      writing ? (w.type === "article" ? "正在生成文章" : "正在生成分镜脚本") : "正在合成视频",
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
          ? (rejected ? portraitMessage : isNetworkErrorMessage(w.job.error) ? NETWORK_ERROR_MESSAGE : w.job.error)
          : makingShot ? "画面制作完成后会回到分镜编辑。"
          : writing ? "生成完成后，草稿会保存在「我的作品」。" : "合成期间可先返回工作台处理其他草稿，已完成的分镜会自动复用。",
      ) +
      '</div>' + (rejected ? '<details class="shot-options"><summary>查看方舟原始报错</summary><p class="footmeta">' +
        esc(w.job.error) + "</p></details>" : "") + '<div class="actions">' +
      (failed
        ? recovery +
          (w.job.partial ? btn("保留正文，稍后配图", "keep-written-article", "secondary") : "") +
          btn(writing && !makingShot && !replanning ? "返回主题设置" : "返回分镜编辑", "abort-job", "secondary")
        : "") +
      btn("返回工作台", "home", "textbtn") +
      "</div></div>",
  );
}

const NETWORK_ERROR_MESSAGE =
  "无法连接本地工作台服务，请确认启动窗口仍在运行（或双击项目目录中的「启动工作台.cmd」重新启动）后重试。";

function isNetworkErrorMessage(message) {
  return message === NETWORK_ERROR_MESSAGE ||
    /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(String(message || "").trim());
}

async function jsonRequest(path, init) {
  let r;
  try {
    r = await fetch(path, init);
  } catch {
    const err = Error(NETWORK_ERROR_MESSAGE);
    err.networkError = true;
    throw err;
  }
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
  if (result.status === "done" || result.status === "running" || result.status === "queued") {
    job.error = "";
    poll(w);
  } else if (result.status === "failed" && isNetworkErrorMessage(job.error) && result.error) {
    job.progress = result.progress || job.progress;
    if (job.target === "write-draft" && result.output?.sections && !job.partial) {
      job.partial = result.output;
    }
    job.error = result.error;
    save();
    updateJobView(w, w);
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
  let netFails = 0;
  try {
    while (owner.job === job && !job.error) {
      try {
        const result = await jsonRequest("/api/jobs/" + job.payload.id);
        netFails = 0;
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
            if (result.output?.music === "auto" && result.output?.musicMeta?.url) {
              refreshMusicLibrary();
            }
            if (result.output.shotSeconds?.length === w.blocks.length) {
              result.output.shotSeconds.forEach((seconds, index) => { w.blocks[index].seconds = seconds; });
            }
            w.renderMode = job.payload.mode;
            w.stage = "draft";
            if (job.payload.codeMotion === true || job.payload.stage === true) w.editing = false;
            w.videoDirty = false;
            w.viewingSetup = false;
          } else if (job.target === "write-draft") {
            if (job.stageDraft) StageStudio.installDraft(w, job.stageDraft, result.output, job);
            else applyWrittenDraft(w, result.output);
          } else if (job.stageImageSlots) {
            StageStudio.installImages(w, job.stageImageSlots, result.output, job);
          } else if (job.target === "svg-speech") {
            if (job.stageSpeechIndex !== undefined) {
              StageStudio.installSpeech(w, job.stageSpeechIndex, job, result.output);
            } else {
              const item = job.payload.items[0];
              const block = w.blocks[item.index];
              if (block?.line.trim() === item.line) {
                block.svgSpeech = { ...result.output, line: item.line, voice: job.payload.settings.voice };
              }
            }
          } else {
            const single = owner !== w;
            result.output.images.forEach((img, i) => {
              const block = single ? owner : w.blocks[i];
              if (!block) return;
              block.image = img;
              block.imageModel = job.payload.settings.imageModel;
              block.imageSize = job.payload.settings.imageSize;
              block.imageStyle = job.payload.styleReference ? job.payload.style : undefined;
              block.storyboardFrame = job.payload.storyboard === true;
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
        if (e.networkError && ++netFails <= 3) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
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
    mode: "ark",
    kind: target === "compose" ? "video" : target === "write-draft" ? "draft" : target === "svg-speech" ? "svg-speech" : "images",
    settings: { ...settings, mode: "ark" },
    style: w.style,
    items,
  };
  if (config.workCosts || isSvgVideo(w)) payload.workId = w.id;
  if (payload.kind === "images" && config.imageStyleReference) payload.styleReference = true;
  if (payload.kind === "video" && isCodeMotion(w)) {
    payload.codeMotion = true;
    payload.title = w.title.trim();
  } else if (payload.kind === "video" && isSvgVideo(w)) {
    payload.svg = true;
    payload.title = w.title.trim();
    payload.svgLayout = svgTemplateLayout(w);
  } else if (w.type === "video" && payload.kind !== "draft") payload.storyboard = true;
  return { target, payload };
}

async function startJob(w, target, items, extra = {}, settings = w.settings) {
  const owner = target === "regenerate" ? w.blocks[extra.index] : w;
  if (w.job || owner.job) return;
  owner.job = { ...createJob(w, target, items, settings), ...extra };
  await sendJob(w, owner);
}

function authorize(w, count, kind, fn, voicedCount = count, draftOptions) {
  const writing = kind === "draft";
  const motion = kind === "code-motion";
  const isArk = !writing && !motion;
  const usesSpeech = (kind === "video" || motion) && w.settings.voice !== "无配音" && voicedCount > 0;
  if (motion && !config.codeMotionReady) {
    notify("代码动效需要 Node.js、Playwright 和 FFmpeg。请按使用说明安装。", "warn");
    return;
  }
  if (writing && !config.textModel) {
    notify("请重启本地工作台，再刷新页面以启用 DeepSeek 文字生成。", "warn");
    return;
  }
  if (writing && !config.deepseekKeyPresent) {
    openApiKeys("deepseek");
    return;
  }
  if (isArk && !config.keyPresent) {
    openApiKeys("ark");
    return;
  }
  if (usesSpeech && !config.speechKeyPresent) {
    openApiKeys("speech");
    return;
  }
  if (motion && !usesSpeech) return fn();
  retryPayload = fn;
  const reference = videoReferenceSeconds(w);
  const articlePictures = writing && w.type === "article"
    ? (w.job ? w.job.articleImages?.settings : w.settings)
    : null;
  const pictureSummary = articlePictures
    ? (config.keyPresent
      ? `<p>正文完成后自动调用火山方舟生成建议配图，每段最多 1 张，全篇最多 ${maxArticleImages} 张，按实际生成张数计费。</p>`
      : `<p>正文完成后将尝试调用火山方舟生成建议配图（当前尚未连接火山方舟，届时可补充连接后再生成）。</p>`)
    : "";
  const chosenTextModel = resolveTextModel(w.settings);
  const stageText = draftOptions ? `<p>${esc(draftOptions.detail)}预计提交 ${count} 次文本请求，按 Token 计费。</p>` +
    (draftOptions.image ? `<p>${esc(draftOptions.image)}</p>` : "") : "";
  const textSummary = stageText || (writing ? "<p>将使用 DeepSeek " +
    (w.type === "video" ? (isCodeMotion(w)
      ? (reference === null
        ? "按主题内容动态规划分镜数量、版式、动效与口播。"
        : `参考 ${reference} 秒（控制在 ${reference + 4} 秒以内）按主题动态规划分镜、动效与口播。`) :
      isSvgVideo(w) ? "按主题规划 SVG 道具、动作与口播。" : TemplateStudio.isTemplateVideo(w)
      ? (reference === null
        ? "按主题内容灵活规划模板分镜与口播脚本。"
        : `参考 ${reference} 秒（控制在 ${reference + 4} 秒以内）按主题内容规划模板分镜与口播脚本。`)
      : (reference === null
        ? "按主题生成完整口播，再根据口播安排分镜时长。"
        : `参考 ${reference} 秒（控制在 ${reference + 4} 秒以内）生成完整口播，再根据口播安排分镜时长。`)) :
      w.job?.partial ? "根据已生成的正文规划配图。" : "生成完整文章，再按正文决定哪些段落需要配图。") +
    (isSvgVideo(w) ? "预计提交 1 次文本请求，分镜校验未通过时校正 1 次，按 token 计费。</p>" :
      "预计提交 " + count + " 次文本请求，按 token 计费。</p>") + pictureSummary +
    '<div class="summary-kv" style="margin-top:12px"><span class="pill">' + esc(textModelLabel(chosenTextModel)) + "</span></div>" : "");
  const arkSummary = !isArk ? "" : (
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
      esc(w.settings.sizeLabel || w.settings.ratio) +
      "</span></div>"
  );
  const speechSummary = usesSpeech
    ? "<p>最多为 <b>" + voicedCount + "</b> 个分镜生成火山语音配音，按口播字符数计费。</p>"
    : "";
  openModal(
    writing ? "确认使用 DeepSeek 生成" : isArk ? "确认使用火山方舟生成" : "确认使用火山语音配音",
    textSummary + arkSummary + (motion ? "<p>各幕代码动效画面在本地逐帧渲染。</p>" : "") +
    speechSummary + '<div class="actions dialog-actions">' +
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

function authorizeSpeechOnly(w, count, fn, options = {}) {
  retryPayload = fn;
  const usesAvatar = Boolean(options.usesAvatar);
  const avatarModel = resolveAvatarMode(options.avatarModel || w.settings.avatarMode || defaults.avatarMode);
  const avatarRes = options.avatarResolution || w.settings.avatarResolution || defaults.avatarResolution;
  const estSec = videoTotalSeconds(w);
  const rate = avatarRatePerSecond(avatarModel, avatarRes);
  const estAvatarFee = feeAmount.format(estSec * rate);
  const presenterLabel = options.presenterLabel || "人物形象";
  const modelLabel = avatarModel === "wan2.2-s2v"
    ? `万相数字人 Wan2.2-S2V（${avatarRes}）`
    : "声动人像 VideoRetalk";
  const genModeDesc = avatarModel === "wan2.2-s2v"
    ? "按 ≤18 秒自动分片连续生成对口型视频"
    : "整片一次生成连续对口型视频";
  const body = options.reuseSpeech
    ? "<p>优先复用原配音" + (usesAvatar ? "与数字人素材" : "") +
      "。只有本机找不到可用素材时，才会调用相应服务并计费。</p>"
    : usesAvatar
    ? "<p>本次合成将调用以下两项按量服务：</p>" +
      "<ul style=\"margin:8px 0 12px 18px;line-height:1.7\">" +
      "<li><b>豆包语音（" + esc(voiceLabel(w.settings.voice)) + "）</b>：为 <b>" + count + "</b> 页口播生成配音，按口播字符数计费；</li>" +
      "<li><b>阿里云百炼 · " + esc(modelLabel) + "</b>：为左侧「" + esc(presenterLabel) + "」" + genModeDesc + "（约 " + estSec + " 秒，参考费用约 <b>" + esc(estAvatarFee) + "</b>；相同头像与台词自动复用本地缓存不重复计费）。</li>" +
      "</ul>" +
      '<p class="footmeta">右侧信息图与字幕由本地 1280×720 高清合成，不消耗分镜视频模型费用。</p>'
    : "<p>模板画面由本地直接渲染（1280×720，<b>0 视频模型费用</b>），将为 <b>" +
      count +
      "</b> 页口播调用火山语音（" +
      esc(voiceLabel(w.settings.voice)) +
      "），仅按口播字符数计费。</p>";
  openModal(
    options.reuseSpeech ? "确认重新合成 MP4" :
      usesAvatar ? "确认合成动态数字人模板视频" : "确认合成模板视频并生成配音",
    body +
      '<div class="actions dialog-actions">' +
      btn("取消", "close", "secondary") +
      btn("确认合成 MP4", "confirm-paid", "primary") +
      "</div>",
    "confirm",
  );
}

function generate(w) {
  if (!w.topic.trim()) {
    topicMissing();
    return;
  }
  if (w.job || w.blocks.some((b) => b.job && !b.job.error)) return;
  if (StageStudio.isActive(w)) return StageStudio.requestDraft(w);
  if (isCodeMotion(w)) {
    return authorize(w, 1, "draft", () => {
      const settings = {
        ...w.settings,
        ratio: "16:9",
        duration: videoReferenceSeconds(w),
        textModel: resolveTextModel(w.settings),
      };
      const job = createJob(w, "write-draft", [], settings);
      job.payload.draft = { type: "video", videoMode: "code-motion", topic: w.topic.trim(), drug: w.drug };
      w.job = job;
      return sendJob(w);
    });
  }
  if (TemplateStudio.isTemplateVideo(w)) {
    return authorize(w, 1, "draft", () => {
      const settings = {
        ...w.settings,
        mode: "ark",
        ratio: "16:9",
        duration: videoReferenceSeconds(w),
        textModel: resolveTextModel(w.settings),
      };
      const job = createJob(w, "write-draft", [], settings);
      job.payload.draft = {
        type: "video",
        videoMode: "template",
        topic: w.topic.trim(),
        drug: w.drug,
      };
      w.job = job;
      return sendJob(w);
    });
  }
  return authorize(w, w.type === "article" ? 2 : 1, "draft", () => {
    const settings = { ...w.settings, mode: "ark", textModel: resolveTextModel(w.settings) };
    if (w.type === "video") settings.duration = videoReferenceSeconds(w);
    const job = createJob(w, "write-draft", [], settings);
    job.payload.draft = { type: w.type, topic: w.topic.trim(), layout: w.layout, drug: w.drug };
    if (isSvgVideo(w)) job.payload.draft.videoMode = "svg";
    else if (w.type === "video") job.payload.draft.pharmacist = w.avatar === pharmacistAvatar;
    else {
      // Keep the confirmed image settings and reuse the same request IDs when resuming this draft.
      job.articleImages = {
        settings: { ...w.settings, mode: "ark" },
        jobIds: Array.from({ length: maxArticleImages }, () => crypto.randomUUID()),
      };
    }
    w.job = job;
    return sendJob(w);
  });
}

function articleBlocks(sections) {
  return sections.map(([name, line, visual]) => ({
    name, line, image: "", seconds: 0, variant: 0,
    ...(visual ? { suggestedImage: true } : {}),
    prompt: visual || "",
  }));
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
    if (isCodeMotion(w)) {
      installCodeMotionDraft(w, output);
      return;
    }
    if (TemplateStudio.isTemplateVideo(w) && Array.isArray(output.slides)) {
      TemplateStudio.installTemplateDeck(w, output, data);
      return;
    }
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
  const needsLeader = w.type === "video" && config.imageStyleReference && !reference;
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
  if (stopSvgPlayback) stopSvgPlayback();
  if (!config) return;
  const prevScroll = window.scrollY;
  if (route()[0] === "library") {
    updateTopbar();
    StudioAssets.page();
    if (!preserveScroll) window.scrollTo(0, 0);
    return;
  }
  const w = current();
  if (route()[0] !== "work" || !w) {
    home();
    if (!preserveScroll) window.scrollTo(0, 0);
    return;
  }
  StageStudio.normalizeWork(w);
  if (w.job) {
    if (w.job.target === "initial") setup(w);
    else if (StageStudio.hasProductionJob(w)) editor(w);
    else jobView(w);
    if (!w.job.error) poll(w);
    else if (w.job.target === "compose" || w.job.target === "write-draft" || StageStudio.hasProductionJob(w)) recoverFinishedJob(w);
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
  if (TemplateStudio.isTemplateVideo(w) && !StageStudio.isActive(w)) {
    TemplateStudio.resumeSlideJobs(w, templateHooks());
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

function editedLibraryChoice(w) {
  if (w.video) w.videoDirty = true;
  changed(w);
  render(true);
}

function useLibraryPicture(w, index, isTemplate = false) {
  if (!w) return;
  const target = isTemplate ? w.templateDeck?.slides[index] : w.blocks[index];
  if (!target || target.job) return;
  StudioAssets.pick(["image"], (item) => {
    if (target.job) return;
    if (isTemplate) {
      target.contentImage = item.url;
      target.imageSource = "library";
      target.imageModel = "";
      target.imageSize = "";
      TemplateStudio.syncBlocksFromDeck(w);
    } else {
      target.image = item.url;
      target.imageModel = "";
      target.imageSize = "";
      target.imageStyle = "";
      target.storyboardFrame = false;
    }
    editedLibraryChoice(w);
    notify(`已选用「${item.name}」`, "ok");
  }, { topic: w.topic, ratio: isTemplate ? "16:9" : w.settings.ratio, style: isTemplate ? w.templateDeck.theme : styles[w.style] });
}

function collectLibraryPicture(w, index, isTemplate = false) {
  if (!w) return;
  const target = isTemplate ? w.templateDeck?.slides[index] : w.blocks[index];
  const image = isTemplate ? target?.contentImage : target?.image;
  if (!image?.startsWith("/media/")) return;
  StudioAssets.collect(image, {
    name: (target.name || target.headline || w.title || "配图").slice(0, 80),
    topic: (w.topic || w.title || "").slice(0, 200),
    ratio: isTemplate ? "16:9" : w.settings.ratio,
    style: isTemplate ? w.templateDeck.theme : (styles[target.imageStyle] || styles[w.style] || ""),
    prompt: target.imagePrompt || target.prompt || "",
    model: target.imageModel || "",
  });
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
  if (StageStudio.handleInput(w, el)) return;
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
  if (el.id === "tpl-image-prompt") {
    TemplateStudio.updateImageModalField(w, "prompt", el.value, templateHooks());
    return;
  }
  if (el.classList.contains("autogrow")) autoGrow(el);
  if (el.dataset.pharm) {
    const p = TemplateStudio.ensurePharmacist(data);
    p[el.dataset.pharm] = el.value;
    if (w?.templateDeck) {
      w.templateDeck.pharmacist = { ...p };
      if (w.video) w.videoDirty = true;
      TemplateStudio.refreshLivePreview(w, data);
    } else if (isCodeMotion(w)) {
      if (w.video) w.videoDirty = true;
      refreshCodeMotionPreview(w, Math.max(0, w.blocks.indexOf(selectedScenes.get(w))));
    } else if (isSvgVideo(w)) {
      if (w.video) w.videoDirty = true;
      refreshSvgStage(w);
    }
    if (w) changed(w);
    else save();
    return;
  }
  if (!w) return;
  if (isSvgVideo(w) && el.dataset.svgBeat !== undefined && el.dataset.svgField !== "action") {
    updateSvgBeat(w, el);
    return;
  }
  if (isCodeMotion(w) && handleCodeMotionInput(w, el)) {
    return;
  }
  if (TemplateStudio.isTemplateVideo(w) && w.templateDeck) {
    const deck = w.templateDeck;
    if (el.dataset.tplGlobal === "title") {
      deck.title = el.value;
      w.title = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
      return;
    }
    if (el.dataset.tplGlobal === "shortTitle") {
      deck.shortTitle = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
      return;
    }
    if (el.dataset.tplGlobal === "disclaimer") {
      deck.disclaimer = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
      return;
    }
    if (el.dataset.tplChap !== undefined) {
      const ci = Number(el.dataset.tplChap);
      deck.chapters[ci] = el.value;
      const opt = app.querySelector('select[data-tpl-chapter-idx] option[value="' + ci + '"]');
      if (opt) opt.textContent = el.value.trim() || `章节${ci + 1}`;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
      return;
    }
    if (el.dataset.tplSlide !== undefined) {
      const si = Number(el.dataset.tplSlide);
      const slide = deck.slides[si];
      if (!slide) return;
      if (el.dataset.tplField) {
        slide[el.dataset.tplField] = el.value;
        if (el.dataset.tplField === "name") {
          const label = el.value.trim() || slide.headline || `第 ${si + 1} 页`;
          const tabName = app.querySelector('.scene-choice[data-val="' + si + '"] [data-scene-name]');
          if (tabName) tabName.textContent = label;
          const stageTitle = app.querySelector("[data-stage-title]");
          if (stageTitle) stageTitle.textContent = label;
        }
        if (el.dataset.tplField === "line") {
          // If the user edits the full slide narration directly, clear stale per-beat lines only if text diverged
          if (Array.isArray(slide.beats) && slide.beats.length) {
            const joined = slide.beats.map((b) => b.line || "").join("");
            if (joined !== el.value) {
              slide.beats = [];
            }
          }
          slide.seconds = Math.max(4, recommendedShotSeconds(spokenChars(el.value)));
          const paceEl = $("#tpl-pace-" + si);
          if (paceEl) {
            const st = speechStats(el.value, slide.seconds);
            paceEl.textContent = st.label;
          }
          const secBadge = app.querySelector('[data-slide-sec="' + si + '"]');
          if (secBadge) secBadge.textContent = slide.seconds + "s";
          const stageTime = app.querySelector("[data-stage-time]");
          if (stageTime) stageTime.textContent = "约 " + slide.seconds + " 秒";
        }
      } else if (el.dataset.tplBeat !== undefined) {
        const bi = Number(el.dataset.tplBeat);
        slide.beats ||= [];
        slide.beats[bi] ||= { label: "", focus: "all", line: "", highlightWords: [] };
        slide.beats[bi][el.dataset.tplBsub] = el.value;
        if (el.dataset.tplBsub === "line") {
          slide.line = slide.beats.map((b) => b.line || "").join("");
          const mainLine = $("#tpl-line-" + si);
          if (mainLine) mainLine.value = slide.line;
          slide.seconds = Math.max(4, recommendedShotSeconds(spokenChars(slide.line)));
          const paceEl = $("#tpl-pace-" + si);
          if (paceEl) paceEl.textContent = speechStats(slide.line, slide.seconds).label;
          const secBadge = app.querySelector('[data-slide-sec="' + si + '"]');
          if (secBadge) secBadge.textContent = slide.seconds + "s";
          const stageTime = app.querySelector("[data-stage-time]");
          if (stageTime) stageTime.textContent = "约 " + slide.seconds + " 秒";
        }
      } else if (el.dataset.tplArr) {
        slide[el.dataset.tplArr] ||= [];
        slide[el.dataset.tplArr][Number(el.dataset.tplI)] = el.value;
      } else if (el.dataset.tplJoined) {
        slide[el.dataset.tplJoined] = el.value
          .split(/[、,，\s]+/)
          .map((x) => x.trim())
          .filter(Boolean);
      } else if (el.dataset.tplCol !== undefined) {
        const ci = Number(el.dataset.tplCol);
        slide.columns ||= [{}, {}];
        slide.columns[ci] ||= {};
        slide.columns[ci][el.dataset.tplSub] = el.dataset.tplSub === "points"
          ? el.value.split(/\n+/).map((x) => x.trim()).filter(Boolean)
          : el.value;
      } else if (el.dataset.tplStep !== undefined) {
        const sti = Number(el.dataset.tplStep);
        slide.steps ||= [];
        slide.steps[sti] ||= {};
        slide.steps[sti][el.dataset.tplSub] = el.value;
      } else if (el.dataset.tplWarn !== undefined) {
        const wi = Number(el.dataset.tplWarn);
        slide.warnings ||= [];
        slide.warnings[wi] ||= {};
        slide.warnings[wi][el.dataset.tplSub] = el.value;
      } else if (el.dataset.tplPoint !== undefined) {
        const pi = Number(el.dataset.tplPoint);
        slide.points ||= [];
        slide.points[pi] ||= {};
        slide.points[pi][el.dataset.tplSub] = el.value;
      }
      TemplateStudio.syncBlocksFromDeck(w);
      const totalMeta = app.querySelector("[data-tpl-total-meta]");
      if (totalMeta) totalMeta.textContent = `共 ${deck.slides.length} 页 · 约 ${videoTotalSeconds(w)} 秒`;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
      return;
    }
  }
  if (el.dataset.bind) {
    w[el.dataset.bind] = el.value;
    if (isSvgVideo(w) && el.dataset.bind === "title") {
      if (w.video) w.videoDirty = true;
      refreshSvgStage(w);
    }
    if (el.id === "topic") {
      const counter = $("#chars");
      if (counter) counter.textContent = el.value.length + " / 300";
      const topicBox = app.querySelector(".setup-topic");
      if (topicBox) {
        const txt = el.value.trim();
        topicBox.classList.toggle("empty", !txt);
        topicBox.querySelector("p").textContent = txt || "尚未填写主题，请在左侧输入或选择推荐主题";
      }
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
    if (isSvgVideo(w)) refreshSvgStage(w);
    if (el.dataset.key === "name" && w.type === "video") {
      const label = el.value.trim() || "未命名分镜";
      const sceneName = app.querySelector('.scene-choice[data-val="' + idx + '"] [data-scene-name]');
      if (sceneName) sceneName.textContent = label;
      const stageTitle = app.querySelector("[data-stage-title]");
      if (stageTitle) stageTitle.textContent = label;
      if (w.video) w.videoDirty = true;
    }
    if (el.dataset.key === "line") {
      const paceEl = $("#pace-" + idx);
      if (paceEl) {
        if (isSvgVideo(w)) {
          paceEl.textContent = "按实际口播对齐";
        } else if (w.type === "video") {
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
  if (el.dataset.reuseBgm && w) {
    const val = el.value;
    if (val && val.startsWith("library:") && findLibraryTrack(val)) {
      if ((w.settings.music ?? defaults.music) !== val) {
        w.settings.music = val;
        if (w.video) w.videoDirty = true;
        changed(w);
      }
      render(true);
    }
    return;
  }
  if (el.dataset.tplUpload) {
    const file = el.files?.[0];
    el.value = "";
    if (file) {
      const slideIdx = el.dataset.tplSlide !== undefined ? Number(el.dataset.tplSlide) : undefined;
      TemplateStudio.handleFileUpload(file, el.dataset.tplUpload, w, data, changed, render, notify, slideIdx)
        .catch((err) => notify(err.message || "上传图片失败", "warn"));
    }
    return;
  }
  if (el.id === "tpl-picture-model") {
    TemplateStudio.updateImageModalField(w, "model", el.value, templateHooks());
    return;
  }
  if (el.id === "tpl-picture-size") {
    TemplateStudio.updateImageModalField(w, "size", el.value, templateHooks());
    return;
  }
  if (el.dataset.tplSlideType && w?.templateDeck) {
    const slide = w.templateDeck.slides[Number(el.dataset.tplSlide)];
    if (slide && TemplateVideo.SLIDE_TYPES[el.value]) {
      const nextType = el.value;
      slide.type = nextType;
      if (nextType === "cover") {
        slide.question ||= slide.headline || "";
        slide.answer ||= slide.lead || "";
        slide.pills ||= [];
      } else if (nextType === "explain" || nextType === "summary") {
        if (!Array.isArray(slide.points) || !slide.points.length) {
          slide.points = [{ title: slide.headline || "核心要点", desc: slide.lead || "" }];
        }
      } else if (nextType === "compare") {
        if (!Array.isArray(slide.columns) || slide.columns.length < 2) {
          slide.columns = [
            { title: "情况一", badge: "", points: [""], footLabel: "", footValue: "" },
            { title: "情况二", badge: "", points: [""], footLabel: "", footValue: "" },
          ];
        }
      } else if (nextType === "steps") {
        if (!Array.isArray(slide.steps) || slide.steps.length < 2) {
          slide.steps = [
            { title: "第一步", desc: "", key: "" },
            { title: "第二步", desc: "", key: "" },
          ];
        }
      } else if (nextType === "warning") {
        if (!Array.isArray(slide.warnings) || !slide.warnings.length) {
          slide.warnings = [{ title: "就医信号", desc: "" }];
        }
      }
      if (w.video) w.videoDirty = true;
      changed(w);
      render(true);
    }
    return;
  }
  if (el.dataset.tplChapterIdx && w?.templateDeck) {
    const slide = w.templateDeck.slides[Number(el.dataset.tplSlide)];
    if (slide) {
      slide.chapterIndex = Number(el.value);
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
    }
    return;
  }
  if (el.dataset.tplLayoutMode && w?.templateDeck) {
    const slide = w.templateDeck.slides[Number(el.dataset.tplSlide)];
    if (slide) {
      slide.layoutMode = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      render(true);
    }
    return;
  }
  if (el.dataset.tplMotionStyle && w?.templateDeck) {
    const slide = w.templateDeck.slides[Number(el.dataset.tplSlide)];
    if (slide) {
      slide.motionStyle = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
    }
    return;
  }
  if (isCodeMotion(w) && handleCodeMotionChange(w, el)) {
    return;
  }
  if (el.dataset.tplBeatFocus !== undefined && w?.templateDeck) {
    const slide = w.templateDeck.slides[Number(el.dataset.tplSlide)];
    const bi = Number(el.dataset.tplBeatFocus);
    if (slide?.beats?.[bi]) {
      slide.beats[bi].focus = el.value;
      if (w.video) w.videoDirty = true;
      changed(w);
      TemplateStudio.refreshLivePreview(w, data);
    }
    return;
  }
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
  if (isSvgVideo(w) && el.dataset.svgBeat !== undefined && el.dataset.svgField === "action") {
    updateSvgBeat(w, el);
    return;
  }
  if (el.dataset.svgAction !== undefined && isSvgVideo(w)) {
    const block = w.blocks[Number(el.dataset.svgAction)];
    if (!block || !Object.hasOwn(config.svgMotion.actions, el.value)) return;
    block.action = el.value;
    if (w.video) w.videoDirty = true;
    changed(w);
    render(true);
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
  if (["music", "voice", "avatarMode", "avatarResolution"].includes(k) && s === w?.settings && w.video && (s[k] ?? defaults[k]) !== el.value) {
    w.videoDirty = true;
  }
  const val = el.type === "checkbox" ? el.checked : el.value;
  applySettingMutation(s, k, val);
  if (s === data.settings && w && w.stage === "setup" && !w.blocks.length) {
    if (!((k === "ratio" || k === "resolution") && isSvgVideo(w)) &&
        !(k === "ratio" && (TemplateStudio.isTemplateVideo(w) || isCodeMotion(w)))) {
      applySettingMutation(w.settings, k, val);
      changed(w);
    }
  }
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
    if (StageStudio.handleAction(w, action, v)) return;
    if (w && isCodeMotion(w) && handleCodeMotionAction(w, action, v)) return;
    switch (action) {
      case "asset-library":
        navigate("library");
        break;
      case "library-pick-picture":
      case "library-pick-template-picture":
        useLibraryPicture(w, Number(v), action === "library-pick-template-picture");
        break;
      case "library-collect-picture":
      case "library-collect-template-picture":
        collectLibraryPicture(w, Number(v), action === "library-collect-template-picture");
        break;
      case "library-pick-motion": {
        if (!isSvgVideo(w)) break;
        const [shotIndex, beatIndex] = v.split(":").map(Number);
        const block = w.blocks[shotIndex];
        if (!block) break;
        StudioAssets.pick(["motion"], (item) => {
          if (beatIndex !== undefined) {
            updateSvgBeat(w, { value: item.action, dataset: { svgShot: shotIndex, svgBeat: beatIndex, svgField: "action" } });
            render(true);
          } else {
            block.action = item.action;
            editedLibraryChoice(w);
          }
        });
        break;
      }
      case "library-pick-music": {
        const target = (dialog.open && modalScope && modalScope !== "global")
          ? data.works.find((work) => work.id === modalScope) : w;
        if (target?.type !== "video") break;
        StudioAssets.pick(["music"], (item) => {
          target.settings.music = item.choice || item.id;
          editedLibraryChoice(target);
          notify(`已选用「${item.name}」`, "ok");
        });
        break;
      }
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
      case "example-filter":
        exampleFilter = v;
        home();
        break;
      case "filter":
        filter = v;
        home();
        break;
      case "pick-video-topic":
        if (w) {
          w.topic = v;
          if (TemplateStudio.isTemplateVideo(w)) {
            const matched = TemplateVideo.EXAMPLES.find((ex) => ex.topic === v);
            if (matched) {
              if (!w.blocks.length) {
                w.templateTheme = matched.theme;
                w.templatePresenter = matched.presenter;
              }
              w.drug = matched.drug || "";
            }
          }
          changed(w);
          render(true);
        }
        break;
      case "new":
        newWork(v);
        break;
      case "sample":
        newWork("video", Number(v), "storyboard");
        break;
      case "svg-sample":
        newWork("video", 3, "svg");
        break;
      case "tpl-sample":
        newWork("video", null, "template", Number(v));
        break;
      case "tpl-video-mode":
        if (w && w.type === "video") {
          if (v === "template" && isCodeMotion(w)) break;
          if (w.blocks.length && w.videoMode !== v &&
              (["svg", "code-motion"].includes(v) || isSvgVideo(w) || isCodeMotion(w))) break;
          w.videoMode = v;
          if (v === "svg" || v === "code-motion") {
            w.settings.ratio = "16:9";
            w.settings.resolution = "720p";
          }
          if (v === "template") {
            w.settings.ratio = "16:9";
            w.templateTheme ||= "medical";
            w.templatePresenter ||= "digital";
          }
          changed(w);
          render(true);
        }
        break;
      case "tpl-content-mode":
        if (w && TemplateStudio.setRightContent(w, v)) {
          changed(w);
          render(true);
          app.querySelector('[data-action="tpl-content-mode"][aria-pressed="true"]')?.focus({ preventScroll: true });
        }
        break;
      case "tpl-theme":
        if (w) {
          w.templateTheme = v;
          if (w.templateDeck) {
            w.templateDeck.theme = v;
            if (w.video) w.videoDirty = true;
          } else if ((isSvgVideo(w) || isCodeMotion(w)) && w.video) {
            w.videoDirty = true;
          }
          changed(w);
          render(true);
        }
        break;
      case "tpl-presenter":
        if (w) {
          if (isCodeMotion(w) && !w.templatePresenter) w.settings.avatarMode = "static";
          w.templatePresenter = v;
          if (w.templateDeck) {
            w.templateDeck.presenter = v;
            if (w.video) w.videoDirty = true;
          } else if ((isSvgVideo(w) || isCodeMotion(w)) && w.video) {
            w.videoDirty = true;
          }
          changed(w);
          render(true);
        }
        break;
      case "tpl-slide":
        if (w) {
          const fromRail = el.classList.contains("scene-choice");
          TemplateStudio.setSlideIndex(w, Number(v));
          render(true);
          if (fromRail) {
            app.querySelector('.scene-choice[aria-pressed="true"]')?.focus({ preventScroll: true });
          }
        }
        break;
      case "tpl-slide-add":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.addSlide(w, data, changed, render, notify);
        }
        break;
      case "tpl-slide-move":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          const [rawIdx, rawDir] = v.split(":").map(Number);
          TemplateStudio.moveSlide(w, rawIdx, rawDir, data, changed, render);
        }
        break;
      case "tpl-slide-remove":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.removeSlide(w, Number(v), data, changed, render, notify);
        }
        break;
      case "tpl-reimage":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.openImageDialog(w, Number(v), templateHooks(), "main");
        }
        break;
      case "tpl-reimage-outro":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.openImageDialog(w, Number(v), templateHooks(), "outro");
        }
        break;
      case "tpl-regen-ark":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          const [idxStr, rawSlot] = String(v).split(":");
          const slideIdx = Number(idxStr);
          const slotKind = rawSlot === "outro" ? "outro" : "main";
          const promptVal = ($("#tpl-image-prompt", dialogBody)?.value || "").trim();
          const settings = {
            ...w.settings,
            mode: "ark",
            ratio: "16:9",
            imageModel: $("#tpl-picture-model", dialogBody)?.value || w.settings.imageModel,
            imageSize: $("#tpl-picture-size", dialogBody)?.value || w.settings.imageSize,
          };
          if (!config.keyPresent) {
            openApiKeys("ark");
            return;
          }
          dialog.close();
          await TemplateStudio.startSlideImageJob(w, slideIdx, promptVal, settings, templateHooks(), slotKind);
        }
        break;
      case "tpl-clear-image":
        if (w && TemplateStudio.isTemplateVideo(w) && w.templateDeck) {
          const slideIdx = Number(v);
          const slide = w.templateDeck.slides[slideIdx];
          if (slide && !slide.job) {
            const isHookCover = slide.type === "cover" && slide.layoutMode === "hook";
            slide.contentImage = "";
            slide.imageSource = "";
            slide.imageModel = "";
            slide.imageSize = "";
            TemplateStudio.syncBlocksFromDeck(w);
            if (w.video) w.videoDirty = true;
            changed(w);
            render(true);
            notify(isHookCover ? "已切回开场模版卡" : "已切回文字排版卡", "ok");
          }
        }
        break;
      case "tpl-clear-outro-image":
        if (w && TemplateStudio.isTemplateVideo(w) && w.templateDeck) {
          const slideIdx = Number(v);
          const slide = w.templateDeck.slides[slideIdx];
          if (slide && !slide.outroJob) {
            slide.outroImage = "";
            slide.outroImageSource = "";
            slide.outroImageModel = "";
            slide.outroImageSize = "";
            if (w.video) w.videoDirty = true;
            changed(w);
            render(true);
            notify("已切回结尾模版卡", "ok");
          }
        }
        break;
      case "tpl-fill-images":
        if (w && TemplateStudio.isTemplateVideo(w) && w.templateDeck) {
          const missing = TemplateStudio.collectBatchImageTargets(w.templateDeck, "missing");
          TemplateStudio.queueBatchSlideImages(w, missing, templateHooks());
        }
        break;
      case "tpl-restyle-images":
        if (w && TemplateStudio.isTemplateVideo(w) && w.templateDeck) {
          const targets = TemplateStudio.collectBatchImageTargets(w.templateDeck, "all");
          TemplateStudio.queueBatchSlideImages(w, targets, templateHooks());
        }
        break;
      case "tpl-retry-image":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.retrySlideImage(w, Number(v), templateHooks(), "main");
        }
        break;
      case "tpl-abort-image":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.abortSlideImage(w, Number(v), templateHooks(), "main");
        }
        break;
      case "tpl-retry-outro-image":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.retrySlideImage(w, Number(v), templateHooks(), "outro");
        }
        break;
      case "tpl-abort-outro-image":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.abortSlideImage(w, Number(v), templateHooks(), "outro");
        }
        break;
      case "tpl-cue":
        if (w) {
          TemplateStudio.setCueIndex(w, Number(v));
          TemplateStudio.refreshLivePreview(w, data);
        }
        break;
      case "tpl-inspector-tab":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          TemplateStudio.setInspectorTab(w, v);
          render(true);
        }
        break;
      case "sb-inspector-tab":
        if (w && w.type === "video") {
          storyboardTabs.set(w, v === "global" ? "global" : "shot");
          render(true);
        }
        break;
      case "tpl-reset-avatar": {
        const p = TemplateStudio.ensurePharmacist(data);
        p.avatarImage = "";
        if (w?.templateDeck) {
          w.templateDeck.pharmacist.avatarImage = "";
          if (w.video) w.videoDirty = true;
        } else if ((isSvgVideo(w) || isCodeMotion(w)) && w.video) {
          w.videoDirty = true;
        }
        if (w) changed(w);
        else save();
        render(true);
        break;
      }
      case "tpl-avatar-mode":
        if (w && (TemplateStudio.isTemplateVideo(w) || isCodeMotion(w))) {
          const nextMode = resolveAvatarMode(v);
          const currentMode = isCodeMotion(w) ? codeMotionAvatarMode(w) : resolveAvatarMode(w.settings.avatarMode ?? defaults.avatarMode);
          if (currentMode !== nextMode) {
            w.templatePresenter ||= "digital";
            w.settings.avatarMode = nextMode;
            if (w.video) w.videoDirty = true;
            changed(w);
          }
          render(true);
        }
        break;
      case "tpl-compose":
        if (w && TemplateStudio.isTemplateVideo(w)) {
          if (TemplateStudio.usesCodeMotion(w)) {
            await composeTemplateMotion(w);
            break;
          }
          await TemplateStudio.composeTemplateVideo(w, data, {
            notify,
            render,
            videoMusicSettings,
            sendJob,
            openApiKeys,
            authorizeSpeechOnly,
            speechKeyPresent: config.speechKeyPresent,
            dashscopeKeyPresent: !!config.dashscopeKeyPresent,
            workCostsEnabled: !!config.workCosts,
          });
        }
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
      case "settings-tab":
        if (editingKeyKind && dialog.open && modalType === "settings") {
          editingKeyKind = null;
          settingsTab = v;
          const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
          prefs(scope);
        } else {
          showSettingsTab(v);
        }
        break;
      case "replace-key": {
        editingKeyKind = v;
        const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
        prefs(scope);
        $("#" + v + "-key", dialogBody)?.focus();
        break;
      }
      case "cancel-replace-key": {
        editingKeyKind = null;
        const scope = modalScope === "global" ? null : data.works.find((x) => x.id === modalScope) || null;
        prefs(scope);
        break;
      }
      case "connect-deepseek":
        if (config) openApiKeys("deepseek");
        break;
      case "connect-ark":
        if (config) openApiKeys("ark");
        break;
      case "connect-speech":
      case "configure-speech":
        if (config) openApiKeys("speech");
        break;
      case "connect-dashscope":
        if (config) openApiKeys("dashscope");
        break;
      case "rename-bgm":
        if (v) await renameLibraryMusic(v);
        break;
      case "delete-bgm":
        if (v) await deleteLibraryMusic(v);
        break;
      case "set-video-music": {
        const target = (dialog.open && modalScope && modalScope !== "global")
          ? data.works.find((x) => x.id === modalScope)
          : w;
        const validChoice = Object.prototype.hasOwnProperty.call(musicLabels, v) || Boolean(findLibraryTrack(v));
        if (target && validChoice) {
          if ((target.settings.music ?? defaults.music) !== v) {
            target.settings.music = v;
            if (target.video) target.videoDirty = true;
            changed(target);
          }
          if (dialog.open && modalType === "settings" && modalScope === target.id) prefs(target);
          render(true);
        }
        break;
      }
      case "work-settings":
        if (w) prefs(w);
        else prefs(null);
        break;
      case "work-costs": {
        const work = data.works.find((item) => item.id === v);
        if (work) await openWorkCosts(work);
        break;
      }
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
        else if (w.type === "video") w.stage = "script";
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
        const pool = TemplateStudio.isTemplateVideo(w)
          ? TemplateVideo.EXAMPLES.map((ex) => ex.topic)
          : w.type === "video"
            ? allVideoTopics
            : examples;
        const currentIdx = pool.indexOf(w.topic.trim());
        const nextIdx =
          currentIdx >= 0
            ? (currentIdx + 1) % pool.length
            : exampleCursor++ % pool.length;
        w.topic = pool[nextIdx];
        if (TemplateStudio.isTemplateVideo(w)) {
          const matched = TemplateVideo.EXAMPLES.find((ex) => ex.topic === w.topic);
          if (matched) {
            if (!w.blocks.length) {
              w.templateTheme = matched.theme;
              w.templatePresenter = matched.presenter;
            }
            w.drug = matched.drug || "";
          }
        }
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
      case "svg-play":
        if (isSvgVideo(w) && w.blocks[Number(v)]) svgPreview(w, w.blocks[Number(v)], el);
        break;
      case "svg-speech":
        if (isSvgVideo(w) && w.blocks[Number(v)]) prepareSvgSpeech(w, Number(v), el);
        break;
      case "code-motion-compose":
        if (isCodeMotion(w)) await composeCodeMotion(w);
        break;
      case "compose": {
        if (!w.title.trim()) {
          notify("请先填写作品标题", "warn");
          return;
        }
        if (isSvgVideo(w)) {
          await composeSvgVideo(w);
          break;
        }
        if (w.blocks.some((b) => !b.line.trim())) {
          notify("请补全每一幕的口播台词", "warn");
          return;
        }
        if (w.blocks.some((b) => !b.image)) {
          notify("还有分镜缺少配图，请先为该幕配图", "warn");
          return;
        }
        const rejected = rejectedPortraitFrames.get(w);
        const index = rejected ? w.blocks.findIndex((block) => rejected.has(block.image)) : -1;
        if (index >= 0) {
          notify(`第 ${index + 1} 幕的首帧已被方舟拒绝，请换图后再合成。`, "warn");
          selectScene(w, index);
          return;
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
            { ...w.settings, ...videoMusicSettings(w) },
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
          ...(isSvgVideo(w) ? { action: "consult" } : {}),
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
      case "regen": {
        const i = Number(v),
          prompt = sceneDescription(w, $("#imageprompt", dialogBody)?.value || "");
        const reference = regenModal?.reference || "";
        const settings = {
          ...w.settings,
          mode: "ark",
          imageModel:
            $("#picture-model", dialogBody)?.value || w.settings.imageModel,
          imageSize:
            $("#picture-size", dialogBody)?.value || w.settings.imageSize,
        };
        if (!config.keyPresent) {
          openApiKeys("ark");
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
        if (j.target === "compose" && j.payload.settings.music === "auto" && config.videoAutoMusicGeneration) {
          notify("本地服务仍在运行旧版自动配乐。请重启工作台后继续此任务。", "warn");
          break;
        }
        if (j.target === "write-draft") {
          if (j.stageDraft === "produce" || j.stageDraft === "replan") {
            const detail = j.stageDraft === "produce" ? `继续制作第 ${j.stageShotIndex + 1} 幕画面。` : "继续编排分镜画面。";
            authorize({ ...w, settings:j.payload.settings }, 1, "draft", () => sendJob(w), 1, {detail});
            break;
          }
          if (j.payload.draft?.presentation === "mg") {
            authorize({ ...w, settings:j.payload.settings }, 2, "draft", () => sendJob(w), 2,
              {detail:"继续编排 MG 分镜。已生成的脚本会复用。"});
            break;
          }
          authorize(w, w.type === "article" && !j.partial ? 2 : 1, "draft", () => sendJob(w));
          break;
        }
        if (j.stageImageSlots) {
          authorize({ ...w, settings:j.payload.settings }, j.payload.items.length, "images", () => sendJob(w, owner));
          break;
        }
        if (j.payload.codeMotion) {
          authorizeCodeMotion({ ...w, settings: j.payload.settings }, j.payload.items.length,
            () => sendJob(w, owner), j.payload.avatar, Boolean(j.payload.previousVideo));
          break;
        }
        if (j.payload.template) {
          const work = { ...w, settings: j.payload.settings };
          if (work.settings.voice === "无配音") await sendJob(w, owner);
          else authorizeSpeechOnly(work, j.payload.items.length, () => sendJob(w, owner), {
            reuseSpeech: Boolean(j.payload.previousVideo), usesAvatar: Boolean(j.payload.avatar?.enabled),
            avatarModel: j.payload.avatar?.model, avatarResolution: j.payload.avatar?.resolution,
          });
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
        if (owner.job?.target === "write-draft" && !["produce","replan"].includes(owner.job.stageDraft)) w.viewingSetup = true;
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
  if (modalType === "settings") dialogBody.replaceChildren();
  editingKeyKind = null;
  retryPayload = null;
  regenModal = null;
  TemplateStudio.clearImageModal();
  modalType = null;
  updateTopbar();
});

document.addEventListener("dragover", (e) => {
  const zone = e.target.closest?.("[data-tpl-dropzone]");
  if (!zone) return;
  e.preventDefault();
  zone.classList.add("tpl-drop-active");
});

document.addEventListener("dragleave", (e) => {
  const zone = e.target.closest?.("[data-tpl-dropzone]");
  if (!zone || zone.contains(e.relatedTarget)) return;
  zone.classList.remove("tpl-drop-active");
});

document.addEventListener("drop", (e) => {
  const zone = e.target.closest?.("[data-tpl-dropzone]");
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove("tpl-drop-active");
  const w = current();
  const file = e.dataTransfer?.files?.[0];
  if (file && w && TemplateStudio.isTemplateVideo(w)) {
    const slideIdx = Number(zone.dataset.tplDropzone);
    const uploadKind = zone.dataset.tplDropSlot === "outro" ? "slide-outro-image" : "slide-image";
    TemplateStudio.handleFileUpload(file, uploadKind, w, data, changed, render, notify, slideIdx)
      .catch((err) => notify(err.message || "上传图片失败", "warn"));
  }
});

window.addEventListener("hashchange", () => render(false));

(async () => {
  try {
    [config, autoMusicRules] = await Promise.all([
      jsonRequest("/api/config"),
      jsonRequest("/assets/music/auto-music.json").catch(() => []),
    ]);
    data.settings.textModel = resolveTextModel(data.settings);
    for (const w of data.works) {
      if (w.settings) w.settings.textModel = resolveTextModel(w.settings);
    }
    render();
  } catch {
    app.innerHTML =
      '<div class="empty"><h2>无法连接本地工作台</h2><p>请双击项目目录中的「启动工作台.cmd」启动本地服务后刷新页面。</p></div>';
  }
})();
