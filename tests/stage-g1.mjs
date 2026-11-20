import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import "../public/stage/mg-kit.js";

const [origin, sandbox, output] = process.argv.slice(2);
const evidence = resolve(output);
const old = await mkdtemp(join(tmpdir(),"stage-g1-baseline-"));
await mkdir(evidence,{recursive:true});
const cases = ["scene","card","svg","asset"];
const works = cases.map((kind,i) => {
  const name = ["核对说明书","记录信息","翻到对应页","阅读清单"][i];
  const line = name+"，有疑问就记录下来。";
  const items = [{title:"找到位置",detail:"查看身边的资料"},{title:"核对信息",detail:"写下疑问"}];
  const slide = {name,line,headline:name,points:items,steps:items,type:"steps",layoutMode:"explain",chapterIndex:0,
    ...(kind === "svg" ? {action:"leaflet",svgBeats:[{action:"leaflet",line,label:"看说明书"}]} : {})};
  const shot = {kind,name,line,items,start:i*4,end:(i+1)*4,captions:[{start:i*4,end:(i+1)*4,text:line,focus:"all"}],
    ...(kind === "scene" ? {visual:"steps",motion:"flow",motif:"checklist",tone:"primary"} : {}),
    ...(kind === "svg" ? {beats:slide.svgBeats} : {}),
    ...(kind === "asset" ? {move:"zoom"} : {})};
  return {slide,shot};
});
const svgFile = await readFile(resolve("public/assets/library/svg/reading-list.svg"));
works.at(-1).shot.assetUrl = "data:image/svg+xml;base64,"+svgFile.toString("base64");
const layout = JSON.parse(await readFile("public/assets/library/layouts/info-classic.json"));
const plan = {layout,deck:{title:"核对资料",presenter:"none",chapters:["查看","记录"],slides:works.map(s=>s.slide)},
  shots:works.map(s=>s.shot)};

const {sample,evaluate,presets} = globalThis.MgKit;
const tracks = [
  {...presets.float[0],part:"guide"},
  {part:"guide",prop:"translateY",start:.45,end:.82,from:0,to:14,ease:"wobble"},
  {...presets.letters[0],part:"word",index:2},
  {...presets.pulse[0],part:"detail"},
];
assert.equal(evaluate(tracks,.2).get("guide").translateY, sample(tracks[0],.2));
assert.equal(evaluate(tracks,.7).get("guide").translateY,sample(tracks[1],.7));
assert.equal(sample(presets.letters[0],.04,2),0);
assert(sample(presets.letters[0],.15,2)>0);
assert(sample(presets.pulse[0],.24)>1.06);
const times = [0,.08,.2,.3,.6,1,4.08,4.2,4.3,4.6,8.08,8.7,12.08,12.8,15.8];
const model = new Map(times.map(t => [t,JSON.stringify([...evaluate(tracks,t)])]));
for (const t of [...times].reverse()) assert.equal(JSON.stringify([...evaluate(tracks,t)]),model.get(t));

let browser;
try {
  const files = execFileSync("git",["ls-tree","-r","--name-only","322d69d","public/stage"],{encoding:"utf8"}).trim().split("\n");
  files.push("public/stage.html","public/template-renderer.css","public/template-renderer.js");
  for (const path of files) {
    const target = join(old,path);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,execFileSync("git",["show","322d69d:"+path]));
  }
  await symlink(resolve("public/assets"),join(old,"public/assets"));
  browser = await chromium.launch({channel:"chrome",headless:true,args:["--disable-gpu","--disable-partial-raster","--disable-lcd-text"]});
  const viewport = {width:1280,height:720};
  const before = await browser.newPage({viewport});
  const after = await browser.newPage({viewport});
  await before.goto(pathToFileURL(join(old,"public/stage.html")).href);
  await after.goto(pathToFileURL(resolve("public/stage.html")).href);
  for (const page of [before,after]) {
    await page.evaluate(p=>setPlan(p),plan);
  }
  async function pic(page,time) {
    await page.evaluate(async t => {
      drawFrame(t);
      await Promise.all([...document.images].map(image=>image.decode()));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },time);
    return page.screenshot({animations:"disabled"});
  }
  const rows = [];
  for (const [i,kind] of cases.entries()) {
    for (const offset of [.08,.2,.6,1.2]) {
      const first = await pic(before,i*4+offset);
      const second = await pic(after,i*4+offset);
      assert(first.equals(second),`baseline drift in ${kind} at ${offset}`);
      rows.push({kind,offset,differentBytes:0});
      if (offset === .2) {
        await writeFile(join(evidence,`G1-前-${kind}.png`),first);
        await writeFile(join(evidence,`G1-后-${kind}.png`),second);
      }
    }
  }
  const markup = new Map();
  async function stageState(t) {
    return after.evaluate(time => {
      drawFrame(time);
      return document.querySelector("#stage-frame").innerHTML;
    },t);
  }
  for (const t of times) markup.set(t,await stageState(t));
  for (const t of [8.7,4.3,15.8,.08,12.08,4.08,1,.2,8.7,0,4.08]) {
    assert.equal(await stageState(t),markup.get(t),`unordered stage output differs at ${t}`);
  }
  await after.evaluate(p=>setPlan(p), {...plan,shots:plan.shots.map(s=>({...s,transition:"fade"}))});
  for (const t of times) assert.equal(await stageState(t),markup.get(t),"missing and explicit fade differ");

  const animation = await browser.newPage({viewport:{width:420,height:240}});
  await animation.setContent(`<body style="background:#fff"><svg width="400" height="210" viewBox="0 0 400 210">
    <rect data-part="guide" x="150" y="55" width="80" height="85" fill="#174fba"/>
    <circle data-part="detail" cx="100" cy="100" r="20" fill="#547c75"/>
    <path data-part="pen" d="M20 180 H320" stroke="#134073" stroke-width="4"/>
    </svg><span data-part="word" style="position:absolute;left:20px;top:20px">36</span></body>`);
  await animation.addScriptTag({path:resolve("public/stage/mg-kit.js")});
  const drawTracks = [...tracks,{...presets.outline[0],part:"pen"},
    {part:"pen",prop:"clip",start:0,end:1,from:0,to:1},
    {part:"guide",prop:"rotate",start:0,end:.8,from:0,to:18},
    {part:"detail",prop:"translateX",start:0,end:1,from:0,to:12},
    {...presets.count[0],part:"word"}];
  async function keyframe(time) {
    await animation.evaluate(({time,tracks}) => {
      for (const [part,state] of MgKit.evaluate(tracks,time)) MgKit.apply(document.querySelector(`[data-part="${part}"]`),state);
    },{time,tracks:drawTracks});
    return animation.screenshot({animations:"disabled"});
  }
  const animationFrames = new Map();
  const keyTimes = [0,.1,.2,.4,.6,.8,1];
  for (const t of keyTimes) animationFrames.set(t,await keyframe(t));
  for (const t of [.8,.2,1,0,.4,.6,.1,.8,.1]) {
    assert((await keyframe(t)).equals(animationFrames.get(t)),`MG pixels differ at ${t}`);
  }
  await writeFile(join(evidence,"G1-动画重复绘制.png"),animationFrames.get(.6));
  const fade = await after.evaluate(() => [4,4.15,4.301].map(t=>{
    drawFrame(t);
    return Number(document.querySelector(".media-slot").style.opacity);
  }));
  assert.equal(fade[0],0);
  assert(Math.abs(fade[1]-.5)<1e-12);
  assert.equal(fade[2],1);

  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on("pageerror",err=>errors.push(err.message));
  let composePayload;
  await page.route("**/api/jobs",async route=>{
    if (route.request().method()==="POST") {
      composePayload=route.request().postDataJSON();
      assert.equal(composePayload.kind,"video");
      assert.equal(composePayload.settings.voice,"无配音");
      assert(!composePayload.avatar);
      assert(composePayload.items.every(s=>s.content.kind!=="image"));
    }
    await route.continue();
  });
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="stage-layout"]').first().waitFor();
  await page.evaluate(() => {
    const w = current();
    w.topic = "核对资料";
    w.templatePresenter = "none";
    Object.assign(w.settings,{voice:"无配音",music:"off",avatarMode:"static"});
    w.stagePlan.audio.sfx={pack:"off",gainDb:-14};
    const line = "查看手边的说明书，记录疑问。";
    const items = [{title:"看清位置",detail:"找到对应栏目",tag:""},{title:"记录疑问",detail:"下次核对",tag:""}];
    StageStudio.installDraft(w,"stage",{title:"核对资料",chapters:["查看","记录"],shots:[0,1].map(i=>({
      name:i ? "翻到说明书对应页" : "核对资料",line,seconds:4,chapterIndex:i,
      points:{type:"steps",headline:"看清对应栏目",items},cues:[{text:line,focus:"all",weight:1}],
      content:i ? {kind:"svg",beats:[{action:"leaflet",line,label:"找栏目"}]} : {kind:"card",motionStyle:"flow"},
    }))});
    changed(w);render();
  });
  await page.locator("#stage-play:not([disabled])").waitFor();
  await page.locator('[data-action="stage-select"][data-val="1"]').click();
  const properties = [];
  const iframe = page.locator("#stage-preview");
  for (const kind of ["fade","wipe","iris","slide"]) {
    await page.locator('[data-stage-field="transition"]').selectOption(kind);
    await page.locator("#stage-play:not([disabled])").waitFor();
    await page.locator("#stage-seek").fill("0.12");
    const data = await iframe.evaluate(frame=>{
      const doc = frame.contentDocument;
      const slot = doc.querySelector(".media-slot");
      const {opacity,transform,clipPath} = slot.style;
      return {opacity,transform,clipPath,header:doc.querySelector(".pt-header").outerHTML};
    });
    assert(kind==="fade" ? Math.abs(Number(data.opacity)-.4)<1e-8 : data.clipPath.length>0);
    properties.push(data);
    await page.screenshot({path:join(evidence,`G1-转场-${kind}.png`),fullPage:true});
  }
  assert.equal(new Set(properties.map(s=>s.header)).size,1);
  assert.equal(new Set(properties.map(s=>s.opacity+s.transform+s.clipPath)).size,4);
  await page.getByRole("button",{name:"合成视频",exact:true}).click();
  const start = performance.now();
  await page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
  await page.locator("video.video-player").waitFor({timeout:45000});
  const elapsed = (performance.now()-start)/1000;
  assert.equal(composePayload.items[1].content.transition,"slide");
  const movie = join(sandbox,".studio","media",composePayload.id+".mp4");
  const duration = Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",movie]));
  assert.equal(duration,8);
  for (const [label,time] of [["转场中","4.10"],["转场完成","4.38"]]) {
    execFileSync("ffmpeg",["-y","-v","error","-ss",time,"-i",movie,"-frames:v","1",join(evidence,`G1-成片-${label}.png`)]);
  }
  const rgb = path => execFileSync("ffmpeg",["-v","error","-i",path,"-vf","crop=900:500:310:90","-frames:v","1",
    "-pix_fmt","rgb24","-f","rawvideo","-"],{maxBuffer:2_000_000});
  const a=rgb(join(evidence,"G1-成片-转场中.png")),b=rgb(join(evidence,"G1-成片-转场完成.png"));
  const motionMean=a.reduce((total,value,i)=>total+Math.abs(value-b[i]),0)/a.length;
  assert(motionMean>4);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({baseline:rows.length,unordered:11,mgPixelFrames:9,legacyFade:times.length,fade,duration,elapsed,motionMean,browserErrors:errors.length}));
} finally {
  await browser?.close();
  await rm(old,{recursive:true,force:true});
}
