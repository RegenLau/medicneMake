import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// Run against an isolated workbench whose DeepSeek is the fixture in tests/stage_d_fixture.py with an
// artPrompt added to card and scene plans, and whose media folder holds a1a1a1a1.png and b2b2b2b2.png.
const [origin, sandbox, screenshots] = process.argv.slice(2);
const ART = "妈妈用带刻度的量杯，给孩子倒退烧药混悬液。";
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const submitted = [];
  const errors = [];
  let imageResult;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/jobs", async route => {
    const payload = route.request().postDataJSON();
    submitted.push(payload);
    if (payload.kind === "images") {
      await page.route("**/api/jobs/" + payload.id, request => request.fulfill({ json:imageResult }));
      return route.fulfill({ status:202, json:{status:"queued"} });
    }
    if (!["draft", "video"].includes(payload.kind) || payload.avatar || payload.settings.voice !== "无配音") {
      await route.abort();
      throw new Error("The UI test only uses fixture DeepSeek and local rendering");
    }
    await route.continue();
  });
  const button = name => page.getByRole("button", { name, exact: true });
  const frame = () => page.locator("#stage-play:not([disabled])").waitFor();
  const production = page.locator("#stage-production-job");
  const finishedShot = async () => { await production.waitFor({state:"hidden"}); await frame(); };
  const select = index => page.locator(`[data-action="stage-select"][data-val="${index}"]`).click();
  const confirm = () => page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
  const shots = () => page.evaluate(() => current().stagePlan.shots);
  const preview = page.frameLocator("#stage-preview");
  const screenshot = name => page.screenshot({ path: join(screenshots, name + ".png"), animations:"disabled" });

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await button("信息图模板").click();
  await page.locator("#topic").fill("孩子发烧，退烧药怎么吃");
  await page.getByRole("spinbutton", { name: "AI 出图上限" }).fill("0");
  await page.evaluate(() => {
    if (config.keyPresent) throw Error("Use the isolated fixture workbench.");
    const w = current();
    Object.assign(w.settings, { voice:"无配音", music:"off", avatarMode:"static", duration:30 });
    w.templatePresenter = "none";
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  await confirm();
  await frame();

  // Mix keeps the illustration description that DeepSeek wrote for a card shot.
  let rows = await shots();
  assert.equal(rows[2].content.kind, "card");
  assert.equal(rows[2].content.artPrompt, ART);
  assert.equal(rows[0].content.artPrompt, undefined);
  await select(2);
  assert.equal(await page.getByLabel("插画描述").inputValue(), ART);
  await button("生成缺失插画").waitFor();

  // One paid illustration matching info-classic's 3:4 art panel, with a text-free prompt.
  await page.evaluate(() => { config.keyPresent = true; });
  imageResult = {status:"running", progress:"正在生成测试插画"};
  await button("生成本幕插画").click();
  await page.getByRole("dialog").getByText(/画幅 3:4/).waitFor();
  await confirm();
  await production.getByText("正在生成测试插画", {exact:true}).waitFor();
  imageResult = {status:"done", output:{images:["/media/a1a1a1a1.png"]}};
  await finishedShot();
  const job = submitted.at(-1);
  assert.equal(job.kind, "images");
  assert.equal(job.settings.ratio, "3:4");
  assert.deepEqual(job.settings.targetSize, { w: 371, h: 492 });
  assert.equal(job.items.length, 1);
  assert(job.items[0].prompt.includes(ART));
  assert(job.items[0].prompt.includes("不出现任何文字"));
  assert.equal((await shots())[2].content.art, "/media/a1a1a1a1.png");
  await preview.locator(".cm-art-panel img").waitFor();
  await page.locator("#stage-seek").fill("3");
  await screenshot("01-信息图动效-插画");

  // Card and scene share one illustration when switching modes.
  await button("代码动效场景").click();
  await frame();
  rows = await shots();
  assert.equal(rows[2].content.kind, "scene");
  assert.equal(rows[2].content.art, "/media/a1a1a1a1.png");
  await preview.locator(".cm-art-panel img").waitFor();
  await button("信息图动效").click();
  await frame();

  // Batch generation only covers shots that have a description and no picture yet.
  await select(0);
  assert.equal((await shots())[0].content.kind, "scene");
  await page.getByLabel("插画描述").fill("床头柜上放着闹钟和儿童退烧药瓶，闹钟指向晚上八点。");
  await select(1);
  imageResult = {status:"done", output:{images:["/media/b2b2b2b2.png"]}};
  await button("生成缺失插画").click();
  await confirm();
  await finishedShot();
  assert.equal(submitted.at(-1).items.length, 1);
  assert(submitted.at(-1).items[0].prompt.includes("闹钟指向晚上八点"));
  rows = await shots();
  assert.equal(rows[0].content.art, "/media/b2b2b2b2.png");
  assert.equal(rows[2].content.art, "/media/a1a1a1a1.png");
  assert.equal(await button("生成缺失插画").count(), 0);
  await select(0);
  await page.locator("#stage-seek").fill("3");
  await frame();
  await screenshot("02-代码动效场景-插画");

  // Removing the illustration restores the original card layout, and it can be generated again.
  await select(2);
  await button("移除插画").click();
  await frame();
  assert.equal((await shots())[2].content.art, undefined);
  await preview.locator(".pt-card-fallback").waitFor();
  assert.equal(await preview.locator(".cm-art-panel").count(), 0);
  assert.equal(await page.getByLabel("插画描述").inputValue(), ART);
  imageResult = {status:"done", output:{images:["/media/a1a1a1a1.png"]}};
  await button("生成本幕插画").click();
  await confirm();
  await finishedShot();
  assert.equal((await shots())[2].content.art, "/media/a1a1a1a1.png");

  // The exported MP4 shows both illustrations.
  await button("合成视频").click();
  await confirm();
  await page.locator("video.video-player").waitFor({ timeout:90000 });
  const composed = submitted.at(-1);
  assert.deepEqual(composed.items.map(shot => shot.content.kind), ["scene", "svg", "card"]);
  assert.deepEqual(composed.items.map(shot => shot.content.art || ""), ["/media/b2b2b2b2.png", "", "/media/a1a1a1a1.png"]);
  const result = await page.evaluate(() => current().video);
  const file = join(sandbox, ".studio", result.url.slice(1));
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));
  const timeline = result.shotSeconds.reduce((sum, seconds) => sum + seconds, 0);
  assert(Math.abs(duration - timeline) <= 1 / 24);
  const starts = result.shotSeconds.reduce((list, seconds) => [...list, list.at(-1) + seconds], [0]);
  for (const [index, label] of [[0, "成片-场景"], [2, "成片-信息图"]]) {
    for (const [offset, tag] of [[0.15, "入场"], [Math.min(3, result.shotSeconds[index] - 0.3), "停留"]]) {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(starts[index] + offset), "-i", file, "-frames:v", "1",
        join(screenshots, `03-${label}-${tag}.png`)]);
    }
  }

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ duration, timeline, shotSeconds:result.shotSeconds, submitted:submitted.map(payload => payload.kind), file }));
} finally {
  await browser.close();
}
