"use strict";

/* Standalone 1280x720 medical infographic template renderer & PNG frame exporter.
 * Pure JSON-driven (zero coupling to localStorage or workbench state), ready to reuse on Alibaba Cloud FC. */
(function (global) {
  const THEMES = [
    { id: "medical", name: "医疗白蓝风", desc: "清爽临床科普，对标主流医生讲解" },
    { id: "warm", name: "暖色手绘风", desc: "温和贴纸手账风，适合家庭与儿科科普" },
  ];

  const PRESENTERS = [
    { id: "digital", name: "数字人" },
    { id: "cartoon", name: "卡通形象" },
    { id: "none", name: "无形象" },
  ];

  const SLIDE_TYPES = {
    cover: "封面破题页",
    compare: "双栏对比页",
    steps: "步骤清单页",
    warning: "风险警示页",
    summary: "结尾收口页",
  };

  const DEFAULT_PHARMACIST = {
    name: "李明远",
    hospital: "北京协和医院",
    role: "主任药师",
    avatarImage: "",
  };

  const EXAMPLES = [
    {
      topic: "孩子发烧，退烧药怎么吃才安全？",
      theme: "medical",
      presenter: "digital",
      title: "孩子发烧，退烧药怎么吃才安全",
      chapters: ["看温度", "选对药", "算剂量", "何时就医"],
      slides: [
        {
          type: "cover",
          chapterIndex: 0,
          leftTop: "发烧先稳住",
          leftBottom: "退烧核心是让孩子舒服",
          headline: "孩子发烧，退烧药怎么吃才安全？",
          accentPhrase: "怎么吃才安全",
          lead: "按体重算剂量、选对单一成分，家长少走弯路少焦虑。",
          pills: ["按体重而非年龄", "区分滴剂与混悬液", "识别 4 类就医红线"],
          image: "/assets/template-fever-visual.jpg",
          spotPrompt: "儿童退烧药瓶、口服刻度喂药器、电子体温计与温水杯并排放在纯白底面上",
          footerNote: "发热本身是免疫防御反应：一般腋温达到三十八度五且伴明显不适时，再按说明考虑退烧药。",
          highlightWords: ["怎么吃才安全", "退烧药"],
          line: "孩子半夜发烧，退烧药到底怎么吃才安全？记住退烧的核心，是让孩子舒服，而不是盯着体温数字焦虑。",
          seconds: 11,
        },
        {
          type: "compare",
          chapterIndex: 1,
          leftTop: "认准两种成分",
          leftBottom: "不要常规交替混吃",
          headline: "儿童退烧别乱选！认准这两种单一成分",
          accentPhrase: "两种单一成分",
          columns: [
            {
              title: "对乙酰氨基酚",
              badge: "≥ 3 月龄可用",
              points: [
                "用药间隔四到六小时，一天不超过四次",
                "对胃肠道刺激较小，伴轻度脱水倾向时优先考虑",
                "警惕与含同一成分的复方感冒药叠加过量",
              ],
              footLabel: "常见剂型",
              footValue: "滴剂 · 混悬液 · 栓剂",
            },
            {
              title: "布洛芬",
              badge: "≥ 6 月龄可用",
              points: [
                "用药间隔六到八小时，一天不超过四次",
                "退热持续时间相对较长，同时兼顾一定镇痛",
                "明显腹泻脱水、胃肠不适或肾功能异常慎用",
              ],
              footLabel: "常见剂型",
              footValue: "混悬滴剂 · 混悬液",
            },
          ],
          footerNote: "核对说明与医嘱：不推荐两药常规联合或交替使用，避免增加算错剂量的风险。",
          highlightWords: ["对乙酰氨基酚", "布洛芬", "交替"],
          line: "儿童安全退烧药，优先认准对乙酰氨基酚或布洛芬这两种单一成分。通常不建议两种药常规交替混吃，容易算错剂量。",
          seconds: 13,
        },
        {
          type: "steps",
          chapterIndex: 2,
          leftTop: "按体重不按岁",
          leftBottom: "滴剂与混悬液浓度不同",
          headline: "喂药前核对这 3 个关键点，避免多喂或少喂",
          accentPhrase: "3 个关键点",
          steps: [
            {
              title: "先称当前体重",
              desc: "同龄孩子胖瘦差异大，应严格对照药品说明书的体重区间查找单次用量。",
              key: "原则：认公斤数，不按年龄估算",
            },
            {
              title: "核对剂型与浓度",
              desc: "婴幼儿滴剂浓度远高于儿童混悬液，换品牌或换瓶子时务必重新看规格。",
              key: "警惕：绝不能直接照搬旧毫升数",
            },
            {
              title: "用原配量器取药",
              desc: "优先使用药盒自带的刻度滴管、口服喂药器或量杯，平视读数更准确。",
              key: "禁用：家用不锈钢汤匙估量",
            },
          ],
          checks: ["混悬液先摇匀", "记下服药时间", "多补温水防脱水", "不叠加复方感冒药"],
          highlightWords: ["滴剂", "混悬液", "体重"],
          line: "给孩子喂药，一定要按当前体重对照说明书核对。同样是五毫升，滴剂和混悬液的含药量可能差好几倍，务必使用原配量器。",
          seconds: 14,
        },
        {
          type: "warning",
          chapterIndex: 3,
          leftTop: "看精神状态",
          leftBottom: "出现红线信号立即去医院",
          headline: "出现这 4 类危险信号，别只在家等退烧",
          accentPhrase: "4 类危险信号",
          warnings: [
            {
              title: "小于 3 月龄婴儿发热",
              desc: "小月龄宝宝病情进展快，无论体温高低，建议直接去医院评估。",
            },
            {
              title: "退烧后仍精神萎靡",
              desc: "持续嗜睡、难以安抚的剧烈哭闹，或明显拒水拒奶、尿量锐减。",
            },
            {
              title: "呼吸急促、抽搐或皮疹",
              desc: "伴口唇发紫、呼吸费力、惊厥抽搐、反复呕吐或压不褪色皮疹。",
            },
            {
              title: "持续高热超过 3 天",
              desc: "反复发热超过七十二小时无好转，或规范服药后不适毫无缓解。",
            },
          ],
          footerNote: "护理提醒：适当减少衣物、保持室温舒适即可；禁止酒精擦浴，也不要厚被捂汗。",
          highlightWords: ["三个月龄", "精神萎靡", "就医"],
          line: "如果宝宝小于三个月龄发烧，或者退烧后依然精神萎靡、呼吸急促、反复高烧超过三天，请第一时间带去医院。",
          seconds: 12,
        },
        {
          type: "summary",
          chapterIndex: 3,
          leftTop: "药师划重点",
          leftBottom: "关键时刻不慌张不喂错",
          headline: "记住这 3 句安全口诀，退烧用药不踩坑",
          accentPhrase: "3 句安全口诀",
          points: [
            {
              title: "看精神胜过死盯体温计",
              desc: "退烧药的目标是缓解孩子不适，不是强行把体温压回正常值。",
            },
            {
              title: "单一成分、按体重、用原配量器",
              desc: "认准对乙酰氨基酚或布洛芬，不常规交替，不叠加复方感冒药。",
            },
            {
              title: "出现红线信号，第一时间就医",
              desc: "拿不准剂量或孩子状态变差时，及时咨询儿科医生或临床药师。",
            },
          ],
          footerNote: "科普内容仅供参考，具体诊疗与用药请遵医嘱或查阅药品说明书",
          highlightWords: ["不慌张", "不喂错", "单一成分"],
          line: "记住看精神、选单一成分按体重给药、警惕红线信号这三条原则，关键时刻不慌张、不喂错。",
          seconds: 10,
        },
      ],
    },
    {
      topic: "腿抽筋，先别急着补钙",
      theme: "warm",
      presenter: "cartoon",
      title: "腿抽筋，先别急着补钙",
      chapters: ["找原因", "辨差异", "怎么做", "何时就医"],
      slides: [
        {
          type: "cover",
          chapterIndex: 0,
          leftTop: "不一定缺钙",
          leftBottom: "也可能涉及低钾或用药",
          headline: "腿抽筋，先别急着盲目补钙？",
          accentPhrase: "先别急着盲目补钙",
          lead: "夜间小腿抽筋很常见，找准电解质、出汗和用药原因更关键。",
          pills: ["钙与钾都影响肌肉", "留意利尿剂等药物", "区分受凉劳累与疾病"],
          image: "/assets/template-fever-visual.jpg",
          spotPrompt: "水杯、运动跑鞋图标与普通药瓶并排放在纯白底面上",
          footerNote: "反复抽筋不等于单纯缺钙，盲目大剂量补钙可能增加胃肠不适或结石风险。",
          highlightWords: ["补钙", "抽筋"],
          line: "半夜小腿一抽筋，很多人第一反应就是赶紧买钙片。其实抽筋不一定只是缺钙，盲目补钙未必管用。",
          seconds: 11,
        },
        {
          type: "compare",
          chapterIndex: 1,
          leftTop: "钙钾要分清",
          leftBottom: "两种电解质分工不同",
          headline: "抽筋不只是缺钙，也可能和低钾有关",
          accentPhrase: "低钾有关",
          columns: [
            {
              title: "钙（Ca）",
              badge: "参与收缩",
              points: [
                "帮助维持肌肉正常收缩与神经兴奋平衡",
                "饮食摄入不足、维生素 D 缺乏时较易偏低",
                "是否需要补钙，建议结合饮食与检查评估",
              ],
              footLabel: "日常来源",
              footValue: "奶制品 · 豆制品 · 深绿叶菜",
            },
            {
              title: "钾（K）",
              badge: "调节放松",
              points: [
                "维持细胞内外电解质平衡，帮助肌肉正常放松",
                "大量出汗、腹泻呕吐或服用部分利尿剂易流失",
                "血钾异常不可自行乱补钾片，需先查电解质",
              ],
              footLabel: "常见诱因",
              footValue: "出汗脱水 · 腹泻 · 部分降压利尿药",
            },
          ],
          footerNote: "药师提醒：正在长期服用利尿剂类降压药的慢病患者，若频繁抽筋乏力，建议复查血钾。",
          highlightWords: ["缺钾", "利尿剂", "电解质"],
          line: "钙负责肌肉收缩，钾负责调节肌肉放松。如果近期大量出汗、腹泻，或者正在吃某些利尿剂，抽筋也可能和缺钾有关。",
          seconds: 13,
        },
        {
          type: "steps",
          chapterIndex: 2,
          leftTop: "日常三步走",
          leftBottom: "先排查生活和用药因素",
          headline: "遇到反复腿抽筋，建议按这 3 步排查处理",
          accentPhrase: "3 步排查处理",
          steps: [
            {
              title: "急性发作轻柔拉伸",
              desc: "抽筋时保持坐姿，缓慢伸直膝盖并将脚尖往身体方向轻勾，配合热敷放松。",
              key: "动作：缓慢持续，避免暴力猛掰",
            },
            {
              title: "排查诱因与补液",
              desc: "回看近期是否久站劳累、夜间受凉或出汗偏多，运动后及时补充水分和电解质。",
              key: "习惯：睡前注意下肢保暖与拉伸",
            },
            {
              title: "带上药盒问药师",
              desc: "整理正在服用的降压药、调脂药等清单，请医生或药师评估是否与药物相关。",
              key: "原则：不因抽筋擅自停用慢病药",
            },
          ],
          checks: ["睡前温和拉伸", "注意小腿保暖", "及时补充水分", "核对在用药物"],
          highlightWords: ["轻柔拉伸", "药盒", "擅自停药"],
          line: "抽筋当下可以缓慢勾脚尖轻柔拉伸，平时注意保暖补水。如果你长期吃慢病药，带着药盒问药师，千万别自己停药。",
          seconds: 13,
        },
        {
          type: "warning",
          chapterIndex: 3,
          leftTop: "留意异常信号",
          leftBottom: "这些情况别拖着自己补",
          headline: "伴随这 4 种表现，建议尽快去医院检查",
          accentPhrase: "4 种表现",
          warnings: [
            {
              title: "抽筋频繁且越来越重",
              desc: "每周发作多次、严重影响睡眠，常规拉伸与保暖后无明显改善。",
            },
            {
              title: "伴明显肢体乏力或心慌",
              desc: "合并全身没劲、心悸胸闷，需尽快排查低钾等电解质紊乱。",
            },
            {
              title: "下肢肿胀、发凉或麻木",
              desc: "单侧小腿红肿疼痛、走路发沉或发麻，警惕下肢血管或神经问题。",
            },
            {
              title: "近期调整过慢病用药",
              desc: "加用或调整利尿剂、他汀等药物后新发抽筋，请及时复诊评估。",
            },
          ],
          footerNote: "就诊小贴士：去医院前记录抽筋发作时间和正在服用的全部药物，方便医生快速判断。",
          highlightWords: ["电解质", "乏力", "复诊"],
          line: "如果抽筋越来越频繁，或者伴随全身乏力、心慌、单侧腿肿发凉，别自己买保健品，尽快去医院查电解质和血管情况。",
          seconds: 13,
        },
        {
          type: "summary",
          chapterIndex: 3,
          leftTop: "药师划重点",
          leftBottom: "先找原因再对症处理",
          headline: "腿抽筋处理记住这 3 条，科学安心不盲补",
          accentPhrase: "科学安心不盲补",
          points: [
            {
              title: "抽筋不等于缺钙",
              desc: "劳累受凉、缺水低钾、血管神经因素和部分药物都可能诱发。",
            },
            {
              title: "补剂与药物别乱吃乱停",
              desc: "不盲目大剂量补钙或自行补钾，慢病用药调整一定遵医嘱。",
            },
            {
              title: "频繁发作或伴红线信号及时查",
              desc: "带着完整用药清单咨询医生或药师，查清原因更省心。",
            },
          ],
          footerNote: "科普内容仅供参考，具体诊疗与用药请遵医嘱或查阅药品说明书",
          highlightWords: ["不盲补", "遵医嘱"],
          line: "记住抽筋不等于缺钙，别乱补也别擅自停慢病药，反复发作及时检查，才能真正解决。",
          seconds: 10,
        },
      ],
    },
  ];

  function xmlEsc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cloneExample(index) {
    const src = EXAMPLES[index % EXAMPLES.length];
    return JSON.parse(JSON.stringify(src));
  }

  function normalizeDeck(raw, fallbackTitle) {
    const base = raw && typeof raw === "object" ? raw : cloneExample(0);
    const title = String(base.title || fallbackTitle || "用药科普讲解").trim().slice(0, 40);
    const chapters = Array.isArray(base.chapters) && base.chapters.length
      ? base.chapters.slice(0, 4).map((c) => String(c || "").trim().slice(0, 8) || "要点")
      : ["看问题", "辨要点", "怎么做", "何时就医"];
    const slides = Array.isArray(base.slides) && base.slides.length
      ? base.slides
      : cloneExample(0).slides;
    const pharmacist = {
      ...DEFAULT_PHARMACIST,
      ...(base.pharmacist && typeof base.pharmacist === "object" ? base.pharmacist : {}),
    };
    return {
      theme: base.theme === "warm" ? "warm" : "medical",
      presenter: PRESENTERS.some((p) => p.id === base.presenter) ? base.presenter : "digital",
      title,
      chapters,
      pharmacist,
      slides,
    };
  }

  function splitSubtitleChunks(line, maxChars) {
    const limit = maxChars || 22;
    let text = String(line || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const stops = "，。！？；、：,.!?;:";
    const chunks = [];
    while (text.length > limit) {
      let cut = limit;
      for (let i = limit; i > Math.floor(limit / 2); i--) {
        if (stops.includes(text[i - 1]) || text[i - 1] === " ") {
          cut = i;
          break;
        }
      }
      while (cut < Math.min(text.length, limit + 1) && stops.includes(text[cut])) {
        cut++;
      }
      chunks.push(text.slice(0, cut).trim());
      text = text.slice(cut).trim();
    }
    if (text) chunks.push(text);
    return chunks.map((chunk) => {
      let weight = 0;
      for (const ch of chunk) {
        if (!ch.trim()) continue;
        weight += stops.includes(ch) ? 0.35 : 1;
      }
      return { text: chunk, weight: Math.max(1, weight) };
    });
  }

  function highlightText(text, words, className) {
    const raw = String(text || "");
    const list = (Array.isArray(words) ? words : [words])
      .map((w) => String(w || "").trim())
      .filter((w) => w.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (!list.length) return xmlEsc(raw);
    const escapedTokens = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp("(" + escapedTokens.join("|") + ")", "g");
    return raw.split(re).map((part) => {
      if (list.includes(part)) {
        return `<span class="${className}">${xmlEsc(part)}</span>`;
      }
      return xmlEsc(part);
    }).join("");
  }

  function renderHeadline(slide, defaultAccentClass) {
    return highlightText(slide.headline || "", slide.accentPhrase ? [slide.accentPhrase] : [], defaultAccentClass);
  }

  function resolveAvatarSrc(deck) {
    if (deck.presenter === "cartoon") {
      return "/assets/template-doctor-cartoon.jpg";
    }
    if (deck.pharmacist && deck.pharmacist.avatarImage) {
      return deck.pharmacist.avatarImage;
    }
    return "/assets/template-doctor-digital.jpg";
  }

  function renderSlideBody(slide, deck, imgMap) {
    const type = slide.type || "steps";
    const mapSrc = (src) => (imgMap && src && imgMap.get(src)) ? imgMap.get(src) : (src || "");

    if (type === "cover") {
      const pills = (Array.isArray(slide.pills) ? slide.pills : []).slice(0, 3);
      const pillIcons = [
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e8e5a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e37b1d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v4l3 4v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8l3-4V3z"/><path d="M9 14h6"/></svg>',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e6592d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
      ];
      const coverImg = mapSrc(slide.image || "/assets/template-fever-visual.jpg");
      const titleHtml = highlightText(slide.headline || deck.title, slide.accentPhrase ? [slide.accentPhrase] : [], "tpl-hl-coral");
      return `
        <div class="tpl-cover-layout">
          <div>
            <div class="tpl-cover-title">${titleHtml}</div>
            <p class="tpl-cover-lead">${xmlEsc(slide.lead || "")}</p>
            <div class="tpl-cover-pills">
              ${pills.map((p, idx) => `<span class="tpl-cover-pill">${pillIcons[idx % pillIcons.length]}${xmlEsc(p)}</span>`).join("")}
            </div>
          </div>
          <div class="tpl-cover-art">
            <img src="${xmlEsc(coverImg)}" alt="" />
          </div>
        </div>
        <div class="tpl-reassure-bar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
          <span>${xmlEsc(slide.footerNote || "")}</span>
        </div>
      `;
    }

    if (type === "compare") {
      const cols = Array.isArray(slide.columns) ? slide.columns.slice(0, 2) : [];
      const colClasses = ["blue-box", "amber-box"];
      const strokeColors = ["#1976e2", "#d98218"];
      const headIcons = [
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0L12 2.7z"/></svg>',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="7" width="12" height="14" rx="3"/><path d="M9 3h6v4H9z"/><path d="M12 11v6m-3-3h6"/></svg>',
      ];
      return `
        <div class="tpl-headline">${renderHeadline(slide, "tpl-hl-coral")}</div>
        <div class="tpl-compare-grid">
          ${cols.map((col, idx) => `
            <div class="tpl-compare-col ${colClasses[idx % 2]}">
              <div>
                <div class="tpl-compare-head">
                  <span class="tpl-drug-chip">${headIcons[idx % 2]}${xmlEsc(col.title || "")}</span>
                  ${col.badge ? `<span class="tpl-age-tag">${xmlEsc(col.badge)}</span>` : ""}
                </div>
                <ul class="tpl-compare-points">
                  ${(Array.isArray(col.points) ? col.points : []).slice(0, 4).map((pt, pi) => `
                    <li>
                      <svg class="tpl-pt-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${pi === 2 ? "#e6592d" : strokeColors[idx % 2]}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="${pi === 2 ? "M12 8v4m0 4h.01" : "m9 12 2 2 4-4"}"/></svg>
                      <span>${xmlEsc(pt)}</span>
                    </li>
                  `).join("")}
                </ul>
              </div>
              ${(col.footLabel || col.footValue) ? `
                <div class="tpl-compare-foot">
                  <span>${xmlEsc(col.footLabel || "常见说明")}</span>
                  <b>${xmlEsc(col.footValue || "")}</b>
                </div>
              ` : ""}
            </div>
          `).join("")}
        </div>
        <div class="tpl-guideline-bar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a78e6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          <span>${xmlEsc(slide.footerNote || "")}</span>
        </div>
      `;
    }

    if (type === "steps") {
      const steps = (Array.isArray(slide.steps) ? slide.steps : []).slice(0, 3);
      const checks = (Array.isArray(slide.checks) ? slide.checks : []).slice(0, 4);
      const stepIcons = [
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a78e6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"/><path d="M12 10v4m-2-2h4"/></svg>',
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a78e6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v7.31"/><path d="M14 9.3V2"/><path d="M8.5 2h7"/><path d="M14 9.3a6.5 6.5 0 1 1-4 0"/></svg>',
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a78e6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>',
      ];
      return `
        <div class="tpl-headline">${renderHeadline(slide, "tpl-hl-blue")}</div>
        <div class="tpl-steps-row">
          ${steps.map((st, idx) => `
            <div class="tpl-step-tile">
              <div class="tpl-step-top">
                <span class="tpl-step-badge">第 ${idx + 1} 步</span>
                ${stepIcons[idx % 3]}
              </div>
              <h3>${xmlEsc(st.title || "")}</h3>
              <p>${xmlEsc(st.desc || "")}</p>
              ${st.key ? `<div class="tpl-step-key">${xmlEsc(st.key)}</div>` : ""}
            </div>
          `).join("")}
        </div>
        <div class="tpl-icon-strip">
          ${checks.map((ck) => `
            <div class="tpl-strip-cell">
              <span class="tpl-strip-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>
              </span>
              <span>${xmlEsc(ck)}</span>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (type === "warning") {
      const warns = (Array.isArray(slide.warnings) ? slide.warnings : []).slice(0, 4);
      const warnIcons = [
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></svg>',
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
      ];
      return `
        <div class="tpl-headline">${renderHeadline(slide, "tpl-hl-coral")}</div>
        <div class="tpl-warn-grid">
          ${warns.map((item, idx) => `
            <div class="tpl-warn-tile">
              <div class="tpl-warn-icon">${warnIcons[idx % 4]}</div>
              <div>
                <h3>${xmlEsc(item.title || "")}</h3>
                <p>${xmlEsc(item.desc || "")}</p>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="tpl-guideline-bar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e6592d" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg>
          <span>${xmlEsc(slide.footerNote || "")}</span>
        </div>
      `;
    }

    // Default / summary
    const points = (Array.isArray(slide.points) ? slide.points : []).slice(0, 3);
    const p = deck.pharmacist;
    const authorLine = `希息药事 · ${p.name}${p.role ? p.role : ""}${p.hospital ? "（" + p.hospital + "）" : ""}`;
    return `
      <div class="tpl-headline">${renderHeadline(slide, "tpl-hl-blue")}</div>
      <div class="tpl-summary-list">
        ${points.map((pt, idx) => `
          <div class="tpl-summary-row">
            <span class="tpl-summary-num">${idx + 1}</span>
            <div class="tpl-summary-text">
              <strong>${xmlEsc(pt.title || "")}</strong>
              <span>${xmlEsc(pt.desc || "")}</span>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="tpl-compliance-footer">
        <span>${xmlEsc(authorLine)}</span>
        <span>${xmlEsc(slide.footerNote || "科普内容仅供参考，具体诊疗与用药请遵医嘱或查阅药品说明书")}</span>
      </div>
    `;
  }

  function renderLeftPresenter(deck, slide, imgMap) {
    const p = deck.pharmacist;
    if (deck.presenter === "none" && slide.type === "cover") {
      return `
        <aside class="tpl-left">
          <div class="tpl-pharm-card">
            <span class="tpl-tape"></span>
            <div class="tpl-pharm-row">
              <div class="tpl-pharm-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M4 12h16"/></svg>
              </div>
              <div>
                <div class="tpl-pharm-name">${xmlEsc(p.name)}药师</div>
                <div class="tpl-pharm-hosp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e6592d" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  ${xmlEsc(p.hospital)}
                </div>
                <span class="tpl-pharm-role">${xmlEsc(p.role)}</span>
              </div>
            </div>
            <div class="tpl-pharm-tags">
              <div class="tpl-pharm-tag">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1877e8" stroke-width="2.2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                药师专业语音讲解
              </div>
              <div class="tpl-pharm-tag">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1e8e5a" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                内容经药师专业核稿
              </div>
            </div>
          </div>
        </aside>
      `;
    }

    const rawSrc = resolveAvatarSrc(deck);
    const src = (imgMap && imgMap.get(rawSrc)) || rawSrc;
    const badgeLabel = deck.presenter === "cartoon"
      ? `${p.name}药师 · 卡通讲解`
      : `${p.name} · ${p.role || "药师"}`;

    return `
      <aside class="tpl-left">
        <div class="tpl-left-pill">
          <div class="tpl-left-main">
            ${xmlEsc(slide.leftTop || "要点提示")}
            <svg class="tpl-left-underline" width="124" height="8" viewBox="0 0 128 8" fill="none">
              <path d="M3 5.5C38 1.5 92 1.8 125 5" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
            </svg>
          </div>
        </div>
        <div class="tpl-avatar-stage">
          <div class="tpl-avatar-ring">
            <div class="tpl-avatar-inner">
              <img src="${xmlEsc(src)}" alt="" />
            </div>
          </div>
          <svg class="tpl-avatar-sparks" width="28" height="58" viewBox="0 0 28 58" fill="none">
            <path d="M5 10L16 4" stroke="#1a78e6" stroke-width="3.2" stroke-linecap="round"/>
            <path d="M8 29L23 27" stroke="#1a78e6" stroke-width="3.2" stroke-linecap="round"/>
            <path d="M6 48L17 53" stroke="#1a78e6" stroke-width="3.2" stroke-linecap="round"/>
          </svg>
          <div class="tpl-avatar-badge">
            <span class="tpl-wave-bars"><i></i><i></i><i></i><i></i></span>
            <span>${xmlEsc(badgeLabel)}</span>
          </div>
        </div>
        <div class="tpl-left-pill">
          <div class="tpl-left-sub">${xmlEsc(slide.leftBottom || "")}</div>
        </div>
      </aside>
    `;
  }

  function renderFrameHtml(rawDeck, slideIndex, options) {
    const opts = options || {};
    const deck = normalizeDeck(rawDeck);
    const idx = Math.max(0, Math.min(deck.slides.length - 1, Number(slideIndex) || 0));
    const slide = deck.slides[idx];
    const chapIdx = Math.max(0, Math.min(deck.chapters.length - 1, Number(slide.chapterIndex) || 0));
    const chaptersHtml = deck.chapters.map((name, ci) => {
      let cls = "tpl-chap";
      if (ci === chapIdx) cls += " active";
      else if (ci < chapIdx) cls += " done";
      return `<span class="${cls}">${xmlEsc(name)}</span>`;
    }).join("");

    const chunks = splitSubtitleChunks(slide.line, 22);
    const subtitleRaw = opts.subtitleText !== undefined
      ? opts.subtitleText
      : (chunks[0] ? chunks[0].text : slide.line || "");
    const subtitleHtml = highlightText(subtitleRaw, slide.highlightWords || [], "tpl-sub-hl");
    const figLabel = `图${idx + 1} · ${SLIDE_TYPES[slide.type] || "讲解页"}`;

    return `
      <div class="tpl-frame tpl-theme-${deck.theme} tpl-presenter-${deck.presenter} tpl-slide-${slide.type || "steps"}">
        <div class="tpl-bg-glow-1"></div>
        <div class="tpl-bg-glow-2"></div>
        <header class="tpl-header">
          <div class="tpl-topic-pill">
            <span class="tpl-topic-dot"></span>
            <span>${xmlEsc(deck.title)}</span>
          </div>
          <div class="tpl-chapters">${chaptersHtml}</div>
        </header>
        <div class="tpl-body">
          ${renderLeftPresenter(deck, slide, opts.imgMap)}
          <section class="tpl-main-card">
            <span class="tpl-fig-badge">${xmlEsc(figLabel)}</span>
            ${renderSlideBody(slide, deck, opts.imgMap)}
          </section>
        </div>
        <footer class="tpl-subtitle-zone">
          ${subtitleRaw ? `<div class="tpl-subtitle">${subtitleHtml}</div>` : ""}
        </footer>
      </div>
    `;
  }

  // ===== PNG Frame Exporter (SVG foreignObject -> 1280x720 Canvas) =====
  let cachedCssText = null;
  const imageDataUrlCache = new Map();

  async function loadTemplateCss() {
    if (cachedCssText !== null) return cachedCssText;
    const res = await fetch("/template-renderer.css", { cache: "no-cache" });
    if (!res.ok) throw new Error("无法加载模板样式表。");
    cachedCssText = await res.text();
    return cachedCssText;
  }

  async function imageToDataUrl(url) {
    if (!url) return "";
    if (url.startsWith("data:")) return url;
    if (imageDataUrlCache.has(url)) return imageDataUrlCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法加载模板图片素材：${url}`);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片素材失败。"));
      reader.readAsDataURL(blob);
    });
    imageDataUrlCache.set(url, dataUrl);
    return dataUrl;
  }

  async function exportSlideCuePng(rawDeck, slideIndex, subtitleText) {
    const deck = normalizeDeck(rawDeck);
    const slide = deck.slides[slideIndex];
    const cssText = await loadTemplateCss();
    const neededUrls = new Set();
    if (deck.presenter !== "none") {
      neededUrls.add(resolveAvatarSrc(deck));
    }
    if (slide.type === "cover") {
      neededUrls.add(slide.image || "/assets/template-fever-visual.jpg");
    }
    const imgMap = new Map();
    for (const url of neededUrls) {
      if (url) imgMap.set(url, await imageToDataUrl(url));
    }
    const frameXhtml = renderFrameHtml(deck, slideIndex, { subtitleText, imgMap })
      .replace(/<svg\b(?![^>]*\bxmlns=)/g, '<svg xmlns="http://www.w3.org/2000/svg"');
    const safeCss = cssText.replace(/]]>/g, "]]&gt;");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">` +
      `<defs><style type="text/css"><![CDATA[${safeCss}]]></style></defs>` +
      `<foreignObject x="0" y="0" width="1280" height="720">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:1280px;height:720px;overflow:hidden;">${frameXhtml}</div>` +
      `</foreignObject></svg>`;

    const img = new Image();
    img.decoding = "sync";
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("模板画面光栅化失败，请检查文字或图片素材。"));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = deck.theme === "warm" ? "#fdf5e7" : "#edf6fe";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.drawImage(img, 0, 0, 1280, 720);
    return canvas.toDataURL("image/png");
  }

  global.TemplateVideo = {
    THEMES,
    PRESENTERS,
    SLIDE_TYPES,
    DEFAULT_PHARMACIST,
    EXAMPLES,
    cloneExample,
    normalizeDeck,
    splitSubtitleChunks,
    highlightText,
    renderFrameHtml,
    exportSlideCuePng,
  };
})(window);
