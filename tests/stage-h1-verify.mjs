import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.env.H1_BASELINE || "2feed22";
const outDir = resolve(process.argv[2] || join(root, "docs/验收截图/H1"));
await mkdir(outDir, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "stage-h1-"));
const width = 1280;
const height = 720;

const readDataUrl = async (rel, mime = "image/jpeg") =>
  `data:${mime};base64,${(await readFile(join(root, "public", rel))).toString("base64")}`;

function pixels(buffer) {
  const source = join(temp, "px.png");
  writeFileSync(source, buffer);
  return execFileSync(process.env.FFMPEG || "ffmpeg", [
    "-v", "error", "-i", source, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ], { maxBuffer: width * height * 4, timeout: 15000 });
}

function diffBuffers(before, after) {
  const a = pixels(before);
  const b = pixels(after);
  assert.equal(a.length, b.length);
  let total = 0, differing = 0, aboveEight = 0, maxDelta = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 0) differing++;
    if (d > 8) aboveEight++;
    if (d > maxDelta) maxDelta = d;
  }
  return {
    differingPixels: differing,
    differingFraction: differing / (width * height),
    aboveEightPixels: aboveEight,
    meanChannelDiff: total / a.length,
    maxDelta,
  };
}

async function extractBaseline() {
  const files = [
    "stage.html",
    "template-renderer.css",
    "template-renderer.js",
    "stage/scene.css",
    "stage/layout-engine.js",
    "stage/mg-kit.js",
    "stage/scene-content.js",
    "stage/svg-content.js",
    "stage/contents.js",
    "stage/motion-content.js",
    "stage/player.js",
    "vendor/lottie-light-5.13.0.min.js",
    "assets/library/fonts/studio-fonts.css",
  ];
  for (const rel of files) {
    const target = join(temp, "base", rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, execFileSync("git", ["show", `${baseline}:public/${rel}`], { cwd: root }));
  }
}

async function waitPageAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => (img.complete ? null : img.decode())));
  });
}

async function measureContrast(page, fallbackCardBg) {
  return page.evaluate((cardBgHex) => {
    function parseRgba(str) {
      const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(String(str || "").trim());
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    }
    function blend(fg, bg) {
      const a = fg[3];
      return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
        1,
      ];
    }
    function luminance(rgb) {
      const lin = v => {
        const s = Math.max(0, Math.min(1, v / 255));
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    }
    function ratio(a, b) {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    function effectiveBg(el) {
      const layers = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const bg = parseRgba(getComputedStyle(cur).backgroundColor);
        if (bg && bg[3] > 0) {
          layers.push(bg);
          if (bg[3] >= 0.999) break;
        }
        cur = cur.parentElement;
      }
      let base = parseRgba(cardBgHex) || [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
      return base;
    }

    const checks = [];
    const inspect = (el, role) => {
      const text = (el.textContent || "").trim();
      if (!text) return;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.1) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const fg = parseRgba(style.color);
      if (!fg) return;
      const bg = effectiveBg(el);
      const cr = ratio(blend(fg, bg), bg);
      checks.push({
        role,
        selector: el.className ? String(el.className).trim().split(/\s+/).slice(0, 2).join(".") : el.tagName.toLowerCase(),
        text: text.slice(0, 20),
        fg: style.color,
        bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
        contrast: Number(cr.toFixed(2)),
      });
    };

    const subtitle = document.querySelector(".pt-subtitle");
    if (subtitle) inspect(subtitle, "subtitle");
    const bodySelectors = [
      ".pt-media-slot h2", ".pt-media-slot h3", ".pt-media-slot p", ".pt-media-slot strong",
      ".pt-media-slot li", ".pt-fb-headline", ".pt-fb-cover-title", ".pt-fb-cover-lead",
      ".pt-fb-tip-bar", ".cm-heading", ".cm-takeaway", ".stage-media-title",
      ".stage-mg-overlay h2", ".stage-mg-overlay li", ".pt-plaque-name", ".pt-plaque-hosp",
      ".pt-title-pill span:last-child",
    ];
    const seen = new Set();
    for (const sel of bodySelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        inspect(el, "body");
      }
    }
    for (const txt of document.querySelectorAll(".pt-media-slot svg text")) {
      const fill = getComputedStyle(txt).fill;
      const fg = parseRgba(fill);
      if (!fg) continue;
      const bg = effectiveBg(txt.closest(".pt-media-slot"));
      const cr = ratio(blend(fg, bg), bg);
      checks.push({
        role: "svg-text",
        selector: "svg text",
        text: (txt.textContent || "").trim().slice(0, 20),
        fg: fill,
        bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
        contrast: Number(cr.toFixed(2)),
      });
    }
    return checks;
  }, fallbackCardBg);
}

let browser;
let serverProc;
try {
  await extractBaseline();
  const avatarDigital = await readDataUrl("assets/template-doctor-digital.jpg");
  const avatarCartoon = await readDataUrl("assets/template-doctor-cartoon.jpg");
  const sampleImg = await readDataUrl("assets/template-info-tablet.jpg");
  const bgBlur = await readDataUrl("assets/library/backgrounds/bg-clinic-blur.jpg");
  const bgIllus = await readDataUrl("assets/library/backgrounds/bg-illustration.jpg");
  const svgAsset = await readDataUrl("assets/library/svg/reading-list.svg", "image/svg+xml");
  const lottieJson = JSON.parse(await readFile(join(root, "public/assets/library/lottie/capsule.json"), "utf8"));
  const catalog = JSON.parse(await readFile(join(root, "public/assets/library/catalog.json"), "utf8"));
  const lottieMeta = catalog.find(x => x.id === "builtin:lottie/capsule");
  const loadLayout = async name => JSON.parse(await readFile(join(root, `public/assets/library/layouts/${name}.json`), "utf8"));
  const loadTheme = async name => JSON.parse(await readFile(join(root, `public/assets/library/themes/${name}.json`), "utf8"));

  const infoClassic = await loadLayout("info-classic");
  const cornerPresenter = await loadLayout("corner-presenter");
  const themes = Object.fromEntries(await Promise.all(
    ["medical", "warm", "mint", "night", "illus", "photo"].map(async name => [name, await loadTheme(name)])
  ));

  const baseImages = {
    "/assets/template-doctor-digital.jpg": avatarDigital,
    "/assets/template-doctor-cartoon.jpg": avatarCartoon,
    "/assets/template-info-tablet.jpg": sampleImg,
    "/library/builtin%3Aimage%2Fbg-clinic-blur": bgBlur,
    "/library/builtin%3Aimage%2Fbg-illustration": bgIllus,
  };

  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const opts = { viewport: { width, height }, deviceScaleFactor: 1 };

  // ===== Acceptance #2: Old works unchanged (pixel diff vs 2feed22) =====
  const oldPage = await browser.newPage(opts);
  const newPage = await browser.newPage(opts);
  await oldPage.goto(pathToFileURL(join(temp, "base/stage.html")).href);
  await newPage.goto(pathToFileURL(join(root, "public/stage.html")).href);

  const sampleShot = (kind) => {
    const line = "先核对说明书用法用量，再按时服药。";
    const items = [
      { title: "核对通用名", detail: "避免不同药盒成分重叠", tag: "第一步" },
      { title: "按时按量服药", detail: "不要自行随意加倍剂量", tag: "第二步" },
    ];
    const base = {
      name: "用药安全核对",
      headline: "服药前先核对这两项",
      line,
      type: "steps",
      layoutMode: "explain",
      chapterIndex: 0,
      takeaway: "拿不准剂量时先咨询药师",
      footerNote: "拿不准剂量时先咨询药师",
      points: items.map(x => ({ title: x.title, desc: x.detail })),
      steps: items.map(x => ({ title: x.title, desc: x.detail, key: x.tag })),
      warnings: items.map(x => ({ title: x.title, desc: x.detail })),
      checks: items.map(x => x.title),
      highlightWords: ["说明书", "按时服药"],
      seconds: 4,
    };
    const captions = [
      { start: 0, end: 2, text: "先核对说明书用法用量", focus: "0", highlightWords: ["说明书"] },
      { start: 2, end: 4, text: "再按时服药", focus: "1", highlightWords: ["按时服药"] },
    ];
    const shot = { ...base, kind, items, start: 0, end: 4, captions };
    if (kind === "image") base.contentImage = "/assets/template-info-tablet.jpg";
    if (kind === "card") base.motionStyle = "reveal";
    if (kind === "scene") Object.assign(shot, { visual: "steps", motion: "flow", motif: "checklist", tone: "primary" });
    if (kind === "svg") {
      shot.beats = [
        { action: "leaflet", line: "先核对说明书用法用量", label: "查说明书" },
        { action: "log", line: "再按时服药", label: "记时间" },
      ];
      Object.assign(base, { action: "leaflet", svgBeats: shot.beats });
    }
    if (kind === "asset") Object.assign(shot, { assetUrl: svgAsset, move: "still" });
    if (kind === "mg") {
      Object.assign(shot, {
        motionAsset: {
          kind: "lottie",
          animation: lottieJson,
          duration: (lottieJson.op - lottieJson.ip) / lottieJson.fr,
          palette: lottieMeta.palette,
          markers: lottieMeta.markers,
        },
        fit: "auto",
        overlay: "points",
      });
    }
    return { slide: base, shot };
  };

  const regressionResults = [];
  const sampleTimes = [0, 1.5, 3.5];
  for (const [layoutName, layoutDef] of [["info-classic", infoClassic], ["corner-presenter", cornerPresenter]]) {
    for (const [label, baseTheme, themeObj] of [
      ["legacy-medical", "medical", null],
      ["theme-medical", "medical", themes.medical],
      ["theme-warm", "warm", themes.warm],
    ]) {
      const { slide, shot } = sampleShot("card");
      const baseDeck = {
        title: "用药安全核对",
        shortTitle: "用药核对",
        chapters: ["先核对", "再记录"],
        theme: baseTheme,
        presenter: "digital",
        pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
        disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
        slides: [slide],
      };
      const themedDeck = themeObj ? {
        ...baseDeck,
        theme: themeObj.base,
        themeId: `builtin:theme/${themeObj.base}`,
        themeVars: themeObj.vars,
        themeGlass: Boolean(themeObj.glass),
        themeFadeColor: themeObj.fadeColor,
      } : baseDeck;

      await oldPage.evaluate(plan => setPlan(plan), { layout: layoutDef, deck: baseDeck, images: baseImages, shots: [shot] });
      await newPage.evaluate(plan => setPlan(plan), { layout: layoutDef, deck: themedDeck, images: baseImages, shots: [shot] });
      for (const t of sampleTimes) {
        await oldPage.evaluate(time => drawFrame(time), t);
        await newPage.evaluate(time => drawFrame(time), t);
        await Promise.all([waitPageAssets(oldPage), waitPageAssets(newPage)]);
        const before = await oldPage.screenshot({ animations: "disabled" });
        const after = await newPage.screenshot({ animations: "disabled" });
        const diff = diffBuffers(before, after);
        regressionResults.push({ layout: layoutName, variant: label, t, ...diff });
        assert(diff.differingFraction < 0.001, `Regression diff too high for ${layoutName}/${label}@${t}: ${JSON.stringify(diff)}`);
      }
    }
  }

  // ===== Acceptance #3: Night & Photo contrast across all 6 content kinds =====
  const contrastSummary = [];
  const allKinds = ["image", "card", "scene", "svg", "asset", "mg"];
  for (const [themeName, themeDef, fallbackBg] of [
    ["night", themes.night, "rgb(24, 44, 56)"],
    ["photo", themes.photo, "rgb(255, 255, 255)"],
  ]) {
    for (const kind of allKinds) {
      const { slide, shot } = sampleShot(kind);
      const deck = {
        title: "用药安全核对",
        shortTitle: "用药核对",
        chapters: ["先核对", "再记录"],
        theme: themeDef.base,
        themeId: `builtin:theme/${themeName}`,
        themeVars: themeDef.vars,
        themeGlass: Boolean(themeDef.glass),
        themeFadeColor: themeDef.fadeColor,
        ...(themeDef.background?.assetId ? { themeBackground: `/library/${encodeURIComponent(themeDef.background.assetId)}` } : {}),
        presenter: "digital",
        pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
        disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
        slides: [slide],
      };
      await newPage.evaluate(plan => setPlan(plan), { layout: infoClassic, deck, images: baseImages, shots: [shot] });
      await newPage.evaluate(time => drawFrame(time), 1.4);
      await waitPageAssets(newPage);
      await newPage.screenshot({ path: join(outDir, `contrast-${themeName}-${kind}.png`), animations: "disabled" });
      const checks = await measureContrast(newPage, fallbackBg);
      const minBody = Math.min(...checks.filter(c => c.role !== "subtitle").map(c => c.contrast));
      const minSubtitle = Math.min(...checks.filter(c => c.role === "subtitle").map(c => c.contrast));
      const failures = checks.filter(c => c.contrast < 4.5);
      contrastSummary.push({ theme: themeName, kind, count: checks.length, minBody, minSubtitle, failures });
      assert.equal(failures.length, 0, `Contrast < 4.5 in ${themeName}/${kind}: ${JSON.stringify(failures)}`);
    }
  }
  await oldPage.close();
  await newPage.close();

  // ===== Acceptance #4 & #5: Workbench UI + Photo 3-shot MP4 + Theme library lifecycle =====
  const port = 18800 + Math.floor(Math.random() * 800);
  const sandbox = join(temp, "sandbox");
  await mkdir(sandbox, { recursive: true });
  const bootPy = `
import pathlib, asset_library, server
base = pathlib.Path(${JSON.stringify(sandbox)}) / ".studio"
server.DATA = base
server.MEDIA = base / "media"
server.JOBS = base / "jobs"
server.AVATAR_CACHE = base / "avatar_cache"
server.ASSETS = asset_library.LocalLibrary(base / "library", server.PUBLIC / "assets" / "library")
for d in (server.MEDIA, server.JOBS, server.AVATAR_CACHE):
    d.mkdir(parents=True, exist_ok=True)
srv = server.ThreadingHTTPServer(("127.0.0.1", server.PORT), server.Handler)
srv.serve_forever()
`;
  serverProc = spawn("python3", ["-B", "-c", bootPy], {
    cwd: root,
    env: { ...process.env, STUDIO_PORT: String(port), STUDIO_STAGE_RENDER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const origin = `http://127.0.0.1:${port}`;
  let started = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const res = await fetch(origin + "/api/config");
      if (res.ok) { started = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert(started, "Sandboxed server failed to start");

  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on("pageerror", err => pageErrors.push(err.message));
  page.on("dialog", d => d.accept());

  // Acceptance #4: New stage video with 实景虚化, 3 shots, imageBudget = 0, no avatar
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="stage-theme"][data-val="builtin:theme/photo"]').click();
  assert.equal(await page.locator('[data-action="stage-theme"][data-val="builtin:theme/photo"]').getAttribute("aria-pressed"), "true");

  await page.evaluate(() => {
    const w = current();
    w.topic = "降压药漏服处理";
    w.templatePresenter = "digital";
    w.stagePlan.imageBudget = 0;
    w.stagePlan.themeId = "builtin:theme/photo";
    w.templateTheme = "medical";
    Object.assign(w.settings, { voice: "无配音", music: "off", avatarMode: "static" });
    w.stagePlan.audio.sfx = { pack: "off", gainDb: -14 };
    const line1 = "早上忘吃降压药，先算离下次服药有多久。";
    const line2 = "间隔还不到一半，想起来就补上常规剂量。";
    const line3 = "千万不要一次吃双倍，拿不准就先问药师。";
    StageStudio.installDraft(w, "stage", {
      title: "降压药漏服怎么处理",
      shortTitle: "降压药漏服",
      chapters: ["先判断", "记原则"],
      shots: [
        {
          name: "先看漏服时间", line: line1, seconds: 3, chapterIndex: 0,
          points: { type: "steps", headline: "先看离下次服药有多久", items: [{ title: "记住常规服药点", detail: "例如每天早上八点", tag: "" }, { title: "估算剩余间隔", detail: "判断是否超过一半", tag: "" }], checks: ["记住常规服药点", "估算剩余间隔"], takeaway: "按间隔判断最稳妥" },
          cues: [{ text: line1, weight: 1, focus: "all" }],
          content: { kind: "card", motionStyle: "reveal" },
        },
        {
          name: "间隔不到一半可补", line: line2, seconds: 3, chapterIndex: 0,
          points: { type: "compare", headline: "补服还是跳过", items: [{ title: "不到一半", detail: "尽快补服常规一次", tag: "可补服" }, { title: "快到下次", detail: "跳过本次别吃双倍", tag: "跳过" }], takeaway: "一次只吃常规剂量" },
          cues: [{ text: line2, weight: 1, focus: "all" }],
          content: { kind: "scene", visual: "compare", motion: "contrast", motif: "none", tone: "primary" },
        },
        {
          name: "绝不补吃双倍", line: line3, seconds: 3, chapterIndex: 1,
          points: { type: "summary", headline: "记住两条安全原则", items: [{ title: "绝不吃双倍", detail: "防血压骤降头晕", tag: "" }], takeaway: "有疑问先问药师" },
          cues: [{ text: line3, weight: 1, focus: "all" }],
          content: { kind: "svg", beats: [{ action: "consult", line: line3, label: "问药师" }] },
        },
      ],
    });
    changed(w);
    render(true);
  });
  await page.locator("#stage-play:not([disabled])").waitFor();
  await page.locator("#stage-seek").fill("1");
  await page.locator("#stage-seek").dispatchEvent("input");
  await page.screenshot({ path: join(outDir, "photo-workbench-editor.png"), fullPage: true });
  await page.locator("#stage-preview").evaluate(el => el.scrollIntoView({ block: "center" }));
  await page.locator("#stage-preview").screenshot({ path: join(outDir, "photo-preview-shot1.png") });
  const hasPhotoClass = await page.frameLocator("#stage-preview").locator(".pt-frame.is-glass.has-theme-bg").count();
  assert.equal(hasPhotoClass, 1);

  // Also capture a 1280x720 preview frame directly from stage.html at t=1.0 for pixel comparison with MP4 frame 1
  const previewFramePage = await browser.newPage(opts);
  const previewPlanData = await page.evaluate(async () => {
    const w = current();
    const layout = await jsonRequest(StudioAssets.url(w.stagePlan.layout.id));
    const themeDef = await jsonRequest(StudioAssets.url(w.stagePlan.themeId));
    let start = 0;
    const shots = w.stagePlan.shots.map(shot => {
      const end = start + shot.seconds;
      const captions = [{ ...shot.cues[0], start, end }];
      const spec = { ...shot.content, kind: shot.content.kind, name: shot.name, line: shot.line, items: shot.points.items, takeaway: shot.points.takeaway, start, end, captions };
      start = end;
      return spec;
    });
    const deck = {
      title: w.title, shortTitle: w.stagePlan.shortTitle, chapters: w.stagePlan.chapters, disclaimer: w.stagePlan.disclaimer,
      theme: themeDef.base, themeId: w.stagePlan.themeId, themeVars: themeDef.vars, themeGlass: Boolean(themeDef.glass),
      themeFadeColor: themeDef.fadeColor, themeBackground: StudioAssets.url(themeDef.background.assetId),
      presenter: w.templatePresenter, pharmacist: { ...TemplateStudio.ensurePharmacist(data) },
      slides: w.stagePlan.shots.map(s => ({
        ...s.points, name: s.name, line: s.line, seconds: s.seconds, chapterIndex: s.chapterIndex,
        steps: s.points.items.map(({ title, detail }) => ({ title, desc: detail })),
        points: s.points.items.map(({ title, detail }) => ({ title, desc: detail })),
        motionStyle: s.content.motionStyle, layoutMode: "explain",
      })),
    };
    return { layout, deck, shots, images: {} };
  });
  await previewFramePage.goto(origin + "/stage.html");
  await previewFramePage.evaluate(plan => setPlan(plan), previewPlanData);
  await previewFramePage.evaluate(() => drawFrame(1.0));
  await waitPageAssets(previewFramePage);
  const preview1280Png = await previewFramePage.screenshot({ path: join(outDir, "photo-preview-1280-shot1.png"), animations: "disabled" });
  await previewFramePage.close();

  await page.getByRole("button", { name: "合成视频", exact: true }).click();
  await page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
  await page.locator("video.video-player").waitFor({ timeout: 90000 });
  const videoMeta = await page.evaluate(() => current().video);
  const mp4Path = join(sandbox, ".studio", videoMeta.url.slice(1));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", mp4Path]));
  const mp4Duration = Number(probe.format.duration);
  assert(Math.abs(mp4Duration - 9.0) < 0.1, `Expected 9s MP4, got ${mp4Duration}`);
  const assetIds = (videoMeta.assetVersions || []).map(a => a.id);
  assert(assetIds.includes("builtin:theme/photo"), `Missing theme in assetVersions: ${assetIds}`);
  assert(assetIds.includes("builtin:image/bg-clinic-blur"), `Missing bg image in assetVersions: ${assetIds}`);

  const frame1Path = join(outDir, "photo-mp4-frame1.png");
  const frame2Path = join(outDir, "photo-mp4-frame2.png");
  const frame3Path = join(outDir, "photo-mp4-frame3.png");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "1.0", "-i", mp4Path, "-frames:v", "1", frame1Path]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "4.5", "-i", mp4Path, "-frames:v", "1", frame2Path]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "7.5", "-i", mp4Path, "-frames:v", "1", frame3Path]);

  const frame1Png = await readFile(frame1Path);
  const previewVsMp4 = diffBuffers(preview1280Png, frame1Png);
  assert(previewVsMp4.meanChannelDiff < 3.0, `Preview vs MP4 diff too large: ${JSON.stringify(previewVsMp4)}`);
  const mp4Frame1Raw = pixels(frame1Png);
  const cornerVals = new Set();
  for (let y = 4; y < 20; y++) {
    for (let x = 4; x < 20; x++) {
      const idx = (y * width + x) * 3;
      cornerVals.add(`${mp4Frame1Raw[idx]},${mp4Frame1Raw[idx + 1]},${mp4Frame1Raw[idx + 2]}`);
    }
  }
  assert(cornerVals.size > 10, `Expected photographic background variation in corner, got ${cornerVals.size} colors`);

  // ===== Acceptance #5: Theme library preview, copy (swap bg), upload valid, reject invalid, archive =====
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("heading", { name: "实景虚化", exact: true }).waitFor();
  await page.screenshot({ path: join(outDir, "library-themes-list.png"), fullPage: true });

  // 1) Preview theme
  const photoCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "实景虚化", exact: true }) });
  await photoCard.getByRole("button", { name: "预览主题", exact: true }).click();
  await page.frameLocator('iframe[title="主题实时预览"]').locator(".pt-frame.is-glass.has-theme-bg").waitFor();
  await page.screenshot({ path: join(outDir, "library-theme-preview.png"), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "关闭弹窗" }).click();

  // 2) Copy theme & swap background image
  await photoCard.getByRole("button", { name: "复制为我的主题", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("主题名称").fill("我的插画磨砂主题");
  await dlg.locator('input[name="primary"]').fill("#1f7a5a");
  await dlg.locator('select[name="backgroundAssetId"]').selectOption("builtin:image/bg-illustration");
  await page.frameLocator('iframe[title="主题实时预览"]').locator('.pt-frame[style*="bg-illustration"]').waitFor();
  await page.screenshot({ path: join(outDir, "library-theme-copy.png"), fullPage: true });
  await dlg.getByRole("button", { name: "另存主题", exact: true }).click();
  const copiedCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "我的插画磨砂主题", exact: true }) });
  await copiedCard.waitFor();

  // 3) Upload valid JSON theme
  await page.getByRole("button", { name: "上传主题", exact: true }).click();
  const uploadForm = page.getByRole("dialog").locator("form");
  const validUpload = {
    schemaVersion: 1,
    base: "medical",
    vars: { ...themes.mint.vars, "--v-primary": "#167060" },
    glass: false,
    fadeColor: "#ebf6f1",
  };
  await uploadForm.getByLabel("主题 JSON 文件").setInputFiles({
    name: "valid-theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(validUpload)),
  });
  await uploadForm.getByLabel("名称", { exact: true }).fill("测试上传合法主题");
  await uploadForm.locator('select[name="license"]').selectOption("自制或已获授权");
  await uploadForm.getByLabel("署名或来源", { exact: false }).fill("本机验收");
  await uploadForm.getByRole("button", { name: "收入素材库", exact: true }).click();
  const uploadedCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "测试上传合法主题", exact: true }) });
  await uploadedCard.waitFor();

  // 4) Upload invalid JSON theme (contains url() injection) -> rejected
  await page.getByRole("button", { name: "上传主题", exact: true }).click();
  const badForm = page.getByRole("dialog").locator("form");
  const badUpload = {
    schemaVersion: 1,
    base: "medical",
    vars: { "--v-bg": 'url("https://evil.invalid/x.png")' },
  };
  await badForm.getByLabel("主题 JSON 文件").setInputFiles({
    name: "bad-theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(badUpload)),
  });
  await badForm.getByLabel("名称", { exact: true }).fill("测试非法主题");
  await badForm.locator('select[name="license"]').selectOption("自制或已获授权");
  await badForm.getByLabel("署名或来源", { exact: false }).fill("本机验收");
  await badForm.getByRole("button", { name: "收入素材库", exact: true }).click();
  const alertBox = badForm.getByRole("alert");
  await alertBox.waitFor();
  const rejectMessage = await alertBox.innerText();
  assert(rejectMessage.includes("安全规范"), `Unexpected reject message: ${rejectMessage}`);
  await page.screenshot({ path: join(outDir, "library-theme-reject.png"), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "关闭弹窗" }).click();

  // 5) Archive copied theme
  await copiedCard.getByRole("button", { name: "下架", exact: true }).click();
  await copiedCard.waitFor({ state: "hidden" });

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);

  console.log(JSON.stringify({
    regression: regressionResults,
    contrast: contrastSummary,
    photoCompose: { duration: mp4Duration, assetIds, cornerDistinctColors: cornerVals.size, previewVsMp4 },
    libraryLifecycle: {
      previewed: true,
      copiedAndSwappedBg: "我的插画磨砂主题",
      uploadedValid: "测试上传合法主题",
      rejectedInvalid: rejectMessage,
      archivedCopied: true,
    },
    pageErrors,
  }, null, 2));
} finally {
  if (serverProc) serverProc.kill("SIGTERM");
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
