// Verify offline GSAP + DrawSVG/MotionPath/MorphSVG inside Shadow DOM custom code & SVG shots,
// deterministic seeking/reverse scrubbing, wall-clock immunity, legacy compatibility, and render-stage.mjs offline capture.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const layoutDef = JSON.parse(await readFile(join(root, "public/assets/library/layouts/info-classic.json"), "utf8"));

const plan = {
  fps: 6,
  frames: 24,
  layout: layoutDef,
  deck: {
    title: "GSAP 动效沙盒验收",
    shortTitle: "GSAP 验收",
    theme: "medical",
    presenter: "none",
    chapters: ["代码动效", "矢量动画", "兼容验证"],
    disclaimer: "仅供参考",
    slides: [
      {
        name: "代码动效 GSAP 时间轴",
        line: "分步弹出要点卡片，并同步推进数字计数与连线。",
        chapterIndex: 0,
        type: "explain",
        headline: "代码动效 GSAP 时间轴",
      },
      {
        name: "纯 SVG 矢量插件动效",
        line: "路径描边、沿轨迹移动与图形平滑变形。",
        chapterIndex: 1,
        type: "explain",
        headline: "纯 SVG 矢量插件动效",
      },
      {
        name: "旧版逐帧写法兼容",
        line: "不调用 api.setup 的旧脚本依然正常工作。",
        chapterIndex: 2,
        type: "explain",
        headline: "旧版逐帧写法兼容",
      },
    ],
  },
  shots: [
    {
      kind: "scene",
      start: 0,
      end: 2.0,
      name: "代码动效 GSAP 时间轴",
      line: "分步弹出要点卡片，并同步推进数字计数与连线。",
      captions: [
        { start: 0, end: 1.0, text: "分步弹出要点卡片", focus: "all" },
        { start: 1.0, end: 2.0, text: "同步推进数字计数与连线", focus: "all" },
      ],
      code: {
        html: `<div class="sc">
          <div class="card c1">卡片一</div>
          <div class="card c2">卡片二</div>
          <div class="counter">0.0</div>
          <div class="stray">杂散补间测试</div>
        </div>`,
        css: `.sc{display:flex;flex-direction:column;gap:16px;padding:32px;width:100%;height:100%;background:var(--v-card-bg);}
          .card{padding:16px;border-radius:12px;background:var(--v-primary-soft);color:var(--v-ink);font-size:24px;}
          .counter{font-size:40px;font-weight:700;color:var(--v-primary);}`,
        js: `api.setup((tl, gsap) => {
          const counterEl = root.querySelector('.counter');
          const counter = { v: 0 };
          tl.from('.card', { y: 40, opacity: 0, stagger: 0.25, duration: 0.5, ease: 'power3.out' }, 0)
            .to(counter, {
              v: 38.5,
              duration: 1.0,
              ease: 'none',
              onUpdate() { if (counterEl) counterEl.textContent = counter.v.toFixed(1); },
            }, 0.5);
          // Even an accidental unpaused gsap.to() must be auto-quarantined into paused tl.
          gsap.to('.stray', { x: 200, duration: 1.0, ease: 'none' });
          api.sfx(0.25, 'pop');
          api.sfx(1.5, 'count');
          api.sfx(1.8, 'unknown-ignored');
        });`,
      },
    },
    {
      kind: "svg",
      start: 2.0,
      end: 3.5,
      name: "纯 SVG 矢量插件动效",
      line: "路径描边、沿轨迹移动与图形平滑变形。",
      captions: [{ start: 2.0, end: 3.5, text: "路径描边、沿轨迹移动与图形平滑变形", focus: "all" }],
      svgCode: {
        svg: `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">
          <path id="track" d="M 100 320 Q 400 80 700 320" fill="none" stroke="var(--v-primary)" stroke-width="8" stroke-linecap="round"/>
          <circle id="pill" cx="100" cy="320" r="20" fill="var(--v-coral)"/>
          <path id="morphSrc" d="M 350 220 L 450 220 L 450 320 L 350 320 Z" fill="var(--v-green)"/>
          <path id="morphDst" d="M 400 200 L 460 320 L 340 320 Z" fill="none" opacity="0"/>
        </svg>`,
        css: "",
        js: `api.setup((tl) => {
          tl.fromTo('#track', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0, ease: 'none' }, 0)
            .to('#pill', { motionPath: { path: '#track', align: '#track', alignOrigin: [0.5, 0.5] }, duration: 1.0, ease: 'none' }, 0)
            .to('#morphSrc', { morphSVG: '#morphDst', duration: 1.0, ease: 'none' }, 0);
          api.sfx(0.45, 'draw');
          api.sfx(1.0, 'check');
        });`,
      },
    },
    {
      kind: "scene",
      start: 3.5,
      end: 4.0,
      name: "旧版逐帧写法兼容",
      line: "不调用 api.setup 的旧脚本依然正常工作。",
      captions: [{ start: 3.5, end: 4.0, text: "旧脚本依然正常工作", focus: "all" }],
      code: {
        html: `<div class="legacy">0%</div>`,
        css: `.legacy{display:grid;place-items:center;width:100%;height:100%;font-size:36px;color:var(--v-primary);}`,
        js: `const el = root.querySelector('.legacy'); if (el) el.textContent = Math.round(api.progress * 100) + '%';`,
      },
    },
  ],
};

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  // Strict offline guarantee: abort any http(s) requests just like render-stage.mjs.
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(join(root, "public/stage.html")).href);

  // Add an outer sentinel `.card` outside Shadow DOM to verify GSAP never leaks out of Shadow DOM.
  await page.evaluate(() => {
    const sentinel = document.createElement("div");
    sentinel.className = "card";
    sentinel.id = "outer-sentinel";
    sentinel.style.opacity = "1";
    document.body.append(sentinel);
  });

  await page.evaluate((p) => setPlan(p), plan);

  // 0. Verify collectStageEvents() captures api.sfx() from BOTH custom scene & unmounted custom SVG shots!
  const preMountEvents = await page.evaluate(() => collectStageEvents());
  assert.ok(
    preMountEvents.some((e) => e.shot === 0 && e.type === "item-focus" && Math.abs(e.t - 0.25) < 0.01),
    `Expected shot 0 api.sfx('pop' -> 'item-focus') at t=0.25, got ${JSON.stringify(preMountEvents)}`,
  );
  assert.ok(
    preMountEvents.some((e) => e.shot === 0 && e.type === "count" && Math.abs(e.t - 1.5) < 0.01),
    `Expected shot 0 api.sfx('count') at t=1.5, got ${JSON.stringify(preMountEvents)}`,
  );
  assert.ok(
    preMountEvents.some((e) => e.shot === 1 && e.type === "draw" && Math.abs(e.t - 2.45) < 0.01),
    `Expected unmounted shot 1 api.sfx('draw') at t=2.45, got ${JSON.stringify(preMountEvents)}`,
  );
  assert.ok(
    preMountEvents.some((e) => e.shot === 1 && e.type === "check" && Math.abs(e.t - 3.0) < 0.01),
    `Expected unmounted shot 1 api.sfx('check') at t=3.0, got ${JSON.stringify(preMountEvents)}`,
  );
  assert.ok(
    !preMountEvents.some((e) => e.type === "unknown-ignored"),
    "Unknown api.sfx types must be silently ignored",
  );

  // 1. Test Scene GSAP timeline, reverse scrubbing determinism, counter onUpdate, stray tween quarantine, and Shadow DOM isolation.
  const readScene = () => page.evaluate(() => {
    const host = document.querySelector("[data-custom-code-host]");
    const sr = host?.shadowRoot;
    const c1 = sr?.querySelector(".c1");
    const c2 = sr?.querySelector(".c2");
    const stray = sr?.querySelector(".stray");
    const outer = document.querySelector("#outer-sentinel");
    return {
      c1Opacity: Number(getComputedStyle(c1).opacity),
      c2Opacity: Number(getComputedStyle(c2).opacity),
      counter: sr?.querySelector(".counter")?.textContent,
      strayX: new DOMMatrixReadOnly(getComputedStyle(stray).transform).m41,
      outerOpacity: Number(getComputedStyle(outer).opacity),
    };
  });

  await page.evaluate(() => drawFrame(0.0));
  const s0First = await readScene();
  assert.ok(s0First.c1Opacity < 0.05, `c1 should start hidden at t=0, got ${s0First.c1Opacity}`);
  assert.ok(s0First.c2Opacity < 0.05, `c2 should start hidden at t=0, got ${s0First.c2Opacity}`);
  assert.equal(s0First.counter, "0.0", "counter at t=0");
  assert.ok(Math.abs(s0First.strayX) < 0.5, `quarantined stray tween should be at x=0 at t=0, got ${s0First.strayX}`);
  assert.equal(s0First.outerOpacity, 1, "outer DOM .card must NOT be affected by Shadow DOM GSAP");

  // Wait 600ms wall clock to prove GSAP ticker does NOT drift paused/quarantined animations!
  await page.waitForTimeout(600);
  const s0AfterWait = await readScene();
  assert.deepEqual(s0AfterWait, s0First, "Wall-clock wait must not advance deterministic GSAP frame");

  // Seek forward to t = 1.0 (c1=1, c2=1, counter=50% of 38.5 -> 19.3, strayX=200)
  await page.evaluate(() => drawFrame(1.0));
  const s1First = await readScene();
  assert.ok(s1First.c1Opacity > 0.98, `c1 should be visible at t=1.0, got ${s1First.c1Opacity}`);
  assert.ok(s1First.c2Opacity > 0.98, `c2 should be visible at t=1.0, got ${s1First.c2Opacity}`);
  assert.equal(s1First.counter, "19.3", `counter midpoint at t=1.0 should be 19.3, got ${s1First.counter}`);
  assert.ok(Math.abs(s1First.strayX - 200) < 1, `quarantined stray tween should reach x=200 at t=1.0, got ${s1First.strayX}`);

  // Seek to end t = 1.8, then scrub BACKWARDS to t = 0.0 and t = 1.0 to verify exact determinism.
  await page.evaluate(() => drawFrame(1.8));
  const sEnd = await readScene();
  assert.equal(sEnd.counter, "38.5", `counter final at t=1.8 should be 38.5, got ${sEnd.counter}`);

  await page.evaluate(() => drawFrame(0.0));
  const s0Back = await readScene();
  assert.deepEqual(s0Back, s0First, "Reverse seek to t=0.0 must match initial t=0.0 exactly");

  await page.evaluate(() => drawFrame(1.0));
  const s1Back = await readScene();
  assert.deepEqual(s1Back, s1First, "Forward seek to t=1.0 after reverse scrub must match initial t=1.0 exactly");

  // 2. Test SVG Shot with DrawSVGPlugin, MotionPathPlugin, MorphSVGPlugin inside Shadow DOM.
  const readSvg = () => page.evaluate(() => {
    const sr = document.querySelector(".media-slot [data-custom-code-host]")?.shadowRoot;
    const track = sr?.querySelector("#track");
    const pill = sr?.querySelector("#pill");
    const morph = sr?.querySelector("#morphSrc");
    const pillRect = pill.getBoundingClientRect();
    return {
      dashOffset: parseFloat(getComputedStyle(track).strokeDashoffset || "0"),
      dashArray: getComputedStyle(track).strokeDasharray,
      pillX: Math.round(pillRect.left + pillRect.width / 2),
      pillY: Math.round(pillRect.top + pillRect.height / 2),
      morphD: morph.getAttribute("d"),
    };
  });

  await page.evaluate(() => drawFrame(2.0));
  // During the 0.3s transition at t=2.0, prevLayer should display Shot 1's end state cleanly.
  const prevCounter = await page.evaluate(() =>
    document.querySelector(".stage-prev-slot [data-custom-code-host]")?.shadowRoot?.querySelector(".counter")?.textContent,
  );
  assert.equal(prevCounter, "38.5", "Transition prevLayer should render previous GSAP shot at its end time");
  const svgStart = await readSvg();
  await page.evaluate(() => drawFrame(2.5));
  const svgMid = await readSvg();
  await page.evaluate(() => drawFrame(3.0));
  const svgEnd = await readSvg();

  assert.notEqual(svgStart.dashArray, "none", "DrawSVGPlugin should set strokeDasharray inside Shadow DOM");
  assert.ok(svgEnd.pillX > svgMid.pillX && svgMid.pillX > svgStart.pillX,
    `MotionPathPlugin should move pill left-to-right: start=${svgStart.pillX}, mid=${svgMid.pillX}, end=${svgEnd.pillX}`);
  assert.ok(svgMid.pillY < svgStart.pillY - 40,
    `MotionPathPlugin should follow curved arc upward at midpoint: startY=${svgStart.pillY}, midY=${svgMid.pillY}`);
  assert.notEqual(svgStart.morphD, svgEnd.morphD, "MorphSVGPlugin should morph #morphSrc path d attribute");

  // Scrub back to svgMid and assert exact determinism.
  await page.evaluate(() => drawFrame(2.5));
  const svgMidAgain = await readSvg();
  assert.deepEqual(svgMidAgain, svgMid, "SVG plugins must produce identical state when scrubbing backwards");

  // 3. Test Legacy imperative shot compatibility in same deck.
  await page.evaluate(() => drawFrame(3.75));
  const legacyText = await page.evaluate(() =>
    document.querySelector(".media-slot [data-custom-code-host]")?.shadowRoot?.querySelector(".legacy")?.textContent,
  );
  assert.equal(legacyText, "50%", "Legacy api.progress shot must remain 100% compatible");

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
}

// 4. Test real offline capture via scripts/render-stage.mjs
const tempDir = await mkdtemp(join(tmpdir(), "gsap-stage-render-"));
try {
  const manifestPath = join(tempDir, "plan.json");
  await writeFile(manifestPath, JSON.stringify(plan), "utf8");
  await execFileAsync(process.execPath, [join(root, "scripts/render-stage.mjs"), manifestPath, tempDir], {
    cwd: root,
    timeout: 60000,
  });
  const stats = JSON.parse(await readFile(join(tempDir, "capture-stats.json"), "utf8"));
  assert.equal(stats.frames, 24);
  assert.ok(stats.captures > 0, "Should capture rendered frames");
  const poster = await stat(join(tempDir, "poster.jpg"));
  assert.ok(poster.size > 1000, "poster.jpg should be non-empty");
  const framesList = await readFile(join(tempDir, "frames.txt"), "utf8");
  assert.ok(framesList.includes("ffconcat version 1.0"), "frames.txt should be generated");
  const exportedEvents = JSON.parse(await readFile(join(tempDir, "events.json"), "utf8"));
  assert.ok(
    exportedEvents.some((e) => e.shot === 0 && e.type === "item-focus") &&
    exportedEvents.some((e) => e.shot === 1 && e.type === "check"),
    `render-stage.mjs events.json should contain custom api.sfx events, got ${JSON.stringify(exportedEvents)}`,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("PASS: test_gsap_custom_motion.mjs");
