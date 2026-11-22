// Verify Item 5: Shadow DOM static hold-frame deduplication + multi-page parallel sharding in scripts/render-stage.mjs.
// Compares Baseline (1 worker, dedupe OFF) vs Optimized (parallel workers, Shadow DOM dedupe ON) for:
// 1. Exact frame-count integrity & FFmpeg concat validity
// 2. Significant capture reduction on GSAP scenes/SVGs with reading hold windows
// 3. Pixel-exact visual parity at sampled frames (entrance, mid-motion, transition, hold, SVG DrawSVG/MotionPath)
// 4. Conservative no-dedupe fallback when a custom shot contains <canvas>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const layout = JSON.parse(await readFile(join(root, "public/assets/library/layouts/info-classic.json"), "utf8"));

const plan = {
  fps: 24,
  frames: 192, // 8 seconds (2 shots x 4s): fast entrance + ~2.5s reading hold each -> huge dedupe win!
  layout,
  deck: {
    title: "渲染性能与像素一致验收",
    shortTitle: "性能验收",
    theme: "medical",
    presenter: "none",
    chapters: ["代码动效", "矢量动画"],
    disclaimer: "仅供参考",
    slides: [
      { name: "第一幕", line: "入场动效完成后保持稳定停留便于阅读。", chapterIndex: 0, type: "explain", layoutMode: "explain" },
      { name: "第二幕", line: "路径描边完成后稳态收尾。", chapterIndex: 1, type: "explain", layoutMode: "explain" },
    ],
  },
  shots: [
    {
      kind: "scene",
      start: 0,
      end: 4.0,
      name: "第一幕",
      line: "入场动效完成后保持稳定停留便于阅读。",
      captions: [{ start: 0, end: 4.0, text: "入场动效完成后保持稳定停留便于阅读。", focus: "all" }],
      code: {
        html: `<div class="mc-canvas">
          <div class="mc-head"><h2 class="mc-title">核对剂型与剂量</h2><span class="mc-icon-badge" data-icon="pill"></span></div>
          <div class="mc-body"><div class="mc-grid-2">
            <div class="mc-card is-ok"><h3 class="mc-card-title">对剂型</h3><p class="mc-card-desc">整片吞服不掰开</p></div>
            <div class="mc-card is-soft"><h3 class="mc-card-title">对剂量</h3><p class="mc-card-desc">按说明书和医嘱</p></div>
          </div></div>
          <div class="mc-pill"><span class="mc-icon" data-icon="doctor"></span><span>有疑问先问药师</span></div>
        </div>`,
        css: "",
        js: `api.setup((tl) => {
          tl.from('.mc-head', { y: -16, opacity: 0, duration: 0.4, ease: 'power3.out' }, 0.05)
            .from('.mc-card', { y: 24, opacity: 0, stagger: 0.14, duration: 0.45, ease: 'power3.out' }, 0.25)
            .from('.mc-pill', { scale: 0.92, opacity: 0, duration: 0.35, ease: 'back.out(1.4)' }, 0.8);
        });`,
      },
    },
    {
      kind: "svg",
      start: 4.0,
      end: 8.0,
      name: "第二幕",
      line: "路径描边完成后稳态收尾。",
      captions: [{ start: 4.0, end: 8.0, text: "路径描边完成后稳态收尾。", focus: "all" }],
      svgCode: {
        svg: `<svg viewBox="0 0 960 540" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="960" height="540" fill="var(--v-card-bg)"/>
          <path id="arc" d="M 140 340 Q 480 100 820 340" fill="none" stroke="var(--v-primary)" stroke-width="8" stroke-linecap="round"/>
          <circle id="dot" cx="140" cy="340" r="18" fill="var(--v-coral)"/>
          <g data-icon="shield" transform="translate(432, 220) scale(4)" color="var(--v-green)"></g>
        </svg>`,
        css: "",
        js: `api.setup((tl) => {
          tl.fromTo('#arc', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.9, ease: 'power2.inOut' }, 0.1)
            .to('#dot', { motionPath: { path: '#arc', align: '#arc', alignOrigin: [0.5, 0.5] }, duration: 0.9, ease: 'power2.inOut' }, 0.1);
        });`,
      },
    },
  ],
};

function resolveFrameAt(framesTxt, fps, frameIndex) {
  const lines = framesTxt.split(/\r?\n/);
  const runs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^file '([^']+)'$/.exec(lines[i]);
    if (!m) continue;
    let dur = 0;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const dm = /^duration ([0-9.]+)$/.exec(lines[j]);
      if (dm) {
        dur = Number(dm[1]);
        break;
      }
    }
    if (dur > 0) runs.push({ filename: m[1], frames: Math.round(dur * fps) });
  }
  let cursor = 0;
  for (const run of runs) {
    if (frameIndex < cursor + run.frames) return run.filename;
    cursor += run.frames;
  }
  return runs.at(-1)?.filename;
}

const tmpBase = await mkdtemp(join(tmpdir(), "render-stage-perf-"));
const dirBase = join(tmpBase, "baseline");
const dirOpt = join(tmpBase, "optimized");
const dirCanvas = join(tmpBase, "canvas");
const { mkdir } = await import("node:fs/promises");
await Promise.all([mkdir(dirBase), mkdir(dirOpt), mkdir(dirCanvas)]);

try {
  const manifestPath = join(tmpBase, "plan.json");
  await writeFile(manifestPath, JSON.stringify(plan), "utf8");

  // 1. Baseline: 1 worker, dedupe OFF
  await execFileAsync(process.execPath, [join(root, "scripts/render-stage.mjs"), manifestPath, dirBase], {
    cwd: root,
    env: { ...process.env, STUDIO_RENDER_WORKERS: "1", STUDIO_RENDER_DEDUPE: "0" },
    timeout: 90000,
  });
  const baseStats = JSON.parse(await readFile(join(dirBase, "capture-stats.json"), "utf8"));
  assert.equal(baseStats.frames, 192);
  assert.equal(baseStats.captures, 192);

  // 2. Optimized: parallel workers + Shadow DOM dedupe ON
  await execFileAsync(process.execPath, [join(root, "scripts/render-stage.mjs"), manifestPath, dirOpt], {
    cwd: root,
    env: { ...process.env, STUDIO_RENDER_WORKERS: "3", STUDIO_RENDER_DEDUPE: "1" },
    timeout: 90000,
  });
  const optStats = JSON.parse(await readFile(join(dirOpt, "capture-stats.json"), "utf8"));
  assert.equal(optStats.frames, 192);
  assert.equal(optStats.workers, 3);
  assert.ok(optStats.captures < 90, `Shadow DOM dedupe should skip >50% hold frames, got ${optStats.captures}/192`);
  assert.equal(optStats.reused, 192 - optStats.captures);

  // Verify ffconcat total duration equals exact 8.000s (192 frames)
  const optFramesTxt = await readFile(join(dirOpt, "frames.txt"), "utf8");
  const baseFramesTxt = await readFile(join(dirBase, "frames.txt"), "utf8");
  const totalDur = [...optFramesTxt.matchAll(/^duration ([0-9.]+)$/gm)].reduce((acc, m) => acc + Number(m[1]), 0);
  assert.ok(Math.abs(totalDur - 8.0) < 0.001, `Expected exact 8.0s concat duration, got ${totalDur}`);

  // Verify byte-for-byte JPEG parity at key frames: start, active motion, hold phase, transition, SVG motion, SVG hold!
  for (const frameIdx of [0, 12, 48, 95, 98, 110, 160, 191]) {
    const fBase = resolveFrameAt(baseFramesTxt, 24, frameIdx);
    const fOpt = resolveFrameAt(optFramesTxt, 24, frameIdx);
    const bufBase = await readFile(join(dirBase, fBase));
    const bufOpt = await readFile(join(dirOpt, fOpt));
    assert.ok(bufBase.equals(bufOpt), `Frame ${frameIdx} pixels diverged between baseline (${fBase}) and optimized (${fOpt})`);
  }

  // Verify poster.jpg parity & events.json parity
  const posterBase = await readFile(join(dirBase, "poster.jpg"));
  const posterOpt = await readFile(join(dirOpt, "poster.jpg"));
  assert.ok(posterBase.equals(posterOpt), "poster.jpg must be identical");
  const eventsBase = await readFile(join(dirBase, "events.json"), "utf8");
  const eventsOpt = await readFile(join(dirOpt, "events.json"), "utf8");
  assert.equal(eventsBase, eventsOpt, "events.json must be identical");

  // 3. Conservative fallback: custom shot with <canvas> must NOT falsely deduplicate!
  const canvasPlan = {
    ...plan,
    frames: 12,
    shots: [{
      kind: "scene",
      start: 0,
      end: 0.5,
      name: "画布测试",
      line: "画布绘制",
      captions: [{ start: 0, end: 0.5, text: "画布绘制", focus: "all" }],
      code: {
        html: `<canvas id="cv" width="200" height="100"></canvas>`,
        css: "",
        js: `const c = root.querySelector('#cv'); const g = c.getContext('2d'); g.clearRect(0,0,200,100); g.fillRect(t * 200, 20, 40, 40);`,
      },
    }],
  };
  canvasPlan.deck = { ...plan.deck, slides: [plan.deck.slides[0]] };
  const canvasManifest = join(tmpBase, "canvas.json");
  await writeFile(canvasManifest, JSON.stringify(canvasPlan), "utf8");
  await execFileAsync(process.execPath, [join(root, "scripts/render-stage.mjs"), canvasManifest, dirCanvas], {
    cwd: root,
    env: { ...process.env, STUDIO_RENDER_WORKERS: "1", STUDIO_RENDER_DEDUPE: "1" },
    timeout: 60000,
  });
  const canvasStats = JSON.parse(await readFile(join(dirCanvas, "capture-stats.json"), "utf8"));
  assert.equal(canvasStats.captures, 12, `<canvas> shot must capture all 12 frames without false dedupe, got ${canvasStats.captures}`);

  const speedup = (baseStats.elapsedMs / Math.max(1, optStats.elapsedMs)).toFixed(2);
  console.log(
    `PASS: test_render_stage_perf.mjs | baseline: ${baseStats.captures}/${baseStats.frames} frames in ${baseStats.elapsedMs}ms | ` +
    `optimized (${optStats.workers} workers + Shadow DOM dedupe): ${optStats.captures}/${optStats.frames} frames in ${optStats.elapsedMs}ms (${speedup}x faster, 0 pixel diff)`,
  );
} finally {
  await rm(tmpBase, { recursive: true, force: true });
}
