// End-to-end UI verification for the Doctor-first dual-view storyboard workflow:
// 「总览审稿」⇄「逐幕精修」, unified mixed-kind batch generation, stale re-gen,
// inline speech preview, auto-compose (static only) + dynamic avatar guard, and legacy compat.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-ui-"));
const py = `
import sys, pathlib
sys.path.insert(0, ${JSON.stringify(process.cwd())})
import server, asset_library
base = pathlib.Path(${JSON.stringify(tempDir)}) / ".studio"
server.DATA = base
server.MEDIA = base / "media"
server.JOBS = base / "jobs"
server.AVATAR_CACHE = base / "avatar-cache"
server.GENERATED_MUSIC_DIR = base / "music"
server.ASSETS = asset_library.LocalLibrary(base / "library", server.PUBLIC / "assets" / "library")
for d in (server.DATA, server.MEDIA, server.JOBS, server.AVATAR_CACHE, server.GENERATED_MUSIC_DIR):
    d.mkdir(parents=True, exist_ok=True)
server.ThreadingHTTPServer(("127.0.0.1", ${port}), server.Handler).serve_forever()
`;
const srv = spawn("python3", ["-B", "-c", py], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PYTHONUNBUFFERED: "1", STUDIO_PORT: String(port), STUDIO_STAGE_RENDER: "1" },
});
srv.stderr.on("data", (d) => process.stderr.write(d));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
const errors = [];

try {
  await waitForServer(`${origin}/`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  const mockJobs = new Map();
  const captured = [];

  await page.route(`${origin}/api/jobs`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    captured.push(body);
    const id = body.id || `mock-${captured.length}`;
    const draft = body.draft || {};
    if (body.kind === "draft" && !draft.produceSvgBatch && !draft.produceSceneBatch && !draft.produceShot) {
      mockJobs.set(id, {
        id,
        status: "done",
        progress: "已完成",
        output: {
          title: "缓释片为什么不能掰开吃",
          shortTitle: "缓释片别掰开",
          chapters: ["先看标识", "了解原理", "安全提醒"],
          disclaimer: "科普内容仅供参考，具体遵医嘱",
          drugTags: ["缓释片", "处方药"],
          shots: [
            {
              name: "拿到药先看名称",
              line: "看到药名里有缓释两个字，千万别顺手掰开吃。",
              seconds: 6,
              chapterIndex: 0,
              points: {
                type: "cover",
                headline: "缓释片千万别掰开",
                items: [{ title: "认准缓释字样", detail: "先看药盒通用名", tag: "" }],
                takeaway: "先看药名再服药",
                question: "药片太大，能掰成两半吞吗？",
                answer: "不能掰开，需整片吞服",
                verdictTone: "no",
              },
              cues: [{ text: "看到药名里有缓释两个字，千万别顺手掰开吃", focus: "all", weight: 20 }],
              content: { kind: "image", imagePrompt: "特写药盒标注“缓释片”字样与整片吞服提示" },
            },
            {
              name: "掰开会骤然释放",
              line: "缓释骨架被破坏后，一天药量可能短时间全部释放。",
              seconds: 7,
              chapterIndex: 1,
              points: {
                type: "explain",
                headline: "破坏缓释结构风险大",
                items: [{ title: "血药浓度骤升", detail: "易引发低血压头晕", tag: "" }],
                takeaway: "破坏结构等于过量",
                question: "掰开吃只是药效快一点吗？",
                answer: "易致血药浓度骤升",
                verdictTone: "warn",
              },
              cues: [{ text: "缓释骨架被破坏后，一天药量可能短时间全部释放", focus: "all", weight: 22 }],
              content: { kind: "image", imagePrompt: "对比完整缓释片匀速释放与掰开后瞬间释放" },
            },
            {
              name: "吞咽困难怎么处理",
              line: "如果确实吞咽困难，请先咨询医生或药师换剂型。",
              seconds: 6,
              chapterIndex: 2,
              points: {
                type: "summary",
                headline: "吞咽困难先问药师",
                items: [{ title: "勿自行掰开", detail: "咨询能否更换普通片或口服液", tag: "" }],
                takeaway: "调整剂型先问医生药师",
                question: "老人实在吞不下怎么办？",
                answer: "请医生药师更换剂型",
                verdictTone: "ok",
              },
              cues: [{ text: "如果确实吞咽困难，请先咨询医生或药师换剂型", focus: "all", weight: 21 }],
              content: { kind: "image", imagePrompt: "药师与患者沟通更换合适剂型示意图" },
            },
          ],
        },
      });
    } else if (body.kind === "svg-speech") {
      mockJobs.set(id, {
        id,
        status: "done",
        progress: "已完成",
        output: { url: "/assets/music/calm.flac", seconds: 5.2 },
      });
    } else if (body.kind === "images") {
      const imgs = (body.items || []).map(() => "/assets/template-info-tablet.jpg");
      mockJobs.set(id, { id, status: "done", progress: "已完成", output: { images: imgs } });
    } else if (draft.produceShot && draft.presentation === "svg") {
      mockJobs.set(id, {
        id,
        status: "done",
        progress: "已完成",
        output: {
          content: {
            kind: "svg",
            reason: "单幕 SVG 演示",
            decidedBy: "user",
            svgCode: {
              svg: `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg"><text x="400" y="230" text-anchor="middle" font-size="30">SINGLE SVG</text></svg>`,
              css: "",
              js: "",
            },
          },
        },
      });
    } else if (draft.produceSvgBatch) {
      const contents = {};
      for (const entry of draft.produceSvgBatch) {
        contents[String(entry.index)] = {
          kind: "svg",
          reason: `SVG 第 ${entry.index + 1} 幕`,
          decidedBy: "user",
          svgCode: {
            svg: `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg"><text x="400" y="230" text-anchor="middle" font-size="30">SVG #${entry.index + 1}</text></svg>`,
            css: "",
            js: "",
          },
        };
      }
      mockJobs.set(id, { id, status: "done", progress: "已完成", output: { contents, errors: {} } });
    } else if (draft.produceSceneBatch) {
      const contents = {};
      for (const entry of draft.produceSceneBatch) {
        contents[String(entry.index)] = {
          kind: "scene",
          reason: `代码动效第 ${entry.index + 1} 幕`,
          decidedBy: "user",
          code: {
            html: `<div class="demo-code">CODE #${entry.index + 1}</div>`,
            css: `.demo-code{display:grid;place-items:center;height:100%;font-size:28px;}`,
            js: "",
          },
        };
      }
      mockJobs.set(id, { id, status: "done", progress: "已完成", output: { contents, errors: {} } });
    } else if (body.kind === "video") {
      mockJobs.set(id, {
        id,
        status: "done",
        progress: "已完成",
        output: { url: "/assets/music/calm.flac", seconds: 19, shotSeconds: [6, 7, 6] },
      });
    } else {
      mockJobs.set(id, { id, status: "failed", error: `unexpected job kind ${body.kind}` });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id }) });
  });

  await page.route(`${origin}/api/jobs/*`, async (route) => {
    const id = route.request().url().split("/").pop();
    const job = mockJobs.get(id) || { id, status: "failed", error: "not found" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(job) });
  });

  // 1. New video work -> choose QA layout -> generate script -> lands automatically in 「总览审稿」
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="stage-layout"][data-val="builtin:layout/qa-chat"]').click();
  await page.locator("#topic").fill("缓释片为什么不能掰开吃");
  await page.evaluate(() => {
    config.deepseekKeyPresent = true;
    config.keyPresent = true;
    config.speechKeyPresent = true;
    config.codeMotionReady = true;
    const w = current();
    w.templatePresenter = "none";
    w.settings.avatarMode = "static";
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  const dialog = page.getByRole("dialog");
  const draftModalText = await dialog.innerText();
  assert(draftModalText.includes("总览审稿"), "Draft confirmation modal should explain landing in 总览审稿");
  await dialog.locator('[data-action="confirm-paid"]').click();

  await page.locator(".stage-review-card").first().waitFor();
  assert.equal(await page.locator(".stage-review-card").count(), 3, "Should display all 3 shots on one page");
  assert.equal(
    await page.locator('.stage-view-tab[data-action="stage-view"][data-val="review"]').getAttribute("aria-selected"),
    "true",
    "Review tab should be active after script generation",
  );
  assert.equal(await page.locator("#stage-preview").count(), 0, "Review view should not render heavy preview iframe");
  assert.equal(await page.locator('[data-stage-field="review-question:0"]').count(), 1, "QA layout should surface question field");
  assert.equal(await page.locator('[data-stage-field="review-answer:0"]').count(), 1, "QA layout should surface answer field");

  // 2. Doctor edits inline without losing focus & mixes presentation modes (image + svg + scene)
  const line0 = page.locator('[data-stage-field="review-line:0"]');
  await line0.fill("看到药名带缓释二字，\n千万别掰开或嚼碎服用。");
  assert(await page.locator('[data-review-stats="0"]').innerText().then((t) => t.includes("2 句")), "Live cue stats should update");
  await page.locator('[data-stage-field="review-imagePrompt:0"]').fill("画一盒硝苯地平缓释片与禁止掰开标识");

  // Switch shot 2 to SVG 动画 & shot 3 to 代码动效, fill human-readable visual ideas
  await page.locator('[data-action="stage-review-kind"][data-val="1:svg"]').click();
  await page.locator('[data-stage-field="review-codePrompt:1"]').fill("扁平矢量演示完整缓释骨架匀速释放，掰开后药物瞬间涌出");
  await page.locator('[data-action="stage-review-kind"][data-val="2:scene"]').click();
  await page.locator('[data-stage-field="review-codePrompt:2"]').fill("清晰展示医生药师换剂型建议三步流程");

  // 3. Inline speech audition stays in Review view & caches audio
  await page.locator('[data-action="stage-review-speech"][data-val="0"]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-action="stage-review-speech"][data-val="0"]')?.classList.contains("is-cached"),
  );
  assert.equal(await page.locator(".stage-review-card").count(), 3, "Speech preview should keep user in Review view");

  // 3b. Per-shot Tab bar: defaults to 全部 (3 cards), click shot 1 tab -> shows single card + pager, live title sync
  assert.equal(
    await page.locator('.stage-review-tab[data-val="all"]').getAttribute("aria-selected"),
    "true",
    "Shot filter tabs should default to 全部",
  );
  await page.locator('.stage-review-tab[data-val="0"]').click();
  assert.equal(await page.locator(".stage-review-card").count(), 1, "Selecting shot 1 tab should show only 1 card");
  assert.equal(await page.locator(".stage-review-pager").count(), 1, "Single-shot filter should show prev/next pager");
  await page.locator('[data-stage-field="review-name:0"]').fill("开头先看药盒");
  assert.equal(await page.locator('[data-review-tab-name="0"]').innerText(), "开头先看药盒", "Tab title should sync live");

  // 3c. Per-shot direct generation inside Review view: generate shot 1 AI 完整图 -> stays in Review view & shows thumb + zoom modal
  const shot1GenBtn = page.locator('[data-action="stage-review-generate"][data-val="0"]');
  assert.equal(await shot1GenBtn.innerText(), "生成 AI 完整图");
  await shot1GenBtn.click();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.locator(".stage-review-thumb-bar").waitFor();
  assert.equal(await page.locator('[data-review-status="0"]').innerText(), "画面就绪");
  assert.equal(await page.locator(".stage-review-card").count(), 1, "Single-shot generate should stay in Review view & keep current tab");
  assert((await page.locator('[data-action="stage-batch-all"]').first().innerText()).includes("生成剩余画面（2 幕）"), "Batch button should switch to remaining 2 shots");

  // Click thumbnail zoom button -> opens zoom modal -> close
  await page.locator('[data-action="stage-review-zoom"][data-val="0"]').first().click();
  await dialog.locator(".stage-review-zoom-box img").waitFor();
  await dialog.locator('[data-action="close"]').first().click();

  // Switch via pager to shot 2 (SVG) and test per-shot SVG generation inside Review view
  await page.locator('.stage-review-pager [data-action="stage-review-filter"][data-val="1"]').click();
  assert.equal(await page.locator('[data-review-shot="1"]').count(), 1, "Pager should navigate to shot 2");
  const shot2GenBtn = page.locator('[data-action="stage-review-generate"][data-val="1"]');
  assert.equal(await shot2GenBtn.innerText(), "生成 SVG 动画");
  await shot2GenBtn.click();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.locator(".stage-review-ready-note").waitFor();
  assert.equal(await page.locator('[data-review-status="1"]').innerText(), "画面就绪");
  assert(captured.at(-1).draft.produceShot.prompt.includes("扁平矢量演示完整缓释骨架匀速释放"), "Single SVG gen should carry doctor's visual idea");

  // Return to 全部 tab -> verify remaining batch generation (only shot 3 code scene left!) & auto-transition to 逐幕精修
  await page.locator('.stage-review-tab[data-val="all"]').click();
  assert.equal(await page.locator(".stage-review-card").count(), 3, "Clicking 全部 tab should show all 3 cards again");

  // 4. Unified batch generation for remaining shot (shot 3 code scene) -> auto-switches to 「逐幕精修」
  await page.locator('[data-action="stage-batch-all"]').first().click();
  const batchModalText = await dialog.innerText();
  assert(!batchModalText.includes("AI 完整图"), "Already-generated shot 1 image should not be re-submitted");
  assert(!batchModalText.includes("SVG 动画"), "Already-generated shot 2 SVG should not be re-submitted");
  assert(batchModalText.includes("代码动效（1 幕）"), "Unified batch modal should list remaining code scene");
  await dialog.locator('[data-action="confirm-paid"]').click();

  // Wait for automatic transition to 「逐幕精修」 after remaining step finishes
  await page.locator("#stage-preview").waitFor();
  assert.equal(
    await page.locator('.stage-view-tab[data-action="stage-view"][data-val="studio"]').getAttribute("aria-selected"),
    "true",
    "Should auto-switch to 逐幕精修 after all visuals finish",
  );
  const sceneReq = captured.find((c) => c.draft?.produceSceneBatch);
  assert(sceneReq?.draft.produceSceneBatch[0].prompt.includes("医生药师换剂型建议三步流程"), "Scene prompt should inherit doctor's review visual idea");

  // 5. Switch back to 「总览审稿」 -> verify ready states, edit shot 1 -> verify stale badge & targeted regen (only 1 shot!)
  await page.locator('[data-action="stage-view"][data-val="review"]').click();
  await page.locator(".stage-review-thumb-bar").first().waitFor();
  assert.equal(await page.locator('[data-review-status="0"]').innerText(), "画面就绪");
  assert.equal(await page.locator('[data-review-status="1"]').innerText(), "画面就绪");
  assert.equal(await page.locator('[data-review-status="2"]').innerText(), "画面就绪");

  const imgJobsBefore = captured.filter((c) => c.kind === "images").length;
  await page.locator('[data-stage-field="review-line:0"]').fill("拿到硝苯地平缓释片，\n请整片吞服切勿掰开。");
  assert.equal(await page.locator('[data-review-status="0"]').innerText(), "内容已改 · 建议重画");
  assert.equal(await page.locator('[data-review-status="1"]').innerText(), "画面就绪");

  const staleBtn = page.locator('[data-action="stage-batch-all"]').first();
  await staleBtn.waitFor({ state: "visible" });
  assert((await staleBtn.innerText()).includes("1 幕"), "Should offer regenerating only the 1 modified shot");
  await staleBtn.click();
  const staleModal = await dialog.innerText();
  assert(staleModal.includes("AI 完整图（1 张）"), "Targeted regen should only submit 1 modified image");
  assert(!staleModal.includes("SVG 动画"), "Unmodified SVG shot must not be regenerated");
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.locator("#stage-preview").waitFor();
  const imgJobsAfter = captured.filter((c) => c.kind === "images").length;
  assert.equal(imgJobsAfter, imgJobsBefore + 1, "Only 1 targeted image job should have run");

  // 6. Verify dynamic avatar protection hides auto-compose checkbox, while static allows auto-compose straight to draft
  await page.locator('[data-action="stage-view"][data-val="review"]').click();
  await page.locator('[data-stage-field="review-line:0"]').fill("再次微调第 1 幕口播以测试自动合成保护。");
  // Enable dynamic avatar -> autoCompose checkbox should be hidden & guard message shown
  await page.evaluate(() => {
    const w = current();
    w.templatePresenter = "digital";
    w.settings.avatarMode = "videoretalk";
    w.settings.voice = "刘飞 2.0";
    render(true);
  });
  assert.equal(await page.locator('[data-stage-field="work-autoCompose"]').count(), 0, "Dynamic avatar must not show auto-compose checkbox");
  assert((await page.locator(".stage-review-guard").innerText()).includes("数字人对口型"), "Should explain why auto-compose is paused for dynamic avatar");

  // Switch back to static presenter + check auto-compose -> confirm -> auto-composes into final draft view
  await page.evaluate(() => {
    const w = current();
    w.settings.avatarMode = "static";
    w.settings.voice = "无配音";
    render(true);
  });
  const autoCheck = page.locator('[data-stage-field="work-autoCompose"]');
  await autoCheck.waitFor();
  await autoCheck.check();
  await page.locator('[data-action="stage-batch-all"]').first().click();
  assert((await dialog.innerText()).includes("自动合成 MP4"), "Modal should explicitly disclose auto-compose step");
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.waitForFunction(() => current()?.stage === "draft" && Boolean(current()?.video?.url));

  // 7. Legacy work without editorView opens directly in 逐幕精修 (backward compatibility)
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
    const wid = "33333333-3333-4333-8333-333333333333";
    raw.works = [{
      id: wid,
      type: "video",
      videoMode: "template",
      templateTheme: "medical",
      templatePresenter: "none",
      title: "旧草稿兼容测试",
      topic: "旧草稿",
      drug: "",
      stage: "script",
      viewingSetup: false,
      settings: { voice: "无配音", music: "off", avatarMode: "static" },
      blocks: [{ name: "第 1 幕", line: "测试旧草稿直接打开。", seconds: 5 }],
      stagePlan: {
        layout: { id: "builtin:layout/info-classic" },
        mode: "image",
        shortTitle: "旧草稿",
        chapters: ["要点"],
        disclaimer: "仅供参考",
        audio: { sfx: { pack: "off", stickerSfx: false } },
        shots: [{
          name: "第 1 幕",
          line: "测试旧草稿直接打开。",
          seconds: 5,
          chapterIndex: 0,
          points: { type: "explain", headline: "第 1 幕", items: [{ title: "要点", detail: "", tag: "" }], takeaway: "" },
          cues: [{ text: "测试旧草稿直接打开", focus: "all", weight: 9 }],
          content: { kind: "image", image: "" },
          variants: { image: { kind: "image", image: "" } },
        }],
      },
    }, ...(raw.works || []).filter((x) => x.id !== wid)];
    localStorage.setItem("xixi-studio-v1", JSON.stringify(raw));
  });
  await page.goto(`${origin}/#work/33333333-3333-4333-8333-333333333333`);
  await page.reload();
  await page.locator("#stage-preview").waitFor();
  assert.equal(
    await page.locator('.stage-view-tab[data-action="stage-view"][data-val="studio"]').getAttribute("aria-selected"),
    "true",
    "Legacy work without editorView should default to 逐幕精修",
  );
  // Can still jump into 总览审稿 anytime
  await page.locator('[data-action="stage-view"][data-val="review"]').click();
  await page.locator(".stage-review-card").first().waitFor();

  assert.deepEqual(errors, [], `Unexpected page/console errors: ${errors.join("; ")}`);
  console.log("PASS: test_stage_review_view_ui.mjs");
} finally {
  await browser.close();
  srv.kill("SIGTERM");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
