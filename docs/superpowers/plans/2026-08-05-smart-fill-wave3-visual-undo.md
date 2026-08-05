# 智能填充 Wave 3：绿/橙双色核对 + 撤销填充 实现计划（2026-08-05）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** (1) 填充完成后页面字段按结果着色：成功=绿、需人工/失败=橙，用户无需切面板即可核对全表；(2) 面板新增「撤销本次填充」，恢复填充前原值并清除着色；(3) 面板点击结果行可滚动到页面字段。

**架构：** 着色复用 `fill-content.js` 现有 `highlight` 机制扩展状态 class（`hunter-fill-done`/`hunter-fill-pending`）；`apply` 在填充前把每字段原值记入 `session.prevValues`，新增消息 `SMART_FILL_UNDO` 恢复原值并清标记；面板 `src/fill-ui.js` 加「撤销本次填充」按钮 + 图例，行点击调用现有滚动/高亮能力。样式加在 `panel.css`（图例）与 `fill-content.js` 注入样式（页面状态色）。

**技术栈：** Chrome MV3、自包含 classic 脚本、node:test + jsdom、Rollup。

**规格：** 依据 2026-08-05 调研结论（OpenJobAutofill 绿/橙双色标记；dw-chromegpt 逐字段视觉反馈；撤销=填充前已读原值，恢复即可）。

**Git：** 分支 `codex/smart-fill-hardening`。每个任务一个 commit，中文 Conventional Commits。

---

## 文件结构与职责

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `fill-content.js` | 执行引擎 | 修改：状态 class 着色、`prevValues` 记录、`SMART_FILL_UNDO` 处理、`SMART_FILL_APPLY` results 返回着色用 ok/failed 列表 |
| `src/fill-ui.js` | 面板编排 | 修改：撤销按钮、图例、行点击滚动、结果同步着色 |
| `panel.css` | 面板样式 | 修改：图例样式 |
| `test/fill-content-integration.test.js` | 引擎集成测试 | 修改：着色/撤销用例 |
| `test/panel-smoke.test.js` | 面板测试 | 修改：撤销按钮与图例用例 |

不修改：`src/matcher.js`、`src/form-fields.js`、`src/site-templates.js`、`src/messages.js`（UNDO 为新增消息类型，APPLY 复用现有结果结构）。

---

## 任务 1：页面绿/橙着色

**目标：** 填充后字段元素带状态 class；清空/重新扫描时清除。

**文件：** `fill-content.js`（修改）、`test/fill-content-integration.test.js`（修改）

- [ ] **步骤 1：新增红灯测试**

在 `test/fill-content-integration.test.js` 追加：

```js
test("填充后页面着色：成功字段 done、失败字段 pending", async () => {
  const dom = loadFixture("zhilian.html");
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  const res = await dom.window.__hunterFill.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  assert.equal(res.ok, true);
  const el = doc.querySelector("[data-hunter-field]") || doc.querySelector("input[name='name']");
  assert.ok(el.classList.contains("hunter-fill-done"), "成功字段应有 done class");
  assert.ok(!el.classList.contains("hunter-fill-pending"));
  dom.window.__hunterFill.reset(doc);
  assert.ok(!el.classList.contains("hunter-fill-done"), "reset 后应清除着色");
  dom.window.close();
});
```

运行：`node --test test/fill-content-integration.test.js`
预期：FAIL——当前只有 `hunter-fill-highlight`，无 done/pending class。

- [ ] **步骤 2：实现着色**

`fill-content.js`：

1. 常量区新增：`const DONE_CLASS = "hunter-fill-done"; const PENDING_CLASS = "hunter-fill-pending";`
2. `ensureStyle` 的样式表追加：
```css
.hunter-fill-done { outline: 2px solid #16a34a !important; outline-offset: 1px; }
.hunter-fill-pending { outline: 2px solid #f59e0b !important; outline-offset: 1px; }
```
3. `apply` 中每个 fill 成功/失败后：对 `target` 元素 `classList.add(DONE_CLASS)` 或 `classList.add(PENDING_CLASS)`（同时移除另一状态与高亮）。
4. `reset(doc)` 中统一移除 `DONE_CLASS`/`PENDING_CLASS`/`HIGHLIGHT_CLASS`。
5. 面板「需人工处理」列表存在时，`SMART_FILL_HIGHLIGHT` 之外新增对 pending 字段的着色：在 `apply` 完成后对未填字段统一加 `PENDING_CLASS`（在 `SMART_FILL_APPLY` 响应处理里由面板下发 ids，或 content 内对 session 剩余 manual 字段直接着色——选 content 内直接着色，减少往返）。

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test test/fill-content-integration.test.js && npm run check && npm test`
预期：新增用例 PASS；全部回归 PASS。

- [ ] **步骤 4：Commit**

```bash
git add fill-content.js test/fill-content-integration.test.js
git commit -m "feat(智能填充): 页面绿/橙双色状态着色（Wave 3 任务 1）"
```

---

## 任务 2：撤销本次填充

**目标：** 面板「撤销本次填充」恢复所有已填字段原值并清除着色。

**文件：** `fill-content.js`（修改）、`src/messages.js`（修改）、`src/fill-ui.js`（修改）、`test/panel-smoke.test.js`（修改）

- [ ] **步骤 1：新增红灯面板测试**

在 `test/panel-smoke.test.js` 追加：初始化后面板存在「撤销本次填充」按钮且初始 disabled；点击后向 content 发送 `SMART_FILL_UNDO`（mock `chrome.tabs.sendMessage` 断言消息类型）。预期 FAIL（按钮不存在）。

- [ ] **步骤 2：content 记录原值 + UNDO 处理**

`fill-content.js`：

1. `apply` 的 `preflightFills` 之后、逐字段填充前，对每个 `target` 记录原值：`scanSession.prevValues = scanSession.prevValues || new Map(); scanSession.prevValues.set(target, { kind: entry.kind, before: entry.kind === "radio" || entry.kind === "checkbox" ? target.checked : target.value });`
2. 消息分支新增 `SMART_FILL_UNDO`：
```js
} else if (message.type === "SMART_FILL_UNDO") {
  const restored = [];
  for (const [target, record] of scanSession?.prevValues || []) {
    if (!target.isConnected) continue;
    if (record.kind === "radio" || record.kind === "checkbox") target.checked = record.before;
    else setNativeValue(target, record.before);
    target.classList.remove(DONE_CLASS, PENDING_CLASS, HIGHLIGHT_CLASS);
    restored.push(true);
  }
  if (scanSession) scanSession.prevValues = new Map();
  sendResponse({ ok: true, count: restored.length });
  return true;
}
```
3. `src/messages.js` 新增 `SMART_FILL_UNDO` 消息定义（panel→content，response `{ ok, count }`）。

- [ ] **步骤 3：面板撤销按钮**

`src/fill-ui.js`：智能填充结果工具条动态创建「撤销本次填充」按钮（填充成功后启用，清空/重新扫描后禁用）；点击后 `chrome.tabs.sendMessage({ type: "SMART_FILL_UNDO" })`，成功后清空面板结果并 toast「已撤销本次填充」。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/panel-smoke.test.js test/fill-content-integration.test.js && npm run check && npm test && npm run build`
预期：全部 PASS；新增集成用例（apply 后 UNDO 恢复原值）通过。

- [ ] **步骤 5：Commit**

```bash
git add fill-content.js src/messages.js src/fill-ui.js test/panel-smoke.test.js test/fill-content-integration.test.js
git commit -m "feat(智能填充): 撤销本次填充并恢复原值（Wave 3 任务 2）"
```

---

## 任务 3：图例 + 面板行点击滚动

**目标：** 面板展示绿/橙图例；点击结果行滚动到页面字段并短暂高亮。

**文件：** `src/fill-ui.js`（修改）、`panel.css`（修改）、`test/panel-smoke.test.js`（修改）

- [ ] **步骤 1：红灯测试**

`test/panel-smoke.test.js` 追加：渲染结果后存在 `.fill-legend`（含「已填/待人工」两个图例项）；点击某行触发 `chrome.tabs.sendMessage({ type: "SMART_FILL_HIGHLIGHT", ids:[fieldId], on:true })`。预期 FAIL（无图例、行无点击处理）。

- [ ] **步骤 2：实现**

1. `src/fill-ui.js` `renderFillMatches` 顶部渲染图例：
```js
const legend = `<div class="fill-legend"><span class="dot done"></span>已填<span class="dot pending"></span>待人工</div>`;
```
2. 结果行绑定点击：`row.onclick = () => { chrome.tabs.sendMessage({ type: "SMART_FILL_HIGHLIGHT", ids: [match.fieldId], on: true }); }`（复用现有高亮能力，并 `scrollIntoView` 已在 content 侧处理或发送 `SMART_FILL_SCROLL` 复用 `scrollIntoView`）。
3. `panel.css` 增加 `.fill-legend`、`.dot.done`（绿）、`.dot.pending`（橙）样式。

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test test/panel-smoke.test.js && npm run check && npm test && npm run build`
预期：全部 PASS。

- [ ] **步骤 4：Commit**

```bash
git add src/fill-ui.js panel.css test/panel-smoke.test.js
git commit -m "feat(智能填充): 面板图例与结果行点击定位（Wave 3 任务 3）"
```

---

## Wave 3 验收

- [ ] `npm run check && npm test && npm run build` 全绿，现有测试零回归
- [ ] 真站/夹具：填充后成功字段绿框、需人工字段橙框；`reset`/重新扫描后着色清除
- [ ] 撤销：apply 后点「撤销本次填充」恢复全部原值（含 select/radio/checkbox），着色清除
- [ ] 图例与行点击定位可用
- [ ] 安全不变量保持：UNDO 仅恢复本次 session 记录的原值，不触碰其他字段；fingerprint/scanId 校验不变
