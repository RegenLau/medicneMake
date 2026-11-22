// End-to-end UI verification for Item 4: top-right 「视频拆解」 nav entry,
// real MP4 upload -> FFmpeg shot detection & keyframe thumbnails -> Motion.md blueprint -> one-click apply to new work.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = (process.argv[2] || "http://127.0.0.1:8765").replace(/\/$/, "");
const ffmpegBin = process.argv[3] || "ffmpeg";

const tmpDir = mkdtempSync(join(tmpdir(), "recreate-ui-"));
const sampleMp4 = join(tmpDir, "demo-explainer.mp4");
execFileSync(ffmpegBin, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "color=c=navy:s=640x360:d=2:r=12",
  "-f", "lavfi", "-i", "color=c=teal:s=640x360:d=2:r=12",
  "-f", "lavfi", "-i", "color=c=orange:s=640x360:d=2:r=12",
  "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
  "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  sampleMp4,
]);

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  // Mock DeepSeek blueprint response while letting real /api/recreate/upload & /recreate-media/* run end-to-end!
  await page.route(`${origin}/api/recreate/blueprint`, async (route) => {
    const body = route.request().postDataJSON();
    const item = {
      id: body.id || "11111111-1111-4111-8111-111111111111",
      title: body.title || "爆款三段式科普拆解",
      meta: { duration: 6.0, width: 640, height: 360, fps: 12, aspect: "16:9", orientation: "landscape" },
      shots: [
        { index: 0, start: 0, end: 2, seconds: 2, frameUrl: "" },
        { index: 1, start: 2, end: 4, seconds: 2, frameUrl: "" },
        { index: 2, start: 4, end: 6, seconds: 2, frameUrl: "" },
      ],
      notes: body.notes || "",
      transcript: body.transcript || "",
      targetTopic: body.targetTopic || "缓释片安全用药",
      targetDrug: body.targetDrug || "硝苯地平缓释片",
      blueprint: {
        title: "爆款三段式科普拆解",
        hookStrategy: "前 2 秒直击误区痛点",
        pacingSummary: "每幕 2 秒节奏紧凑，核心卡片清晰停留",
        visualStyle: "医疗网格底纹 + 精绘线性图标 + 底部药师提醒胶囊",
        recommendedLayoutId: "builtin:layout/takeaway",
        recommendedTheme: "builtin:theme/medical",
        styleTags: ["三段式", "误区对比"],
        aspect: "16:9",
        portraitLayoutDraft: null,
        shots: [
          {
            index: 0, name: "痛点开场", seconds: 4, pointType: "cover", kind: "scene", transition: "fade",
            narrationRole: "提出缓释片不能掰开的疑问", choreography: "0.1s 标题入场 → 0.4s 图标弹入",
            shotPrompt: "大标题结论卡 + pill 精绘图标", sampleLine: "缓释片太大吞不下，掰开吃行不行？", icons: ["pill"],
          },
          {
            index: 1, name: "原理解析", seconds: 5, pointType: "compare", kind: "scene", transition: "wipe",
            narrationRole: "对比整片吞服与掰开服用的差异", choreography: "0.2s 左右对照栏交错展开",
            shotPrompt: "左绿勾整片缓释 vs 右红叉掰开骤释", sampleLine: "掰开会破坏缓释结构，药效瞬间释放容易带来风险。", icons: ["check", "cross"],
          },
          {
            index: 2, name: "安全收口", seconds: 4, pointType: "summary", kind: "scene", transition: "slide",
            narrationRole: "强调遵医嘱与问药师", choreography: "0.2s 收口胶囊落位定格",
            shotPrompt: "双要点收口 + 底部问药师胶囊", sampleLine: "吞咽困难先问药师，不要自己掰开。", icons: ["doctor"],
          },
        ],
      },
      motionMd: "---\ntitle: \"爆款三段式科普拆解\"\n---\n# 爆款三段式科普拆解\n",
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item }) });
  });

  await page.goto(origin);
  await page.waitForSelector("#nav-recreate");
  const navText = (await page.locator("#nav-recreate").innerText()).trim();
  assert.equal(navText, "视频拆解", "Topbar right should display 视频拆解 entry");

  // Click topbar entry -> opens #recreate visual workbench
  await page.locator("#nav-recreate").click();
  await page.waitForSelector(".recreate-upload-zone");
  assert.ok(page.url().includes("#recreate"), "Should navigate to #recreate");

  // Upload real MP4 -> verify local FFmpeg extracts multiple shot keyframes & renders thumbnails
  await page.locator("#recreate-video-input").setInputFiles(sampleMp4);
  await page.waitForSelector(".recreate-frame-card", { timeout: 15000 });
  const uploadedId = await page.locator("[data-recreate-select]").first().getAttribute("data-recreate-select");
  assert.ok(uploadedId, "Upload should persist recreate record in history sidebar");
  const frameCount = await page.locator(".recreate-frame-card").count();
  assert.ok(frameCount >= 2, `Expected >=2 detected shot frames, got ${frameCount}`);
  const imgNaturalWidth = await page.locator(".recreate-frame-card img").first().evaluate((img) => img.naturalWidth);
  assert.ok(imgNaturalWidth > 0, "Extracted keyframe image should load cleanly from /recreate-media/");

  // Fill target topic & generate Motion.md blueprint
  await page.evaluate(() => { config.deepseekKeyPresent = true; });
  await page.locator('[data-recreate-field="targetTopic"]').fill("缓释片不能掰开吃");
  await page.locator('[data-recreate-field="targetDrug"]').fill("硝苯地平缓释片");
  await page.locator('[data-recreate-generate]').click();
  await page.waitForSelector(".recreate-result-panel", { timeout: 10000 });
  assert.equal(await page.locator(".recreate-shot-row").count(), 3);

  // Click one-click apply -> creates new stage work and navigates to #work/<id>
  await page.locator('[data-recreate-apply]').click();
  await page.waitForFunction(() => location.hash.startsWith("#work/"), null, { timeout: 10000 });
  await page.waitForSelector(".stage-review-shell, [data-action='stage-kind']", { timeout: 10000 });
  const createdWork = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
    return raw.works?.[0] || null;
  });
  assert.ok(createdWork, "Should create new work from blueprint");
  assert.equal(createdWork.title, "缓释片不能掰开吃");
  assert.equal(createdWork.drug, "硝苯地平缓释片");
  assert.equal(createdWork.stagePlan.layout.id, "builtin:layout/takeaway");
  assert.equal(createdWork.stagePlan.shots.length, 3);
  assert.equal(createdWork.stagePlan.shots[0].content.customCodePrompt, "大标题结论卡 + pill 精绘图标");

  // Clean up test record from server storage via API
  await page.evaluate(async (id) => {
    await fetch("/api/recreate/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }, uploadedId);

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: test_recreate_ui.mjs");
} finally {
  await browser.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
