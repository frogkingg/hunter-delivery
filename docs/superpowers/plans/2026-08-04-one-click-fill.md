# 智能填充「一键填充」简化实现计划（2026-08-04）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划（本会话内联执行，任务间按序推进）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 把智能填充页 6 个常驻按钮收敛为 1 个主按钮「一键智能填充」：点击后 扫描 → 自动展开经历 → 填充高置信项 → 折叠结果只突出需人工处理的项；「清空」「填充勾选项」按需出现。

**架构：** 只改面板 UI 与编排层（`panel.html` / `panel.css` / `src/fill-ui.js` / 面板测试），不改 `fill-content.js` 执行引擎与 `SMART_FILL_*` 消息协议。复用现有 `scanFillPage` / `prepareFillSections` / `runFill(false)` 函数，去掉对被删按钮的 DOM 依赖后重新编排成一键流程。

**技术栈：** Chrome MV3、ESM、node:test（Node 26）、jsdom（面板测试）、Rollup。

**规格：** `docs/superpowers/specs/2026-08-04-one-click-fill-design.md`（已批准）。

**Git：** 分支 `codex/one-click-fill`（已建，含规格提交）。每个任务一个 commit，中文 Conventional Commits。

---

## 文件结构与职责

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `panel.html` | 智能填充区按钮骨架 | 重构：单主按钮 + 清空链接 + 工具条按钮 |
| `panel.css` | 布局与样式 | 新增主按钮/清空链接/折叠组/工具条样式 |
| `src/fill-ui.js` | 面板编排 | 一键编排、按钮引用清理、折叠渲染 |
| `test/panel-smoke.test.js` | 面板冒烟 + 编排测试 | 更新 ids、新增一键展开/折叠/显隐用例 |

不修改：`fill-content.js`、`src/matcher.js`、`src/form-fields.js`、`src/site-templates.js`、`src/fill-log.js`、`src/resume-fields.js`、`src/state.js`（如需新状态用 fill-ui.js 模块级变量，避免动 state 契约）、`manifest.json`、`package.json`。

---

## 任务 1：面板按钮骨架 + 事件绑定收敛（红灯 → 绿灯）

**目标：** 顶部按钮区只剩主按钮；被删按钮的 DOM 引用全部清理，面板初始化不再抛错；行为暂不变（按钮功能靠后续任务升级）。

**文件：** `panel.html`、`panel.css`、`src/fill-ui.js`、`test/panel-smoke.test.js`

- [ ] **步骤 1：更新失败测试（红灯）**

修改 `test/panel-smoke.test.js` 第一个用例：

1. 初始化等待元素从 `scanFillPage` 改为 `smartFillOnce`（第 44 行附近）：
```js
const scan = window.document.getElementById("smartFillOnce");
if (scan && typeof scan.onclick === "function") break;
```
2. `ids` 数组（第 48 行附近）改为（删除 `scanFillPage`、`prepareFillSections`、`fillAll`，保留 `clearFill`/`fillSelected`）：
```js
const ids = ["analyze", "send", "addQueueTop", "generateQueue", "startQueue", "export", "saveConfig", "testApi", "parseResume", "clearFill", "extractResumeFields", "saveResumeFields", "manageResumeFields", "closeResumeFieldsEditor", "discardResumeFields", "smartFillOnce", "fillSelected", "deleteFillTemplate", "darkToggle"];
```

运行 `node --test test/panel-smoke.test.js`，预期：第一个用例 FAIL（`bindFillEvents` 对 `$("scanFillPage").onclick` 赋值时，元素不存在 → `$()` 返回 null → 抛 TypeError，app.js 初始化中断）。

- [ ] **步骤 2：实现——panel.html 按钮区重构**

`panel.html` 中智能填充「扫描网申页面」区域改为（删除 `scanFillPage`、`prepareFillSections`、`fillAll` 三个按钮；`clearFill` 移入站点行；`fillSelected` 移到列表下方工具条，初始隐藏）：

```html
<div class="fill-actions">
  <button id="smartFillOnce" class="primary">一键智能填充</button>
</div>
<p class="hint" id="fillCurrentSite">未检测到网申页面。请打开目标公司的网申/信息录入页后点击「一键智能填充」。首次使用需授权该网站。</p>
<div class="row fill-site-row"><span class="hint" id="fillCurrentSiteText"></span><button id="clearFill" class="clear-fill-link" hidden>清空</button></div>
<p id="fillProgress" class="hint" aria-live="polite"></p>
<div id="fillResultList" class="fill-result-list"></div>
<button id="fillSelected" class="primary fill-footer-btn" disabled hidden>填充勾选项（0）</button>
```

注意：`fillCurrentSite` 原来的职责（默认提示 + 扫描后站点信息）拆为两个元素——`fillCurrentSite` 保留默认提示文案，扫描后写入 `fillCurrentSiteText` 并在其行尾显示 `clearFill`。两个元素都用 `hint` 样式；`fill-site-row` 用于横排（左站点文本、右清空链接）。

- [ ] **步骤 3：实现——panel.css 样式**

`panel.css` 的 `.fill-actions` 由两列网格改为单列全宽主按钮，并追加：

```css
.fill-actions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.fill-actions button { width: 100%; padding: 10px; font-size: 14px; }
.fill-site-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fill-site-row .hint { margin: 0; flex: 1; }
.clear-fill-link { background: none; border: none; color: #6b7280; font-size: 12px; cursor: pointer; padding: 2px 4px; text-decoration: underline; }
.fill-footer-btn { width: 100%; margin-top: 8px; }
.fill-summary-manual, .fill-summary-done { margin-top: 8px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; }
.fill-summary-manual summary, .fill-summary-done summary { cursor: pointer; font-size: 13px; color: #374151; font-weight: 600; }
.fill-summary-done summary { color: #166534; }
.fill-done-tip { color: #166534; font-weight: 600; }
```

- [ ] **步骤 4：实现——fill-ui.js 清理被删按钮引用**

1. `bindFillEvents`（第 940 行附近）：删除三行绑定，其余保留：
```js
  $("smartFillOnce").onclick = () => runSmartFillOnce().catch(error => toast(error.message));
  $("clearFill").onclick = () => clearFill().catch(error => toast(error.message));
  $("fillSelected").onclick = () => runFill(false).catch(error => toast(error.message));
```
2. `scanFillPage`（第 327 行附近）：删除函数内所有 `$("scanFillPage")` 引用（第 328 行 `const button = $("scanFillPage")`、第 329 行 `button.disabled = true`、finally 中 `button.disabled = false`），函数体其余不变。
3. `prepareFillSections`（第 429 行附近）：删除 `$("prepareFillSections")` 相关（第 434 行 `const button = ...`、第 437-438 行 `button.disabled=true; button.textContent=...`、finally 中 `renderPrepareFillAction()`），改为纯编排函数（签名与返回值不变）：
```js
export async function prepareFillSections() {
  const session = state.fillScanSession;
  if (!session?.scanId || !session?.tabId) throw new Error("请先扫描当前网申页面。");
  const plans = buildRepeaterPlans(state.fillRepeaters, activeProfile()?.resumeFields || {});
  if (!plans.length) return null;
  const progress = $("fillProgress");
  progress.textContent = `正在展开 ${plans.length} 类经历区块，请勿切换页面…`;
  try {
    const tab = await currentTab();
    if (!tab || tab.id !== session.tabId) throw new Error("当前标签页不是刚才扫描的页面，请切回后重新扫描。");
    const response = await fillMessagePage(tab, {
      type: "SMART_FILL_PREPARE",
      scanId: session.scanId,
      documentFingerprint: session.documentFingerprint,
      formFingerprint: session.formFingerprint,
      plans: plans.map(({ id, fingerprint, targetCount }) => ({ id, fingerprint, targetCount })),
    });
    if (response?.fields?.length) {
      applyScanResponse(response, tab);
      $("fillCurrentSiteText").textContent = `当前站点：${state.fillScanPage?.host || new URL(tab.url).hostname}（识别到 ${response.fields.length} 个表单项）`;
      progress.textContent = "经历区块已展开，正在重新匹配字段…";
      await buildMatches();
      await renderFillTemplate();
    }
    if (!response?.ok) {
      const failed = (response?.results || []).find(result => !result.ok);
      throw new Error(failed?.error || response?.error || "展开经历区块失败");
    }
    const added = (response.results || []).reduce((sum, result) => sum + Number(result.added || 0), 0);
    progress.textContent = `已展开 ${added} 个经历区块并重新扫描。`;
    return response;
  } catch (error) {
    progress.textContent = `展开失败：${error.message}`;
    throw error;
  }
}
```
4. 删除 `renderPrepareFillAction`（第 407 行附近）及其 4 处调用（第 353、468、502、655 行），替换为一个纯计算辅助函数（供任务 2 的一键流程判断是否需要展开）：
```js
function computeRepeaterAdditions() {
  const plans = buildRepeaterPlans(state.fillRepeaters, activeProfile()?.resumeFields || {});
  return plans.reduce((sum, plan) => sum + plan.targetCount - plan.currentCount, 0);
}
```
5. `updateFillButtons`（第 510 行附近）改为操作新 DOM（删除 `fillAll`；`fillSelected` 用显隐 + 计数；`clearFill` 扫描后有结果才显示）：
```js
function updateFillButtons() {
  const matches = state.fillMatches;
  const count = matches.filter(m => m.status === "match" && state.fillSelected.has(m.fieldId)).length;
  const matched = matches.filter(m => m.status === "match").length;
  const btn = $("fillSelected");
  const showFooter = count > 0 && (!state.fillAutoMode || count < matched);
  btn.disabled = !count;
  btn.hidden = !showFooter;
  btn.textContent = `填充勾选项（${count}）`;
  $("clearFill").hidden = !state.fillScanFields.length;
}
```
6. `runFill`（第 596 行附近）：把禁用/恢复区（第 620-623、654-655 行）改为只操作现存元素：
```js
  fillRunning = true;
  $("smartFillOnce").disabled = true;
  $("clearFill").disabled = true;
  $("fillSelected").disabled = true;
  $("stopFill").hidden = false;
  // ...finally:
  fillRunning = false;
  $("stopFill").hidden = true;
  $("smartFillOnce").disabled = false;
  $("clearFill").disabled = false;
  updateFillButtons();
```
（删除 finally 里的 `renderPrepareFillAction()` 调用。）

- [ ] **步骤 5：运行测试验证通过**

运行 `node --test test/panel-smoke.test.js`，预期：全部用例 PASS（第一个用例 ids 更新后能通过；`updateFillButtons`/`runFill` 不再触碰已删除元素；`fillCurrentSiteText` 元素在 `scanFillPage`/`prepareFillSections` 中被赋值，需确保 panel.html 已包含该 id——若 `$` 对缺失元素抛错，先补元素）。

- [ ] **步骤 6：全量回归 + Commit**

运行 `npm run check && npm test`，预期全绿。

```bash
git add panel.html panel.css src/fill-ui.js test/panel-smoke.test.js
git commit -m "refactor(智能填充): 面板按钮收敛为单主按钮并清理被删按钮的 DOM 引用（任务1）"
```

---

## 任务 2：一键流程自动展开经历（红灯 → 绿灯）

**目标：** 「一键智能填充」点击后，若页面有经历区块且简历有条目，自动执行展开并重扫后再填充；展开失败降级继续填充。

**文件：** `src/fill-ui.js`、`test/panel-smoke.test.js`

- [ ] **步骤 1：编写失败测试（红灯）**

在 `test/panel-smoke.test.js` 中，给 `setupOneClickDom` 的 `tabs.sendMessage` 增加 `SMART_FILL_PREPARE` 分支（第 290 行附近），并把 SCAN 返回的 `repeaters` 由 `[]` 改为可配置（新增一个可选参数 `setupOneClickDom({ repeaters })`，默认 `[]`；SCAN 返回 `repeaters: options.repeaters`）。PREPARE 处理示例：

```js
if (message.type === "SMART_FILL_PREPARE") {
  preparedPlans.push(...message.plans);
  const extra = message.plans.map((plan, i) => ({
    id: `f-edu-${i}`, type: "text", label: `教育经历${i + 1}-学校`,
    rawLabel: `教育经历${i + 1}-学校`, labelSource: "label", skipped: false,
    options: [], fingerprint: `fp-edu-${i}`, path: `#f-edu-${i}`,
    evidence: [{ source: "label", text: "教育经历" }], context: {}, attributes: {},
  }));
  return {
    ok: true,
    fields: [...ONECLICK_SCAN_FIELDS, ...extra],
    repeaters: message.plans.map(p => ({ ...p, currentCount: p.targetCount })),
    results: message.plans.map(p => ({ id: p.id, ok: true, added: p.targetCount })),
    scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1",
    page: { title: "apply", url: tab.url, host: "jobs.example.com" },
  };
}
```

新增两个用例（放在「一键智能填充」用例组之后）：

```js
test("一键智能填充：有经历区块时自动展开后填充", async () => {
  const repeaters = [{ id: "edu", arrayKey: "education", title: "教育经历", currentCount: 0, fingerprint: "fp-edu" }];
  const { appliedFills, sentTypes, preparedPlans, close } = setupOneClickDom({ repeaters });
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000", education: [{ id: "e1", school: "复旦大学" }] } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.ok(sentTypes.includes("SMART_FILL_PREPARE"), "应自动发送展开经历请求");
    assert.ok(preparedPlans.length >= 1, "展开计划应包含教育经历");
    const eduFilled = appliedFills.some(f => f.id.startsWith("f-edu-"));
    assert.ok(eduFilled, "展开后的教育经历字段应被填充");
  } finally { close(); }
});

test("一键智能填充：展开经历失败时降级继续填充", async () => {
  const { appliedFills, sentTypes, close } = setupOneClickDom({ repeaters: [{ id: "edu", arrayKey: "education", title: "教育经历", currentCount: 0, fingerprint: "fp-edu" }], prepareOk: false });
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000", education: [{ id: "e1", school: "复旦大学" }] } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.ok(sentTypes.includes("SMART_FILL_PREPARE"), "应尝试展开经历");
    assert.deepEqual(appliedFills.map(f => f.id).sort(), ["f-name", "f-phone"], "展开失败仍应填充已扫到的字段");
  } finally { close(); }
});
```

`setupOneClickDom` 需返回 `preparedPlans` 数组，并支持 `prepareOk` 选项（PREPARE 返回 `{ ok: false, error: "模拟失败", results: [{ id: "edu", ok: false, error: "模拟失败" }] }` 时不追加字段）。

运行 `node --test test/panel-smoke.test.js`，预期：这两个新用例 FAIL（当前 `runSmartFillOnce` 不调用 `prepareFillSections`）。

- [ ] **步骤 2：实现——升级 runSmartFillOnce**

`src/fill-ui.js` 的 `runSmartFillOnce`（第 842 行附近）改为：

```js
export async function runSmartFillOnce() {
  if (fillRunning) throw new Error("填充进行中，请等待完成或点击停止。");
  const ok = await scanFillPage();
  if (!ok) return; // scanFillPage 内部已 toast 错误
  // 自动展开经历（失败降级：继续填充已扫到的字段）
  if (computeRepeaterAdditions() > 0) {
    try {
      await prepareFillSections();
    } catch (_error) {
      // 展开失败已 toast，不中断一键流程
    }
  }
  if (!state.fillMatches.some(match => match.status === "match")) {
    toast("未发现可自动填充的字段，请在列表中手动确认");
    return;
  }
  if (!state.fillAutoMode) {
    toast("已扫描，请在预览中勾选后点击「填充勾选项」");
    return;
  }
  const result = await runFill(false);
  toast(`一键填充完成：成功 ${result.summary.ok}/${result.summary.total}${result.failedIds.length ? `，${result.failedIds.length} 项需手动处理（已在页面高亮）` : ""}`);
}
```

`scanFillPage` 内（第 370 行附近）把 `$("fillCurrentSite").textContent = ...` 改为同时写 `fillCurrentSiteText` 并显示 `clearFill`：
```js
    $("fillCurrentSite").textContent = "";
    $("fillCurrentSiteText").textContent = `当前站点：${pageUrl.hostname}（识别到 ${fields.length} 个表单项）`;
    $("clearFill").hidden = false;
```

- [ ] **步骤 3：运行测试验证通过**

运行 `node --test test/panel-smoke.test.js`，预期：新用例 PASS，既有「一键智能填充」4 个用例仍 PASS（repeaters 默认 `[]`，走原路径）。

- [ ] **步骤 4：全量回归 + Commit**

运行 `npm run check && npm test`，预期全绿。

```bash
git add src/fill-ui.js test/panel-smoke.test.js
git commit -m "feat(智能填充): 一键主按钮自动展开经历并降级填充（任务2）"
```

---

## 任务 3：结果列表折叠与按需显隐（红灯 → 绿灯）

**目标：** 一键填充成功后列表折叠为「需人工处理 N 项」（展开）+「已自动填充 N 项」（折叠）；预览模式仍展示全部字段；「填充勾选项」/「清空」按设计显隐。

**文件：** `src/fill-ui.js`、`test/panel-smoke.test.js`

- [ ] **步骤 1：编写失败测试（红灯）**

新增用例（放在「一键智能填充」用例组之后）：

```js
test("一键智能填充：成功后列表折叠为需人工处理+已自动填充", async () => {
  const { close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    const manual = window.document.querySelector(".fill-summary-manual");
    const done = window.document.querySelector(".fill-summary-done");
    assert.ok(manual, "应有「需人工处理」折叠组");
    assert.ok(done, "应有「已自动填充」折叠组");
    assert.equal(manual.querySelectorAll(".fill-row").length, 1, "内推码应为需人工处理项");
    assert.equal(done.querySelectorAll(".fill-row").length, 2, "姓名/手机号应为已自动填充项");
    assert.match(done.textContent, /已自动填充（2）/);
    assert.equal(window.document.getElementById("fillSelected").hidden, true, "自动填充完成后工具条按钮应隐藏");
  } finally { close(); }
});

test("智能填充：预览模式下工具条按钮显示且清空链接按需出现", async () => {
  const { close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce, clearFill } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(false);
    await runSmartFillOnce();
    const footer = window.document.getElementById("fillSelected");
    assert.equal(footer.hidden, false, "预览模式应显示填充勾选项按钮");
    assert.match(footer.textContent, /填充勾选项（2）/);
    assert.equal(window.document.getElementById("clearFill").hidden, false, "扫描后清空链接应显示");
    await clearFill();
    assert.equal(window.document.getElementById("clearFill").hidden, true, "清空后清空链接应隐藏");
  } finally { close(); }
});
```

运行 `node --test test/panel-smoke.test.js`，预期：这两个新用例 FAIL（当前 `renderFillMatches` 平铺渲染，无折叠组；`fillSelected` 显隐逻辑未实现折叠后隐藏）。

- [ ] **步骤 2：实现——折叠渲染 + 显隐**

1. `src/fill-ui.js` 顶部模块级变量区（`let expandedEntryId = ""` 附近）新增：
```js
let fillResultMode = "list"; // "list" = 预览/全量平铺；"summary" = 一键填充后的折叠视图
```
2. 把现有 `renderFillMatches`（第 550 行附近）的单行渲染抽为 `matchRowHtml(match)`（内容为原 `rows` map 内模板字符串，使用原 `selected/value/editable/keyEditable/bindingChoice/badges/evidence` 计算），然后在 `renderFillMatches` 末尾按模式渲染：
```js
export function renderFillMatches() {
  const target = $("fillResultList");
  const matches = state.fillMatches;
  if (!target) return;
  if (!matches.length) {
    target.innerHTML = `<p class="hint">扫描后这里会显示识别结果与匹配建议。</p>`;
    updateFillButtons();
    return;
  }
  const fieldKeyOptions = resumeBindingChoices()
    .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
    .join("");
  const datalist = `<datalist id="fillFieldKeyOptions">${fieldKeyOptions}</datalist>`;
  if (fillResultMode === "summary") {
    const manual = matches.filter(m => m.status === "manual" || state.fillFailedIds.includes(m.fieldId));
    const filled = matches.filter(m => m.status === "match" && !state.fillFailedIds.includes(m.fieldId));
    target.innerHTML = datalist + (manual.length
      ? `<details class="fill-summary-manual" open><summary>需人工处理（${manual.length}）</summary>${manual.map(matchRowHtml).join("")}</details>`
      : `<p class="hint fill-done-tip">🎉 全部 ${filled.length} 项已填充</p>`)
      + `<details class="fill-summary-done"><summary>已自动填充（${filled.length}）</summary>${filled.map(matchRowHtml).join("")}</details>`;
  } else {
    target.innerHTML = datalist + matches.map(matchRowHtml).join("");
  }
  updateFillButtons();
}
```
3. `runFill` 成功路径（`await afterFill(...)` 之后、`if (summary.ok > 0) startIncrementalWatch();` 之前）插入：
```js
    if (state.fillAutoMode) {
      fillResultMode = "summary";
      renderFillMatches();
    }
```
4. `scanFillPage`（`setFillScanFields(fields)` 之前）与 `clearFill`（重置列表处）各加一行 `fillResultMode = "list";`。
5. `updateFillButtons` 维持任务 1 版本即可（自动模式 `count === matched` → footer 隐藏；预览模式 `!state.fillAutoMode` → footer 显示）。

- [ ] **步骤 3：运行测试验证通过**

运行 `node --test test/panel-smoke.test.js`，预期：两个新用例 PASS，既有用例全绿。

- [ ] **步骤 4：全量回归 + Commit**

运行 `npm run check && npm test`，预期全绿。

```bash
git add src/fill-ui.js test/panel-smoke.test.js
git commit -m "feat(智能填充): 一键填充后列表折叠为需人工处理+已自动填充（任务3）"
```

---

## 任务 4：文档同步与最终回归

**目标：** 使用说明同步为一键操作；全量检查 + 测试 + 构建全绿。

**文件：** `docs/智能填充使用说明.md`、`README.md`（如需）

- [ ] **步骤 1：更新 `docs/智能填充使用说明.md`**

- 「三、操作步骤」改为：打开网申页 → 切到「智能填充」→ 确认简历 → 点击「一键智能填充」→ 高置信项自动填好；「需人工处理」区逐项确认后在列表下方点击「填充勾选项（N）」补填；扫描后站点行尾的「清空」可重置。
- 删除「扫描当前页面」「展开简历经历（+N）」「全部填充」相关步骤描述，改为说明这些动作已并入一键流程（经历区块会自动展开，展开失败不中断）。
- 「二、工作原理」第 3 条同步修改。

- [ ] **步骤 2：确认无残留引用**

`grep -rn "scanFillPage\|prepareFillSections\|fillAll\|renderPrepareFillAction" panel.html src test tests`（排除 node_modules），预期只出现在 `scanFillPage`/`prepareFillSections` 函数定义处与测试按需处（若仍有对已删按钮 DOM 的引用，一并清理）。

- [ ] **步骤 3：最终回归**

运行 `npm run check && npm test && npm run build`，预期全绿。

- [ ] **步骤 4：Commit**

```bash
git add docs/智能填充使用说明.md
git commit -m "docs(智能填充): 使用说明同步为一键填充操作（任务4）"
```

---

## 自检（已对照规格）

1. **规格覆盖度：**
   - 主按钮一键 = 扫描 + 自动展开 + 填充高置信项 → 任务 1、2
   - 删除 扫描/展开/全部填充 按钮 → 任务 1
   - 清空缩小为站点行链接、按需显示 → 任务 1、3
   - 填充勾选项下沉为列表底部工具条、按需显隐 → 任务 1、3
   - 结果列表折叠「需人工处理 + 已自动填充」 → 任务 3
   - 预览模式（自动填充开关关）保留全量列表 → 任务 3
   - 文档同步 → 任务 4
2. **占位符扫描：** 无 TODO/待定；每个步骤含可执行代码或精确命令。
3. **类型一致性：** `computeRepeaterAdditions`、`fillResultMode`、`matchRowHtml`、`setupOneClickDom({ repeaters, prepareOk })`、`fillCurrentSiteText` 等名称在任务间保持一致；`runSmartFillOnce`/`prepareFillSections`/`runFill(false)` 签名不变量。
