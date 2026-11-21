// Verify SVG 动画 (legacy SVG props, no illustration) and 代码动效场景 (prompt-driven pure code, no illustration).
// Run against a running studio server: node tests/test_svg_and_pure_code_ui.mjs http://127.0.0.1:PORT
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = (process.argv[2] || "http://127.0.0.1:8765").replace(/\/$/, "");
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const mockJobs = new Map();
  await page.route(`${origin}/api/jobs`, async (route) => {
    const body = route.request().postDataJSON();
    const id = body.id || "mock-job-1";
    const draft = body.draft || {};
    if (draft.produceShot && draft.presentation === "scene") {
      mockJobs.set(id, {
        id,
        status: "done",
        progress: "已完成",
        output: {
          content: {
            kind: "scene",
            codePrompt: draft.produceShot.codePrompt || "",
            reason: "用纯 SVG 胶囊与进度条动态演示缓释释放过程。",
            decidedBy: "user",
            code: {
              html: `<div class="sc-demo"><svg viewBox="0 0 320 140" width="320" height="140"><rect class="bar" x="20" y="55" width="20" height="30" rx="15" fill="var(--v-primary)"/></svg><div class="pct">0%</div></div>`,
              css: `.sc-demo{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;gap:12px;}.pct{font-size:32px;font-weight:700;color:var(--v-primary);}`,
              js: `const p = api.progress; const r = root.querySelector('.bar'); if (r) r.setAttribute('width', String(Math.round(20 + 260 * p))); const pct = root.querySelector('.pct'); if (pct) pct.textContent = Math.round(p * 100) + '%';`,
            },
          },
        },
      });
    } else if (draft.produceSceneBatch) {
      const contents = {};
      for (const entry of draft.produceSceneBatch) {
        contents[String(entry.index)] = {
          kind: "scene",
          reason: `批量纯代码动画第 ${entry.index + 1} 幕`,
          decidedBy: "user",
          code: {
            html: `<div class="sc-batch">批量纯代码 #${entry.index + 1}</div>`,
            css: `.sc-batch{display:grid;place-items:center;width:100%;height:100%;font-size:28px;color:var(--v-primary);}`,
            js: `const el = root.querySelector('.sc-batch'); if (el) el.style.opacity = String(0.3 + 0.7 * api.progress);`,
          },
        };
      }
      mockJobs.set(id, { id, status: "done", progress: "已完成", output: { contents, errors: {} } });
    } else {
      mockJobs.set(id, { id, status: "error", error: "unexpected mock job" });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id }) });
  });
  await page.route(`${origin}/api/jobs/*`, async (route) => {
    const id = route.request().url().split("/").pop();
    const job = mockJobs.get(id) || { id, status: "error", error: "not found" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(job) });
  });

  await page.goto(origin);
  await page.waitForSelector(".bar");

  // 1. Setup screen mode chips: AI 完整图（推荐）, SVG 动画, 代码动效场景 (no 信息图动效)
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="tpl-video-mode"][data-val="template"]').waitFor();
  const setupModes = await page.locator('[data-action="stage-mode"]').allTextContents();
  assert.deepEqual(setupModes, ["AI 完整图（推荐）", "SVG 动画", "代码动效场景"]);

  // 2. Seed a stage work with 2 shots (svg + scene) and open it
  await page.evaluate(() => {
    const wid = "22222222-2222-4222-8222-222222222222";
    const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
    const work = {
      id: wid,
      type: "video",
      videoMode: "template",
      templateContent: "image",
      templateTheme: "medical",
      templatePresenter: "none",
      title: "缓释片为什么不能掰开吃",
      topic: "缓释片不能掰开",
      drug: "硝苯地平缓释片",
      stage: "script",
      viewingSetup: false,
      settings: { voice: "无配音", music: "off", avatarMode: "static", imageModel: "doubao-seedream-5-5-261028", imageSize: "2K" },
      blocks: [
        { name: "先看药盒标注", line: "拿到药盒先核对缓释字样和说明书。", seconds: 5 },
        { name: "缓释释放原理", line: "缓释片靠完整骨架缓慢释放药效，掰开会骤然释放。", seconds: 6 },
      ],
      stagePlan: {
        layout: { id: "builtin:layout/info-classic" },
        mode: "svg",
        shortTitle: "缓释片别掰开",
        chapters: ["认准标识", "了解原理"],
        disclaimer: "仅供参考",
        audio: { sfx: { pack: "off", stickerSfx: false } },
        shots: [
          {
            name: "先看药盒标注",
            line: "拿到药盒先核对缓释字样和说明书。",
            seconds: 5,
            chapterIndex: 0,
            points: { type: "steps", headline: "先看药盒标注", items: [{ title: "看药盒", detail: "认准缓释字样", tag: "" }], takeaway: "先核对再吃" },
            cues: [{ text: "拿到药盒先核对缓释字样和说明书", focus: "all", weight: 16 }],
            content: { kind: "svg", beats: [{ action: "carton", label: "核对药盒", line: "拿到药盒先核对缓释字样" }] },
            variants: { svg: { kind: "svg", beats: [{ action: "carton", label: "核对药盒", line: "拿到药盒先核对缓释字样" }] } },
          },
          {
            name: "缓释释放原理",
            line: "缓释片靠完整骨架缓慢释放药效，掰开会骤然释放。",
            seconds: 6,
            chapterIndex: 1,
            points: { type: "explain", headline: "缓释释放原理", items: [{ title: "整片吞服", detail: "匀速释放药效", tag: "" }], takeaway: "千万别掰开" },
            cues: [{ text: "缓释片靠完整骨架缓慢释放药效，掰开会骤然释放", focus: "all", weight: 22 }],
            content: { kind: "scene", codePrompt: "画出缓释片匀速释放进度条" },
            variants: { scene: { kind: "scene", codePrompt: "画出缓释片匀速释放进度条" } },
          },
        ],
      },
    };
    raw.works = [work, ...(raw.works || []).filter((x) => x.id !== wid)];
    localStorage.setItem("xixi-studio-v1", JSON.stringify(raw));
  });
  await page.goto(`${origin}/#work/22222222-2222-4222-8222-222222222222`);
  await page.reload();
  await page.waitForSelector('[data-action="stage-kind"]');
  await page.evaluate(() => { config.deepseekKeyPresent = true; });

  // Verify 5 mode chips in editor and NO 信息图动效, NO 本幕插画
  const editorChips = await page.locator('[data-action="stage-kind"]').allTextContents();
  assert.deepEqual(editorChips, ["AI 完整图", "SVG 动画", "代码动效场景", "AI 演示视频", "AI MG 动画"]);
  assert.equal(await page.locator(".stage-art-fields").count(), 0, "SVG 动画 must not render illustration box");
  assert.equal(await page.locator('[data-stage-field="beat-action:0"]').count(), 1, "SVG 动画 must show legacy SVG beat selector");

  // Wait for preview iframe to mount SVG drawing
  const preview = page.frameLocator("#stage-preview");
  await preview.locator(".stage-svg-drawing svg").waitFor({ timeout: 10000 });

  // Switch to shot 2 (代码动效场景) -> no illustration, no form picker, has pure-code prompt UI
  await page.locator('.stage-rail [data-action="stage-select"][data-val="1"]').click();
  assert.equal(await page.locator(".stage-art-fields").count(), 0, "Scene must not render illustration box");
  assert.equal(await page.locator(".stage-form-fields").count(), 0, "Scene must not render legacy form picker");
  assert.equal(await page.locator('[data-stage-field="codePrompt"]').count(), 1, "Scene must show codePrompt textarea");
  assert.equal(await page.locator('[data-action="stage-scene-batch"]').count(), 1, "Topbar should offer batch code animation generation");

  // Click 生成代码动画 -> confirm -> verify pure code mounts in Shadow DOM and animates across timestamps
  await page.locator('[data-action="stage-produce"]').click();
  await page.locator('#dialog [data-action="confirm-paid"]').click();
  await page.waitForSelector(".stage-code-source-box", { timeout: 10000 });
  await preview.locator("[data-custom-code-host]").waitFor({ timeout: 10000 });

  // Verify Shadow DOM renders and updates deterministically with time t
  const animCheck = await page.evaluate(async () => {
    const iframe = document.querySelector("#stage-preview");
    const win = iframe.contentWindow;
    const host = win.document.querySelector("[data-custom-code-host]");
    if (!host || !host.shadowRoot) return { ok: false, reason: "missing shadow root" };
    // Shot 2 starts at t = 5s (shot 1 is 5s), duration = 6s
    win.drawFrame(5.0);
    const t0Pct = host.shadowRoot.querySelector(".pct")?.textContent;
    const t0Width = host.shadowRoot.querySelector(".bar")?.getAttribute("width");
    win.drawFrame(8.0);
    const tMidPct = host.shadowRoot.querySelector(".pct")?.textContent;
    const tMidWidth = host.shadowRoot.querySelector(".bar")?.getAttribute("width");
    return { ok: true, t0Pct, t0Width, tMidPct, tMidWidth };
  });
  assert.equal(animCheck.ok, true, animCheck.reason);
  assert.equal(animCheck.t0Pct, "0%");
  assert.equal(animCheck.t0Width, "20");
  assert.equal(animCheck.tMidPct, "50%");
  assert.equal(animCheck.tMidWidth, "150");

  // Verify live-editing generated code updates preview and 清空代码 works
  await page.locator('[data-action="stage-clear"][data-val="code"]').click();
  assert.equal(await page.locator(".stage-code-source-box").count(), 0, "Clearing code should hide code source box");

  // Verify batch generation button re-appears and works
  await page.locator('[data-action="stage-scene-batch"]').click();
  await page.locator('#dialog [data-action="confirm-paid"]').click();
  await page.waitForSelector(".stage-code-source-box", { timeout: 10000 });
  await preview.locator("[data-custom-code-host]").waitFor({ timeout: 10000 });
  const batchText = await page.evaluate(() => {
    const host = document.querySelector("#stage-preview")?.contentWindow?.document?.querySelector("[data-custom-code-host]");
    return host?.shadowRoot?.querySelector(".sc-batch")?.textContent || "";
  });
  assert.equal(batchText, "批量纯代码 #2");

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: test_svg_and_pure_code_ui.mjs");
} finally {
  await browser.close();
}
