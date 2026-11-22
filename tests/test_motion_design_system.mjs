// Verify Item 3: Shadow DOM design kit (.mc-canvas / .mc-card / .mc-icon-badge / .mc-pill),
// automatic 36-icon hydration (<span data-icon> & <g data-icon>), api.icon(), multi-theme support,
// and clean visual QA pass across medical / warm / night themes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const layout = JSON.parse(await readFile(join(root, "public/assets/library/layouts/info-classic.json"), "utf8"));
const themes = [
  JSON.parse(await readFile(join(root, "public/assets/library/themes/medical.json"), "utf8")),
  JSON.parse(await readFile(join(root, "public/assets/library/themes/warm.json"), "utf8")),
  JSON.parse(await readFile(join(root, "public/assets/library/themes/night.json"), "utf8")),
];

function runQa(payload) {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(process.execPath, [join(root, "scripts/check-custom-motion.mjs")], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("error", rejectPromise);
    proc.on("close", (code) => {
      if (code !== 0) return rejectPromise(new Error(`check-custom-motion exited ${code}: ${err}`));
      resolvePromise(JSON.parse(out));
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}

// High-craft summary scene using the new .mc-* design kit + data-icon medical icons + GSAP Motion.md pacing.
const summarySceneCode = {
  html: `<div class="mc-canvas">
    <div class="mc-head">
      <div class="mc-head-main">
        <span class="mc-kicker is-ok"><span class="mc-icon" data-icon="shield"></span>安全收尾</span>
        <h2 class="mc-title">记住两点，安全用对乙酰氨基酚片</h2>
      </div>
      <span class="mc-icon-badge is-lg" data-icon="pill"></span>
    </div>
    <div class="mc-body">
      <div class="mc-grid-2">
        <div class="mc-card is-ok">
          <div class="mc-card-row">
            <span class="mc-icon-badge is-ok" data-icon="check"></span>
            <div>
              <h3 class="mc-card-title">对剂型</h3>
              <p class="mc-card-desc">片剂需能整片吞服</p>
            </div>
          </div>
        </div>
        <div class="mc-card is-soft">
          <div class="mc-card-row">
            <span class="mc-icon-badge is-solid" data-icon="leaflet"></span>
            <div>
              <h3 class="mc-card-title">对剂量</h3>
              <p class="mc-card-desc">剂量和间隔按说明书和医嘱</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="mc-pill"><span class="mc-icon" data-icon="doctor"></span><span>有疑问先问药师</span></div>
  </div>`,
  css: "",
  js: `api.setup((tl) => {
    tl.from('.mc-head', { y: -16, opacity: 0, duration: 0.4, ease: 'power3.out' }, 0.08)
      .from('.mc-card', { y: 24, opacity: 0, stagger: 0.14, duration: 0.45, ease: 'power3.out' }, 0.35)
      .from('.mc-pill', { y: 16, scale: 0.94, opacity: 0, duration: 0.42, ease: 'back.out(1.4)' }, 0.9);
  });`,
};

// Pure SVG shot using <g data-icon="..."> automatic hydration + DrawSVG.
const summarySvgCode = {
  svg: `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="gpat" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="var(--v-card-border)" stroke-width="1" opacity="0.45"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width="960" height="540" fill="var(--v-card-bg)"/>
    <rect x="0" y="0" width="960" height="540" fill="url(#gpat)"/>
    <text x="64" y="84" font-family="sans-serif" font-size="30" font-weight="800" fill="var(--v-ink)">记住两点</text>
    <path id="uline" d="M 64 100 L 210 100" fill="none" stroke="var(--v-primary)" stroke-width="4" stroke-linecap="round"/>
    <g id="card1">
      <rect x="64" y="148" width="460" height="106" rx="18" fill="var(--v-green-soft)" stroke="var(--v-card-border)" stroke-width="1.5"/>
      <circle cx="116" cy="201" r="24" fill="var(--v-green)"/>
      <g data-icon="check" transform="translate(102, 187) scale(1.16)" color="#ffffff"></g>
      <text x="158" y="192" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-ink)">对剂型</text>
      <text x="158" y="224" font-family="sans-serif" font-size="16" fill="var(--v-ink-soft)">片剂需能整片吞服</text>
    </g>
    <g id="card2">
      <rect x="64" y="280" width="460" height="106" rx="18" fill="var(--v-primary-soft)" stroke="var(--v-card-border)" stroke-width="1.5"/>
      <circle cx="116" cy="333" r="24" fill="var(--v-primary)"/>
      <g data-icon="leaflet" transform="translate(102, 319) scale(1.16)" color="#ffffff"></g>
      <text x="158" y="324" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-ink)">对剂量</text>
      <text x="158" y="356" font-family="sans-serif" font-size="16" fill="var(--v-ink-soft)">按说明书和医嘱</text>
    </g>
    <g id="emblem">
      <rect x="576" y="148" width="316" height="238" rx="22" fill="var(--v-primary-soft)" stroke="var(--v-card-border)" stroke-width="1.5"/>
      <g data-icon="shield" transform="translate(682, 186) scale(4.3)" color="var(--v-primary)"></g>
      <text x="734" y="344" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="var(--v-primary-deep)">核对清楚再服药</text>
    </g>
    <g id="pill">
      <rect x="280" y="432" width="400" height="62" rx="31" fill="var(--v-primary)"/>
      <g data-icon="doctor" transform="translate(332, 451) scale(1.0)" color="#ffffff"></g>
      <text x="374" y="471" text-anchor="start" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff">有疑问先问药师</text>
    </g>
  </svg>`,
  css: "",
  js: `api.setup((tl) => {
    tl.fromTo('#uline', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.45, ease: 'power2.inOut' }, 0.1)
      .from('#card1, #card2', { x: -24, opacity: 0, stagger: 0.14, duration: 0.42, ease: 'power3.out' }, 0.3)
      .from('#emblem', { scale: 0.92, opacity: 0, transformOrigin: '50% 50%', duration: 0.48, ease: 'back.out(1.4)' }, 0.6)
      .from('#pill', { y: 18, opacity: 0, duration: 0.4, ease: 'power3.out' }, 0.95);
  });`,
};

// 1. Run real visual QA across medical, warm, and night themes for both scene & svg.
for (const theme of themes) {
  const sceneQa = await runQa({
    kind: "scene",
    layout,
    theme: theme.base,
    themeVars: theme.vars,
    duration: 5,
    shot: { name: "收尾", line: "记住：看清剂型，剂量和间隔按说明书和医嘱。拿不准就问药师。" },
    payload: summarySceneCode,
  });
  assert.equal(sceneQa.ok, true, `Design-kit scene failed QA under theme ${theme.id}: ${JSON.stringify(sceneQa)}`);

  const svgQa = await runQa({
    kind: "svg",
    layout,
    theme: theme.base,
    themeVars: theme.vars,
    duration: 5,
    shot: { name: "收尾", line: "记住：看清剂型，剂量和间隔按说明书和医嘱。拿不准就问药师。" },
    payload: summarySvgCode,
  });
  assert.equal(svgQa.ok, true, `Data-icon SVG failed QA under theme ${theme.id}: ${JSON.stringify(svgQa)}`);
}

// 2. Verify DOM icon hydration & api.icon() / api.icons in live stage.html.
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto(pathToFileURL(join(root, "public/stage.html")).href);
  const check = await page.evaluate(async ({ layout, summarySceneCode, summarySvgCode }) => {
    await setPlan({
      fps: 24,
      frames: 48,
      layout,
      deck: {
        title: "图标注入验证", shortTitle: "图标验证", theme: "medical", presenter: "none",
        chapters: ["测试"], disclaimer: "",
        slides: [
          { name: "场景", line: "场景", chapterIndex: 0, type: "explain", layoutMode: "explain" },
          { name: "矢量", line: "矢量", chapterIndex: 0, type: "explain", layoutMode: "explain" },
        ],
      },
      shots: [
        { kind: "scene", start: 0, end: 1, name: "场景", line: "场景", captions: [{ start: 0, end: 1, text: "场景", focus: "all" }], code: {
          ...summarySceneCode,
          js: `window.__apiIconsCount = Array.isArray(api.icons) ? api.icons.length : 0; window.__apiIconSvg = api.icon('shield'); ${summarySceneCode.js}`,
        }},
        { kind: "svg", start: 1, end: 2, name: "矢量", line: "矢量", captions: [{ start: 1, end: 2, text: "矢量", focus: "all" }], svgCode: summarySvgCode },
      ],
      images: {},
    });
    drawFrame(0.8);
    const sceneSr = document.querySelector(".media-slot [data-custom-code-host]")?.shadowRoot;
    const htmlIcons = [...sceneSr.querySelectorAll("[data-icon] svg")].length;
    const canvasBg = getComputedStyle(sceneSr.querySelector(".mc-canvas")).backgroundImage;
    drawFrame(1.8);
    const svgSr = document.querySelector(".media-slot [data-custom-code-host]")?.shadowRoot;
    const svgIconChildren = [...svgSr.querySelectorAll("g[data-icon]")].map((g) => g.children.length);
    return {
      apiIconsCount: window.__apiIconsCount,
      hasApiIconSvg: String(window.__apiIconSvg || "").includes("<svg"),
      htmlIcons,
      hasDotSurface: canvasBg.includes("radial-gradient"),
      svgIconChildren,
    };
  }, { layout, summarySceneCode, summarySvgCode });

  assert.equal(check.apiIconsCount, 36, `Expected 36 icons, got ${check.apiIconsCount}`);
  assert.equal(check.hasApiIconSvg, true, "api.icon('shield') should return SVG markup");
  assert.equal(check.htmlIcons, 5, `Expected 5 hydrated HTML data-icon SVGs, got ${check.htmlIcons}`);
  assert.equal(check.hasDotSurface, true, ".mc-canvas should render dot-grid/glow surface");
  assert.ok(check.svgIconChildren.length === 4 && check.svgIconChildren.every((n) => n >= 1),
    `Expected all 4 <g data-icon> elements to hydrate SVG children, got ${JSON.stringify(check.svgIconChildren)}`);
} finally {
  await browser.close();
}

console.log("PASS: test_motion_design_system.mjs (3 themes + 36-icon hydration + visual QA)");
