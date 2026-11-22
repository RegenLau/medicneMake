// Real headless Chrome verification for scripts/check-custom-motion.mjs:
// Proves it catches Screenshot-1-style icon occlusion & line-cut, boundary overflow, runtime errors,
// blank screens, and dynamic rendered text extraction, while passing clean GSAP scenes with 0 false positives.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const layout = JSON.parse(await readFile(join(root, "public/assets/library/layouts/info-classic.json"), "utf8"));

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
      try {
        resolvePromise(JSON.parse(out));
      } catch (e) {
        rejectPromise(new Error(`Invalid JSON output: ${out}\nstderr: ${err}`));
      }
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}

// Case 1: Real broken SVG from Screenshot 1 ('?' circle covering '有', horizontal line cutting '氨基酚').
const brokenSvgReport = await runQa({
  kind: "svg",
  layout,
  duration: 6,
  shot: { name: "收尾", line: "记住：看清剂型，剂量和间隔按说明书和医嘱。拿不准就问药师。" },
  payload: {
    svg: `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="960" height="540" fill="var(--v-card-bg)"/>
      <g id="pill">
        <rect x="130" y="200" width="170" height="250" rx="85" fill="var(--v-primary)"/>
        <line x1="130" y1="325" x2="300" y2="325" stroke="var(--v-card-bg)" stroke-width="4" opacity="0.9"/>
        <text x="215" y="295" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-card-bg)" text-anchor="middle">对乙酰</text>
        <text x="215" y="322" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-card-bg)" text-anchor="middle">氨基酚</text>
      </g>
      <g id="ask">
        <rect x="560" y="440" width="340" height="70" rx="35" fill="var(--v-primary)"/>
        <circle cx="605" cy="475" r="20" fill="var(--v-card-bg)"/>
        <text x="605" y="482" font-family="sans-serif" font-size="20" font-weight="700" fill="var(--v-primary)" text-anchor="middle">?</text>
        <text x="690" y="483" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-card-bg)" text-anchor="middle">有疑问先问药师</text>
      </g>
    </svg>`,
    css: "",
    js: "",
  },
});
assert.equal(brokenSvgReport.ok, false, "Screenshot-1 broken SVG must fail visual QA");
assert.ok(
  brokenSvgReport.layoutIssues.some((m) => m.includes("有疑问先问药师") && m.includes("遮挡")),
  `Expected '?' circle occlusion warning on 有疑问先问药师, got: ${JSON.stringify(brokenSvgReport.layoutIssues)}`,
);
assert.ok(
  brokenSvgReport.layoutIssues.some((m) => m.includes("氨基酚") && m.includes("线条压住")),
  `Expected divider line cut warning on 氨基酚, got: ${JSON.stringify(brokenSvgReport.layoutIssues)}`,
);

// Case 2: Boundary overflow & text-vs-text overlap in HTML scene.
const overflowSceneReport = await runQa({
  kind: "scene",
  layout,
  duration: 5,
  shot: { name: "溢出测试", line: "测试文字越界与重叠" },
  payload: {
    html: `<div class="s">
      <div class="clip" style="position:absolute;left:880px;top:40px;white-space:nowrap;font-size:28px;">这段文字会明显超出内容区右边界</div>
      <div style="position:absolute;left:100px;top:200px;font-size:28px;">第一行重叠文字</div>
      <div style="position:absolute;left:110px;top:205px;font-size:28px;">第二行重叠文字</div>
    </div>`,
    css: `.s{position:relative;width:100%;height:100%;}`,
    js: "",
  },
});
assert.equal(overflowSceneReport.ok, false);
assert.ok(
  overflowSceneReport.layoutIssues.some((m) => m.includes("超出内容区")),
  `Expected overflow issue, got: ${JSON.stringify(overflowSceneReport.layoutIssues)}`,
);
assert.ok(
  overflowSceneReport.layoutIssues.some((m) => m.includes("发生重叠")),
  `Expected text overlap issue, got: ${JSON.stringify(overflowSceneReport.layoutIssues)}`,
);

// Case 3: Runtime JS error inside api.setup -> fatal issue.
const runtimeErrReport = await runQa({
  kind: "scene",
  layout,
  duration: 4,
  shot: { name: "报错测试", line: "测试报错" },
  payload: {
    html: `<div class="x">hello</div>`,
    css: "",
    js: `api.setup(() => { nonExistentSymbol.boom(); });`,
  },
});
assert.equal(runtimeErrReport.ok, false);
assert.ok(
  runtimeErrReport.fatalIssues.some((m) => m.includes("运行期错误")),
  `Expected fatal runtime error, got: ${JSON.stringify(runtimeErrReport)}`,
);

// Case 4: Blank screen (stuck opacity:0) -> fatal issue.
const blankReport = await runQa({
  kind: "scene",
  layout,
  duration: 4,
  shot: { name: "空屏测试", line: "测试空屏" },
  payload: {
    html: `<div style="opacity:0;padding:40px;">看不见的内容</div>`,
    css: "",
    js: "",
  },
});
assert.equal(blankReport.ok, false);
assert.ok(
  blankReport.fatalIssues.some((m) => m.includes("空白")),
  `Expected blank screen fatal issue, got: ${JSON.stringify(blankReport)}`,
);

// Case 5: Dynamic JS counter text extraction (catches fabricated numbers generated at runtime).
const dynamicCounterReport = await runQa({
  kind: "scene",
  layout,
  duration: 4,
  shot: { name: "动态数字", line: "按说明书核对剂量" },
  payload: {
    html: `<div class="wrap"><div class="val">0</div></div>`,
    css: `.wrap{display:grid;place-items:center;width:100%;height:100%;font-size:48px;color:var(--v-primary);}`,
    js: `api.setup((tl) => { const o = { v: 0 }; const el = root.querySelector('.val'); tl.to(o, { v: 500, duration: 2, onUpdate() { if (el) el.textContent = Math.round(o.v) + 'mg'; } }, 0); });`,
  },
});
assert.ok(
  dynamicCounterReport.renderedTexts.some((t) => t.includes("500mg")),
  `Expected renderedTexts to capture dynamic 500mg, got: ${JSON.stringify(dynamicCounterReport.renderedTexts)}`,
);

// Case 6: Clean, well-spaced GSAP Scene & SVG -> ZERO false positives!
const cleanSceneReport = await runQa({
  kind: "scene",
  layout,
  duration: 5,
  shot: { name: "安全用药", line: "核对剂型与剂量，拿不准问药师。" },
  payload: {
    html: `<div class="sc">
      <div class="head"><span class="bar"></span><h2>安全用药两步走</h2></div>
      <div class="grid">
        <div class="card"><strong>01 对剂型</strong><p>片剂需能整片吞服</p></div>
        <div class="card"><strong>02 对剂量</strong><p>按说明书和医嘱核对</p></div>
      </div>
      <div class="badge">有疑问先问药师</div>
    </div>`,
    css: `.sc{display:flex;flex-direction:column;justify-content:center;gap:20px;padding:36px 44px;width:100%;height:100%;background:var(--v-card-bg);}
      .head{display:flex;align-items:center;gap:12px;}
      .bar{width:8px;height:30px;border-radius:4px;background:var(--v-primary);}
      h2{margin:0;font-size:28px;color:var(--v-ink);}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
      .card{padding:22px;border-radius:16px;background:var(--v-primary-soft);border:1px solid var(--v-card-border);}
      .card strong{display:block;font-size:22px;color:var(--v-primary);margin-bottom:8px;}
      .card p{margin:0;font-size:18px;color:var(--v-ink-soft);}
      .badge{align-self:flex-start;padding:10px 24px;border-radius:99px;background:var(--v-primary);color:#fff;font-size:18px;font-weight:700;}`,
    js: `api.setup((tl) => {
      tl.from('.head', { y: -16, opacity: 0, duration: 0.4, ease: 'power3.out' }, 0)
        .from('.card', { y: 24, opacity: 0, stagger: 0.15, duration: 0.45, ease: 'power3.out' }, 0.25)
        .from('.badge', { scale: 0.9, opacity: 0, duration: 0.4, ease: 'back.out(1.4)' }, 0.7);
    });`,
  },
});
assert.equal(cleanSceneReport.ok, true, `Clean GSAP scene should pass with 0 issues, got: ${JSON.stringify(cleanSceneReport)}`);

const cleanSvgReport = await runQa({
  kind: "svg",
  layout,
  duration: 5,
  shot: { name: "核对清单", line: "对剂型、对剂量，有疑问先问药师。" },
  payload: {
    svg: `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="960" height="540" fill="var(--v-card-bg)"/>
      <rect x="80" y="120" width="340" height="110" rx="18" fill="var(--v-primary-soft)" stroke="var(--v-card-border)" stroke-width="2"/>
      <circle cx="130" cy="175" r="22" fill="var(--v-green)"/>
      <path id="chk" d="M120 175 L127 183 L142 167" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="172" y="168" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-ink)">对剂型</text>
      <text x="172" y="198" font-family="sans-serif" font-size="16" fill="var(--v-ink-soft)">片剂需能整片吞服</text>
      <rect x="520" y="420" width="360" height="68" rx="34" fill="var(--v-primary)"/>
      <circle cx="566" cy="454" r="20" fill="var(--v-card-bg)"/>
      <text x="566" y="461" font-family="sans-serif" font-size="20" font-weight="700" fill="var(--v-primary)" text-anchor="middle">?</text>
      <text x="610" y="462" font-family="sans-serif" font-size="22" font-weight="700" fill="var(--v-card-bg)" text-anchor="start">有疑问先问药师</text>
    </svg>`,
    css: "",
    js: `api.setup((tl) => { tl.fromTo('#chk', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: 'power2.out' }, 0.3); });`,
  },
});
assert.equal(cleanSvgReport.ok, true, `Clean GSAP SVG should pass with 0 issues, got: ${JSON.stringify(cleanSvgReport)}`);

console.log("PASS: test_motion_visual_qa.mjs (6/6 cases)");
