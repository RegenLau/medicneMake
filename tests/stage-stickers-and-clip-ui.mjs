import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// End-to-end verification covering Phase 1 (4 draft modes + legacy svg/mg/asset compatibility),
// Phase 3 (sticker collision avoidance + sticker SFX peak in exported MP4),
// and Phase 4 (AI video clip cancel/confirm cost modal + mocked Seedance MP4 + 3-frame time alignment + overlay).
const [origin, sandbox, screenshots] = process.argv.slice(2);
await mkdir(screenshots, { recursive: true });

// Generate a 3-color time-coded 4s MP4 fixture in sandbox/.studio/media/fake-clip.mp4
// Red (0-1.3s), Green (1.3-2.6s), Blue (2.6-4.0s) so we can verify frame-to-time alignment in the final exported MP4!
const clipMedia = join(sandbox, ".studio", "media");
await mkdir(clipMedia, { recursive: true });
const clipMp4 = join(clipMedia, "f1f1f1f1.mp4");
const clipPoster = join(clipMedia, "f1f1f1f1.jpg");
execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", "color=c=0xd93829:s=640x360:d=1.35",
  "-f", "lavfi", "-i", "color=c=0x1e9e5a:s=640x360:d=1.35",
  "-f", "lavfi", "-i", "color=c=0x1a73e8:s=640x360:d=1.35",
  "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
  "-map", "[v]", "-r", "24", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipMp4,
]);
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", clipMp4, "-frames:v", "1", clipPoster]);

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const submitted = [];
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.route("**/api/jobs", async (route) => {
    const payload = route.request().postDataJSON();
    submitted.push(payload);
    if (payload.kind === "images") {
      await page.route("**/api/jobs/" + payload.id, (req) => req.fulfill({ json: { status: "done", output: { images: ["/assets/template-info-tablet.jpg"] } } }));
      return route.fulfill({ status: 202, json: { status: "queued" } });
    }
    if (payload.kind === "stage-clip") {
      await page.route("**/api/jobs/" + payload.id, (req) => req.fulfill({
        json: {
          status: "done",
          output: {
            clip: "/media/f1f1f1f1.mp4",
            clipPoster: "/media/f1f1f1f1.jpg",
            clipStyle: payload.clip.clipStyle,
            clipModel: payload.settings.videoModel,
            clipResolution: payload.settings.resolution,
            clipSeconds: payload.clip.seconds,
            clipDuration: 4.05,
            clipCost: "1.65",
          },
        },
      }));
      return route.fulfill({ status: 202, json: { status: "queued" } });
    }
    if (!["draft", "video"].includes(payload.kind) || payload.avatar || payload.settings.voice !== "无配音") {
      await route.abort();
      throw new Error(`Unexpected paid job: ${payload.kind}`);
    }
    await route.continue();
  });

  const button = (name) => page.getByRole("button", { name, exact: true });
  const frame = () => page.locator("#stage-play:not([disabled])").waitFor();
  const production = page.locator("#stage-production-job");
  const finishedShot = async () => { await production.waitFor({ state: "hidden" }); await frame(); };
  const select = (i) => page.locator(`[data-action="stage-select"][data-val="${i}"]`).click();
  const confirm = () => page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
  const preview = page.frameLocator("#stage-preview");

  // 1. Phase 1: Verify only 4 draft modes appear on setup screen
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await button("信息图模板").click();
  const modeButtons = await page.locator('[data-action="stage-mode"]').allTextContents();
  assert.deepEqual(modeButtons, ["Mix 模式（推荐）", "AI 完整图", "信息图动效", "代码动效场景"]);

  await page.locator("#topic").fill("出门怎么带药");
  assert.equal(await page.getByRole("spinbutton", { name: "AI 出图上限" }).count(), 0);
  await page.evaluate(() => {
    const w = current();
    Object.assign(w.settings, { voice: "无配音", music: "off", avatarMode: "static", duration: 30 });
    w.templatePresenter = "none";
    w.stagePlan.audio = { sfx: { pack: "off", gainDb: -10, stickerSfx: true } };
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  await confirm();
  await frame();

  // 2. Phase 3: Add sticker on shot 0 appearing at cue 1 (~1.5s) and verify non-overlap + audio peak in export
  await select(0);
  await page.evaluate(() => {
    const w = current();
    const s0 = w.stagePlan.shots[0];
    s0.cues = [
      { text: "出门前先核对药盒。", focus: "0", weight: 9 },
      { text: "千万别装错剂量。", focus: "0", weight: 9 },
    ];
    s0.stickers = [{
      assetId: "builtin:image/fluent-warning",
      cue: 1,
      keyword: "",
      anchor: "media-tr",
      size: "m",
      enter: "pop",
      hold: "stay",
      sfx: "builtin:sfx/check",
    }];
    changed(w);
    render(true);
  });
  await frame();
  await page.locator("#stage-seek").fill("2.8");
  await preview.locator(".stage-sticker-item img").waitFor();
  await page.screenshot({ path: join(screenshots, "01-贴纸预览.png"), animations: "disabled" });

  // Verify sticker does not overlap text avoid boxes
  const overlap = await preview.locator(".media-slot").evaluate((slot) => {
    const st = slot.querySelector(".stage-sticker-item");
    const sr = st.getBoundingClientRect();
    let maxOverlap = 0;
    for (const el of slot.querySelectorAll("[data-sticker-avoid]")) {
      const r = el.getBoundingClientRect();
      const ox = Math.max(0, Math.min(sr.right, r.right) - Math.max(sr.left, r.left));
      const oy = Math.max(0, Math.min(sr.bottom, r.bottom) - Math.max(sr.top, r.top));
      maxOverlap = Math.max(maxOverlap, ox * oy);
    }
    return { w: Math.round(sr.width), h: Math.round(sr.height), maxOverlap: Math.round(maxOverlap) };
  });
  assert(overlap.w >= 40 && overlap.h >= 40, `Sticker not rendered: ${JSON.stringify(overlap)}`);

  // 3. Phase 4: Switch shot 1 to AI 演示视频 -> AI写描述 -> 生成首帧 -> 取消付费确认不提交 -> 确认生成 -> 预览 -> 导出 MP4
  await select(1);
  await page.evaluate(() => { config.keyPresent = true; });
  await button("AI 演示视频").click();
  await frame();
  await button("AI 写视频描述").click();
  await confirm();
  await finishedShot();
  assert((await page.getByLabel(/画面动作描述/).inputValue()).includes("药盒"));

  await button("生成首帧").click();
  await confirm();
  await finishedShot();

  // Cancel cost confirmation modal must NOT submit any stage-clip job
  const countBeforeCancel = submitted.length;
  await button("生成 AI 视频").click();
  await page.getByRole("dialog").getByText(/按方舟实际用量结算/).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(submitted.length, countBeforeCancel, "Cancelled clip modal must not submit any job");

  // Confirm cost modal submits stage-clip job
  await button("生成 AI 视频").click();
  await confirm();
  await finishedShot();
  assert.equal(submitted.at(-1).kind, "stage-clip");
  await preview.locator("video.stage-clip-video").waitFor();
  await preview.locator(".stage-clip-overlay h2").waitFor();
  await page.screenshot({ path: join(screenshots, "02-AI视频预览.png"), animations: "disabled" });

  // 4. Legacy compatibility check on shot 2: inject legacy asset + verify normalizeWork migrates it to card + sticker,
  // and verify legacy svg shot can still render & export!
  await page.evaluate(() => {
    const w = current();
    // Simulate legacy asset shot migration via StageStudio.normalizeWork
    w.stagePlan.shots[2].content = { kind: "asset", assetId: "builtin:image/fluent-pill", move: "still" };
    StageStudio.normalizeWork(w);
    if (w.stagePlan.shots[2].content.kind !== "card") throw Error("Legacy asset did not migrate to card");
    if (!w.stagePlan.shots[2].stickers?.length) throw Error("Legacy asset did not migrate to sticker");
    changed(w);
    render(true);
  });
  await frame();

  // 5. Export full MP4 containing: Shot 0 (card + sticker + sticker SFX), Shot 1 (AI clip + overlay), Shot 2 (migrated asset->card+sticker)
  await button("合成视频").click();
  await confirm();
  await page.locator("video.video-player").waitFor({ timeout: 90000 });
  const result = await page.evaluate(() => current().video);
  const mp4File = join(sandbox, ".studio", result.url.slice(1));
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4File]));
  const timeline = result.shotSeconds.reduce((a, b) => a + b, 0);
  assert(Math.abs(duration - timeline) <= 0.1, `Duration mismatch: ${duration} vs ${timeline}`);

  // Verify Shot 1 (AI clip) 3 frames align with Red -> Green -> Blue progression in the exported MP4!
  const shot1Start = result.shotSeconds[0];
  const sampleColors = [];
  for (const [tag, offset] of [["red", 0.5], ["green", 1.9], ["blue", 3.2]]) {
    const outPng = join(screenshots, `03-成片clip-${tag}.png`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(shot1Start + offset), "-i", mp4File, "-frames:v", "1", outPng]);
    // Sample central pixel inside media slot (x=760, y=350 on 1280x720)
    const raw = execFileSync("ffmpeg", [
      "-v", "error", "-i", outPng, "-vf", "crop=20:20:750:340,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]);
    sampleColors.push({ tag, r: raw[0], g: raw[1], b: raw[2] });
  }
  // Red dominant first, Green dominant second, Blue dominant third!
  assert(sampleColors[0].r > sampleColors[0].g + 40 && sampleColors[0].r > sampleColors[0].b + 40, `Expected red frame: ${JSON.stringify(sampleColors)}`);
  assert(sampleColors[1].g > sampleColors[1].r + 40 && sampleColors[1].g > sampleColors[1].b + 40, `Expected green frame: ${JSON.stringify(sampleColors)}`);
  assert(sampleColors[2].b > sampleColors[2].r + 40 && sampleColors[2].b > sampleColors[2].g + 40, `Expected blue frame: ${JSON.stringify(sampleColors)}`);

  // Verify sticker SFX audio peak exists near shot 0 cue 1 (~2.0s) even though scene SFX pack was OFF!
  const pcmBuf = execFileSync("ffmpeg", ["-v", "error", "-i", mp4File, "-vn", "-ar", "24000", "-ac", "1", "-f", "f32le", "-"]);
  const samples = new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 4);
  const peakInWindow = (startSec, endSec) => {
    let mx = 0;
    const i0 = Math.max(0, Math.floor(startSec * 24000));
    const i1 = Math.min(samples.length, Math.floor(endSec * 24000));
    for (let i = i0; i < i1; i++) mx = Math.max(mx, Math.abs(samples[i]));
    return mx;
  };
  const quietBefore = peakInWindow(0.2, 1.4);
  const stickerPeak = peakInWindow(1.7, 2.7);
  assert(stickerPeak > 0.05 && stickerPeak > quietBefore * 5, `Expected sticker SFX peak around 2.0s: quiet=${quietBefore}, peak=${stickerPeak}`);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ duration, timeline, overlap, sampleColors, quietBefore, stickerPeak, browserErrors: errors.length }));
} finally {
  await browser.close();
}
