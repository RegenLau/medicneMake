import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, "docs/验收截图/H4"));
const MATRIX_DIR = path.join(OUT_DIR, "matrix");
const TIMELINE_DIR = path.join(OUT_DIR, "timeline");
const MP4_DIR = path.join(OUT_DIR, "mp4");
for (const d of [OUT_DIR, MATRIX_DIR, TIMELINE_DIR, MP4_DIR]) fs.mkdirSync(d, { recursive: true });

const NEW_LAYOUTS = ["chapter-nav", "broadcast", "takeaway", "qa-chat", "headline"];
const THEMES = ["medical", "warm", "mint", "night", "illus", "photo"];
const STATES = [
  { id: "first", label: "第一幕", t: 1.8 },
  { id: "middle", label: "中间幕", t: 7.2 },
  { id: "outro", label: "片尾", t: 13.2 },
];

const MP4_SPECS = [
  { layout: "chapter-nav", theme: "medical" },
  { layout: "broadcast", theme: "photo" },
  { layout: "takeaway", theme: "mint" },
  { layout: "qa-chat", theme: "illus" },
  { layout: "headline", theme: "night" },
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function fileDataUrl(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

function loadThemeDeck(themeId) {
  const def = readJson(`public/assets/library/themes/${themeId}.json`);
  const catalog = readJson("public/assets/library/catalog.json");
  const out = {
    theme: def.base === "warm" ? "warm" : "medical",
    themeId: `builtin:theme/${themeId}`,
    themeVars: def.vars,
    themeGlass: Boolean(def.glass),
    ...(def.fadeColor ? { themeFadeColor: def.fadeColor } : {}),
  };
  if (def.background?.assetId) {
    const entry = catalog.find((x) => x.id === def.background.assetId);
    if (!entry) throw new Error(`Missing background asset ${def.background.assetId}`);
    out.themeBackground = fileDataUrl(path.join(ROOT, "public/assets/library", entry.file));
  }
  return out;
}

const DIGITAL_AVATAR = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-digital.jpg"));
const CARTOON_AVATAR = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-cartoon.jpg"));

function buildThreeShotPlan(layoutId, themeId) {
  const layout = readJson(`public/assets/library/layouts/${layoutId}.json`);
  const themeDeck = loadThemeDeck(themeId);
  const presenter = themeDeck.theme === "warm" ? "cartoon" : "digital";
  const sub22 = "间隔还不到一半时想起来就按常规剂量补服一次哦"; // exact 22 chars

  const pts0 = [
    { title: "确认漏服发生的时间点", detail: "先看每天固定服药时刻" },
    { title: "计算距离下次服药时长", detail: "以服药间隔的一半为界" },
  ];
  const pts1 = [
    { title: "用前洗手，瓶口别碰到眼睛", detail: "混悬液使用前轻轻摇匀" },
    { title: "滴进下眼睑，不要直接滴眼球", detail: "头稍后仰拉开下眼睑小袋" },
    { title: "闭眼轻按内眼角一两分钟", detail: "减少药液经鼻泪管流失" },
    { title: "两种眼药间隔五分钟以上", detail: "避免后滴药液冲走前药" },
  ];
  const pts2 = [
    { title: "没过半就按常规量补一次", detail: "次日照常在原时间吃药" },
    { title: "已过半就跳过不要加倍", detail: "避免血药浓度骤升风险" },
    { title: "经常漏服及时咨询药师", detail: "请医生或药师调整方案" },
  ];

  const slides = [
    {
      name: "先判断漏服时间", headline: "漏服降压药，先看时间", accentPhrase: "先看时间",
      lead: "每天定时服药一次时，先看离下次服药还有多久。", line: sub22,
      type: "explain", layoutMode: "explain", chapterIndex: 0,
      question: "降压药忘吃了怎么判断要不要补？", answer: "按间隔是否过半判断", verdictTone: "ok",
      takeaway: "先看离下次服药是否过半", highlightWords: ["常规剂量", "补服一次"],
      points: pts0.map(({ title, detail }) => ({ title, desc: detail })),
    },
    {
      name: "补还是不补", headline: "漏服了，也只吃一次", accentPhrase: "也只吃一次",
      lead: "不论补服还是到点服药，每次都只吃平时的常规剂量。", line: sub22,
      type: "steps", layoutMode: "explain", chapterIndex: 1,
      question: "昨天忘吃降压药，今天吃两片补回来，行吗？", answer: "不行，只吃常规剂量", verdictTone: "no",
      takeaway: "一次只吃常规量，漏服绝不加倍", highlightWords: ["常规剂量", "补服一次"],
      points: pts1.map(({ title, detail }) => ({ title, desc: detail })),
      steps: pts1.slice(0, 3).map(({ title, detail }) => ({ title, desc: detail })),
    },
    {
      name: "用药安全收口", headline: "记住三句话，安全服药", accentPhrase: "安全服药",
      lead: "规律服药最重要，拿不准就带着药盒问药师。", line: sub22,
      type: "summary", layoutMode: "explain", chapterIndex: 2,
      question: "经常忘记吃药该怎么办？", answer: "设闹钟并请药师评估", verdictTone: "warn",
      takeaway: "不加倍、定时吃、有疑问问药师", highlightWords: ["常规剂量", "补服一次"],
      points: pts2.map(({ title, detail }) => ({ title, desc: detail })),
    },
  ];
  const shots = [
    {
      ...slides[0], kind: "scene", visual: "mechanism", motion: "reveal", motif: "clock", tone: "primary",
      items: pts0, start: 0, end: 5,
      captions: [{ start: 0, end: 5, text: sub22, focus: "0", highlightWords: ["常规剂量"] }],
    },
    {
      ...slides[1], kind: "scene", visual: "steps", motion: "flow", motif: "checklist", tone: "primary",
      items: pts1, start: 5, end: 10,
      captions: [{ start: 5, end: 10, text: sub22, focus: "1", highlightWords: ["补服一次"] }],
    },
    {
      ...slides[2], kind: "card", motionStyle: "flow",
      items: pts2, start: 10, end: 15,
      captions: [{ start: 10, end: 15, text: sub22, focus: "outro", highlightWords: ["常规剂量"] }],
    },
  ];
  return {
    layout,
    deck: {
      title: "降压药忘吃了，要不要补？",
      shortTitle: "缓释片为什么不能掰开吃？",
      drug: "硝苯地平缓释片",
      drugTags: ["缓释片", "处方药"],
      ...themeDeck,
      presenter,
      pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
      disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
      chapters: ["先判断时间", "补还是不补", "记住安全法则"],
      slides,
    },
    shots,
    images: {
      "/assets/template-doctor-digital.jpg": DIGITAL_AVATAR,
      "/assets/template-doctor-cartoon.jpg": CARTOON_AVATAR,
    },
  };
}

function buildTimelinePlan(layoutId, nodeCount) {
  const layout = readJson(`public/assets/library/layouts/${layoutId}.json`);
  const themeDeck = loadThemeDeck("medical");
  const allItems = [
    { title: "该吃药", detail: "按医嘱早上八点服药", tag: "08:00" },
    { title: "间隔一半", detail: "超过一半不再补服", tag: "20:00" },
    { title: "次日照常", detail: "恢复常规剂量服用", tag: "次日 08:00" },
    { title: "记录观察", detail: "测血压并记录情况", tag: "复诊核对" },
  ];
  const items = allItems.slice(0, nodeCount);
  const slide = {
    name: "漏服时间决策", headline: "离下次服药还有多久？", accentPhrase: "还有多久",
    lead: "以每天一次服药为例，用间隔一半判断。", line: "按漏服时间节点判断是否补服。",
    type: "timeline", layoutMode: "explain", chapterIndex: 0,
    question: "忘吃降压药按什么时间判断补不补？", answer: "未过间隔一半可补服", verdictTone: "ok",
    takeaway: "不到一半就补，过半则跳过",
    points: items.map(({ title, detail }) => ({ title, desc: detail })),
  };
  return {
    layout,
    deck: {
      title: "降压药忘吃了，要不要补？", shortTitle: "漏服时间决策",
      drug: "硝苯地平缓释片", drugTags: ["缓释片", "处方药"],
      ...themeDeck, presenter: "digital",
      pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
      disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
      chapters: ["判断时间", "收口提醒"],
      slides: [slide],
    },
    shots: [{
      ...slide, kind: "scene", visual: "timeline", motion: "flow", motif: "clock", tone: "warm",
      items, start: 0, end: 6,
      captions: [{ start: 0, end: 6, text: "按漏服时间节点判断是否补服", focus: "all" }],
    }],
    images: { "/assets/template-doctor-digital.jpg": DIGITAL_AVATAR },
  };
}

async function measureAlignment(page, layoutId) {
  return page.evaluate((id) => {
    const frame = document.querySelector(".pt-frame");
    const fr = frame.getBoundingClientRect();
    const rel = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - fr.left, top: r.top - fr.top,
        right: r.right - fr.left, bottom: r.bottom - fr.top,
        width: r.width, height: r.height,
        cx: (r.left + r.right) / 2 - fr.left, cy: (r.top + r.bottom) / 2 - fr.top,
      };
    };
    const checks = [];
    const add = (name, actual, expected) => {
      checks.push({ name, actual: Number(actual.toFixed(3)), expected: Number(expected.toFixed(3)), diff: Number(Math.abs(actual - expected).toFixed(3)) });
    };

    const regionEls = [...frame.querySelectorAll(
      ".pt-nav-panel, .pt-header-breadcrumb, .pt-header-ticker, .pt-header-namecard, .pt-header-question, .pt-presenter-avatar, .pt-answer-bubble, .pt-media-slot, .pt-keypoints, .pt-headline-poster, .pt-disclaimer-inline-right, .pt-region-progress, .pt-footer",
    )];
    const overflows = [];
    for (const el of regionEls) {
      const r = rel(el);
      if (r.left < -1 || r.top < -1 || r.right > 1281 || r.bottom > 721) {
        overflows.push({ cls: el.className, issue: "out-of-canvas", rect: r });
      }
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        overflows.push({ cls: el.className, issue: "region-overflow", sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
      }
    }
    const textEls = [...frame.querySelectorAll(
      ".pt-nav-topic, .pt-nav-meta, .pt-nav-chap-label, .pt-crumb, .pt-clock, .pt-ticker-title, .pt-ticker-drug, .pt-nc-title, .pt-kp-item span, .pt-kp-quote, .pt-ask-text, .pt-answer-meta, .pt-answer-verdict, .pt-disclaimer-inline-right, .pt-poster-kicker, .pt-poster-h3, .pt-poster-lead, .pt-sub-tab-name, .pt-subtitle",
    )];
    for (const el of textEls) {
      const st = getComputedStyle(el);
      if (st.overflow === "hidden" && st.textOverflow === "ellipsis") {
        if (el.scrollHeight > el.clientHeight + 1) {
          overflows.push({ cls: el.className, issue: "text-height-overflow", sh: el.scrollHeight, ch: el.clientHeight });
        }
      } else if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        overflows.push({ cls: el.className, issue: "text-overflow", sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
      }
    }

    const subEl = frame.querySelector(".pt-subtitle");
    let subtitleSingleLine = true;
    if (subEl) {
      const range = document.createRange();
      range.selectNodeContents(subEl);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const lines = new Set(rects.map((r) => Math.round(r.top / 10)));
      if (lines.size > 1 || subEl.scrollWidth > subEl.clientWidth + 1) {
        subtitleSingleLine = false;
        overflows.push({ cls: "pt-subtitle", issue: "subtitle-multiline-or-clipped", lines: lines.size, sw: subEl.scrollWidth, cw: subEl.clientWidth });
      }
    }

    if (id === "chapter-nav") {
      const rail = rel(frame.querySelector(".pt-nav-panel"));
      const media = rel(frame.querySelector(".pt-media-slot"));
      const sub = rel(frame.querySelector(".pt-footer"));
      const clock = rel(frame.querySelector(".pt-clock"));
      const activeLabel = rel(frame.querySelector(".pt-nav-chap.on .pt-nav-chap-label"));
      const activeBar = rel(frame.querySelector(".pt-nav-chap.on .pt-nav-chap-bar"));
      add("rail.top == 24", rail.top, 24);
      add("rail.bottom == 696", rail.bottom, 696);
      add("media.left == 312", media.left, 312);
      add("subtitle.left == media.left", sub.left, media.left);
      add("media.right == 1256", media.right, 1256);
      add("subtitle.right == media.right", sub.right, media.right);
      add("clock.right == media.right", clock.right, media.right);
      add("chapBar.left == chapLabel.left", activeBar.left, activeLabel.left);
    } else if (id === "broadcast") {
      const ticker = rel(frame.querySelector(".pt-header-ticker"));
      const media = rel(frame.querySelector(".pt-media-slot"));
      const prog = rel(frame.querySelector(".pt-region-progress"));
      const avatar = rel(frame.querySelector(".pt-presenter-avatar"));
      const nameTab = rel(frame.querySelector(".pt-sub-tab-name"));
      const band = rel(frame.querySelector(".pt-sub-tab-body"));
      add("ticker.left == 0", ticker.left, 0);
      add("ticker.right == 1280", ticker.right, 1280);
      add("media.left == 0", media.left, 0);
      add("media.right == 1280", media.right, 1280);
      add("prog.left == 0", prog.left, 0);
      add("prog.right == 1280", prog.right, 1280);
      add("ticker.bottom == 56", ticker.bottom, 56);
      add("media.top == ticker.bottom", media.top, ticker.bottom);
      add("media.bottom == 560", media.bottom, 560);
      add("prog.top == media.bottom", prog.top, media.bottom);
      add("avatar.top == nameTab.top (586)", avatar.top, nameTab.top);
      add("avatar.top == 586", avatar.top, 586);
      add("avatar.bottom == band.bottom (702)", avatar.bottom, band.bottom);
      add("avatar.bottom == 702", avatar.bottom, 702);
      add("nameTab.left == band.left (176)", nameTab.left, band.left);
      add("nameTab.left == 176", nameTab.left, 176);
    } else if (id === "takeaway") {
      const top = rel(frame.querySelector(".pt-header-namecard"));
      const media = rel(frame.querySelector(".pt-media-slot"));
      const kp = rel(frame.querySelector(".pt-keypoints"));
      add("namecard.left == media.left (32)", top.left, media.left);
      add("namecard.left == 32", top.left, 32);
      add("namecard.right == keypoints.right (1248)", top.right, kp.right);
      add("namecard.right == 1248", top.right, 1248);
      add("media.top == keypoints.top (124)", media.top, kp.top);
      add("media.top == 124", media.top, 124);
      add("media.bottom == keypoints.bottom (584)", media.bottom, kp.bottom);
      add("media.bottom == 584", media.bottom, 584);
    } else if (id === "qa-chat") {
      const qCircle = rel(frame.querySelector(".pt-ask-q"));
      const qBubble = rel(frame.querySelector(".pt-ask-bubble"));
      const avatar = rel(frame.querySelector(".pt-presenter-avatar"));
      const answer = rel(frame.querySelector(".pt-answer-bubble"));
      const ahead = rel(frame.querySelector(".pt-answer-head"));
      const media = rel(frame.querySelector(".pt-media-slot"));
      add("askQ.cy == askBubble.cy", qCircle.cy, qBubble.cy);
      add("avatar.left == askQ.left (40)", avatar.left, qCircle.left);
      add("avatar.left == 40", avatar.left, 40);
      add("answer.left == media.left (120)", answer.left, media.left);
      add("answer.right == media.right (1240)", answer.right, media.right);
      add("answerHead.bottom == media.top (196)", ahead.bottom, media.top);
      add("media.top == 196", media.top, 196);
      add("answer.right == askBubble.right (1240)", answer.right, qBubble.right);
      add("answer.right == 1240", answer.right, 1240);
    } else if (id === "headline") {
      const poster = rel(frame.querySelector(".pt-headline-poster"));
      const kicker = rel(frame.querySelector(".pt-poster-kicker"));
      const h3 = rel(frame.querySelector(".pt-poster-h3"));
      const head = rel(frame.querySelector(".pt-poster-head"));
      const who = rel(frame.querySelector(".pt-poster-who"));
      const media = rel(frame.querySelector(".pt-media-slot"));
      const sub = rel(frame.querySelector(".pt-footer"));
      add("poster.top == media.top (56)", poster.top, media.top);
      add("poster.top == 56", poster.top, 56);
      add("poster.bottom == media.bottom (566)", poster.bottom, media.bottom);
      add("poster.bottom == 566", poster.bottom, 566);
      add("kicker.left == 64", kicker.left, 64);
      add("h3.left == 64", h3.left, 64);
      add("who.left == 64", who.left, 64);
      add("subtitle.left == 64", sub.left, 64);
      add("media.right == subtitle.right (1216)", media.right, sub.right);
      add("media.right == 1216", media.right, 1216);
      add("head vertical centering (topGap == bottomGap)", head.top - poster.top, poster.bottom - head.bottom);
    }
    return { checks, overflows, subtitleSingleLine };
  }, layoutId);
}

async function measureTimeline(page) {
  return page.evaluate(() => {
    const slot = document.querySelector(".pt-media-slot");
    const mediaW = Math.round(slot.getBoundingClientRect().width);
    const pills = [...document.querySelectorAll("[data-cm-pill]")];
    const nodes = [...document.querySelectorAll("[data-cm-node]")];
    const cards = [...document.querySelectorAll(".cm-time-card")];
    const axis = document.querySelector("[data-cm-axis-line]");
    const cx = (el) => {
      const r = el.getBoundingClientRect();
      return (r.left + r.right) / 2;
    };
    const axisRect = axis.getBoundingClientRect();
    let maxPillDiff = 0;
    let maxCardDiff = 0;
    const perNode = nodes.map((node, i) => {
      const ncx = cx(node);
      const pcx = cx(pills[i]);
      const ccx = cx(cards[i]);
      const pd = Math.abs(ncx - pcx);
      const cd = Math.abs(ncx - ccx);
      maxPillDiff = Math.max(maxPillDiff, pd);
      maxCardDiff = Math.max(maxCardDiff, cd);
      return { i, dotCx: Number(ncx.toFixed(3)), pillDiff: Number(pd.toFixed(3)), cardDiff: Number(cd.toFixed(3)) };
    });
    const startDiff = Math.abs(axisRect.left - cx(nodes[0]));
    const endDiff = Math.abs(axisRect.right - cx(nodes[nodes.length - 1]));
    const slotOverflow = slot.scrollWidth > slot.clientWidth + 1 || slot.scrollHeight > slot.clientHeight + 1;
    return {
      mediaW,
      nodeCount: nodes.length,
      maxPillDiff: Number(maxPillDiff.toFixed(3)),
      maxCardDiff: Number(maxCardDiff.toFixed(3)),
      axisStartDiff: Number(startDiff.toFixed(3)),
      axisEndDiff: Number(endDiff.toFixed(3)),
      maxDiff: Number(Math.max(maxPillDiff, maxCardDiff, startDiff, endDiff).toFixed(3)),
      slotOverflow,
      perNode,
    };
  });
}

async function meanRgbDiff(page, pathA, pathB) {
  const aUrl = fileDataUrl(pathA);
  const bUrl = fileDataUrl(pathB);
  return page.evaluate(async ([uA, uB]) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [ia, ib] = await Promise.all([load(uA), load(uB)]);
    const w = ia.naturalWidth, h = ia.naturalHeight;
    const ca = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const cb = Object.assign(document.createElement("canvas"), { width: w, height: h });
    ca.getContext("2d").drawImage(ia, 0, 0);
    cb.getContext("2d").drawImage(ib, 0, 0);
    const da = ca.getContext("2d").getImageData(0, 0, w, h).data;
    const db = cb.getContext("2d").getImageData(0, 0, w, h).data;
    let sum = 0;
    const channels = w * h * 3;
    for (let i = 0; i < da.length; i += 4) {
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return Number((sum / channels).toFixed(4));
  }, [aUrl, bUrl]);
}

function synthesizeMp4(layoutId, themeId, tempDir) {
  const py = `
import json, pathlib, sys, time, uuid
sys.path.insert(0, ${JSON.stringify(ROOT)})
import server, asset_library

td = pathlib.Path(${JSON.stringify(tempDir)}) / ${JSON.stringify(`${layoutId}-${themeId}`)}
base = td / ".studio"
server.DATA = base
server.MEDIA = base / "media"
server.JOBS = base / "jobs"
server.AVATAR_CACHE = base / "avatar-cache"
server.GENERATED_MUSIC_DIR = base / "music"
server.ASSETS = asset_library.LocalLibrary(base / "library", server.PUBLIC / "assets" / "library")
for d in (server.DATA, server.MEDIA, server.JOBS, server.AVATAR_CACHE, server.GENERATED_MUSIC_DIR):
    d.mkdir(parents=True, exist_ok=True)

theme_def = json.loads((server.PUBLIC / "assets/library/themes" / (${JSON.stringify(themeId)} + ".json")).read_text("utf-8"))
pts = [
    {"title": "先判断离下次服药时长", "detail": "以间隔一半为判断线", "tag": "08:00"},
    {"title": "没过半按常规量补一次", "detail": "次日照常在原时间吃", "tag": "20:00"},
    {"title": "已过半跳过切勿加倍", "detail": "避免血药浓度骤升", "tag": "次日"},
]
p = {
    "id": str(uuid.uuid4()),
    "workId": str(uuid.uuid4()),
    "kind": "video",
    "mode": "ark",
    "stage": True,
    "layoutId": "builtin:layout/" + ${JSON.stringify(layoutId)},
    "title": "降压药忘吃了，要不要补？",
    "shortTitle": "降压药漏服怎么补？",
    "drug": "硝苯地平缓释片",
    "drugTags": ["缓释片", "处方药"],
    "disclaimer": "科普内容仅供参考，具体诊疗与用药请遵医嘱",
    "chapters": ["判断时间", "正确补服", "安全收口"],
    "appearance": {
        "theme": theme_def["base"],
        "themeId": "builtin:theme/" + ${JSON.stringify(themeId)},
        "presenter": "none",
        "pharmacist": {"name": "李明远", "role": "主任药师", "hospital": "北京协和医院"},
    },
    "settings": {"ratio": "16:9", "voice": "无配音", "music": "off"},
    "audio": {"sfx": {"pack": "off", "gainDb": -14}},
    "items": [
        {
            "name": "先判断时间", "line": "降压药忘吃了，先看离下次服药还有多久。", "seconds": 3, "chapterIndex": 0,
            "points": {"type": "explain", "headline": "漏服降压药，先看时间", "accentPhrase": "先看时间",
                       "lead": "以每天一次为例先算间隔。", "question": "忘吃降压药怎么判断？",
                       "answer": "按间隔过半判断", "verdictTone": "ok", "takeaway": "先看间隔是否过半",
                       "items": pts[:2], "checks": ["看服药时间", "算间隔一半"]},
            "cues": [{"text": "降压药忘吃了先看离下次服药还有多久", "focus": "0", "weight": 18}],
            "content": {"kind": "card", "motionStyle": "flow"},
        },
        {
            "name": "补还是不补", "line": "间隔没过半想起来就补上，已经过半就跳过这一次。", "seconds": 3, "chapterIndex": 1,
            "points": {"type": "timeline", "headline": "漏服了，也只吃一次", "accentPhrase": "也只吃一次",
                       "lead": "不论补服还是到点吃都只吃常规量。", "question": "忘吃一次能补两片吗？",
                       "answer": "不行，只吃常规量", "verdictTone": "no", "takeaway": "绝不吃双倍剂量",
                       "items": pts, "checks": ["没过半补一次", "过半就跳过", "绝不加倍"]},
            "cues": [{"text": "间隔没过半想起来就补上已经过半就跳过", "focus": "1", "weight": 19}],
            "content": {"kind": "scene", "visual": "timeline", "motion": "flow", "motif": "clock", "tone": "primary"},
        },
        {
            "name": "安全收口", "line": "按时吃药不加倍，有疑问随时咨询药师。", "seconds": 3, "chapterIndex": 2,
            "points": {"type": "summary", "headline": "记住三句话，安全服药", "accentPhrase": "安全服药",
                       "lead": "规律服药最稳妥。", "question": "经常忘吃怎么办？",
                       "answer": "请药师调整方案", "verdictTone": "warn", "takeaway": "不加倍定时吃问药师",
                       "items": pts, "checks": ["按时服药", "切勿加倍", "常问药师"]},
            "cues": [{"text": "按时吃药不加倍有疑问随时咨询药师", "focus": "outro", "weight": 17}],
            "content": {"kind": "card", "motionStyle": "flow"},
        },
    ],
}
captured = {}
orig_write_json = server.write_json
def spy_write_json(path, data):
    if pathlib.Path(path).name == "stage.json":
        captured["plan"] = data
    return orig_write_json(path, data)
server.write_json = spy_write_json

t0 = time.monotonic()
job = {"id": p["id"], "progress": ""}
out = server.render_stage_video(p, job, lambda: None, "")
elapsed = round(time.monotonic() - t0, 2)
mp4_path = server.media_path(out["url"])
print(json.dumps({
    "mp4Path": str(mp4_path),
    "elapsed": elapsed,
    "assetVersions": out.get("assetVersions", []),
    "renderPlan": captured["plan"],
}))
`;
  const raw = execFileSync("python3", ["-B", "-c", py], { cwd: ROOT, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const lines = raw.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

function resolveFfmpegBin(name) {
  const py = `import imageio_ffmpeg, pathlib; p = pathlib.Path(imageio_ffmpeg.get_ffmpeg_exe()); print(p if ${JSON.stringify(name)} == "ffmpeg" else p.with_name(${JSON.stringify(name)}))`;
  try {
    const out = execFileSync("which", [name], { encoding: "utf8" }).trim();
    if (out) return out;
  } catch {}
  return execFileSync("python3", ["-c", py], { cwd: ROOT, encoding: "utf8" }).trim();
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-h4-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const stageUrl = pathToFileURL(path.join(ROOT, "public/stage.html")).href;

  const report = {
    matrixCombos: 0,
    matrixMaxDiffPx: 0,
    matrixOverflows: 0,
    matrixSubtitleFailures: 0,
    matrixByLayout: {},
    timelineResults: [],
    timelineMaxDiffPx: 0,
    mp4Results: [],
    pageErrors: [],
  };

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => report.pageErrors.push(`stage: ${e.message}`));
    await page.goto(stageUrl, { waitUntil: "networkidle" });

    // === Part A: 5 layouts x 6 themes x 3 states = 90 combinations ===
    for (const layoutId of NEW_LAYOUTS) {
      report.matrixByLayout[layoutId] = { combos: 0, maxDiffPx: 0, overflows: 0, rules: {} };
      for (const themeId of THEMES) {
        const plan = buildThreeShotPlan(layoutId, themeId);
        await page.evaluate(async (p) => { await window.setPlan(p); }, plan);
        for (const st of STATES) {
          await page.evaluate(async (time) => {
            await window.drawFrame(time);
            await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
          }, st.t);
          const meas = await measureAlignment(page, layoutId);
          report.matrixCombos += 1;
          report.matrixByLayout[layoutId].combos += 1;

          for (const c of meas.checks) {
            report.matrixMaxDiffPx = Math.max(report.matrixMaxDiffPx, c.diff);
            report.matrixByLayout[layoutId].maxDiffPx = Math.max(report.matrixByLayout[layoutId].maxDiffPx, c.diff);
            const prev = report.matrixByLayout[layoutId].rules[c.name] ?? 0;
            report.matrixByLayout[layoutId].rules[c.name] = Math.max(prev, c.diff);
            if (c.diff > 1) {
              throw new Error(`Matrix alignment fail [${layoutId}/${themeId}/${st.id}] ${c.name}: actual=${c.actual} expected=${c.expected} diff=${c.diff}`);
            }
          }
          if (meas.overflows.length) {
            report.matrixOverflows += meas.overflows.length;
            report.matrixByLayout[layoutId].overflows += meas.overflows.length;
            throw new Error(`Matrix overflow [${layoutId}/${themeId}/${st.id}]: ${JSON.stringify(meas.overflows)}`);
          }
          if (!meas.subtitleSingleLine) {
            report.matrixSubtitleFailures += 1;
            throw new Error(`Subtitle multiline [${layoutId}/${themeId}/${st.id}]`);
          }
          await page.screenshot({ path: path.join(MATRIX_DIR, `${layoutId}-${themeId}-${st.id}.png`) });
        }
      }
    }

    // === Part B: Section 3.3 Timeline alignment (2, 3, 4 nodes x 5 new layouts) ===
    for (const layoutId of NEW_LAYOUTS) {
      for (const n of [2, 3, 4]) {
        const tlPlan = buildTimelinePlan(layoutId, n);
        await page.evaluate(async (p) => {
          await window.setPlan(p);
          await window.drawFrame(3.2);
          await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
        }, tlPlan);
        const tl = await measureTimeline(page);
        report.timelineResults.push({ layout: layoutId, ...tl });
        report.timelineMaxDiffPx = Math.max(report.timelineMaxDiffPx, tl.maxDiff);
        if (tl.maxDiff > 1) {
          throw new Error(`Timeline alignment fail [${layoutId} n=${n} W=${tl.mediaW}]: ${JSON.stringify(tl)}`);
        }
        if (tl.slotOverflow) {
          throw new Error(`Timeline overflow [${layoutId} n=${n} W=${tl.mediaW}]`);
        }
        if (n === 3 || layoutId === "headline" || layoutId === "broadcast") {
          await page.screenshot({ path: path.join(TIMELINE_DIR, `timeline-${layoutId}-n${n}.png`) });
        }
      }
    }

    // === Part C: 5 real 3-shot MP4 compositions (5 layouts x 5 distinct themes, imageBudget=0, no avatar) ===
    const ffmpegBin = resolveFfmpegBin("ffmpeg");
    const ffprobeBin = resolveFfmpegBin("ffprobe");

    for (const spec of MP4_SPECS) {
      const synth = synthesizeMp4(spec.layout, spec.theme, tmpDir);
      const probe = JSON.parse(
        execFileSync(ffprobeBin, [
          "-v", "error", "-print_format", "json", "-show_format", "-show_streams", synth.mp4Path,
        ], { encoding: "utf8" }),
      );
      const duration = Number(probe.format.duration);
      const vStream = probe.streams.find((s) => s.codec_type === "video");
      if (Math.abs(duration - 9.0) > 0.06) {
        throw new Error(`MP4 duration mismatch for ${spec.layout}/${spec.theme}: got ${duration}s`);
      }

      // Extract frame at t=4.5s (middle of shot 2, timeline visual)
      const framePng = path.join(MP4_DIR, `${spec.layout}-${spec.theme}-mp4.png`);
      execFileSync(ffmpegBin, [
        "-y", "-v", "error", "-ss", "4.5", "-i", synth.mp4Path, "-frames:v", "1", framePng,
      ]);

      // Render matching preview frame on stage.html from the exact exported plan.json
      const previewPng = path.join(MP4_DIR, `${spec.layout}-${spec.theme}-preview.png`);
      await page.evaluate(async (p) => {
        await window.setPlan(p);
        await window.drawFrame(4.5);
        await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
      }, synth.renderPlan);
      await page.screenshot({ path: previewPng });

      const rgbDiff = await meanRgbDiff(page, framePng, previewPng);
      if (rgbDiff > 2.5) {
        throw new Error(`MP4 vs preview RGB diff too high [${spec.layout}/${spec.theme}]: ${rgbDiff}`);
      }
      report.mp4Results.push({
        layout: spec.layout,
        theme: spec.theme,
        duration: Number(duration.toFixed(3)),
        resolution: `${vStream.width}x${vStream.height}`,
        elapsedSec: synth.elapsed,
        meanRgbDiff: rgbDiff,
        assets: synth.assetVersions.map((a) => a.id),
      });
    }

    if (report.pageErrors.length) throw new Error(`Page errors: ${report.pageErrors.join("; ")}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
