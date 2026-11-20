import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, "docs/验收截图/H2"));
fs.mkdirSync(OUT_DIR, { recursive: true });

const NEW_LAYOUTS = [
  { id: "chapter-nav", propId: "L1", name: "章节导航" },
  { id: "broadcast", propId: "L2", name: "播报横条" },
  { id: "takeaway", propId: "L3", name: "名片与要点栏" },
  { id: "qa-chat", propId: "L4", name: "问答对话" },
  { id: "headline", propId: "L5", name: "大字报" },
];
const THEMES = ["medical", "warm", "mint", "night", "illus", "photo"];

const EXPECTED_DIAGRAM_LABELS = {
  "builtin:layout/chapter-nav": ["导航", "路径", "内容", "字幕"],
  "builtin:layout/broadcast": ["信息条", "内容", "主讲", "字幕"],
  "builtin:layout/takeaway": ["名片", "内容", "要点", "字幕"],
  "builtin:layout/qa-chat": ["提问", "主讲", "回答", "内容", "字幕"],
  "builtin:layout/headline": ["标题", "内容", "字幕"],
};

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function fileDataUrl(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

function loadThemeSpec(themeId) {
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
    if (!entry) throw new Error(`Missing bg asset ${def.background.assetId}`);
    out.themeBackground = fileDataUrl(path.join(ROOT, "public/assets/library", entry.file));
  }
  return out;
}

function buildSamplePlanFor(layoutId, themeId) {
  const layout = readJson(`public/assets/library/layouts/${layoutId}.json`);
  const themeDeck = loadThemeSpec(themeId);
  const digitalAvatar = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-digital.jpg"));
  const cartoonAvatar = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-cartoon.jpg"));
  const presenter = themeDeck.theme === "warm" ? "cartoon" : "digital";

  // 22-character subtitle testing Section 3.1 single-line requirement
  const sub22 = "间隔还不到一半时想起来就按常规剂量补服一次"; // 21 chars
  const sub22Exact = "间隔还不到一半时想起来就按常规剂量补服一次哦"; // exactly 22 chars

  const points = [
    { title: "用前洗手，瓶口别碰到眼睛", detail: "混悬液使用前轻轻摇匀" },
    { title: "滴进下眼睑，不要直接滴眼球", detail: "头稍后仰拉开下眼睑小袋" },
    { title: "闭眼轻按内眼角一两分钟", detail: "减少药液经鼻泪管流失" },
    { title: "两种眼药间隔五分钟以上", detail: "避免后滴药液冲走前药" },
  ];
  const slide0 = {
    name: "先判断时间",
    headline: "降压药漏服先看间隔",
    accentPhrase: "先看间隔",
    lead: "以每天固定时间服药一次为例，先算离下次服药还有多久。",
    line: sub22Exact,
    type: "explain",
    layoutMode: "explain",
    chapterIndex: 0,
    question: "降压药忘吃了怎么判断要不要补？",
    answer: "按间隔是否过半判断",
    verdictTone: "ok",
    takeaway: "记住服药时间点，才好判断是否补服",
    highlightWords: ["常规剂量", "补服"],
    points: points.map(({ title, detail }) => ({ title, desc: detail })),
  };
  const slide1 = {
    name: "补还是不补",
    headline: "漏服了，也只吃一次",
    accentPhrase: "也只吃一次",
    lead: "不论补服还是到点服药，每次都只吃平时的常规剂量。",
    line: sub22Exact,
    type: "steps",
    layoutMode: "explain",
    chapterIndex: 1,
    question: "昨天忘吃降压药，今天吃两片补回来，行吗？",
    answer: "不行，只吃常规剂量",
    verdictTone: "no",
    takeaway: "一次一滴就够，多滴也会流走",
    highlightWords: ["常规剂量", "补服一次"],
    points: points.map(({ title, detail }) => ({ title, desc: detail })),
    steps: points.slice(0, 3).map(({ title, detail }) => ({ title, desc: detail })),
  };
  const shot0 = {
    ...slide0,
    kind: "scene",
    visual: "mechanism",
    motion: "reveal",
    motif: "clock",
    tone: "primary",
    items: points,
    start: 0,
    end: 5,
    captions: [{ start: 0, end: 5, text: sub22, focus: "0", highlightWords: ["常规剂量"] }],
  };
  const shot1 = {
    ...slide1,
    kind: "scene",
    visual: "steps",
    motion: "flow",
    motif: "checklist",
    tone: "primary",
    items: points,
    start: 5,
    end: 15,
    captions: [
      { start: 5, end: 9, text: sub22Exact, focus: "1", highlightWords: ["常规剂量"] },
      { start: 9, end: 15, text: sub22Exact, focus: "2", highlightWords: ["补服一次"] },
    ],
  };
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
      chapters: ["先判断时间", "补还是不补", "千万别加倍", "何时问药师"],
      slides: [slide0, slide1],
    },
    shots: [shot0, shot1],
    images: {
      "/assets/template-doctor-digital.jpg": digitalAvatar,
      "/assets/template-doctor-cartoon.jpg": cartoonAvatar,
    },
  };
}

async function measureLayoutAlignment(page, layoutId) {
  return page.evaluate((id) => {
    const frame = document.querySelector(".pt-frame");
    const fr = frame.getBoundingClientRect();
    const rel = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - fr.left,
        top: r.top - fr.top,
        right: r.right - fr.left,
        bottom: r.bottom - fr.top,
        width: r.width,
        height: r.height,
        cx: (r.left + r.right) / 2 - fr.left,
        cy: (r.top + r.bottom) / 2 - fr.top,
      };
    };
    const checks = [];
    const add = (name, actual, expected) => {
      checks.push({ name, actual: Number(actual.toFixed(3)), expected: Number(expected.toFixed(3)), diff: Number(Math.abs(actual - expected).toFixed(3)) });
    };

    // 3.1 Canvas bounds & overflow checks for all top-level regions & text nodes
    const regionEls = [...frame.querySelectorAll(
      ".pt-nav-panel, .pt-header-breadcrumb, .pt-header-ticker, .pt-header-namecard, .pt-header-question, .pt-presenter-avatar, .pt-answer-bubble, .pt-media-slot, .pt-keypoints, .pt-headline-poster, .pt-disclaimer-inline-right, .pt-region-progress, .pt-footer"
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
      ".pt-nav-topic, .pt-nav-meta, .pt-nav-chap-label, .pt-crumb, .pt-clock, .pt-ticker-title, .pt-ticker-drug, .pt-nc-title, .pt-kp-item span, .pt-kp-quote, .pt-ask-text, .pt-answer-meta, .pt-answer-verdict, .pt-disclaimer-inline-right, .pt-poster-kicker, .pt-poster-h3, .pt-poster-lead, .pt-sub-tab-name, .pt-subtitle"
    )];
    for (const el of textEls) {
      const style = getComputedStyle(el);
      if (style.overflow === "hidden" && style.textOverflow === "ellipsis") {
        // Intentional truncation allowed only when clamped/ellipsized, still verify height doesn't overflow
        if (el.scrollHeight > el.clientHeight + 1) {
          overflows.push({ cls: el.className, issue: "text-height-overflow", sh: el.scrollHeight, ch: el.clientHeight });
        }
      } else if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        overflows.push({ cls: el.className, issue: "text-overflow", sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
      }
    }

    // 3.1 Single-line 22-char subtitle check
    const subEl = frame.querySelector(".pt-subtitle");
    let subtitleSingleLine = true;
    if (subEl) {
      const range = document.createRange();
      range.selectNodeContents(subEl);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const distinctLines = new Set(rects.map((r) => Math.round(r.top / 10)));
      if (distinctLines.size > 1 || subEl.scrollWidth > subEl.clientWidth + 1) {
        subtitleSingleLine = false;
        overflows.push({ cls: "pt-subtitle", issue: "subtitle-multiline-or-clipped", lines: distinctLines.size, sw: subEl.scrollWidth, cw: subEl.clientWidth });
      }
    }

    // 3.2 Layout-specific rules
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
      const topGap = head.top - poster.top;
      const bottomGap = poster.bottom - head.bottom;
      add("head vertical centering (topGap == bottomGap)", topGap, bottomGap);
    }
    return { checks, overflows, subtitleSingleLine };
  }, layoutId);
}

async function stitchSideBySide(page, leftPngPath, rightPngPath, outPath, titleLeft, titleRight) {
  const leftUrl = fileDataUrl(leftPngPath);
  const rightUrl = fileDataUrl(rightPngPath);
  await page.setViewportSize({ width: 1296, height: 400 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#101820;font-family:-apple-system,sans-serif;color:#fff;padding:12px;">
    <div style="display:flex;gap:12px;align-items:flex-start;">
      <div style="width:630px;"><div style="font-size:13px;margin-bottom:6px;opacity:.85;">${titleLeft}</div><img src="${leftUrl}" style="width:630px;height:354.375px;display:block;border-radius:6px;"></div>
      <div style="width:630px;"><div style="font-size:13px;margin-bottom:6px;opacity:.85;">${titleRight}</div><img src="${rightUrl}" style="width:630px;height:354.375px;display:block;border-radius:6px;"></div>
    </div>
  </body></html>`);
  await page.screenshot({ path: outPath });
}

function startSandboxedServer(port, tempDir) {
  const py = `
import sys, pathlib
sys.path.insert(0, ${JSON.stringify(ROOT)})
import server, asset_library
base = pathlib.Path(${JSON.stringify(tempDir)}) / ".studio"
server.DATA = base
server.MEDIA = base / "media"
server.JOBS = base / "jobs"
server.AVATAR_CACHE = base / "avatar-cache"
server.GENERATED_MUSIC_DIR = base / "music"
server.ASSETS = asset_library.LocalLibrary(base / "library", server.PUBLIC / "assets" / "library")
for d in (server.DATA, server.MEDIA, server.JOBS, server.AVATAR_CACHE, server.GENERATED_MUSIC_DIR):
    d.mkdir(parents=True, exist_ok=True)
server.ThreadingHTTPServer(("127.0.0.1", server.PORT), server.Handler).serve_forever()
`;
  const proc = spawn("python3", ["-B", "-c", py], {
    cwd: ROOT,
    env: { ...process.env, STUDIO_PORT: String(port), STUDIO_STAGE_RENDER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => process.stderr.write(d));
  return proc;
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function diffPngFiles(page, pathA, pathB) {
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
    let diffPixels = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diffPixels += 1;
    }
    return { diffPixels, totalPixels: w * h };
  }, [aUrl, bUrl]);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-h2-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const stageUrl = pathToFileURL(path.join(ROOT, "public/stage.html")).href;
  const proposalUrl = pathToFileURL(path.join(ROOT, "design-templates/布局模板提案.html")).href;

  const summary = {
    alignment: {},
    maxDiffPx: 0,
    totalOverflows: 0,
    subtitleFailures: 0,
    libraryChecks: [],
    legacyRegression: [],
    pageErrors: [],
  };

  try {
    // 1. Render all 5 layouts x 6 themes on stage.html & measure Section 3.1/3.2 + capture screenshots
    const stagePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    stagePage.on("pageerror", (e) => summary.pageErrors.push(`stage: ${e.message}`));
    await stagePage.goto(stageUrl, { waitUntil: "networkidle" });

    const propPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await propPage.goto(proposalUrl, { waitUntil: "networkidle" });
    await propPage.evaluate(() => {
      const pageEl = document.querySelector(".page");
      if (pageEl) pageEl.style.maxWidth = "none";
      document.querySelectorAll(".notes").forEach((n) => { n.style.display = "none"; });
      document.querySelectorAll(".grid").forEach((g) => { g.style.display = "block"; });
      document.querySelectorAll(".stage").forEach((s) => {
        s.style.width = "1280px";
        s.style.height = "720px";
        s.style.aspectRatio = "auto";
        s.style.borderRadius = "0";
        s.style.boxShadow = "none";
        if (s.firstElementChild) s.firstElementChild.style.transform = "none";
      });
    });

    const stitchPage = await browser.newPage({ viewport: { width: 1296, height: 400 } });

    for (const layout of NEW_LAYOUTS) {
      summary.alignment[layout.id] = { maxDiff: 0, overflows: 0, rules: {} };
      for (const themeId of THEMES) {
        const plan = buildSamplePlanFor(layout.id, themeId);
        await stagePage.evaluate(async (p) => {
          await window.setPlan(p);
          await window.drawFrame(7.2);
        }, plan);
        const meas = await measureLayoutAlignment(stagePage, layout.id);
        for (const c of meas.checks) {
          summary.alignment[layout.id].maxDiff = Math.max(summary.alignment[layout.id].maxDiff, c.diff);
          summary.maxDiffPx = Math.max(summary.maxDiffPx, c.diff);
          const prev = summary.alignment[layout.id].rules[c.name] ?? 0;
          summary.alignment[layout.id].rules[c.name] = Math.max(prev, c.diff);
          if (c.diff > 1) {
            throw new Error(`Alignment failure [${layout.id}/${themeId}] ${c.name}: actual=${c.actual} expected=${c.expected} diff=${c.diff}`);
          }
        }
        if (meas.overflows.length) {
          summary.alignment[layout.id].overflows += meas.overflows.length;
          summary.totalOverflows += meas.overflows.length;
          throw new Error(`Overflow [${layout.id}/${themeId}]: ${JSON.stringify(meas.overflows)}`);
        }
        if (!meas.subtitleSingleLine) {
          summary.subtitleFailures += 1;
          throw new Error(`Subtitle not single line [${layout.id}/${themeId}]`);
        }

        // Capture stage.html frame & proposal frame and stitch side-by-side
        const stagePng = path.join(tmpDir, `stage-${layout.id}-${themeId}.png`);
        const propPng = path.join(tmpDir, `prop-${layout.id}-${themeId}.png`);
        await stagePage.screenshot({ path: stagePng });

        await propPage.evaluate((tid) => {
          document.body.dataset.theme = tid;
          document.querySelectorAll(".stage").forEach((s) => {
            if (s.firstElementChild) s.firstElementChild.style.transform = "none";
          });
        }, themeId);
        await propPage.waitForTimeout(80);
        const propEl = propPage.locator(`.f.${layout.propId}`).first();
        await propEl.screenshot({ path: propPng });

        const outPair = path.join(OUT_DIR, `compare-${layout.id}-${themeId}.png`);
        await stitchSideBySide(
          stitchPage,
          stagePng,
          propPng,
          outPair,
          `实现版 · ${layout.name} (${layout.id}) · ${themeId}`,
          `提案第3版 · ${layout.name} (${layout.propId}) · ${themeId}`,
        );
      }
    }

    // 2. Old layout regression vs git commit b8c2678 (pre-H2)
    const oldCheckout = path.join(tmpDir, "old-h1");
    fs.mkdirSync(oldCheckout, { recursive: true });
    await new Promise((resolve, reject) => {
      const p = spawn("bash", ["-c", `git archive b8c2678 | tar -x -C ${JSON.stringify(oldCheckout)}`], { cwd: ROOT });
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git archive failed: ${code}`))));
    });
    const oldStageUrl = pathToFileURL(path.join(oldCheckout, "public/stage.html")).href;
    const newLegPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const oldPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await newLegPage.goto(stageUrl, { waitUntil: "networkidle" });
    await oldPage.goto(oldStageUrl, { waitUntil: "networkidle" });

    for (const legacyId of ["info-classic", "corner-presenter"]) {
      for (const themeId of ["medical", "warm"]) {
        const plan = buildSamplePlanFor(legacyId, themeId);
        await newLegPage.evaluate(async (p) => { await window.setPlan(p); }, plan);
        await oldPage.evaluate(async (p) => { await window.setPlan(p); }, plan);
        for (const t of [0, 6.5, 14.5]) {
          await newLegPage.evaluate(async (time) => {
            await window.drawFrame(time);
            await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
          }, t);
          await oldPage.evaluate(async (time) => {
            await window.drawFrame(time);
            await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
          }, t);
          const pNew = path.join(tmpDir, `leg-new-${legacyId}-${themeId}-${t}.png`);
          const pOld = path.join(tmpDir, `leg-old-${legacyId}-${themeId}-${t}.png`);
          await newLegPage.screenshot({ path: pNew });
          await oldPage.screenshot({ path: pOld });
          const d = await diffPngFiles(stitchPage, pNew, pOld);
          summary.legacyRegression.push({ layout: legacyId, theme: themeId, t, diffPixels: d.diffPixels });
          if (d.diffPixels !== 0) {
            throw new Error(`Legacy regression [${legacyId}/${themeId}@${t}s]: ${d.diffPixels} differing pixels`);
          }
        }
      }
    }

    // 3. Sandboxed workbench check: Asset Library layout tab diagram labels + preview modal for all 5 new layouts
    const port = 18792;
    const srv = startSandboxedServer(port, path.join(tmpDir, "srv"));
    try {
      await waitForServer(`http://127.0.0.1:${port}/api/config`);
      const uiPage = await browser.newPage({ viewport: { width: 1366, height: 860 } });
      uiPage.on("pageerror", (e) => summary.pageErrors.push(`ui: ${e.message}`));
      await uiPage.goto(`http://127.0.0.1:${port}/#library`, { waitUntil: "networkidle" });
      await uiPage.click('button[data-lib-kind="layout"]');
      await uiPage.waitForSelector('button[data-lib-layout="builtin:layout/headline"]');
      await uiPage.waitForTimeout(600);
      await uiPage.screenshot({ path: path.join(OUT_DIR, "library-layouts-list.png") });

      for (const [assetId, expectedLabels] of Object.entries(EXPECTED_DIAGRAM_LABELS)) {
        const labels = await uiPage.evaluate((id) => {
          const btn = document.querySelector(`button[data-lib-layout="${id}"]`);
          const card = btn?.closest(".asset-card");
          return [...(card?.querySelectorAll(".stage-layout-mini .layout-region") || [])]
            .map((el) => el.textContent.trim())
            .filter(Boolean);
        }, assetId);
        for (const lbl of expectedLabels) {
          if (!labels.includes(lbl)) {
            throw new Error(`Diagram label missing for ${assetId}: expected ${lbl}, got ${JSON.stringify(labels)}`);
          }
        }
        await uiPage.click(`button[data-lib-layout="${assetId}"]`);
        await uiPage.waitForSelector(".layout-stage-preview");
        await uiPage.waitForTimeout(350);
        const iframeFrameExists = await uiPage.evaluate(() => {
          const ifr = document.querySelector(".layout-stage-preview");
          return Boolean(ifr?.contentDocument?.querySelector(".pt-frame"));
        });
        if (!iframeFrameExists) throw new Error(`Layout preview failed for ${assetId}`);
        summary.libraryChecks.push({ assetId, labels, previewOk: true });
        if (assetId === "builtin:layout/qa-chat") {
          await uiPage.screenshot({ path: path.join(OUT_DIR, "library-preview-qa-chat.png") });
        }
        await uiPage.keyboard.press("Escape");
        await uiPage.waitForTimeout(100);
      }
    } finally {
      srv.kill("SIGTERM");
    }

    if (summary.pageErrors.length) {
      throw new Error(`Page errors: ${summary.pageErrors.join("; ")}`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
