import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const [origin,sandbox,output] = process.argv.slice(2);
const screenshots = resolve(output);
await mkdir(screenshots,{recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true});
const classic = "builtin:layout/info-classic";
const right = "builtin:layout/corner-presenter";
const rightName = "右栏主讲";
const kinds = ["image","card","scene","svg","asset"];
const posted = [];
const changes = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  page.setDefaultTimeout(17000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", popup => popup.accept());
  await page.route("**/api/jobs", async route => {
    if (route.request().method() === "POST") {
      const p = route.request().postDataJSON();
      assert.equal(p.kind,"video");
      assert.equal(p.settings.voice,"无配音");
      assert(!p.avatar);
      assert(p.items.every(it => it.content.kind !== "image" || it.content.image));
      posted.push(p);
    }
    await route.continue();
  });
  const button = name => page.getByRole("button",{name,exact:true});
  const dialog = () => page.getByRole("dialog");
  const ready = () => page.locator("#stage-play:not([disabled])").waitFor();
  const save = name => page.screenshot({path:join(screenshots,name+".png"),fullPage:true});
  const layout = id => page.locator(`[data-action="stage-layout"][data-val="${id}"]`);
  const frame = () => page.frameLocator('iframe[title="布局实时预览"]');
  const get = async (path) => (await page.request.get(origin + path)).json();
  const getDefinition = id => get("/library/" + encodeURIComponent(id));
  const openLibrary = async () => {
    await button("素材库").click();
    await button("布局").click();
    await page.getByRole("heading",{name:rightName,exact:true}).waitFor();
  };
  const setup = async () => {
    await page.goto(origin);
    await page.locator('[data-action="new"][data-val="video"]').click();
    await page.locator('[data-action="stage-layout"]').first().waitFor();
  };
  const seed = () => page.evaluate(() => {
    const w = current();
    w.topic = "用药资料核对";
    w.templatePresenter = "digital";
    Object.assign(w.settings, {voice:"无配音",music:"off",avatarMode:"static"});
    w.stagePlan.audio.sfx = {pack:"off",gainDb:-14};
    const line = "看清说明书，再核对记录。";
    const kinds = ["image","card","scene","svg","asset"];
    const content = [
      {image:"/assets/template-info-tablet.jpg"},
      {motionStyle:"reveal"},
      {visual:"steps",motion:"flow",motif:"checklist",tone:"primary"},
      {beats:[{action:"leaflet",line,label:"找到栏目"}]},
      {assetId:"builtin:svg/reading-list",move:"zoom"},
    ];
    const names = ["已有信息图","要点核对","步骤讲解","翻看说明书","阅读清单"];
    StageStudio.installDraft(w,"stage",{title:"用药资料核对",chapters:["先核对","再记录"],shots:kinds.map((kind,i)=>({
      name:names[i], line, seconds:4, chapterIndex:i > 2 ? 1 : 0,
      points:{type:"steps",headline:names[i],items:[{title:"找到对应栏目",detail:"看清手边资料",tag:""},{title:"记录疑问",detail:"便于下次核对",tag:""}]},
      cues:[{text:line,weight:1,focus:"all"}],content:{kind,...content[i]},
    }))});
    changed(w);
    render(true);
    return w.id;
  });
  const globalSettings = () => page.getByRole("tab",{name:"全片设置",exact:true}).click();
  const selectShot = async index => {
    await page.locator(`[data-action="stage-select"][data-val="${index}"]`).click();
    await ready();
  };

  async function exportVideo(label, takeFrames = false) {
    await button("合成视频").click();
    const t = performance.now();
    await dialog().locator('[data-action="confirm-paid"]').click();
    await page.locator("video.video-player").waitFor({timeout:80000});
    const seconds = (performance.now() - t) / 1000;
    const v = await page.evaluate(() => current().video);
    const movie = join(sandbox,".studio",v.url.slice(1));
    const file = JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",movie]));
    const duration = Number(file.format.duration);
    assert.equal(duration,20);
    assert.equal(Number(file.streams[0].nb_frames),480);
    assert.deepEqual(posted.at(-1).items.map(it => it.content.kind),kinds);
    const rgbHash = execFileSync("ffmpeg",["-v","error","-i",movie,"-map","0:v:0","-f","hash","-"],{encoding:"utf8"}).trim();
    if (takeFrames) for (let i=0;i<5;i++) {
      execFileSync("ffmpeg",["-y","-v","error","-ss",String(i*4+2),"-i",movie,"-frames:v","1",join(screenshots,`${label}-抽帧${i+1}.png`)]);
    }
    await save(label);
    const refs = v.assetVersions.find(item => item.kind === "layout");
    const row = {label, duration, seconds, videoHash:rgbHash, layout:refs.id, sha256:refs.sha256, ...v.renderStats};
    changes.push(row);
    return row;
  }

  await setup();
  const before = await getDefinition(classic);
  const alt = await getDefinition(right);
  for (const key of ["media", "presenter"]) {
    const region = before.regions[key];
    assert.deepEqual(alt.regions[key], {...region, x:100 - region.x - region.w});
  }
  assert.deepEqual(alt.regions.header,before.regions.header);
  assert.deepEqual(alt.regions.subtitle,before.regions.subtitle);
  await save("01-新建选择两个内置布局");
  const firstId = await seed();
  await ready();
  for (const [id,label] of [[classic,"02-左栏"],[right,"03-右栏"]]) {
    await globalSettings();
    await layout(id).click();
    await ready();
    for (const [i,kind] of kinds.entries()) {
      await selectShot(i);
      const preview = page.frameLocator("#stage-preview");
      const slot = preview.locator(".media-slot");
      assert.equal(Math.round(parseFloat(await slot.evaluate(el => el.style.left))),id === classic ? 288 : 32);
      const presenter = await preview.locator(".pt-left").evaluate(el => [el.offsetLeft,el.offsetTop,el.offsetWidth,el.offsetHeight]);
      assert.deepEqual(presenter,[id === classic ? 32 : 1016,80,232,540]);
      assert(await slot.locator("*").count() > 0);
      await save(`${label}-${kind}`);
    }
    await exportVideo(label+"-成片",true);
    await button("返回分镜编辑").click();
    await ready();
  }
  await globalSettings();
  await button("管理布局").click();
  const rightCard = dialog().getByRole("article").filter({has:page.getByRole("heading",{name:rightName,exact:true})});
  await rightCard.getByRole("button",{name:"预览布局",exact:true}).click();
  await frame().locator(".pt-frame.theme-medical").waitFor();
  await dialog().getByLabel("主题").selectOption("warm");
  await dialog().getByLabel("制作方式").selectOption("svg");
  await frame().locator(".pt-frame.theme-warm .stage-svg-drawing svg").waitFor();
  await save("04-暖色与SVG预览");
  await dialog().getByRole("button",{name:"返回管理布局"}).click();
  await rightCard.getByRole("button",{name:"复制为我的布局",exact:true}).click();
  await dialog().getByLabel("布局名称").fill("右栏布局副本");
  const x = dialog().locator('[data-region="media"][data-coordinate="x"]');
  await x.fill("5");
  await frame().locator('.media-slot[style*="left:64.000000px"]').waitFor();
  await save("05-复制并实时修改布局");
  await dialog().getByRole("button",{name:"另存布局"}).click();
  const personal = dialog().getByRole("article").filter({has:page.getByRole("heading",{name:"右栏布局副本",exact:true})});
  await personal.waitFor();
  const items = (await get("/api/library")).items;
  const cloned = items.find(entry => entry.name === "右栏布局副本");
  assert(cloned?.id.startsWith("user:"));
  assert.equal(cloned.originId,right);
  assert.equal((await getDefinition(cloned.id)).regions.media.x,5);
  assert.deepEqual(await getDefinition(classic),before);
  assert.deepEqual(await getDefinition(right),alt);
  await dialog().getByRole("button",{name:"关闭弹窗"}).click();

  await setup();
  await layout(cloned.id).click();
  assert.equal(await layout(cloned.id).getAttribute("aria-pressed"),"true");
  const reusedWorkId = await seed();
  await ready();
  const reused = await exportVideo("06-新作品使用副本");
  await button("返回分镜编辑").click();
  await ready();
  await globalSettings();
  await button("管理布局").click();
  await personal.getByRole("button",{name:"下架",exact:true}).click();
  await personal.waitFor({state:"hidden"});
  await dialog().getByRole("button",{name:"关闭弹窗"}).click();
  assert.equal(await layout(cloned.id).count(),0);
  await page.getByText("当前作品保留已下架布局").waitFor();
  await save("07-下架后仍引用旧版式");
  const archived = await exportVideo("08-下架布局重新合成");
  assert.equal(archived.layout,cloned.id);
  assert.equal(archived.sha256,reused.sha256);
  const archiveComparison = [];
  const readPixels = (p,t) => execFileSync("ffmpeg",["-v","error","-ss",String(t),"-i",
    join(sandbox,".studio","media",p.id+".mp4"),"-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","-"],{maxBuffer:3_000_000});
  for (let t=2;t<20;t+=4) {
    const a = readPixels(posted.at(-2),t), b = readPixels(posted.at(-1),t);
    assert.equal(a.length,b.length);
    let total = 0;
    let overEight = 0;
    for (let i=0;i<a.length;i+=3) {
      const delta = [Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2])];
      total += delta[0]+delta[1]+delta[2];
      if (delta.some(n => n > 8)) overEight++;
    }
    const mean = total/a.length;
    const fractionAboveEight = 3*overEight/a.length;
    assert(mean <= 1 && fractionAboveEight <= .012);
    archiveComparison.push({t,mean,fractionAboveEight});
  }
  assert.equal(await page.evaluate(() => current().id), reusedWorkId);
  assert((await getDefinition(cloned.id)).regions.media.x === 5);
  assert.deepEqual(await getDefinition(classic),before);

  console.log(JSON.stringify({layouts:changes,archiveComparison}));
  await openLibrary();
  const upload = async (definition,label,error) => {
    await button("上传布局").click();
    const form = dialog().locator("form");
    await form.getByLabel("布局 JSON 文件").setInputFiles({name:label+".json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(definition))});
    await form.getByLabel("名称",{exact:true}).fill(label);
    await form.locator('select[name="license"]').selectOption("自制或已获授权");
    await form.getByLabel("署名或来源",{exact:false}).fill("本机测试样例");
    await form.getByRole("button",{name:"收入素材库"}).click();
    if (error) {
      const alert = form.getByRole("alert");
      await alert.waitFor();
      assert((await alert.innerText()).includes(error));
      await save(label);
      await dialog().getByRole("button",{name:"关闭弹窗"}).click();
    } else {
      await page.getByRole("heading",{name:label,exact:true}).waitFor();
      await save(label);
    }
  };
  await upload({...alt, html:"<script>test</script>"},"09-拒绝夹带脚本","未知字段");
  const changedDef = structuredClone(alt);
  changedDef.regions.media.component = "unknown-widget";
  await upload(changedDef,"10-拒绝未知组件","组件无效");
  await upload(alt,"11-成功上传布局");
  await page.goto(origin + "/#work/" + firstId);
  await ready();
  assert.equal(await page.evaluate(() => current().id),firstId);
  assert.equal(await page.evaluate(() => current().video.url), "/media/" + posted[1].id + ".mp4");
  assert.deepEqual(errors,[]);
  const compareFrames = [1,2,3,4,5].map(i => {
    const pixels = prefix => execFileSync("ffmpeg",["-v","error","-i",join(screenshots,`${prefix}-成片-抽帧${i}.png`),
      "-vf","crop=1000:540:10:80","-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","-"],{maxBuffer:2_000_000});
    const a = pixels("02-左栏"), b = pixels("03-右栏");
    return a.reduce((sum,value,k) => sum + Math.abs(value-b[k]),0) / a.length;
  });
  assert(compareFrames.every(diff => diff > 5));
  console.log(JSON.stringify({layouts:changes,compareFrames,archiveComparison,errors:errors.length}));
} finally {
  await browser.close();
}
