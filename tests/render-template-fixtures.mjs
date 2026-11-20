import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const [input, output] = process.argv.slice(2);
const { deck, items } = JSON.parse(await readFile(input, "utf8"));
const fixture = "/assets/template-info-tablet.jpg";
const img = `data:image/jpeg;base64,${(await readFile(new URL(`../public${fixture}`, import.meta.url))).toString("base64")}`;
const css = await readFile(new URL("../public/template-renderer.css", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(new URL("../public/stage.html", import.meta.url).href);
  for (const [index, item] of items.entries()) {
    for (const [cueIndex, cue] of item.cues.entries()) {
      const png = await page.evaluate(async ({ deck, index, cue, fixture, img, css }) => {
        const markup = TemplateVideo.renderFrameHtml(deck, index, {
          imgMap: new Map([[fixture, img]]), subtitleText: cue.text, focus: cue.focus,
        });
        const image = new Image();
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(TemplateVideo.frameToSvg(markup, css));
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#edf6fe";
        ctx.fillRect(0, 0, 1280, 720);
        ctx.drawImage(image, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      }, { deck, index, cue, fixture, img, css });
      await writeFile(join(output, `${index}-${cueIndex}.png`), png, "base64");
    }
  }
} finally {
  await browser.close();
}
