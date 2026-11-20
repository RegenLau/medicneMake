import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Usage: node tests/stage-art.mjs <illustration.png> <output-dir>
const [artPath, output] = process.argv.slice(2);
const evidence = resolve(output);
await mkdir(evidence, {recursive:true});
const artUrl = pathToFileURL(resolve(artPath)).href;
const layout = JSON.parse(await readFile("public/assets/library/layouts/info-classic.json"));

const items = n => [
  {title:"先称体重", detail:"按公斤数查说明书用量表", tag:"第一步"},
  {title:"认准剂型浓度", detail:"滴剂和混悬液浓度不同", tag:"别混用"},
  {title:"用原配量器", detail:"不用家里的汤匙估量", tag:""},
  {title:"记下用药时间", detail:"两次之间至少间隔四小时", tag:"4 小时"},
].slice(0, n);
const visuals = ["hook","mechanism","compare","steps","timeline","checklist","warning","summary"];
const cases = [
  ...visuals.map((visual, i) => ({kind:"scene", visual, type:"explain", count:visual === "compare" ? 2 : visual === "hook" ? 3 : 4 - (i % 2)})),
  ...["cover","steps","compare","warning","summary"].map(type => ({kind:"card", type, count:type === "compare" ? 2 : 3})),
  {kind:"scene", visual:"summary", type:"summary", count:0},
];
const seconds = 4;
const shots = [], slides = [];
cases.forEach((c, i) => {
  const name = c.kind === "card" ? `信息图动效 ${c.type}` : `孩子发烧，退烧药按体重算剂量`;
  const line = "孩子发烧，先称体重，再按说明书的用量表取药。";
  const list = items(c.count);
  slides.push({name, line, headline:name, type:c.type, layoutMode:"explain", chapterIndex:0, takeaway:"拿不准剂量，先问药师",
    points:list.map(({title,detail}) => ({title, desc:detail})), steps:list.map(({title,detail}) => ({title, desc:detail})),
    warnings:list.map(({title,detail}) => ({title, desc:detail})), checks:list.map(({title,detail}) => ({title, desc:detail})),
    columns:list.map(({title,detail}) => ({title, points:[detail]})), pills:list.map(item => item.title)});
  shots.push({kind:c.kind, name, line, items:list, takeaway:"拿不准剂量，先问药师", artUrl,
    start:i * seconds, end:(i + 1) * seconds,
    captions:[{start:i * seconds, end:i * seconds + 2, text:line, focus:"all"},
              {start:i * seconds + 2, end:(i + 1) * seconds, text:"再按说明书取药。", focus:"1"}],
    ...(c.kind === "scene" ? {visual:c.visual} : {})});
});
const deck = {title:"儿童退烧用药安全", presenter:"none", chapters:["先看剂量","按体重算"], slides};

const browser = await chromium.launch({channel:"chrome", headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280, height:720}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve("public/stage.html")).href);
  const results = [];
  for (const theme of ["medical", "warm"]) {
    await page.evaluate(plan => setPlan(plan), {layout, deck:{...deck, theme}, shots});
    for (const [i, c] of cases.entries()) {
      if (theme === "warm" && i % 3) continue;
      for (const offset of [0.25, 3.2]) {
        const state = await page.evaluate(async time => {
          drawFrame(time);
          await Promise.all([...document.images].map(image => image.decode()));
          const copy = document.querySelector(".cm-art-copy");
          const panel = document.querySelector(".cm-art-panel");
          const img = document.querySelector(".cm-art-img");
          if (!copy || !panel || !img) return {missing:true};
          const slot = document.querySelector(".media-slot").getBoundingClientRect();
          // Layout boxes, not transformed ones: entrance motion moves cards on purpose.
          const inside = [...copy.children, ...copy.querySelectorAll(".cm-item")].every(el => {
            let top = 0, left = 0;
            for (let node = el; node && node !== copy.offsetParent; node = node.offsetParent) { top += node.offsetTop; left += node.offsetLeft; }
            top -= copy.offsetTop;
            left -= copy.offsetLeft;
            return top >= -1 && top + el.offsetHeight <= copy.clientHeight + 1 && left + el.offsetWidth <= copy.clientWidth + 1;
          });
          const clipped = [...copy.querySelectorAll("strong, span, h2")].some(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).whiteSpace === "nowrap");
          return {inside, clipped, overflow:copy.scrollHeight - copy.clientHeight,
            panelInSlot:panel.getBoundingClientRect().bottom <= slot.bottom + 1 && panel.getBoundingClientRect().left >= slot.left - 1,
            imageLoaded:img.naturalWidth > 0, artOpacity:Number(panel.style.opacity), imageTransform:img.style.transform,
            items:copy.querySelectorAll(".cm-item").length, markup:document.querySelector("#stage-frame").innerHTML};
        }, i * seconds + offset);
        assert(!state.missing, `${c.kind}/${c.visual || c.type} did not use the illustration layout`);
        assert(state.inside && state.overflow <= 1 && !state.clipped, `${c.kind}/${c.visual || c.type} text overflows (${state.overflow}px)`);
        assert(state.panelInSlot && state.imageLoaded, `${c.kind}/${c.visual || c.type} illustration is not visible`);
        assert.equal(state.items, c.count);
        if (offset === 3.2) {
          assert.equal(state.artOpacity, 1);
          const name = `${theme}-${String(i).padStart(2, "0")}-${c.kind}-${c.visual || c.type}.png`;
          await page.screenshot({path:join(evidence, name)});
          // Redrawing the same time after other frames must produce identical markup for frame reuse.
          await page.evaluate(t => drawFrame(t), 0.1);
          const again = await page.evaluate(t => { drawFrame(t); return document.querySelector("#stage-frame").innerHTML; }, i * seconds + offset);
          assert.equal(again, state.markup, `${c.kind}/${c.visual || c.type} redraw differs`);
        } else {
          assert(state.artOpacity < 1, "illustration should still be entering");
        }
        results.push({theme, shot:i, kind:c.kind, layout:c.visual || c.type, offset, items:state.items, transform:state.imageTransform});
      }
    }
  }
  // Shots without an illustration keep their original renderer.
  await page.evaluate(plan => setPlan(plan), {layout, deck, shots:shots.map(({artUrl, ...shot}) => shot)});
  const plain = await page.evaluate(() => { drawFrame(3.2); return Boolean(document.querySelector(".cm-art-panel")); });
  assert.equal(plain, false);
  await page.evaluate(() => drawFrame(9 * 4 + 3.2));
  await page.screenshot({path:join(evidence, "card-without-art.png")});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({checked:results.length, screenshots:results.filter(row => row.offset === 3.2).length, errors:errors.length}));
} finally {
  await browser.close();
}
