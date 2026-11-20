import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [manifestPath, output] = process.argv.slice(2);
const plan = JSON.parse(await readFile(manifestPath, "utf8"));
const { fps, frames } = plan;
const staticImage = plan.shots.every(shot => shot.kind === "image");
const format = staticImage ? "png" : "jpeg";
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 15000 });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  await page.route(/^https?:/, route => route.abort());
  await page.goto(new URL("../public/stage.html", import.meta.url).href);
  await page.evaluate(input => setPlan(input), plan);
  const cdp = await page.context().newCDPSession(page);
  const region = { clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 }, captureBeyondViewport: false };
  const options = { ...region, format, ...(format === "jpeg" ? { quality: 96 } : {}) };
  const runs = [];
  const posterFrame = Math.min(frames - 1, Math.round(fps * 1.4));
  let signature = null;
  let imageWrite;
  for (let frame = 0; frame < frames; frame++) {
    const avatar = plan.hasAvatarFrames && pathToFileURL(join(output, `avatar-${String(frame).padStart(5, "0")}.jpg`)).href;
    const next = await page.evaluate(async ({ time, avatar, signature }) => {
      const key = frameSignature(time);
      if (key !== null && key === signature) return { key, reused: true };
      await drawFrame(time, avatar);
      await Promise.all([...document.images].map(async image => {
        if (!image.complete) await image.decode();
        if (!image.naturalWidth) throw Error("分镜素材未加载。");
      }));
      // Stage styles have no time-driven CSS animation. Identical markup and
      // media after drawFrame produce the same pixels even in a moving scene.
      const markup = document.querySelector("#stage-frame").innerHTML;
      const reused = markup === globalThis.stageCaptureMarkup;
      globalThis.stageCaptureMarkup = markup;
      return { key, reused };
    }, { time: frame / fps, avatar, signature });
    signature = next.key;
    if (next.reused) {
      runs.at(-1).frames++;
    } else {
      const filename = `frame-${String(frame).padStart(5, "0")}.${staticImage ? "png" : "jpg"}`;
      const { data } = await cdp.send("Page.captureScreenshot", options);
      await imageWrite;
      imageWrite = writeFile(join(output, filename), data, "base64");
      runs.push({ filename, frames: 1 });
    }
    if (frame === posterFrame) {
      const { data } = await cdp.send("Page.captureScreenshot", { ...region, format: "jpeg", quality: 96 });
      await writeFile(join(output, "poster.jpg"), data, "base64");
    }
  }
  await imageWrite;
  const concatEntry = filename => `file '${filename}'\noption framerate ${fps}\n`;
  const list = runs.map(run => concatEntry(run.filename) + `duration ${(run.frames / fps).toFixed(9)}\n`).join("");
  await writeFile(join(output, "frames.txt"), "ffconcat version 1.0\n" + list + concatEntry(runs.at(-1).filename));
  const events = await page.evaluate(() => collectStageEvents());
  await writeFile(join(output, "events.json"), JSON.stringify(events));
  await writeFile(join(output, "capture-stats.json"), JSON.stringify({ frames, captures: runs.length }));
} finally {
  await browser.close();
}
