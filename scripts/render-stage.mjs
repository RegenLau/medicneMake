import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [manifestPath, output] = process.argv.slice(2);
const plan = JSON.parse(await readFile(manifestPath, "utf8"));
const { fps, frames } = plan;
const staticImage = plan.shots.every(shot => shot.kind === "image");
const format = staticImage ? "png" : "jpeg";
const ext = staticImage ? "png" : "jpg";
const dedupeEnabled = process.env.STUDIO_RENDER_DEDUPE !== "0";

function resolveWorkerCount() {
  const envRaw = Number(process.env.STUDIO_RENDER_WORKERS);
  if (Number.isInteger(envRaw) && envRaw >= 1) {
    return Math.min(4, Math.min(envRaw, Math.max(1, frames)));
  }
  if (staticImage || frames < 72) return 1;
  const cpuCap = (os.cpus()?.length || 2) >= 6 ? 3 : 2;
  return Math.max(1, Math.min(cpuCap, Math.floor(frames / 48)));
}

const workerCount = resolveWorkerCount();
const stageUrl = new URL("../public/stage.html", import.meta.url).href;
const region = { clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 }, captureBeyondViewport: false };
const options = { ...region, format, ...(format === "jpeg" ? { quality: 96 } : {}) };
const posterFrame = Math.min(frames - 1, Math.round(fps * 1.4));
const startedAt = Date.now();

async function openStagePage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route(/^https?:/, route => route.abort());
  await page.goto(stageUrl);
  await page.evaluate(input => setPlan(input), plan);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

async function renderRange(browser, startFrame, endFrame, { collectEvents = false } = {}) {
  const { context, page, cdp } = await openStagePage(browser);
  const runs = [];
  let signature = null;
  let imageWrite = Promise.resolve();
  let posterWrite = Promise.resolve();
  let events = null;
  try {
    for (let frame = startFrame; frame < endFrame; frame++) {
      const avatar = plan.hasAvatarFrames
        ? pathToFileURL(join(output, `avatar-${String(frame).padStart(5, "0")}.jpg`)).href
        : null;
      const next = await page.evaluate(async ({ time, avatar, signature, dedupeEnabled }) => {
        const key = dedupeEnabled ? frameSignature(time) : null;
        if (dedupeEnabled && key !== null && key === signature) {
          return { key, reused: true, snapshot: globalThis.stageCaptureMarkup ?? null };
        }
        await drawFrame(time, avatar);
        await Promise.all([...document.images].map(async image => {
          if (!image.complete) await image.decode();
          if (!image.naturalWidth) throw Error("分镜素材未加载。");
        }));
        void document.body.offsetWidth;
        if (!dedupeEnabled) {
          globalThis.stageCaptureMarkup = null;
          return { key: null, reused: false, snapshot: null };
        }
        // Compute a pixel-safe DOM snapshot covering both light DOM and custom Shadow DOM hosts.
        // Fall back to no dedupe if a <canvas> or active CSS/Web Animation exists inside any host.
        const stageRoot = document.querySelector("#stage-frame");
        let canDedupe = !stageRoot.querySelector("canvas");
        let shadowSnapshot = "";
        if (canDedupe) {
          const hosts = stageRoot.querySelectorAll("[data-custom-code-host]");
          for (const host of hosts) {
            const sr = host.shadowRoot;
            if (!sr || sr.querySelector("canvas")) {
              canDedupe = false;
              break;
            }
            if (typeof sr.getAnimations === "function" && sr.getAnimations().length > 0) {
              canDedupe = false;
              break;
            }
            shadowSnapshot += "\u0000" + sr.innerHTML;
          }
        }
        const snapshot = canDedupe ? (stageRoot.innerHTML + shadowSnapshot) : null;
        const reused = Boolean(canDedupe && snapshot !== null && snapshot === globalThis.stageCaptureMarkup);
        globalThis.stageCaptureMarkup = snapshot;
        return { key, reused, snapshot };
      }, { time: frame / fps, avatar, signature, dedupeEnabled });

      signature = next.key;
      let capturedData = null;
      if (next.reused && runs.length > 0) {
        runs.at(-1).frames++;
      } else {
        const filename = `frame-${String(frame).padStart(5, "0")}.${ext}`;
        const { data } = await cdp.send("Page.captureScreenshot", options);
        capturedData = data;
        await imageWrite;
        imageWrite = writeFile(join(output, filename), data, "base64");
        runs.push({ filename, frames: 1, snapshot: next.snapshot });
      }
      if (frame === posterFrame) {
        if (capturedData && format === "jpeg") {
          posterWrite = writeFile(join(output, "poster.jpg"), capturedData, "base64");
        } else {
          const { data } = await cdp.send("Page.captureScreenshot", { ...region, format: "jpeg", quality: 96 });
          posterWrite = writeFile(join(output, "poster.jpg"), data, "base64");
        }
      }
    }
    await Promise.all([imageWrite, posterWrite]);
    if (collectEvents) {
      events = await page.evaluate(() => collectStageEvents());
    }
    return { runs, events };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const ranges = [];
  const baseSize = Math.floor(frames / workerCount);
  const remainder = frames % workerCount;
  let cursor = 0;
  for (let i = 0; i < workerCount; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    if (size > 0) {
      ranges.push([cursor, cursor + size]);
      cursor += size;
    }
  }
  const results = await Promise.all(
    ranges.map(([start, end], idx) => renderRange(browser, start, end, { collectEvents: idx === 0 })),
  );

  // Merge shard runs in order, coalescing identical snapshots across shard boundaries.
  const runs = [];
  for (const res of results) {
    for (const run of res.runs) {
      const prev = runs.at(-1);
      if (prev && prev.snapshot && run.snapshot && prev.snapshot === run.snapshot) {
        prev.frames += run.frames;
      } else {
        runs.push({ filename: run.filename, frames: run.frames, snapshot: run.snapshot });
      }
    }
  }

  const concatEntry = filename => `file '${filename}'\noption framerate ${fps}\n`;
  const list = runs.map(run => concatEntry(run.filename) + `duration ${(run.frames / fps).toFixed(9)}\n`).join("");
  await writeFile(join(output, "frames.txt"), "ffconcat version 1.0\n" + list + concatEntry(runs.at(-1).filename));
  await writeFile(join(output, "events.json"), JSON.stringify(results[0]?.events || []));
  const elapsedMs = Date.now() - startedAt;
  await writeFile(
    join(output, "capture-stats.json"),
    JSON.stringify({
      frames,
      captures: runs.length,
      reused: Math.max(0, frames - runs.length),
      workers: ranges.length,
      elapsedMs,
    }),
  );
} finally {
  await browser.close();
}
