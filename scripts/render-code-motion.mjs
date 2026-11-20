import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const [manifestPath, output] = process.argv.slice(2);
const plan = JSON.parse(await readFile(manifestPath, "utf8"));

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 15000 });
} catch (error) {
  throw new Error("无法启动本机 Google Chrome。请安装 Chrome 后重试。", { cause: error });
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  await page.goto(new URL("../public/code-motion.html", import.meta.url).href);
  await page.evaluate(async data => {
    window.setMotionPlan(data);
    await document.fonts.ready;
  }, plan);
  // A job accepted before the service reload may still carry the earlier frame-level array.
  const frameCount = plan.frames ?? plan.levels.length;
  for (let frame = 0; frame < frameCount; frame++) {
    const suffix = String(frame).padStart(5, "0") + ".jpg";
    const avatar = plan.hasAvatarFrames ? pathToFileURL(join(output, "avatar-" + suffix)).href : null;
    await page.evaluate(([time, portrait]) => window.drawMotionFrame(time, portrait), [frame / plan.fps, avatar]);
    const name = "frame-" + suffix;
    await page.screenshot({ type: "jpeg", quality: 96, path: join(output, name) });
  }
} finally {
  await browser.close();
}
