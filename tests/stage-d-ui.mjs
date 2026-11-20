import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const [origin, sandbox, directory] = process.argv.slice(2);
const screenshots = resolve(directory);
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(14000);
  const submitted = [];
  const errors = [];
  const state = () => page.evaluate(() => structuredClone(current().stagePlan));
  const ready = () => page.locator("#stage-play:not([disabled])").waitFor();
  const dialog = page.getByRole("dialog");
  const confirm = () => dialog.locator('[data-action="confirm-paid"]').click();
  const save = name => page.screenshot({ path: join(screenshots, name+".png"), fullPage: true });
  const button = name => page.getByRole("button", { name, exact: true });
  const modal = (name, value) => dialog.getByText(value, { exact: false }).waitFor().then(() => save(name));
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/jobs", async route => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      assert(["draft", "video"].includes(payload.kind), "Do not call paid media providers");
      assert(!payload.avatar);
      assert.equal(payload.settings.voice, "无配音");
      if (payload.kind === "draft") {
        assert.equal(payload.draft.videoMode, "stage");
        assert.equal(payload.draft.imageBudget, 0);
      } else {
        assert.equal(payload.stage, true);
        assert(payload.items.every(shot => shot.content.kind !== "image"));
      }
      submitted.push(payload);
    }
    await route.continue();
  });

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await button("信息图模板").click();
  const mix = page.locator('[data-action="stage-mode"][data-val="mix"]');
  const fixed = page.locator('[data-action="stage-mode"][data-val="svg"]');
  assert.equal(await mix.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("spinbutton",{name:"AI 出图上限"}).inputValue(), "2");
  assert.match(await page.locator("#stage-image-estimate").innerText(), /最多 ¥/);
  await save("01-Mix默认与费用");
  await fixed.click();
  assert.equal(await fixed.getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("spinbutton",{name:"AI 出图上限"}).count(), 0);
  await save("02-固定方式");
  await mix.click();
  await page.getByRole("spinbutton",{name:"AI 出图上限"}).fill("0");
  await page.locator("#topic").fill("出门怎么带药");
  await page.evaluate(() => {
    const w = current();
    Object.assign(w.settings, { voice:"无配音", music:"off", avatarMode:"static", duration:30 });
    w.templatePresenter = "none";
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  await modal("03-零预算脚本确认","本地渲染，无模型画面费用");
  await confirm();
  await ready();
  assert.deepEqual((await state()).shots.map(s => s.content.kind), ["scene", "svg", "card"]);
  assert((await state()).shots[0].content.adjusted.includes("上限"));
  const first = page.locator('[data-action="stage-select"][data-val="0"]');
  const second = page.locator('[data-action="stage-select"][data-val="1"]');
  assert.match(await second.getAttribute("title"),/打包随身药/);
  await save("04-编排原因与降级");

  await page.locator('[data-action="stage-kind"][data-val="card"]').click();
  await ready();
  assert.equal((await state()).shots[0].content.decidedBy, "user");
  await button("重新编排全片").click();
  const override = dialog.getByRole("checkbox",{name:"同时重排我改过的幕"});
  assert.equal(await override.isChecked(), false);
  await save("05-重新编排保留手动幕");
  await confirm();
  await page.waitForFunction(() => !current().job);
  await ready();
  assert.equal(submitted[1].draft.script.shots[0].content.decidedBy, "user");
  assert.equal((await state()).shots[0].content.kind, "card");

  await second.click();
  await ready();
  const newLine = "把原包装药盒与说明书一起放进随身包。";
  await page.getByLabel("本幕口播").fill(newLine);
  assert.equal((await state()).shots[1].content.kind, "svg");
  await page.locator("#stage-stale").waitFor();
  await save("06-改口播后提示");
  await button("本幕重新判断").click();
  await modal("07-本幕重新判断","提交 1 次编排请求");
  await confirm();
  await page.waitForFunction(() => !current().job);
  await ready();
  assert.equal(submitted[2].draft.targetIndex, 1);
  assert.equal(submitted[2].draft.script.shots.length, 3);
  assert.equal((await state()).shots[1].content.kind, "scene");
  assert.equal((await state()).shots[1].line, newLine);
  assert.equal((await state()).shots[0].content.kind, "card");

  await button("重新编排全片").click();
  await override.check();
  await save("08-允许重排手动幕");
  await confirm();
  await page.waitForFunction(() => !current().job);
  await ready();
  assert.equal(submitted[3].draft.overwriteUser, true);
  assert.equal((await state()).shots[0].content.kind, "scene");
  assert.equal((await state()).shots[1].line, newLine);
  assert.equal((await state()).shots[1].content.kind, "svg");
  await first.click();
  await ready();
  await button("合成视频").click();
  await modal("09-零预算合成确认","本地渲染，无模型画面费用");
  const start = performance.now();
  await confirm();
  const video = page.locator("video.video-player");
  await video.waitFor({ timeout: 75000 });
  const seconds = (performance.now() - start) / 1000;
  const result = await page.evaluate(() => current().video);
  const path = join(sandbox, ".studio", result.url.slice(1));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], {encoding:"utf8"}));
  const duration = Number(probe.format.duration);
  const timelineSeconds = result.shotSeconds.reduce((total, length) => total + length, 0);
  assert(Math.abs(duration - timelineSeconds) <= 1 / 24);
  const cropAt = time => execFileSync("ffmpeg", ["-v", "error", "-ss", time.toFixed(4), "-i", path,
    "-frames:v", "1", "-vf", "crop=780:400:300:155", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {maxBuffer:2_000_000});
  const delta = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
  const samples = [];
  for (let i = 0, start = 0; i < result.shotSeconds.length; i++) {
    execFileSync("ffmpeg", ["-y","-v","error","-ss",String(start + result.shotSeconds[i] * .5),"-i",path,
      "-frames:v","1",join(screenshots,`11-成片抽帧-${i+1}.png`)]);
    samples.push(cropAt(start + result.shotSeconds[i] * .5));
    start += result.shotSeconds[i];
  }
  const distinct = samples.slice(1).map((image, i) => delta(image, samples[i]));
  const svgMotion = delta(cropAt(result.shotSeconds[0]+.33),cropAt(result.shotSeconds[0]+result.shotSeconds[1]-.25));
  assert(distinct.every(diff => diff > 2));
  assert(svgMotion > 0.3);
  await save("10-Mix成片");
  const job = JSON.parse(await readFile(join(sandbox,".studio","jobs",submitted.at(-1).id+".json"),"utf8"));
  assert.equal(job.status,"done");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({
    submitted:submitted.map(p => p.kind), seconds, media:result.url, duration, timelineSeconds,
    frames:Number(probe.streams[0].nb_frames), renderStats:result.renderStats, browserErrors:errors.length,
    distinct, svgMotion,
  }));
} finally {
  await browser.close();
}
