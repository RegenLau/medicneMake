import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import "../public/stage/motion-content.js";

const [origin,sandbox,dir] = process.argv.slice(2);
const output = resolve(dir);
await mkdir(output,{recursive:true});
const capsule = JSON.parse(await readFile("public/assets/library/lottie/capsule.json","utf8"));
const markers = capsule.markers.map(mark=>({name:mark.cm,t:mark.tm/capsule.fr,d:mark.dr/capsule.fr}));
const marked = {duration:2.5,markers,animation:capsule};
const {timing,animationTime,markerEvents} = StageMotion;
const integrated = timing(marked,4);
assert.equal(integrated.length,3);
assert.equal(integrated[0].source,0);
assert.equal(integrated[1].loop,true);
assert.equal(integrated[2].source,46/24);
assert.equal(animationTime(integrated,0),0);
assert(Math.abs(animationTime(integrated,2)-animationTime(integrated,2-32/24))<1e-9);
assert.deepEqual(markerEvents(marked,integrated).map(event=>Number(event.t.toFixed(6))),[.875,2.208333]);
const unmarked = {...marked,markers:[]};
const inRange = timing(unmarked,2);
assert.equal(inRange[0].rate,1.25);
assert.equal(animationTime(inRange,1),1.25);
const long = timing(unmarked,6);
assert.equal(long[0].rate,.75);
assert.equal(animationTime(long,5),2.5);
const short = timing(unmarked,1);
assert.equal(short[0].rate,1.5);
assert.equal(animationTime(short,.99),2.5);

let browser;
try {
  browser = await chromium.launch({channel:"chrome",headless:true,args:["--disable-gpu","--disable-partial-raster"]});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(19000);
  const errors = [];
  page.on("pageerror",e=>errors.push(e.message));
  let job;
  await page.route("**/api/jobs",async route=>{
    if (route.request().method()==="POST") {
      job=route.request().postDataJSON();
      assert.equal(job.kind,"video");
      assert.equal(job.settings.voice,"无配音");
      assert(!job.avatar);
      assert(job.items.every(s=>s.content.kind==="mg"));
    }
    await route.continue();
  });
  const get = async path => (await page.request.get(origin + path)).json();
  const button = name => page.getByRole("button",{name,exact:true});
  const dialog = () => page.getByRole("dialog");
  const save = label => page.screenshot({path:join(output,label+".png"),fullPage:true});
  const close = () => dialog().getByRole("button",{name:"关闭弹窗"}).click();
  await page.goto(origin);
  await button("素材库").click();
  await button("Lottie 动画").click();
  await page.getByRole("heading",{name:"胶囊滑入画面",exact:true}).waitFor();
  const initial = (await get("/api/library")).items.filter(a=>a.kind==="lottie");
  assert(initial.length>=3);
  await save("G2-Lottie素材库");

  async function upload(file,label,reason) {
    await button("上传 Lottie").click();
    const form=dialog().locator("form");

    await form.locator('[name="file"]').setInputFiles({name:label+".json",mimeType:"application/json",buffer:file});
    await form.locator('[name="name"]').fill(label);
    await form.locator('[name="useFor"]').fill("用胶囊动作示意药片");
    await form.locator('[name="license"]').selectOption("自制或已获授权");
    await form.locator('[name="credit"]').fill("本机自制测试");
    await form.locator('[name="palette"]').fill(JSON.stringify({"#1a73e8":"--v-primary","#0e9d65":"--v-green"}));
    await form.getByRole("button",{name:"收入素材库"}).click();
    if (reason) {
      const status=form.getByRole("alert");
      await status.waitFor();
      assert((await status.innerText()).includes(reason));
      await save(label);
      await close();
    } else {
      await page.getByRole("heading",{name:label,exact:true}).waitFor();
      await save(label);
    }
  }
  const text = structuredClone(capsule); text.layers[0].ty=5;
  const external = structuredClone(capsule); external.assets=[{id:"foreign",u:"https://example.invalid/",p:"photo.png"}];
  const expr = structuredClone(capsule); expr.layers[0].ks.p.x="wiggle(2, 10)";
  for (const [data,name,reason] of [
    [text,"G2-拒绝文字","文字图层"],[external,"G2-拒绝外链","外链"],[expr,"G2-拒绝表达式","表达式"],
  ]) await upload(Buffer.from(JSON.stringify(data)),name,reason);
  await upload(Buffer.alloc(1024*1024+1,32),"G2-拒绝超限","1 MB");
  const uploadStart=performance.now();
  await upload(Buffer.from(JSON.stringify(capsule)),"G2-上传Lottie");
  const uploadSeconds=(performance.now()-uploadStart)/1000;
  const uploaded = (await get("/api/library")).items.find(item=>item.name==="G2-上传Lottie");
  assert(uploaded.id.startsWith("user:"));
  const thumb = await page.request.get(origin+uploaded.thumbnailUrl);
  const video = await page.request.get(origin+uploaded.previewUrl);
  assert(thumb.ok()); assert(video.ok());
  const previewFile = join(sandbox,"preview-check.mp4");
  await writeFile(previewFile,await video.body());
  const ffprobe = file => Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",file]));
  assert.equal(ffprobe(previewFile),2.5);
  const card = name => page.getByRole("article").filter({has:page.getByRole("heading",{name,exact:true})});
  const uploadedCard = card("G2-上传Lottie");
  await uploadedCard.getByRole("button",{name:"预览动画"}).click();
  const motionFrame = page.frameLocator('iframe[title="MG 动画实时预览"]');
  const art = motionFrame.locator(".stage-mg-art svg");
  await art.waitFor();
  const hasFill = (r,g,b) => art.locator(`[fill="rgb(${r},${g},${b})"]`).first();
  await hasFill(20,102,204).waitFor({state:"attached"});
  await save("G2-医疗蓝实时配色");
  await dialog().locator('[name="theme"]').selectOption("warm");
  await hasFill(207,82,40).waitFor({state:"attached"});
  await save("G2-暖色实时配色");
  await close();
  await uploadedCard.getByRole("button",{name:"编辑配色"}).click();
  const edit = dialog().locator("form");
  await edit.locator('[name="name"]').fill("G2-蓝色配色副本");
  await edit.locator('[name="palette"]').fill('{"#1a73e8":"--v-ink"}');
  await edit.getByRole("button",{name:"另存配色"}).click();
  await card("G2-蓝色配色副本").waitFor();
  const copied = (await get("/api/library")).items.find(item=>item.name==="G2-蓝色配色副本");
  assert(copied.id!==uploaded.id);
  assert.equal(copied.originId,uploaded.id);
  assert.deepEqual(copied.palette,{"#1a73e8":"--v-ink"});
  await save("G2-配色另存");

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="stage-layout"]').first().waitFor();
  await page.evaluate(()=>{
    const w=current();
    w.topic="药品外观";
    w.templatePresenter="none";
    Object.assign(w.settings,{voice:"无配音",music:"off",avatarMode:"static"});
    const line="看清胶囊外观和包装。";
    StageStudio.installDraft(w,"stage",{title:"核对胶囊外观",chapters:["查看","核对"],shots:[{
      name:"看清胶囊外观",line,seconds:4,chapterIndex:0,points:{type:"explain",headline:"核对胶囊外观",
        items:[{title:"查看外包装",detail:"识别药品",tag:""}]},cues:[{text:line,focus:"all",weight:1}],
      content:{kind:"card",motionStyle:"reveal"},
    }]});
    changed(w);render();
  });
  await page.locator("#stage-play:not([disabled])").waitFor();
  await page.locator('[data-action="stage-kind"][data-val="mg"]').click();
  await button("选择 MG 动画").click();
  await dialog().locator('[data-lib-use="builtin:lottie/capsule"]').click();
  await page.locator("#stage-play:not([disabled])").waitFor();
  const stage = page.locator("#stage-preview");
  const stageArt = page.frameLocator("#stage-preview").locator(".stage-mg-art svg");
  await stageArt.waitFor();
  const state = await stage.evaluate(frame=>{
    const win=frame.contentWindow;
    const doc=frame.contentDocument;
    const art=()=>doc.querySelector(".stage-mg-art");
    const paint=t=>{win.drawFrame(t);return art().innerHTML;};
    const expected=new Map([.3,.8,.875,1,1.7,3.9].map(t=>[t,paint(t)]));
    const replay=[3.9,.3,1.7,.875,.8,1,.3].every(t=>paint(t)===expected.get(t));
    const events=win.collectStageEvents();
    win.drawFrame(.83);
    const before=!!art().querySelector('[fill="rgb(30,142,90)"]');
    win.drawFrame(.875);
    const at=!!art().querySelector('[fill="rgb(30,142,90)"]');
    return {replay,events,before,at};
  });
  assert(state.replay);
  assert.equal(state.before,false);
  assert.equal(state.at,true);
  assert.equal(state.events.find(e=>e.type==="check").t,.875);
  const pixelFrames = new Map();
  const captureFrame = async time => {
    await stage.evaluate(async (frame,t) => {
      const win = frame.contentWindow;
      win.drawFrame(t);
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
    },time);
    return stageArt.screenshot({animations:"disabled"});
  };
  for (const time of [.3,.875,1.2,2,3.9]) pixelFrames.set(time,await captureFrame(time));
  for (const time of [2,.3,3.9,.875,1.2,.875]) {
    assert((await captureFrame(time)).equals(pixelFrames.get(time)),`Lottie SVG frame differs at ${time}`);
  }
  await save("G2-MG幕预览");

  await button("合成视频").click();
  const start=performance.now();
  await dialog().locator('[data-action="confirm-paid"]').click();
  await page.locator("video.video-player").waitFor({timeout:45000});
  const exportSeconds=(performance.now()-start)/1000;
  const movie=join(sandbox,".studio","media",job.id+".mp4");
  assert.equal(ffprobe(movie),4);
  const rows=JSON.parse(await readFile(join(sandbox,".studio","jobs",job.id,"events.json"),"utf8"));
  assert.deepEqual(rows,state.events);
  const frames=[];
  for (const frame of [20,21,22]) {
    const screenshot=join(output,`G2-成片-第${frame}帧.png`);
    execFileSync("ffmpeg",["-y","-v","error","-i",movie,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",screenshot]);
    const raw=execFileSync("ffmpeg",["-v","error","-i",screenshot,"-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","-"],{maxBuffer:3_000_000});
    let green=0;
    for (let y=245;y<500;y++) for (let x=520;x<950;x++) {
      const i=(y*1280+x)*3;
      if (Math.abs(raw[i]-30)<22&&Math.abs(raw[i+1]-142)<22&&Math.abs(raw[i+2]-90)<22) green++;
    }
    frames.push({frame,green});
  }
  assert.equal(frames[0].green,0);
  const visible=frames.find(row=>row.green>500);
  assert(visible);
  assert(Math.abs(visible.frame/24-.875)<=1/24);
  await save("G2-MG成片");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({uploadSeconds,previewSeconds:2.5,exportSeconds,mp4Seconds:ffprobe(movie),encoded:frames,
    delayFrames:Math.abs(visible.frame-21),markerCount:rows.length,renderOrderChecks:7,exactPixelChecks:6,invalidUploads:4}));
} finally {
  await browser?.close();
}
