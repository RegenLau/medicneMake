// Headless keyframe visual QA for prompt-driven custom code (`scene`) and pure SVG (`svg`) shots.
// Reads JSON payload from argv[2] (file path) or stdin, renders sampled keyframes on public/stage.html,
// and reports runtime errors, blank screens, boundary overflows, text/icon occlusions, and rendered texts.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

async function readInput() {
  if (process.argv[2]) {
    return JSON.parse(await readFile(process.argv[2], "utf8"));
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const input = await readInput();
const kind = input.kind === "svg" ? "svg" : "scene";
const duration = Math.max(1.0, Math.min(30, Number(input.duration) || 5.0));
const samples = Array.isArray(input.samples) && input.samples.length
  ? input.samples.map((p) => Math.max(0, Math.min(1, Number(p) || 0)))
  : [0.15, 0.5, 0.88];

const layout = input.layout || JSON.parse(
  await readFile(join(rootDir, "public/assets/library/layouts/info-classic.json"), "utf8"),
);
const shotData = input.shot || {};
const captions = Array.isArray(shotData.captions) && shotData.captions.length
  ? shotData.captions
  : [{ start: 0, end: duration, text: String(shotData.line || shotData.name || ""), focus: "all" }];

const shot = {
  kind,
  start: 0,
  end: duration,
  name: String(shotData.name || "自检分镜"),
  line: String(shotData.line || ""),
  captions,
  ...(kind === "svg" ? { svgCode: input.payload } : { code: input.payload }),
};

const plan = {
  fps: 24,
  frames: Math.max(1, Math.round(duration * 24)),
  layout,
  deck: {
    title: String(shotData.name || "自检分镜"),
    shortTitle: String(shotData.name || "自检").slice(0, 10),
    theme: input.theme === "warm" ? "warm" : "medical",
    ...(input.themeVars && typeof input.themeVars === "object" ? { themeVars: input.themeVars } : {}),
    presenter: "none",
    chapters: ["自检"],
    disclaimer: "",
    slides: [{
      name: shot.name,
      line: shot.line,
      chapterIndex: 0,
      type: "explain",
      layoutMode: "explain",
      headline: shotData.points?.headline || shot.name,
      items: Array.isArray(shotData.points?.items) ? shotData.points.items : [],
      takeaway: shotData.points?.takeaway || "",
    }],
  },
  shots: [shot],
  images: {},
};

const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(join(rootDir, "public/stage.html")).href);
  await page.evaluate((p) => setPlan(p), plan);

  const report = await page.evaluate(({ sampleFractions, totalDuration }) => {
    const fatalIssues = [];
    const layoutIssues = [];
    const seenLayoutKeys = new Set();
    const renderedTextSet = new Set();
    const frameStats = [];

    const addLayoutIssue = (key, message) => {
      if (seenLayoutKeys.has(key)) return;
      seenLayoutKeys.add(key);
      layoutIssues.push(message);
    };

    const effectiveOpacity = (el, stopAt) => {
      let op = 1;
      let cur = el;
      while (cur && cur !== stopAt && cur.nodeType === 1) {
        const cs = getComputedStyle(cur);
        if (cs.display === "none" || cs.visibility === "hidden") return 0;
        const val = parseFloat(cs.opacity);
        if (Number.isFinite(val)) op *= val;
        cur = cur.parentElement;
      }
      return op;
    };

    const intersects = (a, b) => {
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return { ix, iy, area: ix > 0 && iy > 0 ? ix * iy : 0 };
    };

    const contains = (outer, inner, pad = 3) =>
      outer.left <= inner.left + pad &&
      outer.right >= inner.right - pad &&
      outer.top <= inner.top + pad &&
      outer.bottom >= inner.bottom - pad;

    const isAncestorOrDescendant = (a, b) => a === b || a.contains(b) || b.contains(a);

    const hasDirectText = (el) => {
      for (const node of el.childNodes) {
        if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return true;
      }
      return false;
    };

    for (const frac of sampleFractions) {
      const t = Number((totalDuration * frac).toFixed(4));
      drawFrame(t);

      const slot = document.querySelector(".media-slot");
      const host = slot?.querySelector("[data-custom-code-host]");
      const sr = host?.shadowRoot;
      const wrapper = sr?.querySelector(".stage-custom-code-inner");
      if (!slot || !sr || !wrapper) {
        fatalIssues.push(`在 t=${t.toFixed(2)}s 未能挂载自定义动效容器。`);
        break;
      }
      const errStrong = wrapper.querySelector("strong");
      if (errStrong && errStrong.textContent?.includes("代码动效运行出错")) {
        const detail = wrapper.querySelector("span")?.textContent?.trim() || "未知运行错误";
        fatalIssues.push(`在 t=${t.toFixed(2)}s 发生运行期错误：${detail}`);
        break;
      }

      const slotRect = slot.getBoundingClientRect();
      const slotArea = Math.max(1, slotRect.width * slotRect.height);

      // Collect visible text boxes and foreground graphic boxes inside Shadow DOM.
      const textBoxes = [];
      const svgShapes = [];
      let visibleCount = 0;
      let unionLeft = Infinity;
      let unionTop = Infinity;
      let unionRight = -Infinity;
      let unionBottom = -Infinity;

      const allEls = [...wrapper.querySelectorAll("*")];
      for (const el of allEls) {
        const tag = el.tagName.toLowerCase();
        if (["defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "filter", "style", "title", "desc", "marker", "pattern", "symbol"].includes(tag)) {
          continue;
        }
        if (el.closest("defs, clipPath, mask, pattern, symbol, marker")) continue;
        const op = effectiveOpacity(el, wrapper);
        if (op <= 0.05) continue;
        const rawR = el.getBoundingClientRect();
        const isSvgEl = el.namespaceURI === "http://www.w3.org/2000/svg";
        let r = rawR;
        let cs = null;
        let strokeW = 0;
        if (isSvgEl && ["line", "path", "polyline"].includes(tag)) {
          cs = getComputedStyle(el);
          strokeW = parseFloat(cs.strokeWidth) || 0;
          if (strokeW > 0 && (rawR.width < 0.5 || rawR.height < 0.5) && (rawR.width >= 1 || rawR.height >= 1)) {
            const pad = strokeW / 2;
            r = {
              left: rawR.left - (rawR.width < 0.5 ? pad : 0),
              right: rawR.right + (rawR.width < 0.5 ? pad : 0),
              top: rawR.top - (rawR.height < 0.5 ? pad : 0),
              bottom: rawR.bottom + (rawR.height < 0.5 ? pad : 0),
              width: rawR.width < 0.5 ? strokeW : rawR.width,
              height: rawR.height < 0.5 ? strokeW : rawR.height,
            };
          }
        }
        if (r.width < 0.5 || r.height < 0.5) continue;

        const isSvgLeaf = isSvgEl && ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"].includes(tag);
        const isHtmlLeafText = !isSvgEl && hasDirectText(el);

        // Track visible area using clipped intersection with slotRect.
        if (isSvgLeaf || isHtmlLeafText || (!isSvgEl && el.children.length === 0)) {
          const cx1 = Math.max(slotRect.left, r.left);
          const cy1 = Math.max(slotRect.top, r.top);
          const cx2 = Math.min(slotRect.right, r.right);
          const cy2 = Math.min(slotRect.bottom, r.bottom);
          if (cx2 > cx1 && cy2 > cy1) {
            visibleCount++;
            unionLeft = Math.min(unionLeft, cx1);
            unionTop = Math.min(unionTop, cy1);
            unionRight = Math.max(unionRight, cx2);
            unionBottom = Math.max(unionBottom, cy2);
          }
        }

        // Collect text boxes (SVG <text> or HTML leaf text elements).
        if ((isSvgEl && tag === "text") || isHtmlLeafText) {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (text) {
            renderedTextSet.add(text);
            // Measure exact Range rect for HTML inline text so padded boxes don't cause false overlap.
            let box = r;
            if (!isSvgEl) {
              try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const rr = range.getBoundingClientRect();
                if (rr.width > 0.5 && rr.height > 0.5) box = rr;
              } catch {}
            }
            if (op >= 0.25) {
              textBoxes.push({ el, tag, isSvg: isSvgEl, text, rect: box, outerRect: r, op });
            }
          }
        }

        // Collect foreground SVG shapes for icon/divider-vs-text occlusion check.
        if (isSvgEl && ["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"].includes(tag)) {
          const shapeCs = cs || getComputedStyle(el);
          const fill = shapeCs.fill;
          const stroke = shapeCs.stroke;
          const shapeStrokeW = strokeW || parseFloat(shapeCs.strokeWidth) || 0;
          const hasFill = fill && fill !== "none" && fill !== "transparent" && fill !== "rgba(0, 0, 0, 0)";
          const hasStroke = stroke && stroke !== "none" && stroke !== "transparent" && shapeStrokeW > 0;
          if ((hasFill || hasStroke) && op >= 0.45) {
            const area = r.width * r.height;
            const isThinDivider = tag === "line" || (r.height <= 8 && r.width >= 24) || (r.width <= 8 && r.height >= 24);
            // Ignore huge backdrop panels (>35% of slot) unless it's a thin divider line.
            if (isThinDivider || area <= slotArea * 0.35) {
              svgShapes.push({ el, tag, rect: r, hasFill, hasStroke, strokeW: shapeStrokeW, isThinDivider, op });
            }
          }
        }
      }

      const coverage = visibleCount > 0
        ? Math.max(0, (unionRight - unionLeft) * (unionBottom - unionTop)) / slotArea
        : 0;
      frameStats.push({ t, visibleCount, coverage: Number(coverage.toFixed(3)), textCount: textBoxes.length });

      // Only enforce geometry checks at settled mid/late frames (skip very early entrance frames where slide-in may still be mid-flight).
      if (frac >= 0.45) {
        // 1. Boundary overflow check on all visible text boxes.
        for (const tb of textBoxes) {
          const r = tb.rect;
          const overL = Math.round(slotRect.left - r.left);
          const overR = Math.round(r.right - slotRect.right);
          const overT = Math.round(slotRect.top - r.top);
          const overB = Math.round(r.bottom - slotRect.bottom);
          if (overL > 5 || overR > 5 || overT > 5 || overB > 5) {
            const dir = overR > 5 ? `右侧 ${overR}px`
              : overB > 5 ? `底部 ${overB}px`
              : overL > 5 ? `左侧 ${overL}px`
              : `顶部 ${overT}px`;
            addLayoutIssue(
              `overflow:${tb.text}`,
              `文字「${tb.text.slice(0, 14)}」超出内容区${dir}，请缩短文案、缩小字号或调整布局位置。`,
            );
          }
          // Check HTML scroll clipping on direct text containers.
          if (!tb.isSvg) {
            const cs = getComputedStyle(tb.el);
            if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowX) && tb.el.scrollWidth > tb.el.clientWidth + 6) {
              addLayoutIssue(
                `clipx:${tb.text}`,
                `文字容器「${tb.text.slice(0, 14)}」横向被裁切（溢出 ${Math.round(tb.el.scrollWidth - tb.el.clientWidth)}px），请放宽容器宽度或允许换行。`,
              );
            }
            if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowY) && tb.el.scrollHeight > tb.el.clientHeight + 6) {
              addLayoutIssue(
                `clipy:${tb.text}`,
                `文字容器「${tb.text.slice(0, 14)}」纵向被裁切（溢出 ${Math.round(tb.el.scrollHeight - tb.el.clientHeight)}px），请增大高度或精简内容。`,
              );
            }
          }
        }

        // 2. Text-vs-text overlap check.
        for (let i = 0; i < textBoxes.length; i++) {
          for (let j = i + 1; j < textBoxes.length; j++) {
            const a = textBoxes[i];
            const b = textBoxes[j];
            if (isAncestorOrDescendant(a.el, b.el)) continue;
            const inter = intersects(a.rect, b.rect);
            if (inter.ix > 4 && inter.iy > 4) {
              const minArea = Math.max(1, Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height));
              if (inter.area / minArea > 0.12) {
                const pairKey = [a.text, b.text].sort().join("|");
                addLayoutIssue(
                  `text-overlap:${pairKey}`,
                  `文字「${a.text.slice(0, 12)}」与「${b.text.slice(0, 12)}」发生重叠（约 ${Math.round(inter.ix)}×${Math.round(inter.iy)}px），请拉开坐标或间距。`,
                );
              }
            }
          }
        }

        // 3. SVG icon/badge/divider occlusion on SVG <text>.
        const svgTexts = textBoxes.filter((tb) => tb.isSvg);
        for (const tb of svgTexts) {
          for (const sh of svgShapes) {
            if (isAncestorOrDescendant(tb.el, sh.el)) continue;
            // Valid container (pill/card/circle badge cleanly enclosing the text) -> skip.
            if (contains(sh.rect, tb.rect, 4)) continue;
            if (contains(tb.rect, sh.rect, 2)) continue;
            const inter = intersects(tb.rect, sh.rect);
            if (inter.area <= 0) continue;

            if (sh.isThinDivider) {
              // Divider line cutting horizontally across a text box (or vertically through text).
              const isHorizLine = sh.rect.width >= sh.rect.height;
              if (isHorizLine) {
                const lineCy = (sh.rect.top + sh.rect.bottom) / 2;
                const cutsText = lineCy >= tb.rect.top + 1 && lineCy <= tb.rect.bottom - 1 && inter.ix >= Math.min(14, tb.rect.width * 0.4);
                if (cutsText) {
                  addLayoutIssue(
                    `line-cut:${tb.text}`,
                    `矢量线条压住文字「${tb.text.slice(0, 12)}」，请拉开文字 y 坐标与分割线的间距。`,
                  );
                }
              } else {
                const lineCx = (sh.rect.left + sh.rect.right) / 2;
                const cutsText = lineCx >= tb.rect.left + 1 && lineCx <= tb.rect.right - 1 && inter.iy >= Math.min(12, tb.rect.height * 0.5);
                if (cutsText) {
                  addLayoutIssue(
                    `vline-cut:${tb.text}`,
                    `竖向线条压住文字「${tb.text.slice(0, 12)}」，请调整文字与线条的 x 坐标间距。`,
                  );
                }
              }
            } else if (sh.hasFill && inter.ix >= 6 && inter.iy >= 6) {
              // Opaque filled foreground icon/badge partially intersecting text (e.g., '?' circle covering first character).
              // Ignore purely outlined stroke rings (hasFill === false).
              addLayoutIssue(
                `shape-overlap:${tb.text}`,
                `前景图形（<${sh.tag}>）遮挡了文字「${tb.text.slice(0, 12)}」（重叠约 ${Math.round(inter.ix)}×${Math.round(inter.iy)}px），请重新计算图标与文字的横向/纵向间距（注意 text-anchor 对齐宽度）。`,
              );
            }
          }
        }
      }
    }

    // Blank screen check at the last settled keyframe.
    const lastStat = frameStats.at(-1);
    if (!fatalIssues.length && (!lastStat || lastStat.visibleCount === 0 || (lastStat.coverage < 0.008 && lastStat.textCount === 0))) {
      fatalIssues.push("画面在关键帧几乎为空白，请检查元素是否被隐藏（opacity:0）或坐标落在画布外。");
    }

    return {
      fatalIssues: fatalIssues.slice(0, 4),
      layoutIssues: layoutIssues.slice(0, 4),
      renderedTexts: [...renderedTextSet].slice(0, 80),
      frameStats,
    };
  }, { sampleFractions: samples, totalDuration: duration });

  for (const err of pageErrors) {
    report.fatalIssues.unshift(`页面运行异常：${err}`);
  }
  const ok = report.fatalIssues.length === 0 && report.layoutIssues.length === 0;
  process.stdout.write(JSON.stringify({ ok, ...report }) + "\n");
} finally {
  await browser.close();
}
