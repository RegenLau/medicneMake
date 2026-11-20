import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const [origin, sandbox, output] = process.argv.slice(2);
const shotsFolder = resolve(output);
await mkdir(shotsFolder, {recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true});
const soft = "builtin:sfx-pack/soft";
try {
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  page.setDefaultTimeout(15000);
  const errors = [];
  const jobs = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/jobs", async route => {
    if (route.request().method()==="POST") {
      const p = route.request().postDataJSON();
      assert.equal(p.kind,"video");
      assert.equal(p.settings.voice,"无配音");
      assert(!p.avatar);
      assert(p.items.every(shot => shot.content.kind !== "image"));
      jobs.push(p);
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    window.playedSound = [];
    const play = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(time, ...options) {
      window.playedSound.push({time, now:this.context.currentTime, seconds:this.buffer.duration});
      return play.call(this,time,...options);
    };
  });
  const button = name => page.getByRole("button",{name,exact:true});
  const evaluate = fn => page.locator("#stage-preview").evaluate((iframe, source) =>
    iframe.contentWindow.eval(source), "(" + fn.toString() + ")()");
  const ready = () => page.locator("#stage-play:not([disabled])").waitFor();
  const save = name => page.screenshot({path:join(shotsFolder,name+".png"),fullPage:true});
  const selectShot = async i => {
    await page.locator(`[data-action="stage-select"][data-val="${i}"]`).click();
    await ready();
  };
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  await button("信息图模板").click();
  assert.equal(await page.evaluate(() => current().stagePlan.audio.sfx.pack), soft);

  await page.evaluate(() => {
    const w = current();
    const rows = [
      { type:"checklist", kind:"scene", name:"整理用药清单", spans:["查看说明书上的药名。","将用药时间记下来。"],
        content:{visual:"checklist",motif:"checklist",tone:"safe",motion:"spotlight"} },
      { type:"steps", kind:"svg", name:"把药放进随身包", spans:["把原包装药盒放进随身包。","拿不准就带上药盒问药师。"],
        content:{beats:[{action:"travel",line:"把原包装药盒放进随身包。",label:"放进随身包"},
          {action:"consult",line:"拿不准就带上药盒问药师。",label:"问药师"}]} },
      { type:"warning", kind:"card", name:"出门前再核对", spans:["记住先核对。","拿不准问药师。"],
        content:{motionStyle:"flow"} },
    ];
    w.topic = "出门用药准备";
    w.templatePresenter = "none";
    Object.assign(w.settings,{voice:"无配音",music:"off",avatarMode:"static"});
    StageStudio.installDraft(w, "stage", {
      title:"出门用药准备", chapters:["整理","核对"], shots:rows.map((row,i) => ({
        name:row.name,line:row.spans.join(""),seconds:4,chapterIndex:i === 2 ? 1 : 0,
        cues:row.spans.map((text,j) => ({text,focus:i === 2 && j === 1 ? "outro" : "all",weight:1})),
        points:{type:row.type,headline:row.name,items:[
          {title:"查看说明书",detail:"找到药名",tag:""},
          {title:"记录时间",detail:"保留记录",tag:""}],takeaway:"出门前核查"},
        content:{kind:row.kind,...row.content},
      })),
    });
    changed(w);
    render(true);
  });

  await ready();
  await page.getByRole("tab",{name:"全片设置",exact:true}).click();
  const pack = page.getByLabel("画面事件音效");
  assert.equal(await pack.inputValue(),soft);
  const gain = page.getByRole("slider",{name:"音效音量"});
  await gain.fill("-10");
  assert.equal(await page.locator("#stage-sfx-gain").textContent(),"-10 dB");
  await save("01-音效风格和音量");
  await pack.selectOption("off");
  await ready();
  assert(await gain.isDisabled());
  assert.equal(await button("试听音效").count(),0);
  await save("02-关闭音效");
  await pack.selectOption(soft);
  await ready();
  await selectShot(1);
  const targetTime = await evaluate(() => collectStageEvents().find(e => e.shot === 1 && e.type === "beat-in").t);
  assert.equal(targetTime,6);
  await button("试听音效").click();
  await page.waitForFunction(() => playedSound.length >= 3);
  assert.equal(await page.evaluate(() => playedSound.length),3);
  await save("03-试听SVG幕音效");
  await button("暂停").click();

  const alignment = await evaluate(() => {
    const rows = collectStageEvents();
    const probes = {
      "check:0": () => [...document.querySelectorAll("[data-cm-check]")].map(node => node.getAttribute("stroke-dashoffset")).join(","),
      "item-focus:0": () => [...document.querySelectorAll(".cm-item.is-active")].map(node => node.getAttribute("data-cm-item")).join(","),
      "scene-in:1": () => document.querySelector(".pt-title,.pt-topic-pill")?.textContent + !!document.querySelector(".stage-svg-drawing"),
      "beat-in:1": () => document.querySelector('[data-svg-beat="1"]')?.getAttribute("opacity"),
      "check:1": () => !!document.querySelector('[data-svg-beat="1"] path[d="M10 40 L40 63 L100 5"]'),
      "warning:2": () => !!document.querySelector(".pt-fb-headline") && !document.querySelector(".stage-svg-drawing"),
      "outro:2": () => document.querySelector(".pt-subtitle")?.textContent || document.querySelector(".pt-fb-headline")?.textContent,
    };
    const tested = rows.map(event => {
      const read = probes[`${event.type}:${event.shot}`];
      if (!read) return {...event, visualFrames:null};
      const expected = Math.round(event.t * 24);
      drawFrame((expected - 1) / 24);
      const before = read();
      for (let frame = expected; frame <= expected + 1; frame++) {
        drawFrame(frame / 24);
        if (read() !== before) return {...event,visualFrames:Math.abs(frame - event.t * 24)};
      }
      return {...event,visualFrames:Infinity};
    });
    return tested;
  });
  assert(alignment.every(event => event.visualFrames !== null && Number.isFinite(event.visualFrames) && event.visualFrames <= 1), JSON.stringify(alignment));
  assert.equal(alignment.length,8);
  assert(alignment.every((event,index) => !index || event.t - alignment[index-1].t >= .35));
  assert(alignment.every(event => alignment.filter(other => other.shot === event.shot).length <= 4));

  await button("合成视频").click();
  const dialog = page.getByRole("dialog");
  assert.match(await dialog.innerText(),/无模型画面费用/);
  const start = performance.now();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.locator("video.video-player").waitFor({timeout:75000});
  const wall = (performance.now()-start)/1000;
  const result = await page.evaluate(() => current().video);
  const mp4 = join(sandbox,".studio",result.url.slice(1));
  const duration = Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration",
    "-of","default=nw=1:nk=1",mp4],{encoding:"utf8"}));
  assert.equal(duration,12);
  const eventRows = JSON.parse(await readFile(join(sandbox,".studio","jobs",jobs[0].id,"events.json"),"utf8"));
  assert.deepEqual(eventRows.map(({t,type,shot}) => ({t,type,shot})),alignment.map(({t,type,shot}) => ({t,type,shot})));
  const measurement = execFileSync("python3",["-c",
    "import re,subprocess,sys; p=subprocess.run(['ffmpeg','-hide_banner','-i',sys.argv[1],'-af','ebur128=peak=true','-f','null','-'],capture_output=True,text=True,check=True); print(re.findall(r'Peak:\\s+([-\\d.]+) dBFS',p.stderr)[-1])",mp4],
    {encoding:"utf8"}).trim();
  assert(Number(measurement) <= -1);
  await save("04-带音效成片");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({duration,wall, truePeak:Number(measurement), alignment, renderStats:result.renderStats, mp4}));
} finally {
  await browser.close();
}
