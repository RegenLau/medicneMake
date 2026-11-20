import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const [origin,sandbox,dir] = process.argv.slice(2);
const output = resolve(dir);
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true,args:["--disable-gpu","--disable-partial-raster"]});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1024}});
  page.setDefaultTimeout(22000);
  const posted=[];
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/jobs",async route=>{
    if (route.request().method()==="POST") {
      const payload=route.request().postDataJSON();
      assert(["draft","mg-draft","video"].includes(payload.kind));
      assert(!payload.avatar);
      if (payload.kind==="video") {
        assert.equal(payload.settings.voice,"无配音");
        assert(payload.items.every(shot=>shot.content.kind!=="image"));
      }
      if (payload.kind==="draft") assert.equal(payload.draft.imageBudget,0);
      posted.push(payload);
    }
    await route.continue();
  });
  const button = name=>page.getByRole("button",{name,exact:true});
  const dialog=()=>page.getByRole("dialog");
  const modalButton=name=>dialog().getByRole("button",{name,exact:true});
  const close=()=>modalButton("关闭弹窗").click();
  const save=label=>page.screenshot({path:join(output,label+".png"),fullPage:true});
  const fetch=async path=>(await page.request.get(origin+path)).json();
  const pending=async()=> (await fetch("/api/library/mg-pending")).items;
  const library=async()=> (await fetch("/api/library")).items;
  const ready=()=>page.locator("#stage-play:not([disabled])").waitFor();
  const checkPreview=async()=>{
    await dialog().getByRole("heading",{name:"待确认 MG 素材",exact:true}).waitFor();
    const video=dialog().locator(".motion-preview-video");
    await video.waitFor();
    await video.evaluate(element=> !Number.isFinite(element.duration) ?
      new Promise((resolve,reject)=>{
        element.addEventListener("loadedmetadata",resolve,{once:true});
        element.addEventListener("error",reject,{once:true});
      }) : undefined);
    assert.equal(await video.evaluate(el=>el.duration),3);
  };
  const card=name=>page.getByRole("article").filter({has:page.getByRole("heading",{name,exact:true})});
  const useAsset=id=>"/api/library/motion/"+encodeURIComponent(id);

  await page.goto(origin);
  await button("素材库").click();
  await button("待确认").click();
  assert.equal((await pending()).length,0);
  await button("AI 制作 MG").click();
  await dialog().locator('[name="description"]').fill("药盒滑动演示");
  await modalButton("生成草稿并计费").click();
  await checkPreview();
  assert.equal((await pending()).length,1);
  const first=(await pending())[0];
  assert.equal((await page.request.get(origin+useAsset(first.id))).status(),404);
  assert(!((await library()).some(item=>item.id===first.id)));
  await save("G3-待确认预览");
  await close();
  await card(first.name).waitFor();
  await save("G3-待确认区");
  await card(first.name).getByRole("button",{name:"检查预览"}).click();
  await modalButton("补充要求后重新生成").click();
  await dialog().locator('[name="revision"]').fill("把主体改成绿色");
  await save("G3-补充要求");
  await modalButton("生成草稿并计费").click();
  await checkPreview();
  const revised=(await pending()).find(item=>item.parentId===first.id);
  assert(revised);
  assert.equal(revised.revision,"把主体改成绿色");
  assert.equal((await pending()).length,2);
  await save("G3-重新生成");
  await modalButton("丢弃").click();
  await dialog().waitFor({state:"hidden"});
  assert.equal((await pending()).length,1);
  assert.equal((await page.request.get(origin+revised.previewUrl)).status(),404);
  await save("G3-丢弃后");
  await card(first.name).getByRole("button",{name:"检查预览"}).click();
  await modalButton("采用入库").click();
  await dialog().waitFor({state:"hidden"});
  const adopted=(await library()).find(item=>item.originId===first.id);
  assert.equal(adopted.kind,"mg");
  assert.equal(adopted.source,"ai");
  assert.equal((await page.request.get(origin+first.previewUrl)).status(),404);
  assert.equal((await page.request.get(origin+adopted.previewUrl)).status(),200);
  assert.equal((await fetch(useAsset(adopted.id))).kind,"mg");
  await card(first.name).waitFor();
  await save("G3-已采用素材");

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.locator('[data-action="stage-layout"]').first().waitFor();
  await page.locator("#topic").fill("怎么核对用药资料");
  await page.getByRole("spinbutton",{name:"AI 出图上限"}).fill("0");
  await page.evaluate(()=>{
    const w=current();
    w.templatePresenter="none";
    Object.assign(w.settings,{voice:"无配音",music:"off",avatarMode:"static",duration:30});
    changed(w);
  });
  await page.locator('[data-action="generate"]').click();
  await dialog().locator('[data-action="confirm-paid"]').click();
  await ready();
  await button("可以用 AI 制作 MG 素材").waitFor();
  assert.equal(posted.filter(p=>p.kind==="mg-draft").length,2);
  assert.equal(await page.evaluate(()=>current().stagePlan.shots[0].content.kind),"scene");
  await save("G3-Mix保留备用方式");
  await button("可以用 AI 制作 MG 素材").click();
  assert.equal(await dialog().locator('[name="description"]').inputValue(),"让药盒从左滑入并停在核对位置");
  await modalButton("生成草稿并计费").click();
  await checkPreview();
  const stageDraft=(await pending())[0];
  assert.equal(await page.evaluate(()=>current().stagePlan.shots[0].content.kind),"scene");
  assert(!(await library()).some(item=>item.originId===stageDraft.id));
  await save("G3-Mix草稿待确认");
  await modalButton("采用入库").click();
  await ready();
  const stageArt=page.frameLocator("#stage-preview").locator(".stage-mg-art svg");
  await stageArt.waitFor();
  const selection=await page.evaluate(()=>current().stagePlan.shots[0].content);
  const asset=(await library()).find(item=>item.originId===stageDraft.id);
  assert.equal(selection.assetId,asset.id);
  assert.equal(selection.kind,"mg");
  assert.equal(selection.decidedBy,"user");
  await save("G3-确认后切换为MG");
  await button("合成视频").click();
  const t=performance.now();
  await dialog().locator('[data-action="confirm-paid"]').click();
  await page.locator("video.video-player").waitFor({timeout:48000});
  const elapsed=(performance.now()-t)/1000;
  const movie=join(sandbox,".studio","media",posted.at(-1).id+".mp4");
  const duration=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",movie]));
  const result=await page.evaluate(()=>current().video);
  const exact=result.shotSeconds.reduce((total,s)=>total+s,0);
  assert(Math.abs(duration-exact)<=1/24);
  assert.equal(posted.at(-1).items[0].content.assetId,asset.id);
  assert(result.assetVersions.some(ref=>ref.id===asset.id&&ref.kind==="mg"));
  const events=JSON.parse(await readFile(join(sandbox,".studio","jobs",posted.at(-1).id,"events.json"),"utf8"));
  const frames=[];
  for (const [label,time] of [["开场","0.25"],["移动完成","2.9"]]) {
    const path=join(output,`G3-成片抽帧-${label}.png`);
    execFileSync("ffmpeg",["-y","-v","error","-ss",time,"-i",movie,"-frames:v","1",path]);
    frames.push(execFileSync("ffmpeg",["-v","error","-i",path,"-vf","crop=800:400:380:155",
      "-pix_fmt","rgb24","-f","rawvideo","-"],{maxBuffer:2_000_000}));
  }
  const mean=frames[0].reduce((sum,x,i)=>sum+Math.abs(x-frames[1][i]),0)/frames[0].length;
  assert(mean>5);
  assert.deepEqual(errors,[]);
  await save("G3-含MG合成结果");
  console.log(JSON.stringify({submissions:posted.map(x=>x.kind),elapsed,duration,exact,mean,events,browserErrors:errors.length}));
} finally {
  await browser.close();
}
