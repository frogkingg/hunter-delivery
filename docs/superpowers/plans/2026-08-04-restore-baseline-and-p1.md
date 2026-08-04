# 恢复基线 + P1 体验主线 实现计划（2026-08-04）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划（本会话内联执行，任务间无并行）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** P0 恢复可交付基线（智能填充入口 + 全量测试全绿 + 版本对齐 1.3.0），随后按「一键填充 → 点击字段填充 → 增量续填」实现 P1 体验主线。

**背景（已核实）：** 工作区在 8-4 有一批未提交"半回滚"改动（已固化进分支 WIP 基线提交 `530595a`）：删除了智能填充入口、版本退回 1.1.1、回退了批量投递/队列/背景实现，导致 15 项测试失败。同时存在 8-3 晚的智能填充核心"新工作"（`src/fill-ui.js`/`src/fill-content.js`/`src/matcher.js`/`src/state.js` 等 + 对应测试），需要保留。

**文件分阶段归属（据此决定恢复/保留）：**
- 阶段2（回退，恢复为 HEAD `d3d0a1b`）：`src/config.js`、`src/current-job.js`、`src/ai-client.js`、`src/render.js`、`src/queue.js`、`background.js`、`package.json`、`README.md`、`test/shared.test.js`。
- 阶段2但需在 HEAD 基础上重建：`panel.html`（智能填充 section 需按新版 fill-ui.js DOM 契约）、`panel.css`（HEAD 填充样式 + 新编辑器类）、`src/app.js`（恢复 `initFillUi`/`refreshFillUi` 导入与调用）。
- 阶段1（保留）：`src/fill-ui.js`、`src/fill-content.js`、`src/matcher.js`、`src/resume-fields.js`、`src/site-templates.js`、`src/form-fields.js`、`src/fill-log.js`、`src/state.js`、`lib/shared.js`、`test/panel-smoke.test.js`、`test/fill-content-integration.test.js`、`test/config-integration.test.js`、`tests/matcher.test.js`、`tests/resume-fields.test.js`。

**架构：** 智能填充 UI 仍在侧边栏（`panel.html` → `src/app.js` → `src/fill-ui.js`）；执行引擎仍为按需注入的 `fill-content.js`（SMART_FILL_SCAN/APPLY/PREPARE/HIGHLIGHT/CANCEL 消息协议，`chrome.runtime` 中继）；P1 三个特性全部落在 UI 编排层与执行层，不新增权限、不上云端、不改 BOSS 主流程。

**技术栈：** Chrome MV3、ESM、node:test（Node 26）、jsdom（仅测试 devDep）、Rollup。

**Git：** 分支 `codex/restore-baseline-p1`（已建）；每个任务一个 commit，中文 Conventional Commits。

---

## P0：恢复可交付基线

### 任务 1：恢复阶段2回退的实现/配置文件

**文件：** `src/config.js`、`src/current-job.js`、`src/ai-client.js`、`src/render.js`、`src/queue.js`、`background.js`、`package.json`、`README.md`、`test/shared.test.js`

- [ ] **步骤 1**：从 HEAD 恢复上述文件：`git checkout d3d0a1b -- <files>`
- [ ] **步骤 2**：`npm install`（恢复 jsdom 声明；node_modules 已含 jsdom，仅同步 lock）
- [ ] **步骤 3**：运行 `npm run check && npm test`，记录当前失败集合（预期 background-integration/config-integration 失败数大幅下降）
- [ ] **步骤 4**：Commit：`chore: 恢复批量投递/队列/配置实现至 v1.3.0 基线（P0 任务1）`

### 任务 2：恢复智能填充入口（panel.html + app.js + panel.css）

**文件：** `panel.html`、`src/app.js`、`panel.css`

新版 `src/fill-ui.js` 依赖的 DOM 契约（panel.html 智能填充 section 必须包含）：
- 容器：`smartFillMain`、`resumeFieldsEditor`（互斥显隐，`openResumeFieldsEditor`/`closeResumeFieldsEditor` 控制）
- 控件 id：`fillProfileSelect`、`manageResumeFields`、`closeResumeFieldsEditor`、`discardResumeFields`、`saveResumeFields`、`extractResumeFields`、`resumeFieldsStatus`、`resumeFieldsSummary`、`resumeFieldsList`、`scanFillPage`、`prepareFillSections`、`clearFill`、`fillSelected`、`fillAll`、`stopFill`、`fillProgress`、`fillAiToggle`、`fillTemplateToggle`、`fillResultList`、`fillCurrentSite`、`fillTemplateInfo`、`deleteFillTemplate`、`fillTemplateList`、`fillLogList`
- 数据属性/类：`[data-resume-key]`、`[data-entry-group]`、`[data-add-entry]`、`[data-entry-input]`、`[data-entry-id]`、`[data-remove-entry]`、`[data-resume-filter]`、`.resume-fields-grid`、`.resume-entry-card`、`.resume-scalar-group`、`.resume-entries-group`、`.resume-entry-count`、`.fill-row-main/.fill-row-label/.fill-meta`、`.fill-template-item`、`.fill-log-item`

- [ ] **步骤 1**：从 HEAD 恢复 `panel.html`、`panel.css`、`src/app.js` 后，在 panel.html 中重建智能填充 section（tab 按钮 + `smartFillMain` 主视图 + `resumeFieldsEditor` 编辑器视图），补齐上表全部 id/属性；`src/app.js` 恢复 `initFillUi`/`refreshFillUi` 导入与调用；panel.css 补 `.resume-fields-grid` 等新类样式（若 HEAD 无）
- [ ] **步骤 2**：`node --check src/app.js && npm run check`
- [ ] **步骤 3**：运行 `node --test test/panel-smoke.test.js`，确认 3 项 panel-smoke 通过
- [ ] **步骤 4**：Commit：`fix(智能填充): 恢复侧边栏智能填充入口与新资料编辑器视图（P0 任务2）`

### 任务 3：修绿剩余测试（TDD）

**文件：** 按失败定位，可能涉及 `src/fill-ui.js`、`src/config.js`、`test/*`

- [ ] **步骤 1**：运行 `npm test`，列出剩余失败（预期集中在 config-integration switchProfile / panel-smoke 细节）
- [ ] **步骤 2**：对每个失败，先写/确认失败测试（红灯），再改实现（绿灯），不允许为迁就测试而删除断言
- [ ] **步骤 3**：`npm run check && npm test && npm run build` 全绿（230/230 或全量当前总数）
- [ ] **步骤 4**：Commit：`fix: 修绿全量测试（P0 任务3）`

**P0 验收：** 侧边栏可完成 扫描→预览→修正→填充→停止→重扫；`npm run check && npm test && npm run build` 全绿；`package.json`/`manifest.json` 版本均为 1.3.0。

---

## P1：体验主线

### 任务 4：一键智能填充（默认模式）

**行为：** 新增「智能填充」主按钮：点击后 扫描 → 规则/AI 匹配 → 自动勾选高置信（match）项 → 自动填充高置信项；低置信/manual 项保留预览确认。保留现有「预览后填充」开关（默认开=一键模式）。

**文件：** `src/fill-ui.js`（新 `runSmartFillOnce()` + 绑定 + 模式开关）、`src/state.js`（`fillOneClick` 配置）、`panel.html`（主按钮 + 模式开关）、`test/panel-smoke.test.js`

**测试用例：**
- `runSmartFillOnce` 在无网申页面授权时提示授权且不填充
- 高置信 match 项被自动填充、manual 项不被填充且保留在列表
- 一键模式关闭时按钮行为回退为仅扫描+预览
- 填充后 `fillProgress` 显示汇总（成功/失败数）

- [ ] 红灯：新增上述测试并确认失败 → 绿灯：实现 → 回归 → Commit：`feat(智能填充): 一键智能填充（P1 任务4）`

### 任务 5：点击字段填充

**行为：** 侧边栏简历字段旁「填入页面」按钮 → 进入拾取态（目标输入框高亮 + 全局点击监听）→ 点击页面目标后单字段填充并回读校验；可 Esc 取消。

**文件：** `src/fill-ui.js`（拾取态状态机 + 高亮 + 单字段填充调用）、`fill-content.js`（新增 `SMART_FILL_FILL_FIELD` 单字段执行消息，复用 `apply`/`resolveEntryTarget` 与回读）、`background.js`（消息中继透传）、`test/fill-content-integration.test.js`、`test/panel-smoke.test.js`

**测试用例：**
- `fill-content.js`：`SMART_FILL_FILL_FIELD` 对合法 fieldId 单字段填充成功并回读一致；对 stale fieldId 返回 STALE_FIELD；DUPLICATE_TARGET 语义沿用
- `fill-ui.js`：拾取态开启后点击页面元素触发填充；Esc 取消；目标不是可填控件时提示且不填充

- [ ] 红灯 → 绿灯 → 回归 → Commit：`feat(智能填充): 点击字段填充（P1 任务5）`

### 任务 6：增量续填（MutationObserver）

**行为：** 填充成功后启用 `MutationObserver`（form root，80~150ms debounce，只扫描变化子树）；检测到新增未填字段 ≥4 时显示「继续填写」提示，点击后仅填充新增字段（按已处理标记去重）；上限 3 轮、每轮间隔 ≥600ms；不使用轮询、不自动点击"新增经历"按钮。

**文件：** `fill-content.js`（`markScanned`/`collectUnscanned`/observer 引擎）、`src/fill-ui.js`（提示与「继续填写」动作）、`src/state.js`、`test/fill-content-integration.test.js`（jsdom 夹具：DOM 新增后仅填新增）

**测试用例：**
- 填充后新增 4 个字段 → 触发「继续填写」提示
- 点击继续后仅填充新增字段，已处理字段不被重填
- 新增字段 <4 不提示；第 4 轮不再继续
- 观察器在停止/取消时正确断开

- [ ] 红灯 → 绿灯 → 回归 → Commit：`feat(智能填充): 增量续填与新字段提示（P1 任务6）`

---

## 最终验收与收尾

- `npm run check && npm test && npm run build` 全绿
- 真站测试手册追加：一键填充 / 点击字段填充 / 增量续填 用例（1 个原生表单 + 1 个 antd 表单）
- 使用 finishing-a-development-branch 技能向用户呈现收尾选项
