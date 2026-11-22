import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = process.cwd();
const stageUrl = pathToFileURL(resolve(root, "public/stage.html")).href;
const layout = JSON.parse(await readFile(resolve(root, "public/assets/library/layouts/info-classic.json"), "utf8"));

const baseDeck = {
  title: "用药安全演示",
  shortTitle: "用药安全",
  theme: "medical",
  presenter: "none",
  chapters: ["原理", "注意"],
  slides: [
    {
      name: "开场",
      line: "先看第一幕内容。",
      chapterIndex: 0,
      type: "cover",
      headline: "开场要点",
      points: [{ title: "要点一", desc: "说明一" }],
    },
    {
      name: "第二幕",
      line: "接着看第二幕。",
      chapterIndex: 1,
      type: "explain",
      headline: "核心机制",
      points: [{ title: "机制一", desc: "详情一" }, { title: "机制二", desc: "详情二" }],
    },
    {
      name: "第三幕",
      line: "第三幕使用常规矢量道具。",
      chapterIndex: 1,
      type: "steps",
      headline: "核对说明书",
      action: "leaflet",
      svgBeats: [{ action: "leaflet", line: "核对说明书", label: "核对说明书" }],
      points: [{ title: "看用法", desc: "逐项核对" }],
    },
  ],
};

function makePlan(transition = "fade") {
  return {
    fps: 24,
    frames: 24 * 12,
    layout,
    deck: baseDeck,
    images: {},
    shots: [
      {
        start: 0, end: 4, kind: "scene", name: "开场", visual: "hook", motion: "focus-zoom", motif: "pill", tone: "primary",
        items: [{ title: "要点一", detail: "说明一" }],
        captions: [{ start: 0, end: 4, text: "先看第一幕内容。", focus: "all" }],
      },
      {
        start: 4, end: 8, kind: "scene", name: "第二幕", transition, visual: "mechanism", motion: "reveal", motif: "pill", tone: "primary",
        items: [{ title: "机制一", detail: "详情一" }, { title: "机制二", detail: "详情二" }],
        captions: [{ start: 4, end: 8, text: "接着看第二幕。", focus: "all" }],
      },
      {
        start: 8, end: 12, kind: "svg", name: "第三幕", transition: "slide",
        beats: [{ action: "leaflet", line: "核对说明书", label: "核对说明书" }],
        captions: [{ start: 8, end: 12, text: "第三幕使用常规矢量道具。", focus: "all" }],
      },
    ],
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(stageUrl);

  const allKinds = ["fade", "slide", "zoom-in", "zoom-out", "wipe", "push-left", "slide-up", "wipe-up", "blur", "iris"];
  for (const kind of allKinds) {
    await page.evaluate((p) => setPlan(p), makePlan(kind));

    // 1. Verify stationary outer .media-slot frame & smooth inner transition layers
    const snap = await page.evaluate(() => {
      const probe = (time) => {
        drawFrame(time);
        const slot = document.querySelector(".media-slot");
        const curr = slot.querySelector(".stage-curr-slot");
        const prev = slot.querySelector(".stage-prev-slot");
        const cmScene = curr.querySelector(".cm-scene");
        const cmHead = curr.querySelector("[data-cm-heading]");
        const rect = slot.getBoundingClientRect();
        return {
          slotInline: {
            opacity: slot.style.opacity,
            transform: slot.style.transform,
            clipPath: slot.style.clipPath,
            filter: slot.style.filter,
          },
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          hasPrevInsideSlot: Boolean(prev && prev.parentElement === slot),
          hasCurrInsideSlot: Boolean(curr && curr.parentElement === slot),
          currStyle: {
            opacity: curr.style.opacity,
            transform: curr.style.transform,
            clipPath: curr.style.clipPath,
            filter: curr.style.filter,
          },
          prevOpacity: prev ? Number(prev.style.opacity) : null,
          prevTransform: prev ? prev.style.transform : null,
          cmSceneOpacity: cmScene ? Number(cmScene.style.opacity) : null,
          cmHeadOpacity: cmHead ? Number(cmHead.style.opacity) : null,
        };
      };
      return {
        start: probe(4.0),
        mid: probe(4.21),
        almostEnd: probe(4.415),
        done: probe(4.45),
      };
    });

    for (const phase of ["start", "mid", "almostEnd", "done"]) {
      assert.deepEqual(snap[phase].slotInline, { opacity: "", transform: "", clipPath: "", filter: "" },
        `${kind}/${phase}: outer .media-slot must never be transformed/faded/clipped`);
      assert.deepEqual(snap[phase].rect, snap.done.rect,
        `${kind}/${phase}: outer .media-slot rect must stay completely stationary`);
      assert.equal(snap[phase].hasCurrInsideSlot, true, `${kind}/${phase}: .stage-curr-slot must live inside .media-slot`);
    }

    assert.equal(snap.start.hasPrevInsideSlot, true, `${kind}: prev layer must live inside .media-slot at t=0`);
    assert.equal(snap.start.prevOpacity, 1, `${kind}: prev layer must start at opacity 1`);
    assert.ok(snap.mid.prevOpacity > 0.5 && snap.mid.prevOpacity < 0.9,
      `${kind}: mid-transition prevOpacity should be rich (got ${snap.mid.prevOpacity})`);
    assert.ok(snap.almostEnd.prevOpacity >= 0 && snap.almostEnd.prevOpacity < 0.05,
      `${kind}: prev layer must fade cleanly to ~0 before removal (got ${snap.almostEnd.prevOpacity})`);
    assert.equal(snap.done.hasPrevInsideSlot, false, `${kind}: prev layer must be cleaned up after transition`);
    assert.deepEqual(snap.done.currStyle, { opacity: "", transform: "", clipPath: "", filter: "" },
      `${kind}: curr layer inline styles must be cleared after transition`);

    // 2. Verify incoming dynamic scene does NOT double-fade to a blank board at t=0
    assert.equal(snap.start.cmSceneOpacity, 1, `${kind}: incoming .cm-scene must not double-fade to 0`);
    assert.ok(snap.start.cmHeadOpacity >= 0.8, `${kind}: incoming heading must already be legible during transition (got ${snap.start.cmHeadOpacity})`);
  }

  // 3. Verify non-code (legacy SVG) shot keeps DOM & prevLayer mounted across transition frames (no per-frame DOM rebuild!)
  await page.evaluate((p) => setPlan(p), makePlan("slide"));
  const domIdentity = await page.evaluate(() => {
    drawFrame(8.05);
    const slot1 = document.querySelector(".media-slot");
    const prev1 = document.querySelector(".stage-prev-slot");
    const curr1 = document.querySelector(".stage-curr-slot");
    drawFrame(8.15);
    const slot2 = document.querySelector(".media-slot");
    const prev2 = document.querySelector(".stage-prev-slot");
    const curr2 = document.querySelector(".stage-curr-slot");
    drawFrame(8.30);
    const slot3 = document.querySelector(".media-slot");
    const prev3 = document.querySelector(".stage-prev-slot");
    const curr3 = document.querySelector(".stage-curr-slot");
    return {
      sameSlot: slot1 === slot2 && slot2 === slot3,
      samePrev: Boolean(prev1) && prev1 === prev2 && prev2 === prev3,
      sameCurr: Boolean(curr1) && curr1 === curr2 && curr2 === curr3,
    };
  });
  assert.deepEqual(domIdentity, { sameSlot: true, samePrev: true, sameCurr: true },
    `Non-code shot must keep slot/prev/curr mounted across transition frames: ${JSON.stringify(domIdentity)}`);

  // 4. Verify scrubbing determinism across arbitrary order
  const times = [0.2, 4.0, 4.18, 4.45, 8.0, 8.2, 8.5, 11.2];
  const baseline = await page.evaluate((ts) => ts.map((t) => {
    drawFrame(t);
    return document.querySelector("#stage-frame").innerHTML;
  }), times);
  const shuffled = [8.2, 0.2, 4.45, 11.2, 4.0, 8.5, 4.18, 8.0];
  const rechecked = await page.evaluate((ts) => ts.map((t) => {
    drawFrame(t);
    return document.querySelector("#stage-frame").innerHTML;
  }), shuffled);
  shuffled.forEach((t, idx) => {
    const expected = baseline[times.indexOf(t)];
    assert.equal(rechecked[idx], expected, `Deterministic HTML mismatch when scrubbing to t=${t}`);
  });

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: test_stage_transitions.mjs (all 10 transition kinds, stationary frame, zero pop, zero DOM rebuild, deterministic scrubbing)");
} finally {
  await browser.close();
}
