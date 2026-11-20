"use strict";

const StudioAssets = (() => {
  const categories = { image: "图片", svg: "SVG 图形", motion: "SVG 动效", music: "背景音乐", sfx: "音效", font: "字体" };
  const kinds = Object.keys(categories);
  const rights = '<label class="field">授权<select name="license" required><option value="">请选择授权</option>' +
    '<option>自制或已获授权</option><option>CC0</option><option>CC BY</option><option>AI 生成 · 已核对服务条款</option></select></label>' +
    '<label class="field">署名或来源（CC BY 必填）<input name="credit" maxlength="200"></label>';
  const descriptor = '<label class="field">名称<input name="name" required maxlength="80"></label>' +
    '<label class="field">标签（用逗号分隔）<input name="tags" maxlength="180"></label>' + rights;
  const post = (path, body) => jsonRequest(`/api/library/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  let pageKind = "image";
  let pageQuery = "";

  function media(item) {
    if (item.kind === "image" || item.kind === "svg") {
      return `<div class="asset-thumb ${item.kind}"><img src="${esc(item.url)}" alt="${esc(item.name)}" loading="lazy"></div>`;
    }
    if (item.kind === "music" || item.kind === "sfx") {
      return `<audio controls preload="none" src="${esc(item.url)}" aria-label="试听 ${esc(item.name)}"></audio>`;
    }
    if (item.kind === "font") return '<div class="asset-font-sample">用药科普<br>安心每一天</div>';
    return `<div class="asset-thumb motion" data-motion-preview="${esc(item.id)}">${SvgMotion.content({name: item.name, action: item.action}, 0.65)}</div>`;
  }

  function card(item, picking) {
    const tags = item.tags?.length ? `<ul class="asset-tags">${item.tags.map((tag) => `<li>${esc(tag)}</li>`).join("")}</ul>` : "";
    const terms = item.termsUrl ? `<a href="${esc(item.termsUrl)}" target="_blank" rel="noopener">授权</a>` : "";
    const actions = [
      item.kind === "motion" ? `<button type="button" class="outline" data-lib-play="${esc(item.id)}">播放预览</button>` : "",
      picking ? `<button type="button" class="primary" data-lib-use="${esc(item.id)}">使用此素材</button>` : "",
      !picking && (item.id.startsWith("user:") || item.id.startsWith("library:"))
        ? `<button type="button" class="textbtn" data-lib-archive="${esc(item.id)}">下架</button>` : "",
    ].join("");
    return `<article class="asset-card">${media(item)}<div class="asset-card-info">
      <h3>${esc(item.name)}</h3><p>${esc([item.meta?.topic, item.meta?.ratio].filter(Boolean).join(" · "))}</p>
      ${tags}<p class="asset-license">${esc([item.source === "project" ? "项目收藏" : item.source === "upload" ? "本地上传" : item.source, item.license, item.credit].filter(Boolean).join(" · "))} ${terms}</p>
      ${actions ? `<div class="asset-actions">${actions}</div>` : ""}
      </div></article>`;
  }

  function mount(root, options = {}) {
    const allowed = options.kinds || kinds;
    const picking = Boolean(options.onPick);
    let selected = picking ? allowed[0] : pageKind;
    let query = picking ? "" : pageQuery;
    let items = [];
    root.innerHTML = `<div class="asset-toolbar">
      <div class="asset-tabs" role="group" aria-label="素材类型">${allowed.map((kind) =>
        `<button type="button" class="chip${kind === selected ? " selected" : ""}" aria-pressed="${kind === selected}" data-lib-kind="${kind}">${categories[kind]}</button>`).join("")}</div>
      <label class="asset-search"><input type="search" aria-label="搜索素材" placeholder="搜索名称或标签"></label>
      ${picking ? "" : '<button type="button" class="primary" data-lib-upload>上传素材</button>'}
      </div><div class="asset-grid" aria-busy="true"><p role="status">正在读取素材…</p></div>`;
    const grid = root.querySelector(".asset-grid");
    const input = root.querySelector("input[type=search]");
    input.value = query;
    if (!picking) root.querySelector("[data-lib-upload]").onclick = upload;

    function draw() {
      root.querySelectorAll("[data-lib-kind]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.libKind === selected));
        b.classList.toggle("selected", b.dataset.libKind === selected);
      });
      const needle = query.trim().toLowerCase();
      const matches = items.filter((item) => item.kind === selected &&
        [item.name, ...item.tags, item.meta?.topic, item.meta?.style, item.meta?.ratio]
          .filter(Boolean).join(" ").toLowerCase().includes(needle));
      if (options.hints) {
        const { topic, ratio, style } = options.hints;
        const score = ({ meta = {} }) => 3 * Number(Boolean(topic && meta.topic === topic)) +
          2 * Number(Boolean(ratio && meta.ratio === ratio)) + Number(Boolean(style && meta.style === style));
        matches.sort((a, b) => score(b) - score(a));
      }
      grid.setAttribute("aria-busy", "false");
      grid.innerHTML = matches.length ? matches.map((item) => card(item, picking)).join("") :
        `<div class="asset-empty"><h3>${needle ? "没有匹配的素材" : `暂无${categories[selected]}`}</h3>` +
        (!needle && selected === "image" ? '<p>上传图片，或从已有作品收录配图。</p>' : "") + "</div>";
    }

    async function load() {
      try {
        items = (await jsonRequest("/api/library")).items;
        draw();
      } catch (error) {
        grid.setAttribute("aria-busy", "false");
        grid.innerHTML = `<p class="banner err" role="alert">${esc(error.message)}</p><button type="button" class="outline" data-lib-refresh>重试</button>`;
      }
    }

    input.addEventListener("input", () => {
      query = input.value;
      if (!picking) pageQuery = query;
      draw();
    });
    root.addEventListener("play", (event) => {
      for (const player of root.querySelectorAll("audio")) if (player !== event.target) player.pause();
    }, true);
    root.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const { libKind, libUse, libArchive, libPlay } = button.dataset;
      if (libKind) {
        selected = libKind;
        if (!picking) pageKind = selected;
        draw();
      } else if (libUse) {
        const item = items.find(({ id }) => id === libUse);
        if (!item) return;
        dialog.close();
        options.onPick(item);
      } else if (libArchive) {
        const item = items.find(({ id }) => id === libArchive);
        if (!item) return;
        if (!confirm(`下架「${item.name}」？已使用的作品仍可导出。`)) return;
        button.disabled = true;
        try {
          if (item.kind === "music") await archiveMusic(item.id.slice("library:".length));
          else await post("archive", { id: item.id });
          if (root.isConnected) await load();
        } catch (error) {
          button.disabled = false;
          notify(error.message, "err");
        }
      } else if (libPlay) {
        const item = items.find(({ id }) => id === libPlay);
        const canvas = button.closest(".asset-card")?.querySelector("[data-motion-preview]");
        if (!item || !canvas) return;
        button.disabled = true;
        const start = performance.now();
        function step(time) {
          if (!canvas.isConnected) return;
          const progress = Math.min(1, (time - start) / 2400);
          canvas.innerHTML = SvgMotion.content({name: item.name, action: item.action}, progress);
          if (progress < 1) requestAnimationFrame(step);
          else button.disabled = false;
        }
        requestAnimationFrame(step);
      } else if (button.hasAttribute("data-lib-refresh")) {
        await load();
      }
    });
    return load();
  }

  function page() {
    app.innerHTML = '<section class="asset-library"><div class="section-head"><h1>素材库</h1></div><div data-library-root></div></section>';
    mount(app.querySelector("[data-library-root]"));
  }

  function pick(allowed, onPick, hints) {
    openModal("从素材库选择", '<div class="asset-picker" data-library-root></div>', "asset-picker");
    mount(dialogBody.querySelector("[data-library-root]"), { kinds: allowed, onPick, hints });
  }

  function submitForm(title, fileField, action, name = "", tags = "") {
    openModal(title, `<form class="asset-form">${fileField}${descriptor}<p class="banner err" role="alert" hidden></p>
      <div class="asset-actions"><button type="submit" class="primary">收入素材库</button></div></form>`, "asset-form");
    const form = dialogBody.querySelector(".asset-form");
    form.elements.name.value = name;
    form.elements.tags.value = tags;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorNode = form.querySelector('[role="alert"]');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      errorNode.hidden = true;
      try {
        const item = await action(Object.fromEntries(new FormData(form)));
        if (form.isConnected) dialog.close();
        notify(`「${item.name}」已收入素材库`, "ok");
        if (route()[0] === "library") {
          pageKind = item.kind;
          pageQuery = "";
          render(true);
        }
      } catch (error) {
        errorNode.textContent = error.message;
        errorNode.hidden = false;
        button.disabled = false;
      }
    });
  }

  function upload() {
    submitForm("上传素材", '<label class="field">图片或 SVG<input name="file" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" required></label>', async ({ file, ...values }) => {
      const kind = /\.svg$/i.test(file.name) ? "svg" : "image";
      const limit = kind === "svg" ? 300 * 1024 : 8 * 1024 * 1024;
      if (!file.size || file.size > limit) throw Error("文件大小无效。图片上限 8 MB，SVG 上限 300 KB。");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(Error("无法读取文件。"));
        reader.readAsDataURL(file);
      });
      return (await post("upload", { ...values, kind, data })).item;
    });
  }

  function collect(image, { name, ...meta }) {
    submitForm("收录配图", `<img class="asset-collect-preview" src="${esc(image)}" alt="待收录的配图">`, async (fields) =>
      (await post("collect-image", { ...meta, ...fields, url: image })).item, name, meta.topic || "");
  }

  function url(id) {
    return `/library/${encodeURIComponent(id)}`;
  }

  return { page, pick, collect, url };
})();
