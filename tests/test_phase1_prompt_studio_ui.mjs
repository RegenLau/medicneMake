import assert from "node:assert/strict";
import { chromium } from "playwright";

const [origin] = process.argv.slice(2);
assert(origin, "Missing server origin argument");

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  const submitted = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route("**/api/jobs", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      submitted.push(payload);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "mock-stop" }),
      });
      return;
    }
    await route.continue();
  });

  // 1. Article setup page: verify 2-tab prompt card, dynamic sync, diff modal, and custom submission
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="article"]').click();
  const articleBox = page.locator("#article-prompt-editor");
  await articleBox.waitFor();
  assert.equal(await page.locator("#video-script-prompt").count(), 0, "Article setup must not render video script prompt");

  const defaultArticlePrompt = await articleBox.inputValue();
  assert(defaultArticlePrompt.includes("通俗图解版"), "Default article prompt should reflect layout");
  assert(defaultArticlePrompt.includes("JSON"), "Default article prompt should mention JSON");

  // Dynamic sync on layout change
  await page.locator('[data-action="layout"][data-val="1"]').click();
  await page.waitForFunction(() => document.querySelector("#article-prompt-editor")?.value.includes("临床深度版"));

  // Customize article body prompt
  const customArticleBody = (await articleBox.inputValue()) + "\n【测试风格】开头先用一句话点破常见误区。";
  await articleBox.fill(customArticleBody);
  assert.equal(await page.locator("#article-prompt-badge").innerText(), "已修改");

  // Switch to article-images tab and customize it too
  await page.locator('[data-action="article-prompt-tab"][data-val="article-images"]').click();
  await page.waitForFunction(() => document.querySelector("#article-prompt-editor")?.value.includes("规划配图"));
  const customArticleImages = (await articleBox.inputValue()) + "\n【配图补充】优先画药盒标签与服药动作。";
  await articleBox.fill(customArticleImages);

  // Open expanded modal -> check Diff tab -> close
  await page.locator('[data-action="prompt-studio-open"][data-val="article-images"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#prompt-studio-modal-input").waitFor();
  await dialog.locator('[data-action="prompt-studio-tab"][data-val="diff"]').click();
  const diffLines = await dialog.locator(".prompt-diff-line.is-add").allInnerTexts();
  assert(diffLines.some((l) => l.includes("配图补充")), "Article image prompt diff should show added line");
  await dialog.locator('[data-action="close"]').first().click();

  // Submit article draft -> verify both articlePrompt and articleImagePrompt sent
  await page.locator("#topic").fill("阿托伐他汀晚上吃还是早上吃");
  await page.evaluate(() => {
    config.deepseekKeyPresent = true;
    config.keyPresent = true;
  });
  await page.locator('[data-action="generate"]').click();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="abort-job"]') !== null);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].draft.articlePrompt, customArticleBody.trim());
  assert.equal(submitted[0].draft.articleImagePrompt, customArticleImages.trim());

  // 2. Stage editor: create a stage work directly in localStorage & test full image/art/produce prompts
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("xixi-studio-v1") || "{}");
    const wid = "11111111-1111-4111-8111-111111111111";
    const work = {
      id: wid,
      type: "video",
      videoMode: "template",
      stage: "script",
      viewingSetup: false,
      editing: false,
      title: "退烧药怎么吃",
      topic: "孩子发烧退烧药怎么吃",
      drug: "对乙酰氨基酚片",
      style: 0,
      settings: {
        mode: "ark",
        textModel: "deepseek-flash",
        imageModel: "doubao-seedream-5-5-261028",
        imageSize: "1K",
        videoModel: "doubao-seedance-2-5-flash-261115",
        resolution: "720p",
        ratio: "16:9",
        voice: "刘飞 2.0",
        music: "calm",
      },
      blocks: [{ name: "开场", line: "按体重算剂量。", seconds: 6, image: "" }],
      stagePlan: {
        layout: { id: "builtin:layout/info-classic" },
        themeId: "builtin:theme/medical",
        mode: "image",
        shortTitle: "退烧药安全",
        chapters: ["看剂量", "防过量"],
        disclaimer: "科普内容仅供参考",
        audio: {},
        shots: [
          {
            name: "按体重算剂量",
            line: "孩子发烧按体重算剂量，不要按年龄估。",
            seconds: 6,
            chapterIndex: 0,
            points: { type: "cover", headline: "按体重算剂量", items: [{ title: "看体重", detail: "不按年龄估", tag: "" }], takeaway: "先核对体重" },
            cues: [{ text: "孩子发烧按体重算剂量，不要按年龄估。", focus: "all", weight: 18 }],
            content: { kind: "image", image: "", imagePrompt: "突出体重秤和说明书" },
            variants: { image: { kind: "image", image: "", imagePrompt: "突出体重秤和说明书" } },
          },
          {
            name: "别叠加成分",
            line: "复方感冒药常含相同成分，避免叠加。",
            seconds: 6,
            chapterIndex: 1,
            points: { type: "warning", headline: "别叠加成分", items: [{ title: "查成分表", detail: "避免重复", tag: "" }], takeaway: "先看成分表" },
            cues: [{ text: "复方感冒药常含相同成分，避免叠加。", focus: "all", weight: 18 }],
            content: { kind: "scene", codePrompt: "用矢量天平对比两盒感冒药的相同成分" },
            variants: { scene: { kind: "scene", codePrompt: "用矢量天平对比两盒感冒药的相同成分" } },
          },
        ],
      },
    };
    raw.works = [work, ...(raw.works || []).filter((x) => x.id !== wid)];
    localStorage.setItem("xixi-studio-v1", JSON.stringify(raw));
  });
  await page.goto(`${origin}/#work/11111111-1111-4111-8111-111111111111`);
  await page.reload();
  await page.locator('[data-action="prompt-studio-open"]').first().waitFor();
  await page.evaluate(() => {
    config.deepseekKeyPresent = true;
    config.keyPresent = true;
  });

  // 2a. Open 4-tab Prompt Studio modal & edit global stage-image template
  await page.locator('[data-action="prompt-studio-open"]').first().click();
  await dialog.locator("#prompt-studio-modal-input").waitFor();
  const globalImgDefault = await dialog.locator("#prompt-studio-modal-input").inputValue();
  assert(globalImgDefault.includes("{{画面与排版设计}}"), "Global stage-image template should expose placeholders");
  const customGlobalImg = globalImgDefault + "\n【全局画风追加】整体留白增加至 35%，使用圆润无衬线大字。";
  await dialog.locator("#prompt-studio-modal-input").fill(customGlobalImg);

  // Verify switching to stage-arrange & stage-produce loads real system prompts
  await dialog.locator('[data-action="prompt-studio-channel"][data-val="stage-arrange"]').click();
  await page.waitForFunction(() => document.querySelector("#prompt-studio-modal-input")?.value.includes("JSON"));
  await dialog.locator('[data-action="prompt-studio-channel"][data-val="stage-produce"]').click();
  await page.waitForFunction(() => document.querySelector("#prompt-studio-modal-input")?.value.includes("纯代码"));
  await dialog.locator('[data-action="close"]').first().click();

  // Verify shot 1 per-shot full prompt picked up the global stage-image template
  await page.locator("#stage-shot-image-full-prompt").evaluate((el) => {
    el.closest("details").open = true;
  });
  const shot1AutoPrompt = await page.locator("#stage-shot-image-full-prompt").inputValue();
  assert(shot1AutoPrompt.includes("整体留白增加至 35%"), "Per-shot auto prompt should inherit global template");
  assert(shot1AutoPrompt.includes("突出体重秤和说明书"), "Per-shot auto prompt should expand shot description");

  // Override shot 1 full prompt directly and submit stage-images
  const shot1Manual = "【单幕手改完整提示词】16:9 医学科普信息图，居中醒目大字：按体重算剂量。";
  await page.locator("#stage-shot-image-full-prompt").fill(shot1Manual);
  assert.equal(await page.locator("#stage-shot-image-prompt-badge").innerText(), "已手改");
  await page.locator('[data-action="stage-images"][data-val="one"]').click();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.waitForFunction(() => document.querySelector("#stage-production-job:not([hidden])") !== null);
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].items[0].prompt, shot1Manual);
  // Clear mock job error
  await page.locator('#stage-production-job [data-action="abort-job"]').click();

  // 2b. Select shot 2 (scene) -> verify single unified prompt box (no illustration, no separate codePrompt box)
  await page.locator('.stage-rail [data-action="stage-select"][data-val="1"]').click();
  assert.equal(await page.locator("#stage-shot-art-full-prompt").count(), 0, "Scene shot should not show illustration prompt");
  assert.equal(await page.locator('[data-stage-field="codePrompt"]').count(), 0, "Scene shot should merge description into the single prompt box");
  const shot2ManualCode = "【单幕手改代码提示词】左右双栏纯 SVG 对比两盒复方感冒药成分表，高亮相同退烧成分。";
  await page.locator("#stage-shot-prompt").fill(shot2ManualCode);
  assert.equal(await page.locator("#stage-shot-prompt-badge").innerText(), "已手改");

  // 2c. Open produceShot modal -> edit produceShotPrompt -> verify both customCodePrompt & produceShotPrompt sent
  await page.locator('[data-action="stage-produce"]').click();
  await dialog.locator("#stage-produce-prompt").evaluate((el) => {
    el.closest("details").open = true;
  });
  await page.waitForFunction(() => document.querySelector("#stage-produce-prompt")?.value.includes("纯代码"));
  const customProduce = (await dialog.locator("#stage-produce-prompt").inputValue()) + "\n【单幕调试】优先使用高对比警示色条。";
  await dialog.locator("#stage-produce-prompt").fill(customProduce);
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.waitForFunction(() => document.querySelector("#stage-production-job:not([hidden])") !== null);
  assert.equal(submitted.length, 3);
  assert.equal(submitted[2].draft.produceShot.prompt, shot2ManualCode);
  assert.equal(submitted[2].draft.produceShot.customCodePrompt, shot2ManualCode);
  assert.equal(submitted[2].draft.produceShotPrompt, customProduce.trim());

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: test_phase1_prompt_studio_ui.mjs");
} finally {
  await browser.close();
}
