import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Render all 30 info-forms across 2 themes (medical, night) x 3 layout shapes (standard, narrow, shallow-wide),
// verify zero text overflow outside .media-slot and non-blank visuals, and output an overview collage PNG.
const outDir = resolve(process.argv[2] || "/tmp/stage-forms-verify");
await mkdir(outDir, { recursive: true });

const formsMeta = JSON.parse(await readFile("public/assets/library/forms.json", "utf8"));
const layouts = [
  { id: "standard", name: "信息图(960x540)", def: JSON.parse(await readFile("public/assets/library/layouts/info-classic.json", "utf8")) },
  { id: "narrow", name: "大字报(642x510)", def: JSON.parse(await readFile("public/assets/library/layouts/headline.json", "utf8")) },
  { id: "shallow-wide", name: "问答(1120x388)", def: JSON.parse(await readFile("public/assets/library/layouts/qa-chat.json", "utf8")) },
];
const themes = [
  { id: "medical", name: "医疗白蓝", def: JSON.parse(await readFile("public/assets/library/themes/medical.json", "utf8")) },
  { id: "night", name: "夜间深色", def: JSON.parse(await readFile("public/assets/library/themes/night.json", "utf8")) },
];

const sampleShot = {
  name: "退烧药按体重算",
  line: "孩子体温超过三十八度五时，按体重核对说明书，两次至少间隔四到六小时，一天最多四次。",
  seconds: 4,
  chapterIndex: 0,
  points: {
    type: "steps",
    headline: "儿童退烧药按体重算",
    accentPhrase: "按体重算",
    lead: "按公斤数核对说明书，不按年龄估算",
    question: "发烧时能不能直接按年龄喂退烧药？",
    answer: "按体重计算，每天最多4次",
    verdictTone: "warn",
    items: [
      { title: "先看体温 38.5℃", detail: "结合精神状态判断", tag: "第一步" },
      { title: "按体重查用量表", detail: "用原配刻度量器量取", tag: "核对" },
      { title: "间隔 4–6 小时", detail: "一天最多不超过 4 次", tag: "间隔" },
    ],
    takeaway: "按体重核对说明书，不叠加退烧药",
  },
  captions: [
    { start: 0, end: 1.3, text: "孩子体温超过三十八度五时，", focus: "0" },
    { start: 1.3, end: 2.6, text: "按体重核对说明书用量，", focus: "1" },
    { start: 2.6, end: 4, text: "两次至少间隔四到六小时。", focus: "2" },
  ],
};

const artUrl = pathToFileURL(resolve("public/assets/template-info-fever.jpg")).href;
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30000 });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(new URL("../public/stage.html", import.meta.url).href);

  const report = [];
  const collageItems = [];

  for (const form of formsMeta.forms) {
    for (const theme of themes) {
      for (const lay of layouts) {
        const result = await page.evaluate(async ({ form, theme, lay, sampleShot, artUrl }) => {
          const slotDesc = LayoutEngine.describeMediaSlot(lay.def, "explain");
          const regForm = InfoForms.get(form.id);
          if (!regForm) return { skipped: true, reason: "missing-form" };
          const formData = regForm.fromPoints(sampleShot);
          if (!regForm.fits(slotDesc, formData)) return { skipped: true, reason: "not-fit" };
          const shot = {
            ...sampleShot,
            kind: form.preferredKind || "scene",
            form: form.id,
            variant: form.variants[0],
            formData,
            items: sampleShot.points.items,
            takeaway: sampleShot.points.takeaway,
            artUrl: form.id.startsWith("art-") ? artUrl : undefined,
            start: 0,
            end: 4,
          };
          const slide = {
            ...sampleShot.points,
            name: sampleShot.name,
            line: sampleShot.line,
            layoutMode: "explain",
            chapterIndex: 0,
            points: sampleShot.points.items.map((x) => ({ title: x.title, desc: x.detail })),
          };
          await setPlan({
            layout: lay.def,
            deck: {
              title: "儿童退烧药怎么量",
              shortTitle: "儿童退烧药",
              theme: theme.def.base,
              themeVars: theme.def.vars,
              themeGlass: Boolean(theme.def.glass),
              presenter: "none",
              pharmacist: { name: "林药师", role: "主管药师", hospital: "药学部" },
              chapters: ["判断", "用量"],
              slides: [slide],
            },
            shots: [shot],
            images: {},
          });
          await drawFrame(2.4);
          const slot = document.querySelector(".media-slot");
          const stage = slot?.querySelector("[data-if-stage]");
          const slotRect = slot.getBoundingClientRect();
          const offenders = [];
          for (const el of stage.querySelectorAll("h2, p, strong, span, li, div.if-card, div.if-col-box, div.if-table-row")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.left < slotRect.left - 4 || r.right > slotRect.right + 4 || r.top < slotRect.top - 4 || r.bottom > slotRect.bottom + 4) {
              offenders.push({
                text: (el.textContent || "").trim().slice(0, 20),
                dxR: Math.round(r.right - slotRect.right),
                dyB: Math.round(r.bottom - slotRect.bottom),
              });
            }
          }
          const events = collectStageEvents();
          return {
            skipped: false,
            nonEmpty: stage.textContent.trim().length > 0 && stage.querySelectorAll("*").length >= 4,
            overflowCount: offenders.length,
            offenders: offenders.slice(0, 3),
            eventsCount: events.length,
          };
        }, { form, theme, lay, sampleShot, artUrl });

        if (result.skipped) continue;
        report.push({ form: form.id, theme: theme.id, layout: lay.id, ...result });
        assert(result.nonEmpty, `Blank render for ${form.id} (${theme.id}/${lay.id})`);
        assert.equal(result.overflowCount, 0, `Overflow in ${form.id} (${theme.id}/${lay.id}): ${JSON.stringify(result.offenders)}`);

        // Capture one standard medical shot for every form + night sample for collage
        if (lay.id === "standard" && theme.id === "medical") {
          const fname = `${form.id}.png`;
          const fpath = join(outDir, fname);
          await page.locator(".media-slot").screenshot({ path: fpath });
          collageItems.push({ label: `${form.label} (${form.id})`, file: fpath });
        }
      }
    }
  }

  // Render an overview collage PNG of all 30 forms for human inspection
  const cols = 5;
  const rows = Math.ceil(collageItems.length / cols);
  const cellW = 320;
  const cellH = 210;
  const collagePage = await browser.newPage({ viewport: { width: cols * cellW + 40, height: rows * cellH + 60 }, deviceScaleFactor: 1 });
  const cards = [];
  for (const it of collageItems) {
    const b64 = (await readFile(it.file)).toString("base64");
    cards.push(
      `<figure style="margin:0;background:#fff;border:1px solid #d5e2ee;border-radius:10px;overflow:hidden;display:flex;flex-direction:column">` +
      `<img src="data:image/png;base64,${b64}" style="width:100%;height:172px;object-fit:contain;background:#eef5fd;display:block">` +
      `<figcaption style="font:600 12px/1.3 sans-serif;padding:5px 8px;color:#122d4c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.label}</figcaption></figure>`
    );
  }
  await collagePage.setContent(`<!doctype html><html><body style="margin:0;padding:20px;background:#f3f7fb;font-family:sans-serif">` +
    `<h2 style="margin:0 0 12px;color:#122d4c;font-size:18px">信息版式库总览（共 ${collageItems.length} 种版式 · 零溢出验收通过）</h2>` +
    `<div style="display:grid;grid-template-columns:repeat(${cols}, ${cellW - 10}px);gap:10px">${cards.join("")}</div></body></html>`);
  const collagePath = join(outDir, "collage.png");
  await collagePage.screenshot({ path: collagePath, fullPage: true });
  await collagePage.close();

  assert.deepEqual(errors, []);
  await writeFile(join(outDir, "report.json"), JSON.stringify({ checked: report.length, forms: collageItems.length, collage: collagePath, report }, null, 2));
  console.log(JSON.stringify({ checked: report.length, forms: collageItems.length, collage: collagePath, browserErrors: errors.length }));
} finally {
  await browser.close();
}
