"""Curated Motion.md rules and component recipes for medical explainer code & SVG motion."""

AVAILABLE_ICONS = (
    "pill", "capsule", "bottle", "dropper", "syringe", "thermometer", "clock", "calendar",
    "water", "meal", "sun", "moon", "bed", "baby", "elder", "pregnant", "heart", "stomach",
    "eye", "nose", "tooth", "shield", "warning", "ban", "check", "cross", "bulb", "search",
    "scale", "measure", "doctor", "leaflet", "carton", "virus", "arrow", "spark",
)

MOTION_MD_CORE = (
    "【Motion.md 视觉与动效编排守则】\n"
    "- 节奏分级（拒绝千篇一律匀速）：微徽章/图标弹入 0.28–0.36s（back.out(1.4)）；标题/主卡片 0.38–0.48s（power3.out / expo.out）；"
    "SVG 路径描边 DrawSVG 0.45–0.70s（power2.inOut）；列表交错 stagger 0.10–0.14s；所有核心内容须在 duration*0.72 前落位，留足至少 1.2s 稳定阅读期。\n"
    "- 四拍叙事顺序：1) 顶部主题/徽章定调 → 2) 结构骨架或路径描边展开 → 3) 按 api.cues 节拍逐条点亮核心要点/数字 → 4) 底部结语胶囊轻强调收口。\n"
    "- 高级感与克制纪律：同屏焦点 ≤ 3 组，四周留白 ≥ 24px；背景保持干净通透，严禁堆砌杂乱大圆斑；外框已有药师主讲人，严禁徒手画人物五官、笑脸或火柴人。"
)

SCENE_DESIGN_KIT_HINT = (
    "【内置医疗视觉基座（Shadow DOM 已预加载，可直接用类名与图标）】\n"
    "- 画布容器：`.mc-canvas`（精致医疗点阵与柔光底纹）、`.mc-canvas.is-grid`（刻度/原理微网格）、`.mc-canvas.is-paper`（柔和手绘风）；\n"
    "- 排版与层次：`.mc-head`、`.mc-kicker`（顶部小胶囊）、`.mc-title`（主标题）、`.mc-sub`（副标题）、`.mc-num`（等宽大数值）；\n"
    "- 卡片与网格：`.mc-grid-2` / `.mc-grid-3` / `.mc-split`（左图右文分栏）、`.mc-card`（白底细边投影卡片，可叠加 `.is-soft` / `.is-ok` / `.is-warn` / `.is-danger`）、`.mc-pill`（底部收口胶囊，Flex 自动对齐绝不压字）；\n"
    "- 36 枚精绘线性医疗图标：直接写 `<span class=\"mc-icon-badge is-primary\" data-icon=\"pill\"></span>`（自动注入高质量矢量 SVG 图标，可叠加 `.is-ok` / `.is-warn` / `.is-danger` / `.is-lg`），无需手画粗糙图标。\n"
    f"  可选图标名：{', '.join(AVAILABLE_ICONS)}。"
)

SVG_DESIGN_KIT_HINT = (
    "【内置 36 枚精绘医疗矢量图标（可直接嵌入 <svg>）】\n"
    "- 在 <svg> 内可直接写 `<g data-icon=\"pill\" transform=\"translate(x, y) scale(2.2)\" color=\"var(--v-primary)\"></g>`，"
    "挂载时会自动注入标准 24×24 精绘线性矢量图标（继承 currentColor），避免徒手硬凑粗糙药瓶、时钟、人物或警示图标。\n"
    f"- 可选图标名：{', '.join(AVAILABLE_ICONS)}。\n"
    "- 矢量背景保持干净简洁（可用极细坐标网格 <pattern> 或柔和圆角底板），不要在四角堆杂乱色块圆斑；"
    "图标与文字横向并排时，确保 `text-anchor=\"start\"` 且文字 x ≥ 图标右边界 + 14px，严禁压字压线。"
)

_SCENE_RECIPES = {
    "cover": {
        "name": "焦点开场结论卡（Hero Statement）",
        "surface": ".mc-canvas",
        "structure": "顶部 `.mc-kicker` 主题徽章 + 中央大字结论 `.mc-title`（配高亮关键词底色）+ 下方 1–2 张 `.mc-card.is-soft` 核心支撑卡片，右侧或左上配 `.mc-icon-badge.is-lg` 精绘图标与描边装饰短线。",
        "choreography": "0.08s 徽章与标题轻浮入场 → 0.35s 主题短线 DrawSVG 扫过 → 0.55s 核心卡交错弹入 → 结语稳定停留。",
        "icons": ["shield", "pill", "bulb"],
    },
    "explain": {
        "name": "左图右文原理解析（Split Mechanism）",
        "surface": ".mc-canvas.is-grid",
        "structure": "顶部 `.mc-head` 标题栏 + 主体 `.mc-split`（左侧 40% 干净内联 `<svg>` 几何原理示意图，如释药曲线/胶囊剖面/刻度量杯；右侧 60% 2–3 条 `.mc-card` 解码卡片配 `.mc-icon-badge`）。",
        "choreography": "0.08s 标题落位 → 0.25s 左侧 SVG 骨架现身并用 DrawSVG 画出关键流向/曲线（0.65s power2.inOut）→ 0.55s 起按 api.cues 逐条滑入右侧解码卡。",
        "icons": ["capsule", "thermometer", "measure", "stomach"],
    },
    "compare": {
        "name": "安全对错双栏对比（Do vs Don't Split）",
        "surface": ".mc-canvas",
        "structure": "顶部标题 + `.mc-grid-2` 左右对照：左栏 `.mc-card.is-ok`（顶栏绿勾 `data-icon=\"check\"` + 正确做法），右栏 `.mc-card.is-danger`（顶栏红叉 `data-icon=\"cross\"` 或 `ban` + 常见误区），底部 `.mc-pill` 一句总结。",
        "choreography": "0.08s 标题落位 → 0.25s 右侧误区栏先出并轻触发警示徽章 → 0.75s（或 cue[1]）左侧正确做法绿栏稳健弹出、绿勾 DrawSVG 划出 → 结尾底部总结胶囊定格。",
        "icons": ["check", "cross", "ban", "warning"],
    },
    "steps": {
        "name": "编号连线步骤流（Connected Steps）",
        "surface": ".mc-canvas.is-grid",
        "structure": "顶部标题 + 中部横向 `.mc-grid-3`（2–3 步）或纵向步骤卡，每步带圆角序号徽章（01/02/03）与 `data-icon` 医疗图标，步骤间用细 SVG 虚线/箭头连线串联，底部 `.mc-pill` 行动提醒。",
        "choreography": "0.08s 标题落位 → 0.25s 第一步入场 → 连接箭头 DrawSVG 依次向右/下伸展并触发下一步弹出（与 api.cues 对齐）→ 末步完成后底部提醒胶囊出现。",
        "icons": ["leaflet", "measure", "water", "clock"],
    },
    "timeline": {
        "name": "用药时间轴与间隔轨（Interval Timeline）",
        "surface": ".mc-canvas.is-grid",
        "structure": "顶部标题 + 中央横向时间轨 SVG（底轨 + DrawSVG 进度填充线 + 2–3 个时间节点圆点与上方说明卡）+ 底部安全间隔 `.mc-card.is-warn` 提示条。",
        "choreography": "0.10s 标题与底轨淡入 → 0.30s 进度线 DrawSVG 平滑推进并配合 MotionPath 游标移动，经过每个节点时对应标签卡片 back.out(1.4) 弹出 → 结尾间隔提醒稳态停留。",
        "icons": ["clock", "calendar", "sun", "moon", "meal"],
    },
    "warning": {
        "name": "分级风险警示卡（Clinical Alert）",
        "surface": ".mc-canvas",
        "structure": "顶部珊瑚红/琥珀警示胶囊（`data-icon=\"warning\"`）+ 醒目警示标题 + 中部 `.mc-card.is-danger` 风险要点（1–2 条，带 `ban`/`warning` 图标）与 `.mc-card.is-ok` 安全替代建议形成反差。",
        "choreography": "0.06s 警示条与标题快速利落入场（0.32s expo.out）→ 0.35s 警示图标轻微缩放强调（scale 1.05 yoyo 1 次）→ 0.70s 安全替代建议绿卡稳健展开。",
        "icons": ["warning", "ban", "shield", "baby", "elder", "pregnant"],
    },
    "checklist": {
        "name": "药师核对勾选清单（Verification Checklist）",
        "surface": ".mc-canvas.is-paper",
        "structure": "左窄右宽或上下结构：顶部标题 + 2–4 条精致 `.mc-card` 清单项，每项左侧带精绘 `data-icon` 图标，右侧带绿色圆形勾选 SVG（勾号用 DrawSVG 逐条划出），底部 `.mc-pill` 结语。",
        "choreography": "0.10s 标题与清单骨架 stagger:0.12 入场 → 0.50s 起按 api.cues 逐项点亮当前核对卡并用 DrawSVG 划出绿色对勾 → 全部勾选完毕后结语胶囊落位。",
        "icons": ["check", "leaflet", "carton", "search", "clock"],
    },
    "summary": {
        "name": "权威收口双要点（Clean Summary Takeaway）",
        "surface": ".mc-canvas",
        "structure": "顶部主标题（带主色竖条与 `.mc-kicker`「重点记住」）+ 中部 `.mc-grid-2` 或 `.mc-grid-3` 精炼要点卡（每卡配 `.mc-icon-badge.is-ok` 医疗图标，绝不画简笔人物）+ 底部居中高对比 `.mc-pill` 问药师提醒。",
        "choreography": "0.08s 标题落位 → 0.28s 要点卡交错上浮（stagger:0.14 power3.out）→ 0.85s 图标徽章轻弹点亮 → 末句口播时底部 `.mc-pill` 稳健浮现并轻脉冲 1 次后定格。",
        "icons": ["shield", "check", "pill", "doctor", "leaflet"],
    },
}

_SVG_RECIPES = {
    "cover": {
        "name": "中心徽章主视觉（Focal Vector Emblem）",
        "structure": "柔和微网格底板 + 中央精致圆角主视觉徽章（用 `<g data-icon=\"...\">` 放大组合几何刻度/光环，避免手画人物）+ 下方 1 句精炼主标题与描边装饰线。",
        "choreography": "外环 DrawSVG 0.6s 闭合 → 主图标缩放弹入（back.out(1.5)）→ 标题与副标注轻柔上浮。",
    },
    "explain": {
        "name": "医学机理矢量图示（Clean Vector Diagram）",
        "structure": "干净坐标网格底板 + 清晰 2–3 阶段几何图示（如胶囊→缓释曲线、量杯刻度液面、药盒→说明书放大镜），节点间用带箭头的 DrawSVG 曲线连接，每节点只放 4–8 字短标签。",
        "choreography": "左侧主体出现 → 连接曲线 DrawSVG 推进（可配合 MotionPath 让小药丸/液滴沿曲线运动）→ 右侧结果节点点亮。",
    },
    "compare": {
        "name": "左右矢量对照板（Visual Split Compare）",
        "structure": "中央细竖线分隔左右两张圆角面板：左面板安全绿底徽章 + `data-icon=\"check\"` + 正确示意；右面板珊瑚红徽章 + `data-icon=\"cross\"` + 错误示意，标注短而清晰、绝不压线。",
        "choreography": "中轴线 DrawSVG 向下画出 → 左右面板依次展开 → 对勾与叉号 DrawSVG 分别划出。",
    },
    "steps": {
        "name": "矢量三步流程图（Vector Flow Steps）",
        "structure": "横向 3 个圆角节点卡（内嵌 `<g data-icon=\"...\">` 图标与 4–8 字短标题），节点之间用水平路径箭头连接，上方配简洁标题。",
        "choreography": "节点 1 弹入 → 箭头 1 DrawSVG 画出 → 节点 2 弹入 → 箭头 2 DrawSVG 画出 → 节点 3 弹入并打勾收尾。",
    },
    "timeline": {
        "name": "矢量时间间隔轨（Vector Time Track）",
        "structure": "居中粗圆角时间轴轨道 + 2–3 个带 `data-icon=\"clock\"` / `sun` / `moon` 的圆点节点 + 上下错落短标注（确保文字与轨道间距 ≥ 18px）。",
        "choreography": "底轨淡入 → 高亮进度条 DrawSVG 从左到右平滑推进，游标沿路径滑动并依次点亮各时刻节点。",
    },
    "warning": {
        "name": "警示盾牌矢量图（Alert Shield Diagram）",
        "structure": "柔和浅暖/浅珊瑚提示圆角主卡 + 左侧大号 `data-icon=\"warning\"` / `ban` 警示徽章 + 右侧 1–2 条简短警示短语（`text-anchor=\"start\"`，左边缘距图标右缘 ≥ 20px）。",
        "choreography": "警示徽章 pop 入场并轻脉冲 1 次 → 右侧警示短语交错滑入 → 底部安全绿提示条稳态落位。",
    },
    "checklist": {
        "name": "矢量核对板（Vector Check Board）",
        "structure": "居中大号圆角核对板，内含 2–3 行整齐横向条（左 `data-icon` 图标 + 中短语 `text-anchor=\"start\"` + 右独立圆圈对勾），行距 ≥ 22px 保证清晰呼吸感。",
        "choreography": "核对板落位 → 各行交错滑入 → 右侧对勾按口播节拍用 DrawSVG 依次划出。",
    },
    "summary": {
        "name": "干净矢量收口徽章（Clean Vector Summary）",
        "structure": "左上简洁标题 + 左侧 2 张整齐横条要点（左绿勾图标、右文字 `text-anchor=\"start\"`）+ 右侧简洁医疗盾牌/药盒组合徽章（用 `data-icon=\"shield\"` / `pill`，严禁手画人物五官）+ 底部宽胶囊结语。",
        "choreography": "标题入场 → 要点条与勾号依次 DrawSVG 点亮 → 右侧盾牌徽章柔和浮现 → 底部结语胶囊稳健落位。",
    },
}


def recipe_for(kind, shot, spec=None):
    """Return the matched high-craft design recipe and recommended icons for a shot."""
    table = _SVG_RECIPES if kind == "svg" else _SCENE_RECIPES
    ptype = ((shot or {}).get("points") or {}).get("type") or "explain"
    if ptype not in table:
        ptype = "explain"
    recipe = dict(table[ptype])
    shape = (spec or {}).get("shape", "standard")
    if shape in ("shallow", "shallow-wide", "ultrawide"):
        recipe["aspectTip"] = "画幅扁宽，优先采用横向多列并排（.mc-grid-2 / .mc-grid-3 / 横向时间轴），严禁纵向堆叠超过 2 层。"
    elif shape == "narrow":
        recipe["aspectTip"] = "画幅较窄紧凑，优先采用纵向 2 层布局或上下分栏，避免 3 列横向挤压文字。"
    else:
        recipe["aspectTip"] = "16:9 标准横屏，可均衡采用左图右文（.mc-split）或上标题+双列卡片（.mc-grid-2）。"
    recipe["pointType"] = ptype
    return recipe
