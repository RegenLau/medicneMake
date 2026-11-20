import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = process.env.STAGE_BASELINE || "da84bdf";
const temp = await mkdtemp(join(tmpdir(), "stage-frames-"));
const output = process.argv[2] ? resolve(process.argv[2]) : null;
const width = 1280;
const height = 720;
const limit = { mean: .12, fractionAboveEight: .0001 };
const samples = [0, .25, .5, .75, 1];
const seconds = 4;
const name = "核对手边的用药资料";
const avatar = "/assets/template-doctor-digital.jpg";
const image = "/assets/template-info-tablet.jpg";
const readAsset = async url => `data:image/jpeg;base64,${(await readFile(join(root, "public", url))).toString("base64")}`;
const images = { [avatar]: await readAsset(avatar), [image]: await readAsset(image) };
const appearance = { title: name, shortTitle: "用药资料", chapters: ["看清信息", "再核对"], presenter: "digital", theme: "medical" };
const shared = { name, line: "对照说明书和用药记录。", start: 0, end: seconds, seconds, chapterIndex: 0 };
const stillCues = [{ start: 0, end: seconds, text: "对照说明书和用药记录", focus: "all" }];
const contentCues = [
  { start: 0, end: 2, text: "先核对说明书", focus: "0", highlightWords: ["说明书"] },
  { start: 2, end: seconds, text: "再核对用药记录", focus: "1", highlightWords: ["用药记录"] },
];
const card = { ...shared, headline: name, type: "steps", layoutMode: "explain", motionStyle: "reveal",
  steps: [{ title: "先核对说明书", desc: "确认对应栏目" }, { title: "再看记录", desc: "逐项查对" }] };
const scene = { ...shared, visual: "checklist", motion: "spotlight", motif: "checklist", tone: "safe",
  items: [{ title: "说明书", detail: "确认对应栏目" }, { title: "用药记录", detail: "逐项查对" }],
  labels: ["说明书", "用药记录"], takeaway: "逐项核对记录", captions: contentCues };
const svg = { ...shared, action: "leaflet", beats: [
  { action: "leaflet", line: "先核对说明书。", label: "核对说明书" },
  { action: "log", line: "再核对用药记录。", label: "核对记录" },
], subtitles: [{ text: "先核对说明书", end: .5 }, { text: "再核对用药记录", end: 1 }] };
const hook = { ...shared, type: "cover", layoutMode: "hook", question: "说明书先看哪里？", answer: "对照相关栏目" };
const outro = { ...shared, type: "summary", layoutMode: "explain", outroNote: "带上包装，方便再次核对" };
const cases = [
  { id: "image", kind: "image", slide: { ...shared, contentImage: image, type: "explain", layoutMode: "explain" }, captions: stillCues },
  { id: "card", kind: "card", slide: card, legacy: { ...shared, visual: card, captions: contentCues } },
  { id: "scene", kind: "scene", slide: { ...scene, type: "explain", layoutMode: "explain", highlightWords: scene.labels }, legacy: scene },
  { id: "svg", kind: "svg", legacy: svg, captions: contentCues.map(({ highlightWords, ...cue }) => ({ ...cue, focus: "all" })) },
  { id: "hook", kind: "image", slide: hook, captions: stillCues.map(cue => ({ ...cue, focus: "question" })) },
  { id: "outro", kind: "image", slide: outro, captions: stillCues.map(cue => ({ ...cue, focus: "outro" })) },
];

async function loadBaseline() {
  for (const path of ["code-motion.html", "code-motion.js", "template-renderer.js", "template-renderer.css", "svg-motion.js", "assets/library/fonts/studio-fonts.css"]) {
    const target = join(temp, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, execFileSync("git", ["show", `${baseline}:public/${path}`], { cwd: root }));
  }
}

function pixels(buffer) {
  return execFileSync(process.env.FFMPEG || "ffmpeg", ["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo",
    "-pix_fmt", "rgb24", "pipe:1"], { input: buffer, maxBuffer: width * height * 4 });
}

function difference(before, after) {
  const a = pixels(before), b = pixels(after);
  if (a.length !== b.length || a.length !== width * height * 3) throw Error("截图尺寸不符");
  let total = 0, count = 0, differing = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = [Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])];
    total += d[0] + d[1] + d[2];
    if (Math.max(...d) > 8) count += 1;
    if (Math.max(...d) > 0) differing += 1;
  }
  return { mean: total / a.length, fractionAboveEight: count / (width * height), differing };
}

async function ready(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
}

let browser;
try {
  await loadBaseline();
  if (output) await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const opts = { viewport: { width, height }, deviceScaleFactor: 1 };
  const legacyPage = await browser.newPage(opts);
  const newPage = await browser.newPage(opts);
  const layout = JSON.parse(await readFile(join(root, "public/assets/library/layouts/info-classic.json"), "utf8"));
  await newPage.goto(pathToFileURL(join(root, "public/stage.html")).href);
  const results = [];
  for (const fixture of cases) {
    await legacyPage.goto(pathToFileURL(join(temp, "code-motion.html")).href);
    let deck = { ...appearance, slides: [fixture.slide] };
    if (fixture.kind === "svg") {
      await legacyPage.addScriptTag({ path: join(temp, "svg-motion.js") });
      deck = await legacyPage.evaluate(([appearance, shot]) => SvgMotion.templateDeck(appearance, [shot]), [appearance, fixture.legacy]);
    }
    const code = fixture.kind === "card" || fixture.kind === "scene";
    if (code) {
      await legacyPage.evaluate(plan => setMotionPlan(plan), {
        ...appearance, appearance, shots: [fixture.legacy], localAvatar: images[avatar],
        ...(fixture.kind === "card" ? { templateInfo: { shortTitle: appearance.shortTitle, chapters: appearance.chapters } } : {}),
      });
    }
    const shot = { ...(fixture.legacy || shared), kind: fixture.kind, captions: fixture.captions ?? fixture.legacy.captions };
    await newPage.evaluate(plan => setPlan(plan), { layout, deck, images, shots: [shot], compatibility: fixture.kind });
    for (const progress of samples) {
      if (code) {
        await legacyPage.evaluate(time => drawMotionFrame(time), progress * seconds);
      } else {
        await legacyPage.evaluate(({ deck, images, progress, kind, cue, intervals }) => {
          const imgMap = new Map(Object.entries(images));
          const markup = kind === "svg"
            ? SvgMotion.frame(deck, 0, progress, { imgMap, subtitles: intervals })
            : TemplateVideo.renderFrameHtml(deck, 0, { focus: cue.focus, subtitleText: cue.text, imgMap, progress });
          document.querySelector("#motion-frame").innerHTML = markup;
        }, { deck, images, progress, kind: fixture.kind, cue: fixture.captions[0], intervals: fixture.legacy?.subtitles });
      }
      await newPage.evaluate(time => drawFrame(time), progress * seconds);
      await Promise.all([ready(legacyPage), ready(newPage)]);
      const before = await legacyPage.screenshot({ animations: "disabled" });
      const after = await newPage.screenshot({ animations: "disabled" });
      const diff = difference(before, after);
      results.push({ case: fixture.id, progress, ...diff });
      if (output) {
        await writeFile(join(output, `${fixture.id}-${progress}-old.png`), before);
        await writeFile(join(output, `${fixture.id}-${progress}-stage.png`), after);
      }
    }
  }
  console.log(JSON.stringify({ baseline, limit, frames: results }, null, 2));
  if (results.some(row => row.mean > limit.mean || row.fractionAboveEight > limit.fractionAboveEight)) process.exitCode = 1;
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
