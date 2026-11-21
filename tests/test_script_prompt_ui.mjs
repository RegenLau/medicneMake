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

  // 1. Open studio and create a new video work
  await page.goto(origin);
  await page.locator('[data-action="new"][data-val="video"]').click();
  const promptBox = page.locator("#video-script-prompt");
  await promptBox.waitFor();

  const initialPrompt = await promptBox.inputValue();
  assert(initialPrompt.includes("AI数智人药师"), "Default prompt should contain EDITORIAL_RULES");
  assert(initialPrompt.includes("JSON"), "Default prompt should contain JSON schema guidance");
  assert.equal(await page.locator("#script-prompt-badge").innerText(), "系统默认");
  assert.equal(await page.locator("#setup-summary-prompt-state").innerText(), "系统默认");
  assert.equal(await page.locator('[data-action="script-prompt-save-default"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="script-prompt-reset"]').isDisabled(), true);

  // 2. Dynamic sync when changing layout, duration, and drug (while unmodified)
  await page.locator('[data-action="stage-layout"][data-val="builtin:layout/qa-chat"]').click();
  await page.waitForFunction(() => document.querySelector("#video-script-prompt")?.value.includes("问答对话布局"));
  await page.locator('[data-action="duration"]', { hasText: "60 秒" }).click();
  await page.waitForFunction(() => document.querySelector("#video-script-prompt")?.value.includes("60 秒"));
  await page.locator('[data-action="drug"]').click();
  await page.locator('[data-action="pickdrug"][data-val="阿托伐他汀钙片"]').click();
  await page.waitForFunction(() => document.querySelector("#video-script-prompt")?.value.includes("阿托伐他汀钙片"));

  // 3. Edit prompt -> enters customized state & persists across setting changes
  const customSuffix = "\n【补充测试要求】开场第一句用患者常见困惑直接发问，每幕要点不超过 3 条。";
  const editedPrompt = (await promptBox.inputValue()) + customSuffix;
  await promptBox.fill(editedPrompt);

  assert.equal(await page.locator("#script-prompt-badge").innerText(), "已修改");
  assert.equal(await page.locator("#setup-summary-prompt-state").innerText(), "已自定义（本作品）");
  assert.equal(await page.locator('[data-action="script-prompt-save-default"]').isDisabled(), false);
  assert.equal(await page.locator('[data-action="script-prompt-reset"]').isDisabled(), false);

  // Changing duration must NOT overwrite custom edits
  await page.locator('[data-action="duration"]', { hasText: "30 秒" }).click();
  await page.waitForTimeout(200);
  assert.equal(await promptBox.inputValue(), editedPrompt);

  // 4. Open expanded modal -> check diff tab -> save as default
  await page.locator('[data-action="script-prompt-expand"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#script-prompt-modal-input").waitFor();
  assert.equal(await dialog.locator("#script-prompt-modal-input").inputValue(), editedPrompt);

  await dialog.locator('[data-action="script-prompt-tab"][data-val="diff"]').click();
  const diffAddText = await dialog.locator(".prompt-diff-line.is-add").allInnerTexts();
  assert(diffAddText.some((line) => line.includes("补充测试要求")), "Diff should highlight added line");

  await dialog.locator('[data-action="script-prompt-save-default"]').click();
  await dialog.locator('[data-action="close"]').first().click();

  assert.equal(await page.locator("#script-prompt-badge").innerText(), "常用默认");
  assert.equal(await page.locator("#setup-summary-prompt-state").innerText(), "已优化（常用默认）");

  // 5. Switch to AI storyboard mode -> uses storyboard default without clobbering stage prompt
  await page.locator('[data-action="tpl-video-mode"][data-val="storyboard"]').click();
  await page.waitForFunction(() => document.querySelector("#video-script-prompt")?.value.includes("全片场景"));
  assert.equal(await page.locator("#script-prompt-badge").innerText(), "系统默认");

  // Switch back to template/stage mode -> saved stage prompt is restored
  await page.locator('[data-action="tpl-video-mode"][data-val="template"]').click();
  await page.waitForFunction(() => document.querySelector("#video-script-prompt")?.value.includes("补充测试要求"));
  assert.equal(await page.locator("#script-prompt-badge").innerText(), "常用默认");

  // 6. Start a brand new video work -> automatically inherits saved default prompt
  await page.locator('[data-action="home"]').first().click();
  await page.locator('[data-action="new"][data-val="video"]').click();
  await promptBox.waitFor();
  assert.equal(await promptBox.inputValue(), editedPrompt);
  assert.equal(await page.locator("#script-prompt-badge").innerText(), "常用默认");

  // 7. Submit generate -> verify payload.draft.scriptPrompt is sent
  await page.locator("#topic").fill("阿托伐他汀晚上吃还是早上吃");
  await page.evaluate(() => {
    config.deepseekKeyPresent = true;
  });
  await page.locator('[data-action="generate"]').click();
  await dialog.getByText("使用自定义视频脚本提示词").waitFor();
  await dialog.locator('[data-action="confirm-paid"]').click();
  await page.waitForFunction(() => document.querySelector('[data-action="abort-job"]') !== null);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].draft.scriptPrompt, editedPrompt.trim());
  await page.locator('[data-action="abort-job"]').click();

  // 8. Reset to system default -> verifies reset AND snapshot saved in history
  await promptBox.waitFor();
  await page.locator('[data-action="script-prompt-reset"]').click();
  assert.equal(await page.locator("#script-prompt-badge").innerText(), "系统默认");
  assert(!(await promptBox.inputValue()).includes("补充测试要求"));

  await page.locator('[data-action="script-prompt-expand"]').click();
  await dialog.locator('[data-action="script-prompt-tab"][data-val="history"]').click();
  const historyItems = await dialog.locator(".prompt-history-item").count();
  assert(historyItems >= 1, "History should contain recorded snapshots");
  await dialog.locator('[data-action="script-prompt-apply-history"]').first().click();
  assert((await dialog.locator("#script-prompt-modal-input").inputValue()).includes("补充测试要求"));
  await dialog.locator('[data-action="close"]').first().click();

  // 9. Verify article setup does NOT show video script prompt card
  await page.locator('[data-action="home"]').first().click();
  await page.locator('[data-action="new"][data-val="article"]').click();
  await page.locator("#topic").waitFor();
  assert.equal(await page.locator("#video-script-prompt").count(), 0);

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: test_script_prompt_ui.mjs");
} finally {
  await browser.close();
}
