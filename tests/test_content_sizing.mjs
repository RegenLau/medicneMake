import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (OUT_DIR) fs.mkdirSync(OUT_DIR, { recursive: true });

const ALL_LAYOUTS = [
  "info-classic",
  "corner-presenter",
  "chapter-nav",
  "broadcast",
  "takeaway",
  "qa-chat",
  "headline",
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function fileDataUrl(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

function makeSvgImageDataUrl(w, h, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#eaf4ff"/>
    <rect x="12" y="12" width="${w - 24}" height="${h - 24}" rx="18" fill="none" stroke="#1466cc" stroke-width="6"/>
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="34" font-family="sans-serif" fill="#122d4c">${label} (${w}x${h})</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const DIGITAL_AVATAR = fileDataUrl(path.join(ROOT, "public/assets/template-doctor-digital.jpg"));

function baseDeck(layoutId, slide, themeId = "medical") {
  const themeDef = readJson(`public/assets/library/themes/${themeId}.json`);
  return {
    title: "降压药忘吃了，要不要补？",
    shortTitle: "降压药漏服怎么补？",
    drug: "硝苯地平缓释片",
    drugTags: ["缓释片", "处方药"],
    theme: themeDef.base === "warm" ? "warm" : "medical",
    themeId: `builtin:theme/${themeId}`,
    themeVars: themeDef.vars,
    themeGlass: Boolean(themeDef.glass),
    presenter: "digital",
    pharmacist: { name: "李明远", role: "主任药师", hospital: "北京协和医院" },
    disclaimer: "科普内容仅供参考，具体诊疗与用药请遵医嘱",
    chapters: ["判断时间", "正确补服", "安全收口"],
    slides: [slide],
  };
}

const ITEMS_4 = [
  { title: "先看离下次服药多久", detail: "按服药间隔的一半判断", tag: "08:00" },
  { title: "没过半就按常规量补", detail: "想起来补服一次即可", tag: "14:00" },
  { title: "已过半就跳过这一次", detail: "等下次到点照常服药", tag: "20:00" },
  { title: "绝不一次吃双倍剂量", detail: "避免血压骤降引发头晕", tag: "注意" },
];
const ITEMS_3 = ITEMS_4.slice(0, 3);
const ITEMS_2 = ITEMS_4.slice(0, 2);

const COMPARE_COLS_3 = [
  { title: "间隔未过半", badge: "可补服", points: ["想起来就补一次", "只吃常规剂量", "次日照常服药"] },
  { title: "间隔已过半", badge: "跳过本次", points: ["直接跳过漏服", "到下次正常吃", "严禁吃双倍"] },
  { title: "反复漏服", badge: "问药师", points: ["设置每日闹钟", "记录服药情况", "复诊评估方案"] },
];

function makeSlide(type, items, extra = {}) {
  return {
    name: "漏服降压药怎么办",
    headline: "漏服了，也只吃一次",
    accentPhrase: "也只吃一次",
    lead: "按离下次服药是否过半来决定补服或跳过。",
    line: "间隔还不到一半想起来就补上，已经过半就跳过不要加倍。",
    type,
    layoutMode: "explain",
    chapterIndex: 1,
    question: "昨天忘吃降压药，今天吃两片补回来行吗？",
    answer: "不行，只吃常规剂量",
    verdictTone: "no",
    takeaway: "一次只吃常规量，漏服绝不加倍",
    footerNote: "一次只吃常规量，漏服绝不加倍",
    pills: ["未过半可补服", "过半就跳过", "绝不吃双倍"],
    points: items.map(({ title, detail, tag }) => ({ title, desc: detail, tag })),
    steps: items.map(({ title, detail }) => ({ title, desc: detail })),
    warnings: items.map(({ title, detail }) => ({ title, desc: detail })),
    columns: type === "compare" ? COMPARE_COLS_3.slice(0, items.length) : undefined,
    checks: ["看服药时间", "算间隔一半", "只吃常规量", "绝不加倍"].slice(0, items.length),
    ...extra,
  };
}

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });
  const stageUrl = pathToFileURL(path.join(ROOT, "public/stage.html")).href;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(stageUrl, { waitUntil: "networkidle" });

    // 1. Verify LayoutEngine.describeMediaSlot, imagePixelSize, and prompt adaptation
    const layouts = Object.fromEntries(
      ALL_LAYOUTS.map((id) => [id, readJson(`public/assets/library/layouts/${id}.json`)]),
    );
    const themes = Object.fromEntries(
      ["medical", "warm", "mint", "night", "illus", "photo"].map((id) => [
        id, { id: `builtin:theme/${id}`, ...readJson(`public/assets/library/themes/${id}.json`) },
      ]),
    );

    const promptChecks = await page.evaluate(({ layouts, themes }) => {
      const results = {};
      const sampleDeck = {
        title: "腿抽筋，先别急着补钙",
        shortTitle: "腿抽筋原因",
        theme: "medical",
        slides: [{
          name: "腿抽筋原因不止缺钙",
          headline: "腿抽筋，先别急着补钙",
          type: "steps",
          steps: [
            { title: "受凉劳累", desc: "也会引起抽筋" },
            { title: "姿势不当", desc: "肌肉容易痉挛" },
            { title: "排查原因", desc: "再对症处理" },
            { title: "必要就医", desc: "频繁抽筋问医生" },
          ],
          points: [
            { title: "受凉劳累", desc: "也会引起抽筋" },
            { title: "姿势不当", desc: "肌肉容易痉挛" },
            { title: "排查原因", desc: "再对症处理" },
            { title: "必要就医", desc: "频繁抽筋问医生" },
          ],
          footerNote: "排查原因再补钙",
        }],
      };
      for (const [id, layout] of Object.entries(layouts)) {
        const slot = LayoutEngine.describeMediaSlot(layout);
        const px2k = LayoutEngine.imagePixelSize("2K", slot.w, slot.h);
        const prompt = TemplateVideo.buildCardImagePrompt(sampleDeck, 0, "", "碳酸钙片", layout, themes.medical);
        const outroPrompt = TemplateVideo.buildOutroImagePrompt(sampleDeck, 0, "", "碳酸钙片", layout, themes.night);
        results[id] = { slot, px2k, prompt, outroPrompt };
      }
      return results;
    }, { layouts, themes });

    assert.equal(promptChecks.broadcast.slot.w, 1280);
    assert.equal(promptChecks.broadcast.slot.h, 504);
    assert.equal(promptChecks.broadcast.slot.ratioLabel, "2.54:1");
    assert.equal(promptChecks.broadcast.px2k, "3264x1280");
    assert(promptChecks.broadcast.prompt.includes("2.54:1"));
    assert(promptChecks.broadcast.prompt.includes("1280×504"));
    assert(promptChecks.broadcast.prompt.includes("超宽横幅"));
    assert(!promptChecks.broadcast.prompt.includes("严格 16:9"));

    assert.equal(promptChecks["qa-chat"].slot.w, 1120);
    assert.equal(promptChecks["qa-chat"].slot.h, 388);
    assert.equal(promptChecks["qa-chat"].slot.ratioLabel, "2.89:1");
    assert.equal(promptChecks["qa-chat"].px2k, "3472x1200");
    assert(promptChecks["qa-chat"].prompt.includes("2.89:1"));
    assert(promptChecks["qa-chat"].prompt.includes("1120×388"));
    assert(promptChecks["qa-chat"].prompt.includes("扁宽单排"));
    assert(promptChecks["qa-chat"].prompt.includes("不要重复画患者提问气泡"));
    assert(!promptChecks["qa-chat"].prompt.includes("严格 16:9"));

    assert.equal(promptChecks.headline.slot.w, 642);
    assert.equal(promptChecks.headline.slot.h, 510);
    assert.equal(promptChecks.headline.slot.ratioLabel, "1.26:1");
    assert.equal(promptChecks.headline.slot.art.placement, "top");
    assert.equal(promptChecks.headline.px2k, "2304x1824");
    assert(promptChecks.headline.prompt.includes("1.26:1"));
    assert(promptChecks.headline.prompt.includes("2×2 对称四格"));
    assert(promptChecks.headline.prompt.includes("左侧海报已展示大标题"));
    assert(promptChecks.headline.outroPrompt.includes("#0f1828"));

    assert.equal(promptChecks.takeaway.slot.w, 820);
    assert.equal(promptChecks.takeaway.slot.h, 460);
    assert(promptChecks.takeaway.prompt.includes("右侧要点栏"));

    assert.equal(promptChecks["chapter-nav"].slot.w, 944);
    assert.equal(promptChecks["chapter-nav"].slot.h, 512);
    assert(promptChecks["chapter-nav"].prompt.includes("1.84:1"));

    assert.equal(promptChecks["info-classic"].px2k, "2848x1600");
    assert(promptChecks["info-classic"].prompt.includes("严格 16:9"));

    // 2. Render & verify ALL 7 layouts across ALL content kinds (image, card, scene, art, svg, mg)
    const summary = { checked: 0, stepsAlignmentMaxDiff: 0, artPanelMaxDiffPx: 0 };

    async function renderAndCheck(layoutId, shot, slide, extraCheck = null, screenshotName = null) {
      const layout = layouts[layoutId];
      const plan = {
        layout,
        deck: baseDeck(layoutId, slide),
        shots: [{ ...slide, ...shot, start: 0, end: 5, captions: [{ start: 0, end: 5, text: slide.line, focus: "1" }] }],
        images: { "/assets/template-doctor-digital.jpg": DIGITAL_AVATAR },
      };
      await page.evaluate(async (p) => {
        await window.setPlan(p);
        await window.drawFrame(2.8);
        await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
      }, plan);

      const metrics = await page.evaluate(() => {
        const slot = document.querySelector(".pt-media-slot");
        const rect = slot.getBoundingClientRect();
        const overflow = {
          sw: slot.scrollWidth, cw: slot.clientWidth,
          sh: slot.scrollHeight, ch: slot.clientHeight,
          hasOverflow: slot.scrollWidth > slot.clientWidth + 1 || slot.scrollHeight > slot.clientHeight + 1,
        };
        const img = slot.querySelector(".pt-media-img");
        const svg = slot.querySelector(".stage-svg-drawing svg");
        const art = slot.querySelector(".cm-art-panel");
        let stepsAlign = null;
        const stepNodes = [...slot.querySelectorAll(".cm-steps-track .cm-st-node")];
        const stepCards = [...slot.querySelectorAll(".cm-steps-cards .cm-step-card")];
        const stepTrack = slot.querySelector(".cm-steps-track");
        if (stepNodes.length && stepTrack && getComputedStyle(stepTrack).display !== "none" && stepNodes.length === stepCards.length) {
          const cx = (el) => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2; };
          const diffs = stepNodes.map((n, i) => Math.abs(cx(n) - cx(stepCards[i])));
          stepsAlign = { maxDiff: Math.max(...diffs) };
        }
        // Check if any inner card overflows the media slot vertically or horizontally
        const clipped = [];
        for (const el of slot.querySelectorAll(".cm-item, .cm-takeaway, .cm-heading, .pt-fb-headline, .pt-fb-tip-bar, .pt-fb-step-tile, .pt-fb-explain-card, .pt-fb-warn-tile, .pt-fb-summary-row, .pt-fb-compare-col")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom > rect.bottom + 2 || r.right > rect.right + 2 || r.top < rect.top - 2 || r.left < rect.left - 2) {
            clipped.push({ cls: el.className, r: { t: r.top, b: r.bottom, l: r.left, ri: r.right }, slot: { t: rect.top, b: rect.bottom, l: rect.left, ri: rect.right } });
          }
        }
        return {
          slotRect: { w: Math.round(rect.width), h: Math.round(rect.height) },
          overflow,
          clipped,
          imgContain: img ? img.classList.contains("is-contain") : null,
          svgViewBox: svg ? svg.getAttribute("viewBox") : null,
          artRect: art ? { w: Math.round(art.getBoundingClientRect().width), h: Math.round(art.getBoundingClientRect().height) } : null,
          stepsAlign,
        };
      });

      summary.checked += 1;
      assert.equal(metrics.overflow.hasOverflow, false, `Slot overflow in ${layoutId}/${shot.kind}/${shot.visual || slide.type}: ${JSON.stringify(metrics.overflow)}`);
      assert.equal(metrics.clipped.length, 0, `Inner element clipped in ${layoutId}/${shot.kind}/${shot.visual || slide.type}: ${JSON.stringify(metrics.clipped)}`);
      if (metrics.stepsAlign) {
        summary.stepsAlignmentMaxDiff = Math.max(summary.stepsAlignmentMaxDiff, metrics.stepsAlign.maxDiff);
        assert(metrics.stepsAlign.maxDiff <= 1.0, `Steps track misaligned in ${layoutId}: diff=${metrics.stepsAlign.maxDiff}px`);
      }
      if (extraCheck) extraCheck(metrics);
      if (OUT_DIR && screenshotName) {
        await page.screenshot({ path: path.join(OUT_DIR, `${screenshotName}.png`) });
      }
    }

    for (const layoutId of ALL_LAYOUTS) {
      const slot = promptChecks[layoutId].slot;

      // (a) Image: matched ratio -> cover (no is-contain); mismatched 16:9 -> is-contain on non-16:9 layouts
      const matchedUrl = makeSvgImageDataUrl(slot.w, slot.h, `${layoutId} matched`);
      await renderAndCheck(layoutId, { kind: "image" }, makeSlide("explain", ITEMS_3, { contentImage: matchedUrl }), (m) => {
        assert.equal(m.imgContain, false, `${layoutId} matched image should stay full-bleed cover`);
      }, ["broadcast", "qa-chat", "headline"].includes(layoutId) ? `${layoutId}-image-matched` : null);

      if (Math.abs((16 / 9) - slot.aspect) / slot.aspect > 0.12) {
        const legacy169 = makeSvgImageDataUrl(1280, 720, `${layoutId} legacy 16:9`);
        await renderAndCheck(layoutId, { kind: "image" }, makeSlide("explain", ITEMS_3, { contentImage: legacy169 }), (m) => {
          assert.equal(m.imgContain, true, `${layoutId} mismatched 16:9 image must use contain to avoid text cropping`);
        }, `${layoutId}-image-legacy-contain`);
      }

      // (b) Card (renderFallbackCard): test all types with 3 & 4 items
      for (const [cardType, items] of [
        ["cover", ITEMS_3],
        ["explain", ITEMS_3],
        ["explain", ITEMS_4],
        ["compare", ITEMS_2],
        ["compare", ITEMS_3],
        ["steps", ITEMS_3],
        ["steps", ITEMS_4],
        ["warning", ITEMS_3],
        ["warning", ITEMS_4],
        ["summary", ITEMS_3],
        ["summary", ITEMS_4],
      ]) {
        await renderAndCheck(
          layoutId,
          { kind: "card", motionStyle: "flow", items },
          makeSlide(cardType, items),
          null,
          (["qa-chat", "headline", "broadcast"].includes(layoutId) && cardType === "steps" && items.length === 4)
            ? `${layoutId}-card-steps4` : null,
        );
      }

      // (c) Scene: all 8 visuals including 2/3/4 steps alignment
      for (const [visual, items] of [
        ["hook", ITEMS_3],
        ["mechanism", ITEMS_3],
        ["mechanism", ITEMS_4],
        ["compare", ITEMS_2],
        ["compare", ITEMS_3],
        ["steps", ITEMS_2],
        ["steps", ITEMS_3],
        ["steps", ITEMS_4],
        ["timeline", ITEMS_3],
        ["timeline", ITEMS_4],
        ["checklist", ITEMS_4],
        ["warning", ITEMS_3],
        ["warning", ITEMS_4],
        ["summary", ITEMS_4],
      ]) {
        await renderAndCheck(
          layoutId,
          { kind: "scene", visual, motion: "flow", motif: "clock", tone: "primary", items },
          makeSlide("explain", items),
          null,
          (["broadcast", "qa-chat", "headline", "takeaway"].includes(layoutId) && visual === "steps" && items.length === 3)
            ? `${layoutId}-scene-steps3`
            : (layoutId === "headline" && visual === "steps" && items.length === 4)
              ? `${layoutId}-scene-steps4`
              : (layoutId === "qa-chat" && visual === "warning" && items.length === 3)
                ? `${layoutId}-scene-warn3` : null,
        );
      }

      // (d) Scene/Card with Art illustration: verify art panel rendered dimensions match slot.art!
      const artUrl = makeSvgImageDataUrl(slot.art.w, slot.art.h, `${layoutId} art`);
      for (const items of [ITEMS_3, ITEMS_4]) {
        await renderAndCheck(
          layoutId,
          { kind: "scene", visual: "steps", motion: "flow", motif: "clock", tone: "primary", items, artUrl },
          makeSlide("steps", items),
          (m) => {
            assert(m.artRect, `${layoutId} art panel missing`);
            const dw = Math.abs(m.artRect.w - slot.art.w);
            const dh = Math.abs(m.artRect.h - slot.art.h);
            summary.artPanelMaxDiffPx = Math.max(summary.artPanelMaxDiffPx, dw, dh);
            assert(dw <= 12 && dh <= 12,
              `${layoutId} art panel mismatch: rendered ${m.artRect.w}x${m.artRect.h} vs expected ${slot.art.w}x${slot.art.h}`);
          },
          (["headline", "qa-chat", "broadcast", "info-classic"].includes(layoutId) && items.length === 4)
            ? `${layoutId}-art-4items` : null,
        );
      }

      // (e) SVG demo animation (1, 2, 3 beats): verify viewBox matches exact slot size
      for (const beats of [
        [{ action: "carton", label: "核对药盒", line: "核对药盒" }],
        [{ action: "clock", label: "先看时间", line: "先看时间" }, { action: "log", label: "记录服药", line: "记录服药" }],
        [{ action: "clock", label: "先看时间", line: "先看时间" }, { action: "compare", label: "切勿加倍", line: "切勿加倍" }, { action: "consult", label: "咨询药师", line: "咨询药师" }],
      ]) {
        await renderAndCheck(
          layoutId,
          { kind: "svg", action: beats[0].action, beats },
          makeSlide("explain", ITEMS_3, { action: beats[0].action, svgBeats: beats }),
          (m) => {
            assert.equal(m.svgViewBox, `0 0 ${slot.w} ${slot.h}`, `${layoutId} SVG viewBox mismatch`);
          },
          (["broadcast", "qa-chat", "headline"].includes(layoutId) && beats.length === 3)
            ? `${layoutId}-svg-3beats` : null,
        );
      }

      // (f) MG animation sized for this layout + points overlay
      const mgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${slot.w} ${slot.h}"><rect data-part="pill" x="${Math.round(slot.w * 0.35)}" y="${Math.round(slot.h * 0.42)}" width="${Math.round(slot.w * 0.3)}" height="${Math.round(slot.h * 0.32)}" rx="18" fill="var(--v-primary)"/></svg>`;
      await renderAndCheck(
        layoutId,
        {
          kind: "mg", fit: "auto", overlay: "points", items: ITEMS_4,
          motionAsset: {
            kind: "mg", duration: 3, svg: mgSvg, events: [], markers: [],
            tracks: [{ part: "pill", prop: "translateX", from: -40, to: 20, start: 0, end: 0.7, ease: "outCubic" }],
          },
        },
        makeSlide("explain", ITEMS_4),
        null,
        (["qa-chat", "headline", "broadcast"].includes(layoutId)) ? `${layoutId}-mg-points` : null,
      );
    }

    assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join("; ")}`);
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
