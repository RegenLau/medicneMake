"use strict";

const canvas = document.querySelector("#motion-frame");
const stage = document.querySelector("#motion-content").content.firstElementChild;
const scenes = [...stage.querySelectorAll(".scene")];
const chips = [...stage.querySelectorAll(".caption-chip")];
const checkRows = [...stage.querySelectorAll(".check-row")];
const clusterLabels = [...stage.querySelectorAll(".cluster-labels span")];
const compareLabels = [...stage.querySelectorAll(".compare-label")];
const pill = stage.querySelector("#pill");
const dots = stage.querySelector("#orbit-dots");
const shield = stage.querySelector("#shield");
const rings = stage.querySelector("#shield-rings");
const firstRail = stage.querySelector("#first-rail");
const secondRail = stage.querySelector("#second-rail");
const cellsGroup = stage.querySelector("#cells");
const cells = [
  [154, 92], [229, 84], [304, 90], [379, 83], [452, 93], [505, 146],
  [144, 159], [218, 158], [289, 159], [371, 155], [441, 158],
  [188, 224], [267, 231], [343, 216], [422, 226], [486, 211]
].map(([x, y], index) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const accent = index % 3 === 1;
  node.setAttribute("r", accent ? "9" : "7");
  node.setAttribute("fill", accent ? "var(--v-coral)" : "var(--v-primary)");
  cellsGroup.append(node);
  return { node, x, y, accent };
});

let timeline = [];
let deck;
let imgMap;
let mountedScene = -1;
let previousSubtitle;
let templateMotion = false;
let currentFocus;
let targets = [];
const fit = () => {
  canvas.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`;
};
addEventListener("resize", fit);
fit();

window.setMotionPlan = ({ title, shots, appearance = {}, localAvatar, templateInfo }) => {
  timeline = shots;
  templateMotion = Boolean(templateInfo);
  deck = TemplateVideo.normalizeDeck({
    ...appearance, title, shortTitle: title,
    chapters: ["先看要点", "用药提醒"],
    ...templateInfo,
    slides: templateMotion
      ? shots.map(shot => ({ ...shot.visual, layoutMode: "explain", line: shot.line }))
      : shots.map((shot, index) => ({
      ...shot, type: "explain", chapterIndex: index < 3 ? 0 : 1,
      highlightWords: shot.labels,
    })),
  });
  const avatar = TemplateVideo.resolveAvatarSrc(deck);
  imgMap = new Map(avatar ? [[avatar, localAvatar || new URL("." + avatar, location.href).href]] : []);
  mountedScene = -1;
  if (templateMotion) return;
  shots.forEach((shot, index) => {
    scenes[index].querySelector("h2").textContent = shot.name;
    chips[index].textContent = shot.takeaway;
  });
  clusterLabels.forEach((label, index) => { label.textContent = shots[1].labels[index]; });
  compareLabels.forEach((label, index) => { label.textContent = shots[2].labels[index]; });
  checkRows.forEach((row, index) => {
    const label = shots[3].labels[index];
    row.hidden = !label;
    row.style.display = label ? "" : "none";
    row.querySelector("span").textContent = label || "";
  });
};

const clamp = number => Math.max(0, Math.min(1, number));
const ease = number => 1 - (1 - clamp(number)) ** 3;

const draws = [
  time => {
    dots.setAttribute("transform", `rotate(${time * 23} 315 157)`);
    pill.setAttribute("transform", `translate(0 ${Math.sin(time * 2.3) * 6}) rotate(${-29 + Math.sin(time * 1.3) * 5} 315 157)`);
  },
  (time, beat) => {
    cells.forEach(({ node, x, y, accent }, index) => {
      const enter = ease((time - 0.12 - index * 0.035) / 0.65);
      const emphasis = ease((time - beat - (index % 4) * 0.15) / 0.8);
      node.style.opacity = enter * (accent ? 0.48 + 0.52 * emphasis : 0.82 - 0.35 * emphasis);
      node.setAttribute("cx", x + Math.sin(time * 1.4 + index) * 9);
      node.setAttribute("cy", y + Math.cos(time * 1.6 + index) * 6);
    });
  },
  (time, beat) => {
    firstRail.style.transform = `scaleX(${ease((time - 0.23) / 1.25)})`;
    secondRail.style.transform = `scaleX(${ease((time - beat + 0.35) / 1.1)})`;
  },
  (time, beat) => {
    [0.23, 0.85, Math.max(1.45, beat - 0.15)].forEach((at, index) => {
      const enter = ease((time - at) / 0.62);
      checkRows[index].style.opacity = enter;
      checkRows[index].style.transform = `translateY(${(1 - enter) * 10}px)`;
    });
  },
  time => {
    const enter = ease((time - 0.14) / 0.86);
    const pulse = 1 + 0.021 * Math.sin(time * 3.1);
    shield.setAttribute("transform", `translate(315 151) scale(${(0.77 + 0.23 * enter) * pulse}) translate(-315 -151)`);
    shield.style.opacity = enter;
    rings.setAttribute("transform", `translate(315 151) scale(${0.98 + 0.025 * Math.sin(time * 2.7)}) translate(-315 -151)`);
  }
];

function drawScene(index, time) {
  const shot = timeline[index];
  const beat = shot.captions[1]?.start - shot.start;
  const cue = Number.isFinite(beat) ? beat : (shot.end - shot.start) / 2;
  draws[index](time, cue);
  const reveal = ease((time - cue + 0.22) / 0.52);
  chips[index].style.opacity = reveal;
  chips[index].style.transform = `translateY(${(1 - reveal) * 10}px)`;
}

window.drawMotionFrame = (time, avatarFrame) => {
  const index = timeline.findIndex(shot => time < shot.end);
  const shot = timeline[index];
  if (!shot) return;
  if (mountedScene !== index) {
    canvas.innerHTML = TemplateVideo.renderFrameHtml(deck, index, {
      subtitleText: shot.captions[0]?.text || shot.line || " ",
      imgMap, progress: 1, renderMedia: () => "",
    });
    const footer = canvas.querySelector(".pt-footer");
    if (!footer.firstElementChild) {
      const subtitle = document.createElement("div");
      subtitle.className = "pt-subtitle";
      footer.append(subtitle);
    }
    if (!templateMotion) canvas.querySelector(".pt-media-slot").replaceChildren(stage);
    currentFocus = undefined;
    previousSubtitle = undefined;
    mountedScene = index;
  }
  const localTime = time - shot.start;
  const cue = shot.captions.find(caption => time < caption.end);
  if (templateMotion) {
    const focus = cue?.focus || "all";
    if (currentFocus !== focus) {
      const slot = canvas.querySelector(".pt-media-slot");
      slot.innerHTML = TemplateVideo.renderFallbackCard(deck.slides[index], focus);
      targets = [...slot.querySelectorAll(".pt-focus-target, .pt-fb-cover-lead, .pt-fb-pill")];
      currentFocus = focus;
    }
    targets.forEach((target, i) => {
      const entrance = ease((localTime - i * 0.1) / 0.48);
      target.style.opacity = String((target.classList.contains("is-dimmed") ? 0.42 : 1) * entrance);
      target.style.transform = `translateY(${(1 - entrance) * 14}px)`;
    });
  } else {
    const fade = index === 0 ? 1 : ease(localTime / 0.38);
    if (index > 0 && fade < 1) drawScene(index - 1, timeline[index - 1].end - timeline[index - 1].start);
    drawScene(index, localTime);
    scenes.forEach((scene, i) => {
      scene.style.opacity = i === index ? fade : i === index - 1 ? 1 - fade : 0;
      scene.style.transform = `translateY(${i === index ? (1 - fade) * 12 : 0}px)`;
      scene.setAttribute("aria-hidden", String(i !== index));
    });
  }
  if (previousSubtitle !== cue) {
    canvas.querySelector(".pt-subtitle").innerHTML = TemplateVideo.highlightText(cue?.text ?? "",
      cue?.highlightWords || shot.labels, "pt-sub-hl");
    previousSubtitle = cue;
  }
  const ring = canvas.querySelector(".pt-avatar-progress circle");
  if (ring) {
    const circumference = 2 * Math.PI * Number(ring.getAttribute("r"));
    const progress = time / timeline.at(-1).end;
    ring.setAttribute("opacity", progress > 0.002 ? "1" : "0");
    ring.setAttribute("stroke-linecap", "round");
    ring.setAttribute("stroke-dasharray", `${circumference * progress} ${circumference + 10}`);
    ring.setAttribute("transform", "rotate(-90 50 50)");
  }
  const avatar = canvas.querySelector(".pt-avatar-inner img");
  if (avatar && avatarFrame) {
    avatar.src = avatarFrame;
    return avatar.decode();
  }
  if (avatar && !avatar.complete) return avatar.decode();
};
