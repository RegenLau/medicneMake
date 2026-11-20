import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// Use an isolated workbench configured with tests/stage_d_fixture.py and no paid media providers.
const [origin, sandbox, screenshots] = process.argv.slice(2);
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
  const finishedShot = async () => {
    await production.waitFor({state:"hidden"});
    await frame();
  };
  const select = index => page.locator(`[data-action="stage-select"][data-val="${index}"]`).click();
  const confirm = () => page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
  const shots = () => page.evaluate(() => current().stagePlan.shots);
  const screenshot = name => page.screenshot({ path: join(screenshots, name + ".png"), animations:"disabled" });
  const notice = () => page.locator("#notice").textContent();
  const focused = () => page.evaluate(() => document.activeElement.dataset.stageField || document.activeElement.dataset.action);

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await button("信息图模板").click();
  await page.locator("#topic").fill("出门怎么带药");
  assert.equal(await page.getByRole("spinbutton", { name: "AI 出图上限" }).count(), 0);
  await page.evaluate(() => {
    if (!config.stageShotProduction || config.keyPresent) throw Error("Use an isolated, updated fixture workbench.");
    const w = current();
    Object.assign(w.settings, { voice:"无配音", music:"off", avatarMode:"static", duration:30 });
    w.templatePresenter = "none";
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  await confirm();
  await frame();

  // Clearing a neighboring line must not block the selected shot's Mix operation.
  await select(2);
  await page.getByLabel("本幕口播").fill("");
  await select(0);
  await button("本幕重新判断").click();
  await confirm();
  await frame();
  assert.equal(submitted.at(-1).draft.targetIndex, 0);
  assert.equal(submitted.at(-1).draft.script.shots[2].line, "");
  assert.equal((await shots())[2].line, "");

  // Full composition still checks every shot and focuses the precise missing input.
  await button("合成视频").click();
  assert.equal(await notice(), "第 3 幕「记录时间」缺少口播，请补齐。");
  assert.equal(await focused(), "line");
  assert.equal(await page.locator('[data-action="stage-select"][aria-pressed="true"]').getAttribute("data-val"), "2");
  await screenshot("01-定位缺少口播");

  await select(1);
  // Retired draft/editor mode buttons are gone; new AI video buttons exist.
  assert.equal(await button("SVG 演示动画").count(), 0);
  assert.equal(await button("MG 动画").count(), 0);
  assert.equal(await button("素材库素材").count(), 0);
  assert.equal(await button("AI 演示视频").count(), 1);
  assert.equal(await button("AI MG 动画").count(), 1);

  await button("代码动效场景").click();
  // Clear form to exercise legacy scene-production path and test duplicate rejection
  await page.locator('[data-stage-field="form"]').selectOption("");
  await frame();
  const original = await shots();
  await button("重新制作本幕").click();
  await page.getByRole("dialog").getByText(/保留口播、要点和其他幕/).waitFor();
  await page.waitForFunction(() => !document.querySelector("#notice").textContent);
  await screenshot("02-手动制作本幕");
  await confirm();
  await finishedShot();
  let after = await shots();
  assert.equal(submitted.at(-1).draft.presentation, "scene");
  assert.equal(submitted.at(-1).draft.produceShot.shot.line, original[1].line);
  assert.equal(submitted.at(-1).draft.script, undefined);
  assert.equal(after[1].content.visual, "mechanism");
  await page.frameLocator("#stage-preview").locator(".cm-mech-split").waitFor();
  assert.equal(after[1].content.decidedBy, "user");
  assert.deepEqual([after[0], after[2]], [original[0], original[2]]);
  for (const key of ["line", "points", "cues", "seconds", "chapterIndex"]) assert.deepEqual(after[1][key], original[1][key]);

  // Duplicate rejection + retry recovery works cleanly on scene production
  await button("重新制作本幕").click();
  await page.getByLabel("画面要求").fill("测试重复画面");
  await confirm();
  await production.getByRole("alert").getByText(/本幕保留原画面/).waitFor();
  assert(await page.locator("#stage-preview").isVisible());
  const failed = submitted.at(-1);
  await button("继续此任务").click();
  await page.getByRole("dialog").getByText(/继续制作第 2 幕画面/).waitFor();
  await confirm();
  await production.getByRole("alert").getByText(/本幕保留原画面/).waitFor();
  assert.deepEqual(submitted.at(-1), failed);
  await production.getByRole("button", {name:"关闭提示"}).click();
  await frame();
  assert.equal((await shots())[1].content.visual, "mechanism");

  // Local form switching works with zero paid calls
  const beforeSwitchCount = submitted.length;
  await button("换个版式").click();
  await frame();
  assert.equal(submitted.length, beforeSwitchCount);
  assert((await shots())[1].content.form);
  await screenshot("03-切换版式后预览");

  await page.reload();
  await frame();
  await select(1);
  await button("重新制作本幕").waitFor();

  await button("AI 完整图").click();
  await page.evaluate(() => { config.keyPresent = true; });
  imageResult = {status:"running",progress:"正在生成测试配图"};
  await button("生成本幕配图").click();
  await confirm();
  await production.getByText("正在生成测试配图", {exact:true}).waitFor();
  assert(await page.locator("#stage-preview").isVisible());
  assert(await page.getByLabel("本幕口播").isDisabled());
  const imageJob = submitted.at(-1);
  imageResult = {status:"failed",error:"测试配图失败"};
  await production.getByRole("alert").getByText(/测试配图失败/).waitFor();
  await production.getByRole("button", {name:"继续此任务"}).click();
  imageResult = {status:"done",output:{images:["/assets/template-info-tablet.jpg"]}};
  await confirm();
  await finishedShot();
  assert.deepEqual(submitted.at(-1), imageJob);
  assert.equal((await shots())[1].content.image,"/assets/template-info-tablet.jpg");
  await page.frameLocator("#stage-preview").locator(".pt-media-img").waitFor();
  await select(2);
  await page.getByLabel("本幕口播").fill("记下每次用药时间。");
  await select(1);

  await button("合成视频").click();
  await confirm();
  await page.locator("video.video-player").waitFor({ timeout:75000 });
  assert.deepEqual(submitted.at(-1).items.map(shot => shot.content.kind), ["scene", "image", "card"]);
  const result = await page.evaluate(() => current().video);
  const file = join(sandbox, ".studio", result.url.slice(1));
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));
  const timeline = result.shotSeconds.reduce((sum, seconds) => sum + seconds, 0);
  assert(Math.abs(duration - timeline) <= 1 / 24);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ duration, timeline, submitted:submitted.map(payload => payload.kind), file }));
} finally {
  await browser.close();
}
