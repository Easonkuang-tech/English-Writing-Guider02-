# Project Context — 这个项目是做什么的

这个项目是一个可支持多用户、多设备同步的雅思写作练习工具，目标不是做普通作文批改器，而是形成完整训练闭环：

1. 记录当天学到的单词、词伙和句式。
2. 根据当天素材自动匹配一道最自然的写作题。
3. 要求用户把当天素材真正写进回答。
4. 简易练习按日常练习标准检查，正式作文按 IELTS 四项标准评分。
5. 保存题目、素材、原文、评分、反馈和修改示范，供以后搜索和复习。

本地模式保留离线能力。最终部署使用 Railway 运行服务端，使用 Supabase Auth、PostgreSQL 和 RLS 支持多用户及多设备同步。

核心原则：

```text
每日输入 -> 单题匹配 -> 强制输出 -> 检查使用质量 -> 保存历史
```

---

# About Me — 我是谁、我的使用场景、我的偏好

我是正在准备 IELTS Writing 的私人学习者。

我的日常使用方式：

- 每天提供当天新学的单词、词伙和句式。
- 输入格式以 Markdown 为主，最少使用 `名字：内容`。
- 我希望每天只得到一道匹配题目。
- 我希望素材尽可能自然地组成一篇完整语言，而不是机械塞入。
- 简易练习限时由我自己决定，目标长度 80–150 词。
- 正式作文需要完整的 IELTS 风格评估。
- 我需要保留每次练习，方便以后回看和复习。

我的产品偏好：

- 本地优先，离线时继续保存到当前设备。
- 登录后由 Supabase 成为最终云端数据源。
- 支持 Markdown 导入和导出。
- 支持完整 JSON 备份与恢复。
- 使用紫色作为主视觉，不照搬参考图。
- 首页保留每日素材、今日任务、连续练习和评分趋势面板，结构和密度约 70% 参考现有面板。
- 核心写作与批改过程参考最后一张图的专注、分阶段体验。

---

# Communication Style — 语气、写法规则

- 默认使用中文沟通，IELTS 专业术语可以保留英文。
- 表达清楚、直接、可执行，不使用空泛鼓励。
- 复杂任务先用短段落说明目标和取舍。
- 不堆砌术语，不写企业黑话。
- 解释评分时必须区分事实、推断和 AI 估算。
- 面向用户时说明“接下来能做什么”，而不是只描述系统内部状态。
- 界面文案简洁、主动、句子短，按钮名称与实际结果保持一致。
- 不为了增加篇幅而重复需求。

---

# Rules — 硬性行为规则

## 开始任务前

- 复杂任务开始前至少提出三个真正影响实现的问题。
- 信息不足时先问，不自行编造产品规则。
- 执行前先给出清晰计划。
- 如果存在多种方案，说明主要取舍后再选择。

## 产品边界

- V1 只做 IELTS Academic Writing Task 1 和 Task 2。
- 最终版本支持多个独立用户，每个用户只能读取自己的数据。
- 所有 Supabase 业务表必须启用 RLS，并以 `auth.uid() = user_id` 隔离。
- 题库必须将 Task 1 和 Task 2 分开。
- 每天只推荐一道题。
- 每日素材优先自然使用，不能为了覆盖率强行制造联系。
- 简易练习不输出 IELTS Band。
- 正式作文输出 Estimated Band Range，绝不声称是官方成绩。
- 目标词句使用质量不能直接变成 IELTS 加分。

## 评分规则

- 日常练习使用《日常写作练习评分系统.md》的 10 分 Rubric。
- 正式作文使用《雅思正式写作评分系统.md》的四项评分标准。
- 正式评分每项必须先引用用户原文，再给估算 Band。
- 四项权重相同，平均后四舍五入到最近的 0.5 Band。
- 每轮只给一个 Priority Fix。
- 正式作文只给最小修改示范，不代写完整替换答案。
- 简易练习不代写完整答案。
- 不虚构题目来源、评分依据、用户原文或词数。

## 数据与安全

- 浏览器本地保存用于离线缓存。
- 登录后数据同步到 Supabase。
- `localStorage` 不再作为最终版本的唯一数据源。
- 历史记录必须保存题目和素材快照，不能只依靠外键。
- 编辑题库不得改变旧报告。
- 导入前必须验证，用户可选择 Merge 或 Replace。
- 导出内容不得包含 API Key。
- DeepSeek API Key 只能存在于 `.env.local`。
- 密钥不得出现在浏览器代码、日志、Markdown、备份或 Git。
- 模型输出必须经过结构化校验后才能保存。

## 云端部署

- Railway 作为 Web Service，运行 `npm start`。
- Railway 读取 `process.env.PORT`，监听 `0.0.0.0`。
- Supabase 保存账号、业务数据和同步版本。
- Supabase 迁移文件必须进入 `supabase/migrations/`。
- 浏览器只允许接触 Supabase anon key。
- `SUPABASE_SERVICE_ROLE_KEY` 只能存在于 Railway 服务端。
- 本地 JSON 备份继续保留，用于迁移和回滚。

## 修改代码时

- 先读 `CLAUDE.md`，再修改架构或用户行为。
- 保留工作区和用户已有改动。
- 优先使用现有模块和小函数，不提前引入抽象。
- 不引入 React、Next.js、数据库服务或 npm 依赖，除非现有内置运行时无法满足明确需求。
- 保持项目随时可运行。
- 修改后执行相关测试，并报告无法验证的部分。

---

# File Naming Rules — 文件命名约定

项目文件使用小写、稳定、可读的命名：

```text
server.mjs              本地 HTTP 服务和 DeepSeek 代理
public/index.html       浏览器页面入口
public/app.mjs          浏览器状态、页面和交互
public/core.mjs         可测试的解析、匹配和评分辅助逻辑
public/styles.css       全局设计系统和响应式样式
data/prompts.md         内置 IELTS 写作题库
tests/core.test.mjs     核心逻辑测试
```

规则：

- 新增代码模块使用小写文件名和扩展名。
- 不随意重命名用户提供的题库或评分文档。
- 用户资料保持原始名称。
- 导出的备份使用 `bandcraft-backup-YYYY-MM-DD.json`。
- 导出的 Markdown 使用 `bandcraft-practice-YYYY-MM-DD.md`。
- 不把日期、版本或作者写进大量内部文件名。

---

# Folder Structure — 目录结构

```text
.
|-- CLAUDE.md
|-- README.md
|-- .env.example
|-- .gitignore
|-- server.mjs
|-- data/
|   |-- prompts.md
|   `-- reference/
|       |-- 日常写作练习评分系统.md
|       |-- 雅思正式写作评分系统.md
|       `-- IELTS写作口语题库.md
|-- public/
|   |-- index.html
|   |-- app.mjs
|   |-- core.mjs
|   `-- styles.css
`-- tests/
    `-- core.test.mjs
```

目录职责：

- `server.mjs`：文件服务、请求校验、DeepSeek 调用和结构化结果归一化。
- `data/`：内置题库和可导入数据，不存放 API Key。
- `public/`：所有浏览器代码和样式。
- `tests/`：无需额外框架的 Node 测试。

用户原始资料当前包括：

```text
日常写作练习评分系统.md
雅思正式写作评分系统.md
IELTS写作口语题库.md
```

其中 Speaking 部分暂不进入 V1；只使用 Writing Task 1 和 Task 2。

---

# Build Phases — 每个制作阶段需要做什么

制作顺序必须遵循“先闭环，再优化；先本地，再 AI”的原则。

不要先做好看的首页，再回头补数据模型。

不要让 DeepSeek 代替本地可确定完成的工作，例如解析 Markdown、计算词数、保存草稿、匹配题库或导出备份。

## Phase 0：确认产品边界

目标：

把“做什么”和“不做什么”写清楚，避免制作中不断增加功能。

需要完成：

- 确认只做 IELTS Academic Writing Task 1 和 Task 2。
- 确认只做私人本地网页，不做账号和云同步。
- 确认每天只推荐一道题。
- 确认简易练习和正式作文使用两套不同的评分系统。
- 确认输入、输出、历史和备份的边界。
- 确认所有评分都是估算，不是官方 IELTS 成绩。

交付物：

- 已更新的 `CLAUDE.md`。
- V1 功能清单。
- V1 非目标清单。
- 12 条 Success Criteria。

完成条件：

- 后续功能可以明确判断“属于 V1”或“不属于 V1”。
- 评分系统、题库和写作模式没有概念混用。

---

## Phase 1：定义数据和内容格式

目标：

在写界面前确定所有内容如何保存，避免页面先做出来但没有稳定数据。

需要完成：

- 定义 `prompts` 数据结构。
- 定义 `dailySessions` 数据结构。
- 定义 `attempts` 和 `evaluations` 数据结构。
- 定义 Task 1 和 Task 2 的标识。
- 定义 `simple` 和 `formal` 两种模式。
- 定义每日词伙和句式的 Markdown 格式。
- 定义题库 Markdown 格式。
- 定义 JSON 备份版本和导出字段。
- 确定历史记录必须保存快照，不能只保存题目 ID。

交付物：

- 可解析的 `data/prompts.md`。
- `public/core.mjs` 中的解析和归一化函数。
- 示例每日素材。
- 示例备份文件结构。

完成条件：

- 同一份数据重复导入不会改变含义。
- 没有题库时，应用仍能显示空状态。
- 以后编辑题目不会破坏历史报告。

---

## Phase 2：建立本地应用基础

目标：

先得到一个可以在手机和电脑打开、保存和刷新的本地网页。

需要完成：

- 建立 `server.mjs` 本地 HTTP 服务。
- 建立 `public/index.html` 页面入口。
- 建立浏览器状态和路由。
- 建立 `localStorage` 读写封装。
- 建立统一 CSS Token。
- 建立首页、题库、练习、历史、设置五个导航入口。
- 建立 Toast、空状态、错误状态和加载状态。
- 建立响应式布局。

交付物：

- 可运行的本地网页。
- 五个可切换页面。
- 手机和桌面基础布局。
- 刷新后不丢失测试数据。

完成条件：

- 没有 DeepSeek Key 时，应用仍能正常打开并使用本地功能。
- 浏览器控制台没有阻断性错误。
- 页面在 360px 手机宽度和桌面宽度下不重叠。

---

## Phase 3：完成题库管理

目标：

让 Task 1 和 Task 2 题库能被创建、导入、查看和导出。

需要完成：

- 读取内置 `data/prompts.md`。
- 支持手动创建题目。
- 支持编辑题目。
- 支持删除或归档题目。
- 支持 Markdown 粘贴导入。
- 支持 Markdown 文件导入。
- 支持导入预览。
- 支持 Merge 和 Replace。
- 支持 Markdown 导出。
- 支持按 Task 1、Task 2、主题和关键词筛选。
- 显示已使用和最近使用状态。

交付物：

- 可用的题库页面。
- 20 道 Task 1 和 20 道 Task 2 的初始数据。
- 导入和导出按钮。
- 题目编辑和校验反馈。

完成条件：

- 导入后题目正确归入 Task 1 或 Task 2。
- 格式错误时不会破坏现有题库。
- 导出后再次导入能够得到等价数据。

---

## Phase 4：完成每日素材输入

目标：

让用户每天可以稳定输入词伙和句式，并保留当天草稿。

需要完成：

- 提供“今日词伙”输入框。
- 提供“今日句式”输入框。
- 支持 `名字：内容` 和 `- 名字: 内容`。
- 同时接受中文冒号和英文冒号。
- 实时显示解析出的素材数量。
- 显示无法解析的行。
- 自动保存未提交素材。
- 支持重新打开当天素材继续编辑。
- 支持把每日素材导出为 Markdown。

交付物：

- 每日素材编辑页面。
- 解析结果预览。
- 当天素材草稿。
- 可复用的素材记录。

完成条件：

- 刷新页面后当天输入不丢失。
- 输入错误时有行级提示。
- 每条有效素材都有稳定 ID、类型、名称和详情。

---

## Phase 5：完成单题匹配

目标：

根据当天素材得到一道自然匹配的题目，而不是随机题或纯关键词题。

需要完成：

- 本地匹配规则。
- DeepSeek 匹配接口。
- 主题兼容性判断。
- 写作功能兼容性判断。
- 正式程度和难度判断。
- 最近重复度扣分。
- 返回匹配理由。
- 返回置信度。
- 返回无法自然覆盖的素材。
- 允许用户手动更换题目。
- 保存原推荐题和最终选题。

交付物：

- `推荐今日题目` 操作。
- 一道推荐题和理由。
- 未覆盖素材提示。
- 手动更换题目入口。

完成条件：

- 没有 DeepSeek 时能使用本地启发式结果。
- 匹配结果有明确理由。
- 不把无关素材强行塞进题目。
- 每天默认只有一道推荐题。

---

## Phase 6：完成写作编辑器

目标：

把推荐题目转化为真正可完成的写作练习。

需要完成：

- 显示题目和当天素材摘要。
- 提供简易练习和正式作文切换。
- 提供开始、暂停和重置计时器。
- 提供主写作编辑区。
- 实时统计英文词数。
- 自动保存草稿。
- 显示简易练习 80–150 词提示。
- 显示 Task 1 150 词和 Task 2 250 词提示。
- 提交前检查空内容和极短内容。
- 接口失败时保留草稿。
- 未提交前允许继续编辑。

交付物：

- 核心写作页面。
- 两种练习模式。
- 可选计时器。
- 自动保存草稿。

完成条件：

- 写作页面是页面中最大的操作区域。
- 刷新、返回首页或接口失败不会丢失作文。
- 词数和计时在手机与桌面都稳定显示。

---

## Phase 7：完成 AI 评估

目标：

根据练习模式调用正确评分系统，并得到结构化、可验证的结果。

需要完成：

- 服务端读取 DeepSeek Key。
- 浏览器不得接触 API Key。
- 实现 `/api/evaluate`。
- 简易练习调用 Daily Practice Rubric。
- 正式作文调用 IELTS 四项 Rubric。
- 正式评分每项包含原文证据。
- 服务端校验 JSON。
- JSON 失败时修复一次。
- 保存 `rubricVersion` 和 `modelVersion`。
- 保存 API 失败状态。
- 不渲染模型返回的 HTML。

交付物：

- 可调用的评估接口。
- 简易练习结构化响应。
- 正式作文结构化响应。
- 错误和重试状态。

完成条件：

- 简易练习不出现 IELTS Band。
- 正式作文不出现“官方成绩”措辞。
- 正式评分四项权重相同并正确取半档。
- 目标词使用不会直接给 IELTS 加分。

---

## Phase 8：完成报告和使用追踪

目标：

把模型评分转化成用户能看懂、能修改、能复习的反馈。

需要完成：

- Daily Mini Practice 显示 10 分制，正式作文显示 Estimated Band Range。
- 简易报告先显示一句话诊断、任务覆盖、核心观点和五项能力。
- 显示目标词伙和句式状态，但不把它们作为 IELTS 能力评分项。
- 显示原文逐句问题和错误类型。
- 只先处理最重要的三个问题，每项采用“用户原句 → 母语者改写 → 可复用句式 → 使用条件 → 用户重新修正”。
- 显示 80–150 词最小改写，并明确它不是完整 Task 2。
- 支持用户在原文上反复修改，提交修改稿后再次批改，直到基础表达正确。
- 不显示“这次只改一件事”或“已经做对的部分”。
- 完整 220–280 词改写必须由用户点击后生成，不进入基础评分响应。
- 学习拓展从引言、双方观点、理由发展、个人立场中加权随机抽取一个进行深度拆解。
- 随机结果首次固定保存，用户可以主动换一个部分。
- 要求用户提取万能表达，并完成 50–80 词迁移练习。
- 提供重新练习和编辑原稿入口。
- 支持复制报告和导出报告。

目标素材状态：

```text
not_used
accurate
grammar_issue
semantic_issue
mechanical
```

完成条件：

- 用户能明确知道哪些词句用了、哪些没用、哪些用错。
- 反馈必须引用真实原文，不能凭空生成引用。
- 评分、事实和 AI 推断有清晰区别。

---

## Phase 8B：完成语料库表达训练

目标：

把一个表达从“认识”训练到“在真实输出中自然使用”。

需要完成：

- 在练习页提供 `IELTS 写作练习` 和 `语料库表达训练` 两个入口。
- 用户输入中文含义、目标表达和第一次英文尝试。
- 生成一次 IELTS 标准表达、中文回译和抽象框架。
- 自然程度必须返回 0–10 分，并映射为 Native-like、Natural、Understandable but uneven、Awkward 或 Unclear。
- 每条语料支持用户自定义名称；升级到 Spontaneous 后自动进入命名步骤。
- 用户确认或修改框架后才能进入 Controlled。
- Controlled 通过后升级。
- Reused 使用新的中文语境，默认隐藏框架和标准答案。
- 用户点击“需要框架”后，该次练习即使正确也不能升级。
- Reused 通过后可记录真实使用。
- 真实使用至少 3 次、覆盖 2 个语境、至少 1 次没有查笔记，才能升级到 Spontaneous。
- 升级失败不降级。
- 长期未使用只显示需要复习，不自动降级。
- 用户可以手动重置阶段。
- 语料库训练记录进入独立历史页面和 JSON 备份。

阶段：

```text
New -> Controlled -> Reused -> Spontaneous
```

数据：

```text
corpusItems
corpusAttempts
corpusUsageRecords
```

`corpusItems.customName` 保存用户自定义名称；未设置时可以暂时显示目标表达或“未命名表达”。

AI 接口：

```text
POST /api/corpus/evaluate
POST /api/corpus/check
POST /api/corpus/usage-check
POST /api/corpus/random-prompt
```

完成条件：

- 中文含义、第一次尝试、标准表达、框架和每次升级证据全部保存。
- 阶段规则不能被模型或界面绕过。
- 原有写作、报告、进阶学习和备份功能保持正常。

---

## Phase 8C：检索训练与间隔复习（已确认）

目标：

把语料库训练从“一次性学会”升级为“按遗忘曲线主动回忆”。

核心原则来自：

- Make It Stick：越努力回忆，记忆越牢。
- Fluent Forever：用完整句子、建立卡片、进入 SRS、间隔复习。
- 训练目标是帮助用户回忆，而不是用难题考倒用户。

标准学习节奏：

```text
7 分钟第一次表达 + 8 分钟修正学习
+ 5 分钟做卡
+ 当天 2 次自测
+ 第 2 天 3 分钟
+ 第 3 天 3 分钟
+ 第 7 天 5 分钟
```

禁止默认采用：

```text
1 小时连续学习
-> 第二天完全写不出
-> 崩溃后重新连续学习 1 小时
```

### New 阶段：第一次表达计时

- 用户输入中文含义。
- 用户必须手动点击“开始 7 分钟打卡”后才能输入第一版英文。
- 计时只由手动开始打卡触发，不在第一次输入时自动开始。
- 用户可随时提前提交。
- 第一次表达到 7 分钟时必须自动保存并提交，原输入框禁止继续输入。
- 用户可以基于纠正结果进入后续修改，但不能继续延长第一次计时输入。
- 后台保存开始时间、提交时间、实际用时、是否超时和键盘活动起点。
- AI 检查内容、自然程度和基础表达问题。
- 自然程度继续使用 0–10 分。

纠错呈现格式：

```text
需要修正

原文表达
-> 更自然的表达
-> 简短原因

继续列出其他需要修正的表达

自然版本：
一段完整、自然、可直接作为例子的英文版本
```

不能只给“错误数量”。必须提供：

- 原表达与自然表达的逐项对照。
- 为什么这样改更自然。
- 一整段正确自然版本。
- 标准表达不能添加用户没有表达的额外观点。

每次当天自测、第 2/3/7 天复习以及后续长期间隔复习完成后，也必须返回相同格式：

- 原表达 → 修正表达。
- 修正原因。
- 完整自然版本。

### 5 分钟做卡

第一次修正完成后进入做卡阶段，默认启动 5 分钟计时。

卡片至少包含：

- 中文含义。
- 已确认的抽象框架。
- 基础词伙与搭配。
- 一条标准英文表达。
- 用户第一版表达中值得保留的个人内容。
- 下次主动回忆时应该回答的问题。

框架和基础词伙确认后，卡片才正式进入复习计划。

### 当天两次自测

- 两次测试必须拆分为两个独立打卡。
- 每次打卡都由用户手动开始和完成。
- 每次打卡都保存时间、题目、答案、结果和用时。
- AI 根据用户的能力水平与题型偏好生成测试题。
- 测试目的是训练提取，不是故意提高难度。
- 第一次在卡片完成后立即进行。
- 第二次最早在第一次完成 2 小时后开放，主页显示待打卡提醒。
- 两次自测不能自动合并为一次完成记录。

首次使用时保存：

- 能力水平：新手、中级或高级。
- 系统后续根据正确率自适应调整难度。
- 可多选的测试偏好：
  - 中文翻译成英文。
  - 补全框架。
  - 根据框架写句子。
  - 主动回忆中文含义。
- 阶段推进仍严格保持：

```text
New -> Controlled -> Reused -> Spontaneous
```

### 第 2、3、7 天复习

复习必须记录本地日期和到期日期：

```text
第 2 天：3 分钟
第 3 天：3 分钟
第 7 天：5 分钟
```

每次复习：

- 自动显示倒计时。
- 第 2、3、7 天超时后允许继续，但记录超时。
- 先要求主动回忆，再显示答案。
- 记录是否查看提示、是否查看答案、是否正确和实际用时。
- 复习完成后按计划生成下一次复习日期。
- 错过后显示“已逾期”，不自动降级。

### 第 7 天之后

默认扩展间隔为：

```text
第 15 天：3 分钟
第 30 天：5 分钟
第 60 天：5 分钟
```

之后根据熟悉度继续延长间隔，直到达到 `Spontaneous`。

复习本身不直接改变掌握阶段。

掌握阶段仍按：

```text
New -> Controlled -> Reused -> Spontaneous
```

### 数据模型扩展

`corpusItems` 增加：

- `learningPlan`
- `firstAttemptStartedAt`
- `firstAttemptSubmittedAt`
- `firstAttemptDurationSeconds`
- `firstAttemptTimedOut`
- `cardDraft`
- `cardConfirmedAt`
- `testProfile`
- `sameDayTests`
- `scheduledReviews`
- `reviewHistory`
- `nextReviewAt`
- `reviewIntervalStage`

`sameDayTests` 每项至少包含：

- `slot`：`first` 或 `second`
- `status`
- `scheduledWindow`
- `startedAt`
- `completedAt`
- `durationSeconds`
- `questions`
- `answers`
- `result`

`scheduledReviews` 每项至少包含：

- `dueDate`
- `intervalDays`
- `targetSeconds`
- `status`
- `startedAt`
- `completedAt`
- `durationSeconds`
- `result`

### 已确认规则

1. 第一次表达的 7 分钟结束后自动提交，禁止继续输入。
2. 当天第一次测试在卡片完成后立即进行；第二次最早间隔 2 小时。
3. 能力水平分为新手、中级、高级，并根据正确率自适应。
4. 测试偏好支持中文翻译、补全框架、根据框架写句子和主动回忆中文含义。
5. 第 7 天后使用第 15、30、60 天间隔。
6. 错过复习只标记逾期，不降级、不清零。
7. 完成主动回忆和全部问题即可打卡；正确率只调整后续难度。
8. 所有未达到 Spontaneous 的语料进入复习计划，达到后允许手动加入长期复习。
9. 所有计时器均为倒计时；除第一次表达外，超时后允许继续但记录超时。
10. 刷新页面后，计时按真实时间继续；关闭浏览器再回来显示剩余时间和中断记录。

---

## Phase 9：完成历史与首页面板

目标：

让每次练习可以回溯，并让首页直接告诉用户今天做什么。

需要完成：

- 保存完整练习历史。
- 支持按日期、题目、素材和反馈搜索。
- 支持按 Task 1、Task 2 和模式筛选。
- 支持重新打开完整报告。
- 计算连续练习天数。
- 计算最近评分趋势。
- 显示今日素材完成度。
- 显示今日推荐题和开始按钮。
- 显示最近练习。
- 显示未完成草稿。

交付物：

- 首页数据面板。
- 历史列表。
- 历史详情。
- 趋势图。

完成条件：

- 修改题库不会改变旧报告。
- 历史搜索结果能回到完整内容。
- 有草稿时首页能继续练习。
- 首页只保留必要信息，不变成营销页。

---

## Phase 10：完成备份与迁移

目标：

确保本地数据可以完整迁移、恢复和长期保存。

需要完成：

- 导出完整 JSON 备份。
- 导出人类可读 Markdown。
- 导入 JSON 备份。
- 导入前验证版本和字段。
- 提供 Merge 和 Replace。
- 导入时排除 API Key 和环境设置。
- 处理旧版本备份。
- 提供清空数据确认。
- 显示备份统计数据。

交付物：

- 设置页面中的导出与导入。
- 版本化 JSON 备份。
- Markdown 历史归档。
- 清空本地数据流程。

完成条件：

- 导出再导入后，题目、素材、作文、评分和反馈保持等价。
- 导入失败不会部分破坏现有数据。
- 备份中不存在任何密钥。

---

## Phase 11：测试与交付

目标：

证明完整闭环真实可用，而不是只证明页面能打开。

需要完成：

- 测试 Markdown 解析。
- 测试题库导入导出。
- 测试本地匹配。
- 测试词数和半档计算。
- 测试草稿保存。
- 测试简易练习报告。
- 测试正式作文报告。
- 测试历史搜索。
- 测试备份恢复。
- 检查 360px 手机宽度。
- 检查桌面宽度。
- 检查键盘操作和焦点状态。
- 检查减少动画偏好。
- 检查 DeepSeek 未配置状态。
- 检查 API 失败状态。
- 启动本地服务进行真实浏览器流程验证。

交付物：

- 通过的自动测试。
- 一次完整端到端练习记录。
- 已知限制清单。
- 可运行的本地网页。

完成条件：

- V1 的 12 条 Success Criteria 全部满足，或明确列出未能满足项和原因。
- 没有伪造测试结果。
- 没有把未验证项描述为已验证。

---

## 阶段停止规则

- Phase 0–2 完成前，不调用 DeepSeek。
- Phase 1 未稳定前，不用临时字符串结构保存正式数据。
- Phase 4 未完成前，不做首页评分趋势。
- Phase 5 未完成前，不做复杂推荐动画。
- Phase 6 未完成前，不做漂亮报告页。
- Phase 7 未通过结构校验前，不保存评分。
- Phase 9 未完成前，不声称“历史系统完成”。
- Phase 10 未验证恢复前，不声称“数据安全”。
- Phase 11 未完成前，不把版本称为 V1 已完成。

---

## 工作流 1：每日素材与单题匹配

第一步：输入当天内容

```markdown
## 今日词伙
- tangible benefits: 实际好处；可数名词短语
- curb emissions: 减少排放

## 今日句式
- while concession: While X..., Y...
- not only inversion: Not only does X..., but it also...
```

第二步：解析素材

- 同时接受中文冒号和英文冒号。
- 每条非空 bullet 生成一个素材记录。
- 保留原始输入和标准化副本。
- 解析失败时提示具体行，不静默丢弃。

第三步：匹配一道题

匹配时依次考虑：

1. 主题是否兼容。
2. 写作功能是否兼容。
3. 词伙能否在该语境中自然使用。
4. 句式是否适合该题型。
5. 正式程度和难度是否合适。
6. 最近是否重复练习。

返回：

- 一道推荐题目。
- 选择理由。
- 置信度。
- 无法自然覆盖的素材。

DeepSeek 不可用时，使用本地关键词和标签规则，并明确标记为启发式推荐。

第四步：选择练习模式

简易练习：

- 限时可选，由用户决定。
- 目标 80–150 词。
- 重点检查目标词伙和句式。
- 使用 Daily Practice Rubric。

正式作文：

- 限时可选。
- Task 1 正常不少于 150 词。
- Task 2 正常不少于 250 词。
- 使用 IELTS Writing Rubric。

第五步：写作

- 提供主编辑区、实时词数、可选计时器和目标素材清单。
- 不把目标词句变成填空练习。
- 自动保存草稿。
- 刷新、切换页面或接口失败都不能丢失草稿。

第六步：提交评估

- 显示明确的“正在评估”状态。
- 不伪造精确进度百分比。
- 失败时保留原文并允许重试。

第七步：保存历史

保存：

- 日期、题型、模式、题目和素材快照。
- 用户原文、词数和用时。
- 评分、使用检查、反馈和修改示范。
- Rubric 版本和模型版本。

---

## 工作流 2：题库管理

题库标准格式：

```markdown
## Task 2

### Free University Education

- Topic: Education
- Kind: Discuss both views
- Tags: university, funding, students, government
- Source: Internal IELTS-style practice prompt

Some people believe...
```

支持：

- 导入前预览和验证。
- Merge 和 Replace。
- Task 1 / Task 2 分组。
- 搜索、筛选、编辑、归档。
- Markdown 导出。
- 记录最近使用和从未使用的题目。

题库中的写作练习题为内部改编题，不声称是官方真题或逐字真题。

Task 1 的图表数据必须来自合法材料，不能由应用自行伪造真实数据。

---

## 工作流 3：简易练习评分

日常练习评分与 IELTS 正式评分分开。

满分：10 分。

| 项目 | 分数 | 检查内容 |
|---|---:|---|
| Task Coverage | 0–2 | 双方观点、个人立场和任务要求 |
| Idea Clarity | 0–2 | 观点是否相关、具体、容易理解 |
| Organization | 0–2 | 句子和观点之间是否有清晰逻辑 |
| Word Choice | 0–2 | 词汇、搭配、词性和语境是否自然 |
| Sentence Control | 0–2 | 主干、谓语、句子边界和主谓一致 |

评分定义：

```text
2 = 完成且自然
1 = 部分完成，但需要修正
0 = 未完成、无法理解或明显误用
```

输出：

- Daily Practice Score。
- 五项小分。
- Target Vocabulary Usage。
- Target Pattern Usage。
- One Sentence Diagnosis。
- Task Coverage。
- Core Ideas。
- Sentence Issues。
- Teacher Corrections（基础自然版 + IELTS 进阶版）。
- Sentence Revision Answers。
- Minimal Rewrite。
- Revision Rounds。
- Review Status。

Usage Tracker 只说明是否使用、用对、用得自然，不直接改变 IELTS Band。
今日目标词句不再是五项 Rubric 中的评分项。

---

## 工作流 4：正式作文评分

Task 1：

```text
Task Achievement
Coherence and Cohesion
Lexical Resource
Grammatical Range and Accuracy
```

Task 2：

```text
Task Response
Coherence and Cohesion
Lexical Resource
Grammatical Range and Accuracy
```

计算：

```text
raw = (task + coherence + lexical + grammar) / 4
estimated_band = round_to_nearest_half_band(raw)
```

每项必须包含：

- Estimated Band。
- 用户原文证据。
- Why this band。
- Main limitation。

最终输出：

- Estimated Band Range。
- 四项评分。
- One Priority Fix。
- Minimal Rewrite Demonstration。
- Next Revision Task。
- Rubric 和模型版本。

---

# Resources 1 — 评分标准

## 日常写作练习评分系统

主文件：

```text
data/reference/日常写作练习评分系统.md
```

关键边界：

- 不输出 IELTS Band。
- 不替用户写完整答案。
- Usage Tracker 与正式 Band 完全分开。
- 只给一个 Priority Fix。

## 雅思正式写作评分系统

主文件：

```text
data/reference/雅思正式写作评分系统.md
```

关键来源：

```text
https://www.ielts.org/take-a-test/your-results/ielts-scoring-in-detail
```

规则：

- 不将 AI 分数描述为官方结果。
- 四项等权。
- 每项先引用证据。
- 保留 `rubric_source`、`rubric_version` 和 `retrieved_date`。
- YouTube 内容只作为学习参考，不参与数值评分。

---

# Resources 2 — 题库

主文件：

```text
data/reference/IELTS写作口语题库.md
```

V1 使用范围：

- IELTS Academic Writing Task 1：20 题。
- IELTS Writing Task 2：20 题。
- Speaking 题库暂不进入 V1。

Task 1 类型：

```text
Line Graph
Bar Chart
Pie Chart
Table
Process Diagram
Maps
```

Task 2 主题：

```text
Education
Technology
Environment
Health and Society
Work and Government
```

---

# Resources 3 — 产品与界面

## 产品架构

主导航：

```text
首页
题库
练习
历史
设置
```

## 首页

参考学习追踪面板约 70% 的结构与密度：

- 今日日期与状态。
- 今日词伙数量。
- 今日句式数量。
- 今日唯一推荐题。
- 开始或继续按钮。
- 连续练习天数。
- 近期评分趋势。
- 最近练习列表。

## 核心写作界面

参考最后一张图的专注和分阶段体验：

- 顶部显示当前题目和状态。
- 中间以写作编辑区为主。
- 下方显示词数、计时器和提交。
- 提交后切换为评估中状态。
- 完成后进入报告。

## 视觉语言

- 主色：紫色。
- 文字：深色 ink。
- 信息面：低饱和 lilac。
- 正确和完成：绿色。
- 注意和复习：琥珀色。
- 错误和危险：红色。

避免：

- 嵌套卡片。
- 装饰性渐变球。
- 营销页式 Hero。
- 大面积单一紫色。
- 只靠颜色表达状态。
- 移动端文字重叠。

---

# AI 契约

`POST /api/evaluate`

请求：

```json
{
  "mode": "simple",
  "taskType": "task2",
  "prompt": "",
  "responseText": "",
  "materials": [],
  "wordCount": 0,
  "durationSeconds": 0
}
```

要求：

- 模型只返回 JSON。
- 服务端负责校验和归一化。
- 首次 JSON 解析失败可修复一次。
- 再次失败则保存失败状态，不丢失作文。
- 不渲染模型返回的 HTML。
- 保存 `rubricVersion` 和 `modelVersion`。
- 简易练习使用 `daily-v0.2`，旧报告继续按 `daily-v0.1` 兼容显示。
- 基础评分不得返回完整长范文。

`POST /api/learning-extension`

这个接口只在用户主动点击“进阶学习”时调用。

输出：

```json
{
  "type": "daily-learning-extension",
  "wordCount": 0,
  "improvedVersion": "",
  "disclaimer": "",
  "functions": [],
  "transferTask": {},
  "rubricVersion": "learning-v0.1",
  "modelVersion": ""
}
```

要求：

- 完整改写不改变原练习评分。
- 拆解引言、双方观点、理由发展、个人立场和结论。
- 每项必须引用完整范文中的真实句子。
- 用户提取结构后才显示参考万能表达。
- 结果按 `attemptId` 缓存并进入本地备份。
- 进阶学习从前四项中加权随机抽取一个作为本次深拆目标。
- 迁移练习使用 50–80 词，并检查本次抽取的结构、立场和理由。

`POST /api/revision-check`

用于基础练习的反复修改。

要求：

- 比较原稿和用户修改稿。
- 检查立场、理由或结果、句子自然度和目标修正是否完成。
- 基础通过标准是清楚、语法正确、母语者容易理解，不要求达到 Band 7。
- 传入 IELTS 进阶标准，但只作为可选升级，不阻塞基础通过。
- 未通过时返回剩余问题和最小修改，不重写整篇。
- 所有修改轮次保存到 `revisionSessions` 并进入备份。

---

# Agent Behavior — 做任何任务的 7 步流程

1. Understand the objective — 先确认任务目标。
2. Ask clarifying questions if needed — 关键信息不足时先问。
3. Create a plan — 复杂任务先给出计划。
4. Execute step by step — 按计划逐步执行。
5. Review the output — 检查行为和界面。
6. Improve weak areas — 修复发现的问题。
7. Deliver the final result — 交付可运行结果和验证结论。

三条“永不 / 总是”：

- Never skip planning for complex tasks — 复杂任务绝不跳过计划。
- Never fabricate a score, source, quote, or successful test — 绝不伪造评分、来源、引用或测试结果。
- Always preserve user data, drafts, and project changes — 永远保护用户数据、草稿和已有改动。

---

# Success Criteria — 什么算做好了

V1 做好时，用户能够：

1. 在本地运行网页。
2. 导入或创建 Task 1 和 Task 2 题库。
3. 按 Markdown 输入当天词伙和句式。
4. 得到一道自然匹配的推荐题及理由。
5. 选择简易练习或正式作文。
6. 使用自动保存编辑器、词数统计和可选计时器。
7. 通过服务端安全调用 DeepSeek。
8. 简易练习得到 10 分制反馈，正式作文得到四项 Band 估算。
9. 看到目标词句的使用质量、证据和修改示范。
10. 搜索历史并重新打开完整报告。
11. 导出并恢复全部本地数据。
12. 在手机和桌面上完成整个流程，草稿不丢失、文字不重叠。
