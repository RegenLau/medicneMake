import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const [origin, sandboxRoot, screenshotDirectory] = process.argv.slice(2);
const screenshots = resolve(screenshotDirectory);
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const picture = "/assets/template-info-tablet.jpg";
const labels = { image:"AI 完整图", card:"信息图动效", scene:"代码动效场景", svg:"SVG 演示动画", asset:"素材库素材" };

function localStoryboardCache(payload) {
  const code = `import hashlib,json,shutil,sys,server
p=json.load(sys.stdin)
s=p['settings']
for i,it in enumerate(p['items']):
 tail=p['items'][i+1]['image'] if it.get('matchNext') and i+1<len(p['items']) else None
 it=server.storyboard_timing(it,0,server.VIDEO_MODELS[s['videoModel']][2],tail)
 fields=[p['mode'],s['videoModel'],s['ratio'],s['resolution'],s['watermark'],it['image'],it['prompt'],it['seconds']]
 if tail: fields.append(tail)
 stem=hashlib.sha256(json.dumps(fields,ensure_ascii=False).encode()).hexdigest()
 shutil.copyfile('test-cached-clip.mp4',server.DATA/(stem+'.mp4'))`;
  execFileSync("python3", ["-B", "-c", code], { cwd: sandboxRoot, input: JSON.stringify(payload) });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  const submitted = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/jobs", async route => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      assert.equal(payload.kind, "video", "C must not submit model generation jobs");
      assert.equal(payload.settings.voice, "无配音");
      assert(!payload.avatar);
      if (payload.storyboard) localStoryboardCache(payload);
      submitted.push(payload);
    }
    await route.continue();
  });

  const save = async path => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots,path + ".png"), fullPage: true });
  };
  const ready = () => page.locator('#stage-play:not([disabled])').waitFor();
  async function exportVideo(label, stage = true) {
    const since = Date.now();
    await page.getByRole("button",{name:stage ? "合成视频" : /用方舟生成视频/,exact:stage}).click();
    await page.getByRole("dialog").locator('[data-action="confirm-paid"]').click();
    await page.locator("video.video-player").waitFor({ timeout:75000 });
    const movie = await page.locator("video.video-player").getAttribute("src");
    const path = join(sandboxRoot,".studio",movie.slice(1));
    const raw = execFileSync("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",path],{encoding:"utf8"});
    execFileSync("ffmpeg", ["-v", "error", "-i",path,"-f","null","-"],{stdio:"pipe"});
    await save(label);
    const item = { label, duration:Number(raw), exportSeconds:(Date.now()-since)/1000, movie };
    results.push(item);
    return item;
  }

  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await page.getByRole("button",{name:"信息图模板",exact:true}).click();
  await page.locator('#topic').fill('用药信息如何核对');
  await save("01-新建选择布局");
  const newId = await page.evaluate(image => {
    const w = current();
    const configLine = "先看清手边的资料，再记录核对结果。";
    w.settings.voice = "无配音";
    w.settings.music = "off";
    w.settings.avatarMode = "static";
    w.templatePresenter = "none";
    StageStudio.installDraft(w,"image",{title:"用药资料核对",chapters:["看清资料","核对记录"],slides:Array.from({length:5}, (_,i) => ({
      name:"核对第"+(i+1)+"项",line:configLine,headline:"核对手边资料",type:"explain",layoutMode:"explain",seconds:4,
      chapterIndex:i>2?1:0,contentImage:image,points:[{title:"说明书对应栏目",desc:"读完再记录"}],highlightWords:["资料"],
    }))});
    changed(w); render();
    return w.id;
  },picture);
  await ready();
  const original = await page.evaluate(() => {
    const {line,points,cues} = current().stagePlan.shots[0];
    return {line,points,cues};
  });
  for (const kind of ["card","scene","svg","asset","image"]) {
    await page.locator(`[data-action="stage-kind"][data-val="${kind}"]`).click();
    await ready();
    assert.deepEqual(await page.evaluate(() => {
      const {line,points,cues} = current().stagePlan.shots[0];
      return {line,points,cues};
    }), original, `switching to ${kind} should preserve shared content`);
    await save(`02-同一幕-${kind}`);
  }
  assert.equal(await page.evaluate(() => current().stagePlan.shots[0].content.image), picture);
  for (const [index,kind] of ["image","svg","scene","card","asset"].entries()) {
    await page.locator(`[data-action="stage-select"][data-val="${index}"]`).click();
    assert(await page.locator(`[data-action="stage-kind"][data-val="${kind}"]`).isVisible());
    await page.locator(`[data-action="stage-kind"][data-val="${kind}"]`).click();
    await ready();
  }
  await page.getByRole("button",{name:"选择图片或 SVG",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"SVG 图形",exact:true}).click();
  await page.getByRole("dialog").getByRole("article").filter({hasText:"阅读清单"}).getByRole("button",{name:"使用此素材"}).click();
  await ready();
  for (const text of Object.values(labels)) assert(await page.locator('.stage-rail').getByText(new RegExp(text)).count());
  await page.getByRole("button",{name:"播放本幕",exact:true}).click();
  await page.getByRole("button",{name:"暂停",exact:true}).waitFor();
  await page.getByRole("button",{name:"暂停",exact:true}).click();
  await page.locator("#stage-seek").fill("1.50");
  await save("03-五种方式统一编辑");
  await page.setViewportSize({width:390,height:844});
  await save("03-五种方式移动预览");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({width:1440,height:1050});
  const mixed = await exportVideo("04-五幕成品");
  assert(Math.abs(mixed.duration-20)<1/24);
  assert.deepEqual(submitted.at(-1).items.map(shot=>shot.content.kind),["image","svg","scene","card","asset"]);
  for (let i=0;i<5;i++) {
    execFileSync("ffmpeg", ["-y","-v","error","-ss",String(i*4+1.6),"-i",join(sandboxRoot,".studio",mixed.movie.slice(1)),"-frames:v","1",join(screenshots,`04-抽帧-${i+1}.png`)]);
  }

  const legacyIds = await page.evaluate(image => {
    const defaultWork = {type:"video",stage:"script",topic:"本机旧作品",title:"本机旧作品",drug:"",style:0,tags:[],
      settings:{...current().settings,ratio:"16:9",voice:"无配音",music:"off",avatarMode:"static"},
      templatePresenter:"none",costTracking:true,created:Date.now(),updated:Date.now()};
    const rows = ["核对名称","确认栏目"].map(name => ({name,line:"查看手边的说明书。",headline:name,
      type:"explain",seconds:4,layoutMode:"explain",contentImage:image,image,prompt:"近景核对资料", chapterIndex:0,
      variant:0,manualSeconds:true,points:[{title:"核对说明书",desc:"查看对应栏目"}]}));
    const modes = [["template","template"],["template-card","template"],["scene","code-motion"],["svg","svg"],["storyboard","storyboard"]];
    const result = {};
    for (const [label,videoMode] of modes) {
      const w = {...structuredClone(defaultWork),id:crypto.randomUUID(),videoMode,blocks:structuredClone(rows)};
      if (videoMode === "template") {
        w.templateDeck = {title:w.title,chapters:["核对","确认"],slides:structuredClone(rows),presenter:"none"};
        if(label === "template-card") w.templateContent = "code-motion";
      } else if (videoMode === "svg") w.blocks.forEach(shot => {shot.action="leaflet";});
      else if (videoMode === "code-motion") w.blocks.forEach(shot => {
        Object.assign(shot,{visual:"checklist",motion:"spotlight",motif:"checklist",tone:"safe",items:[{title:"说明书",detail:"查看栏目",tag:""}],takeaway:"核对栏目"});
      });
      data.works.unshift(w);
      result[label] = w.id;
    }
    save();
    return result;
  },picture);
  execFileSync("ffmpeg", ["-y","-v","error","-f","lavfi","-i","color=c=navy:size=1280x720:rate=24","-t","4","-c:v","libx264","-pix_fmt","yuv420p",join(sandboxRoot,"test-cached-clip.mp4")]);
  for (const [label,id] of Object.entries(legacyIds)) {
    await page.goto(origin + "/#work/" + id);
    if (label !== "storyboard") {
      await ready();
      assert.equal(await page.evaluate(() => current().stagePlan.shots[0].line), "查看手边的说明书。");
      await page.getByRole("textbox",{name:"本幕标题",exact:true}).fill("复核栏目");
    } else {
      await page.getByRole("heading",{name:"编辑分镜脚本",exact:true}).waitFor();
      assert.equal(await page.evaluate(() => Boolean(current().stagePlan)), false);
      await page.locator('textarea[data-block="0"][data-key="line"]').fill("核对手边说明书的栏目。");
    }
    await save("05-打开编辑旧作品-"+label);
    const clip = await exportVideo("06-重新合成旧作品-"+label,label!=="storyboard");
    assert(Math.abs(clip.duration-8)<.08, JSON.stringify(clip));
  }
  const resume = await page.evaluate(image => {
    const w = structuredClone(current());
    w.id = crypto.randomUUID();
    w.title = "等待继续的旧模板";
    w.video = null;
    w.videoMode = "template";
    w.stage = "script";
    const id = crypto.randomUUID();
    const payload = {id,workId:w.id,settings:w.settings,mode:"ark",kind:"video",template:true,style:0,
      items:[{line:"查看说明书。",seconds:4,cues:[{image,weight:1}]}]};
    w.job = {target:"compose",payload,error:"本地服务已重启，可继续此任务。"};
    data.works.push(w);
    save();
    return {workId:w.id,payload};
  },picture);
  await writeFile(join(sandboxRoot,".studio","jobs",resume.payload.id+".json"),JSON.stringify({
    id:resume.payload.id,request:resume.payload,status:"failed",results:[],remote:{},error:"本地服务已重启，可继续此任务。",
  }));
  await page.goto(origin + "/#work/" + resume.workId);
  await page.getByRole("button",{name:"继续此任务",exact:true}).waitFor();
  await save("07-旧任务继续");
  await page.getByRole("button",{name:"继续此任务",exact:true}).click();
  await page.locator("video.video-player").waitFor({timeout:35000});
  assert.equal(submitted.at(-1).id,resume.payload.id);
  assert.equal(await page.locator("video.video-player").getAttribute("src"),`/media/${resume.payload.id}.mp4`);
  await save("08-旧任务恢复成片");
  const raw = execFileSync("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",
    join(sandboxRoot,".studio","media",resume.payload.id+".mp4")],{encoding:"utf8"});
  results.push({label:"旧任务继续",duration:Number(raw)});
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile(join(sandboxRoot,"stage-c-results.json"),JSON.stringify({newId,results},null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await browser.close();
}
