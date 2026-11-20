import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, "docs/验收截图/H3"));
fs.mkdirSync(OUT_DIR, { recursive: true });

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function fileDataUrl(absPath) {
  return `data:image/jpeg;base64,${fs.readFileSync(absPath).toString("base64")}`;
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

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-h3-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const stageUrl = pathToFileURL(path.join(ROOT, "public/stage.html")).href;
  const digitalAvatar = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-digital.jpg"));
  const result = { chapterNav: [], chapterNavSceneOnly: [], takeawayFocus: {}, editorChecks: {}, pageErrors: [] };

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => result.pageErrors.push(`stage: ${e.message}`));
    await page.goto(stageUrl, { waitUntil: "networkidle" });

    // === H3 Acceptance #3: chapter-nav at 0%, 30%, 60%, 100% (including code-motion scene shot) ===
    const chapLayout = readJson("public/assets/library/layouts/chapter-nav.json");
    const points = [
      { title: "确认漏服时间", detail: "先看离下次服药还有多久" },
      { title: "没过半就补服", detail: "按常规剂量补一次" },
      { title: "过半则跳过", detail: "等到下一次照常吃" },
    ];
    const chapPlan = {
      layout: chapLayout,
      deck: {
        title: "降压药忘吃了，要不要补？",
        shortTitle: "降压药漏服",
        theme: "medical",
        presenter: "digital",
        pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
        disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
        chapters: ["先判断时间", "补还是不补", "千万别加倍"],
        slides: [
          { name: "先判断时间", headline: "先判断漏服时间", line: "漏服降压药后先看离下次服药还有多久。", type: "explain", layoutMode: "explain", chapterIndex: 0, points: points.map((p) => ({ title: p.title, desc: p.detail })) },
          { name: "补还是不补", headline: "间隔是否过半决定补不补", line: "不到间隔一半想起来就补上，已经过半就跳过这一次。", type: "steps", layoutMode: "explain", chapterIndex: 1, points: points.map((p) => ({ title: p.title, desc: p.detail })) },
        ],
      },
      shots: [
        { kind: "scene", visual: "mechanism", motion: "reveal", motif: "clock", tone: "primary", name: "先判断时间", line: "漏服降压药后先看离下次服药还有多久。", items: points, start: 0, end: 10, captions: [{ start: 0, end: 10, text: "漏服降压药后先看离下次服药还有多久", focus: "0" }] },
        { kind: "scene", visual: "steps", motion: "flow", motif: "checklist", tone: "primary", name: "补还是不补", line: "不到间隔一半想起来就补上，已经过半就跳过这一次。", items: points, start: 10, end: 20, captions: [{ start: 10, end: 15, text: "不到间隔一半想起来就补上", focus: "1" }, { start: 15, end: 20, text: "已经过半就跳过这一次", focus: "2" }] },
      ],
      images: { "/assets/template-doctor-digital.jpg": digitalAvatar },
    };
    await page.evaluate((p) => window.setPlan(p), chapPlan);

    // Overall 0%, 30%, 60%, 100% across 20s video (0s, 6s, 12s, 20s)
    for (const [label, t] of [["0%", 0], ["30%", 6], ["60%", 12], ["100%", 20]]) {
      await page.evaluate((time) => window.drawFrame(time), t);
      const state = await page.evaluate(() => {
        const clock = document.querySelector(".pt-clock")?.textContent?.trim() || "";
        const fill = document.querySelector(".pt-nav-chap-bar-fill");
        const bar = document.querySelector(".pt-nav-chap-bar");
        const activeChap = document.querySelector(".pt-nav-chap.on .pt-nav-chap-label")?.textContent?.trim() || "";
        return {
          clock,
          activeChap,
          barWidthPct: fill ? Number(parseFloat(fill.style.width).toFixed(2)) : null,
          barPixelRatio: fill && bar ? Number((fill.getBoundingClientRect().width / bar.getBoundingClientRect().width).toFixed(3)) : null,
        };
      });
      result.chapterNav.push({ label, t, ...state });
      await page.screenshot({ path: path.join(OUT_DIR, `chapter-nav-${label.replace("%", "pct")}.png`) });
    }

    // Verify monotonic clock & chapter bar updates WITHIN a single code-motion scene shot (shot 1: 10s..20s -> mount once, only LayoutEngine.update runs!)
    for (const [label, t] of [["shot1-0%", 10], ["shot1-30%", 13], ["shot1-60%", 16], ["shot1-100%", 20]]) {
      await page.evaluate((time) => window.drawFrame(time), t);
      const state = await page.evaluate(() => ({
        clock: document.querySelector(".pt-clock")?.textContent?.trim() || "",
        barWidthPct: Number(parseFloat(document.querySelector(".pt-nav-chap-bar-fill")?.style.width || "0").toFixed(2)),
      }));
      result.chapterNavSceneOnly.push({ label, t, ...state });
    }

    // Assertions for #3
    const [c0, c30, c60, c100] = result.chapterNav;
    if (c0.clock !== "00:00 / 00:20" || c30.clock !== "00:06 / 00:20" || c60.clock !== "00:12 / 00:20" || c100.clock !== "00:20 / 00:20") {
      throw new Error(`Unexpected chapter-nav clocks: ${JSON.stringify(result.chapterNav)}`);
    }
    if (c0.barWidthPct !== 0 || c30.barWidthPct !== 60 || c60.barWidthPct !== 20 || c100.barWidthPct !== 100) {
      throw new Error(`Unexpected chapter-nav bar widths: ${JSON.stringify(result.chapterNav)}`);
    }
    const [s0, s30, s60, s100] = result.chapterNavSceneOnly;
    if (s0.clock !== "00:10 / 00:20" || s30.clock !== "00:13 / 00:20" || s60.clock !== "00:16 / 00:20" || s100.clock !== "00:20 / 00:20") {
      throw new Error(`Scene-shot update() clock failed: ${JSON.stringify(result.chapterNavSceneOnly)}`);
    }
    if (s0.barWidthPct !== 0 || s30.barWidthPct !== 30 || s60.barWidthPct !== 60 || s100.barWidthPct !== 100) {
      throw new Error(`Scene-shot update() chapter bar failed: ${JSON.stringify(result.chapterNavSceneOnly)}`);
    }

    // === H3 Acceptance #4: takeaway keypoints focus "0", "1", "all", "outro" ===
    const tkLayout = readJson("public/assets/library/layouts/takeaway.json");
    const tkPoints = [
      { title: "用前洗手，瓶口别碰到眼睛", detail: "混悬液先摇匀" },
      { title: "滴进下眼睑，不要直接滴眼球", detail: "头稍后仰" },
      { title: "闭眼按压内眼角", detail: "轻按 1-2 分钟" },
      { title: "两种眼药间隔 5 分钟以上", detail: "避免互相冲走" },
    ];
    const tkPlan = {
      layout: tkLayout,
      deck: {
        title: "滴眼液怎么滴才不会流出来？",
        shortTitle: "正确滴眼",
        theme: "medical",
        presenter: "digital",
        pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
        disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
        chapters: ["准备", "滴眼", "按压", "收口"],
        slides: [{
          name: "正确滴眼步骤", headline: "滴眼液怎么滴，才不会流出来？", line: "正确滴眼四步走。",
          type: "steps", layoutMode: "explain", chapterIndex: 1,
          takeaway: "一次一滴就够，多滴也会流走",
          points: tkPoints.map((p) => ({ title: p.title, desc: p.detail })),
        }],
      },
      shots: [{
        kind: "scene", visual: "steps", motion: "flow", motif: "dropper", tone: "primary",
        name: "正确滴眼步骤", line: "正确滴眼四步走。", items: tkPoints,
        takeaway: "一次一滴就够，多滴也会流走", start: 0, end: 12,
        captions: [
          { start: 0, end: 3, text: "先洗手摇匀瓶口别碰眼睛", focus: "0" },
          { start: 3, end: 6, text: "头稍微后仰把药液滴进下眼睑", focus: "1" },
          { start: 6, end: 9, text: "记住这四个关键步骤", focus: "all" },
          { start: 9, end: 12, text: "一次一滴就够多滴也会流走", focus: "outro" },
        ],
      }],
      images: { "/assets/template-doctor-digital.jpg": digitalAvatar },
    };
    await page.evaluate((p) => window.setPlan(p), tkPlan);

    const expectedFocus = {
      "0": { t: 1.5, states: ["on", "todo", "todo", "todo"], icons: ["1", "2", "3", "4"] },
      "1": { t: 4.5, states: ["done", "on", "todo", "todo"], icons: ["✓", "2", "3", "4"] },
      "all": { t: 7.5, states: ["normal", "normal", "normal", "normal"], icons: ["1", "2", "3", "4"] },
      "outro": { t: 10.5, states: ["done", "done", "done", "done"], icons: ["✓", "✓", "✓", "✓"] },
    };
    for (const [focusKey, spec] of Object.entries(expectedFocus)) {
      await page.evaluate((time) => window.drawFrame(time), spec.t);
      const actual = await page.evaluate(() =>
        [...document.querySelectorAll(".pt-kp-item")].map((el) => ({
          state: el.classList.contains("done") ? "done" : el.classList.contains("on") ? "on" : el.classList.contains("todo") ? "todo" : "normal",
          icon: el.querySelector("i")?.textContent?.trim() || "",
        })),
      );
      result.takeawayFocus[focusKey] = actual;
      const gotStates = actual.map((a) => a.state);
      const gotIcons = actual.map((a) => a.icon);
      if (JSON.stringify(gotStates) !== JSON.stringify(spec.states) || JSON.stringify(gotIcons) !== JSON.stringify(spec.icons)) {
        throw new Error(`Takeaway focus=${focusKey} mismatch: expected ${JSON.stringify(spec)}, got ${JSON.stringify(actual)}`);
      }
      await page.screenshot({ path: path.join(OUT_DIR, `takeaway-focus-${focusKey}.png`) });
    }

    // === Workbench UI check: conditional editor fields for qa-chat, headline, takeaway, broadcast ===
    const port = 18793;
    const srv = startSandboxedServer(port, path.join(tmpDir, "srv"));
    try {
      await waitForServer(`http://127.0.0.1:${port}/api/config`);
      const uiPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      uiPage.on("pageerror", (e) => result.pageErrors.push(`ui: ${e.message}`));
      await uiPage.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });

      // Create a stage work directly in localStorage & open it in editor
      await uiPage.evaluate(() => {
        const work = {
          id: "w-h3-test",
          type: "video",
          videoMode: "template",
          templateContent: "code-motion",
          templateTheme: "medical",
          templatePresenter: "digital",
          title: "降压药漏服怎么补？",
          topic: "降压药漏服了要不要补",
          drug: "硝苯地平缓释片",
          stage: "script",
          viewingSetup: false,
          editing: false,
          settings: { ratio: "16:9", duration: 30, voice: "无配音", music: "off" },
          blocks: [],
          stagePlan: {
            layout: { id: "builtin:layout/qa-chat" },
            themeId: "builtin:theme/medical",
            mode: "mix",
            imageBudget: 0,
            audio: { sfx: { pack: "off", gainDb: -14 } },
            shortTitle: "降压药漏服",
            drugTags: ["缓释片", "处方药"],
            chapters: ["先判断时间", "补还是不补"],
            disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
            shots: [{
              name: "别吃双倍",
              line: "漏服降压药千万不要一次吃两片补回来。",
              seconds: 5,
              chapterIndex: 0,
              points: {
                type: "explain",
                headline: "漏服了，也只吃一次",
                accentPhrase: "也只吃一次",
                lead: "每次都只吃平时的常规剂量。",
                question: "昨天忘吃降压药今天吃两片行吗？",
                answer: "不行，只吃常规剂量",
                verdictTone: "no",
                takeaway: "漏服绝不加倍补",
                items: [{ title: "按常规剂量补", detail: "", tag: "" }],
                highlightWords: ["常规剂量"],
              },
              cues: [{ text: "漏服降压药千万不要一次吃两片补回来", focus: "0", weight: 18, highlightWords: [] }],
              content: { kind: "scene", visual: "mechanism", motion: "reveal", motif: "pill", tone: "primary" },
              variants: {},
            }],
          },
        };
        const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
        raw.works = [work, ...(raw.works || []).filter((x) => x.id !== work.id)];
        localStorage.setItem("xixi-studio-v1", JSON.stringify(raw));
      });
      await uiPage.goto(`http://127.0.0.1:${port}/#work/w-h3-test`, { waitUntil: "networkidle" });
      await uiPage.reload({ waitUntil: "networkidle" });
      await uiPage.waitForSelector('[data-stage-field="point-question"]');
      await uiPage.waitForTimeout(400);

      // Edit QA fields & verify preview updates
      await uiPage.fill('[data-stage-field="point-answer"]', "不能加倍吃药");
      await uiPage.selectOption('[data-stage-field="point-verdictTone"]', "warn");
      await uiPage.waitForTimeout(450);
      const qaVerdict = await uiPage.evaluate(() => {
        const ifr = document.querySelector("#stage-preview");
        const el = ifr?.contentDocument?.querySelector(".pt-answer-verdict");
        return { text: el?.textContent?.trim(), isWarn: el?.classList.contains("is-warn") };
      });
      if (!qaVerdict.text?.includes("不能加倍吃药") || !qaVerdict.isWarn) {
        throw new Error(`QA editor live preview did not update: ${JSON.stringify(qaVerdict)}`);
      }
      result.editorChecks.qa = qaVerdict;
      await uiPage.screenshot({ path: path.join(OUT_DIR, "editor-qa-fields.png") });

      // Switch to global tab -> edit drugTags & switch layout to headline
      await uiPage.click('[data-action="stage-inspector"][data-val="global"]');
      await uiPage.waitForSelector('[data-stage-field="work-drugTags"]');
      const drugTagsVal = await uiPage.inputValue('[data-stage-field="work-drugTags"]');
      await uiPage.fill('[data-stage-field="work-drugTags"]', "控释片，处方药");
      await uiPage.click('[data-action="stage-layout"][data-val="builtin:layout/headline"]');
      await uiPage.click('[data-action="stage-inspector"][data-val="scene"]');
      await uiPage.waitForSelector('[data-stage-field="point-accentPhrase"]');
      await uiPage.waitForSelector('[data-stage-field="point-lead"]');
      await uiPage.waitForTimeout(400);
      result.editorChecks.headlineFieldsPresent = true;
      result.editorChecks.drugTagsInitial = drugTagsVal;
      await uiPage.screenshot({ path: path.join(OUT_DIR, "editor-headline-fields.png") });
    } finally {
      srv.kill("SIGTERM");
    }

    if (result.pageErrors.length) throw new Error(`Page errors: ${result.pageErrors.join("; ")}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
