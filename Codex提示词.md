# 给 Codex 的完整提示词

> 复制下面分隔线以下的全部内容发给 Codex。方案有更新时，同步修改这份文件。

---

# 任务

按项目根目录的《视频制作方案.md》完成全部改造，依次实施阶段 A 到阶段 G。
《视频制作方案.md》是唯一依据。《素材库方案.md》只作背景参考，两者冲突时以《视频制作方案.md》为准。

开始前请完整阅读《视频制作方案.md》、《使用说明.md》，以及方案中提到的所有源码文件。重点包括：
public/template-renderer.js、public/template-studio.js、public/studio.js、public/code-motion.js、
public/code-motion.html、public/code-motion-studio.js、public/svg-motion.js、public/svg-motion-studio.js、
public/asset-library.js、render_svg_video.mjs、scripts/render-code-motion.mjs、server.py、draft_content.py、
svg_motion.py、asset_library.py、work_costs.py、public/assets/library/catalog.json、tests/ 下的全部测试。

# 工作方式

1. 在新分支 feature/stage-mix 上工作。严格按 A → B → C → D → E → F → G 的顺序推进，G 内部再按 G1 → G2 → G3。
   一个阶段的验收全部通过并提交后，才能开始下一个阶段。
2. 每个阶段开始时，先在 docs/实施记录.md（没有就新建）写下本阶段的计划：要新建和修改哪些文件、打算如何验收。
   阶段结束时，在同一位置补上：
   - 实际改动；
   - 每项验收的实际结果，必须写具体数值，例如截图像素差异、测试通过数量、合成耗时、成片时长差异；
   - 未达成的验收项及原因；
   - 与方案不一致的地方及原因。
3. 每个阶段结束时提交一次 commit（G1、G2、G3 各提交一次）。提交信息用中文，风格和仓库现有提交一致，例如：
   A「抽出布局引擎与内容渲染器」、B「统一时间线与合成管线」、C「支持分镜按幕混用制作方式」、
   D「新增 Mix 模式编排」、E「新增画面事件音效」、F「素材库管理布局模板」、
   G1「新增 MG 动作库与转场」、G2「接入 Lottie MG 素材」、G3「新增 AI 制作 MG 素材」。
   提交前检查 git diff，确保没有混入无关改动。
4. 不能为了让测试通过而修改或删除已有测试的断言，也不能降低方案中写明的验收标准。
   确实需要调整时，在实施记录中说明理由。

# 必须遵守的约束

- 现有功能不能退化。旧作品（videoMode 为 template、template + code-motion、code-motion、svg、storyboard）
  都要能打开、编辑并重新合成。旧任务的「继续此任务」也要能用。
- 新合成管线通过阶段 B 的一致性验收之前，前端不能默认使用它，用 config.stageRender 开关控制。
  阶段 B 验收通过后再默认开启。
- 不改动「AI 分镜动画」（Seedance）的流程和代码。
- 不升级依赖，不引入前端框架。沿用原生 JS、Python 标准库和项目已有的 Playwright。
  唯一的例外是阶段 G2 新增 lottie-web：锁定当前 5.x 稳定版，把构建文件和 LICENSE 复制到 public/vendor/。
  其他新依赖要先停下来问我。
- 布局 JSON、Lottie 和 MG 规格中都不允许出现可执行内容。用户上传的 SVG、布局、Lottie，以及 AI 生成的 MG，
  都必须经过方案中写明的白名单校验。
- 内容渲染器的 draw、mg-kit 播放器和 Lottie 播放都必须是只依赖时间的纯函数，保证预览和逐帧导出一致。
- 旧作品缺少新字段时，结果要与改动前一致。例如缺少 audio.sfx 就视为 off；缺少 transition 就使用 0.3 秒淡入。
- 不提交 .studio/ 下的任何内容，不提交、不打印任何 API Key。

# 关于 Mix 模式（阶段 D）和 AI 制作 MG（阶段 G3），务必注意

- Mix 的核心是：由 AI（DeepSeek）根据每幕内容判断用哪种方式呈现最好。必须按方案 2.8 节分两步：
  先写脚本，再单独调用一次模型做「编排呈现」。不能用关键词匹配或固定对应表代替模型判断。
  固定对应表只用于方案中写明的兜底情况。
- AI 制作的 MG 素材必须先进入「待确认」区，经人工确认后才能入库。未确认的素材不能用于成片，Mix 也不能选用。
  Mix 的 mgRequest 只能提示「可以用 AI 制作」，不能自动生成并直接用于成片。
- 真实调用评测：通过本机工作台已配置的 DeepSeek Key（由本地服务读取钥匙串，不要读取或打印 Key 本身）完成：
  - 阶段 D：用方案中的 8 个示例主题各跑一次 Mix，生成 docs/mix-eval.md；
  - 阶段 G3：用方案中的 5 个描述各生成一次 MG，生成 docs/mg-ai-eval.md。
  如果本机无法调用 DeepSeek，在实施记录中说明，并用模拟数据完成单元测试。不要伪造评测结果。
- 费用控制：真实调用只允许运行上述评测，外加失败后的必要重试。任何会调用方舟出图、方舟视频或数字人对口型的
  操作都不要执行。合成测试一律设置 imageBudget = 0，或使用已有图片，不带数字人对口型。
- 阶段 G2 从 LottieFiles 选用样例素材时，只选用页面上写明可以商用的素材，并把原始链接和授权原文写入元数据。
  不确定的素材不要用，改用自制的简单 Lottie。

# 验收

每个阶段都要逐条完成方案第 6 节对应阶段的「验收」，并且每个阶段都运行：

  python -m unittest discover -s tests
  for f in public/*.js public/stage/*.js *.mjs scripts/*.mjs; do node --check "$f" || exit 1; done

涉及合成的验收要真正跑出 MP4，用 ffprobe 核对时长；用抽帧图片做画面对比；
从新进程开始测量合成耗时，并把数值写进实施记录。
截图对比的测试脚本放在 tests/ 下，可以重复运行。

UI 相关改动（阶段 C 到 G）要启动工作台（python -B server.py），用 Playwright 打开页面实际操作一遍，
覆盖方案中列出的场景：
- 新建视频并选择布局；
- Mix 模式与固定方式的切换；
- 同一幕在各种方式之间来回切换，确认内容不丢失；
- 重新编排全片和本幕重新判断；
- 音效开关和试听；
- 素材库布局的预览、复制、上传和下架；
- 转场切换；
- Lottie 上传和 palette 映射；
- mg 幕的预览与合成；
- AI 制作 MG 后的待确认、确认和丢弃；
- 打开旧作品并重新合成。
每个场景保存截图到 docs/验收截图/<阶段>/，并在实施记录中引用。

# 何时停下来问我

以下情况停下来，说明问题和你建议的做法，等我回复：
- 方案某处做不到，或者照方案做会破坏现有功能；
- 需要新增 lottie-web 以外的依赖，或需要修改方案中写明不改的部分；
- 某项验收在合理尝试后仍无法达成（例如阶段 B 的耗时上限）；
- 需要产生方舟、数字人等模型费用。

其他情况请自行判断并继续推进，不要每一步都询问。

# 最终汇报

全部完成后给我一份汇报：
- 每个阶段的 commit 列表；
- 每个阶段的验收结果汇总表；
- 未达成的项和遗留问题；
- 我需要手动检查的地方：docs/mix-eval.md 和 docs/mg-ai-eval.md 需要药师评审；
  docs/MG素材制作规范.md 需要确认后才能发给外包；
- 新增或变化的使用方式，同时更新《使用说明.md》中相应的段落。
