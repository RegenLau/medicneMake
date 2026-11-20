import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Usage: node tests/stage-image-focus.mjs [public-dir]
// An AI full-image shot must stay still while subtitle beats change focus: no spotlight veil, no zoom.
const publicDir = resolve(process.argv[2] || "public");
const layout = JSON.parse(await readFile(join(publicDir, "assets/library/layouts/info-classic.json")));
// Generated pictures are made at the media slot's aspect ratio, which is when the old zoom applied.
const image = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="958" height="538"><rect width="958" height="538" fill="#e8f1fb"/>' +
  [0, 1, 2].map(i => `<rect x="${40 + i * 300}" y="60" width="270" height="420" rx="24" fill="#${["1a73e8", "e6592d", "34a853"][i]}"/>`).join("") +
  "</svg>");
const line = "算量前核对两件事，先看规格，再看体重，最后别掰成人片。";
const focuses = ["all", "0", "1", "2", "action"];
const slide = {name:"算量前核对两件事", line, headline:"算量前核对两件事", type:"steps", layoutMode:"explain", chapterIndex:0,
  contentImage:image, focusRegions:{}, points:[], steps:[], warnings:[], checks:[]};
const shot = {kind:"image", name:slide.name, line, start:0, end:focuses.length * 2,
  captions:focuses.map((focus, i) => ({start:i * 2, end:i * 2 + 2, text:`第 ${i + 1} 句`, focus}))};
const plan = {layout, deck:{title:"儿童退烧用药安全", presenter:"none", theme:"medical", chapters:["先看剂量","按体重算"], slides:[slide]},
  // Exports used to send imageFocus: true, which turned focus beats into highlight boxes.
  shots:[shot], images:{}, imageFocus:true};

const browser = await chromium.launch({channel:"chrome", headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280, height:720}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(join(publicDir, "stage.html")).href);
  await page.evaluate(input => setPlan(input), plan);
  // The first capture after loading differs by a few pixels regardless of time; warm up before comparing.
  await page.evaluate(() => drawFrame(0.5));
  await page.screenshot();
  const frames = [];
  for (const [i, focus] of focuses.entries()) {
    const state = await page.evaluate(async time => {
      drawFrame(time);
      await Promise.all([...document.images].map(img => img.decode()));
      const img = document.querySelector(".media-slot img");
      const box = img.getBoundingClientRect();
      const slot = document.querySelector(".media-slot").getBoundingClientRect();
      return {overlays:document.querySelectorAll(".media-slot svg").length, transform:getComputedStyle(img).transform,
        box:[box.x, box.y, box.width, box.height].map(Math.round).join(","),
        clip:{x:slot.x, y:slot.y, width:slot.width, height:slot.height}};
    }, i * 2 + 1);
    const pixels = (await page.screenshot({clip:state.clip})).toString("base64");
    frames.push({focus, ...state, pixels});
  }
  // Rendering noise moves a few pixels by one level; the old focus zoom changed almost every pixel.
  const changed = await page.evaluate(async shots => {
    const decode = async data => {
      const img = new Image();
      img.src = "data:image/png;base64," + data;
      await img.decode();
      const canvas = Object.assign(document.createElement("canvas"), {width:img.width, height:img.height});
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0);
      return context.getImageData(0, 0, img.width, img.height).data;
    };
    const base = await decode(shots[0]);
    return Promise.all(shots.map(async shot => {
      const data = await decode(shot);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.max(Math.abs(data[i] - base[i]), Math.abs(data[i + 1] - base[i + 1]), Math.abs(data[i + 2] - base[i + 2])) > 8) count++;
      }
      return count;
    }));
  }, frames.map(f => f.pixels));
  frames.forEach((f, i) => { f.changed = changed[i]; });
  const report = frames.map(({focus, overlays, transform, box, changed}) => ({focus, overlays, transform, box, changedPixels:changed}));
  console.log(JSON.stringify({report, errors}));
  for (const f of frames) {
    assert.equal(f.overlays, 0, `focus ${f.focus} drew a highlight overlay`);
    assert.equal(f.transform, "none", `focus ${f.focus} zoomed the image`);
    assert.equal(f.box, frames[0].box, `focus ${f.focus} moved the image`);
    assert.equal(f.changed, 0, `focus ${f.focus} changed the image area`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
