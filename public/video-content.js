"use strict";

const maxVideoShots = 12;
const videoReferenceDurations = [null, 30, 45, 60, 90, 120];
const videoSpeechRate = 4.2;

function videoReferenceSeconds(w) {
  return videoReferenceDurations.includes(w.settings.duration) ? w.settings.duration : null;
}

function spokenChars(line) {
  return line.replace(/\s+/g, "").length;
}

function recommendedShotSeconds(chars) {
  return Math.max(4, Math.ceil(chars / videoSpeechRate + 0.65));
}

function videoTotalSeconds(w) {
  return w.blocks.reduce((sum, block) => sum + block.seconds, 0);
}

const allVideoTopics = [
  "药盒上的有效期，应该怎么看？",
  "去药房咨询前，准备哪些信息？",
  "用药记录里，哪些信息值得记？",
  "看说明书时，哪里能找到答案？",
  "出门前，怎样整理随身药品？",
  "一起来认识药品的不同剂型",
  "孩子发烧，退烧药怎么吃才安全？",
  "降压药忘吃了，要不要补吃双倍？",
  "感冒药和退烧药一起吃，小心成分重叠",
  "肠溶片、缓释片，为什么不能随便掰开吃？",
  "滴眼液怎么滴，才不会流出来白费？",
  "胃药饭前吃还是饭后吃？分清类型不吃错",
];

function videoBlocks(shots) {
  return shots.map(({ name, line, scene, seconds, motion, action, beats }) => ({
    name: name.slice(0, 60), line, image: "", variant: 0, seconds,
    prompt: scene || "",
    ...(action ? { action } : {}),
    ...(beats?.length ? { beats } : {}),
    motion: motion || defaultMotion,
  }));
}
