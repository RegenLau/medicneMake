"use strict";

(function (global) {
  const ink = "#253d44";
  const blue = "#5596a1";
  const pale = "#d0e3dd";
  const orange = "#c7643f";
  const white = "#fffbf0";
  const {clamp, easing:{outCubic:ease}} = global.MgKit;
  const fmt = value => Number(value.toFixed(3));
  const text = value => String(value ?? "").replace(/[&<>"']/g, char => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]
  ));
  const path = (d, fill = "none", stroke = ink, size = 4) =>
    `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${size}"/>`;
  const rect = (x, y, w, h, r, fill, stroke = ink, size = 4) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${size}"/>`;
  const circle = (x, y, r, fill, stroke = ink, size = 4) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${size}"/>`;
  const group = (transform, html) => `<g transform="${transform}">${html}</g>`;
  const drawn = (d, phase, color = orange, size = 7) =>
    phase <= 0 ? "" : `<path d="${d}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${fmt(100 * (1 - ease(phase)))}" fill="none" stroke="${color}" stroke-width="${size}"/>`;

  function leaflet(p) {
    const turn = fmt(-0.85 + 1.85 * ease(p * 2.7));
    const lensX = fmt(179 - 97 * ease((p - 0.3) * 2.1));
    return group("translate(445 238)", [
      path("M0 125 Q63 104 129 123 V356 Q61 333 0 351 Z", "#e1d7c2"),
      path("M129 123 Q196 102 260 124 V352 Q192 333 129 356 Z", white),
      group(`translate(129 123) scale(${turn} 1)`, [
        path("M0 0 Q-61 -19 -127 0 V228 Q-64 206 0 231 Z", white),
        path("M-125 2 Q-61 -15 0 2 V30 Q-62 13 -125 31 Z", pale, "none"),
        path("M-100 56 L-28 48 M-100 80 L-27 72 M-100 105 L-35 98 M-100 130 L-28 122", "none", "#a5aaa1"),
      ].join("")),
      path("M155 151 L228 145 M154 174 L231 169 M154 195 L218 190 M153 255 L230 253 M154 278 L220 274", "none", "#a5aaa1"),
      rect(151, 207, 86, 33, 7, pale, "none"),
      drawn("M146 206 Q192 194 244 205 L242 242 Q192 253 146 244 Z", (p - 0.36) * 2.2),
      p > 0.23 ? group(`translate(${fmt(lensX + 113)} ${fmt(159 + 65 * ease((p - 0.3) * 2.1))})`, [
        path("M36 33 L77 74", "none", ink, 17),
        path("M37 34 L76 73", "none", "#d89b6c", 10),
        '<circle r="48" fill="#d0e3dd" fill-opacity=".35" stroke="#253d44" stroke-width="5"/>',
        path("M-29 -14 Q-21 -32 -3 -32", "none", white, 5),
      ].join("")) : "",
    ].join(""));
  }

  function carton(p) {
    const angle = fmt(-14 + 25 * ease(p * 2.7));
    return group("translate(675 473)", [
      group(`rotate(${angle})`, [
        path("M-138 -96 L-60 -167 L136 -131 L68 -64 Z", pale),
        path("M68 -64 L136 -131 V63 L68 132 Z", "#8eb5ae"),
        path("M-138 -96 L68 -64 V132 L-138 100 Z", white),
        path("M-113 -60 L45 -35 L45 5 L-113 -20 Z", "#9dbfc1"),
        path("M-112 15 L11 34 M-112 40 L-15 55 M-112 65 L-6 82", "none", "#a5aaa1"),
        drawn("M77 -64 L127 -111 L126 -67 L78 -19 Z", (p - 0.32) * 2.1),
      ].join("")),
    ].join(""));
  }

  function clock(p) {
    const angle = fmt(14 + 125 * ease(p * 1.9) + Math.sin(p * 16) * (1 - p) * 22);
    return group("translate(660 473)", [
      circle(0, 0, 146, "#9dbfc1"),
      circle(0, 0, 126, white),
      path("M0 -108 V-93 M108 0 H93 M0 108 V93 M-108 0 H-93", "none", ink, 6),
      path("M0 0 L48 32", "none", ink, 10),
      group(`rotate(${angle})`, path("M0 14 V-82", "none", orange, 8)),
      circle(0, 0, 9, ink),
    ].join(""));
  }

  function scale(p) {
    const angle = fmt(-58 + 65 * ease(p * 2.6) + Math.sin(p * 24) * 49 * (1 - p) ** 2);
    return group("translate(665 430)", [
      path("M-26 73 H24 L40 170 H-42 Z", pale),
      rect(-135, 154, 270, 55, 18, "#88b7b1"),
      circle(0, 0, 115, "#e7c697"),
      circle(0, 0, 100, white),
      ...[-72, -54, -36, -18, 0, 18, 36, 54, 72].map(a =>
        group(`rotate(${a})`, path("M0 -85 V-74", "none", ink, 5))),
      group(`rotate(${angle})`, path("M0 14 L0 -71", "none", orange, 9)),
      circle(0, 0, 9, ink),
    ].join(""));
  }

  function log(p) {
    const writing = clamp((p - 0.12) * 1.54);
    const second = writing >= 0.54;
    const penX = fmt(-63 + 141 * clamp(second ? (writing - 0.54) / 0.46 : writing / 0.54));
    return group("translate(655 460)", [
      rect(-127, -114, 258, 229, 19, white),
      rect(-49, -129, 102, 28, 8, "#9dbfc1"),
      path("M-83 -49 H90 M-83 8 H90 M-83 66 H62", "none", "#acb0a4"),
      drawn("M-64 -50 Q0 -52 78 -51", writing / 0.54, blue),
      drawn("M-64 7 Q8 4 78 6", (writing - 0.54) / 0.46, blue),
      p < 0.86 ? group(`translate(${penX} ${second ? 6 : -50})`, [
        path("M0 0 L10 -26 L94 -110 L113 -91 L27 -8 Z", "#e4aa72"),
        path("M0 0 L10 -26 L27 -8 Z", "#f5d9a9"),
        path("M93 -110 L106 -123 Q113 -130 121 -122 L125 -117 Q133 -111 126 -104 L113 -91 Z", "#d18a76"),
      ].join("")) : "",
    ].join(""));
  }

  function travel(p) {
    const top = fmt(-30 * (1 - ease(p * 2.4)));
    const drop = fmt(-134 * (1 - ease(p * 2.2)));
    return group("translate(664 481)", [
      path("M-57 -72 V-121 Q-57 -150 -25 -150 H24 Q58 -150 58 -122 V-75", "none", ink, 13),
      rect(-148, -82, 294, 203, 22, "#93b9b3"),
      group(`translate(0 ${drop})`, [
        rect(-112, -63, 93, 127, 7, white),
        rect(-100, -48, 70, 23, 4, pale, "none"),
        rect(11, -42, 49, 106, 14, "#e8bb82"),
        rect(16, -56, 39, 20, 4, "#729d98"),
      ].join("")),
      group(`translate(0 ${top})`, [
        path("M-148 13 H147 V103 Q147 121 128 121 H-127 Q-148 121 -148 104 Z", "#9ebfb8"),
        drawn("M-122 25 H121", (p - 0.42) * 2.1, ink, 5),
        rect(fmt(-127 + 242 * ease((p - 0.42) * 2.1)), 16, 14, 26, 3, "#e6b37b"),
      ].join("")),
    ].join(""));
  }

  const crossAt = 0.39;
  const consultCheckAt = 0.26;

  function compare(p) {
    const separated = ease((p - 0.21) * 2.7);
    return group("translate(665 460)", [
      group("rotate(-18)", [
        group(`translate(${fmt(-30 * separated)} 0)`, path("M0 -48 H-59 Q-105 -48 -105 0 Q-105 48 -59 48 H0 L-9 24 L4 6 L-8 -16 Z", "#e8bb82")),
        group(`translate(${fmt(32 * separated)} 0)`, path("M0 -48 H50 Q102 -48 102 0 Q102 48 50 48 H0 L-9 24 L4 6 L-8 -16 Z", white)),
      ].join("")),
      circle(118, -87, 49, "#f3dfcf", orange),
      drawn("M98 -107 L137 -68 M137 -107 L98 -68", (p - crossAt) * 2.1),
    ].join(""));
  }

  function consult(p) {
    return group("translate(669 467)", [
      path("M-158 -94 Q-158 -134 -118 -134 H20 Q63 -134 63 -93 V-14 Q63 22 22 22 H-86 L-130 55 L-130 22 Q-158 17 -158 -13 Z", "#9ebfb8"),
      path("M-38 -2 Q-38 -36 -1 -36 H124 Q162 -36 162 0 V65 Q162 99 126 99 H106 L139 133 L85 99 H-2 Q-38 99 -38 63 Z", white),
      ...[-103, -48, 5].map((x, index) => circle(x, -58 - fmt(Math.sin(clamp(p * 2 - index * 0.14) * Math.PI) * 15), 8, white, "none")),
      drawn("M10 40 L40 63 L100 5", (p - consultCheckAt) * 1.8, blue, 9),
    ].join(""));
  }

  function eyedrop(p) {
    const approach = ease(p * 3);
    const lower = ease((p - .18) * 3.3);
    const drop = ease((p - .48) * 3.4);
    const lid = fmt(20 + 30 * lower);
    return group("translate(665 491)", [
      path(`M-119 0 Q-55 -70 0 -63 Q55 -70 119 0 Q63 ${lid} 0 ${lid} Q-63 ${lid} -119 0 Z`, white),
      circle(0, -12, 28, blue), circle(0, -12, 11, ink),
      path(`M-119 0 Q-54 ${lid + 21} 0 ${lid + 21} Q54 ${lid + 21} 119 0`, "none", blue, 7),
      group(`translate(63 ${fmt(-227 + 83 * approach)}) rotate(14)`, [
        rect(-29, -58, 58, 79, 13, pale),
        rect(-18, -49, 36, 30, 6, white, "none"),
        path("M-16 21 H16 L7 43 H-7 Z", white, ink),
      ].join("")),
      (p > .48 && drop < 1)
        ? group(`translate(${fmt(53 - 48 * drop)} ${fmt(-90 + 139 * drop)})`,
          path("M0 -14 Q-20 9 0 15 Q20 9 0 -14 Z", blue, "none"))
        : "",
      drop === 1 ? circle(5, 48, 8, blue, "none") : "",
    ].join(""));
  }

  const motions = { leaflet, carton, clock, scale, log, travel, compare, consult, eyedrop };
  const font = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

  function lines(value, size, maxLines) {
    const chars = Array.from(String(value || ""));
    const result = [];
    for (let i = 0; i < chars.length && result.length < maxLines; i += size) {
      const row = chars.slice(i, i + size);
      if (result.length === maxLines - 1 && i + size < chars.length) row[row.length - 1] = "…";
      result.push(text(row.join("")));
    }
    return result;
  }

  const keywords = {
    leaflet: ["说明书", "用法用量", "注意事项"],
    carton: ["药盒", "包装", "通用名", "药名"],
    clock: ["服药时间", "漏服", "时间"],
    scale: ["体重", "剂量"],
    log: ["记录", "清单", "漏服", "时间", "药名"],
    travel: ["药袋", "分类", "原包装", "出门"],
    compare: ["误区", "掰开", "半片", "加量"],
    eyedrop: ["滴眼", "下眼睑", "瓶口", "眼睛"],
    consult: ["药师", "咨询", "医师"],
  };

  function beatWindows(beats) {
    const weights = beats.map(beat => Math.max(1, Array.from(beat.line.replace(/\s/g, "")).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = 0;
    return weights.map(weight => {
      const start = elapsed / total;
      elapsed += weight;
      return {start, span:weight / total};
    });
  }

  function beatPhases(beats, progress) {
    return beatWindows(beats).map(({start, span}) => (progress - start) / span);
  }

  function events(shot) {
    const beats = shot.beats || [{action: shot.action, line: shot.line}];
    const duration = shot.motionSeconds ?? shot.end - shot.start;
    return beatWindows(beats).flatMap(({start, span}, index) => {
      const action = beats[index].action;
      const rows = index === 0 ? [] : [{t: start * duration, type:"beat-in"}];
      if (action === "compare" || action === "consult") {
        const warning = action === "compare";
        rows.push({t: (start + span * (warning ? crossAt : consultCheckAt)) * duration,
                   type:warning ? "warning" : "check"});
      }
      return rows;
    });
  }

  function actionPoses(shot, progress, warm, surface) {
    const base = (action, time) => group("translate(-184 -124) scale(1 .91)", motions[action](clamp(time)));
    const beats = shot.svgBeats || [];
    if (beats.length < 2) return base(shot.action, progress);

    const phases = beatPhases(beats, progress);
    const size = beats.length === 2 ? .86 : .68;
    const centers = beats.length === 2 ? [264, 696] : [167, 480, 793];
    return beats.map((beat, index) => {
      const partProgress = phases[index];
      const visible = index === 0 ? 1 : ease(partProgress * 6);
      const emphasis = partProgress < 1 && visible > 0;
      const center = centers[index];
      const shadow = surface ? surface.shadow : (warm ? "#e9dfce" : "#dbe9f5");
      const labelFill = surface
        ? (emphasis ? surface.labelActive : surface.label)
        : (emphasis ? (warm ? "#ede0c8" : "#deedf9") : (warm ? "#f6ecdf" : "#eaf3fb"));
      const labelColor = surface
        ? (beat.action === "compare" ? "var(--v-coral)" : "var(--v-ink)")
        : (beat.action === "compare" ? orange : ink);
      const lineStroke = surface ? surface.connector : (warm ? "#cbb997" : "#afcde7");
      return `<g data-svg-beat="${index}" opacity="${fmt(visible)}">
        ${index ? path(`M${centers[index - 1] + 124} 389 Q${(centers[index - 1] + center) / 2} 369 ${center - 124} 389`,
          "none", lineStroke, 3) : ""}
        <ellipse cx="${center}" cy="434" rx="${fmt(176 * size)}" ry="12" fill="${shadow}"/>
        ${group(`translate(${center} ${fmt(314 + 14 * (1 - visible))}) scale(${size}) translate(-480 -310)`,
          base(beat.action, partProgress))}
        ${rect(center - 110, 462, 220, 41, 20, labelFill, "none")}
        <text x="${center}" y="490" text-anchor="middle" font-family='${font}'
          font-size="26" font-weight="680" fill="${labelColor}">${text(beat.label)}</text>
      </g>`;
    }).join("");
  }

  function content(shot, progress, theme, includeHeading = true, deck = null) {
    const warm = theme === "warm";
    const isDark = Boolean(deck && global.LayoutEngine?.isDarkTheme?.(deck));
    const isGlass = Boolean(deck?.themeGlass);
    const surface = isDark ? {
      bg: "var(--v-card-bg)", hill: "var(--v-rail-bg)", shadow: "rgba(0,0,0,0.28)",
      swoosh: "var(--v-primary)", connector: "var(--v-card-border)",
      labelActive: "var(--v-primary-soft)", label: "var(--v-rail-bg)",
      heading: "var(--v-ink)", warn: "var(--v-coral)",
    } : isGlass ? {
      bg: "none", hill: "var(--v-primary-soft)", shadow: "var(--v-rail-line)",
      swoosh: "var(--v-primary)", connector: "var(--v-rail-line)",
      labelActive: "var(--v-card-bg)", label: "var(--v-rail-bg)",
      heading: "var(--v-ink)", warn: "var(--v-coral)",
    } : null;
    const heading = lines(shot.name, 19, 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"
      style="display:block;width:100%;height:100%;" role="img" aria-label="${text(shot.name)}">
      <g stroke-linecap="round" stroke-linejoin="round">
        ${rect(0, 0, 960, 540, 0, surface ? surface.bg : (warm ? "#fcf6ea" : "#f5faff"), "none")}
        ${path("M0 436 Q247 410 479 462 T960 442 V540 H0 Z", surface ? surface.hill : (warm ? "#f7ecdc" : "#e7f2fc"), "none")}
        ${shot.svgBeats?.length > 1 ? "" :
          `<ellipse cx="483" cy="467" rx="235" ry="16" fill="${surface ? surface.shadow : (warm ? "#e9dfce" : "#dbe9f5")}"/>`}
        ${path("M194 266 Q213 238 237 251 M705 212 Q719 190 742 196", "none", surface ? surface.swoosh : (warm ? "#82a69c" : "#a0c5e8"), 4)}
        ${actionPoses(shot, progress, warm, surface)}
        ${includeHeading ? `<g font-family='${font}' fill="${surface ? surface.heading : ink}">
          ${heading.map((row, i) => `<text x="480" y="${80 + i * 48}" text-anchor="middle" font-weight="770" font-size="45">${row}</text>`).join("")}
          ${shot.action === "compare" && !(shot.svgBeats?.length > 1) ? `<text x="480" y="159" text-anchor="middle" font-size="25" font-weight="670" fill="${surface ? surface.warn : "#a74d30"}">常见误区</text>` : ""}
        </g>` : ""}
      </g>
    </svg>`;
  }

  global.StageSvgContent = { content, beatPhases, keywords, events };
})(globalThis);
