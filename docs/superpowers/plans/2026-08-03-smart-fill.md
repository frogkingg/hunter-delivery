# 智能填充（Smart Fill）实现计划 — v1.3.0

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划（本会话内联执行 + 并行子代理）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 为猎投扩展新增智能填充主功能：网申页扫描 → 简历匹配 → 侧边栏预览/修改 → 一键填充，含站点模板记忆与填充日志。

**架构：** 纯函数模块（`src/*.js`，Node 可测）+ 自包含 classic content 脚本（`fill-content.js`）+ background 中继 + 侧边栏新 tab。匹配优先级：用户编辑 > 模板 > 规则 > AI。

**技术栈：** Chrome MV3、ESM、node:test（Node 26）、jsdom（仅测试 devDep）。

**Git：** 分支 `codex/smart-fill`；每个任务一个 commit，中文 Conventional Commits。

---

## 冻结契约（所有任务必须遵守，禁止改动）

### FieldDescriptor
```js
{ id, type, label, rawLabel, labelSource, path, required, options, value, skipped }
```
- type ∈ `text|tel|email|number|date|textarea|select|radio|checkbox|custom-select|custom-date`
- path = 唯一 CSS 选择器（含标签/结构定位，可含 `:nth-of-type` 链）

### 匹配结果（src/matcher.js）
```js
matchFields(fields, resumeFields, options = {}) -> Promise<MatchResult[]>
// MatchResult = { fieldId, fieldKey, value, confidence, source, status, reason }
// options = { aiMatch: boolean, aiCall?: async (messages, maxTokens, jsonMode) => {text, data?} }
// source ∈ template|rule|ai|manual; status ∈ match|skip|manual
// confidence ∈ high|medium|low|null
```
`matchRules(fields, resumeFields) -> MatchResult[]`（同步纯函数）；`applyAiResults(matches, aiJson) -> MatchResult[]`；`buildAiMatchPrompt(needsMatch, resumeFields) -> messages[]`；`RESUME_FIELD_LABELS`（key→中文名，UI 用）。

### 简历字段（src/resume-fields.js）
```js
extractResumeFieldsLocal(text) -> resumeFields            // 同步纯函数
buildResumeExtractPrompt() -> messages[]                  // AI 提取 prompt
mergeResumeFields(local, ai) -> resumeFields              // 同步纯函数，ai 覆盖复杂字段
RESUME_FIELDS_SCHEMA = [{ key, label, type, keywords }]   // 30 项，供 UI 渲染
```
resumeFields 形如 `{ name, phone, email, gender, birthDate, idCard, hometown, currentCity, address, postcode, school, degree, major, graduationYear, workYears, currentCompany, currentTitle, expectedCity, expectedSalary, expectedPosition, selfEvaluation, skills, languages, hobbies, availableTime, referral, github, linkedin, politicalStatus, maritalStatus, portfolio }`（均为字符串，缺失为 `""`）。

### 站点模板（src/site-templates.js）
```js
applyTemplate(matches, template) -> MatchResult[]          // 同步纯函数
saveTemplateFromResults(host, origin, matches, existingTemplate) -> template
buildTemplateFromMatches(host, origin, matches) -> template
capTemplates(templates) -> templates                        // 对象 { [host]: template }，上限 50，LRU 淘汰最旧
TEMPLATE_MAX = 50
```

### 填充日志（src/fill-log.js）
```js
appendFillLog(logs, entry) -> logs   // 上限 200，新条目在前
summarizeResults(results) -> { total, ok, failed }
LOG_MAX = 200
```

### 消息协议（src/messages.js 追加，background.js 中继）
- `SMART_FILL_SCAN` panel→content：`{}` → `{ ok, fields, page:{title,url,host} }`
- `SMART_FILL_APPLY` panel→content：`{ fills:[{id,value}] }` → `{ ok, results:[{id,ok,error?}] }`
- `SMART_FILL_HIGHLIGHT` panel→content：`{ ids:[string], on:boolean }` → `{ ok }`
- `SMART_FILL_CANCEL` panel→content：`{}` → `{ ok }`
- `SMART_FILL_PROGRESS` content→panel 事件：`{ index, total, id, ok, error? }`
- background 新增 `sendToTabWithScript(tabId, message, file)`；SMART_FILL_* 走 `fill-content.js` 注入中继。

### fill-content.js 对外（测试用，暴露到 globalThis）
```js
globalThis.__hunterFill = {
  scan(document) -> { fields, page },          // 同步
  apply(fills, { document, onProgress, delayMs=100, signal }) -> Promise<results>,
  highlight(ids, on, document),               // class: hunter-fill-highlight
  reset(document),                            // 清除高亮与内部元素表
}
```

### 面板 storage key
`smartFillTemplates`（host→template）、`smartFillLogs`（数组）、profile.resumeFields（随 profiles 存储）。

---

## 文件清单

- 新增：`src/form-fields.js`、`src/matcher.js`、`src/resume-fields.js`、`src/site-templates.js`、`src/fill-log.js`、`src/fill-ui.js`、`fill-content.js`
- 新增测试：`tests/form-fields.test.js`、`tests/matcher.test.js`、`tests/resume-fields.test.js`、`tests/site-templates.test.js`、`tests/fill-log.test.js`、`test/fill-content-integration.test.js`
- 新增夹具：`test/fixtures/zhilian.html`、`test/fixtures/moka.html`、`test/fixtures/beisen.html`、`test/fixtures/dayi.html`、`test/fixtures/antd-generic.html`
- 修改：`src/messages.js`、`background.js`、`manifest.json`、`package.json`、`panel.html`、`panel.css`、`src/app.js`、`src/config.js`、`src/state.js`、`README.md`
- 文档：`docs/智能填充使用说明.md`、`docs/智能填充真站测试手册.md`、`docs/智能填充测试报告.md`

---

### 任务 1：字典与归一化（form-fields.js）

**文件：** 创建 `src/form-fields.js`；测试 `tests/form-fields.test.js`

- [ ] 步骤 1：写失败测试——`normalizeLabel`（去 `*`/必填/空白/全角空格/`（）` 噪音）、`classifyControl`（tag+type+class → 类型）、`CANONICAL_FIELDS` 含 30 个 key 且每个有关键词。
- [ ] 步骤 2：运行确认失败（`node --test tests/form-fields.test.js`）。
- [ ] 步骤 3：实现（纯函数 + 字典，见契约；关键词表见规格 4.3）。
- [ ] 步骤 4：全绿；`node --check src/form-fields.js`。
- [ ] 步骤 5：Commit `feat(智能填充): 字段字典与标签归一化`

### 任务 2：匹配引擎（matcher.js）+ 数据集

**文件：** 创建 `src/matcher.js`、`tests/matcher.test.js`、`tests/data/matcher-dataset.js`

- [ ] 步骤 1：写失败测试——数据集 ≥200 条（关键词×模板组合生成 + 5% 噪音标签）；断言常见字段命中 ≥95%、总体 ≥85%；`applyAiResults` 合并；`buildAiMatchPrompt` 结构；AI 失败降级为 manual。
- [ ] 步骤 2：确认失败。
- [ ] 步骤 3：实现 `matchRules`（关键词子串命中按长度+类型兼容打分）、`applyAiResults`、`buildAiMatchPrompt`、`RESUME_FIELD_LABELS`。
- [ ] 步骤 4：全绿。
- [ ] 步骤 5：Commit `feat(智能填充): 规则匹配引擎与 AI 兜底编排`

### 任务 3：简历字段提取（resume-fields.js）

**文件：** 创建 `src/resume-fields.js`；测试 `tests/resume-fields.test.js`

- [ ] 步骤 1：失败测试——本地正则：手机 `1[3-9]\d{9}`、邮箱、姓名（首非空短行）、出生日期（YYYY-MM/年）、性别（男/女）、院校/学历/专业（教育经历段）、期望薪资；`mergeResumeFields` 复杂字段以 AI 为准、常见字段本地为准；`RESUME_FIELDS_SCHEMA` 30 项。
- [ ] 步骤 2：确认失败 → 实现 → 全绿。
- [ ] 步骤 3：Commit `feat(智能填充): 简历结构化字段提取`

### 任务 4：站点模板与填充日志（site-templates.js + fill-log.js）

**文件：** 创建 `src/site-templates.js`、`src/fill-log.js`；测试 `tests/site-templates.test.js`、`tests/fill-log.test.js`

- [ ] 步骤 1：失败测试——模板套用（标签匹配、值覆盖、source=template）、模板构建、50 站点 LRU 上限、日志 200 条上限、摘要统计。
- [ ] 步骤 2：确认失败 → 实现 → 全绿。
- [ ] 步骤 3：Commit `feat(智能填充): 站点模板记忆与填充日志`

### 任务 5：填充引擎（fill-content.js）

**文件：** 创建 `fill-content.js`；集成测试 `test/fill-content-integration.test.js`（jsdom，eval 真实脚本）

- [ ] 步骤 1：写失败测试（jsdom 起 5 个夹具中最简单的 antd-generic.html）——`__hunterFill.scan` 识别 ≥90% 控件（含 label 提取、radio 分组、select options）；`apply` 对 text/select/radio/checkbox/textarea 填充并回读校验；`highlight` 加类；`reset` 清理。
- [ ] 步骤 2：确认失败（缺 jsdom 依赖先 `npm i -D jsdom`，需网络提权）。
- [ ] 步骤 3：实现 fill-content.js：扫描（可见性过滤、label 优先级、radio 按 name 分组、custom-select/custom-date 检测）、apply（原型 setter + input/change/blur、select 设值、radio 点击、checkbox 布尔、自定义下拉点击+选项匹配+超时回退、100 ms 间隔、signal 取消、逐字段 onProgress、回读校验）、highlight/reset、消息监听（chrome 缺失时静默）。
- [ ] 步骤 4：集成测试全绿。
- [ ] 步骤 5：Commit `feat(智能填充): 网申表单扫描与填充执行引擎`

### 任务 6：夹具 HTML ×5

**文件：** `test/fixtures/{zhilian,moka,beisen,dayi,antd-generic}.html`

- [ ] 步骤 1：编写 5 个代表性网申表单 HTML（真实类名结构：`.form-item`/`.ant-form-item`/`.el-form-item`、label for/wrap、radio 组、select、textarea、必填 `*`、placeholder）。
- [ ] 步骤 2：扩展集成测试到 5 个夹具：识别率 ≥90%（每个夹具断言控件总数与识别数比例）、常见字段匹配 ≥95%（匹配用 resume 样本）、填充成功。
- [ ] 步骤 3：Commit `test(智能填充): 5 个网申平台表单夹具`

### 任务 7：消息协议 + background 中继 + manifest

**文件：** 修改 `src/messages.js`、`background.js`、`manifest.json`、`package.json`

- [ ] 步骤 1：messages.js 追加 5 个 SMART_FILL_* 类型（含 payload/response 注释）。
- [ ] 步骤 2：background.js 加 `sendToTabWithScript` 与中继分支（SMART_FILL_* 注入 fill-content.js）；保持现有 sendToTab 行为。
- [ ] 步骤 3：manifest.json version → 1.3.0；package.json version → 1.3.0；`check` 脚本加入 `fill-content.js`、`src/form-fields.js`、`src/matcher.js`、`src/resume-fields.js`、`src/site-templates.js`、`src/fill-log.js`、`src/fill-ui.js`；devDependencies 增加 `jsdom`。
- [ ] 步骤 4：`npm run check && npm test` 回归。
- [ ] 步骤 5：Commit `feat(智能填充): 消息协议与按需注入中继`

### 任务 8：面板 UI（智能填充 tab）

**文件：** 修改 `panel.html`、`panel.css`、`src/app.js`、`src/config.js`、`src/state.js`；创建 `src/fill-ui.js`

- [ ] 步骤 1：panel.html 加 tab「智能填充」（data-tab=smartfill）+ 页面：简历选择、简历字段折叠区（提取按钮）、扫描区（当前站点 + 申请权限 + 扫描）、匹配列表（勾选/标签/类型徽标/值输入/置信度/来源/状态）、操作按钮（填充选中/全部/停止/清空）、AI 开关 + 模板开关、模板管理、历史列表、隐私提示。
- [ ] 步骤 2：state.js 增加 `fillMatches`、`fillScanPage`、`smartFillAiEnabled`、`smartFillTemplateEnabled` 状态与 setter；config.js 的 profile 增加 `resumeFields` 默认值。
- [ ] 步骤 3：fill-ui.js 实现：扫描（activeTab → 校验 https/http → `chrome.permissions.request` 站点授权 → 经 background 中继扫描 → matchFields（模板优先套用）→ 渲染）、匹配列表渲染与值编辑、填充（勾选/全部 → SMART_FILL_APPLY + 进度 → 保存模板 + 日志）、停止、清空、模板查看/删除、历史渲染、AI 提取简历字段。
- [ ] 步骤 4：app.js 接入 init 与事件绑定；CSS 复用现有 class + 少量新增。
- [ ] 步骤 5：`npm run check && npm test` 回归；Commit `feat(智能填充): 侧边栏智能填充交互界面`

### 任务 9：文档

**文件：** `docs/智能填充使用说明.md`、`docs/智能填充真站测试手册.md`、`docs/智能填充测试报告.md`（初版）、`README.md`

- [ ] 步骤 1：使用说明（安装/配置/扫描/预览/填充/模板/日志/隐私）。
- [ ] 步骤 2：真站测试手册（步骤 + 反馈表，≥5 站）。
- [ ] 步骤 3：测试报告初版（夹具结果占位 + 修复记录表 + 真站反馈表）。
- [ ] 步骤 4：README 功能特性新增「智能填充」章节。
- [ ] 步骤 5：Commit `docs: 智能填充使用说明与测试手册`

### 任务 10：全量验证与收尾

- [ ] 步骤 1：`npm run check && npm test` 全绿；修复问题并记录到测试报告。
- [ ] 步骤 2：`requesting-code-review` 技能走查；修复 [必须修复]。
- [ ] 步骤 3：bump 版本已就绪（任务 7）；`verification-before-completion` 复核验收标准映射（识别率/匹配率/流畅度/浏览器）。
- [ ] 步骤 4：Commit 收尾 + tag `v1.3.0`。
