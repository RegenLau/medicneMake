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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-ui-"));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const work = {
      id: "w-hl-test",
      type: "video",
      videoMode: "template",
      templateTheme: "medical",
      templatePresenter: "none",
      stage: "script",
      title: "腿抽筋先别急着补钙",
      topic: "腿抽筋是不是缺钙",
      drug: "",
      created: Date.now(),
      updated: Date.now(),
      settings: { ratio: "16:9", voice: "刘飞 2.0", music: "off", avatarMode: "static" },
      blocks: [
        { name: "开场误区", line: "腿抽筋，先别急着补钙。\n多数抽筋和缺钙没直接关系。", seconds: 5.16 },
      ],
      stagePlan: {
        layout: { id: "builtin:layout/info-classic" },
        mode: "card",
        audio: { sfx: { pack: "off", stickerSfx: false } },
        shortTitle: "腿抽筋先别急着补钙",
        chapters: ["先看误区", "常见原因"],
        disclaimer: "仅供用药科普参考",
        shots: [
          {
            name: "开场误区",
            line: "腿抽筋，先别急着补钙。\n多数抽筋和缺钙没直接关系。",
            seconds: 5.16,
            chapterIndex: 0,
            speech: {
              line: "腿抽筋，先别急着补钙。\n多数抽筋和缺钙没直接关系。",
              voice: "刘飞 2.0",
              url: "/assets/music/calm.flac",
              seconds: 4.61,
            },
            points: {
              type: "explain",
              headline: "腿抽筋，先别急着补钙",
              takeaway: "先排查受凉疲劳和电解质",
              items: [{ title: "多数与缺钙无关", detail: "", tag: "" }],
              highlightWords: ["先别急着补钙"],
            },
            cues: [
              { text: "腿抽筋，先别急着补钙", weight: 10, focus: "all", highlightWords: ["先别急着补钙"] },
              { text: "多数抽筋和缺钙没直接关系", weight: 12, focus: "all", highlightWords: [] },
            ],
            content: { kind: "card", motionStyle: "auto" },
            variants: {},
          },
        ],
      },
    };
    const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
    raw.works = [work, ...(raw.works || []).filter((x) => x.id !== work.id)];
    localStorage.setItem("xixi-studio-v1", JSON.stringify(raw));
  });

  await page.goto(`${origin}/#work/w-hl-test`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#stage-line-input");
  await page.waitForFunction(() => Boolean(document.querySelector("#stage-preview")?.isReady?.()));
  await page.waitForTimeout(250);

  const readPreviewSubtitle = () =>
    page.evaluate(() => {
      const doc = document.querySelector("#stage-preview")?.contentDocument;
      const sub = doc?.querySelector(".pt-subtitle");
      return {
        text: sub?.textContent?.trim() || "",
        hls: [...(sub?.querySelectorAll(".pt-sub-hl") || [])].map((el) => el.textContent),
      };
    });

  const readBackdropMarks = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#stage-line-backdrop .stage-narration-hl")].map((el) => el.textContent),
    );

  const readChips = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#stage-narration-highlights .stage-hl-chip-jump")].map((el) => el.textContent),
    );

  const selectSubstring = (substr) =>
    page.evaluate((sub) => {
      const ta = document.querySelector("#stage-line-input");
      ta.focus();
      const idx = ta.value.indexOf(sub);
      if (idx === -1) throw new Error(`Substring not found: ${sub}`);
      ta.setSelectionRange(idx, idx + sub.length);
      ta.dispatchEvent(new Event("select", { bubbles: true }));
    }, substr);

  // 1. Initial state: line 1 highlight synced in preview, backdrop, and chips; no redundant toolbar button
  assert.deepEqual(await readBackdropMarks(), ["先别急着补钙"]);
  assert.deepEqual(await readChips(), ["先别急着补钙"]);
  const initSub = await readPreviewSubtitle();
  assert.equal(initSub.text, "腿抽筋，先别急着补钙");
  assert.deepEqual(initSub.hls, ["先别急着补钙"]);
  assert.equal(await page.locator("#stage-hl-btn").count(), 0);

  // 2. Select "缺钙" on line 2 -> floating popover activates -> click popover to highlight
  await selectSubstring("缺钙");
  await page.waitForTimeout(80);
  assert.equal(await page.locator("#stage-hl-popover").isVisible(), true);
  assert.match(await page.locator("#stage-hl-pop-btn").textContent(), /标为高亮/);

  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(300);

  // Preview should auto-seek to cue 2 and show "缺钙" highlighted; cached speech stays intact!
  assert.deepEqual(await readBackdropMarks(), ["先别急着补钙", "缺钙"]);
  assert.deepEqual(await readChips(), ["先别急着补钙", "缺钙"]);
  const afterAddSub = await readPreviewSubtitle();
  assert.equal(afterAddSub.text, "多数抽筋和缺钙没直接关系");
  assert.deepEqual(afterAddSub.hls, ["缺钙"]);
  assert.equal(await page.locator("#stage-speech-btn .stage-speech-tag").textContent(), "已缓存");

  // 3. Select "先别急着补钙。" (with trailing punctuation!) -> recognized as highlighted -> remove via popover
  await selectSubstring("先别急着补钙。");
  await page.waitForTimeout(80);
  assert.match(await page.locator("#stage-hl-pop-btn").textContent(), /取消高亮/);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(300);

  // Line 1 should now have ZERO highlights (must NOT fall back to shot.points.highlightWords!)
  assert.deepEqual(await readBackdropMarks(), ["缺钙"]);
  assert.deepEqual(await readChips(), ["缺钙"]);
  const afterRemoveSub = await readPreviewSubtitle();
  assert.equal(afterRemoveSub.text, "腿抽筋，先别急着补钙");
  assert.deepEqual(afterRemoveSub.hls, []);

  // 4. Add adjacent "没直接关系" -> merges with "缺钙" into "缺钙没直接关系", then unhighlight "直接" -> splits into ["缺钙没", "关系"]
  await selectSubstring("没直接关系");
  await page.waitForTimeout(60);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(250);
  assert.deepEqual(await readChips(), ["缺钙没直接关系"]);

  await selectSubstring("直接");
  await page.waitForTimeout(60);
  assert.match(await page.locator("#stage-hl-pop-btn").textContent(), /取消高亮/);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(250);
  const splitSub = await readPreviewSubtitle();
  assert.deepEqual(splitSub.hls, ["缺钙没", "关系"]);

  // 4b. Highlight a non-adjacent single char "抽" -> works independently without merging
  await selectSubstring("多数抽筋");
  await page.waitForTimeout(60);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(250);
  assert.deepEqual(await readChips(), ["多数抽筋", "缺钙没", "关系"]);

  // 5. Remove one chip via "×", then clear all via "清空"
  await page.locator('#stage-narration-highlights .stage-hl-chip-del').first().click();
  await page.waitForTimeout(250);
  assert.deepEqual(await readChips(), ["缺钙没", "关系"]);

  await page.locator('#stage-narration-highlights [data-action="stage-hl-clear"]').click();
  await page.waitForTimeout(250);
  assert.deepEqual(await readBackdropMarks(), []);
  assert.deepEqual(await readChips(), []);
  const clearedSub = await readPreviewSubtitle();
  assert.deepEqual(clearedSub.hls, []);

  // 5b. Single-character highlight ("钙") renders in subtitle
  await selectSubstring("钙");
  await page.waitForTimeout(60);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(250);
  const singleCharSub = await readPreviewSubtitle();
  assert.deepEqual(singleCharSub.hls, ["钙"]);
  await page.locator('#stage-narration-highlights [data-action="stage-hl-clear"]').click();
  await page.waitForTimeout(200);

  // 6. Multiline selection should keep popover hidden
  await selectSubstring("补钙。\n多数");
  await page.waitForTimeout(60);
  assert.equal(await page.locator("#stage-hl-popover").isVisible(), false);

  // 7. Highlight a word, then split line with Enter -> highlight follows to the right split cue
  await selectSubstring("先别急着补钙");
  await page.waitForTimeout(60);
  await page.locator("#stage-hl-pop-btn").click();
  await page.waitForTimeout(250);
  assert.deepEqual(await readChips(), ["先别急着补钙"]);
  await page.locator("#stage-line-input").fill("腿抽筋，\n先别急着补钙。\n多数抽筋和缺钙没直接关系。");
  await page.waitForTimeout(250);
  assert.deepEqual(await readChips(), ["先别急着补钙"]);
  assert.deepEqual(await readBackdropMarks(), ["先别急着补钙"]);

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: narration highlight UI end-to-end verification succeeded");
} finally {
  await browser.close();
  srv.kill("SIGTERM");
  fs.rmSync(tempDir, { recursive: true, force: true });
}
