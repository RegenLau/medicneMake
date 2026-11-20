/* Render trusted workbench SVG frames at the exact audio timeline positions. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const [chrome, ffmpeg, planPath, output] = process.argv.slice(2);
const { fps, shots, layout, avatarUrl } = JSON.parse(await readFile(planPath, "utf8"));
const [renderer, template, css, layoutEngine, contents, svgContent, mgKit] = await Promise.all([
  readFile(new URL("./public/svg-motion.js", import.meta.url), "utf8"),
  readFile(new URL("./public/template-renderer.js", import.meta.url), "utf8"),
  readFile(new URL("./public/template-renderer.css", import.meta.url), "utf8"),
  readFile(new URL("./public/stage/layout-engine.js", import.meta.url), "utf8"),
  readFile(new URL("./public/stage/contents.js", import.meta.url), "utf8"),
  readFile(new URL("./public/stage/svg-content.js", import.meta.url), "utf8"),
  readFile(new URL("./public/stage/mg-kit.js", import.meta.url), "utf8"),
]);
const profile = await mkdtemp(join(tmpdir(), "studio-svg-"));
let browser;
let encoder;
const deadline = setTimeout(() => {
  void stop(browser);
  void stop(encoder);
}, 540000);

function exited(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function devTools(process) {
  const decoder = new StringDecoder("utf8");
  const wait = new Map();
  let sequence = 0;
  let buffer = "";
  function fail(error) {
    for (const pending of wait.values()) pending.reject(error);
    wait.clear();
  }
  process.on("error", fail);
  process.on("exit", () => fail(new Error("Chrome 渲染进程提前退出")));
  process.stdio[3].on("error", fail);
  process.stdio[4].on("error", fail);
  process.stdio[4].on("data", chunk => {
    buffer += decoder.write(chunk);
    for (;;) {
      const end = buffer.indexOf("\0");
      if (end < 0) break;
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const pending = wait.get(message.id);
      if (!pending) continue;
      wait.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      wait.delete(id);
      reject(new Error("Chrome 渲染响应超时"));
    }, 15000);
    wait.set(id, {
      resolve: result => { clearTimeout(timer); resolve(result); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    process.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = exited(child);
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try {
    await done;
  } finally {
    clearTimeout(timer);
  }
}

try {
  browser = spawn(chrome, [
    "--headless", "--remote-debugging-pipe", "--disable-background-networking", "--no-first-run",
    "--no-default-browser-check", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true });
  const command = devTools(browser);
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "浏览器内 SVG 渲染失败");
    }
    return result.result.value;
  }
  await evaluate(layoutEngine + template + mgKit + svgContent + contents + renderer + `
    const deck = SvgMotion.templateDeck(${JSON.stringify(layout)}, ${JSON.stringify(shots)});
    const avatar = ${JSON.stringify(avatarUrl)};
    const imgMap = avatar ? new Map([[TemplateVideo.resolveAvatarSrc(deck), avatar]]) : null;
    const snapshotCss = ${JSON.stringify(css)};
    globalThis.captureSvg = async (index, progress) => {
      const html = SvgMotion.frame(deck, index, progress, {imgMap, subtitles: deck.slides[index].subtitles});
      const image = new Image();
      const svg = TemplateVideo.frameToSvg(html, snapshotCss);
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await image.decode();
      const canvas = frameCanvas;
      canvas.getContext("2d", {alpha: false}).drawImage(image, 0, 0);
      return canvas.toDataURL("image/jpeg", .92).split(",")[1];
    };
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = 1280;
    frameCanvas.height = 720;
  `);

  encoder = spawn(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps),
    "-c:v", "mjpeg", "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "veryfast", "-threads", "2",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ], { stdio: ["pipe", "ignore", "inherit"], windowsHide: true });
  const encoded = exited(encoder);
  encoded.catch(() => {});
  let streamError;
  encoder.stdin.on("error", error => { streamError = error; });
  for (const [shotIndex, shot] of shots.entries()) {
    let lastProgress = -1;
    let frame;
    for (let index = 0; index < shot.frames; index++) {
      const progress = Math.min(1, index / shot.motionFrames);
      if (progress !== lastProgress) {
        frame = Buffer.from(await evaluate(`captureSvg(${shotIndex}, ${progress})`), "base64");
        lastProgress = progress;
      }
      if (streamError) throw streamError;
      if (encoder.exitCode !== null) throw new Error("FFmpeg 编码提前退出");
      if (!encoder.stdin.write(frame)) {
        await Promise.race([
          once(encoder.stdin, "drain"),
          encoded.then(() => { throw new Error("FFmpeg 编码提前退出"); }),
        ]);
      }
    }
  }
  encoder.stdin.end();
  if ((await encoded).code !== 0) throw new Error("FFmpeg 未完成 SVG 帧编码");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await Promise.allSettled([stop(browser), stop(encoder)]);
  await rm(profile, { recursive: true, force: true, maxRetries: 4 });
}
